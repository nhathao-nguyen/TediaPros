# Phân Hệ Giao Diện Người Dùng (Renderer UI Frontend)

- **Thư mục mã nguồn:** `src/renderer/`
- **Công nghệ:** React 19 + TypeScript 5.7 + Vite 6
- **Tài liệu tham chiếu:** [src/renderer/AGENTS.md](file:///f:/Son/tool/TediaPros/src/renderer/AGENTS.md)

---

## 1. Trách Nhiệm Cốt Lõi
- Trình diễn giao diện người dùng theo 10 Tab chức năng ([src/renderer/src/App.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/App.tsx)).
- Quản lý trạng thái giao diện bằng React 19 Hooks.
- Gọi các tác vụ hệ thống qua cầu nối an toàn `window.api` (không trực tiếp dùng Node APIs).
- Đăng ký và dọn dẹp các sự kiện tiến trình IPC (progress events).
- Bảo vệ giao diện khỏi sự cố sập màn hình bằng [SupportErrorBoundary.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/SupportErrorBoundary.tsx).

---

## 2. Các Thành Phần Trọng Yếu
1. **`AutoShort.tsx`:** Màn hình điều khiển quy trình sản xuất video ngắn tự động. Cho phép chọn vùng OCR, cấu hình giọng đọc TTS, chế độ làm mờ/xóa chữ STTN, quản lý hàng đợi và theo dõi thanh tiến độ từng video.
2. **`Downloader.tsx`:** Màn hình nhập liên kết tải video, xem trước thông tin video/playlist, chọn định dạng và xuất file.
3. **`Douyin.tsx`:** Màn hình quét kênh Douyin, quản lý danh sách tải và cookie đăng nhập.
4. **`SupportErrorBoundary.tsx`:** Bọc toàn bộ các view; khi có lỗi render phát sinh, hiển thị giao diện báo lỗi thân thiện kèm nút copy log chẩn đoán thay vì màn hình trắng (blank screen).

---

## 3. Kiểm Thử Liên Quan
```powershell
cmd.exe /c "npm run typecheck:web"
cmd.exe /c "npm run dev"
```
