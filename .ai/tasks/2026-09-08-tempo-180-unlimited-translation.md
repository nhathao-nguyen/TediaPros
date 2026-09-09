# TASK-20260908-TEMPO-BUDGET: Tempo 1.80x và tạm bỏ ngân sách dịch

- **Trạng thái:** Đã kiểm chứng code, test local và build; bản vá reflow cue trước đã thêm kiểm thử; chưa chạy lại media/provider thật.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-08

## 1. Mục tiêu

Thực hiện chỉ đạo mới nhất của người dùng: “Tạm thời bỏ ngân sách dịch, cho dùng thoải mái, nâng mức max tempo cho phép lên 1.8x”. Chỉ đạo này thay thế giới hạn 1.45x trước đó cho task hiện tại.

## 2. Tiêu chuẩn nghiệm thu

- [x] Hard tempo ceiling và fixed pace clamp dùng 1.80x.
- [x] Replay số đo natural=2.496s, output=1.710s chấp nhận tempo=1.4596x.
- [x] Audio cần đúng 1.80x vẫn fit, bảo toàn lời và thời gian audio đo được.
- [x] Mặc định không giới hạn request, recovery mỗi batch/toàn run hoặc tổng thời gian dịch.
- [x] Checkpoint hết quota cũ có thể tiếp tục, bảo toàn bộ đếm và JSON hợp lệ.
- [x] Typecheck, test liên quan và production build pass.
- [x] Tài liệu và hướng dẫn AGENTS ghi rõ override tạm thời.
- [x] Finalization tự reflow cue trước trong trần 1.80x khi khoảng bảo vệ làm candidate đã rút ngắn bị tràn; không cắt lời.

## 3. Phạm vi

Thay đổi trên checkout `F:\Son\tool\TediaPros`, branch `codex/measured-dubbing-first`. Checkout đã có nhiều thay đổi chưa commit khi bắt đầu; giữ nguyên công việc đó và chỉ bổ sung patch liên quan.

Không sửa giới hạn của provider, không bỏ kiểm tra nội dung, không cắt lời, không tự ý hủy queue đang chạy. Sau khi người dùng yêu cầu build/restart, dev app đã được khởi động lại để nạp bundle mới. Không commit/push.

## 4. Quyết định và lý do

- Trần 1.80x lấy từ `DUBBING_FIXED_MAX_TEMPO`, dùng chung với AutoShort và prompt. Preferred/normal pace vẫn 1.10x/1.25x. Thông báo lỗi lấy hằng số thay vì literal 1.45x.
- Prompt version tăng lên `translation-v7` để không dùng nhầm identity của prompt cũ.
- `TRANSLATION_BUDGET_LIMITS_ENABLED=false` tắt quota mặc định. Bộ đếm vẫn ghi lại; snapshot có `limitsEnforced=false`. Infinity chỉ dùng khi tính remaining time trong bộ nhớ, không ghi vào JSON.
- Giữ timeout từng request 180 giây, cancellation, tối đa 2 transport retries cho cùng request, 1 format repair cho cùng bộ ID và structural split hữu hạn. Các giới hạn này dừng provider không tiến triển, không phải tổng ngân sách dịch.
- Khi candidate rescue vẫn tràn vì cue trước đã chiếm khoảng lặng bảo vệ, finalization rút ngắn cue trước bằng DSP trong trần 1.80x, cập nhật lại clip/subtitle của cue trước và fit lại cue hiện tại. Nếu cue trước không đủ headroom, giữ lỗi policy có đầy đủ lời.
- Bounded mode vẫn được kiểm thử riêng qua tham số `enforceLimits=true` để dễ hoàn nguyên override sau này.
- Fixture overflow được tăng thời lượng để vẫn kiểm tra overflow/rephrase/split tại trần mới; không bỏ các assertion bảo toàn cue, lời hoặc timeline.

## 5. Tệp thay đổi của task này

- Runtime: `src/main/autoShortPolicy.ts`, `src/main/dubbing/policy.ts`, `src/main/dubbing/synthesis.ts`, `src/main/autoshort.ts`.
- Translation: `src/main/translation/budget.ts`, `src/main/translation/prompts.ts`, comment tại `src/main/translation/checkpoint.ts`.
- Tests: `tests/dubbing-plan.test.ts` (gồm regression finalization reflow cue-59/cue-60), `tests/dubbing-grouping.test.ts`, `tests/translation-budget.test.ts`, `tests/translation-orchestrator.test.ts`, `tests/translation-prompts.test.ts`, `tests/translation-identity.test.ts`, `tests/translation-rephrase.test.ts`.
- Docs: ADR 005, `docs/translation-budget-policy.md`, override đầu `AGENTS.md` và `src/main/dubbing/AGENTS.md`, bản ghi này.

## 6. Kiểm chứng và bằng chứng

- Trước patch: 4 test mới FAIL đúng nguyên nhân — normal/recovery quota, đo tempo 1.460x, trần còn 1.45x.
- `npm.cmd run typecheck`: PASS cả node và web.
- `node scripts/run-local-runtime-tests.mjs translation-budget.test dubbing-plan.test translation-prompts.test translation-orchestrator.test translation-rephrase.test dubbing-grouping.test`: 96/96 PASS.
- `node scripts/run-local-runtime-tests.mjs translation-identity.test translation-qualification.test`: 7/7 PASS, có offline matrix 244 cases.
- `npm.cmd run test:local-runtime` với TEMP/TMP trong workspace: 623/624 PASS, 0 skipped; 1 test STTN gặp EPERM tại rename checkpoint. Chạy lại riêng `sttn-pipeline.test`: 9/9 PASS, không sửa STTN. Không coi lần full run đó là một lượt 624/624 xanh.
- Chạy qualification với system TEMP ban đầu bị sandbox từ chối esbuild đọc ancestor `C:/Users/PC`; TEMP/TMP trong workspace khắc phục môi trường kiểm tra.
- `npm.cmd run build`: PASS main/preload/renderer; Vite có cảnh báo static/dynamic imports cùng module.
- `git diff --check`: PASS.
- Kiểm tra `out/main/index.js` xác nhận 1.8, budget flag=false và prompt=translation-v7 đã vào bundle.
- Regression `finalization reflows a fitting predecessor when a rescued cue needs the protected gap`: PASS; cue trước được nén trong trần 1.80x, khoảng bảo vệ và hardEnd vẫn hợp lệ.
- Sau regression patch: `npm run build` PASS (`out/main/index.js` 960.38 kB); dev server `http://localhost:5173/` trả HTTP 200, cửa sổ Electron `TediaPros` phản hồi, GPU NVIDIA GeForce GTX 1660 SUPER/CUDA 13.2 được nhận diện. Process hiện tại được xác nhận sau lần restart cuối.

Giới hạn bằng chứng: các test dùng adapter fixture, chưa xác nhận chất lượng giọng ở 1.80x hoặc chạy lại các video/provider trong báo cáo lỗi. Trần mới vẫn có thể từ chối audio dài hơn khả năng fit ở 1.80x; provider trả lỗi/không đủ bản dịch vẫn có thể cần review.

## 7. Bàn giao

Khởi động lại ứng dụng để nạp bundle mới, rồi thử lại item lỗi. Item `needs-review` không tự chạy lại. Log test lưu tạm tại `%TEMP%\tediapros-tempo-budget-final.log` và `%TEMP%\tediapros-tempo-budget-sttn-rerun.log`.
