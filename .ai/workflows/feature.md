# Quy Trình Phát Triển Tính Năng Mới (Feature Workflow)

Quy trình chuẩn hóa 5 giai đoạn dành cho AI coding agent khi phát triển hoặc mở rộng tính năng trong **TediaPros**.

---

## Giai Đoạn 1: Xác Định Yêu Cầu & Tiêu Chuẩn Nghiệm Thu

1. Phân tích rõ kết quả mong muốn từ yêu cầu người dùng.
2. Xác định ranh giới tính năng:
   - Những gì **thuộc phạm vi (In Scope)**.
   - Những gì **nằm ngoài phạm vi (Out of Scope)** — không tự ý mở rộng tính năng ngoài yêu cầu.
3. Thiết lập danh sách **Acceptance Criteria** có thể đo lường và kiểm chứng được bằng code hoặc test tự động.

---

## Giai Đoạn 2: Định Tuyến Ngữ Cảnh (Context Routing)

1. Tra cứu bảng định tuyến tại [AGENTS.md](file:///f:/Son/tool/TediaPros/AGENTS.md) để xác định module liên quan.
2. Đọc tài liệu kiến trúc tương ứng trong `docs/` và `AGENTS.md` của module đó.
3. Khảo sát các mẫu thiết kế sẵn có trong module để duy trì sự nhất quán về phong cách code.

---

## Giai Đoạn 3: Thiết Kế Hợp Đồng Dữ Liệu Trước (Contract-First)

1. Nếu tính năng yêu cầu giao tiếp giữa Renderer và Main:
   - Cập nhật định nghĩa kiểu trong [src/shared/types.ts](file:///f:/Son/tool/TediaPros/src/shared/types.ts).
   - Bổ sung hàm tiền kiểm tại [src/shared/autoShortContract.ts](file:///f:/Son/tool/TediaPros/src/shared/autoShortContract.ts) (nếu là input phức tạp).
   - Khai báo API tương ứng tại [src/preload/index.ts](file:///f:/Son/tool/TediaPros/src/preload/index.ts).
2. Viết test case hợp đồng (contract test) hoặc unit test trước khi viết logic chi tiết.

---

## Giai Đoạn 4: Triển Khai Phẫu Thuật (Surgical Implementation)

1. Triển khai code tại module đích (`src/main/`, `src/renderer/`, hoặc `engines/`).
2. Luôn tuân thủ các nguyên tắc cốt lõi:
   - Hỗ trợ cơ chế hủy bỏ (`AbortSignal`, hủy tiến trình con sạch sẽ).
   - Kiểm tra an toàn đường dẫn (`safeContainedPath.ts`).
   - Quản lý tệp tạm và giải phóng bộ nhớ (`autoShortDiskBudget.ts`).
   - Xử lý lỗi có thông báo rõ ràng (không dùng catch rỗng `catch {}`).

---

## Giai Đoạn 5: Kiểm Chứng & Bàn Giao

1. **Kiểm tra kiểu dữ liệu tĩnh:**
   ```powershell
   npm run typecheck
   ```
2. **Chạy test suite liên quan:**
   ```powershell
   node scripts/run-local-runtime-tests.mjs <tên-test-phù-hợp>
   ```
3. **Lập biên bản bàn giao:** Tạo file task record theo mẫu [.ai/tasks/TASK_TEMPLATE.md](file:///f:/Son/tool/TediaPros/.ai/tasks/TASK_TEMPLATE.md) để lưu vết tiến độ.
