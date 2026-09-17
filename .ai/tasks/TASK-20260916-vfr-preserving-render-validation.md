# TASK-20260916: Giữ VFR khi xác thực render AutoShort

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-16

---

## 1. Mục Tiêu (Goal)

Sửa lỗi hậu render từ chối video VFR hợp lệ khi `r_frame_rate` nominal là 30
nhưng `avg_frame_rate` thực tế là khoảng 29.57; giữ timestamp/frame pacing VFR
thay vì ép video thành CFR.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Metadata đọc được cả nominal và average FPS.
- [x] Nguồn VFR được xác thực average-to-average và không còn lỗi giả 29.57 vs 30.
- [x] Nguồn CFR mismatch vẫn bị từ chối.
- [x] `npm.cmd run typecheck` pass 100% không có lỗi.
- [x] Test liên quan pass kèm bằng chứng lệnh thực tế.
- [x] ADR và kế hoạch được cập nhật.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:**
  - `canonicalDisplayGeometry` và FFprobe metadata.
  - `validateRenderedMedia` và expected media contract của AutoShort.
  - Regression tests, ADR, task handoff.
- **Nằm ngoài phạm vi:**
  - Không ép CFR hoặc thay đổi codec/encoder.
  - Không sửa lại các video đã render thất bại.
  - Không thay đổi IPC, TTS, OCR, STTN model hoặc chính sách tempo.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Giữ `frameRate` là nominal để tương thích, thêm
  `averageFrameRate` và `isVariableFrameRate`.
- *Lý do:* `r_frame_rate` không đại diện FPS phát trung bình của VFR; so sánh
  nominal với output average gây false positive. Average-to-average phản ánh
  đúng stream mà STTN đã bảo toàn.
- *Fallback:* Nếu probe cũ thiếu average cho nguồn VFR, bỏ qua riêng kiểm tra FPS
  nhưng vẫn bắt buộc decode, stream-count và duration.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/canonicalDisplayGeometry.ts`
- `[MODIFY]` `src/main/burn.ts`
- `[MODIFY]` `src/main/autoShortItemCoordinator.ts`
- `[MODIFY]` `tests/canonical-display-geometry.test.ts`
- `[MODIFY]` `tests/autoshort-ocr-pipeline.test.ts`
- `[MODIFY]` `scripts/run-local-runtime-tests.mjs`
- `[NEW]` `tests/rendered-media-validation.test.ts`
- `[NEW]` `docs/adr/011-vfr-preserving-render-validation.md`
- `[NEW]` `docs/superpowers/plans/2026-09-16-vfr-aware-render-validation.md`

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
node scripts/run-local-runtime-tests.mjs canonical-display-geometry.test
node scripts/run-local-runtime-tests.mjs rendered-media-validation.test
node scripts/run-local-runtime-tests.mjs autoshort-ocr-pipeline.test autoshort-ocr-burn.test
npm.cmd run build
npm.cmd run typecheck
```

### Kết quả thực tế:

- `canonical-display-geometry.test`: PASS (9/9).
- `rendered-media-validation.test`: PASS (4/4).
- `autoshort-ocr-pipeline.test`: PASS (12/12).
- `autoshort-ocr-burn.test`: PASS (10/10).
- `npm.cmd run build`: PASS (Electron main, preload và renderer bundles).
- `typecheck`: PASS (node và web, exit code 0).
- Probe video lỗi: `r_frame_rate=30/1`, `avg_frame_rate=20375/689`,
  `duration=137.800000`, `nb_frames=4075`.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Chưa chạy lại toàn bộ video người dùng trong bản build cài đặt; cần rebuild/
  restart ứng dụng trước khi xác nhận UI production.
- `dubbing-retime.test` integration media bị skip nếu không đặt
  `TEDIAPROS_RETIME_TEST_FFMPEG/FFPROBE`; đây là kiểm tra cũ, không phải lỗi của
  thay đổi VFR validator.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Cần build/restart ứng dụng để bản cài đặt nạp code mới; source change không sửa
  artifact đã cài tự động.
- Khi kiểm tra video lỗi cũ, probe cần có `avg_frame_rate`; log mong đợi không
  còn reject chênh lệch nominal 30 vs average 29.57 nếu average output khớp.
