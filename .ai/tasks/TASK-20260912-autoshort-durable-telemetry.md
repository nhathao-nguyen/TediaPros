# TASK-20260912-AUTOSHORT-DURABLE-TELEMETRY: Log bền vững và telemetry quy nguyên nhân

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-12

---

## 1. Mục Tiêu (Goal)

Giữ bằng chứng sau khi đóng TediaPros và đo đủ ranh giới chậm/lỗi của AutoShort để phân biệt thời gian chờ tài nguyên, request server, xử lý DSP, STTN, retime, render và sao chép artifact.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Đóng ứng dụng không xóa log; mỗi phiên có file riêng.
- [x] Rotation không xóa file active; mặc định giữ 7 ngày và tối đa 100 MiB.
- [x] Clear log vẫn xóa theo thao tác công khai của người dùng.
- [x] `cancelled`, `timeout`, `transport`, `provider`, `content` và `unknown` là các loại lỗi riêng.
- [x] Request TTS có queue/start/first-response/end, status, request ID, retry index/reason.
- [x] Encoder attempt có codec, kết quả, thời gian, exit code, diagnostic đã lọc và codec cuối.
- [x] Telemetry có stage metadata, separation, retime và artifact copy.
- [x] Typecheck và test liên quan pass.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** logger session/retention, telemetry schema, TTS request spans, encoder attempts, stage instrumentation và tài liệu.
- **Nằm ngoài phạm vi:** thay thuật toán encode, đổi concurrency, retry thêm ngoài chính sách Chatterbox hiện hữu hoặc ghi request body chứa nội dung/secret.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- File active có tên `tblao-session-<uuid>.log`; API `logFilePath()` vẫn trả đúng file để UI mở.
- Legacy `tblao.log` và `tblao-previous-crash.log` được chuyển thành session archive, không bị ghi đè.
- Retention tính cả active file vào quota nhưng tuyệt đối không xóa active; archive cũ nhất bị dọn trước.
- Telemetry chỉ lưu endpoint alias đã sanitize, không lưu header Authorization, API key hoặc request body.
- `TimeoutError` và deadline được ghi `timeout`; `AbortError` do người dùng được ghi `cancelled`.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/main/logRetention.ts`
- `[MODIFY]` `src/main/logger.ts`, `src/main/index.ts`, `src/main/support.ts`
- `[MODIFY]` `src/main/autoShortTelemetry.ts`, `src/main/autoShortItemCoordinator.ts`
- `[MODIFY]` `src/main/tts.ts`, `src/main/autoshort.ts`, `src/main/burn.ts`
- `[MODIFY]` `src/shared/types.ts`
- `[NEW]` `tests/log-retention.test.ts`
- `[MODIFY]` `tests/autoshort-telemetry.test.ts`, `tests/autoshort-tts-pipeline.test.ts`, `tests/sttn-pipeline.test.ts`, `tests/local-runtime.test.ts`
- `[MODIFY]` `scripts/run-local-runtime-tests.mjs`, `docs/architecture.md`

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

```powershell
node scripts/run-local-runtime-tests.mjs log-retention.test
node scripts/run-local-runtime-tests.mjs autoshort-telemetry.test
node scripts/run-local-runtime-tests.mjs autoshort-tts-pipeline.test
node scripts/run-local-runtime-tests.mjs sttn-pipeline.test
node scripts/run-local-runtime-tests.mjs burn-video-title.test
node scripts/run-local-runtime-tests.mjs autoshort-ocr-pipeline.test
node scripts/run-local-runtime-tests.mjs local-runtime.test
npm.cmd run typecheck
npm.cmd run dev
```

- `log-retention`: PASS 3/3.
- `autoshort-telemetry`: PASS 13/13.
- `autoshort-tts-pipeline`: PASS 6/6.
- `sttn-pipeline`: PASS 9/9.
- `burn-video-title`: PASS 10/10.
- `autoshort-ocr-pipeline`: PASS 12/12.
- `local-runtime`: PASS 157/157, gồm render FFmpeg thật bằng `h264_nvenc` trên media fixture.
- `typecheck`: PASS node + web.
- Smoke dev: cửa sổ 0.1.25 khởi động, `CloseMainWindow()` trả `true`, Electron thoát sạch và file session 818 byte vẫn còn trong `tedia-pros-dev/logs`.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Chưa dùng telemetry mới cho batch 90 video; cần batch journal/resume trước khi chạy dài.
- Việc codec nào thắng trên graph AutoShort thật vẫn phải benchmark ở Task 5; lần kiểm tra media fixture này chứng minh đường NVENC hoạt động, chưa chứng minh mọi graph.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Tiếp tục Task 3: journal batch nguyên tử và resume chỉ các item chưa có receipt hợp lệ.
