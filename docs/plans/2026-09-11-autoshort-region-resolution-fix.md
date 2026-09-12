# Kế hoạch sửa vùng chỉnh sửa Auto Short khi đổi độ phân giải

Trạng thái: ĐÃ TRIỂN KHAI VÀ KIỂM CHỨNG. Ngày: 2026-09-11.

## 1. Nguyên nhân đã xác nhận

- Hai video người dùng nêu lần lượt là 1080×1920 (ID 7589964053678755124) và 2160×3840 (ID 7589940332742151424), cùng SAR 1:1 và tỷ lệ 9:16.
- `AutoShort.tsx` giữ `subtitleRegion`, `ocrRegion`, `blurRegions` bằng pixel nguồn. `onLoadedMetadata` đổi `videoW/videoH`, nhưng chỉ tạo vùng phụ đề/OCR khi state chưa có; các vùng đã có không được chuyển hệ tọa độ.
- `RegionBox.tsx` chia tọa độ cho kích thước video hiện tại. Giữ nguyên pixel của video 1080p trên video 2160p khiến phần trăm tọa độ và kích thước giảm một nửa.
- `startBatch` và STTN preview chuẩn hóa các pixel này bằng kích thước hiện tại; lỗi có thể đi vào request xuất cả batch.
- `autoShortItemCoordinator.ts` đã quy đổi vùng normalized sang display pixels riêng cho mỗi item. Giữ hợp đồng này.
- Font thủ công và viền cũng đang được chuẩn hóa bằng chiều cao video đang chọn khi chạy; cần loại bỏ sự phụ thuộc vào video chọn cuối cùng.

## 2. Hành vi đích

Một bố cục chung cho batch, lưu theo tỷ lệ của hình nguồn đã chuẩn hóa display geometry. Đổi video chỉ thay phép hiển thị, không sửa bố cục. Ví dụ vùng x=8–92%, y=78–90% phải giữ nguyên trên cả 1080p và 2160p.

- Áp dụng cho khung phụ đề, tất cả khung blur thủ công và vùng OCR dùng cho OCR-auto/STTN/nhận dạng chữ.
- Giữ ID, màu, vùng đang chọn và những chỉnh sửa đã kéo/resize.
- Video khác tỷ lệ ngang/vuông/dọc giữ phần trăm tương ứng trên hình nguồn; không bảo đảm che đúng nội dung chữ nếu vị trí chữ trong từng clip khác nhau. Tùy chỉnh riêng từng item nằm ngoài phạm vi.
- Bật/tắt 9:16, zoom, resize cửa sổ và đổi tab không thay dữ liệu vùng đã lưu.
- Config xuất batch không thay đổi chỉ vì người dùng chọn video khác trước khi bấm chạy.

## 3. Các bước triển khai

### Bước 1 — Viết regression để tái hiện lỗi

- Dùng actual AutoShort component với IPC fixture và hai video tổng hợp 1080×1920 / 2160×3840; không cần chạy TTS/OCR trả phí.
- Chỉnh phụ đề, tạo ít nhất hai vùng blur, chỉnh vùng OCR trên video A. Chuyển A → B → A và đo tọa độ tương đối, kích thước khung, cỡ chữ thực tế.
- Chụp request startBatch và STTN preview trước/sau đổi video; chứng minh lỗi bằng sự thay đổi các trường vùng/font/viền.
- Ghi nhận test thất bại trước bản sửa; không dùng kiểm tra chuỗi source để thay cho hành vi UI.

### Bước 2 — Chuyển state vùng sang normalized

- Tái sử dụng `AutoShortNormalizedRegion` / `AutoShortBlurRegion`; bổ sung helper thuần nếu chưa có helper phù hợp cho renderer.
- State normalized là nguồn dữ liệu chính; chỉ tạo pixel khi truyền props vào RegionBox.
- Callback kéo/resize trả pixel: quy đổi về normalized bằng geometry đúng của frame thao tác; giữ số thực, chỉ làm tròn ở ranh giới render cần thiết.
- Kiểm tra số hữu hạn, biên 0–1, x0 < x1 và y0 < y1; không lưu vùng có diện tích bằng 0 sau clamp.
- Khởi tạo mặc định một lần với geometry hợp lệ đầu tiên; không reset vùng khi đổi nguồn hoặc bật/tắt chế độ. Xóa toàn bộ queue thì xóa geometry đang xem nhưng giữ bố cục để batch kế tiếp dùng lại trong phiên.
- Thêm/xóa/chọn vùng blur vẫn giữ hành vi và giới hạn số vùng hiện có.

### Bước 3 — Khóa quan hệ nguồn và metadata

- Geometry phải gắn với `previewPath`/thế hệ nguồn; không dùng metadata của A để hiển thị hoặc chỉnh vùng của B.
- Khi đổi nguồn, chờ metadata hợp lệ trước khi nhận drag/add region hoặc chạy thao tác cần geometry; bỏ fallback 1280×720 ở các phép chuyển đổi có thể ghi state/gửi request sai.
- Bỏ qua callback metadata cũ, xử lý video lỗi tải, xóa video đang chọn, queue rỗng và chọn lại cùng file.
- Hủy thao tác kéo đang dở khi đổi nguồn. Không làm remount player khi chỉ đổi 9:16/zoom.
- Nếu có await trước khi gửi batch/STTN, dùng snapshot nguồn và cấu hình nhất quán; kiểm tra lại nguồn cho STTN trước khi gửi.

### Bước 4 — Cỡ chữ và viền theo tỷ lệ ổn định

- Chế độ tự động tiếp tục tính font theo vùng pixel đã quy đổi đúng cho từng video; giữ các giới hạn an toàn của bộ layout hiện tại.
- Font thủ công lưu tỷ lệ theo chiều cao nguồn; slider dùng một mốc hiển thị cố định có nhãn rõ, không đổi giá trị chỉ vì chọn clip 4K. Preview lấy font pixel từ tỷ lệ × chiều cao video hiện tại.
- Viền xử lý tương tự bằng `outlineScale`; màu và độ trong suốt không đổi.
- Giá trị font/viền pixel đã lưu từ phiên bản cũ: đổi một lần khi có geometry hợp lệ đầu tiên, ghi key có phiên bản. Giữ `fontSize=0` là tự động; không chia cho 0 hoặc âm thầm ghi đè giá trị cũ trước metadata.
- Kiểm tra migration không chạy lại khi chuyển video hoặc mở lại app. Không migration các vùng hiện chỉ nằm trong state bộ nhớ như thể chúng đã có dữ liệu persistence.

### Bước 5 — Đồng bộ preview và request xuất

- `startBatch` gửi vùng normalized trực tiếp, không chia lại theo video đang chọn. Font/viền gửi scale ổn định; giữ tương thích các trường pixel legacy của contract.
- STTN preview dùng đúng vùng OCR normalized và đúng file nguồn của snapshot.
- Giữ thứ tự hình học hiện tại: OCR/blur trên nguồn → zoom/chỉnh màu → phụ đề → ghép 9:16. Drag OCR/blur vẫn đảo phép zoom đúng một lần; phụ đề không bị zoom theo hình nguồn.
- Không áp tỷ lệ theo canvas 1080×1920 vào vùng nguồn khi video ngang có nền mờ.
- Chỉ sửa main/contract nếu test chứng minh cần thiết; không thay thuật toán OCR/STTN/FFmpeg blur hoặc chính sách dubbing.

### Bước 6 — Kiểm chứng và bàn giao

- Test helper: 1080p ↔ 2160p, ngang/vuông/dọc, số lẻ, biên, geometry rỗng, NaN và resize nhiều lần không tích lũy sai số.
- Electron acceptance: A → B → A nhiều lần, kéo/resize trên B rồi quay về A, nhiều blur box, đổi OCR-auto/manual/STTN, 9:16 bật/tắt, zoom 100/120%, resize cửa sổ và đổi video nhanh.
- So sánh các trường hình học trong payload batch khi lần lượt chọn A/B trước lúc chạy; chúng phải bằng nhau nếu không chỉnh cấu hình. Batch đang chạy giữ snapshot cũ.
- Render FFmpeg tổng hợp hai độ phân giải với marker biết trước, blur thủ công và ASS; xác nhận vùng blur, vị trí/cỡ chữ tương đối sau xuất 1080×1920. Kiểm tra riêng projection OCR/STTN với fixture, không gọi live provider.
- Dùng lại test canonical display geometry cho SAR khác 1 và rotation; chỉ mở rộng khi đường chuyển đổi mới chưa được bao phủ.
- Sai số preview tối đa khoảng 1 CSS pixel; phép đổi sang pixel nguồn tối đa 1 pixel tại mỗi ranh giới làm tròn. Không yêu cầu font hoặc blur preview giống FFmpeg từng pixel.
- Cuối cùng kiểm tra bằng hai video thật trong folder người dùng, không ghi đè nguồn hoặc chạy cả batch 42 video.

Lệnh dự kiến sau triển khai:

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-ocr-contract.test canonical-display-geometry.test video-adjustments.test portrait-blur.test autoshort-ocr-pipeline.test sttn-contract.test sttn-pipeline.test
node scripts/test-portrait-preview.mjs
node scripts/test-video-adjustments-preview.mjs
# Thêm suite geometry/acceptance đa độ phân giải mới vào runner và chạy riêng.
npm.cmd run test:subtitles
npm.cmd run build
git diff --check
```

## 4. Tệp dự kiến tác động

- `src/renderer/src/components/AutoShort.tsx`: state, callbacks, metadata, batch/STTN payload, font/viền.
- Helper hình học thuần trong `src/shared/` hoặc `src/renderer/src/lib/`: ưu tiên tái sử dụng trước khi tạo mới.
- `RegionBox.tsx`: chỉ thay nếu cần khóa drag/geometry; giữ hợp đồng props pixel cho VideoEditor.
- Tests helper mới, acceptance Electron và `scripts/run-local-runtime-tests.mjs`.
- `docs/portrait-blur.md`, `docs/video-adjustments.md` và bản ghi task: cập nhật sau khi kiểm chứng.

## 5. Tiêu chuẩn hoàn thành

- Cả ba loại vùng giữ đúng vị trí/kích thước tương đối; font và viền không đổi do chuyển độ phân giải cùng tỷ lệ.
- Payload hình học không phụ thuộc clip đang được chọn; preview, STTN preview và batch dùng cùng bố cục.
- Không mất chỉnh sửa hoặc tạo vùng sai khi metadata đến trễ, đang kéo, đổi mode hoặc chuyển qua queue rỗng.
- Typecheck, tests liên quan, acceptance và build pass; ghi rõ phần nào chỉ kiểm chứng bằng fixture và phần nào đã xem trên media thật.

Đã triển khai state normalized, khóa metadata theo nguồn, migration font/viền và payload ổn định. Regression thuần, acceptance Electron tổng hợp và acceptance bằng hai video thật đều có bằng chứng trong `docs/reviews/2026-09-11-region-resolution*`. Không chạy batch xử lý 42 video hoặc gọi provider live.
