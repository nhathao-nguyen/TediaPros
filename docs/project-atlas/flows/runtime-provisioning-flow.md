# Luồng Cung Cấp & Kiểm Tra Runtime (Runtime Provisioning Flow Trace)

- **Module thực thi:** `src/main/deps.ts`, `src/main/runtimeInstaller.ts`, `src/main/runtimeManifest.ts`, `distribution/`

---

## Trình Tự Thực Thi Chi Tiết

1. **Kiểm tra Tính Sẵn Sàng (Readiness Probe):**
   - Khi người dùng cấu hình một tính năng (ví dụ: bật Tách thoại hoặc bật OCR), UI gọi `window.api.autoShortGetReadiness(config)`.
   - Main process kiểm tra sự hiện diện của engine và model tương ứng trong thư mục `userData/runtime/`.

2. **Tải On-Demand (Tải theo yêu cầu):**
   - Nếu thiếu engine hoặc model, UI hiển thị modal tải kèm dung lượng chính xác.
   - Khi người dùng xác nhận, gọi `window.api.autoShortInstallDependencies(config)`.
   - Tải file nén từ URL được ghim trong `distribution/runtime-inputs.json`.

3. **Đối Soát Checksum SHA-256 Tuyệt Đối:**
   - Dữ liệu tải về được ghi tạm vào file `.tmp`.
   - Tính toán mã băm SHA-256 của file tải về:
     - Nếu trùng khớp tuyệt đối với mã SHA-256 đã ghim trong manifest $\rightarrow$ Tiến hành giải nén.
     - Nếu sai lệch $\rightarrow$ Hủy bỏ, xóa file `.tmp` ngay lập tức và báo lỗi cảnh báo người dùng về nguy cơ tệp bị giả mạo.

4. **Kích Hoạt & Cấp Quyền Thực Thi:**
   - Giải nén binary vào thư mục runtime.
   - Trên macOS/Linux: Cấp quyền thực thi `chmod +x` cho file binary.
   - Kiểm tra chạy thử lệnh `--version` hoặc `--probe` để xác nhận engine hoạt động bình thường.
