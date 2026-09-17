# VOICE-AWARE-LIVE-VALIDATION: Gateway thật, calibration và A/B toàn corpus

- **Trạng thái:** BLOCKED — đã chạy đủ corpus nhưng upstream Gemini đang trả HTTP 429/503 cho generation
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-16 đến 2026-09-17

## 1. Mục tiêu

Xác minh Gateway Gemini thật bằng cookie-backed session, đo advisory profile cho 5 Edge-TTS voice, ASR toàn bộ `F:\Son\test`, rồi chạy A/B baseline so với voice-aware trên đủ 64 video. Kết quả phải giữ nguyên cue ID/timestamp, checkpoint được và phân biệt rõ measured output với provider/human review.

## 2. Tiêu chuẩn nghiệm thu và kết quả

- [x] Gateway `/health` HTTP 200; capabilities contract v2 và `provider_ready=true`.
- [x] Completion probe trước khi chạy corpus: model route `gemini-advanced`, observed `3.1 Pro`, `model_verification=matched`, `completion_evidence=observed-terminal-frame-v1`, output contract `cue-lines-v1`.
- [x] Edge-TTS calibration live: 5 voice × 8 mẫu = 40/40 success, scheduler tuần tự; profile vẫn `advisory`/`not_qualified`.
- [x] ASR toàn corpus: 64/64 MP4 có transcript SRT, 0 lỗi; dùng managed Whisper CUDA.
- [x] A/B đã thử đủ 64/64 video trong report `full-64/ab-512`, gồm retry sau checkpoint; không còn video bị thiếu record.
- [ ] A/B production-quality chưa đạt: 3/64 video đủ cả hai arm `done`; 121/128 arm failed và cần review/provider recovery.
- [ ] Full-corpus generation bị chặn bởi upstream Gemini HTTP 429/503, kể cả probe một video sau restart và sau khi đổi sang profile Gemini Pro thứ hai còn 0% weekly usage.
- [x] `npm run typecheck` pass; các local runtime suite liên quan pass 90/90 ở checkpoint trước khi chạy corpus.

## 3. Bằng chứng chính

- Transcript report: `full-64/transcripts/transcription-report.json` — 64/64 success.
- A/B raw report: `full-64/ab-512/ab-report.json` — `sourceVideoCount=64`, `recordedVideoCount=64`, `doneVideoCount=3`, `failedArmCount=121`.
- A/B summary: `full-64/ab-512/ab-summary.json` — aggregate chỉ tính arm dịch đủ cue; timing là proxy từ Edge-TTS, semantic vẫn `pending-human`, outcome `incomplete-or-inconclusive`.
- Voice profiles: `edge-voice-calibration/voice-calibration-report.json` — 40/40 success, 5 profile advisory.
- Gateway evidence/probe: `gateway-live-evidence.json` và các audit JSON trong `full-64/ab-512/video-*/{a-baseline,b-voice-hint}`.

## 4. Thiết kế A/B

- `a-baseline`: `cue-lines-v1`, không truyền voice hint.
- `b-voice-hint`: cùng prompt/contract, thêm profile advisory `vi-VN-HoaiMyNeural` (P10/median/P90).
- Worker đặt `outputTokens=512`, planner chia batch khoảng 15–28 cue để giảm missing-ID/timeout; draft checkpoint được validate và resume.
- Mặc định adapter vẫn two-pass (restore/translate + independent review). Đã thêm `reviewMode='draft-only'` cho fallback live evaluation, nhưng single-pass chỉ mới probe và cũng bị upstream 429; không dùng nó để nâng kết quả hiện tại.
- Summary không đưa arm thiếu cue vào denominator fit; arm failed vẫn giữ trong status/issue counts.

## 5. Phân loại lỗi quan sát được

- `provider-transient`: lỗi upstream 429/503 hoặc BardErrorInfo code `[8 1095]` (session/rate-limit/bot protection/context không phân biệt được từ upstream).
- `missing-id`/`provider-protocol`: model trả cue ngoài tập yêu cầu hoặc thiếu cue.
- `protected-token-suspect`: provider assessment warning; chưa có human semantic review.
- `invalid-source`: 4 SRT parser warnings/empty source trong corpus.
- Gateway local limiter ban đầu là 30 rồi 120 request/phút; đã tăng lên 5000 cho validation local và restart. Sau đó 429 vẫn xảy ra ở upstream, nên không coi đây là fix cho provider.

## 6. Thay đổi mã nguồn/tài liệu

- `src/main/geminiGateway.ts`: output-token override, checkpoint canonicalization cho cue-lines, `reviewMode` draft-only fallback.
- `scripts/run-gemini-ab-corpus-worker.ts`: A/B worker 512-token, voice hint, retry/checkpoint, optional `--single-pass`.
- `scripts/run-gemini-ab-corpus.mjs`: bundle worker.
- `scripts/summarize-gemini-ab-corpus.mjs`: aggregate measured-fit chỉ trên arm dịch đủ cue, paired bootstrap và evidence boundary.
- `scripts/transcribe-video-corpus-worker.ts`, `scripts/run-video-corpus-transcription.mjs`: transcription corpus 64.
- `F:\Son\tool\CreateMediaTool\.env`: cookie session local, limiter validation, `GEMINI_TEMPORARY=false`; không ghi secret vào evidence/report.

## 7. Kiểm chứng đã chạy

```powershell
cmd.exe /c "npm run typecheck"
node scripts/run-local-runtime-tests.mjs voice-measurements.test gemini-gateway-contract.test gemini-gateway-text-output.test gemini-gateway-prompts.test dubbing-plan.test edge-tts-contract.test
go test ./...                       # CreateMediaTool Gateway
node scripts/summarize-gemini-ab-corpus.mjs --input <ab-report.json> --output <ab-summary.json>
```

Kết quả: typecheck PASS; Gateway Go tests PASS; local runtime 90/90 PASS; ASR 64/64 PASS; Edge-TTS 40/40 PASS; A/B attempts 64/64 nhưng generation upstream bị chặn.

## 8. Blocker và bước tiếp theo

Blocker hiện tại nằm ngoài codebase: Gemini Web generation trả 429/503 ngay cả request nhỏ sau restart, full cookie header và profile Pro thứ hai. Cần chờ cửa sổ reset upstream, dùng session/account/network khác, hoặc chuyển sang Gemini API key chính thức; sau đó chạy lại worker với report checkpoint để chỉ retry arm failed.

Không tuyên bố voice profile đã qualified, không tuyên bố bản dịch semantic đã được người duyệt, và không dùng fit proxy hiện tại làm production guarantee.
