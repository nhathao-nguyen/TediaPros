# Quy Trình Sửa Lỗi (Bugfix Workflow)

Quy trình chuẩn hóa khi điều tra, khắc phục và kiểm chứng lỗi (bugs/regressions) trong **TediaPros**.

---

## Nguyên Tắc Cốt Lõi Khi Fix Bug

> **"Không bao giờ làm yếu hoặc xóa bỏ test chỉ để vượt qua kiểm tra."**
> **"Không sửa đổi lan man những phần code không liên quan."**

---

## Bước 1: Tái Hiện & Cô Lập Lỗi (Reproduce & Isolate)

1. Thu thập triệu chứng: Đọc logs lỗi từ màn hình Nhật ký hoạt động (`src/main/logger.ts`) hoặc báo cáo lỗi từ renderer (`reportRendererIssue`).
2. Viết hoặc cập nhật một **Unit/Integration Test** tái hiện chính xác lỗi đó (test phải FAIL trước khi có bản vá).
3. Xác định lớp kiến trúc phát sinh lỗi:
   - Sai lệch kiểu IPC $\rightarrow$ `src/shared/types.ts` / `src/preload/index.ts`.
   - Lỗi logic hàng đợi / pipeline $\rightarrow$ `src/main/autoShortItemCoordinator.ts`.
   - Lỗi xử lý âm thanh / FFmpeg $\rightarrow$ `src/main/dubbing/*` hoặc `src/main/ocrMask.ts`.
   - Lỗi mô hình Python $\rightarrow$ `engines/<engine>/tests`.

---

## Bước 2: Phân Tích Nguyên Nhân Gốc Rễ (Root Cause Analysis)

1. Đối chiếu với các quy tắc miền tại [docs/domain.md](file:///f:/Son/tool/TediaPros/docs/domain.md):
   - Có vi phạm giới hạn nhịp độ Dubbing (1.10 - 1.45x) không?
   - Có bị tràn ngân sách đĩa hoặc rò rỉ tệp tạm không?
   - Có bị lỗi YUV 4:2:0 chroma bleeding không?
   - Có đường dẫn nào không an toàn chưa qua `safeContainedPath` không?
2. Phân biệt rõ giữa **triệu chứng bề mặt** và **nguyên nhân kiến trúc**.

---

## Bước 3: Triển Khai Bản Vá Phẫu Thuật (Surgical Patch)

1. Thực hiện thay đổi tối thiểu, tập trung đúng vào nguyên nhân gốc.
2. Bảo toàn toàn bộ comments, types và quy ước xử lý lỗi hiện có.
3. Không refactor phong cách viết code của những hàm xung quanh nếu không liên quan đến bug.

---

## Bước 4: Kiểm Chứng Hồi Quy (Regression Verification)

1. Chạy test case tái hiện lỗi $\rightarrow$ Xác nhận test đã PASS.
2. Chạy toàn bộ test suite của module bị ảnh hưởng để đảm bảo không tạo ra regression mới:
   ```powershell
   npm run typecheck
   npm run test:local-runtime <test-của-module>
   ```
3. Nếu liên quan đến các engine Python:
   ```powershell
   npm run test:ocr-engine       # hoặc sttn / separator
   ```

---

## Bước 5: Bàn Giao & Đóng Task

- Ghi lại bản tóm tắt nguyên nhân gốc và phương án xử lý vào tệp task record ([.ai/tasks/TASK_TEMPLATE.md](file:///f:/Son/tool/TediaPros/.ai/tasks/TASK_TEMPLATE.md)).
