# Khung 9:16 với nền video làm mờ

Trong **Auto Short** hoặc **Video Editor**, bấm **9:16 · Nền mờ** ở thanh trên bản xem trước. Dấu ✓ cho biết chức năng đang bật. Bấm lại để trở về khung hình gốc. Tùy chọn được lưu riêng cho mỗi màn hình, mặc định tắt với cấu hình chưa có trường này. Trong Auto Short, tùy chọn áp dụng cho toàn bộ batch tiếp theo.

Khi bật, video xuất có kích thước **1080×1920**, pixel vuông, tỷ lệ **9:16**. Hình chính nằm giữa, được thu/phóng để giữ đủ nội dung nguồn; phần trống phía trên/dưới hoặc hai bên dùng video phóng lớn và làm mờ. Video đã đúng 9:16 lấp đầy canvas, không cần nền bổ sung. Video nhỏ vẫn được nâng lên kích thước đầu ra này; chức năng không tạo thêm chi tiết hình ảnh.

Preview dùng cùng phép tính kích thước/vị trí hình chính với bản xuất. Nền lấy từ frame của chính video đang phát, đồng bộ khi tua, dừng hoặc đổi tốc độ. Cỡ chữ preview trong chế độ này thu nhỏ theo hình chính. Có thể chỉ bật 9:16 để xuất trong Video Editor mà không thêm phụ đề, vùng làm mờ hoặc âm thanh mới.

## Hợp đồng kỹ thuật

- `BurnReq.portraitBlur?: boolean` và `AutoShortConfig.portraitBlur?: boolean`; `undefined`/`false` giữ hành vi cũ. IPC từ chối giá trị không phải boolean, trừ null tương thích trường tùy chọn hiện hành.
- `src/shared/portraitFrame.ts` quyết định canvas và vùng hình chính. Kích thước hình chính làm tròn xuống số chẵn cho codec; có sai số lượng tử tối đa dưới 2 pixel mỗi chiều so với phép fit lý tưởng.
- OCR, vùng làm mờ thủ công và ASS vẫn dùng tọa độ của video nguồn đã chuẩn hóa display geometry. Main xử lý mask/blur trước, chia nền và hình chính, thêm phụ đề lên hình chính, rồi scale/composite vào canvas cuối. Mask OCR vẫn chạy trên `gbrp`.
- Preview giữ video và `RegionBox` trong vùng hình chính; canvas nền không tạo player hoặc audio thứ hai. Frame callback và listener được dọn khi tắt, đổi nguồn hoặc unmount.
- Preview CSS blur và FFmpeg Gaussian blur là hai bộ render khác nhau, có thể khác nhẹ ở độ mềm/viền nền. Vị trí và kích thước hình chính được chia sẻ; không coi ảnh preview là so sánh pixel tuyệt đối với FFmpeg.
- UI luôn gửi chế độ `burn`. Ghép phụ đề mềm (`soft`) không hỗ trợ tùy chọn này và bị từ chối; không âm thầm bỏ qua việc đổi khung.
- Không đổi thời lượng, timestamp phụ đề, cue ID, chính sách dubbing, âm lượng hoặc nguồn âm thanh. Xử lý cuối vẫn đi qua cancellation, kiểm tra output và cleanup hiện hữu.

## Kiểm chứng

Lệnh chạy từ gốc repo:

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:local-runtime -- portrait-blur.test autoshort-ocr-contract.test canonical-display-geometry.test autoshort-ocr-burn.test autoshort-ocr-pipeline.test autoshort-ui-contract.test
node scripts/test-portrait-preview.mjs
# Chỉ bổ sung PATH trong process kiểm thử nếu FFmpeg chưa có trên PATH:
$env:PATH = (Join-Path $env:APPDATA 'tedia-pros\bin\ffmpeg') + ';' + $env:PATH
npm.cmd run test:subtitles
```

Test media dùng runtime FFmpeg được quản lý hoặc đường dẫn `TEDIAPROS_TEST_FFMPEG` / `TEDIAPROS_TEST_FFPROBE`. Nếu runtime không có trên CI, test media ghi rõ SKIP; test hình học và hợp đồng vẫn chạy. Script UI là acceptance riêng, cần Electron và FFmpeg; dùng profile tạm cùng IPC giả lập, không tải profile người dùng.

Bằng chứng local: [thư mục kiểm chứng](reviews/2026-09-10-portrait-blur/), gồm log typecheck/build/runtime/subtitle, JSON kết quả UI và ảnh hai màn hình. Chưa đóng gói bộ cài mới, chưa thực hiện batch media của người dùng hoặc xác nhận macOS/live provider.
