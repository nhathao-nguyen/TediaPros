# TASK-20260908-AUTOSHORT-DECOUPLED-DUBBING: Tách measured TTS và batch rephrase

- **Trạng thái:** Đã kiểm chứng local; media acceptance pending
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-08

---

## 1. Mục Tiêu (Goal)

Sửa lỗi cue TTS vượt thời lượng bằng cách đo toàn bộ audio gốc trước, batch rephrase các cue overflow, rồi chỉ đo lại candidate hợp lệ. Pipeline giữ source anchor, protected gap `0.50s`, toàn bộ nội dung và hard ceiling tempo `1.45x`.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Measured pass không gọi LLM xen kẽ trong vòng lặp TTS.
- [x] Structural split xảy ra trước batch rephrase và giữ đủ source cue identity.
- [x] Local measured overflow batch tối đa 8 cue, exact ID, có measured/max duration và repair missing bounded.
- [x] Candidate rescue được TTS/trim đo thật; không vượt `1.45x`, không cắt hoặc bỏ cue.
- [x] Progress và manifest phân biệt phase, có metrics overflow/batch/rescue.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Full local-runtime và build pass kèm bằng chứng log.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):** `src/main/dubbing/synthesis.ts`, active AutoShort TTS wiring, Local batch rephrase, timing telemetry/manifest, regression tests và ADR 005.
- **Nằm ngoài phạm vi (Out of Scope):** thay đổi IPC/SRT, tăng tempo ceiling, khởi động TTS server từ xa, media acceptance với server thật.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* `DubbingRephraseAdapter` nhận overflow request sau measured pass; synthesis chunk adapter thành batch tối đa 8.
- *Lý do:* Local inference không phải đổi model theo từng cue; TTS chỉ chạy lại cho candidate có cơ hội fit, giảm nghẽn và giữ audio gốc khi LLM lỗi.
- *Lựa chọn:* translation prompt giữ duration budget hiện có; không ép character cap cứng.
- *Lý do:* duration budget chỉ là hướng dẫn, WAV đo thật mới quyết định fit và semantic preservation không bị cắt theo số ký tự.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/dubbing/synthesis.ts`
- `[MODIFY]` `src/main/autoshort.ts`
- `[MODIFY]` `src/main/autoShortItemCoordinator.ts`
- `[MODIFY]` `src/main/autoShortContentQuality.ts` (ordinal/CJK token QA regression)
- `[MODIFY]` `tests/dubbing-plan.test.ts`
- `[MODIFY]` `tests/local-runtime.test.ts`
- `[MODIFY]` `tests/autoshort-content-quality.test.ts`
- `[MODIFY]` `tests/translation-rephrase.test.ts`
- `[MODIFY]` `docs/adr/005-source-anchored-dubbing-tempo-policy.md`
- `[MODIFY]` `docs/superpowers/specs/2026-09-08-autoshort-decoupled-dubbing-design.md`

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
node scripts/run-local-runtime-tests.mjs dubbing-plan.test
node scripts/run-local-runtime-tests.mjs dubbing-grouping.test
node scripts/run-local-runtime-tests.mjs translation-rephrase.test
node scripts/run-local-runtime-tests.mjs translation-prompts.test
node scripts/run-local-runtime-tests.mjs autoshort-tts-pipeline.test
node scripts/run-local-runtime-tests.mjs local-runtime.test
node scripts/run-local-runtime-tests.mjs autoshort-content-quality.test
node scripts/run-local-runtime-tests.mjs translation-orchestrator.test
cmd.exe /d /c "npm.cmd run typecheck"
cmd.exe /d /c "npm.cmd run test:local-runtime"
cmd.exe /d /c "npm.cmd run build"
```

### Kết quả thực tế:

- `dubbing-plan.test`: PASS, 33/33.
- `dubbing-grouping.test`: PASS, 12/12.
- `translation-rephrase.test`: PASS, 18/18.
- `translation-prompts.test`: PASS, 7/7.
- `autoshort-tts-pipeline.test`: PASS, 5/5.
- `local-runtime.test`: PASS, 157/157.
- `typecheck`: PASS, node và web không có lỗi.
- `test:local-runtime`: PASS, exit code `0`; các fixture failure trong log đều là nhánh lỗi được kiểm thử có chủ đích.
- `build`: PASS, Electron/Vite tạo `out/main`, `out/preload` và `out/renderer`.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Chưa có media acceptance với TTS server thật trong task này; local tests không chứng minh server provider/GPU hoạt động.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Kiểm tra full suite/build, sau đó cập nhật task thành `Đã kiểm chứng` nếu pass.
- Khi test media thật, log phải có thứ tự `phase=measure` → `phase=batch-rephrase` (nếu có overflow) → `phase=rescue`.
- Giữ nguyên hard ceiling `1.45x`; cue không fit phải dừng với diagnostic rõ ràng.
