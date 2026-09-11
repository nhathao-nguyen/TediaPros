# TASK-20260911-portrait-blur-review: Review và sửa chức năng 9:16 nền mờ

- **Trạng thái:** Đã kiểm chứng local
- **Người thực hiện:** Codex và reviewer độc lập `portrait_review_current`
- **Thời gian:** 2026-09-11

## 1. Mục Tiêu (Goal)

Review mã hiện tại của nút 9:16 nền mờ, preview và bản xuất. Kiểm tra thêm tương tác với `videoAdjustments` vừa được thêm trong task khác, không đánh giá toàn bộ dirty diff của repo.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Đọc helper hình học, FFmpeg graph, component preview, lifecycle, RegionBox, contracts và forwarding.
- [x] Typecheck main/web trên mã hiện tại.
- [x] Chạy lại các test trong phạm vi và Electron acceptance của cả hai màn hình.
- [x] Probe FFmpeg độc lập với video ngang/vuông/dọc/hẹp/SAR khác 1/xoay 90 độ.
- [x] Rà soát độc lập hoàn tất; phân biệt kết luận mã, kiểm thử local và phạm vi chưa kiểm tra.
- [x] Chọn lại đúng video hiện tại không làm mất metadata, preview 9:16 hoặc các vùng chỉnh sửa.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

Review phần 9:16 và sửa lỗi tái chọn cùng video trong `VideoEditor`. Không thay đổi HEAD, nhánh hoặc các phần dirty khác của repository.

## 4. Kết Quả & Đánh Giá (Decisions & Rationale)

**Không phát hiện lỗi P1/P2 mới có bằng chứng đủ chắc trong thay đổi 9:16 hiện tại.** Kết luận của reviewer độc lập thống nhất với kiểm tra của agent chính.

- Hình chính và RegionBox dùng kích thước fit chung; bản xuất giữ source-space OCR/manual blur và đặt ASS trên hình chính trước khi thu/phóng.
- Automatic mask giữ `gbrp`; đường graph manual/OCR khi bật/tắt framing có đầu ra hợp lệ.
- Canvas nền dùng frame của player hiện tại và dọn callback/listener; đổi nguồn/resize được kiểm tra ở mức mã, còn toggle/seek/play/pause/rate/resize được thực thi trong Electron.
- Trường tùy chọn giữ tương thích cấu hình cũ và truyền đầy đủ qua coordinator đến burn.
- Hai vấn đề từ review trước (floor cỡ chữ 12px và test bắt buộc FFmpeg tại đường dẫn Windows) đã được sửa trong mã hiện tại. Không báo lại thành lỗi còn tồn tại.
- Khi hộp chọn file trả về đúng đường dẫn video đang mở, `VideoEditor` giữ nguyên state. Trước đây nhánh này đặt `videoW/videoH` về `0`, trong khi thuộc tính `src` không đổi nên trình duyệt không phát lại `loadedmetadata`; kết quả là overlay và preview bị hỏng.

## 5. Tệp Báo Cáo & Bằng Chứng (Changes Made)

- `[NEW]` bản ghi review này.
- `[NEW]` `docs/reviews/2026-09-11-portrait-blur-review/runtime-tests.log`.
- `[NEW]` `docs/reviews/2026-09-11-portrait-blur-review/preview-results.json`, `editor-portrait.png`, `autoshort-portrait.png`.
- `[NEW]` `docs/reviews/2026-09-11-portrait-blur-review/probe-render.mjs`, `render-matrix.json`.
- `[MODIFY]` `src/renderer/src/components/VideoEditor.tsx`: bỏ reset state khi tái chọn cùng video.
- `[MODIFY]` `scripts/test-portrait-preview.mjs`: thêm regression acceptance chạy trên component thật.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Các lệnh đã chạy:

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime -- portrait-blur.test autoshort-ocr-contract.test canonical-display-geometry.test autoshort-ocr-burn.test video-adjustments.test
node scripts/test-portrait-preview.mjs docs/reviews/2026-09-11-portrait-blur-review
node docs/reviews/2026-09-11-portrait-blur-review/probe-render.mjs
npm.cmd run build
git diff --check
```

Kết quả:

- Typecheck: PASS, node và web, exit 0.
- 45 tests: 5 portrait + 13 contract + 8 display geometry + 10 OCR burn + 9 adjustments; 0 FAIL, 0 SKIP.
- Electron acceptance PASS cả Editor và AutoShort: tỷ lệ khung/vùng nguồn, giữ media element và playhead khi toggle, seek, play/pause ở 1.5x, resize, font preview, payload export của Editor. Dùng actual components/CSS, IPC giả lập và profile tạm, không dùng profile người dùng.
- Regression acceptance đã được quan sát RED trước bản sửa (`selecting the current video preserves metadata and editor overlays`), sau đó PASS; lớp RegionBox vẫn tồn tại sau khi chọn lại đúng file hiện tại.
- Build Electron/Vite: PASS; chỉ còn các cảnh báo chunk động/tĩnh đã có, không có lỗi build.
- Probe FFmpeg 6 ca PASS: 640×360, 480×480, 360×640, 200×800, 720×576 với SAR 16:15 (display 768×576), 640×360 có display rotation 90° (display 360×640). Mỗi bản xuất 1080×1920, SAR 1:1, 4 frame/0.4 giây; không còn metadata rotation; hash audio PCM giải mã trùng nguồn.
- Fixture xoay được tạo bằng `-display_rotation:v:0 90` và assert kích thước display sau probe; không chỉ đặt một tag chưa chắc tác động.
- Reviewer độc lập hoàn tất đọc code, không chạy lặp lại suites và không sửa file.

Giới hạn:

- Chưa chạy batch OCR/STTN/TTS với media thật của người dùng trong lượt này; probe bổ sung dùng video tổng hợp ngắn.
- Chưa chạy macOS, installer hoặc toàn bộ suite ngoài phạm vi.
- CSS blur và FFmpeg blur khác bộ render; không xác nhận pixel-identical giữa nền preview và bản xuất. Sai số làm chẵn hình chính dưới 2 pixel đầu ra đã được ghi nhận trong tài liệu thiết kế.
- `git diff --check` còn in cảnh báo EOL ở test translation đã thay đổi từ trước; không có lỗi whitespace.

## 7. Bàn Giao (Handoff Notes)

Lỗi tái chọn cùng video đã được sửa và có regression acceptance. Tính năng đủ điều kiện tiếp tục nghiệm thu local trên media người dùng; kết luận không thay cho kiểm tra installer/macOS hoặc batch sản xuất.
