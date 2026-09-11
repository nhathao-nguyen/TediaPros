# ADR 002: Quản Lý Giao Tiếp IPC Qua Hợp Đồng Kiểu Dữ Liệu Tĩnh Tập Trung

- **Trạng thái:** Đã chấp thuận (Accepted)
- **Ngày quyết định:** 2026-08-22
- **Tác giả:** Kiến trúc sư TediaPros

---

## Bối Cảnh (Context)

Trong ứng dụng Electron, giao tiếp IPC giữa Renderer Process (giao diện React) và Main Process (tiến trình Node) là huyết mạch của hệ thống. Nếu sử dụng các chuỗi sự kiện tự do (magic strings) và dữ liệu không định kiểu (`any`), dự án sẽ gặp phải:
1. Lỗi runtime do sai lệch cấu trúc dữ liệu giữa giao diện và backend.
2. Nguy cơ bảo mật nếu Renderer gửi các tham số bất hợp pháp (như đường dẫn vượt quyền hoặc tham số shell injection).
3. Rất khó refactor khi hệ thống mở rộng nhiều tính năng (hơn 50 kênh IPC hiện tại).

---

## Quyết Định (Decision)

1. Tập trung toàn bộ định nghĩa kiểu dữ liệu, thông số request/response, mã lỗi vào thư mục `src/shared/` (đặc biệt là [src/shared/types.ts](file:///f:/Son/tool/TediaPros/src/shared/types.ts)).
2. Sử dụng `contextBridge.exposeInMainWorld('api', api)` trong [src/preload/index.ts](file:///f:/Son/tool/TediaPros/src/preload/index.ts) để xuất bản giao diện `TblaoApi` hoàn toàn tường minh, đóng gói sẵn các hàm gọi `ipcRenderer.invoke` và quản lý listener.
3. Toàn bộ input phức tạp từ người dùng (như cấu hình AutoShort, tọa độ vùng làm mờ, tham số dịch thuật) bắt buộc phải đi qua hàm xác thực tiền kiểm tại [src/shared/autoShortContract.ts](file:///f:/Son/tool/TediaPros/src/shared/autoShortContract.ts) trước khi Main Process tiếp nhận xử lý.

---

## Hệ Quả (Consequences)

### Tích cực:
- **An toàn kiểu tuyệt đối (End-to-End Type Safety):** Bất kỳ thay đổi nào trong kiểu dữ liệu đều được phát hiện ngay lập tức tại bước `npm run typecheck`.
- **Bảo mật cao:** Giao diện React hoàn toàn không tiếp cận trực tiếp đối tượng `ipcRenderer`, triệt tiêu khả năng inject sự kiện tùy ý.
- **Tự ghi tài liệu:** File `types.ts` đóng vai trò tài liệu tham chiếu sống cho cả lập trình viên và AI agent.

### Tiêu cực / Đánh đổi:
- Cần viết boilerplate định nghĩa types cho mỗi kênh IPC mới.
