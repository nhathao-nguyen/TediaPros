# Ảnh và chữ xuyên suốt video AutoShort

## Cách dùng

Trong AutoShort, bấm **Ảnh / Chữ** ở thanh trên khung xem trước.

- **Ảnh / Logo:** chọn một ảnh PNG hoặc JPG (tối đa 20 MB), chỉnh vị trí ngang/dọc, chiều rộng tối đa và độ đậm. PNG giữ nền trong suốt. Ảnh giữ tỷ lệ, chiều cao không vượt quá 80% khung xuất.
- **Chữ cố định:** bật chữ, nhập tối đa 120 ký tự trên một dòng, chỉnh vị trí, cỡ chữ, màu và độ đậm. Chữ dùng font đang chọn ở tab Phụ đề; khi chọn tự động, font được chọn theo ngôn ngữ của chính chữ chèn. Có viền đen để dễ đọc. Chữ dài tự thu nhỏ để vừa khung.
- Có thể dùng riêng ảnh, riêng chữ hoặc cả hai. **Bỏ ảnh**, tắt chữ hoặc **Bỏ toàn bộ ảnh/chữ** để gỡ. Cấu hình được lưu trên máy và dùng chung cho mọi video trong batch.
- Vị trí ngang/dọc chạy từ 0% tới 100% phần không gian còn lại của khung: 0% sát trái/trên, 50% ở giữa, 100% sát phải/dưới. Khi bật nền mờ 9:16, vị trí tính trên toàn bộ khung 1080×1920, bao gồm phần nền trống.

Chữ/ảnh hiển thị từ đầu đến hết thời lượng đầu ra thực tế, kể cả khi AutoShort đã cắt đoạn hoặc điều chỉnh thời gian hình cho lồng tiếng. Chúng được ghép ở bước render cuối và không bị ảnh hưởng bởi zoom, chỉnh màu hoặc làm mờ OCR của video nguồn. Ảnh nằm dưới chữ; cả hai nằm trên phụ đề. Người dùng cần chọn vị trí tránh che nội dung cần đọc.

## Hợp đồng và xử lý

- `AutoShortConfig.overlays` là tùy chọn; cấu hình cũ hoặc cấu hình rỗng không thêm trường vào config đã chuẩn hóa để giữ tương thích batch digest.
- `src/shared/autoShortOverlays.ts` xác thực dữ liệu và tính hình học. Đây là tọa độ trên **khung đầu ra**, khác với các ROI OCR/phụ đề đang tính theo video nguồn.
- `autoshort:chooseOverlayImage` trả kết quả typed qua preload. Main kiểm tra file thông thường, containment, định dạng PNG/JPG và giới hạn dung lượng; không nhận URL hoặc đường dẫn traversal. SHA-256 được ghi trong config, kiểm tra trước preflight và trước render. Nếu file bị thay đổi hoặc mất, báo lỗi để chọn lại.
- Mỗi lượt render sao chép bytes ảnh đã kiểm tra vào thư mục scratch riêng. FFmpeg nhận ảnh sau source/audio/mask; `overlay` lặp khung ảnh cuối, giữ thời điểm kết thúc theo video chính. Không tạo một stream ảnh lặp vô hạn hoặc thêm một lần mã hóa video sau AutoShort.
- Chữ dùng một ASS riêng với PlayRes bằng kích thước khung cuối và sự kiện phủ toàn bộ thời lượng video. Ký tự người dùng được xử lý như nội dung literal, không chạy lệnh ASS. File font được xác minh bằng cơ chế font hiện có.
- Quy đổi cỡ chữ CSS em sang ASS dựa trên OS/2 Win ascent/descent của font. Nếu bỏ quy đổi, Noto Sans xuất nhỏ hơn bản xem trước. Tham chiếu: [libass ass_font.c, set_font_metrics và ass_face_set_size](https://github.com/libass/libass/blob/master/libass/ass_font.c).
- File ảnh và ASS tạm được dọn trong `finally`; ảnh gốc không bị sửa. Hủy tác vụ dùng render/process-tree lifecycle hiện có.
- Thay đổi thuộc AutoShort. Video Editor không nhận tùy chọn ảnh/chữ này.

## Phạm vi bản đầu

Một ảnh tĩnh PNG/JPG và một dòng chữ cố định. Chưa có nhiều lớp, ảnh động, kéo/thả trực tiếp, lịch xuất hiện theo đoạn, nội dung chữ riêng từng video hoặc nhập template CapCut. Font fallback và raster hóa có thể lệch nhẹ giữa bản xem trước và FFmpeg.

## Kiểm chứng

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-overlays.test
node scripts/smoke-autoshort-overlays-ui.mjs
npm.cmd run build
```

Kiểm thử media dùng FFmpeg thực: khung đầu/cuối, thời lượng, audio, PNG alpha × opacity, chữ tiếng Việt và ký tự đặc biệt, độ rộng glyph Noto Sans, phối hợp OCR mask + narration + khung 9:16, file ảnh bị thay đổi, legacy config và hủy trước render. Có thể đặt `TEDIAPROS_TEST_FFMPEG` để chỉ định FFmpeg khi runtime mặc định không có.

Smoke UI mở phiên Electron ẩn với profile tạm, render các component thật, dùng font bundled và CSP của ứng dụng. Nút chọn ảnh/font được cấp dữ liệu fixture; kiểm thử này không thao tác hộp chọn file hệ điều hành của app người dùng và không chạy toàn bộ pipeline OCR/TTS live.
