# Bảng Kiểm Đánh Giá Mã Nguồn (Code Review Checklist)

Bảng kiểm chuẩn hóa dành cho AI agent tự đánh giá (self-review) hoặc đánh giá chéo trước khi đề xuất hoàn thành công việc trong **TediaPros**.

---

## 1. An Toàn Hệ Thống & Bảo Mật (Security & Safety)

- [ ] **Chống Directory Traversal:** Mọi đường dẫn file do người dùng cung cấp hoặc sinh ra từ URL đều được kiểm tra qua `safeContainedPath.ts`.
- [ ] **Bảo mật bí mật (Secrets):** Không có API keys, passwords hoặc tokens nào bị hardcode trong mã nguồn hoặc tệp cấu hình được commit.
- [ ] **Không thực thi lệnh vỏ nguy hiểm:** Các lệnh gọi tiến trình con (`child_process.spawn` / `execFile`) không sử dụng chuỗi ghép thô có nguy cơ Command Injection.
- [ ] **Giữ nguyên PolyForm License:** Không có bất kỳ thay đổi nào làm giảm hiệu lực của `LICENSE` và `NOTICE`.

---

## 2. Quản Lý Tài Nguyên & Vòng Đời (Resource & Lifecycle)

- [ ] **Tiến trình con mồ côi (Zombie Processes):** Mọi tác vụ dài hạn (FFmpeg, Python, yt-dlp) đều được đăng ký với `processTree.ts` và được dọn dẹp triệt để khi gọi Cancel / Abort.
- [ ] **Rò rỉ sự kiện IPC (Event Listener Leak):** Trong React components (`src/renderer`), mọi hàm lắng nghe sự kiện (`window.api.on...`) đều có hàm dọn dẹp trả về trong `useEffect`:
  ```tsx
  useEffect(() => {
    const cleanup = window.api.onSomeEvent(handleEvent)
    return () => cleanup()
  }, [])
  ```
- [ ] **Giải phóng tệp tạm (Disk Budget Cleanup):** Mọi scratch folder và intermediate file trong AutoShort đều được xóa sạch sau khi hoàn thành hoặc lỗi.

---

## 3. Tuân Thủ Ràng Buộc Nghiệp Vụ (Domain Constraints)

- [ ] **Làm mờ OCR:** Bộ lọc làm mờ có chuyển đổi qua `format=gbrp` (Planar RGB) trước khi gọi `maskedmerge` không?
- [ ] **Dubbing Tempo:** Nhịp độ có nằm trong giới hạn `1.10x` đến `1.45x` không? Có bảo vệ khoảng lặng `0.50s` không?
- [ ] **Không nuốt câu thoại:** Có đảm bảo không bỏ rơi câu đơn lẻ khi vượt thời lượng không?
- [ ] **Tách thoại:** Model và engine có xác thực SHA-256 không? Có hỗ trợ fallback CPU khi DirectML lỗi không?

---

## 4. Chất Lượng Mã Nguồn & Kiểm Thử (Quality & Verification)

- [ ] **TypeScript Strict:** Không sử dụng kiểu `any` tùy tiện; các interface được định nghĩa rõ ràng trong `src/shared/types.ts`.
- [ ] **Typecheck thành công:** Lệnh `npm run typecheck` chạy không báo lỗi.
- [ ] **Tests vượt qua:** Các test suite liên quan đã được chạy và có kết quả PASS rõ ràng.
- [ ] **Ghi nhận trạng thái:** Tệp task record hoặc walkthrough đã ghi nhận đầy đủ bằng chứng kiểm thử.
