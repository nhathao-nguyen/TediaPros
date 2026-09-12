# TASK-20260911-OCR-APPCONTAINER-PATH-FIX: Sửa probe OCR trong profile Dev

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

---

## 1. Mục Tiêu (Goal)

Sửa lỗi OCR runtime 1.2.1 có đủ model đúng checksum nhưng probe báo model không
nằm trong thư mục runtime khi TediaPros Dev chạy dưới Windows AppContainer.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Regression test tái hiện việc Windows canonicalize file qua `LocalCache`.
- [x] Resolver vẫn từ chối thư mục hoặc model là symlink và vẫn kiểm SHA-256.
- [x] Binary OCR 1.2.1 mới probe đạt với CPU và DirectML.
- [x] Runtime Dev được thay toàn bộ cây file, có backup và receipt đúng hash.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Toàn bộ test OCR và test runtime liên quan pass.
- [x] App Dev khởi động lại không gọi installer OCR và không báo thiếu manifest.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Resolver model của `ocr-engine`, regression test, tài liệu runtime.
  - Build/probe và kích hoạt runtime OCR 1.2.1 trong profile Dev.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Phát hành asset lên GitHub runtime channel.
  - Thay đổi codec hoặc chuyển mã toàn bộ video nguồn.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Giữ đường dẫn tuyệt đối theo cách viết của runtime, kiểm tra file
  thường/symlink trực tiếp, rồi kiểm SHA-256.
- *Lý do:* `Path.resolve()` trên Windows AppContainer có thể đổi riêng đường dẫn
  file sang `LocalCache`, tạo false negative khi so với thư mục cha.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `engines/ocr-engine/ocr_models.py`
- `[MODIFY]` `engines/ocr-engine/tests/test_model_preparation.py`
- `[MODIFY]` `engines/ocr-engine/README.md`
- `[NEW]` `.ai/tasks/TASK-20260911-ocr-appcontainer-path-fix.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
python -m unittest engines/ocr-engine/tests/test_model_preparation.py -v
python -m unittest discover -s engines/ocr-engine/tests -p 'test_*.py' -v
<candidate> --probe --device cpu
<candidate> --probe
npm run typecheck
npm run test:ocr-engine
node scripts/run-local-runtime-tests.mjs autoshort-ocr-pipeline.test
```

### Kết quả thực tế:

- `TDD RED`: regression test lỗi đúng tại containment check cũ.
- `TDD GREEN`: regression test đạt sau thay đổi resolver.
- `OCR tests trong build venv`: PASS 47 tests, 2 fixture-dependent skips.
- `npm run test:ocr-engine`: PASS 47 tests, 10 build-environment skips.
- `autoshort-ocr-pipeline.test`: PASS 12/12.
- `npm run typecheck`: PASS; `npm run build`: PASS.
- `Candidate runtime`: PASS CPU và DirectML; GPU dùng đủ ba session.
- `Real-media smoke`: PASS, quét 6 frame từ clip thật, tạo 3 cue OCR.
- `App Dev`: khởi động tại `http://localhost:5173/`, không còn gọi installer
  OCR và không còn lỗi thiếu asset manifest.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Cảnh báo Chromium `Unsupported pixel format: -1` vẫn có thể xuất hiện khi
  renderer mở video HEVC; FFprobe xác nhận nguồn là `yuv420p` và cảnh báo này
  không phải lỗi của managed FFmpeg/OCR installer.
- Chưa publish runtime mới lên kênh remote `runtime-v5`.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Giữ backup runtime trước sửa trong `bin/ocr-engine.before-path-fix-*` cho tới
  khi một batch AutoShort dùng OCR chạy ổn định.
