# TASK-20260912-AUTOSHORT-BATCH-RELIABILITY: Khôi phục và tăng độ tin cậy hàng đợi Auto Short

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-12

---

## 1. Mục Tiêu (Goal)

Khắc phục các lỗi đã làm batch WinLocal 0.1.23 chỉ hoàn thành 15/36 mục sau 7 giờ 55 phút, bổ sung khả năng tiếp tục sau khi app thoát, giảm việc chạy lại STTN giống hệt nhau, và giữ log đủ lâu để đo đúng nút thắt của các batch sau.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Timeline OCR ổn định có `gap-*` hợp lệ được STTN chấp nhận mà endpoint raw vẫn từ chối dữ liệu gap giả.
- [x] Batch được checkpoint nguyên tử và có thể tiếp tục mà không chạy lại mục terminal hoặc ghi đè output đã publish.
- [x] STTN dùng cache theo toàn bộ bằng chứng đầu vào và chỉ tái sử dụng artifact đã kiểm chứng.
- [x] Log được giữ qua lần thoát app, có rotation và telemetry stage/request/encoder.
- [x] Typecheck, toàn bộ local-runtime tests, subtitle tests, font verification, Windows packaging và asset verification hoàn thành.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** validator OCR ổn định, journal/resume batch, reconciliation output, cache STTN, log retention, telemetry, IPC/UI resume, build WinLocal 0.1.26.
- **Nằm ngoài phạm vi:** chạy soak 90 video có tính phí; tái dựng chính xác lỗi TTS cũ vì WAV/request body của phiên 0.1.23 đã bị xóa.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Journal là nguồn dữ liệu chính ở Main process, ghi atomic kèm checksum/revision/backup để chịu được việc app bị tắt giữa batch.
- Output chỉ được reconcile thành công khi completion manifest, source digest, config digest và file output đều hợp lệ.
- Khóa cache STTN chứa source SHA-256, toàn bộ timeline OCR canonical, geometry, model revision/hash, protocol/provider/options; lease được giữ đến khi render kết thúc.
- Không ép NVENC: graph thực tế hiện chạy được với `h264_nvenc`; telemetry mới ghi từng encoder attempt để lần fallback kế tiếp có nguyên nhân cụ thể.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/main/autoShortBatchStore.ts`, `src/shared/autoShortBatchJournal.ts`: lưu và phục hồi batch.
- `[MODIFY]` `src/main/autoshort.ts`, `src/main/autoShortItemCoordinator.ts`, `src/main/autoShortQueueRunner.ts`: checkpoint, reconcile, cache STTN và resume.
- `[MODIFY]` `src/shared/types.ts`, `src/preload/index.ts`, `src/renderer/src/components/AutoShort.tsx`: IPC có kiểu và giao diện tiếp tục batch.
- `[NEW/MODIFY]` `src/main/logRetention.ts`, `src/main/logger.ts`, `src/main/autoShortTelemetry.ts`, `src/main/burn.ts`, `src/main/tts.ts`: log bền vững và telemetry nguyên nhân chậm/fallback.
- `[NEW/MODIFY]` các test journal/store/resume/log/STTN/OCR và 13 fixture lỗi thực tế đã tối giản.
- `[MODIFY]` `docs/architecture.md`, `docs/adr/006-sttn-inpainting-vs-masked-blur.md`, `package.json`, `package-lock.json`.

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
npm run typecheck
npm run test:local-runtime
npm run test:subtitles
npm run fonts:prepare
npm run fonts:verify
npm run package:win
npm run release:verify-assets
```

### Kết quả thực tế

- `Typecheck`: PASS, 0 lỗi.
- `test:local-runtime`: PASS toàn bộ suites; real burn/ASS test chọn `h264_nvenc` trên GTX 1660 SUPER.
- `test:subtitles`: logic PASS; nhánh render của script bị skip do FFmpeg không có trong PATH, trong khi real burn test dùng runtime ghim đã PASS.
- Font: PASS bốn font ghim checksum, tổng 12.90 MiB.
- Windows package và asset verification: PASS cho 0.1.26.
- Installer SHA-256: `BE4FF869A38AC6639104A4A297DF153102FAA588394F78A729B10A8C73DA862D`.
- Installed `app.asar` SHA-256: `A643DF7FAE47A8E174EA76898BA28A75ACDAF3E52B69B2220E9062103F9C9761`.
- Packaged và installed smoke log đều xác nhận `TediaPros 0.1.26`, FFmpeg có sẵn, GTX 1660 SUPER/CUDA 13.2 tăng tốc được.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Chưa chạy acceptance soak 90 video/12 giờ vì cần cấu hình/provider hiện hành và phát sinh chi phí thực tế.
- Nguyên nhân chính xác khiến build 0.1.23 dùng `libx264` là UNKNOWN do log cũ không ghi encoder attempts; 0.1.26 đã bổ sung bằng chứng cho lần sau.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Bản 0.1.23 đã được sao lưu tại `C:\Users\PC\AppData\Local\TediaProsRollback\0.1.23-20260912` trước khi cài đè.
- Khi chạy batch thật tiếp theo, theo dõi journal chưa hoàn tất trong userData và telemetry theo từng stage để so sánh throughput với baseline 15 video/7 giờ 55 phút.
