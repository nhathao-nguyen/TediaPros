# TASK-20260917-gateway-p5-restoration: Khôi phục ASR dựa trên audio/OCR qua Gemini Gateway

- **Trạng thái:** Đã kiểm chứng offline và live transport canary; chưa đo chất lượng semantic trên video thật.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-17

---

## 1. Mục Tiêu (Goal)

Tự động khôi phục lỗi ASR có bằng chứng từ audio gốc và OCR, rồi dịch qua Gemini Gateway mà không yêu cầu người dùng duyệt từng cue.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Audio/OCR được đưa vào request Gateway của luồng AutoShort thực tế.
- [x] Cue ID và timestamp được giữ nguyên qua draft, review và resume.
- [x] Response thiếu/stale evidence, ID, review hoặc group coverage bị từ chối.
- [x] Resume hợp lệ không tạo lại ASR/OCR/audio/Gateway generation.
- [x] `npm.cmd run typecheck`, `npm.cmd run test:local-runtime`, và `npm.cmd run build` pass.
- [x] Gateway thật nhận audio qua Operation API, xử lý đúng một canary, trả response và ACK xác nhận operation terminal.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** Gemini Gateway, Operation API, checkpoint AutoShort, audio MP3 giới hạn, OCR timeline, strict validation và test fixture.
- **Nằm ngoài phạm vi:** Đo chất lượng semantic trên video sản xuất, suy diễn quota/IP của Google, hoặc tự động publish kết quả.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Hai Operation tách biệt cho draft và review.
- *Lý do:* Review không mặc định chấp nhận draft và có candidate digest riêng để chặn output cũ hoặc lẫn ngữ cảnh.
- *Lựa chọn:* Fail closed với partial/rejected group.
- *Lý do:* Không được xuất bản source edit hoặc bản dịch không có đủ bằng chứng chỉ vì batch phải tự động.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/main/translation/sourceRestoration.ts`
- `[NEW]` `src/main/translation/restorationAudio.ts`
- `[NEW]` `src/main/geminiGatewayRestoration.ts`
- `[MODIFY]` `src/main/autoShortItemCoordinator.ts`
- `[MODIFY]` `src/main/geminiGateway.ts`
- `[NEW]` `tests/autoshort-source-restoration.test.ts`
- `[NEW]` `tests/gateway-restoration-pipeline.test.ts`

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

```powershell
node scripts/run-local-runtime-tests.mjs autoshort-source-restoration.test
node scripts/run-local-runtime-tests.mjs gateway-restoration-pipeline.test
cmd.exe /c "npm.cmd run typecheck"
cmd.exe /c "npm.cmd run test:local-runtime"
cmd.exe /c "npm.cmd run build"
```

- `autoshort-source-restoration.test`: PASS, 7/7.
- `gateway-restoration-pipeline.test`: PASS, 2/2.
- `typecheck`: PASS.
- `test:local-runtime`: PASS, exit 0.
- `build`: PASS, exit 0.
- `CreateMediaTool go test ./...`: PASS sau khi thêm regression cho mã lỗi protocol của scheduler.
- Live transport canary: PASS trên `http://127.0.0.1:4982/openai/v1`; WAV 1 giây được dispatch một lần, có response và ACK terminal. Scheduler kết thúc ở `ready`, không còn request active/queued.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Fake-gateway tests chứng minh payload/callback/checkpoint cục bộ; live canary chỉ xác nhận transport/Operation API, không chứng minh Gemini hiểu chính xác audio/OCR của video sản xuất.
- `CreateMediaTool` chạy binary SHA-256 `14A672E68111A5611C147248AB30E65C6257B0B6E419B2B5C847596C4B1BEC51` tại port 4982. Gateway là owner governor duy nhất, `GET /gateway/scheduler` hoạt động và giới hạn request là 4 MiB.
- Không chạy thêm canary tự động trong batch. Khi có video không nhạy cảm, có thể đo riêng chất lượng semantic của restoration bằng một fixture có ground truth; không được suy diễn chính sách quota/IP của Google từ canary này.
