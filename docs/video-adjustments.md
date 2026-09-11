# Chỉnh hình ảnh khi xuất Auto Short

Trong **Auto Short**, bấm **Chỉnh hình ảnh** cạnh nút **9:16 · Nền mờ** để mở bảng điều chỉnh. Các thay đổi xuất hiện ngay trên bản xem trước và được áp dụng cho toàn bộ batch bắt đầu sau đó.

| Thông số | Khoảng | Mặc định |
| --- | ---: | ---: |
| Zoom | 100–120% | 100% |
| Độ sáng | -20 đến +20 | 0 |
| Độ bão hòa | 0–200% | 100% |
| Tương phản | 50–150% | 100% |

Zoom cắt đều từ tâm và giữ nguyên kích thước video đầu ra. **Đặt lại** đưa cả bốn thông số về mặc định. Cấu hình được lưu riêng cho Auto Short; các batch đang chạy giữ snapshot cấu hình lúc bắt đầu và khóa bảng điều chỉnh.

Ô số cho phép nhập trọn giá trị, gồm số âm của độ sáng. Nhấn Enter hoặc rời ô để xác nhận; Escape hủy giá trị đang nhập dở. Bảng tự đặt lại vị trí khi đổi kích thước cửa sổ để toàn bộ điều khiển luôn nằm trong vùng nhìn thấy.

Màu trong preview trình duyệt có thể chênh nhẹ với FFmpeg. Video xuất là kết quả chính xác. Chức năng này không thay đổi tốc độ, âm thanh, cue ID hay timestamp phụ đề.

## Thứ tự xử lý

FFmpeg thực hiện theo thứ tự: chuẩn hóa display geometry → che hoặc xóa chữ nguồn → zoom và chỉnh màu → chèn phụ đề mới → ghép khung 9:16 nếu bật → mã hóa.

Vì vùng OCR và vùng blur được xử lý trong tọa độ nguồn trước bước zoom, mask không bị lệch. Preview phóng tọa độ các vùng nguồn theo cùng tỷ lệ và quy đổi ngược thao tác kéo; khung phụ đề không bị zoom hoặc đổi màu.

## Hợp đồng kỹ thuật

- `VideoAdjustments` gồm `zoom`, `brightness`, `saturation`, `contrast`.
- `AutoShortConfig.videoAdjustments` và `BurnReq.videoAdjustments` là tùy chọn để tương thích cấu hình cũ; thiếu trường dùng `{ zoom: 100, brightness: 0, saturation: 100, contrast: 100 }`.
- Main chỉ nhận số hữu hạn trong giới hạn công khai và tự dựng filter; renderer không thể gửi chuỗi FFmpeg tùy ý.
- Giá trị mặc định không thêm filter. Khi có thay đổi, zoom dùng crop tâm rồi scale về kích thước nguồn; màu dùng FFmpeg `eq`.
- Chế độ phụ đề mềm từ chối chỉnh hình ảnh vì không có bước mã hóa video.

## Kiểm chứng

Chạy từ thư mục gốc:

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs video-adjustments.test autoshort-ocr-contract.test portrait-blur.test canonical-display-geometry.test autoshort-ocr-burn.test autoshort-ocr-pipeline.test autoshort-ui-contract.test
node scripts/test-video-adjustments-preview.mjs docs/reviews/2026-09-11-video-adjustments
npm.cmd run test:subtitles
npm.cmd run build
git diff --check
```
