# TASK-20261001-BURSTING-SMOKE: Chẩn đoán nền xanh trong preview

- **Trạng thái:** Hoàn thành chẩn đoán; chưa sửa hành vi sản phẩm.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-10-01

## 1. Mục Tiêu (Goal)

Xác định vì sao chọn BurstingSmoke từ kho CapCut làm preview AutoShort bị phủ xanh, đối chiếu ảnh người dùng với asset thật và đường ghép trong source hiện tại.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Xác định đúng asset và nền màu trong file gốc.
- [x] Đối chiếu bước xử lý CapCut với scanner, preview và render TediaPros.
- [x] Kiểm chứng màu nền và khả năng tạo alpha bằng FFmpeg trên asset thật.
- [x] `npm.cmd run typecheck` thành công, cả node và web.
- [x] Bảo toàn các thay đổi source đang có trong workspace.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** Chẩn đoán, đọc cache CapCut tại máy, trích frame và lưu bằng chứng.
- **Nằm ngoài phạm vi:** Sửa scanner/preview/render, tái hiện toàn bộ shader chuyển cảnh CapCut, build/install ứng dụng hoặc kiểm tra video xuất thật của người dùng.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

**Nguyên nhân đã xác nhận:** Scanner lấy một video nguyên liệu nền xanh trong gói CapCut rồi xem nó như overlay `screen`, bỏ qua bước chroma key của hiệu ứng gốc.

Asset thực tế:

`C:/Users/PC/AppData/Local/CapCut/User Data/Cache/effect/7613821658716998930/38ad36053fb5215d243ac06ee92bdc08/AmazingFeature/resource/video/BurstingSmoke.mp4`

- FFprobe: H.264, `yuv420p`, 910 × 512, 30 fps, 2 giây. File không có alpha.
- `AmazingFeature/lua/LumiFamily/LumiExportData.lua:6` khai báo `ae_effectType = 'transition'`; đây là nguyên liệu của một chuyển cảnh, không phải toàn bộ hiệu ứng đã render.
- Cùng file tại dòng 227–232 và 372–377 khai báo hai pass `LumiChromaKey`, đều dùng `Amaz.Color(0, 1, 0, 1)`. Threshold lần lượt 0.93 và 0.85; pass thứ hai có smoothness 0.93. Còn có các pass crop, unmult, matte và blend.
- `scanCapCutEffects` trong `src/main/capcutScanner.ts` chỉ tìm video có tên bắt đầu bằng `matte`. Video MP4 không có matte và không qua tổng hợp chuỗi ảnh được gán `screen`. Scanner không đọc pipeline chroma key trong Lua/scene.
- `VideoEffectsPreview` trong `src/renderer/src/components/VideoEffectsPreview.tsx` dùng CSS `mixBlendMode: 'screen'` cho lớp này, với opacity theo cường độ. Nền xanh là pixel còn nguyên trong video, vì vậy phủ xanh khung xem trước.
- `appendVideoEffects` trong `src/main/videoEffects.ts` dùng screen trên luma, giữ chroma nguồn (`c1_expr=A:c2_expr=A`). Nhánh render cũng không chroma key. Không suy từ ảnh preview rằng video xuất chắc chắn có cùng màu xanh; cơ chế ghép màu giữa hai bên khác nhau.

Hướng khắc phục: phân loại tài nguyên cần chroma key, xử lý màu nền thành alpha trước khi ghép và dùng kết quả nhất quán giữa preview và export. Muốn tái hiện đúng chuyển cảnh CapCut còn cần hỗ trợ các bước còn lại trong pipeline; chỉ xóa nền xanh chưa chứng minh hiệu ứng tương đương.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` Bản ghi chẩn đoán này.
- `[NEW]` `2026-10-01-bursting-smoke-diagnosis/source-frame.png`: frame asset gốc ở 0.5 giây.
- `[NEW]` `2026-10-01-bursting-smoke-diagnosis/evidence.json`: đo màu nền và thử alpha tại một pixel.
- Không sửa file source hoặc các thay đổi đang có trong sáu file hiệu ứng.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Các lệnh đã chạy:

```powershell
npm.cmd run typecheck
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt,width,height,duration,avg_frame_rate -of json '<BurstingSmoke.mp4>'
ffmpeg -hide_banner -loglevel error -y -ss 0.5 -i '<BurstingSmoke.mp4>' -frames:v 1 '<source-frame.png>'
```

Một script Node chạy FFmpeg với đầu ra RGBA để assert pixel góc khung đầu:

- Không xử lý key (`crop=2:2:0:0,scale=1:1,format=rgba`): **[0, 255, 0, 255]**, nền xanh đục hoàn toàn.
- Thử `chromakey=0x00FF00:0.3:0.1` trước crop: **[0, 255, 0, 0]**, alpha về 0.
- Cả hai phép assert thành công. Thông số thử nghiệm không phải thông số tương đương shader CapCut và chưa dùng trong code sản phẩm.

`Typecheck`: PASS, exit code 0. Không chạy unit suite hoặc full batch vì task chỉ chẩn đoán và không sửa module. Bằng chứng pixel chỉ xác nhận màu nền/alpha tại điểm đã đo; không chứng minh chất lượng viền khói, animation, export hay toàn bộ chuyển cảnh.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Khi triển khai bản sửa, kiểm tra metadata chroma key thay vì dựa vào riêng tên BurstingSmoke. Cần kiểm tra alpha, viền khói, cường độ, EOF/loop và sự nhất quán preview/export trên clip thật. Giữ nguyên những chỉnh sửa đang có trong worktree.
