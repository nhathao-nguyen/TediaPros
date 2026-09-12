# TASK-20260911: Kế hoạch tự đặt phụ đề Auto Short theo OCR

- **Trạng thái:** Hoàn thành phần lập kế hoạch; implementation đã được thực hiện và kiểm chứng ở task bàn giao riêng.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

## 1. Mục Tiêu (Goal)

Lập kế hoạch theo quyết định người dùng đã duyệt: tận dụng OCR có sẵn để chọn vùng chữ thường xuyên và lớn cho phụ đề đầu ra từng video; ROI quét vẫn do người dùng chọn.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Kế hoạch không tự quét toàn khung hoặc quét lần hai.
- [x] Nêu rõ AND hai tiêu chí, heuristic loại chữ cố định, fallback và giới hạn độ tin cậy.
- [x] Có file map, interfaces, trình tự thực thi, test và ranh giới bằng chứng.
- [x] Typecheck baseline hiện tại pass (`npm.cmd run typecheck`, exit 0).
- [x] Chỉ tạo tài liệu mới, giữ nguyên các thay đổi cục bộ khác.
- [x] Tính năng và các test mới đã được triển khai; xem `TASK-20260911-autoshort-ocr-subtitle-placement-implementation.md`.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **In Scope:** Tài liệu kế hoạch và bàn giao kế hoạch.
- **Out of Scope:** Sửa runtime, chạy OCR/render thật cho tính năng chưa có, commit hoặc triển khai tính năng.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Dùng timeline OCR đã validated tại coordinator sau visual branch; không thêm model hoặc lượt scan.
- ROI normalized do người dùng chọn giữ nguyên; kết quả đặt phụ đề độc lập mỗi item.
- Chọn một vị trí ổn định, yêu cầu đạt cả tần suất và kích thước; không đủ bằng chứng thì dùng subRegion thủ công.
- Giá trị ngưỡng kỹ thuật trong plan là đề xuất v1 cần test, chưa phải kết quả chạy thực tế.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `docs/superpowers/plans/2026-09-11-autoshort-ocr-subtitle-placement.md`
- `[NEW]` `.ai/tasks/TASK-20260911-autoshort-ocr-subtitle-placement-plan.md`

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Lệnh đã chạy:

```powershell
npm.cmd run typecheck
```

- `typecheck:node` và `typecheck:web`: PASS, exit 0.
- CODE_CONFIRMED: timeline có box/text/timing; coordinator tái sử dụng visual OCR; burn nhận subRegion; renderer giữ ROI normalized.
- PLAN_ONLY: thuật toán, toggle, audit placement và bộ test mới. Chưa có chứng minh tốc độ/chất lượng cho batch 100 video thật.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Implementation đã hoàn tất trên working tree hiện tại. Các thay đổi region-resolution, dubbing/retime và OCR có sẵn vẫn được giữ nguyên; chưa commit, merge hoặc push.
