# TASK-20260915-GATEWAY-V2-HARDENING: Hoàn thiện độ tin cậy Gateway v2

- **Trạng thái:** Code, offline regression, build và nghiệm thu live route hiện
  tại đã hoàn tất với prompt v8. Gateway xác minh `3.1 Pro`; Volvo 44 cue và
  nguồn thật 113 cue đều hoàn thành trong giới hạn request.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-15

## 1. Mục tiêu

Đóng các finding F2–F7 của review Gateway v2 mà không làm tăng số request tự
động, không tái dùng draft của route/parser cũ, và không biến dữ liệu thiếu bằng
chứng thành metadata thành công.

## 2. Tiêu chuẩn nghiệm thu

- [x] Gateway là chủ sở hữu duy nhất của retry transport/JSON; TediaPros dừng
  sau lỗi gateway và yêu cầu retry thủ công.
- [x] Draft chỉ được reuse khi khớp source, cue ID theo thứ tự, locale, hai
  prompt version, parser version và route fingerprint hiện tại.
- [x] Evidence model/completion, exact `3.1 Pro` route và JSON normalizer fail
  closed; hai implementation Go/TS dùng cùng vector JSON.
- [x] `npm.cmd run typecheck`, full local-runtime suite, `go test ./...` và hai
  build pass.
- [x] Khi catalog rơi về capacity generic, CMT chỉ nâng fallback capacity cho
  exact `3.1 Pro`; response evidence vẫn là gate cuối cùng.
- [x] AutoShort verify model trước khi dịch và cache mismatch ngắn hạn, nên
  queue không tiếp tục dịch khi observed model sai.
- [x] Một probe verify bounded xác nhận route hiện tại, sau đó hai run v8 dùng
  draft + review độc lập cho Volvo 44 cue và nguồn thật 113 cue.
- [ ] TTS/render toàn video: không chạy trong task này vì harness chỉ có ledger
  text và không được phép ghi đè queue/checkpoint của người dùng.

## 3. Phạm vi

- **TediaPros:** adapter Gateway, AutoShort preflight, draft checkpoint, prompt
  v8, orchestration, parser JSON dùng chung và test/fixture.
- **CreateMediaTool:** catalog route, parser evidence, service/controller
  OpenAI, normalizer JSON, DTO fixture và tài liệu vận hành.
- **Ngoài phạm vi:** không thay đổi queue/checkpoint của người dùng, không ghi
  cookie/token vào artifact, không tự chạy render/TTS từ fixture không có video.

## 4. Quyết định

- CMT giới hạn mỗi generation provider ở một HTTP attempt. Chỉ CMT có thể thử
  lại tối đa ba lần cho lỗi transport xác định hoặc JSON sai sau completion;
  adapter TP không tạo retry lồng nhau.
- Checkpoint draft schema v2 chứa identity đủ để reject stale route/parser và
  raw draft phải qua parser/ID validation trước khi reuse.
- Normalizer chỉ thực hiện các biến đổi có whitelist. Không đóng ngoặc, trích
  object lồng, hay đoán text bị cắt.
- Catalog hiện có thể thiếu tier legacy. `capacityForModel` chỉ nâng fallback
  cho exact 3.1 Pro; nếu evidence không khớp, response bị từ chối và mismatch
  được cache hai phút.
- Prompt v8 giữ giá trị số, đơn vị rõ ràng và phủ định; số trần giữ trần, không
  suy diễn tiền tệ từ quốc gia, sản phẩm hay ngữ cảnh. Nó chặn suy diễn loài,
  vật liệu, brand, place và claim pháp lý khi nguồn không đủ căn cứ, nhưng vẫn
  cho phép sửa homophone ASR/OCR có bằng chứng.

## 5. Tệp thay đổi chính

- `[MODIFY]` `src/main/geminiGateway.ts`, `src/main/geminiGatewayDraftCheckpoint.ts`,
  `src/main/geminiGatewayPrompts.ts`, `src/main/translation/orchestrator.ts`,
  `src/shared/aiOutput.ts`, `src/shared/translation.ts`.
- `[MODIFY]` `internal/modules/openai/{openai_service.go,openai_controller.go,structured_json.go}`.
- `[MODIFY]` `internal/modules/providers/{gemini_model_catalog.go,gemini_response_evidence.go,gemini_service.go}`.
- `[MODIFY]` gateway/translation tests and shared JSON/wire fixtures.
- `[MODIFY]` `docs/gemini-gateway-v2.md` and review/investigation records.

## 6. Kiểm chứng đã hoàn tất

```powershell
# TediaPros
npm.cmd run typecheck
npm.cmd run test:local-runtime
npm.cmd run build

# CreateMediaTool
go test ./... -count=1
go build -o .artifacts/gateway-v2/server-v8-20260915-1305.exe ./cmd/server
```

- **TEST_CONFIRMED:** Node/Web typecheck, full local-runtime suite, prompt v8
  budget/contract/checkpoint regression và full CMT suite pass với zero failures.
- **BUILD_CONFIRMED:** Electron/Vite build pass. Gateway candidate SHA-256 là
  `507C271E86EEDA8D59B6AB1EC4F04FF2EED36D4B6B8E89ECC2C4BF3A52802606`.
- **RUNTIME_CONFIRMED:** canonical `F:\Son\tool\CreateMediaTool\server.exe`
  đã được thay checksum-verified và restart trên port 4982; capabilities trả
  contract v2, provider ready, alias advanced và route fingerprint. TediaPros
  dev cũng đã restart, lắng nghe `http://localhost:5173/` và Electron khởi động.
- **HISTORICAL_LIVE_CONFIRMED:** run v5 cũ được giữ tách riêng, không dùng thay
  chứng cứ route hiện tại.
- **LIVE_CURRENT_CONFIRMED:** một probe verify bounded observed `3.1 Pro`.
  Prompt v8 hoàn thành Volvo 44 cue và nguồn thật 113 cue với đúng 2 client
  generation / 2 upstream attempts mỗi run, không retry. Cue số trần `169` giữ
  nguyên đơn vị trống; `cành sồi` Volvo được ảnh nguồn xác nhận là khôi phục ASR
  đúng. Chi tiết ở semantic review.

## 7. Bàn giao

The live harness and artifacts live below this task directory. It records only
fixture input, response metadata, canonical parsed result and a redacted audit;
it intentionally excludes request headers, cookie values and user queue state.

## 8. Số request mỗi video

- Route đã verify còn hiệu lực: **2 generation** — draft và independent review.
- Route mới hoặc cache verify hết hạn: **1 probe bounded + 2 generation**.
- Model mismatch: **1 probe**, dừng trước dịch và cache mismatch 2 phút. Không
  có probe/generation lặp vô hạn; user có thể kiểm tra lại sau khi session được
  làm mới.

## 9. Review ngữ nghĩa

Xem [semantic-review](2026-09-15-gateway-v2-hardening/semantic-review.md).
Review ghi nhận v5 từng tự suy diễn `tệ` từ số trần `169`; prompt v8 và live run
hiện tại đã chặn hành vi này. `Cành sồi` Volvo có OCR ảnh nguồn xác nhận, nên là
khôi phục ASR đúng thay vì suy diễn.
