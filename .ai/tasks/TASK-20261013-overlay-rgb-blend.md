# TASK-20261013: Sửa lớp trắng đục khi xuất hiệu ứng Screen

- **Trạng thái:** Đã kiểm chứng local
- **Người thực hiện:** Codex
- **Thời gian:** 2026-10-13

## 1. Mục tiêu

Người dùng báo hiệu ứng **Nhiễu 2** làm video có lớp trắng đục, rõ hơn ở video xuất ra. Kiểm tra sự khác nhau giữa preview RGB và export YUV, sửa nguyên nhân nâng vùng tối ngoài ý muốn.

## 2. Tiêu chuẩn nghiệm thu

- [x] Texture Screen màu đen không nâng sáng nguồn; Multiply màu trắng không đổi màu nguồn.
- [x] Kiểm tra phép ghép từng kênh trên nguồn/texture có màu và nhiều cường độ.
- [x] Render qua `burnAutoShort` với texture Nhiễu 2 thật, giữ chuyển động, 36 frames, 3 giây, audio, giải mã hoàn toàn và dọn scratch.
- [x] Typecheck và các bộ test liên quan pass.
- [x] Tài liệu và bằng chứng local được lưu.

## 3. Phạm vi

Sửa các nhánh video texture Screen/Multiply và film_grunge trong compositor FFmpeg. Giữ graph hiện có, lifecycle, mapping audio và cấu hình IPC. Không đổi bitrate, sharpen, scanner hoặc bản cài đặt của người dùng.

## 4. Quyết định và lý do

Screen trực tiếp trên luma YUV limited-range coi mã đen 16 là thành phần sáng. Với nguồn RGB đã giải mã 31 và texture đen, nhánh cũ tạo mức sáng 43 ở cường độ 75%. Chuyển cả nguồn và texture sang `gbrp`, ghép Screen/Multiply theo từng kênh RGB, để encoder chuyển về YUV ở đầu ra. Không áp dụng thay đổi này lên texture bụi thủ tục vốn sinh luma 0 làm phần tử trung tính.

## 5. Tệp thay đổi

- `src/main/videoEffects.ts`: ghép texture trong RGB.
- `tests/video-effects.test.ts`: regression trên pixel và frame count.
- `docs/autoshort-video-effects.md`: nguyên nhân, cách xử lý và phạm vi còn hạn chế.
- `.ai/tasks/2026-10-13-overlay-rgb-blend/verify.mjs`: phép kiểm chứng có thể chạy lại với tài nguyên thực tế.
- `.ai/tasks/2026-10-13-overlay-rgb-blend/proof.json`, `comparison.png`, `before.mp4`, `after.mp4`: kết quả local (MP4 được gitignore).

## 6. Kiểm chứng

Các lệnh chạy từ repo root:

```powershell
$env:TEDIAPROS_TEST_FFMPEG = (Get-Command ffmpeg).Source
node scripts/run-local-runtime-tests.mjs video-effects.test autoshort-overlays.test autoshort-ocr-burn.test video-adjustments.test portrait-blur.test autoshort-ocr-pipeline.test
npm.cmd run typecheck
node .ai/tasks/2026-10-13-overlay-rgb-blend/verify.mjs
git diff --check
```

Tất cả các lệnh cuối cùng exit 0. Bộ video-effects có 18 pass, 0 fail, 1 skip (integration BurstingSmoke cần biến môi trường asset riêng). Regression mới kiểm tra cả màu tối, nguồn có màu, Screen/Multiply, cường độ và film_grunge.

Đối chiếu real asset trên nguồn mẫu màu sinh bằng FFmpeg: mức sáng trung bình vùng tối **nguồn 31 / trước sửa 43 / sau sửa 31**. Video sau sửa 360×640, 3 giây, 36 frames, có âm thanh và hiệu ứng chuyển động; toàn bộ video giải mã thành công. [Phép đo](2026-10-13-overlay-rgb-blend/proof.json). [Ảnh: nguồn / trước sửa / sau sửa](2026-10-13-overlay-rgb-blend/comparison.png).

Harness được sửa để cho phép thư mục log của ứng dụng, xuất vào scope tạm cho phép chạy lại và bỏ drawtext mặc định gây lỗi Fontconfig trên host. Không có thay đổi ứng dụng phát sinh từ các lỗi harness này.

## 7. Bàn giao và giới hạn

Đã sửa và kiểm chứng source local; chưa build installer, cài đặt hoặc đăng Facebook, chưa đối chiếu video gốc/đầu ra của người dùng. Nguồn kiểm chứng là bảng màu tổng hợp, texture là Nhiễu 2 thực tế trong cache TediaPros dev.

Gói CapCut effect `7399469641170554117` có shader pass1 Screen và pass2 Multiply (a0..a27 và b0). Scanner hiện chỉ chuyển nhóm a sang loop, nên hiệu ứng chưa tương đương đầy đủ CapCut. Hỗ trợ đủ các pass/alpha/timing cần task riêng. Preview Multiply đang mô phỏng qua CSS, chưa được đồng nhất trong thay đổi này.
