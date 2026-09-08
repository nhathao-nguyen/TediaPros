# DUBBING-TIMING-RECOVERY: ràng buộc thời lượng dịch và cứu lỗi Local TTS

- **Trạng thái:** Đã kiểm chứng cục bộ; follow-up parser/rescue tại `2026-09-08-rephrase-label-recovery.md`
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-08

## 1. Mục tiêu

Sửa việc Local tắt rephrase khiến cue có natural audio 2.428s hoặc 2.727s dừng ở trần 1.45x. Giảm câu quá dài từ bước dịch và trước TTS, giữ giới hạn audio và không bỏ câu.

## 2. Tiêu chuẩn nghiệm thu

- [x] Dịch AutoShort nhận cửa sổ nói thực tế theo video và cue kế tiếp.
- [x] Preflight batch rút gọn trước bootstrap/TTS; predictor không quyết định fit cuối.
- [x] Local được một lượt cứu lỗi sau khi đo audio; phương án vẫn quá dài bị từ chối.
- [x] Parser rephrase nhiều cue giữ strict validation; timestamp và ID được giữ nguyên.
- [x] `npm.cmd run typecheck`: node/web PASS.
- [x] Initial 252 test PASS, 0 fail; follow-up 267 test PASS, 0 fail trong 14 suite.
- [ ] Chạy lại hai video trên server LLM/TTS thật (chưa thực hiện).

## 3. Phạm vi

Chỉ luồng dịch và dubbing của worktree `F:/Son/tool/TediaPros/.worktrees/codex-autoshort-optimization`. Giữ các thay đổi dirty có sẵn; không commit/merge, không sửa `main`, không thay đổi license, runtime hay UI.

## 4. Quyết định

Dùng một hàm ngân sách nói chung cho translation và measured fit. Preflight tối đa 24 cue/request trước khi TTS tải model; rescue giới hạn một lượt/cue sau đo. Giữ lời dịch ban đầu để đối chiếu với lời đọc cuối. Prompt version được tăng để không tái sử dụng bản dịch theo policy cũ.

## 5. Tệp thay đổi trong task này

- `src/shared/translation.ts`: metadata ngân sách nói tùy chọn.
- `src/main/dubbing/translation.ts`: tính cửa sổ nói chung.
- `src/main/dubbing/synthesis.ts`: preflight, rescue và kiểm tra tempo DSP.
- `src/main/autoshort.ts`: metadata dịch, parser batch, bật callback Local và lease.
- `src/main/autoShortItemCoordinator.ts`: truyền thời lượng video và đưa vào identity.
- `src/main/translation/prompts.ts`: prompt v5 và ngân sách audio.
- `src/main/translation/response.ts`: parser rephrase batch.
- `tests/dubbing-plan.test.ts`, `tests/translation-prompts.test.ts`, `tests/translation-rephrase.test.ts`: hồi quy.
- `docs/releases/dubbing-timing-recovery.md`: hành vi và giới hạn bằng chứng.

## 6. Kiểm chứng và bằng chứng

Các test mới cho prompt, batch parser và preflight đã fail trước khi sửa. Regression DSP cũng đã fail trước guard mới, lưu tại `2026-09-08-dubbing-timing-red.log`.

```powershell
node scripts/run-local-runtime-tests.mjs dubbing-plan.test autoshort-tts-pipeline.test autoshort-tts-cache.test translation-prompts.test translation-rephrase.test translation-planner.test translation-orchestrator.test translation-resume.test translation-provider-contract.test translation-identity.test local-translation.test autoshort-ocr-pipeline.test local-runtime.test
npm.cmd run typecheck
git diff --check
```

Kết quả initial: 252/252 test pass. Follow-up parser/rescue: 267/267 test pass trong `.ai/tasks/2026-09-08-rephrase-label-tests.log`; typecheck và build mới nằm tại `.ai/tasks/2026-09-08-rephrase-label-typecheck.log` và `.ai/tasks/2026-09-08-rephrase-label-build.log`. Suite OCR có probe encoder GPU không khả dụng rồi fallback CPU thành công; không phải lỗi test.

Chưa kiểm tra chất lượng ngữ nghĩa/rút gọn bằng LLM thật, giọng clone thật, VRAM và kết quả render của hai video người dùng. Không coi HTTP/TTS fixture là bằng chứng server thật.

## 7. Bàn giao

Chạy/build từ đúng worktree và restart Electron trước khi thử lại. Việc build/restart đã hoàn tất trong follow-up; giữ bản dịch gốc, `finalSpokenText`, natural duration và tempo để đối chiếu nếu cue còn lỗi. Chưa phát hành hay merge.
