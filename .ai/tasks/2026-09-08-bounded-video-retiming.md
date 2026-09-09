# TTS-RETIME: Kéo dài hình cục bộ tối đa 40%

- **Trạng thái:** Đã triển khai, kiểm chứng local; chưa nghiệm thu batch thật
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-08

## 1. Mục tiêu
Thực hiện chấp thuận của người dùng: sau rescue TTS, được kéo dài hình khoảng 30–40% trở xuống, giữ đủ lời và max tempo 1.80x.

## 2. Tiêu chuẩn nghiệm thu
- [x] Kéo dài đúng phần thiếu, tối đa 40% từng đoạn và tổng video.
- [x] Giữ đoạn không thiếu thời gian, cue ID, lời đầy đủ và khoảng nghỉ.
- [x] Cùng map áp dụng hình, OCR mask, audio nguồn, nền đã tách, phụ đề và output validation.
- [x] Lưu source ledger gốc cùng map để audit.
- [x] Test hồi quy và FFmpeg thật.
- [ ] Nghiệm thu các video lỗi với provider thật.

## 3. Phạm vi
Module mới dubbing/timeMap.ts và retimeMedia.ts; tích hợp synthesis.ts, autoshort.ts, autoShortItemCoordinator.ts. Tests dubbing-plan.test.ts, dubbing-retime.test.ts và registry. ADR 005 cập nhật override. Bảo toàn các thay đổi dirty có sẵn.

## 4. Quyết định
Lập map sau khi đo và rescue để dùng lượng kéo dài tối thiểu. Trần 40% theo từng khoảng speech-unit start đến start kế tiếp, không cộng dồn nhiều lần. Giữ nhóm trước khi split để tránh thêm protected gap vô ích. Không thể fit ngoài giới hạn thì báo lỗi định lượng.

## 5. Thay đổi
FFmpeg encode đoạn hình theo PTS map, source audio theo segmented atempo/concat. Mask dùng cùng map. Nền ngoài không đổi tốc độ. Stitch/mix/render dùng output duration. Artifact phân biệt tọa độ output và source ledger bất biến. Có kiểm tra dung lượng, kích thước tối đa và hủy process tree.

## 6. Kiểm chứng
Typecheck node/web PASS. Các suite translation/dubbing, publication timeline, TTS cache/pipeline, disk budget, OCR burn, stage scheduling và lifecycle đã pass; log tại 2026-09-08-retiming-tests.log. Sau điều chỉnh thứ tự group/split, dubbing-plan 41/41 PASS (2026-09-08-retiming-plan-tests.log). Test FFmpeg thật dùng TEDIAPROS_RETIME_TEST_FFMPEG và TEDIAPROS_RETIME_TEST_FFPROBE trỏ binary runtime hiện có, kiểm tra duration, pixel chuyển cảnh và PCM chuyển từ im lặng sang tiếng ở mốc mới. Không có network TTS trong fixture này.

## 7. Bàn giao
Kiểm tra cuối: `npm run typecheck` PASS; `dubbing-plan`, `dubbing-retime` (FFmpeg thật), `dubbing-grouping`, `autoshort-tts-pipeline` PASS sau thay đổi cuối (2026-09-08-retiming-final-tests.log). `npm run build -- --outDir out-codex-retiming-20260908` PASS cả main/preload/renderer; log 2026-09-08-retiming-build.log. `git diff --check` PASS. Build tách thư mục vì out/renderer/assets trước đó bị EPERM; không thay đổi tiến trình app hiện tại.

Queue app hiện tại đang chạy TTS bằng code đã nạp trước đó; không ngắt queue để khởi động lại. Bản mới cần restart khi queue dừng và thử lại item lỗi. Có một lần encode hình bổ sung khi retime, tăng thời gian và dung lượng tạm. Trường hợp vượt 40% vẫn báo lỗi có cue ID; không hứa tất cả đầu vào thành công.
