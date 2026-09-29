# Hiệu ứng video AutoShort

Trong **AutoShort**, bấm **Hiệu ứng** trên thanh phía trên khung xem trước.

- **Nhiễu hạt:** hạt sáng/tối chuyển động như chất phim.
- **Bụi phim:** đốm bụi sáng thay đổi theo từng khung hình.
- **Nhiễu analog:** nhiễu màu, lệch màu nhẹ và sọc quét ngang.

Bấm thẻ để bật/tắt từng kiểu. Có thể bật cả ba, chỉnh **Cường độ** từ 1–100%, dùng **Áp dụng trước** để đổi thứ tự, **Bỏ lớp** để gỡ một lớp hoặc **Tắt toàn bộ hiệu ứng**. Cấu hình lưu trên máy và áp dụng cho toàn bộ video trong batch. Khi batch đang chạy, bảng bị khóa.

Xem trước bằng canvas là mô phỏng gần đúng, chuyển động theo video và đứng yên khi tạm dừng. Mở video đã xuất để xem kết quả FFmpeg đầy đủ. Hiệu ứng phủ suốt thời lượng đầu ra sau cắt/retime, trên cả khung 9:16 và phụ đề. Ảnh/logo và chữ cố định nằm trên hiệu ứng.

## Phạm vi

Ba hiệu ứng dựng sẵn chạy offline, tự sinh bằng FFmpeg. Đây là các kiểu hiệu ứng tương tự nhóm noise trong ảnh tham chiếu; không sử dụng tài nguyên hoặc preset CapCut. Bản này chưa có lịch xuất hiện theo đoạn, keyframe, nhập video texture hay thư viện hiệu ứng của CapCut. Chỉ có trong AutoShort.

## Xử lý

- `AutoShortConfig.videoEffects` là mảng có thứ tự, tối đa ba phần tử `{ kind, intensity }`. Mỗi kiểu xuất hiện một lần. `normalizeVideoEffects` dùng chung giữa Main và Renderer; từ chối kiểu lạ, trùng kiểu, số không hữu hạn và cường độ ngoài 0–100.
- Config cũ/không có hiệu ứng không thêm trường mới. Mảng rỗng và các lớp 0% được loại khi chuẩn hóa, giữ tương thích cấu hình cũ.
- `autoShortItemCoordinator` chuyển hiệu ứng vào `burnAutoShort`, rồi `runBurnSubtitleLower`. Cả render làm mờ thủ công và OCR tự động đều ghép hiệu ứng sau phụ đề/khung chân dung, trước ảnh/chữ cố định.
- `src/main/videoEffects.ts` chỉ xây graph từ preset và số đã kiểm tra; không nhận chuỗi filter từ người dùng. Grain dùng `noise`; bụi dùng texture luma nhỏ sinh bằng `geq` rồi `blend`; analog dùng `noise`, `chromashift`, `drawgrid`. Tham chiếu [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html).
- Mọi nhánh lấy frame/PTS từ video chính; không thêm input lặp vô hạn, không render lại lượt thứ hai, không tạo video texture tạm. Không thay đổi mapping audio, frame count hoặc thời lượng. Hủy tác vụ dùng lifecycle/process-tree hiện có.
- OCR vẫn dùng planar RGB trước `maskedmerge`. Chuyển đổi pixel format cho hiệu ứng diễn ra sau khi ghép mask.
- Sửa nhánh làm mờ thủ công để luôn đi qua bước hoàn thiện video; trước đây khi không có phụ đề/9:16/chỉnh màu, nhánh này có thể bỏ qua ảnh/chữ cố định.

## Kiểm chứng

```powershell
$env:TEDIAPROS_TEST_FFMPEG = Join-Path $env:APPDATA 'tedia-pros\bin\ffmpeg.exe'
node scripts/run-local-runtime-tests.mjs video-effects.test autoshort-overlays.test autoshort-ocr-burn.test video-adjustments.test portrait-blur.test autoshort-ocr-pipeline.test
node scripts/smoke-video-effects-ui.mjs
npm.cmd run typecheck
npm.cmd run build
```

Test media kiểm tra từng hiệu ứng trên khung đầu/cuối, chuyển động, tính xác định, số khung, render nhiều lớp với âm thanh/làm mờ thủ công, OCR + 9:16 + branding, dọn scratch và hủy trước render. Smoke UI dùng component thật trong Electron ẩn/profile tạm, kiểm tra chọn nhiều lớp, cường độ, thứ tự, preview, gỡ/tắt và khóa khi chạy. Đây là bằng chứng local; không thay thế kiểm tra installer hoặc batch dịch/TTS live.
