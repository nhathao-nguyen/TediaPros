# TASK-20260910-revert-portrait-blur: Hoàn tác chức năng 9:16 nền mờ

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-10

## 1. Mục Tiêu (Goal)

Theo yêu cầu người dùng, trả preview và xuất video về hành vi trước phase thêm nút 9:16 nền mờ.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Gỡ cấu hình, bộ lọc và component riêng của chức năng 9:16 nền mờ.
- [x] Giữ các thay đổi chia câu, Gemini nhiều key, SEO và công việc khác đang có trong workspace.
- [x] Typecheck cả main và renderer thành công.
- [x] Các kiểm thử liên quan thành công: 45 tests, 0 failures.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

Chỉ hoàn tác phase 9:16 nền mờ. Không reset toàn bộ tệp có thay đổi từ các phase khác; không sửa dữ liệu video của người dùng.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

Gỡ từng phần thay đổi khỏi burn/coordinator/types để bảo toàn sửa đổi SEO và dịch. Khi bắt đầu hoàn tác, AutoShort.tsx và VideoEditor.tsx đã không còn tích hợp nút/preview 9:16; xác nhận chúng đang dùng cách fitVideoInBounds và wrapper preview cũ. CSS được khôi phục cả xuống dòng sau khi đối chiếu nội dung chỉ còn khác biệt xuống dòng cuối tệp.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` src/main/burn.ts: bỏ filter framing, tham số, validation và trường request 9:16; khôi phục graph trước đó.
- `[MODIFY]` src/main/autoShortItemCoordinator.ts: bỏ truyền tùy chọn framing.
- `[MODIFY]` src/shared/types.ts và src/shared/autoShortContract.ts: gỡ trường và validation portraitBlur.
- `[MODIFY]` src/renderer/src/styles/editor.css: gỡ style framing và flex-wrap thêm trong phase.
- `[DELETE]` src/main/videoFrame.ts, src/shared/videoFrame.ts, src/renderer/src/components/VideoFramePreview.tsx.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Các lệnh đã chạy:

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime -- autoshort-ocr-contract.test canonical-display-geometry.test autoshort-ocr-burn.test autoshort-ocr-pipeline.test autoshort-ui-contract.test
git diff --check
rg -n "portraitBlur|VideoFramePreview|PortraitBlurButton|planVideoFrame|appendVideoFrameFilters|video-frame-|video-output-frame|portrait-blur-toggle" src tests scripts
```

Kết quả: typecheck exit 0; năm bộ test lần lượt 11, 8, 10, 12, 4 tests đạt (tổng 45), không bỏ qua. Có kiểm thử coordinator thực thi mask writer và burnAutoShort với FFmpeg thật. Tìm kiếm không còn tham chiếu tính năng; git diff --check không có lỗi khoảng trắng. Không chạy lại/khởi động lại ứng dụng Electron và không xác nhận phiên ứng dụng đang mở đã tải lại mã.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Chức năng 9:16 nền mờ đã được hủy theo yêu cầu, không tiếp tục triển khai. Những diff ngoài phase vẫn thuộc các công việc trước đó.
