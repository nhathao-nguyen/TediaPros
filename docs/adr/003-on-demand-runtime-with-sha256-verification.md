# ADR 003: Phân Phối Runtime Theo Nhu Cầu Với Mã Băm SHA-256 Ghim Chặt

- **Trạng thái:** Đã chấp thuận (Accepted)
- **Ngày quyết định:** 2026-08-25
- **Tác giả:** Kiến trúc sư TediaPros

---

## Bối Cảnh (Context)

TediaPros tích hợp nhiều thành phần nhị phân nặng:
- FFmpeg với bộ giải mã tuỳ biến (`~80MB`).
- Model OCR và runtime (`~50MB`).
- Whisper Engine và CUDA / CTranslate2 libraries (`~300MB - 1GB`).
- Model tách thoại MDX-Net ONNX (`~65MB`).
- Video2X và AI Upscaling weights (`~200MB+`).

Nếu đóng gói toàn bộ vào bộ cài đặt ban đầu (NSIS / DMG), file cài sẽ nặng từ 2GB đến 4GB. Điều này làm tăng chi phí lưu trữ, kéo dài thời gian tải của người dùng và lãng phí băng thông đối với những người chỉ cần dùng tính năng tải video đơn giản.

---

## Quyết Định (Decision)

1. Giữ bộ cài đặt TediaPros siêu gọn nhẹ (< 100MB), chỉ chứa Electron shell và React UI.
2. Thiết lập cơ chế **Tải theo yêu cầu (On-Demand Runtime Loading)**:
   - Khi người dùng sử dụng một tính năng lần đầu (hoặc mở màn hình Setup khởi động), ứng dụng sẽ kiểm tra thành phần còn thiếu và tiến hành tải về.
3. **Ghim chặt mã băm mật mã học (Cryptographic SHA-256 Pinning):**
   - Mọi asset tải từ GitHub Releases hoặc máy chủ phân phối bắt buộc phải được khai báo trước trong [distribution/runtime-inputs.json](file:///f:/Son/tool/TediaPros/distribution/runtime-inputs.json).
   - Tệp tải về chỉ được giải nén và kích hoạt sau khi `runtimeInstaller.ts` kiểm tra mã băm SHA-256 thực tế trùng khớp 100% với giá trị đã ghim.

---

## Hệ Quả (Consequences)

### Tích cực:
- **Trải nghiệm người dùng tốt:** Tải app nhanh, người dùng chỉ tiêu tốn dung lượng cho những tính năng họ thực sự cần.
- **Bảo mật tuyệt đối:** Miễn nhiễm với các cuộc tấn công Man-in-the-Middle (MITM) hoặc việc máy chủ phân phối bị sửa đổi nhị phân.

### Tiêu cực / Đánh đổi:
- Yêu cầu kết nối mạng trong lần đầu tiên người dùng kích hoạt tính năng AI nâng cao.
- Phải duy trì quy trình kiểm tra và cập nhật manifest chặt chẽ thông qua script `scripts/pack-runtime-release.mjs`.
