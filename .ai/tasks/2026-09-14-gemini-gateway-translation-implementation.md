# TASK-20260914-GEMINI-GATEWAY-TRANSLATION: Dịch short hai lượt qua Gemini 3.1 Pro

- **Trạng thái:** Hoàn thành triển khai v3; đã kiểm chứng code, build, gateway live và regression 113 cue
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-14

---

## 1. Mục Tiêu (Goal)

Chuyển luồng dịch AutoShort sang CreateMediaTool gateway, dùng wire model `gemini-advanced`, giữ toàn bộ short trong cùng ngữ cảnh và dùng hai generation độc lập để khôi phục nguồn, dịch tự nhiên theo locale, rồi rà soát và sửa bản nháp.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Một short 44 cue được gửi trong một batch, không bị chia tại cue 24.
- [x] Luồng thành công gọi đúng hai generation request và lượt hai nhận cả nguồn lẫn bản nháp.
- [x] Mọi request cố định `gemini-advanced`; client từ chối model fallback.
- [x] Cue ID/timestamp được giữ bằng code và output phải đúng JSON contract.
- [x] Preflight kiểm tra capability/model mà không gọi generation.
- [x] `npm run typecheck` pass.
- [x] Test TediaPros và CreateMediaTool liên quan pass.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** AutoShort translation adapter, UI provider/URL, IPC, planning/cache identity, schema validation, model observability và capability endpoint trong gateway.
- **Giới hạn hiện tại:** Hai lượt dùng toàn bộ SRT/ASR text, glossary và synopsis. Chưa đưa audio, OCR frame hoặc visual evidence vào prompt. Gateway hiện chỉ dừng upstream theo timeout; client abort không bảo đảm dừng generation đã gửi.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Mỗi adapter call gồm hai generation tuần tự để lượt review độc lập có thể phát hiện lỗi tên riêng, số liệu, quan hệ chủ-vị và văn phong địa phương.
- Wire response dùng compact keyed JSON `translations{cue-id:text}`; adapter dựng lại `items[{id,text}]` trước parser nên code vẫn giữ quyền sở hữu cue identity và timestamp.
- Capability endpoint khai báo rõ schema là `prompt-only`, usage/revision không có và cancel là `timeout-only`.
- Model identity và prompt version nằm trong checkpoint fingerprint để không trộn cache cũ với luồng mới.
- Prompt v3 bắt reviewer khôi phục dấu câu toàn bài và sửa văn phong dịch sát chữ trước khi xuất bản. Gateway thay chỉ dẫn ranh giới source-only cũ, tránh prompt tự mâu thuẫn. Dubbing dùng ranh giới đích này sau validation; source cue ID/timestamp, pause dài và speaker boundary vẫn do code giữ.
- Nút `Thử lại dịch` chuẩn bị retry generation rồi tự chạy đúng item trong một thao tác.
- Artifact audit lưu hai request/response, hash, model, finish reason, số attempt và lý do retry; không lưu cookie gateway.
- Bộ chia caption dùng tối ưu động để cân bằng dòng, ưu tiên ranh giới mệnh đề và tránh cắt giữa các cụm tiếng Việt thông dụng.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/main/geminiGateway.ts`
- `[NEW]` `tests/gemini-gateway-contract.test.ts`
- `[MODIFY]` `src/main/autoshort.ts`, `src/main/autoShortItemCoordinator.ts`, `src/main/index.ts`, `src/main/dubbing/plan.ts`, `src/main/dubbing/subtitles.ts`
- `[MODIFY]` `src/main/translation/planner.ts`, `src/main/translation/response.ts`
- `[MODIFY]` `src/shared/types.ts`, `src/shared/autoShortContract.ts`
- `[MODIFY]` `src/renderer/src/components/AutoShort.tsx`, `src/renderer/src/lib/dichProvider.ts`
- `[MODIFY]` `scripts/run-local-runtime-tests.mjs`, `docs/domain.md`, `docs/architecture.md`
- `[MODIFY]` CreateMediaTool OpenAI/Gemini DTO, service, provider và capability endpoint.

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs gemini-gateway-contract.test translation-planner.test autoshort-ui-contract.test
node scripts/run-local-runtime-tests.mjs gemini-gateway-contract.test dubbing-plan.test translation-rephrase.test local-runtime.test
node scripts/run-local-runtime-tests.mjs gemini-gateway-contract.test dubbing-grouping.test dubbing-plan.test translation-rephrase.test
npm.cmd run build
go test ./...
```

### Kết quả thực tế

- `Typecheck`: PASS, node và web đều 0 lỗi.
- TediaPros: PASS 18/18 test được chọn (3 gateway, 11 planner, 4 UI contract).
- Regression cuối: PASS 231/231 test được chọn (4 gateway, 50 dubbing plan, 20 translation rephrase, 157 AutoShort local runtime).
- Production build: PASS; Main, preload và renderer đều được tạo thành công.
- CreateMediaTool: PASS toàn bộ package Go; model resolver giữ chính xác `gemini-advanced`.
- Regression v3: PASS 113/113 test được chọn, gồm contract compact đủ 113/113 cue, one-click retry, fixture 28 cue của video châu Phi và dubbing recovery.
- `LIVE_CONFIRMED`: bản Volvo 44/44 cue chạy thành công qua gateway bằng đúng 2 gateway call; không còn `Wooting`/`pixel`, có `Volvo` và `sồi`. Output và bằng chứng nằm trong `.ai/tasks/2026-09-14-volvo-translation-review/`.
- `LIVE_CONFIRMED`: binary v2 đang chạy PID `13904`, SHA-256 `2291F21F51C018E7A12771600923DC9D27D98383EDA4BD2FCFC65923B177641F`, cổng 4982, có `gemini-advanced`, structured request cap 3.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Live Volvo thành công trước khi thêm trần retry cuối đã quan sát 8 upstream attempts trong 2 gateway call. Bản cuối đã loại retry nhân tầng và công bố trần 3 attempts/call; trần này được test và xác minh qua capability nhưng không tiếp tục tiêu thụ Gemini để lặp lại toàn bộ ca Volvo.
- Output hiện vẫn dựa trên SRT/ASR text. Chưa có audio hoặc OCR frame làm evidence trực tiếp cho Gemini.
- Lượt lỗi thực tế của video dao thái rau được xác định từ log: attempt 1 và 2 nhận transient failure của Gemini; request kết thúc sau attempt 3 vì không có JSON object hợp lệ. Chưa chạy lại video này bằng Gemini sau v3, nên kết quả live vẫn là `LIVE_RERUN_PENDING`.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Số gateway call bình thường là 2/video. Mỗi call có tối đa 3 upstream Gemini attempts khi gặp thông báo lỗi tạm thời hoặc JSON không phải một object hoàn chỉnh, nên trần dịch chính là 6 upstream attempts/video. Rephrase TTS là request phát sinh riêng; log phân biệt `request=1/2`, `request=2/2`, `request=extra` và số `upstreamAttempts`.
- Muốn khôi phục dựa trên âm thanh/hình ảnh cần bổ sung SourceEvidencePack và chính sách upload/reuse asset; không suy diễn rằng phần text-only hiện tại đã có bằng chứng đó.
