# Phân Hệ Quản Lý Runtime & Phân Phối (Runtime Infrastructure)

- **Thư mục mã nguồn:** `src/main/deps.ts`, `src/main/runtimeInstaller.ts`, `src/main/runtimeManifest.ts`, `src/main/runtimeResolver.ts`, `distribution/`
- **Tài liệu tham chiếu:** [docs/adr/003-on-demand-runtime-with-sha256-verification.md](file:///f:/Son/tool/TediaPros/docs/adr/003-on-demand-runtime-with-sha256-verification.md)

---

## 1. Trách Nhiệm Cốt Lõi
- Quản lý việc định vị (resolving) và kiểm tra tính sẵn sàng của các sidecar binary: FFmpeg, FFprobe, yt-dlp, Whisper, RapidOCR, MDX-Net, STTN, Video2X.
- Thực hiện cơ chế tải On-Demand: Ứng dụng khi cài đặt có kích thước nhẹ (<100 MB), các engine nặng chỉ được tải về khi người dùng kích hoạt tính năng tương ứng.
- Đối soát toàn vẹn mã băm SHA-256 ghim cứng trước khi cho phép giải nén hoặc thực thi bất kỳ binary nào.

---

## 2. Quy Chuẩn Ghim Checksum (Pinned SHA-256)
- Tất cả URL và SHA-256 được khai báo trong:
  - `distribution/runtime-inputs.json`: Binary FFmpeg, Whisper, OCR, Video2X, STTN.
  - `distribution/separator-model-inputs.json`: Trọng số mô hình MDX-Net ONNX.
- Khi tải về:
  1. Tải về file tạm `.tmp`.
  2. Tính toán mã băm SHA-256 trên luồng dữ liệu tải về.
  3. So khớp với giá trị ghim: Nếu sai lệch 1 ký tự $\rightarrow$ Hủy bỏ và xóa tệp ngay lập tức.
  4. Giải nén vào thư mục quản lý an toàn trong `userData/runtime/`.

---

## 3. Kiểm Thử Liên Quan
```powershell
cmd.exe /c "node scripts/run-local-runtime-tests.mjs local-runtime.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs release-tooling.test"
```
