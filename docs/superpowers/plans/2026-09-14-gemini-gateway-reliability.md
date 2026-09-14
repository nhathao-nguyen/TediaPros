# Gemini Gateway Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox syntax. Do not dispatch subagents unless the user subsequently requests it.

**Goal:** Chạy đúng Gemini 3.1 Pro, chuẩn hóa JSON an toàn và hoàn tất khôi phục/dịch + review với số generation trung thực.

**Architecture:** CreateMediaTool quản lý protocol, model routing/evidence, strict JSON và retry. TediaPros quản lý prompt, cue validation, draft/review checkpoint và UI qua contract v2. Thay đổi được chia theo gate; gateway đạt offline/live model gate trước khi bật client mới.

**Tech Stack:** Go 1.25/Fiber v3, Electron/React/TypeScript, Go test, local-runtime tests, fixture JSON và probe live opt-in hiện có. Không thêm thư viện JSON repair.

**Spec:** [2026-09-14-gemini-gateway-reliability-design.md](../specs/2026-09-14-gemini-gateway-reliability-design.md). Đọc cả spec và [báo cáo điều tra](../../../.ai/tasks/2026-09-14-gateway-root-cause/investigation.md) trước khi thực hiện.

## Global Constraints

- Hai repo: `F:/Son/tool/CreateMediaTool` (viết tắt CMT), `F:/Son/tool/TediaPros` (TP). Mọi đường dẫn task dưới đây tương đối với repo được ghi.
- Giữ alias `gemini-advanced` với đích yêu cầu `Gemini 3.1 Pro`; không fallback model âm thầm.
- 2 logical stage bình thường; cap3 generation attempt/stage do gateway sở hữu; provider attempt_limit=1; tối đa6 trong luồng hai stage, không khôi phục ngân sách toàn video đã tạm tắt.
- Normalization JSON/GET capabilities =0 generation; manual verify cache miss =1; cache model/verification 15 phút theo session+route.
- Structured raw body <=16 MiB, text JSON <=1 MiB, depth<=32, members<=10.000; client giữ parser limit theo cue hiện có. Không suy đoán để đóng JSON.
- Cue ID, thứ tự, timestamp, nghĩa và trần tempo1.80x bất biến. Giữ ASR/checkpoint nguồn, render hoàn chỉnh và mọi dirty/untracked work ngoài phạm vi.
- Không yêu cầu reasoning transcript; reviewer là generation/session mới nhận source đầy đủ. JSON đúng không đồng nghĩa dịch đúng.
- Không đổi defaults parser của các provider/title/SEO khác; không ảnh hưởng binary media upload/download.
- Cookie/token/authenticated URL không đi vào log/artifact công khai, IPC hoặc renderer. Shared TS không import Node/React.
- Mỗi task chạy test tái hiện thất bại, sửa khu trú, test lại, review diff, cập nhật tài liệu rồi commit chỉ các path thuộc task. Không `git add .`, reset/clean hoặc stash-all.

## Thứ tự và gate

`T1 model catalog → T2 response evidence → T3 JSON → T4 contract/retry → T5 prompt → T6 resume/cache → T7 UI/audit → T8 live + release`.

T1/T2 sửa lỗi routing đã chứng minh. T3 không được dùng để che model mismatch. T5 không dùng prompt compact thử nghiệm làm bản production khi chưa có semantic review. T8 không được coi typecheck/test offline là thay thế live.

## Task 1: Model catalog theo tài khoản và header đúng

**Files — CMT**
- Create `internal/modules/providers/gemini_model_catalog.go`, `gemini_model_catalog_test.go`.
- Create `internal/modules/providers/testdata/model_catalog/pro_account.json`, `missing_pro.json`, `sparse_account.json` (fixtures đã loại thông tin riêng tư).
- Modify `internal/modules/providers/gemini_service.go`, `provider_models.go`, `provider_interface.go`.
- Test `internal/modules/providers/gemini_service_test.go`.

**Interfaces**

```go
type ModelRoute struct {
    Alias, UpstreamID, DisplayName string
    ModelNumber, Capacity, CapacityField int
    Available bool
    Fingerprint string
}
func parseModelCatalog(raw []byte) ([]ModelRoute, error)
func resolveModelRoute(alias string, routes []ModelRoute) (ModelRoute, error)
func buildModelHeaders(route ModelRoute) (http.Header, error)
func (c *Client) modelRoute(ctx context.Context, alias string) (ModelRoute, error)
```

`Fingerprint`: SHA-256 stable serialization ID/capacity/modelNumber/protocol version, không secret. Các kiểu này ở package providers. Nonce/request ID là input riêng của builder request hiện có.

- [ ] Thu một response RPC catalog read-only bằng session hiện có; xác minh mapping Pro/capacity theo tài khoản. Loại session/location/tokens khỏi fixture. Không dùng regex HTML làm catalog lựa chọn.
- [ ] Viết test red: alias Pro resolve đúng ID fixture; thiếu Pro báo lỗi; available=false bị chặn; catalog sparse được xử lý; route giữa hai session không dùng chung; refresh đồng thời gọi một lần; hết15phút + RPC lỗi không dùng stale route.
- [ ] Kiểm tra header bằng decode JSON, không chỉ so tên alias:

```go
func TestModelHeaderUsesRouteID(t *testing.T) {
    route := ModelRoute{Alias:"gemini-advanced", UpstreamID:"e6fa609c3fa255c0", DisplayName:"3.1 Pro", ModelNumber:3, Capacity:2, CapacityField:12, Available:true}
    h, err := buildModelHeaders(route)
    if err != nil { t.Fatal(err) }
    var fields []any
    if err := json.Unmarshal([]byte(h.Get("x-goog-ext-525001261-jspb")), &fields); err != nil { t.Fatal(err) }
    if fields[4] != route.UpstreamID { t.Fatalf("wrong route: %v", fields[4]) }
}
```

- [ ] Chạy `go test ./internal/modules/providers -run 'Test(Model|Catalog|Resolve)' -count=1`; ghi red trước implementation.
- [ ] Implement catalog cache snapshot15phút và single-flight bằng cơ chế sync hiện có; map alias tới3.1 Pro rõ ràng, không string contains chung. Sửa toàn bộ slot model/header/body từ route, giữ nonce tách biệt. Reuse immutable route snapshot trong mỗi request.
- [ ] Test header capacity field12/13, model number, request ID vẫn khác giữa request nhưng model ID không đổi; không fallback sang model đầu danh sách.
- [ ] Chạy provider tests; cập nhật CMT README về catalog/alias và commit `fix(gateway): route Gemini by account model identity`.

**Gate:** Fixture chứng minh mapping/header; live model gate chờ T2. Chưa tuyên bố inference Pro chỉ từ test header.

## Task 2: Thu và kiểm chứng observed model/completion

**Files — CMT**
- Create `internal/modules/providers/gemini_response_evidence.go`, `gemini_response_evidence_test.go`.
- Create `internal/modules/providers/testdata/response/{pro_complete,flash_complete,partial_then_error,unknown_terminal,sparse_complete}.json` — mỗi tên là một file fixture riêng.
- Modify `internal/modules/providers/gemini_service.go`, `provider_interface.go`.
- Extend `internal/modules/providers/diagnostic_repro_test.go` chỉ khi cần; vẫn opt-in và không có secret trong stdout.

**Interfaces**

```go
type ResponseEvidence struct {
    ObservedModelID, ObservedModelLabel string
    CompletionState, CompletionEvidence string // complete|incomplete|unknown
    RawBytes, TextFrames int
}
func parseResponseEvidence(raw []byte) (*Response, ResponseEvidence, error)
func verifyResponseRoute(route ModelRoute, evidence ResponseEvidence) error
```

Thêm `Evidence *ResponseEvidence` vào providers.Response. `GenerateConfig` thêm `RequireVerifiedModel`, `RequireCompleteResponse` bool và hai GenerateOption tương ứng. Flags được truyền từ contract T4; các đường generic khác không tự bị đổi strictness.

- [ ] Tạo sanitized fixture từ captures hiện có: ID/label Pro, ID/label Flash, JSON đang sinh rồi bị thay bằng generic error. Không copy toàn body có session/location.
- [ ] Viết test red `TestObservedModelComesFromPayload`, `TestFlashCannotSatisfyProRoute`, `TestUnknownModelCannotBeVerified`, `TestTrailingErrorInvalidatesEarlierJson`, `TestPartialCandidateNeverBecomesComplete`, `TestSparseEvidence`, `TestCandidateIdentityCannotMix`.

```go
func TestFlashCannotSatisfyProRoute(t *testing.T) {
    route := ModelRoute{UpstreamID:"e6fa609c3fa255c0"}
    observed := ResponseEvidence{ObservedModelID:"56fdd199312815e2", ObservedModelLabel:"3.8 Flash", CompletionState:"complete"}
    if verifyResponseRoute(route, observed) == nil { t.Fatal("Flash accepted as Pro") }
}
```

- [ ] Chạy `go test ./internal/modules/providers -run 'Test(Observed|Flash|Unknown|Trailing|Partial|Sparse|Candidate)' -count=1`; ghi red.
- [ ] Parse typed evidence từ cùng chosen candidate, hỗ trợ normal/sparse bằng helper field lookup; giữ provenance của frame cuối. Terminal marker chỉ được gắn complete theo profile có fixture/live bằng chứng. Giữ unknown cho schema chưa nhận diện.
- [ ] Thay io.ReadAll không giới hạn bằng max+1 reader cho structured text; test16MiB+1/UTF-8 lỗi/body read error. Không dùng early valid snapshot nếu stream lỗi về sau.
- [ ] Khi strict flags bật, reject mismatch/unknown/incomplete trước parse JSON. Không gán observed model từ config.Model. Giữ các chức năng media của parser bằng regression hiện có.
- [ ] Chạy provider/generated-media tests. Một live tiny probe dùng routing mới (không diagnostic header override) phải quan sát Pro ID thực và completion hợp lệ; ghi observed ID/label. Nếu chưa qua thì dừng gate routing, không chỉnh parser để nhận Flash.
- [ ] Commit `fix(gateway): verify upstream model and completion evidence`.

## Task 3: JSON normalization giới hạn tại gateway

**Files — CMT**
- Create `internal/modules/openai/structured_json.go`, `structured_json_test.go`.
- Modify `internal/modules/openai/openai_service.go` để thay `isSingleJSONObject` bằng boundary mới.
- Create `internal/modules/openai/testdata/structured_json_cases.json`.

**Files — TP**
- Extend `tests/gemini-gateway-contract.test.ts` với cùng vectors; đọc `src/shared/aiOutput.ts`, không đổi defaults.
- Create `tests/fixtures/gemini-gateway-structured-json-cases.json`; hai fixture copy cùng nội dung/SHA, plan smoke kiểm tra parity.

**Interfaces**

```go
type JSONLimits struct { MaxBytes, MaxDepth, MaxMembers int }
type NormalizedJSON struct { Text string; Operations []string }
func normalizeStructuredObject(raw string, limits JSONLimits) (NormalizedJSON, error)
```

- [ ] Viết các cases actual input, expected operation/error code; gồm duplicate escaped key và injection vào string:

```go
func TestRejectsDuplicateDecodedKey(t *testing.T) {
    raw := `{"translations":{"cue-0":"A","\u0063ue-0":"B"}}`
    _, err := normalizeStructuredObject(raw, JSONLimits{MaxBytes:1<<20,MaxDepth:32,MaxMembers:10000})
    if err == nil { t.Fatal("duplicate decoded key accepted") }
}
func TestNeverRepairsTruncatedString(t *testing.T) {
    _, err := normalizeStructuredObject(`{"translations":{"cue-0":"unfinished`, JSONLimits{MaxBytes:1<<20,MaxDepth:32,MaxMembers:10000})
    if err == nil { t.Fatal("invented completion accepted") }
}
```

- [ ] Cases accept: clean object, BOM đầu, JSON whitespace, đúng một fence json/trống bao toàn object. Cases reject: partial/multiple fence, prose, array/null, extra object, duplicate key, invalid UTF8/surrogate, trailing comma, nested restarted JSON, vượt bytes/depth/members, oversized whitespace.
- [ ] Chạy `go test ./internal/modules/openai -run 'Test(Structured|Rejects|Never|Normalization)' -count=1` red.
- [ ] Implement kiểm tra bytes trước normalize, strip đúng BOM đầu/JSON whitespace và một fence hoàn chỉnh; strict lexical/token walk phát hiện duplicate decoded keys và invalid Unicode trước map. Không dùng Unmarshal map đơn thuần để xác minh uniqueness, không rewrite string.
- [ ] Gateway áp normalization chỉ cho response_format và sau evidence gate T2. Parse fail cung cấp code/byte offset đã giới hạn; thành công giữ `Operations`. Client dùng `parseAiJsonObject(...,{allowProseObject:false})`, schema chính xác và ID gate hiện có; không normalize thêm lần gây thay nội dung.
- [ ] Go/TS parity tests và `ai-output.test` phải qua. Test fence hợp lệ không khiến gateway gọi Gemini lần2. Commit `fix(gateway): normalize structured JSON without guessing content`.

## Task 4: Contract v2, lỗi typed và một tầng retry

**Files — CMT**
- Modify `internal/modules/openai/dto/openai_dto.go`, `openai_service.go`, `openai_controller.go` và các `*_test.go` tương ứng.
- Modify `internal/modules/providers/provider_interface.go`, `gemini_service.go` cho option strict/attempt limit.

**Files — TP**
- Modify `src/main/geminiGateway.ts`, `src/main/autoShortItemCoordinator.ts`, `src/main/autoshort.ts` tại callback shouldRetry của runAutoShortQueue. Đọc `src/main/autoShortQueueRunner.ts`; giữ runner generic nếu callback đã đủ để chặn nhóm lỗi gateway.
- Test `tests/gemini-gateway-contract.test.ts`, `tests/translation-provider-contract.test.ts`, `tests/translation-resume.test.ts`, `tests/autoshort-queue-throughput.test.ts`.

**Interfaces**

```go
type GatewayRequirements struct {
    ContractVersion int `json:"contract_version"`
    RequireVerifiedModel bool `json:"require_verified_model"`
    RequireCompleteResponse bool `json:"require_complete_response"`
}
```

Thêm con trỏ `GatewayRequirements` trong ChatCompletionRequest với JSON `gateway_requirements`. Mở rộng GatewayMetadata theo spec §5, tái sử dụng field `ObservedModel` đã tồn tại. Error envelope giữ `error.message/type`, thêm code và gateway_metadata cả trên failure. Logical request ID do gateway tạo, truyền xuống attempt và log.

```ts
type GatewayEvidenceV2 = {
  gateway_contract_version: 2
  observed_model_id: string
  observed_model: string
  model_verification: 'matched' | 'mismatch' | 'unknown'
  route_fingerprint: string
  completion_state: 'complete' | 'incomplete' | 'unknown'
  upstream_attempts: number
  logical_request_id: string
}
```

- [ ] Test red: requested alias đúng nhưng observed Flash => fail; thiếu evidence/version => fail; gatewayv1 => upgrade message; normalized fence=>1attempt; transient rồi valid=>2; invalid JSON ba lần=>3; provider retry không nhân thành9; hủy giữa backoff=>không attempt tiếp; timeout=>không gọi chồng.
- [ ] Thêm test queue exhaustion không tự rerun cuối batch lỗi gateway; manual retry mới có run identity riêng. Trace caller thực qua `runAutoShortQueue` trước chỉnh sửa, giới hạn policy cho nhóm gateway errors.
- [ ] Chạy `go test ./internal/modules/openai/... ./internal/modules/providers -count=1` và `node scripts/run-local-runtime-tests.mjs gemini-gateway-contract.test translation-provider-contract.test translation-resume.test` red phù hợp.
- [ ] Implement contract từ spec; metadata counter tăng đúng một lần cho mỗi GenerateContent thực bắt đầu, kể cả lỗi. Cap3 ở service, bên provider1. Retry classification dùng typed errors, không string-match toàn URL. Không retry auth/model/unknown-completion/timeout/cancel/limit. HTTP429 tuân Retry-After và deadline hiện có.
- [ ] TediaPros đọc error JSON có giới hạn rồi map code thành thông báo Việt; không ném toàn JSON HTTP body lên UI. Kiểm chứng evidence trước canonicalizeCompactTranslation. Không thêm semantic retry tự động ở client.
- [ ] Test client generic/media không gửi requirements vẫn tương thích, nhưng metadata không giả observed model. Docs endpoint/capabilities cập nhật `schema_mode=prompt-only`, unsupported temperature và prompt-hint max_tokens.
- [ ] Commit mỗi repo với thông điệp `feat(gateway): enforce verified translation contract v2`.

## Task 5: Builder prompt gọn cho draft và review

**Files — TP**
- Create `src/main/geminiGatewayPrompts.ts`.
- Modify `src/main/geminiGateway.ts`; đọc `src/main/translation/prompts.ts` và `sourceGroups.ts` để giữ ngữ cảnh, không đổi prompt provider khác.
- Create `tests/gemini-gateway-prompts.test.ts`, `tests/fixtures/gemini-gateway-113-source.json`, `tests/fixtures/gemini-gateway-volvo-source.json` với chỉ source/IDs cần kiểm thử.

**Interfaces**

```ts
export const GEMINI_GATEWAY_PROMPT_VERSION = 'gemini-gateway-two-pass-v4'
export function buildGatewayDraftMessages(batch: PlannedTranslationBatch): ModelMessage[]
export function buildGatewayReviewMessages(batch: PlannedTranslationBatch, draftJson: string): ModelMessage[]
```

`ModelMessage`/`PlannedTranslationBatch` là types hiện có. Builder wire chỉ một contract, ledger `{id,text}`; optional context group riêng nếu fixture chứng minh cần. Glossary/synopsis có giới hạn hiện tại vẫn được truyền.

- [ ] Test red ledger chứa mỗi source ID một lần, không ID/timestamp bị sửa, locale/glossary/synopsis được giữ; source string có instruction giả không trở thành system message; không timing budgets/expected_ids lặp. Fixture113 draft<=12KiB; review<=draft+candidate+4KiB.

```ts
const draft = buildGatewayDraftMessages(batch)
assert.ok(Buffer.byteLength(draft.map(m => m.content).join('\n')) <= 12 * 1024)
const review = buildGatewayReviewMessages(batch, candidateJson)
assert.ok(review.some(m => m.content.includes(candidateJson)))
assert.ok(review.some(m => m.content.includes('independent-review')))
```

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs gemini-gateway-prompts.test gemini-gateway-contract.test` red.
- [ ] Implement system draft theo spec: restored source có căn cứ, protected facts/ID/locale; system review độc lập đọc source + draft và trả final full object. Không yêu cầu reasoning text. Loại string-replace từ gatewayBaseMessages.
- [ ] Giữ checker dấu câu/ID/ngôn ngữ; không tắt validator để prompt gọn pass. Chưa coi những test string prompt là kiểm chứng ngữ nghĩa.
- [ ] Test adapter thành công gọi đúng2, fresh session/temporary ở cả2; request2 không chạy nếu draft incomplete/model mismatch. Không có call riêng để hỏi tên model hay format-fix.
- [ ] Commit `refactor(translation): build compact source-grounded Gemini prompts`.

## Task 6: Resume review và invalidate cache model cũ

**Files — TP**
- Create `src/main/geminiGatewayDraftCheckpoint.ts`, `tests/gemini-gateway-draft-resume.test.ts`.
- Modify `src/main/geminiGateway.ts`, `src/main/translation/checkpoint.ts`, `src/main/autoShortItemCoordinator.ts`.
- Test `tests/translation-resume.test.ts`, `tests/translation-identity.test.ts`.

**Interfaces**

```ts
export interface GatewayDraftRecord {
  schemaVersion: 1
  state: 'draft-validated'
  identity: string
  raw: string
  rawSha256: string
  observedModelId: string
  routeFingerprint: string
}
export function readGatewayDraft(path: string, expectedIdentity: string): Promise<GatewayDraftRecord | null>
export function writeGatewayDraft(path: string, record: GatewayDraftRecord): Promise<void>
```

Identity hash gồm source IDs/text, locale, glossary/synopsis, gateway prompt version, parser version, route fingerprint, observed ID; draft và final dùng namespaces riêng. Path do coordinator cấp trong item scope, kiểm tra qua safeContainedPath trước I/O; bounded read1MiB+envelope overhead64KiB, exact object/schema, SHA, ID validation. Atomic write temp/fsync/rename theo pattern checkpoint hiện có.

- [ ] Test red: review fail rồi retry cùng identity chỉ1generation; thay source/locale/glossary/model/prompt =>draft miss; corruption/duplicate ID=>miss có diagnostic; draft không được TTS/export; cache v1 alias-only=>miss giữ file; cancellation không lưu final.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs gemini-gateway-draft-resume.test translation-resume.test translation-identity.test` red.
- [ ] Lưu draft sau model/completion/schema/ID validation; review chỉ dùng lại draft đã xác minh. Không đọc audit log như checkpoint. Đổi cache namespace gatewayv2 và fingerprint model route trong buildTranslationIdentity cho provider này.
- [ ] Khi catalog fingerprint đổi giữa draft và retry, tạo draft mới; khi review trả mismatch dừng, không upgrade model hay ghép text cũ. Giữ final checkpoint hiện có và source ASR/artifact cũ.
- [ ] Test UI/TTS không thấy draft như validated translation, tài liệu checkpoint cập nhật và commit `feat(translation): resume verified Gemini review drafts safely`.

## Task 7: Verify-model, UI và audit có giới hạn

**Files — CMT**
- Create `internal/modules/openai/model_verification.go`, `model_verification_test.go`.
- Modify `openai_controller.go`, `openai_service.go`, `dto/openai_dto.go` và tests.

**Files — TP**
- Modify `src/main/geminiGateway.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/src/components/AutoShort.tsx`, `src/main/autoShortItemCoordinator.ts`; kiểm tra inference API type ở `src/preload/index.d.ts` và `src/renderer/src/vite-env.d.ts` cùng lúc.
- Test `tests/gemini-gateway-contract.test.ts`, `tests/autoshort-ui-contract.test.ts`.

**Interfaces**
- POST `/openai/v1/gateway/verify-model`: input `{model:string,force:boolean}`; output `{state,observedModelId?,observedModel?,verifiedAtUtc?,expiresAtUtc?,verificationGenerationRequests:number}`. state=`verified|unverified|mismatch|unavailable|authentication-required`.
- GET capabilities: v2 và trạng thái verification cached; không generation. Verified TTL15phút gắn session+route; không persist credential fingerprint ra client.
- Mở rộng `GeminiStatus` optional `gatewayVerification` chứa state/timestamps/observedModel/generation count để không phá providers khác. API preload `translateCheckKey` hiện có, channel `translate:checkKey`, được thêm tham số cuối optional `{verifyModel?:boolean,force?:boolean}`; không đổi vị trí năm tham số hiện có. Sửa typed IPC handler tương ứng, không raw ipc. Caller kiểm tra trạng thái thụ động không gửi verifyModel; nút xác minh gửi verifyModel=true.

- [ ] Test red GET capabilities0call; verify cache miss1call; cache hit0call; force1call;10concurrent verify chỉ1call; session/route đổi mất cache; mismatch không hiện verified; generation thực cập nhật cache không phát sinh probe.
- [ ] Test UI lỗi provider không hiện tất cả source cue như missing-id; lỗi schema cụ thể vẫn hiện cue liên quan; badge2lượt bình thường và retry count riêng; error.message JSON không lộ nguyên object; unknown provider chưa xác minh không hiện Pro verified.
- [ ] Implement verify service một attempt bằng provider strict T2, dedupe/cache, request context cancel. Chọn timeout5phút theo transport hiện có; UI chờ được hủy, không mở nhiều probe khi double click.
- [ ] Implement typed IPC và UI: kết nối chưa xác minh, verified timestamp, model khác, auth, upgrade. Tác vụ video được dùng generation đầu để xác minh, không gọi tiny preflight mỗi video.
- [ ] Audit thêm request ID/stage, input hash+bytes, model requested/observed, normalized ops, completion evidence, attempt reasons cả failure. Error sanitizer loại URL query/header/token. Không lưu raw lỗi mặc định; chế độ diagnostic opt-in tối đa3raw/stage,16MiB/file và tổng64MiB/item, trong item scope, dọn theo disk budget/cleanup hiện có. Giữ summary nhỏ khi loại raw.
- [ ] Tests capture secret sentinel trong URL/cookie bảo đảm không có trong error/audit/UI. Chạy Go controller/tests và `npm.cmd run typecheck`, UI contract tests.
- [ ] Commit mỗi repo phần UI/diagnostic, cập nhật `docs/architecture.md`, `docs/domain.md`, ADR009 về normalizer giới hạn và observed completion.

## Task 8: Qualification, build và bàn giao

**Files**
- TP: cập nhật `.ai/tasks/2026-09-14-gateway-root-cause/investigation.md`; tạo `.ai/tasks/2026-09-14-gemini-gateway-v2-implementation.md` theo TASK_TEMPLATE.
- CMT: cập nhật README về endpoints/alias/capabilities và một tài liệu `docs/gemini-gateway-v2.md` chứa contract/retry/live limitations.
- Giữ probe live trong diagnostic opt-in; chuyển fixtures đã sanitize vào tests, không đưa raw `.diagnostics` vào Git.

- [ ] Chạy kiểm tra offline đầy đủ liên quan:

```powershell
# CMT root
go test ./internal/modules/providers ./internal/modules/openai/... ./internal/commons/utils -count=1
git diff --check

# TP root
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs ai-output.test gemini-gateway-contract.test gemini-gateway-prompts.test gemini-gateway-draft-resume.test translation-response.test translation-provider-contract.test translation-resume.test translation-identity.test autoshort-ui-contract.test
git diff --check
```

- [ ] Go/TS normalization fixtures có SHA bằng nhau và cùng accept/reject/op result. Kiểm chứng fake normalizer không biến input hỏng từ raw capture thành accepted translation.
- [ ] Build CMT từ entrypoint `cmd/server/main.go` đã xác minh trong taskfile: `New-Item -ItemType Directory -Force .artifacts/gateway-v2` rồi `go build -o .artifacts/gateway-v2/server.exe ./cmd/server`. Build TP bằng `npm.cmd run build`. Ghi commit/build hash. Sau khi build qua mới dừng process có executable path đúng repo, thay server.exe bằng artifact đã kiểm chứng rồi restart ẩn; kiểm tra một listener port4982 và Tedia dev window đúng binary/out. Không overwrite executable còn chạy hoặc stop mọi tiến trình Go/Electron trên máy.
- [ ] Live gate A: tiny verify mới qua API productionv2 phải trả observed Pro, cap1, kiểm tra lại capabilities không gọi generation. Không dùng diagnostic header override cho nghiệm thu.
- [ ] Live gate B: nguồn113cue chạy draft+review một lần. Ghi toàn bộ attempts, error nếu có, model/completion từng attempt. Final đủ113ID, timestamp giữ nguyên. Nếu còn lỗi, giữ evidence và điều tra; không tăng cap để chọn một mẫu pass.
- [ ] Live gate C: nguồn Volvo chạy hai lượt. Đối chiếu source audio/ASR và target ở tên Volvo, chi tiết tạo âm thanh/cành cây, số lượng, thuật ngữ điều khiển xe, phủ định và dấu câu; ghi đúng/sai/không đủ nguồn rõ ràng. Không tự thêm câu trả lời kỳ vọng từ suy đoán.
- [ ] Với fixture113, review thủ công những đoạn slicing/strip/dice, giá/số tiền, hướng dẫn thao tác/vệ sinh, CTA thực có trong nguồn; kiểm tra tiếng Việt tự nhiên và lỗi chuyển nghĩa giữa cue. Không lấy đủID làm pass ngữ nghĩa.
- [ ] Chỉ khi B/C qua gates, chạy TTS/render113 từ final checkpoint, xác nhận không drop cue/tempo>1.80x và lỗi cue91 cũ không tái phát. Không gọi dịch thêm nếu checkpoint đúng identity.
- [ ] Lập bảng acceptance với model evidence, JSON, semantic, request count, runtime, UI, render, tests; mục nào chưa làm ghi `NOT_RUN`, upstream blocked ghi `LIVE_BLOCKED` kèm lỗi. Không tự ghi PASS.
- [ ] Bàn giao paths/commit/hash và phương án rollback: giữ gatewayv2/clientv2 theo cặp; rollback gatewayv1 phải làm client mới chặn. Không dọn branch/worktree hoặc artifact ngoài task khi chưa nằm trong yêu cầu triển khai.

## Checklist tự review kế hoạch

- [x] Root cause routing có T1/T2; metadata không còn tự xác nhận từ alias.
- [x] Spec JSON allowlist/denylist có T3 + Go/TS parity; không thêm JSON repair suy đoán.
- [x] Hai lượt, max3 mỗi stage, failure accounting và queue auto-retry có T4; review resume có T6.
- [x] Prompt/locale/protected facts/punctuation có T5 và semantic live gates T8.
- [x] Capability/verify0vs1 generation, cache session, cancel và typed UI có T7.
- [x] Cache model cũ/source preservation/atomic storage có T6.
- [x] Raw diagnostics cap/redaction, staged deploy và rollback có T7/T8.
- [x] Các function/type mới được định nghĩa trong task trước khi dùng; existing fields được tái sử dụng.

Thực hiện tuần tự trong session khi người dùng yêu cầu triển khai. Tài liệu hiện là kế hoạch; không có feature code hay live generation nào được chạy trong lượt lập kế hoạch.
