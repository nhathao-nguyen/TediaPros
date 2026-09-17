# TASK-20260915-GATEWAY-V2-REVIEW: Review triển khai Antigravity và sửa lỗi hợp đồng phản hồi

- **Trạng thái:** F1–F7, route-capacity fallback, preflight và prompt v8 đã
  được harden trong code/test. Route hiện tại đã được probe xác minh và hai run
  live bounded (Volvo 44 cue, nguồn thật 113 cue) đều hoàn tất; TTS/render vẫn
  ngoài phạm vi task này.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-15

## 1. Mục tiêu

Đối chiếu implementation report, design/plan và code của TediaPros + CreateMediaTool; điều tra lỗi video `2025-02-28_一年只给你180万…7476397286323539226.mp4`. Sửa lỗi chặn dịch trong ảnh, kiểm chứng qua client thật và gateway đang chạy.

Baseline: TP `d73db03`, CMT `f44b6ac`, cộng bản sửa completion marker chưa commit từ lượt trước. Không ghi đè các thay đổi/video/chẩn đoán đang có trong hai checkout.

## 2. Tiêu chuẩn nghiệm thu

- [x] Xác định thông báo đầy đủ từ log và điều kiện code phát sinh lỗi.
- [x] Tái hiện lỗi bằng dữ liệu phản hồi đúng của gateway trước khi sửa client.
- [x] Go DTO và TypeScript dùng cùng fixture wire contract; giữ từ chối phản hồi thiếu/sai phiên bản, sai model, chưa hoàn tất.
- [x] Typecheck, các test liên quan, build và kiểm tra diff thành công.
- [x] Chạy riêng nguồn 19 cue của video lỗi qua hai lượt adapter/gateway thật.
- [x] Khởi động lại TediaPros và xác nhận process, cửa sổ, dev URL, bundle mới.
- [x] Đóng F2–F7 bằng code, contract và regression test.
- [x] Historical live 113-cue/Volvo: hai stage từng hoàn tất với evidence
  `matched`/`complete`; xem hardening artifact.
- [x] Nghiệm thu live route hiện tại bằng prompt v8: probe model, Volvo 44 cue
  và nguồn thật 113 cue đều có evidence matched/complete.
- [ ] Kiểm thử TTS/render toàn video sau bản sửa: chưa chạy trong review này.

## 3. Phạm vi

Ban đầu sửa production code ở `src/main/geminiGateway.ts` và thêm fixture/test
TP cùng test serialization DTO CMT. Đợt hardening tiếp theo mở rộng đúng các
finding F2–F7 ở adapter/checkpoint/parser và CMT provider/OpenAI; không chạm
queue/checkpoint thực của người dùng. CMT cần restart để nạp binary mới.

## 4. Findings theo mức ưu tiên

Các bullet mô tả code ở thời điểm review. Trạng thái trên mỗi heading và phần
"Cập nhật hardening" dưới đây phản ánh source hiện tại.

### F1 — P1 — Sai tên trường response version, khiến mọi bản dịch v2 bị từ chối — ĐÃ SỬA

- TP `src/main/geminiGateway.ts:234,264` đọc `gateway_metadata.contract_version`.
- CMT `internal/modules/openai/dto/openai_dto.go:289` và spec trả `gateway_metadata.gateway_contract_version`.
- `contract_version` chỉ là trường yêu cầu bên trong `gateway_requirements`, không phải tên trường response.
- Log thực `C:/Users/PC/AppData/Roaming/tedia-pros-dev/logs/tblao-session-3151fb2e-fb28-4650-be56-a248afe4c4fb.log`, 2026-09-15 03:06:09–03:06:40 UTC: 19 cue, stage restore-translate, lỗi “không trả về hợp đồng phiên bản 2”.
- Mock trong contract test và draft-resume cũng dùng tên sai, vì vậy test cũ che mất lỗi tích hợp. Chỉ sửa mock sang key đúng đã làm 7 test thất bại; sửa client giúp chúng pass.
- Chỉ chấp nhận số `2` ở key response chuẩn. Không thêm fallback nhận key sai, không bỏ kiểm tra model/completion, không gọi JSON repair để che lỗi hợp đồng.

**Bằng chứng:** TEST_CONFIRMED + LIVE_CONFIRMED (chi tiết mục 6).

### F2 — P1 — Retry chưa có một chủ sở hữu duy nhất — ĐÃ SỬA, TEST_CONFIRMED

- TP `src/main/translation/orchestrator.ts:334-360`: mọi lỗi được phân loại retryable vẫn enqueue lại adapter. `independentContentReview` chỉ chặn semantic recovery ở đoạn sau, không chặn transport retry. Adapter gateway phân loại upstream-incomplete/5xx/network/timeout là transient.
- CMT `internal/modules/openai/openai_service.go:157-188`: vòng 3 lần structured generation retry mọi lỗi trước attempt cuối; không có gate loại model/auth/unknown-completion/timeout theo design. `WithAttemptLimit(1)` chỉ giới hạn vòng provider bên trong.
- Hệ quả: lỗi transient có thể làm TP gọi lại cả stage sau khi CMT đã thử nhiều lần. Dòng UI “2 lượt/video” không chứng minh trần generation tối đa 6. Một video chạy bình thường 2 generation ở mục 6 không kiểm chứng các nhánh lỗi này.
- Hướng sửa: capability retry ownership rõ ràng; TP không tự gọi lại gateway sau lỗi stage; CMT quyết định retry bằng typed code/response completion, dừng model/auth/cancel/timeout/limit/unknown completion. Thêm test đếm call ở cả hai tầng và review-stage failure, không chỉ queue/coordinator.

**Bằng chứng:** CODE_CONFIRMED. Không bơm lỗi mạng vào app đang dùng để thử đếm generation thật.

### F3 — P1 — Draft resume chưa kiểm tra route hiện tại và parser version — ĐÃ SỬA, TEST_CONFIRMED

- TP `src/main/geminiGateway.ts:472-499`: identity gồm alias/model, prompt version, locale, số cue; source digest được kiểm tra, nhưng không có parser version hoặc so sánh route đang dùng.
- `src/main/geminiGatewayDraftCheckpoint.ts:66`: chỉ yêu cầu `routeFingerprint` là chuỗi không rỗng; không đối chiếu expected/current fingerprint. File cũ có SHA đúng vẫn có thể được dùng lại sau thay đổi route/tài khoản/parser.
- Design mục draft yêu cầu tất cả các định danh này khớp. Báo cáo implementation nói đã khớp route nhưng code chưa làm.
- Hướng sửa: đưa parser version và current route fingerprint vào điều kiện reuse; xác minh exact ID set và metadata checkpoint trước khi resume. Lấy fingerprint qua capability/catalog không generation. Test route đổi, parser đổi, ID thiếu/thừa, locale/source đổi và checkpoint corrupt.
- Reader hiện còn dùng JSON.parse thường, một lần read, catch toàn bộ lỗi thành cache miss; kiểm tra file sâu và giới hạn cần đối chiếu thêm với design trước khi nghiệm thu tính bền vững.

**Bằng chứng:** CODE_CONFIRMED.

### F4 — P1 — Metadata có thể khẳng định complete/matched khi không có đủ bằng chứng — ĐÃ SỬA, TEST_CONFIRMED

- CMT `internal/modules/openai/openai_service.go:326-343`: có observed ID là gán `matched`; completion state trống được gán `complete`; completion evidence được hardcode ngay cả khi `response.Evidence` không tồn tại.
- `:270-274` ghi verified cache chỉ với observed ID không rỗng, không kiểm tra matched/completion ngay tại điểm ghi.
- `internal/modules/providers/gemini_service.go:685-700`: parse khi một trong hai strict flag bật, nhưng `verifyResponseRoute` chỉ chạy khi RequireVerifiedModel bật; RequireCompleteResponse bật riêng chưa tự enforce completion.
- TediaPros hiện bật cả hai flag nên đường strict có gate ở provider; finding này không được kết luận là nguyên nhân screenshot F1. Tuy nhiên caller non-strict/complete-only có thể nhận telemetry/cached status không đúng mức chứng minh.
- Hướng sửa: metadata mặc định unknown; truyền kết quả kiểm chứng thực từ provider, kiểm tra hai yêu cầu độc lập; chỉ ghi cache khi model khớp và response complete. Thêm tests absent evidence, incomplete, complete-only và non-strict mismatch.

**Bằng chứng:** CODE_CONFIRMED.

### F5 — P1 — Alias Pro chưa khóa chính xác phiên bản 3.1 Pro — ĐÃ SỬA, TEST_CONFIRMED

- CMT `internal/modules/providers/gemini_model_catalog.go:229-241`: alias chứa `pro` và route đầu tiên có display name chứa `pro` đều được chọn thành gemini-advanced.
- Nếu catalog có Pro phiên bản khác trước 3.1 Pro, resolver có thể chọn route đó; observed ID sau đó khớp chính route sai nên gate ID không phát hiện yêu cầu “3.1 Pro” bị vi phạm.
- Hướng sửa: so khớp định danh phiên bản được phép, từ chối thiếu/không rõ; không match substring rộng. Thêm catalog reordered, unavailable-first, nhiều Pro version và alias image-Pro.
- Mẫu live lần này đã quan sát đúng 3.1 Pro; không có bằng chứng tài khoản hiện tại bị chọn sai ở lượt replay.

**Bằng chứng:** CODE_CONFIRMED cho điều kiện có thể chọn sai; LIVE_CONFIRMED cho route đúng trong replay.

### F6 — P2 — Mất lỗi gốc ở lần chuẩn hóa JSON cuối — ĐÃ SỬA, TEST_CONFIRMED

- CMT `internal/modules/openai/openai_service.go:201-219`: khai báo lại `var normErr *NormalizationError` che biến lỗi normalize phía ngoài, rồi gọi `errors.As(err, &normErr)` với `err` của generation vừa thành công (nil).
- Hệ quả: lỗi normalization cụ thể bị đổi thành `invalid-json`; lý do có thể thành `<nil>`, làm chẩn đoán lỗi thật khó hơn.
- Hướng sửa: dùng biến typed error tên khác và `errors.As(normErr, &typedNormErr)`, wrap lỗi normalization thực. Test duplicate-key/ambiguous-json/response-limit tại attempt cuối.

**Bằng chứng:** CODE_CONFIRMED.

### F7 — P2 — Normalizer coi backtick trong chuỗi JSON là Markdown bên ngoài — ĐÃ SỬA, TEST_CONFIRMED

- CMT `internal/modules/openai/structured_json.go:75-110`: `strings.Contains(trimmed, "```" )` kích hoạt fence parser trước khi phân biệt chuỗi JSON.
- Ví dụ object hợp lệ có giá trị `"Đoạn mã dùng ``` để mở khối."` bị từ chối như fence chưa đóng; nội dung nói về lập trình/Markdown có thể gây retry không cần thiết.
- Hướng sửa: thử strict raw JSON trước hoặc chỉ nhận fence khi nó là wrapper bao trọn đầu/cuối; giữ từ chối prose/đa object/duplicate key. Thêm cùng vector Go/TS cho literal backticks, escaped quotes/Unicode và wrapper hợp lệ có backticks trong string.
- 12 vectors hiện có chưa đủ để chứng minh parity cho mọi JSON hợp lệ.

**Bằng chứng:** CODE_CONFIRMED; xem cập nhật hardening và các vector parity bên dưới.

### Cập nhật hardening F2–F7 (2026-09-15)

- **F2:** `transportRetryOwner: 'gateway'` làm TP dừng retry tầng ngoài. CMT
  giới hạn provider một attempt/generation và chỉ retry tối đa ba lần cho
  transport 5xx/network xác định hoặc JSON sai sau completion. Model/auth,
  incomplete, limit, cancel và timeout dừng ngay với error code trung thực.
- **F3:** draft schema v2 xác minh raw SHA-256, JSON/Unicode/ID, source digest,
  locale, draft+review prompt version, parser version và route fingerprint lấy
  bằng `GET /gateway/capabilities` không tốn generation. Mọi mismatch/corrupt
  là cache miss.
- **F4:** parser evidence gắn model/terminal marker vào cùng candidate; metadata
  không có evidence giữ `unverified`/`unknown`; verifier cache chỉ ghi khi cả
  model matched lẫn completion complete.
- **F5:** `gemini-advanced` chỉ resolve display name đúng `3.1 Pro`; các Pro
  version khác, `3.10` và image-Pro bị loại.
- **F6/F7:** lỗi normalization cuối được wrap từ lỗi thật với code giữ nguyên.
  Go/TS parse raw JSON trước, chỉ unwrap một fence ngoài hợp lệ, chấp nhận
  backtick trong string và reject surrogate đơn lẻ/duplicate/ambiguous JSON.

**Bằng chứng:** TEST_CONFIRMED qua `gemini-gateway-contract`,
`gemini-gateway-draft-resume`, `translation-orchestrator`, `ai-output` và các
package Go providers/OpenAI/DTO; live gate tách riêng ở mục 6.

## 5. Danh sách thay đổi

- TP `src/main/geminiGateway.ts`: key response chuẩn và thông báo lỗi nêu đúng đường dẫn trường, không mặc định chỉ đổ lỗi gateway cũ.
- TP `tests/gemini-gateway-contract.test.ts`: fixture metadata chuẩn; test từ chối version thiếu/1/chuỗi `"2"` dù key request cũ có giá trị 2.
- TP `tests/gemini-gateway-draft-resume.test.ts`: sửa mock response chuẩn.
- TP `tests/fixtures/gemini-gateway-v2-metadata.json`: bản sao wire fixture được Go DTO xác minh.
- CMT `internal/modules/openai/dto/gateway_metadata_contract_test.go` và `testdata/gemini-gateway-v2-metadata.json`: serialize DTO production rồi so sánh toàn bộ trường JSON với fixture.
- TP checkpoint v2, retry ownership, prompt v5 và parser JSON parity; CMT
  exact-model resolver, candidate-scoped evidence, typed retry/error metadata
  và controller capability route fingerprint.
- Handoff này, bổ sung trạng thái review vào implementation report/investigation/spec vận hành.
- Harness và bằng chứng dưới `.ai/tasks/2026-09-15-gateway-v2-review/`; không chạm checkpoint của người dùng.

## 6. Kiểm chứng và giới hạn

### Offline

Lệnh đã chạy từ đúng root:

```powershell
# TediaPros
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs ai-output.test gemini-gateway-contract.test gemini-gateway-prompts.test gemini-gateway-draft-resume.test translation-response.test translation-provider-contract.test translation-resume.test translation-identity.test autoshort-ui-contract.test
npm.cmd run build
git diff --check

# CreateMediaTool
go test ./internal/modules/providers ./internal/modules/openai/... ./internal/commons/utils -count=1
git diff --check
```

Typecheck node/web, 9 nhóm TS (65 test), 4 Go packages, build và diff check
PASS. Build vẫn có cảnh báo mixed dynamic/static import có sẵn, không phải lỗi
build. Hai bản fixture có cùng SHA-256
`F289E2D045F6FC8CC24ABD5A1A24EED2DD5E1B8BC4CD2F66EF1F3BE12B3A52DD`.

### Replay live 19 cue

- Nguồn đọc từ checkpoint `7c39e1da-b740-440c-b8ae-6b90eedd74dc`, giữ nguyên text/ID/thời gian, group ID theo cách production dựng ledger; target vi-VN, mode dubbing, không glossary/synopsis bổ sung.
- Gọi production adapter `requestOnce` với planner một batch; endpoint đang chạy `http://127.0.0.1:4982/openai/v1/chat/completions`. Không giả lập phản hồi provider; chỉ mock Electron app.getPath trong harness Node độc lập.
- Draft và independent-review đều HTTP 200, `gateway_contract_version:2`, `model_verification:matched`, `completion_state:complete`, observed `3.1 Pro / e6fa609c3fa255c0`.
- **2 HTTP generation requests, 2 upstream attempts, 0 retries**, 19/19 ID; parser không có issue. Dữ liệu thật ở `2026-09-15-gateway-v2-review/live-19/{source,envelopes,audit,result}.json`.
- Harness lần đầu nhận output path tương đối nên safeContainedPath chặn ghi draft checkpoint; hai stage dịch vẫn thành công. Đã sửa harness sang absolute path cho lần sau. Không gọi lại Gemini chỉ để sửa artifact chẩn đoán và không tuyên bố live checkpoint-resume đã pass.
- Phản hồi giữ các điểm chính như 1,8 triệu/năm, bốn bữa ăn/ngày, trực thăng một lần/tháng, bốn ngày nghỉ; phục hồi được các đoạn ASR hỏng như “与世格觉得钻景平台” thành giàn khoan biệt lập, “结局按上指休息四天” thành vào bờ nghỉ bốn ngày. Đây là đối chiếu văn bản, chưa nghe nguồn để chứng minh mọi khôi phục.
- **Chất lượng locale chưa đạt hoàn toàn:** review vẫn viết “mười mấy vạn tệ”; tiếng Việt tự nhiên hơn là “hơn một trăm nghìn tệ”. Việc thêm đơn vị “tệ” là suy luận từ ngữ cảnh Trung Quốc; ASR đầu vào không ghi rõ đơn vị tiền. Cần rubric về đơn vị/số và bằng chứng nguồn, không chỉ test JSON/cue count. Không chấm semantic gate toàn bộ bằng kết quả mock.
- Không chạy lại toàn bộ TTS/render, không ghi bản replay vào final checkpoint của user, không chạy hàng loạt để chọn mẫu đẹp. Hai live gates 113-cue/Volvo của planning vẫn chưa được chứng minh bởi replay 19 cue này.

### Cập nhật live v5, route hiện tại và prompt v8 (2026-09-15)

- Ba harness riêng đã chạy historical two-stage v5: fixture 113 cue, Volvo 44
  cue và nguồn 113 cue thực tế. Mỗi run có đúng **2 client generation / 2
  upstream attempts**, hai response `matched` + `complete`, observed label
  `3.1 Pro`, full cue ID set và parser không lỗi. Đây là proof của route tại
  thời điểm capture, không phải chứng nhận cho catalog hiện tại.
- Sau khi catalog refresh, `verify-model` quan sát **Flash-Lite** thay vì 3.1
  Pro. Điều tra xác nhận catalog có thể bỏ tier legacy, khiến exact Pro route
  nhận capacity generic. CMT hiện chỉ nâng fallback đó cho exact 3.1 Pro;
  TP verify model trước dispatch và CMT cache mismatch 2 phút. Response sai
  evidence bị từ chối, không được dùng để dịch.
- Session Gemini được làm mới, binary gateway current-route verify đã observed
  `3.1 Pro`, và hai run prompt v8 có đúng **2 client generation / 2 upstream
  attempts** mỗi run, không retry. Volvo không còn gọi control là vô lăng hay
  dùng `độc quyền`; ảnh nguồn xác nhận `cành sồi` là khôi phục ASR đúng.
- Nguồn thật 113 cue giữ `169` không thêm `tệ`/đơn vị khác. Xem
  `2026-09-15-gateway-v2-hardening/semantic-review.md`. Không chạy TTS/render
  từ fixture ledger và không biến kết quả test thành checkpoint của user.

### Nạp app

Đóng app/dev session cũ sau khi xác nhận queue đang lỗi, build PASS rồi chạy lại dev từ checkout chính. Các PID lịch sử chỉ là evidence lúc capture; trạng thái runtime hiện hành phải được kiểm tra lại sau mỗi restart. Không xóa dữ liệu queue/checkpoint để làm mất trạng thái lỗi cũ.

## 7. Bàn giao

Lỗi hợp đồng trong ảnh đã được sửa; route hiện tại đã được live-qualified bằng
model check bounded và hai run v8. Trạng thái lỗi đã lưu từ lần trước không tự
biến thành bản render hoàn thành.

F2–F7 đã được đóng bằng negative/regression tests. TTS/render chỉ nên chạy khi
có source video/checkpoint hợp lệ, để không biến fixture text thành công việc
render giả.
