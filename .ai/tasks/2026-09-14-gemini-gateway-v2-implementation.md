# TASK-20260914-GATEWAY-V2-IMPLEMENTATION: Triển Khai Toàn Diện Gemini Gateway v2, Định Danh Model Theo Tài Khoản và Pipeline Dịch Hai Lượt Bền Vững

- **Trạng thái cập nhật 2026-09-15:** Lỗi response-version và các finding
  retry/resume identity/evidence/model routing/JSON normalization đã được sửa
  bằng hardening code + regression tests. Sau route Flash-Lite lịch sử, session
  mới đã xác minh route hiện tại là `3.1 Pro`; prompt v8 đã hoàn thành hai stage
  cho Volvo 44 cue và nguồn thật 113 cue trong đúng hai request mỗi run. Xem
  [review và bằng chứng](2026-09-15-gateway-v2-review.md),
  [hardening record](2026-09-15-gateway-v2-hardening.md) và
  [semantic review](2026-09-15-gateway-v2-hardening/semantic-review.md). Các
  bảng bên dưới giữ kết quả do tác giả báo cáo tại thời điểm 2026-09-14, không
  thay thế nghiệm thu hiện tại.
- **Người thực hiện:** Antigravity AI
- **Thời gian:** 2026-09-14
- **Kế hoạch & Thiết kế tham chiếu:**
  - [2026-09-14-gemini-gateway-reliability-design.md](../../docs/superpowers/specs/2026-09-14-gemini-gateway-reliability-design.md)
  - [2026-09-14-gemini-gateway-reliability.md](../../docs/superpowers/plans/2026-09-14-gemini-gateway-reliability.md)
  - [2026-09-14-gemini-gateway-v2-planning.md](2026-09-14-gemini-gateway-v2-planning.md)
  - [investigation.md](2026-09-14-gateway-root-cause/investigation.md)

---

## 1. Mục Tiêu (Goal)

Sửa chữa tận gốc nguyên nhân định tuyến sai model Gemini (gửi chuỗi ngẫu nhiên trong header `x-goog-ext-525001261-jspb` dẫn đến việc Google Web luôn phản hồi bản `3.8 Flash` thay vì `3.1 Pro`), chuẩn hóa định dạng JSON an toàn không đoán nội dung, hiện đại hóa bộ prompt dịch hai lượt (Draft + Review) đạt ngân sách kích thước <= 12 KiB cho 113 cues, cho phép khôi phục/resume review từ draft đã xác minh, và tích hợp cơ chế xác minh model minh bạch trên cả CreateMediaTool (Go) và TediaPros (TypeScript/React/Electron).

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] **Task 1 (CMT):** Model catalog theo tài khoản RPC, exact-label route
  `3.1 Pro`, xây dựng header theo route/account tier và loại bỏ ID ngẫu nhiên.
  Catalog fallback capacity được khóa riêng cho exact Pro; evidence response là
  điều kiện cuối cùng để chấp nhận.
- [x] **Task 2 (CMT):** Thu thập bằng chứng phản hồi (`observed_model_id`, `observed_model`, `completion_state`, `completion_evidence`) từ các frame RPC `wrb.fr`, không tự gán `resolved_model` làm bằng chứng.
- [x] **Task 3 (CMT & TP):** Chuẩn hóa structured JSON có giới hạn (bóc BOM, unwrap duy nhất 1 cặp code fence markdown hợp lệ), từ chối văn xuôi/fence dở/nhiều object/trùng key; đảm bảo độ tương đồng (parity) 100% giữa bộ chuẩn hóa Go và TS qua 12 test vectors cố định.
- [x] **Task 4 (CMT & TP):** Ban hành Hợp đồng Gateway v2 (`gateway_requirements`, `gateway_metadata`, mã lỗi có định kiểu); quy định Gateway là nơi duy nhất sở hữu retry generation (tối đa 3 lần/stage); chặn vòng lặp retry tự động ở cấp độ queue/coordinator của TediaPros khi gặp lỗi permanent hoặc exhausted.
- [x] **Task 5 (TP):** Xây dựng bộ prompt gọn hai lượt
  `gemini-gateway-two-pass-v8` với source ledger trực tiếp `{id, group_id, text}`;
  draft 113 cues <= 12 KiB và review <= draft + candidate + 4 KiB. V8 cấm suy
  diễn đơn vị tiền tệ, loài/vật liệu/brand/place/claim pháp lý khi nguồn không
  chứng minh, nhưng cho phép khôi phục homophone ASR/OCR có bằng chứng.
- [x] **Task 6 (TP):** Lưu trữ draft checkpoint nguyên tử (`gemini-gateway-draft.json`) khi hoàn thành stage 1; khi thử lại lượt review, tự động resume draft hợp lệ (khớp digest, locale, prompt version, route fingerprint) và bỏ qua stage 1 (tiết kiệm 1 generation request).
- [x] **Task 7 (CMT & TP):** Cung cấp API `POST /openai/v1/gateway/verify-model` với cache RAM 15 phút, coalesce probe đồng thời (10 request chỉ gọi 1 probe); mở rộng `GeminiStatus` và hiển thị trạng thái đã xác minh trên giao diện AutoShort; giới hạn kích thước audit log tối đa 16 MiB/file và 3 raw responses/stage; che chắn triệt để secret/token/cookie trong log và URL.
- [x] **Task 8 (CMT & TP):** Đạt 100% Typecheck (Go, Node, Web), 100% tests offline/local runtime; đóng gói binary server CMT và build production web/Electron của TP.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Repository `CreateMediaTool`: các module `internal/modules/providers`, `internal/modules/openai`, `cmd/server`.
  - Repository `TediaPros`: `src/main/geminiGateway.ts`, `src/main/geminiGatewayPrompts.ts`, `src/main/geminiGatewayDraftCheckpoint.ts`, `src/main/autoShortItemCoordinator.ts`, `src/main/autoshort.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/src/components/AutoShort.tsx`, cùng các file test liên quan.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Không sửa đổi logic các provider khác (OpenAI API, LocalAI, Gemini API chính thức).
  - Không thay đổi các quy tắc vật lý bất biến: tempo 1.10x–1.80x, tách thoại offline MDX, safeContainedPath, PolyForm Noncommercial License.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

1. **Khám phá route model qua RPC catalog thay vì hardcode hay regex HTML:**
   - *Lý do:* Mỗi tài khoản Google có năng lực (capacity tier) và ID model khác nhau. RPC catalog `otAQ7b` phản ánh chính xác model ID và field capacity của tài khoản đang đăng nhập.
2. **Không dùng JSON repair suy đoán:**
   - *Lý do:* Việc tự chèn ngoặc đóng hay cắt chuỗi JSON dở dang có thể làm méo mó nghĩa của cue hoặc làm mất cue ID mà hệ thống không nhận biết được. Chỉ bóc đúng BOM hoặc 1 cặp fence Markdown sạch sẽ, mọi lỗi cú pháp khác phải kích hoạt retry một lần nữa trong trần cho phép (cap 3).
3. **Gateway là chủ thể duy nhất sở hữu retry generation:**
   - *Lý do:* Tránh hiện tượng nhân số lần gọi (multiplier effect: client retry 3 x provider retry 3 = 9 lần gọi) gây lãng phí tài nguyên và làm nghẽn tiến trình.
4. **Bảo vệ draft checkpoint độc lập với final checkpoint:**
   - *Lý do:* Draft chỉ mang trạng thái `draft-validated`, tuyệt đối không cho phép TTS hay renderer đọc như bản dịch hoàn thiện; nhưng nó cho phép resume an toàn khi lượt review độc lập gặp sự cố mạng hoặc lỗi cú pháp.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

### CreateMediaTool (CMT)
- `[NEW]` `internal/modules/providers/gemini_model_catalog.go`
- `[NEW]` `internal/modules/providers/gemini_model_catalog_test.go`
- `[NEW]` `internal/modules/providers/gemini_response_evidence.go`
- `[NEW]` `internal/modules/providers/gemini_response_evidence_test.go`
- `[NEW]` `internal/modules/openai/structured_json.go`
- `[NEW]` `internal/modules/openai/structured_json_test.go`
- `[NEW]` `internal/modules/openai/model_verification.go`
- `[NEW]` `internal/modules/openai/model_verification_test.go`
- `[NEW]` `docs/gemini-gateway-v2.md`
- `[MODIFY]` `internal/modules/providers/gemini_service.go`
- `[MODIFY]` `internal/modules/providers/provider_interface.go`
- `[MODIFY]` `internal/modules/openai/openai_service.go`
- `[MODIFY]` `internal/modules/openai/openai_controller.go`
- `[MODIFY]` `internal/modules/openai/openai_module.go`
- `[MODIFY]` `internal/modules/openai/dto/openai_dto.go`
- `[MODIFY]` `README.md`

### TediaPros (TP)
- `[NEW]` `src/main/geminiGatewayPrompts.ts`
- `[NEW]` `src/main/geminiGatewayDraftCheckpoint.ts`
- `[NEW]` `tests/gemini-gateway-prompts.test.ts`
- `[NEW]` `tests/gemini-gateway-draft-resume.test.ts`
- `[NEW]` `tests/fixtures/gemini-gateway-structured-json-cases.json`
- `[NEW]` `tests/fixtures/gemini-gateway-113-source.json`
- `[NEW]` `tests/fixtures/gemini-gateway-volvo-source.json`
- `[MODIFY]` `src/main/geminiGateway.ts`
- `[MODIFY]` `src/main/autoShortItemCoordinator.ts`
- `[MODIFY]` `src/main/autoshort.ts`
- `[MODIFY]` `src/main/index.ts`
- `[MODIFY]` `src/preload/index.ts`
- `[MODIFY]` `src/shared/types.ts`
- `[MODIFY]` `src/renderer/src/components/AutoShort.tsx`
- `[MODIFY]` `tests/gemini-gateway-contract.test.ts`
- `[MODIFY]` `.ai/tasks/2026-09-14-gateway-root-cause/investigation.md`

---

## 6. Bảng Đánh Giá Nghiệm Thu Chi Tiết (Acceptance Table)

| Hạng mục kiểm tra | Tiêu chí kỳ vọng | Kết quả thực tế | Trạng thái | Ghi chú & Bằng chứng |
| :--- | :--- | :--- | :---: | :--- |
| **Model Routing (Task 1)** | Request `gemini-advanced` tìm đúng exact `3.1 Pro`, dùng account tier đúng và bắt evidence upstream | Fallback exact-Pro + preflight; current verify observed 3.1 Pro | **LIVE_CONFIRMED** | Một probe bounded, evidence response vẫn là gate cuối |
| **Response Evidence (Task 2)** | Bắt buộc `observed_model_id` từ frame `wrb.fr`, không chép từ alias | Parser trích xuất đúng candidate ID & label | **PASS** | `gemini_response_evidence_test.go` pass |
| **JSON Normalization Parity (Task 3)** | 12 test vectors xử lý giống hệt nhau giữa Go và TypeScript | 12/12 cases đạt cùng kết quả accept/reject | **PASS** | `structured_json_test.go` & `gemini-gateway-contract.test.ts` |
| **Contract v2 & Retry (Task 4)** | Yêu cầu `contract_version: 2`, cap 3 retry tại gateway, client không lặp queue | Telemetry đầy đủ, coordinator chặn retry permanent | **PASS** | Unit & Contract tests pass |
| **Prompt Budget (Task 5)** | Prompt 113 cues draft <= 12 KiB; review <= draft + candidate + 4 KiB | Prompt v8 pass budget, giữ số trần và source-evidence discipline | **PASS** | `gemini-gateway-prompts.test.ts` pass |
| **Draft Resume (Task 6)** | Khi retry lượt review, tái dùng draft đã lưu và bỏ qua Stage 1 | Draft được đọc an toàn, adapter chỉ gọi 1 stage review | **PASS** | `gemini-gateway-draft-resume.test.ts` pass |
| **Verify API & Cache (Task 7)** | `POST /verify-model` cache RAM 15 min, 10 request đồng thời = 1 probe call | 0 generation khi cache hit; 1 generation khi probe | **PASS** | `model_verification_test.go` pass |
| **UI & Audit Redaction (Task 7)** | UI hiển thị trạng thái đã xác minh; audit log lọc sạch secret token/cookie | UI hiển thị model/time; audit log lọc regex an toàn | **PASS** | `autoshort-ui-contract.test.ts` & contract test pass |
| **CMT Go Build (Task 8)** | Compile binary `server.exe` không lỗi | Current v8 binary được build, hash-verify và deploy vào root canonical | **PASS** | SHA256: `507C271E86EEDA8D59B6AB1EC4F04FF2EED36D4B6B8E89ECC2C4BF3A52802606` |
| **TP Vite/Electron Build (Task 8)** | `npm run build` tạo đầy đủ bundle SSR main/preload và renderer web | Bundles tại `out/main`, `out/preload`, `out/renderer` | **PASS** | Không có lỗi biên dịch kiểu |
| **Live Gate A (Capabilities & Verify)** | Server phản hồi capabilities v2; probe verify trả observed model | Current probe observed 3.1 Pro | **LIVE_CONFIRMED** | One bounded generation; catalog alone remains insufficient |
| **Live Gate B (113-cue translation)** | Chạy thực tế 113 cues qua hai lượt draft + review | V8: 2 generation, 2 attempts, matched/complete; `169` remains unitless | **LIVE_CONFIRMED** | Không chạy render/TTS từ fixture ledger |
| **Live Gate C (Volvo 44-cue translation)** | Chạy thực tế 44 cues Volvo đối chiếu ngữ nghĩa | V8: 2 generation, 2 attempts, matched/complete; OCR image corroborates oak-branch ASR repair | **LIVE_CONFIRMED** | Không chạy render/TTS từ fixture ledger |

---

## 7. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh kiểm thử đã thực hiện:

```powershell
# 1. Kiểm thử CreateMediaTool
cd F:\Son\tool\CreateMediaTool
go test ./internal/modules/providers ./internal/modules/openai/... ./internal/commons/utils -count=1
git diff --check

# Kết quả:
# ok gemini-web-to-api/internal/modules/providers 0.231s
# ok gemini-web-to-api/internal/modules/openai    0.138s
# ok gemini-web-to-api/internal/modules/openai/dto 0.118s
# ok gemini-web-to-api/internal/commons/utils     0.477s
# git diff --check: PASS (0 issues)

# 2. Kiểm thử TediaPros
cd F:\Son\tool\TediaPros
cmd.exe /c "npm run typecheck"
node scripts/run-local-runtime-tests.mjs ai-output.test gemini-gateway-contract.test gemini-gateway-prompts.test gemini-gateway-draft-resume.test translation-response.test translation-provider-contract.test translation-resume.test translation-identity.test autoshort-ui-contract.test
git diff --check

# Kết quả:
# Typecheck (Node + Web): PASS (0 errors)
# Test suites: 9 suites passed, 71 tests passed, 0 failed
# git diff --check: PASS (0 issues)

# 3. Build Artifacts
# CMT:
go build -o .artifacts/gateway-v2/server.exe ./cmd/server
# TP:
cmd.exe /c "npm run build"
```

### Commit History:
- **CreateMediaTool commits:**
  - `3bc3852` - `fix(gateway): route Gemini by account model identity`
  - `bd697f3` - `fix(gateway): verify upstream model and completion evidence`
  - `8fad7a2` - `fix(gateway): normalize structured JSON without guessing content`
  - `aa9b6ac` - `feat(gateway): enforce verified translation contract v2`
  - `7337537` - `feat(gateway): verify model endpoint and cache`
  - `f44b6ac` - `docs(gateway): document gateway v2 contract, endpoints and limitations`
- **TediaPros commits:**
  - `cc867da` - `test(gateway): verify structured JSON normalization parity`
  - `4df2557` - `feat(gateway): enforce verified translation contract v2`
  - `33c4fab` - `feat(gateway): compact two-pass prompts v4 with size budget`
  - `da944bf` - `feat(translation): checkpoint and resume validated draft for review retry`
  - `8df5f2c` - `feat(ui): verified model status and transparent attempt details`

---

## 8. Cập nhật sau review và hardening (2026-09-15)

- CMT phát hiện route dynamic có thể gắn capacity generic cho exact Pro khi
  catalog không còn trả tier legacy. Verify live đã bắt Flash-Lite; TP không
  nhận response đó. `capacityForModel`, evidence gate, preflight và cache
  mismatch 2 phút đã giải quyết đường sai này trong code/test.
- Request budget thường là hai generation (draft/review). Khi verification cache
  hết hạn hoặc route mới, chỉ có thêm một probe bounded. Mismatch dừng trước
  dịch thay vì chi thêm retry/generation.
- Prompt v8 giữ số trần nguyên dạng. Điều này sửa lỗi semantic lịch sử thêm
  `tệ` cho `169`; run 113 cue hiện tại đã xác nhận không thêm đơn vị. Volvo
  `cành sồi` có OCR ảnh nguồn xác nhận, nên là khôi phục ASR đúng.
- Full TP local-runtime/typecheck/build và full CMT `go test ./...` pass sau
  hardening. Binary gateway v8 đã hash-verify, restart và capabilities đáp ứng
  contract v2/provider ready sau session refresh.

## 9. Hướng Dẫn Bàn Giao & Vận Hành (Handoff Notes)

### 1. Vận hành Gateway
Binary v8 đã được triển khai tại `F:\Son\tool\CreateMediaTool\server.exe`,
checksum-verify và restart trên cổng `4982`. Capabilities trả contract v2 và
provider ready; session hiện tại đã qualified route 3.1 Pro qua probe bounded
và hai run v8, thay vì dịch trên route sai.
Khi cần kiểm tra trạng thái hoạt động:
```powershell
curl http://127.0.0.1:4982/openai/v1/gateway/capabilities
```
Kết quả trả về sẽ hiển thị:
```json
{
  "gateway_contract_version": 2,
  "model_selection": "observed-id-required",
  "structured_attempt_cap": 3
}
```

### 2. Cập nhật cookie Gemini khi hết hạn
Khi Google Web báo session bị từ chối/hết hạn, thay cả cặp cookie
`__Secure-1PSID` / `__Secure-1PSIDTS` rồi thực hiện model check bounded trước
khi chạy job mới:
1. Đăng nhập vào [gemini.google.com](https://gemini.google.com) trên trình duyệt bằng tài khoản Google có quyền Pro / Advanced.
2. Mở Developer Tools (F12) -> Application -> Cookies -> `https://google.com`.
3. Sao chép giá trị mới của `__Secure-1PSID` và `__Secure-1PSIDTS`.
4. Dán vào file `F:\Son\tool\CreateMediaTool\.env`.
5. Khởi động lại `server.exe`.
6. Trên giao diện TediaPros AutoShort, bấm nút **"Kiểm tra gateway và model"** để kích hoạt probe và xác nhận nhãn Pro xanh.

### 3. Phương án Rollback (Dự phòng)
Nếu cần khôi phục lại phiên bản cũ:
- **CreateMediaTool:** Bản sao lưu được lưu tại `.artifacts/gateway-v2/server.v1-backup.exe`. Có thể dừng tiến trình và khôi phục lại file này.
- **TediaPros:** Mã nguồn TediaPros v2 được thiết kế phòng vệ chặt chẽ: nếu gateway bị rollback về v1, TediaPros sẽ chủ động từ chối (`Gemini Gateway chưa hỗ trợ hợp đồng phiên bản 2. Hãy cập nhật gateway`) chứ không âm thầm chạy sai model như trước đây.
