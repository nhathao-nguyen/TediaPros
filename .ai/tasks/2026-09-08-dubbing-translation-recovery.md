# TTS-RECOVERY: Sửa phục hồi dịch và sai số tempo

- **Trạng thái:** Đã kiểm chứng local; chưa nghiệm thu media thật
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-08

## 1. Mục tiêu
Điều tra lỗi measured tempo 1.818x, cue cần 2.282x và phản hồi dịch sai định dạng sau override 1.80x/unlimited quota.

## 2. Tiêu chuẩn nghiệm thu
- [x] DSP undershoot được hiệu chỉnh từ WAV gốc, vẫn kiểm tra deadline và tempo.
- [x] Batch lỗi có thể tách mọi nhánh đến singleton khi quota tắt.
- [x] Format repair dùng parser feedback và task repair ở ba adapter.
- [x] Typecheck node/web pass.
- [x] Toàn bộ test translation*.test.ts và dubbing*.test.ts pass.
- [ ] Chạy lại các video lỗi với provider thật.
- [ ] Chốt policy khi lời không thể fit ở 1.80x.

## 3. Phạm vi
Đọc luồng orchestrator/budget/planner/parser/prompts, adapter Local/OpenAI/Gemini, dubbing synthesis và đường DSP/stitch trong autoshort. Đây là rà soát luồng lỗi, không khẳng định đọc mọi dòng toàn repository. Bảo toàn các thay đổi có sẵn.

## 4. Quyết định
Tách batch theo số cue giảm dần thay vì chặn bởi độ sâu dùng chung giữa nhánh. Giữ stop khi singleton không tiến triển và cancellation. Hiệu chỉnh DSP hữu hạn theo số đo, không pad hoặc cắt để che lỗi. Thời lượng nguồn còn cố định; yêu cầu chọn kéo dài hình đang chờ trả lời.

## 5. Tệp thay đổi trong lượt này
src/main/translation/{budget,planner,prompts,orchestrator}.ts; src/main/{localTranslate,openai,gemini}.ts; src/main/dubbing/synthesis.ts; tests/{translation-orchestrator,dubbing-plan}.test.ts; docs/translation-budget-policy.md; docs/adr/005-source-anchored-dubbing-tempo-policy.md.

## 6. Kiểm chứng
`npm run typecheck`: PASS. `node scripts/run-local-runtime-tests.mjs` với danh sách basename thực của tests/translation*.test.ts và tests/dubbing*.test.ts: PASS. Hai regression split và DSP đã fail trước bản sửa và pass sau sửa. Lệnh dùng tên rút gọn `translation dubbing` bị runner từ chối; đã chạy lại bằng tên test đầy đủ. Provider thật và các video lỗi chưa rerun.

## 7. Bàn giao kiến trúc
Build mặc định đã tạo main/preload nhưng renderer gặp EPERM tại out/renderer/assets. Build đầy đủ ra thư mục riêng bằng `npm run build -- --outDir out-codex-recovery-20260908` PASS. `git diff --check` PASS. Chưa khởi động lại app bằng artifact mới trong lượt này.

Muốn loại bỏ thiếu thời gian cần scheduler output độc lập source ledger: đo WAV trước, phân bổ cửa sổ output tối thiểu naturalDuration/1.80 và khoảng nghỉ, sinh time map rồi áp dụng cùng map cho hình/audio nền/phụ đề/OCR và validation. Không thể chỉ kéo dài WAV vì stitch hiện giới hạn ở thời lượng video. Chưa triển khai khi người dùng chưa chọn thay đổi thời lượng hình. Lỗi mạng, model hoặc media hỏng vẫn cần trạng thái phục hồi/review, không được giả thành render thành công.
