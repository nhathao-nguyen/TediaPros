# TASK-20260911-WHISPER-WINLOCAL-RUNTIME-REPAIR: Khôi Phục Faster-Whisper Cho Auto Short Dev

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

---

## 1. Mục Tiêu (Goal)

Khôi phục Faster-Whisper trong hồ sơ `tedia-pros-dev` khi hộp chuẩn bị Auto Short liên tục báo đang tải engine dù runtime và receipt đã tồn tại.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Xác định nguyên nhân bằng probe trực tiếp trên runtime Dev cũ.
- [x] Chỉ dùng runtime WinLocal sau khi version, CPU và CUDA probe đều đạt.
- [x] Sao chép nguyên cây runtime và giữ bản Dev cũ để rollback.
- [x] Main-process status xác nhận engine, CUDA và model `small` sẵn sàng.
- [x] Auto Short bắt đầu phiên âm video thật bằng CUDA.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Test runtime liên quan pass.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Runtime `whisper-engine` trong userData Dev.
  - Receipt cài đặt runtime Dev.
  - Probe CPU, CUDA và model `small`.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Không thay đổi mã nguồn Whisper hoặc manifest phát hành.
  - Không sửa runtime của bản WinLocal/production.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Dùng nguyên cây runtime Faster-Whisper đã được kiểm chứng từ WinLocal.
- *Lý do:* Runtime Dev cũ có receipt `1.0.0` nhưng executable không nhận `--version`/`--probe`; runtime WinLocal cùng protocol trả probe hợp lệ trên CPU, CUDA và model hiện có.
- *An toàn:* Sao chép đủ 1.021 file thay vì chỉ executable để tránh lệch dependency PyInstaller; lưu runtime cũ tại `whisper-engine.before-winlocal-copy-20260911-110611`.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `.ai/tasks/TASK-20260911-whisper-winlocal-runtime-repair.md`
- `[RUNTIME]` `C:/Users/PC/AppData/Roaming/tedia-pros-dev/bin/whisper-engine/`
- `[RUNTIME]` `C:/Users/PC/AppData/Roaming/tedia-pros-dev/runtime-state/installed-runtime.json`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
whisper-engine.exe --version
whisper-engine.exe --probe --device cpu
whisper-engine.exe --probe --device cuda --cuda-dir <dev-whisper-cuda>
whisper-engine.exe --probe --device cpu --model-path <dev-small-model>
whisper-engine.exe --probe --device cuda --cuda-dir <dev-whisper-cuda> --model-path <dev-small-model>
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs canonical-runtime-migration.test
```

### Kết quả thực tế:

- Runtime Dev cũ: FAIL, `unrecognized arguments: --version`, exit code 2.
- Runtime WinLocal đã kích hoạt: version `1.0.0`, protocol `whisper-engine/1`.
- CPU probe: PASS; CUDA probe: PASS.
- CPU model probe: PASS, `modelLoaded=true`; CUDA model probe: PASS, `modelLoaded=true`.
- Main-process probe: `engine.healthy=true`, `cuda.healthy=true`, `cudaModel.ready=true`.
- SHA-256 executable đã kích hoạt: `08a779d1c3d92d9987befa847809802ab535b551887f51ce161a7fabbebd1caa`.
- Auto Short log: `Audio→Text: bắt đầu ... (model small, transcribe, cuda)`.
- `Typecheck`: PASS (0 errors).
- `canonical-runtime-migration.test`: PASS (16/16, 0 failed).
- App Dev: cửa sổ `TediaPros`, Vite HTTP 200.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Kênh phát hành `runtime-v5` chưa được thay đổi; sửa lần này áp dụng trực tiếp cho userData Dev trên máy hiện tại.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Khi phát hành runtime tiếp theo, phải đóng gói đúng mã nguồn hiện tại và chạy `--version`, CPU probe, CUDA probe trên artifact trước khi cập nhật manifest/checksum.
