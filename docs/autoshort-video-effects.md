# Hiệu ứng video AutoShort

Trong **AutoShort**, bấm **Hiệu ứng** trên thanh phía trên khung xem trước.

- **Nhiễu hạt:** hạt sáng/tối chuyển động như chất phim.
- **Bụi phim:** đốm bụi sáng thay đổi theo từng khung hình.
- **Nhiễu analog:** nhiễu màu, lệch màu nhẹ và sọc quét ngang.

Bấm thẻ để bật/tắt từng kiểu. Có thể bật cả ba, chỉnh **Cường độ** từ 1–100%, dùng **Áp dụng trước** để đổi thứ tự, **Bỏ lớp** để gỡ một lớp hoặc **Tắt toàn bộ hiệu ứng**. Cấu hình lưu trên máy và áp dụng cho toàn bộ video trong batch. Khi batch đang chạy, bảng bị khóa.

Preview texture Screen/Multiply dùng cùng mô hình RGB với export; cả lớp bên trong một hiệu ứng và các hiệu ứng đã chọn đều được giữ đúng thứ tự. Cường độ được áp dụng lên toàn bộ nhóm texture một lần. Preview hạt/bụi/analog thủ tục vẫn là mô phỏng gần đúng. Chuyển động theo video và đứng yên khi tạm dừng; mở video đã xuất để xem kết quả FFmpeg đầy đủ. Hiệu ứng phủ suốt thời lượng đầu ra sau cắt/retime, trên cả khung 9:16 và phụ đề. Ảnh/logo và chữ cố định nằm trên hiệu ứng.

## Phạm vi

Ba hiệu ứng thủ tục chạy offline, tự sinh bằng FFmpeg; Bụi xước phim cũ dùng texture đi kèm. AutoShort còn có tab quét CapCut và kho lưu vĩnh viễn. Scanner đọc các tài nguyên đã có trên máy, hỗ trợ video/matte, Chroma Key và nhóm texture hai pass tương thích. Đây chưa phải engine chạy mọi shader hoặc preset CapCut. Chưa có lịch xuất hiện theo đoạn hoặc keyframe.

## Xử lý

- `AutoShortConfig.videoEffects` là mảng có thứ tự, tối đa bốn hiệu ứng. Texture có thể chứa `layers: [{ assetPath, blendMode }]` từ 1–4 pass Screen/Multiply; `assetPath` trỏ tới pass đầu. Mỗi preset hoặc đường dẫn overlay chính xuất hiện một lần. Không trộn layers với matte/Chroma Key. `normalizeVideoEffects` dùng chung giữa Main và Renderer; từ chối kiểu lạ, trùng kiểu, số không hữu hạn và cường độ ngoài 0–100.
- Config cũ/không có hiệu ứng không thêm trường mới. Mảng rỗng và các lớp 0% được loại khi chuẩn hóa, giữ tương thích cấu hình cũ.
- `autoShortItemCoordinator` chuyển hiệu ứng vào `burnAutoShort`, rồi `runBurnSubtitleLower`. Cả render làm mờ thủ công và OCR tự động đều ghép hiệu ứng sau phụ đề/khung chân dung, trước ảnh/chữ cố định.
- `src/main/videoEffects.ts` chỉ xây graph từ preset và số đã kiểm tra; không nhận chuỗi filter từ người dùng. Grain dùng `noise`; bụi dùng texture luma nhỏ sinh bằng `geq` rồi `blend`; analog dùng `noise`, `chromashift`, `drawgrid`. Tham chiếu [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html).
- Hiệu ứng thủ tục lấy frame/PTS từ video chính. Texture bên ngoài lặp có giới hạn kết thúc bằng `shortest=1`; cache texture chỉ được chuẩn bị khi cần. Video người dùng không được encode qua lượt trung gian. Không thay đổi mapping audio, frame count hoặc thời lượng. Hủy tác vụ dùng lifecycle/process-tree hiện có.
- OCR vẫn dùng planar RGB trước `maskedmerge`. Chuyển đổi pixel format cho hiệu ứng diễn ra sau khi ghép mask.
- Sửa nhánh làm mờ thủ công để luôn đi qua bước hoàn thiện video; trước đây khi không có phụ đề/9:16/chỉnh màu, nhánh này có thể bỏ qua ảnh/chữ cố định.

## Kiểm chứng

### Tối ưu xuất cân bằng chất lượng, tốc độ và dung lượng

Policy mới dùng chung cho bước xuất video cuối của AutoShort và dịch màn hình, không giới hạn ở Nhiễu 2. Đọc bitrate riêng của video, codec, kích thước và FPS trung bình để đặt trần bitrate đỉnh; giữ chất lượng mục tiêu và thêm dư địa cho hiệu ứng nhiều chi tiết. Mỗi lượt xuất chọn ngẫu nhiên CQ22–24 và GOP60/120; grain/analog giới hạn CQ22–23 để bảo vệ chi tiết. Giá trị được chọn một lần, dùng lại khi fallback encoder; lần xuất sau chọn lại và có thể trùng tổ hợp trước. CPU giữ CRF cân bằng nhưng GOP vẫn thay đổi; AMF/QSV nhận mức chất lượng đã chọn. Trần bitrate/VBV và phần dọn metadata nguồn/encoder tag vẫn giữ. Đây là biến thiên mã hóa, chưa phải chứng minh không thể xác định máy nguồn.

Planner chia sẻ input texture trùng đường dẫn; resize và chuyển RGB một lần rồi phân nhánh theo đúng thứ tự lớp. Lớp `isStatic` được xác nhận từ sequence một frame sẽ decode/resize một lần rồi lặp frame RGB đã chuẩn bị. Lớp động vẫn chạy theo thời gian. Dữ liệu cũ thiếu cờ này vẫn render theo đường cũ; metadata cache được khôi phục khi còn tài nguyên nguồn phù hợp, kho mới lưu cờ để dùng offline.

Nguồn rất ít dữ liệu hình ở tối đa 1080p/30 FPS, không có hạt nhiễu hoặc overlay chưa biết đặc tính, có thể ưu tiên x264 để giảm dung lượng; các trường hợp khác ưu tiên GPU với fallback hiện có. Cache encoder tách theo đường dẫn FFmpeg và lựa chọn CPU/GPU. AAC dùng 128 kbps khi cần xử lý âm thanh; âm thanh không xử lý vẫn được copy. Không thêm lượt encode trung gian cho video người dùng hoặc đổi FPS/độ phân giải để lấy kết quả nhỏ hơn.

Mẫu chuyển động có Nhiễu 2 giảm 22,8% dung lượng và 8,9% thời gian trên GPU đang kiểm tra; mẫu ít chuyển động giảm 66,8% dung lượng nhờ chọn CPU, thời gian gần tương đương. Mẫu grain chỉ giảm 1,6% dung lượng và chậm hơn 11%; đây là đánh đổi để giữ gần chất lượng cũ. Các con số là trung vị ba lượt với mẫu 720×1280, 24 FPS, 4 giây, không phải cam kết cho mọi video. [ADR 014](adr/014-balanced-video-export-policy.md) ghi thuật toán, SSIM, fallback chưa kiểm tra trên phần cứng khác và [task](../.ai/tasks/TASK-20261013-balanced-export.md) có log/pixel/media proof.

Các số đo trên dùng cấu hình base cố định trước khi khôi phục CQ/GOP ngẫu nhiên. [Bằng chứng khôi phục](../.ai/tasks/TASK-20261013-encode-variation.md) kiểm tra riêng các tổ hợp mã hóa; dung lượng/thời gian có thể thay đổi giữa các lần xuất.

```powershell
$env:TEDIAPROS_TEST_FFMPEG = (Get-Command ffmpeg).Source
node scripts/run-local-runtime-tests.mjs balanced-video-export.test effect-layer-composition.test video-effects.test
```

### Lớp trắng đục chỉ xuất hiện khi render overlay

Overlay video dùng Screen/Multiply và tài nguyên `film_grunge` được ghép trên RGB planar (`gbrp`) ở cả hai đầu vào. Không áp dụng công thức Screen trực tiếp lên luma YUV limited-range: màu đen của texture có mã 16 thay vì 0, làm nâng vùng tối ngay cả khi texture đen hoàn toàn. Multiply trên YUV cũng có thể làm lệch chroma. Ghép RGB theo từng kênh giữ đúng phần tử trung tính (Screen + đen, Multiply + trắng), rồi encoder chuyển đầu ra về YUV 4:2:0 như trước. Không tăng sharpen hoặc đổi bitrate để che lỗi này.

Regression kiểm tra pixel đã giải mã, vùng tối, nguồn có màu, cường độ 25–100%, frame count và phép ghép RGB chuẩn. Bằng chứng local dùng tài nguyên **Nhiễu 2** thực tế và video mẫu màu được sinh: [task và phép đo](../.ai/tasks/TASK-20261013-overlay-rgb-blend.md), [ảnh so sánh](../.ai/tasks/2026-10-13-overlay-rgb-blend/comparison.png). Đây là kiểm chứng compositor, chưa phải đánh giá video người dùng hoặc bản cài đặt.

### Texture CapCut nhiều lớp

Gói **Nhiễu 2** được kiểm tra có Screen (`a0`–`a27`) rồi Multiply (`b0`). Scanner đọc thứ tự từ scene/material/sequence/atlas và blend literal, giữ alpha PNG bằng cách ghép texture lên màu trung tính trước khi lưu cache. Không thực thi Lua hoặc shader bên ngoài. Texture cache có hash nội dung và phiên bản; dùng lại cache không cần probe/encode FFmpeg, quét lại sau khi ảnh nguồn đổi sẽ tạo cache mới. Các tệp tạm được dọn sau encode, kể cả khi thất bại hoặc hủy.

Preview gộp các phép Screen/Multiply thành hai canvas Multiply/Screen theo [ADR 013](adr/013-ordered-rgb-texture-composition.md). Cách này giữ nền preview/phụ đề đang có, dùng lại bộ nhớ canvas và chỉ đọc lại texture khi có frame mới được trình bày. Mọi hiệu ứng đã chọn đều được hiển thị. Multiply không còn tự chỉnh contrast/brightness; matte không còn bỏ qua cường độ. Add dùng phép cộng có clipping tương ứng với CSS plus-lighter.

Kho lưu giữ đủ các pass. Cấu hình và mục kho cũ có thể được khôi phục từ gói CapCut còn tồn tại; metadata/lớp được lưu lại để dùng offline sau khi cache gốc bị xóa. Nếu một pass đã lưu bị mất, bỏ mục kho hoặc báo lỗi render thay vì âm thầm xuất thiếu lớp.

Đã kiểm tra gói Nhiễu 2 thật cùng preview Electron và render `burnAutoShort`: [bằng chứng](../.ai/tasks/TASK-20261013-effect-layer-optimization.md). Bộ nhập hiện chỉ nhận họ shader hai pass đã kiểm tra; gói khác tiếp tục được quét theo cách gần đúng hiện có. Timing texture chuẩn hóa 24 fps, chưa nhập curve, Lua speed hoặc keyframe CapCut. Đây chưa phải chứng minh tương đương pixel với CapCut native.

### Hiệu ứng bị chia đôi do alpha nằm trong cùng video

Một số tài nguyên MP4 của CapCut chứa mask độ trong suốt ở nửa trái và RGB hiệu ứng ở nửa phải. Gói **Overlay** đã kiểm tra dùng cách này cùng Multiply; ghép cả video bằng Screen tạo lớp trắng và vệt chia đôi ở giữa. Scanner đọc metadata Lumi và shader sampling để nhận diện `packedAlpha: 'left'`, không đoán từ tên hoặc tỉ lệ hình.

Preview, thẻ hiệu ứng và export tách hai phần trước khi resize/crop; mask dùng kênh đỏ làm alpha. Hỗ trợ Normal, Add, Multiply và Screen với cường độ tương ứng. Kho lưu giữ layout/blend để dùng offline; mục đã chọn/lưu từ trước được khôi phục khi metadata nguồn còn tồn tại. Sau cập nhật dev, bấm **Quét lại** rồi chọn lại hiệu ứng để danh sách/thẻ nhận thông tin mới.

Đã kiểm tra asset Overlay thật, preview Electron và video xuất có audio/frame count/full decode: [bằng chứng](../.ai/tasks/TASK-20261013-packed-overlay.md), [ADR 015](adr/015-packed-video-alpha-layout.md). Các shader/keyframe/chỉnh sáng khác trong gói vẫn nằm ngoài bộ nhập hiện tại.

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
node scripts/run-local-runtime-tests.mjs effect-layer-composition.test
node scripts/smoke-effect-layer-ui.mjs
npm.cmd run typecheck
npm.cmd run build
```

Test media kiểm tra từng hiệu ứng trên khung đầu/cuối, chuyển động, tính xác định, số khung, render nhiều lớp với âm thanh/làm mờ thủ công, OCR + 9:16 + branding, dọn scratch và hủy trước render. Smoke UI dùng component thật trong Electron ẩn/profile tạm, kiểm tra chọn nhiều lớp, cường độ, thứ tự, preview, gỡ/tắt và khóa khi chạy. Đây là bằng chứng local; không thay thế kiểm tra installer hoặc batch dịch/TTS live.
