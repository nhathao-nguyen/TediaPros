# BUILD_AND_RELEASE.md — Quy Trình Đóng Gói, Phân Phối & Phát Hành

Tài liệu này đặc tả quy trình build, đóng gói ứng dụng Electron ra bộ cài đặt Windows/macOS và cơ chế phát hành các sidecar runtime.

---

## 1. Cấu Hình Đóng Gói Ứng Dụng Electron

- **Công cụ:** `electron-builder` phiên bản 25.x (cấu hình tại [electron-builder.yml](file:///f:/Son/tool/TediaPros/electron-builder.yml)).
- **Mục tiêu phân phối:**
  - **Windows:** Trình cài đặt NSIS 64-bit (`TediaPros-Setup-<version>.exe`), hỗ trợ icon tùy biến, tạo shortcut Desktop.
  - **macOS:** Tệp ảnh đĩa Apple Silicon (`TediaPros-<version>-arm64.dmg`).

### Lệnh Đóng Gói Ứng Dụng:
```powershell
# 1. Biên dịch mã nguồn TypeScript & Vite Web
cmd.exe /c "npm run build"

# 2. Đóng gói ra thư mục dist/
cmd.exe /c "npm run release:verify"
```

---

## 2. Đóng Gói Các Python Sidecar Engines (PyInstaller)

Mỗi engine trong `engines/` có file cấu hình `.spec` riêng biệt:
- `engines/ocr-engine/ocr-engine.spec`
- `engines/separator-engine/separator-engine.spec`
- `engines/sttn-engine/sttn-engine.spec`
- `engines/whisper-engine/whisper-engine.spec`

Khi đóng gói:
- PyInstaller gom toàn bộ Python runtime, thư viện ONNX Runtime / PyTorch, và binary CTranslate2 vào một thư mục phân phối độc lập (`--onedir` hoặc `--onefile`).
- Quá trình build này được tự động hóa qua GitHub Actions tại `.github/workflows/build-windows-runtime.yml`.

---

## 3. Cơ Chế Phát Hành Runtime On-Demand

Để tối ưu hóa kích thước bản cài đặt ban đầu của người dùng:
1. Bộ cài Electron chính chỉ đóng gói kèm `ffmpeg`, `ffprobe` và `yt-dlp`.
2. Các engine AI nặng (Whisper CUDA, MDX-Net model, STTN, Video2X) được nén thành file `.tar.gz` hoặc `.zip`, đẩy lên GitHub Releases.
3. Mã băm SHA-256 và URL tải được ghim cố định trong:
   - `distribution/runtime-inputs.json`
   - `distribution/separator-model-inputs.json`
4. Main Process sử dụng script [scripts/pack-runtime-release.mjs](file:///f:/Son/tool/TediaPros/scripts/pack-runtime-release.mjs) để xác thực và đóng gói tài nguyên phát hành.
