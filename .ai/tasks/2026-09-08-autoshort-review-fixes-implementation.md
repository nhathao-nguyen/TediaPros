# TASK-20260908-AUTOSHORT-REVIEW-FIXES: Implement F1–F6

- **Trạng thái:** Đã kiểm chứng local; media acceptance pending
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-08

---

## 1. Mục Tiêu (Goal)

Implement các finding F1–F6 từ review bằng code thực tế, giữ source ledger, nội dung và duration audio đo thật; không tăng tempo quá `1.45x`, không metadata clamp và không dùng blanket question exemption.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Group phụ thuộc predecessor không bị structural split theo lịch tạm; child window không dương bị từ chối.
- [x] Synthesis gọi batch adapter một lần; Local HTTP vẫn chunk tối đa 8 và giữ một lease qua response body/repair.
- [x] Publication validator chặn actual EOF overshoot và không mutate evidence.
- [x] Phủ định thật/câu ghép được giữ; chỉ miễn trợ từ nghi vấn có evidence hai phía.
- [x] Số Hán compound/ordinal theo ngữ cảnh được canonicalize; lexical spans không bị đổi từng glyph.
- [x] Prompt là `translation-v6`; identity thay đổi theo `speakingDuration` khi field có mặt.
- [x] Typecheck, toàn bộ local-runtime, build và diff check pass.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** dubbing scheduling guard, rephrase adapter/lease, publication policy, content QA, translation identity và regression tests.
- **Chưa có bằng chứng:** rerun video lỗi gốc với Local AI/TTS provider, voice/model/GPU thật; peak VRAM/model swap telemetry; packaged application acceptance.
- **Follow-up:** late structural split/worklist sau khi batch đã bắt đầu chưa được thêm; trường hợp không fit sau khi predecessor rescue vẫn fail theo hard ceiling thay vì mở vòng LLM mới.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Phân loại measured cue thành `fit`, `overflow`, `deferred`; chỉ `overflow` chắc chắn mới split sớm.
- Lease thuộc toàn pha Local inference để TTS khác không chen giữa initial response body và missing-only repair.
- Publication validation thuần; số đo sai dừng publish và giữ diagnostic nguyên bản.
- Polarity token mang scope question/statement; numeral parser chỉ nhận grammar và context có fixture.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/dubbing/synthesis.ts`, `src/main/autoshort.ts`
- `[MODIFY]` `src/main/autoShortPolicy.ts`, `src/main/autoShortItemCoordinator.ts`
- `[NEW]` `src/main/contentQuality/negation.ts`, `src/main/contentQuality/numerals.ts`
- `[MODIFY]` `src/main/autoShortContentQuality.ts`
- `[MODIFY]` `src/main/translation/prompts.ts`, `src/main/translation/checkpoint.ts`
- `[NEW/MODIFY]` các suite regression và test registry liên quan.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
node scripts/run-local-runtime-tests.mjs dubbing-plan.test dubbing-grouping.test translation-rephrase.test autoshort-publication-timeline.test autoshort-content-quality.test content-quality-numerals.test translation-prompts.test translation-identity.test translation-resume.test translation-orchestrator.test autoshort-tts-pipeline.test autoshort-tts-cache.test autoshort-resource-manager.test autoshort-resource-lifecycle.test autoshort-item-scope.test autoshort-disk-budget.test autoshort-ocr-pipeline.test local-runtime.test
npm run typecheck
npm run test:local-runtime
npm run build
git diff --check
```

### Kết quả thực tế

- Targeted gate: PASS, 18 suite, exit `0`.
- Typecheck node + web: PASS, exit `0`.
- Toàn bộ test registry `test:local-runtime`: PASS, exit `0`.
- Electron/Vite production build: PASS, exit `0`; chỉ có các cảnh báo chunk dynamic/static import đã tồn tại.
- `git diff --check`: PASS, exit `0`.
- HEAD kiểm chứng: `863f55c38822e28046b0f0592c206ca9303aeeb5`; working tree giữ nguyên các artifact/untracked có trước.

### Ranh giới bằng chứng

- `CODE_CONFIRMED`: các behavior nêu trong acceptance criteria có đường code và test public API tương ứng.
- `TEST_CONFIRMED`: fixture local gồm FFmpeg/coordinator path; không tương đương provider/GPU production.
- `UNKNOWN`: media acceptance với video lỗi ban đầu vì chưa xác định duy nhất video, model, voice và endpoint runtime.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Khi có đúng video/config lỗi gốc, chạy Gate B vào output scope mới và đối chiếu `tts-timeline.json`, FFprobe, waveform tail và nghe các cue rescue.
- Không stage/xóa các file untracked có trước. Nếu commit, stage explicit các file của task này.
