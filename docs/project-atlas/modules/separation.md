# Phân Hệ Tách Thoại (Vocal Separation Subsystem)

- **Thư mục mã nguồn:** `src/main/separation/` & `engines/separator-engine/`
- **Tài liệu tham chiếu:** [src/main/separation/AGENTS.md](file:///f:/Son/tool/TediaPros/src/main/separation/AGENTS.md)

---

## 1. Trách Nhiệm Cốt Lõi
- Quản lý pipeline tách âm thanh video thành hai luồng độc lập: **Vocals** (giọng nói) và **Instrumental** (nhạc nền + SFX) ([pipeline.ts](file:///f:/Son/tool/TediaPros/src/main/separation/pipeline.ts)).
- Quản lý kho model tách thoại cục bộ, tải on-demand và kiểm tra mã băm SHA-256 ([modelInstaller.ts](file:///f:/Son/tool/TediaPros/src/main/separation/modelInstaller.ts), [modelManifest.ts](file:///f:/Son/tool/TediaPros/src/main/separation/modelManifest.ts)).
- Điều phối thực thi engine tách thoại [engines/separator-engine](file:///f:/Son/tool/TediaPros/engines/separator-engine) trên Windows DirectX 12 DirectML và fallback CPU ([runner.ts](file:///f:/Son/tool/TediaPros/src/main/separation/runner.ts)).
- Trích xuất audio từ video và ghép lại thành phẩm đa kênh ([media.ts](file:///f:/Son/tool/TediaPros/src/main/separation/media.ts)).

---

## 2. Kiến Trúc & Cơ Chế Phục Hồi Lỗi GPU (DirectML Fallback)
1. **Model MDX-Net ONNX:** Sử dụng model đã ghim mã băm SHA-256 trong [distribution/separator-model-inputs.json](file:///f:/Son/tool/TediaPros/distribution/separator-model-inputs.json).
2. **Cơ chế DirectML Fallback CPU:**
   - Khi chạy trên Windows, runner khởi động với `--provider auto` (ưu tiên DirectML).
   - Nếu DirectML báo lỗi hết VRAM (`DIRECTML_OOM`) hoặc thiết bị không phản hồi, `pipeline.ts` tự động kích hoạt lượt chạy thử lại với `--provider cpu`.
   - Quá trình chuyển đổi diễn ra êm ả, phát cảnh báo vào log nhưng không làm hỏng cả mẻ xử lý video của người dùng.
3. **Quản lý Scratch Audio:** Toàn bộ file WAV trung gian (44.1kHz / 48kHz uncompressed) được lưu trong thư mục scratch của item và xóa sạch ngay sau khi hoàn thành.

---

## 3. Kiểm Thử Liên Quan
```powershell
cmd.exe /c "node scripts/run-local-runtime-tests.mjs separator-contract.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs separator-pipeline.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs separator-runtime.test"
cmd.exe /c "npm run test:separator-engine"
```
