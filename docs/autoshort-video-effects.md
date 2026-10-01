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

### Hiệu ứng CapCut có nền màu

Video MP4 bên trong một gói CapCut có thể là nguyên liệu có nền xanh, chưa phải overlay trong suốt. Scanner đọc các literal `LumiChromaKey` trong `AmazingFeature/lua/LumiFamily/LumiExportData.lua`, không thực thi Lua. Nếu có một màu key đang bật và không có matte riêng, hiệu ứng được gán **Tách nền màu** cùng `chromaKey: { color, similarity, blend }`; không mặc định ghép tài nguyên đó bằng Screen. Các gói có nhiều màu key khác nhau cần hỗ trợ shader graph riêng và không được suy đoán tự động.

Preview tách nền bằng canvas RGBA, khử màu xanh/lam dư và giữ alpha của viền khói. FFmpeg dùng [colorkey](https://ffmpeg.org/ffmpeg-filters.html#colorkey) và [despill](https://ffmpeg.org/ffmpeg-filters.html#despill) trong graph hiện có, rồi nhân alpha theo cường độ. Đầu ra dừng cùng video chính; không cần chuyển asset sang WebM, tạo một lượt encode trung gian hoặc thêm scratch video. Mô hình RGB dùng chung được kiểm tra độ khớp với FFmpeg trên các pixel đã giải mã.

Kho lưu giữ cả thông số key trong `metadata.json`. Cấu hình CapCut/kho đã lưu từ trước được khôi phục khi preview hoặc render. Khi thông số key của một mục kho cũ được tìm thấy trong cache gốc, metadata được ghi lại qua file tạm rồi rename, để lần dùng sau không phụ thuộc cache CapCut. Các tài nguyên được kiểm tra containment trước khi đọc/copy; thumbnail tùy chọn bị thiếu không làm mất video trong danh sách.

Đây là cách ghép phần video nguyên liệu sau tách nền, chưa tái hiện các shader, matte hay bố cục đầy đủ của chuyển cảnh CapCut. Threshold/smoothness của shader CapCut không tương đương trực tiếp với similarity/blend của FFmpeg; mặc định hiện tại là 0.3/0.12, đã kiểm tra trên BurstingSmoke. Với mục kho cũ chưa từng được khôi phục key mà cache gốc đã bị xóa, cần nhập lại gói có metadata.

```powershell
$env:TEDIAPROS_TEST_FFMPEG = (Get-Command ffmpeg).Source
$env:TEDIAPROS_CHROMA_KEY_ASSET = '<đường dẫn MP4 nền xanh trong cache CapCut>'
node scripts/run-local-runtime-tests.mjs video-effects.test
node scripts/smoke-chroma-key-ui.mjs
```

```powershell
$env:TEDIAPROS_TEST_FFMPEG = Join-Path $env:APPDATA 'tedia-pros\bin\ffmpeg.exe'
node scripts/run-local-runtime-tests.mjs video-effects.test autoshort-overlays.test autoshort-ocr-burn.test video-adjustments.test portrait-blur.test autoshort-ocr-pipeline.test
node scripts/smoke-video-effects-ui.mjs
npm.cmd run typecheck
npm.cmd run build
```

Test media kiểm tra từng hiệu ứng trên khung đầu/cuối, chuyển động, tính xác định, số khung, render nhiều lớp với âm thanh/làm mờ thủ công, OCR + 9:16 + branding, dọn scratch và hủy trước render. Smoke UI dùng component thật trong Electron ẩn/profile tạm, kiểm tra chọn nhiều lớp, cường độ, thứ tự, preview, gỡ/tắt và khóa khi chạy. Đây là bằng chứng local; không thay thế kiểm tra installer hoặc batch dịch/TTS live.
