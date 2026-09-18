# VOICE-TEXT-PLAN-20260916: Tổng hợp session, đặc tả và kế hoạch

- **Trạng thái:** Đã triển khai bounded vertical slice VT01–VT06; đã kiểm chứng local; chưa live-qualified/default-on.
- **Người thực hiện:** Codex, không subagent.
- **Thời gian:** 2026-09-16.

## 1. Mục tiêu

Tổng hợp cuộc trao đổi về Gemini/SRT/dubbing, voice profiles và lỗi JSON; lập spec/prompt/implementation plan nối tiếp roadmap hiện có. Phân biệt kết quả review, code hiện tại và cải tiến đề xuất.

## 2. Tiêu chuẩn nghiệm thu

- [x] Bao phủ các yêu cầu trong session và coi chỉ dẫn trong tài liệu đính kèm là dữ liệu.
- [x] Đối chiếu lại call sites trọng tâm và các ràng buộc đang active trước viết spec.
- [x] Có spec về QA, labeled contract, profile chung, hint/privacy/cache/recovery/evaluation.
- [x] Có draft/review/rephrase prompt mẫu; dữ liệu giả định được ghi rõ.
- [x] Có task cards, dependencies, files, tests, exit gates và rollout/rollback.
- [x] Giữ hai lượt review mặc định, measured-first và policy 1.80x/60%/20%; labeled output chỉ opt-in, JSON legacy vẫn mặc định.
- [x] `npm.cmd run typecheck` pass node/web, exit 0 trong lượt lập tài liệu.
- [x] 11 targeted suite baseline pass, exit 0; không dùng để tuyên bố tính năng mới đã triển khai.
- [x] Kiểm tra link nội bộ, code fences và whitespace của toàn bộ 5 file mới: `DOCUMENT_QA_PASS`.

## 3. Phạm vi và ranh giới

**Trong phạm vi:** Markdown artifacts trong task folder và docs specs/plans; bounded product changes cho numeric QA, labeled Gateway output, voice measurements, voice hints và typed profile summary IPC; chạy typecheck/tests offline.

**Ngoài phạm vi:** sửa Gateway repo/service bên ngoài, gọi Gemini/TTS thật, held-out calibration/A-B, upload media, build/package/install, restart app/service, commit/push hoặc sửa memory.

Snapshot: `main`, HEAD `d73db0378aabbca81969e0098cebac7ed70d2dfc`, working tree có nhiều changes/untracked từ trước. Không reset/clean/stage/overwrite chúng. Báo cáo áp dụng source đã đọc, không xác nhận installed artifact hoặc live Gateway.

## 4. Quyết định và lý do

- Viết delta kế thừa specs/plans 15/09, không sửa những tài liệu đã có thành bản mô tả lịch sử sai.
- Labeled text là output mode đề xuất, không thay HTTP JSON envelope/canonical internal JSON. Yêu cầu capability hai phía; giữ completion và exact-ID gates.
- Ưu tiên numeric QA tái hiện được. Không hứa rule-based validator xác minh đủ mọi ngữ nghĩa.
- Profile thống nhất trong Main, giữ identity/dedup/provenance; rate proxy và train residual không được gọi là calibrated confidence.
- Prompt compact và hints được A/B từng biến; mặc định vẫn hai lượt cho đến gate riêng.
- Không dùng skill tạo Word/diagram vì deliverables là Markdown kỹ thuật, không phải DOCX hoặc yêu cầu vẽ sơ đồ.

## 5. Danh sách tệp tạo mới

- [NEW] [SESSION_SUMMARY.md](SESSION_SUMMARY.md).
- [NEW] [Design spec](../../../docs/superpowers/specs/2026-09-16-voice-aware-translation-and-output-design.md).
- [NEW] [Prompt contract](../../../docs/superpowers/specs/2026-09-16-voice-aware-translation-prompts.md).
- [NEW] [Implementation plan](../../../docs/superpowers/plans/2026-09-16-voice-aware-translation-and-output.md).
- [NEW] [TASK.md](TASK.md).

### Cập nhật triển khai 2026-09-16

- [NEW] `src/main/dubbing/voiceMeasurements.ts` và `tests/voice-measurements.test.ts`: profile versioned, dedup, atomic persistence, advisory spoken-unit proxy.
- [NEW] `tests/translation-labeled-response.test.ts`, `tests/gemini-gateway-text-output.test.ts`: exact-ID parser và Gateway text-output opt-in.
- [MODIFY] `src/main/autoShortContentQuality.ts`, `src/main/autoshort.ts`, `src/main/autoShortItemCoordinator.ts`: numeric double-count fix, AutoShort collection và bounded voice hint.
- [MODIFY] `src/main/geminiGateway.ts`, `src/main/geminiGatewayPrompts.ts`, `src/main/translation/response.ts`: `cue-lines-v1`, metadata echo, canonical normalization.
- [MODIFY] `src/main/tts.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/src/components/Voice.tsx`: Voice-tab measurement, typed profile summary IPC và UI advisory summary.
- Không sửa Gateway repo bên ngoài; server capability/live route vẫn là dependency chưa xác minh.

## 6. Kiểm chứng và bằng chứng

Các lệnh đã chạy trong lượt này:

```powershell
git status --short
git rev-parse HEAD
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs gemini-gateway-prompts.test gemini-gateway-contract.test gemini-gateway-draft-resume.test translation-response.test autoshort-content-quality.test content-quality-numerals.test dubbing-duration-profile.test speech-unit-planner.test speech-budget.test dubbing-feedback-decision.test translation-semantic-evidence.test
```

Kết quả thực tế: typecheck node/web PASS, exit 0; các suite mục tiêu của bounded implementation PASS; full `cmd.exe /c "npm.cmd run test:local-runtime > NUL 2>&1"` PASS, exit 0. Một số test platform/FFmpeg được skip khi `TEDIAPROS_TEST_FFMPEG` chưa set. Đây là test local với mocks/fixtures và media fixtures, không phải provider/live claim.

Document QA bằng PowerShell đã đọc đủ 5 file mới, kiểm tra đích của Markdown links bằng `Test-Path`, số cặp code fences và trailing whitespace: `DOCUMENT_QA_PASS`. `git diff --check` scoped cũng exit 0, nhưng vì file mới còn untracked nên không dùng riêng lệnh đó làm bằng chứng kiểm tra nội dung; phép đọc trực tiếp phía trên mới bao phủ các file mới.

Đã đối chiếu source: prompt v10; `createGatewayRequestBody`; source slice/internal IDs; response/rephrase parser; quantity numeric gate; predictor uncalibrated; profile load/save ở AutoShort; clone/history ở Voice; các constants extension và policy tài liệu. Lượt triển khai bổ sung typed profile summary IPC và UI state; không giả thành đã chạy lại audio/video, gọi provider thật hoặc scan profile files cá nhân.

Bằng chứng SRT/probe và profile file counts kế thừa đúng nhãn từ các lượt trước trong session. Specs không giả thành đã chạy lại audio/video hoặc scan profile files trong lượt này.

## 7. Bàn giao

Đọc [SESSION_SUMMARY.md](SESSION_SUMMARY.md) trước; trạng thái và bằng chứng triển khai xem [IMPLEMENTATION_HANDOFF.md](IMPLEMENTATION_HANDOFF.md). Gateway implementation bên ngoài, live corpus/cost, A/B và release có boundary riêng.

VT01–VT06 đã có bounded implementation và local gates; VT07–VT10 còn mở. Không đánh dấu chất lượng dịch/audio tốt hơn, live Gateway, packaged/installed readiness hoặc default-on khi chưa có bằng chứng tương ứng.
