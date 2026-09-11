# OPERATIONS_AND_TROUBLESHOOTING.md — Vận Hành, Chẩn Đoán & Khắc Phục Sự Cố

Tài liệu này cung cấp cẩm nang vận hành, phân tích nguyên nhân gốc rễ và quy trình xử lý các sự cố phổ biến trong **TediaPros**.

---

## 1. Hệ Thống Nhật Ký (Logging System)

- Tệp nhật ký chính được lưu tại: `userData/logs/tedia-pros.log`.
- Định dạng log: `[ISO_TIMESTAMP] [LEVEL] [MODULE] Nội dung thông điệp`.
- Giao diện xem log trực tiếp: Tab **Nhật ký** (`Logs.tsx`) trên thanh điều hướng ứng dụng.

---

## 2. Hướng Dẫn Chẩn Đoán & Khắc Phục Sự Cố Phổ Biến

### Sự cố 1: Lỗi `running scripts is disabled on this system` khi chạy npm trên Windows PowerShell
- **Nguyên nhân:** Chính sách ExecutionPolicy mặc định của PowerShell chặn file script `npm.ps1`.
- **Cách khắc phục:** Dùng lệnh qua cmd:
  `cmd.exe /c "npm run dev"` hoặc `npm.cmd run dev`.

### Sự cố 2: Lỗi Electron `Cannot read properties of undefined (reading whenReady)`
- **Nguyên nhân:** Biến môi trường `ELECTRON_RUN_AS_NODE` đang bật trong phiên làm việc terminal khiến Electron chạy như một tiến trình Node.js thuần túy thay vì ứng dụng GUI.
- **Cách khắc phục:**
  `Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue`

### Sự cố 3: Tách thoại báo lỗi DirectML hoặc crash GPU driver
- **Nguyên nhân:** Card đồ họa không đủ VRAM hoặc driver DirectX 12 bị lỗi thời.
- **Cách khắc phục:** Hệ thống đã tích hợp sẵn cơ chế **CPU Fallback**. Nếu vẫn gặp lỗi, người dùng có thể chuyển Preset tách nhạc từ `Quality` sang `Fast` (mô hình nhẹ hơn) trong cài đặt AutoShort.

### Sự cố 4: Lỗi `AutoShortDiskBudgetError: Không đủ dung lượng tạm trên ổ đĩa`
- **Nguyên nhân:** Ổ đĩa đích không đủ khoảng trống dự trù + 685 MB dung lượng an toàn (headroom).
- **Cách khắc phục:** Dọn dẹp ổ đĩa đích hoặc đổi thư mục đầu ra sang ổ đĩa khác còn nhiều dung lượng trống trong cấu hình AutoShort.

### Sự cố 5: Giọng lồng tiếng bị lỗi `cần nhịp > 1.45x; cần sửa text, không cắt lời`
- **Nguyên nhân:** Câu dịch sang tiếng Việt quá dài so với thời lượng video gốc, vượt quá giới hạn nhịp độ vật lý 1.45x.
- **Cách khắc phục:** Rút gọn bớt nội dung câu dịch tiếng Việt trong kịch bản hoặc chọn mô hình dịch súc tích hơn.

---

## 3. Tạo Báo Cáo Hỗ Trợ Kỹ Thuật (Support Report)

Khi người dùng gặp sự cố khó chẩn đoán:
1. Vào tab **Nhật ký** (Logs).
2. Bấm nút **Tạo báo cáo hỗ trợ**.
3. Hệ thống sẽ tự động tạo một báo cáo ẩn danh (Support Report):
   - Đã che giấu thông tin cá nhân (ẩn token, API key, đường dẫn chứa tên người dùng Windows).
   - Đính kèm thông số phiên bản, cấu hình GPU, mã lỗi gần nhất và 100 dòng log cuối cùng.
   - Người dùng có thể copy báo cáo này gửi cho đội ngũ phát triển để xử lý nhanh chóng.
