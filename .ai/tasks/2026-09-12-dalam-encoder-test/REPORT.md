# Kiểm thử xuất video dalam — 2026-09-12

## Kết luận

TEST_CONFIRMED: FFmpeg đang được ứng dụng Win Local sử dụng không tương thích với NVENC API mà driver hiện tại cung cấp. Khi thử cả hai video thật, encoder lỗi ngay với:

```text
Driver does not support the required nvenc API version. Required: 13.1 Found: 13.0
The minimum required Nvidia driver for nvenc is 610.00 or newer
```

Đây là yêu cầu do binary báo, không phải xác nhận driver 610 hiện có sẵn hay khuyến nghị cài phiên bản đó. `nvidia-smi` đọc được GTX 1660 SUPER, driver 595.79. Lệnh FFmpeg thực tế của app lúc kiểm tra dùng `libx264 -preset medium -crf 20`; Video Encode đọc được 0% tại thời điểm lấy mẫu.

Hai FFmpeg cùng tồn tại trong profile:

| Vai trò | Đường dẫn dưới `%APPDATA%/tedia-pros/bin` | Phiên bản | NVENC trên 2 nguồn |
|---|---|---|---|
| Đang được app gọi | `ffmpeg/ffmpeg.exe` | n9.0.1-11-ge47273f4d9-20260829 | Lỗi API 13.1/13.0 |
| Bản khác đã có trên máy | `ffmpeg.exe` | 2026-05-18-git-b4d11dffbf-full_build-www.gyan.dev | Thành công |

Điều này giải thích vì sao probe cũ thành công nhưng ứng dụng hiện tại vẫn dùng CPU: probe và app gọi hai binary khác nhau. SHA-256 và phiên bản được lưu trong `binaries.json`.

## Đầu vào và phạm vi

Thư mục `F:/Son/doyuin/LauHaiSan/dalam` có 2 video:

- `2025-04-08_大海退潮啦，海鲜就要现抓现吃_赶海_7490882160954461476.mp4`: 131,007 giây.
- `2025-04-18_真正的海底捞自助，就要现抓现吃_赶海_7494584044865260852.mp4`: 169,111 giây.

Cả hai là H.264 yuv420p, 1080×1920, 30 fps, SAR 1:1. Mỗi lượt test dùng 10 giây đầu, copy audio gốc. Có 8 lượt: NVENC trên binary active, NVENC thuần trên binary còn lại, NVENC có filter, libx264 có filter, lặp trên hai nguồn.

Filter kiểm thử gồm planar RGB `gbrp`, Gaussian blur sigma 64 / steps 6, maskedmerge với mask chữ nhật mô phỏng, zoom 110%, brightness 0.11, saturation 1.6, contrast 1, phụ đề ASS mẫu, scale 1080×1920. Các thông số zoom/màu lấy từ lệnh job khác đang chạy; không khẳng định đó là cấu hình riêng của hai nguồn được giao. Mask không phải OCR thực, phụ đề không phải bản dịch của nguồn.

CODE_CONFIRMED: `portraitFrame.ts` bỏ qua nhánh nền mờ khi nguồn đã vừa khít 1080×1920. Vì vậy nguồn 9:16 này không phát sinh thêm blur nền; nhận định trước rằng bật 9:16 luôn tạo thêm nền mờ cần được giới hạn theo tỷ lệ nguồn.

## Số đo

| Video | NVENC thuần | NVENC có filter | libx264 có filter | CPU trung bình NVENC có filter | CPU trung bình libx264 |
|---|---:|---:|---:|---:|---:|
| 2025-04-08 | 1,111 s | 6,714 s | 12,510 s | 40,5% | 68,7% |
| 2025-04-18 | 1,180 s | 7,280 s | 14,129 s | 42,0% | 67,9% |

CPU trung bình được ước tính từ FFmpeg `-benchmark`: `(utime + stime) / thời gian tường / 12 logical CPUs`. Đây là CPU của tiến trình test, không phải tổng tải máy hoặc số đo Task Manager trực tiếp. NVENC có filter nhanh hơn khoảng 1,86–1,94 lần trong phép thử này.

Giới hạn: máy có job app khác chạy nền; hai encoder thuộc hai build FFmpeg, dùng CQ 23 và CRF 20 theo ứng dụng, chưa chuẩn hóa chất lượng perceptual. Đây là so sánh hai lựa chọn thực tế trên máy, không phải benchmark cô lập encoder hay cam kết tăng tốc toàn bộ AutoShort.

## Kiểm chứng

- 2/2 lượt NVENC binary active: tái hiện lỗi API, không có video hợp lệ.
- 6/6 lượt còn lại: exit 0, ffprobe đọc được H.264 1080×1920 và metadata encoder đúng.
- 6/6 file thành công decode hết video/audio bằng FFmpeg: exit 0, không có lỗi (`decode-verification.json`).
- `npm.cmd run typecheck`: node/web PASS, exit 0.
- Script tái hiện: `node .ai/tasks/2026-09-12-dalam-encoder-test/benchmark.cjs`. Script từ chối ghi đè thành phẩm; muốn chạy lại cần thư mục test mới hoặc lưu trữ các thành phẩm cũ trước.
- `results.json` lưu toàn bộ tham số, thời gian, stderr lỗi và metadata output. Từng lượt có `.log` riêng và file video test tương ứng.

## Hướng xử lý tiếp

Chọn runtime FFmpeg hỗ trợ NVENC API hiện có, đồng thời phải qua kiểm tra chức năng OCR maskedmerge/âm thanh và checksum của dự án trước khi thay runtime chính thức. Cần kiểm tra encoder với binary được resolver chọn thực tế, không chỉ một `ffmpeg.exe` trùng tên. Giữ chẩn đoán từng lần thử để người dùng biết khi app chuyển sang CPU.

Task này chỉ thử nghiệm: không đổi runtime ứng dụng, driver, cấu hình queue, video nguồn hoặc code sản phẩm; không dừng job đang chạy. Chưa kiểm tra toàn bộ pipeline OCR, dịch, TTS, retiming, chất lượng blur thực tế hoặc chạy hết hai video.
