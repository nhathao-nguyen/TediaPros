# TASK-20261013-REAL-VIDEO-QUALITY: Đối chiếu chất lượng video thật

- **Trạng thái:** Đã kiểm chứng chẩn đoán; không sửa pipeline trong task này
- **Người thực hiện:** Codex
- **Thời gian:** 2026-10-13

## 1. Mục Tiêu (Goal)

Giải thích vì sao video xuất người dùng đang xem trông tối và mất nét hơn video gốc. Xác định đúng hai file bằng đường dẫn người dùng cung cấp, so sánh cùng thời điểm nội dung và cùng kích thước hiển thị.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Xác định đúng video gốc và bản xuất trong thư mục `(2)`.
- [x] Lấy thông tin codec, kích thước, FPS, bitrate và dung lượng bằng FFprobe.
- [x] Giải mã toàn bộ hai video thật thành công bằng FFmpeg.
- [x] Tái tạo zoom/chỉnh màu đang lưu trên frame gốc để đối chiếu trực quan.
- [x] Phân biệt cấu hình đang lưu với cấu hình lịch sử của job; không dùng một frame có hiệu ứng làm thước đo chất lượng nén toàn video.
- [x] `npm.cmd run typecheck`: PASS, mã thoát 0.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- Đọc video và dữ liệu render có chọn lọc; tạo báo cáo và ảnh đối chiếu trong thư mục task.
- Không sửa file video, cấu hình ứng dụng, dữ liệu Local Storage, hay mã nguồn sản phẩm.
- Giữ nguyên tất cả thay đổi đang có trong worktree, bao gồm phần Facebook article/exporter ngoài phạm vi.

## 4. Quyết Định & Lý Do (Decisions & Rationale)

### Hai file được kiểm chứng

- Gốc: `F:\Son\facebook\reel\KhinhThuong\Confianza - 61591542279685\video\001_1461911245698594.mp4`
- Xuất: `F:\Son\facebook\test\001_1461911245698594 (2)\001_1461911245698594-phude_1.1x.mp4`

| Thuộc tính | Gốc | Xuất |
| --- | --- | --- |
| Codec hình | VP9 | H.264 |
| Kích thước | 1080×1920 | 1080×1920 |
| FPS | 30 | 30 |
| Bitrate hình | 1.022 Mbps | 7.891 Mbps |
| Dung lượng | 3,510,277 bytes | 23,608,386 bytes |
| Thời lượng container | 25.634830 s | 23.333333 s |

Dung lượng tăng khoảng 6.73 lần. Output không bị hạ độ phân giải; bitrate cao hơn không phục hồi chi tiết đã mất do crop, hiệu ứng hoặc mã hóa lại.

### Cấu hình render đang lưu và phép tái tạo

Chỉ trích xuất các khóa render từ `%APPDATA%\tedia-pros-dev\Local Storage\leveldb`; không trích xuất token, cookie hay khóa API:

- Zoom 120%, brightness −5, saturation 105%, contrast 103%.
- Tốc độ 1.1×; portrait blur, opening flash và opening zoom đang tắt.
- Một texture Screen tên `Nhiễu cổ điển`, cường độ 75%.

Zoom 120% cắt nguồn từ 1080×1920 còn 900×1600 rồi scale về 1080×1920. Phần giữ lại bằng khoảng 69.4% diện tích ban đầu; chi tiết nguồn trên mỗi chiều còn 83.3% trước khi phóng lớn. Brightness −5 được exporter chuyển thành `eq=brightness=-0.05`, cùng saturation 1.05 và contrast 1.03.

Ảnh đối chiếu ba cột: gốc ở 5.5 s, gốc cùng thời điểm sau phép crop/chỉnh màu, đầu ra ở 5.0 s. Đây là căn chỉnh theo tốc độ 1.1×; việc resample FPS có thể gây lệch nhỏ giữa frame gần nhau. Cột giữa tái tạo được crop và phần lớn thay đổi tông màu, nhưng không tái tạo toàn bộ texture, phụ đề hay hai lần mã hóa.

**Giới hạn bằng chứng:** Cấu hình đang lưu không phải bản chụp cấu hình lịch sử của job 11:23. Manifest job chỉ có config digest. Không khẳng định mọi giá trị đang lưu đều trùng chính xác job đã xuất. Cũng chưa có phép A/B cô lập mức giảm nét do encoder hoặc do từng layer texture.

### Mã hóa hai lần và độ lệch preview/export

- `src/main/autoShortItemCoordinator.ts`, khối sau `completedBurn`, gọi `changeVideoSpeed` khi tốc độ khác 1×, rồi thay file đã burn bằng file `_1.1x`.
- `src/main/videoSpeed.ts` mã hóa H.264 lần nữa bằng cấu hình riêng (NVENC CQ 21–23, GOP 60/120, AAC 192k), chưa dùng kế hoạch bitrate/VBV mới trong `videoExportPolicy.ts`. Vì vậy bước tốc độ có thể vượt mục tiêu dung lượng của bước burn và thêm một thế hệ nén mất dữ liệu.
- `src/shared/videoAdjustments.ts` dùng CSS `brightness(0.95)` trong preview, còn export dùng offset YUV `eq=brightness=-0.05`. Hai phép toán không tương đương. Đây là độ lệch đã xác định trong code, chưa có test A/B preview/export trên video này.
- Output giữ color range TV, transfer/primaries BT.709 nhưng thiếu trường matrix `color_space`. Chưa đủ bằng chứng coi đây là nguyên nhân; không được chỉ gắn nhãn BT.709 khi chưa xác định matrix của pixel thực tế.
- Bản xuất lúc 11:23 có trước lần khôi phục biến thiên CQ/GOP lúc 11:39; không quy lỗi này riêng cho thay đổi randomization sau đó.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `.ai/tasks/2026-10-13-real-video-quality/read-render-settings.mjs`: đọc có chọn lọc các khóa render từ WAL/SST LevelDB, không ghi vào profile.
- `[NEW]` `.ai/tasks/2026-10-13-real-video-quality/verify-quality.mjs`: probe, lấy frame, tái tạo crop/chỉnh màu, ghép đối chiếu và giải mã toàn bộ hai video.
- `[NEW]` `.ai/tasks/2026-10-13-real-video-quality/current-render-settings.json`, `media-probes.json` và ảnh PNG bằng chứng.
- `[NEW]` Bản ghi bàn giao này.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

```powershell
node .ai\tasks\2026-10-13-real-video-quality\read-render-settings.mjs
node .ai\tasks\2026-10-13-real-video-quality\verify-quality.mjs
npm.cmd run typecheck
```

- FFprobe và full FFmpeg decode: PASS cho cả hai video.
- Ảnh tái tạo đã mở và kiểm tra trực quan: `quality-comparison.png`; thêm phép đối chiếu ở 4.0/4.4 s trong `adjustments-comparison.png`.
- Typecheck node + web: PASS, mã thoát 0.
- Không sửa mã sản phẩm nên không bổ sung hoặc chạy lại các unit suites không liên quan.
- Đã thử SSIM cho vùng trên của frame 4.0/4.4 s (0.881783 sau crop/chỉnh màu); không diễn giải thành chất lượng codec vì texture và frame resampling chưa được cô lập.

Tham khảo kỹ thuật cho trình đọc bằng chứng LevelDB: [table format](https://raw.githubusercontent.com/google/leveldb/main/doc/table_format.md), [Snappy format](https://raw.githubusercontent.com/google/snappy/main/format_description.txt).

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Muốn giữ diện mạo gốc: dùng zoom 100%, brightness 0, saturation/contrast 100%; chọn cường độ texture phù hợp hoặc xuất một mẫu không texture để đối chiếu. Chưa thay cấu hình của người dùng.
- Cải tiến pipeline tiếp theo cần gộp retime vào lần render cuối, bảo toàn timing phụ đề/hiệu ứng/audio, cancellation, thời lượng và receipt, đồng thời giữ biến thiên CQ/GOP mà người dùng đã yêu cầu. Chưa triển khai trong task chẩn đoán này.
- Đồng nhất phép chỉnh màu preview/export bằng một mô hình màu và kiểm chứng pixel thay vì tăng bitrate hoặc thêm sharpen để che khác biệt.
