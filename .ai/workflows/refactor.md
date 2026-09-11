# Quy Trình Tái Cấu Trúc Mã Nguồn (Refactor Workflow)

Quy định và hướng dẫn khi thực hiện tái cấu trúc (refactoring) trong **TediaPros**.

---

## Khi Nào Được Phép Refactor?

- Khi một file vượt quá độ phức tạp cho phép (e.g. hàm quá dài, lặp code).
- Khi cần chuẩn hóa mẫu thiết kế (design pattern) theo kiến trúc chung.
- Khi cần tối ưu hóa hiệu năng, giảm tiêu thụ bộ nhớ hoặc tăng tốc độ thực thi hàng đợi.

**KHÔNG ĐƯỢC REFACTOR KHI:**
- Đang thực hiện một task sửa lỗi gấp (bugfix).
- Chưa có bộ test tự động bao phủ hành vi hiện tại của đoạn code đó.
- Chỉ đơn thuần là muốn đổi tên biến hoặc sắp xếp lại code theo sở thích cá nhân.

---

## Ba Quy Tắc Vàng Khi Refactor

1. **Bảo toàn hành vi quan sát được (Preserve Observable Behavior):** Mã nguồn sau khi tái cấu trúc phải trả về kết quả giống hệt mã nguồn cũ với cùng một tập input.
2. **Bảo toàn hợp đồng API công khai:** Không thay đổi chữ ký hàm (function signatures) trong `src/shared/types.ts` hoặc các kênh IPC công khai trừ khi có ADR phê duyệt trước.
3. **Thực hiện từng bước nhỏ:** Tái cấu trúc từng hàm / lớp độc lập, chạy test ngay sau mỗi bước.

---

## Các Bước Triển Khai

1. **Kiểm tra độ bao phủ test:** Xác nhận đã có test kiểm thử cho module chuẩn bị refactor. Nếu chưa có, viết test trước.
2. **Chạy test ban đầu (Baseline Check):**
   ```powershell
   npm run typecheck
   npm run test:local-runtime <test-module>
   ```
   Tất cả phải PASS 100% trước khi sửa dòng code nào.
3. **Tiến hành tái cấu trúc:**
   - Tách các hàm con nhỏ gọn, có trách nhiệm duy nhất (Single Responsibility).
   - Đặt tên biến và hàm rõ nghĩa, tự ghi tài liệu.
   - Giữ nguyên các chú thích kỹ thuật quan trọng và giải thích hằng số vật lý.
4. **Kiểm chứng lại (Post-Refactor Check):**
   - Chạy lại typecheck và toàn bộ test suite:
   ```powershell
   npm run typecheck
   npm run test:local-runtime
   ```
   - Xác nhận không có sự suy giảm về tốc độ hoặc gia tăng rò rỉ bộ nhớ.
