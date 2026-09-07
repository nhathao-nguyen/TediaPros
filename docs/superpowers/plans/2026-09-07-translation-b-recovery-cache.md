# Translation B — Recovery, Cache and Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dùng budget chung giữa ba provider và giữ tiến độ đã xác thực khi dịch lỗi hoặc resume.

**Architecture:** Adapter chỉ làm một request; orchestrator quản lý retry/repair/split với shared budget. Identity và batch checkpoint v2 làm authoritative source cho mọi reuse; không reset budget khi resume.

**Tech Stack:** TypeScript, AbortSignal, Node fs/crypto, existing resource manager và artifact cache.

**Spec:** [Design](../specs/2026-09-07-translation-reliability-design.md), sections 3,5,6; prerequisite Gate A.

## Global Constraints

- Không sửa LICENSE, NOTICE hoặc làm yếu PolyForm Noncommercial.
- Không silent source fallback, không drop cue/audio hoặc cắt ý để đạt timing.
- Tempo TTS không vượt 1.45x; giữ nguyên chính sách khoảng lặng và planar RGB OCR.
- Shared contracts không import Node, Electron, React hoặc browser globals.
- Đường dẫn mới qua safeContainedPath; cache/checkpoint atomic, scoped và có quota.
- Cancellation giữ lease đến khi provider/process kết thúc; không gọi request mới sau abort.
- Không tự đổi provider, tải model/dependency, hoặc gọi dịch vụ có phí trong test mặc định.
- Config cũ vẫn đọc được; unknown capability không được ghi thành supported/qualified.
- Không tự xóa checkpoint/cache/output người dùng; migration chỉ bỏ qua phần không tương thích.
- Mọi phase thay runtime phải pass typecheck và test liên quan trước khi chuyển phase.

## T5 — Shared budget và phân loại lỗi có kiểu

**Files:** Create `src/main/translation/budget.ts`, `tests/translation-budget.test.ts`;
modify src/shared/translation.ts, src/main/localTranslatePolicy.ts, test runner.

**Interfaces:**

```ts
interface TranslationBudgetSnapshot {
  plannedRequests:number; normalUsed:number; recoveryUsed:number
  activeElapsedMs:number
  perBatch:Record<string,{normalCharged:boolean;recoveryUsed:number;splitDepth:number;
    repairSets:string[];transportRetries:Record<string,number>}>
}
interface TranslationBudget {
  charge(kind:'normal'|'recovery', batchId:string):void
  claimTransportRetry(batchId:string, requestKey:string):void
  claimFormatRepair(batchId:string, idSetKey:string):void
  recordSplit(batchId:string, depth:number):void
  remainingMs():number
  canSplit(batchId:string, depth:number):boolean
  snapshot():TranslationBudgetSnapshot
}
function createTranslationBudget(B:number, now:()=>number,
  restored?:TranslationBudgetSnapshot):TranslationBudget
interface TranslationFailure {
  code:string; retryable:boolean; retryAfterMs?:number
  status?:number; message:string
}
function classifyTranslationError(error:unknown):TranslationFailure
```

Export interfaces từ budget.ts; parser/assessment codes chung ở shared. `now`
monotonic injection để test không dùng sleep thật. restore snapshot phải validate
finite nonnegative counters, B>=1 integer, quotas không tăng so với plan persisted.
Không phân loại failure bằng regex của message user. HTTP error type có status,
providerCode, retryAfterMs; preserve cause nội bộ nhưng sanitize ngoài boundary.

- [ ] **RED:** fixtures budget 1/5/100, per-batch cap, restore và active time:

```ts
test('five normal batches share four recovery credits', () => {
  const b=createTranslationBudget(5,()=>0)
  for(let i=0;i<5;i++) b.charge('normal',`b${i}`)
  for(let i=0;i<4;i++) b.charge('recovery','b0')
  assert.throws(()=>b.charge('recovery','b1'))
  assert.equal(b.snapshot().recoveryUsed,4)
  const resumed=createTranslationBudget(5,()=>0,b.snapshot())
  assert.throws(()=>resumed.charge('recovery','b1'))
})
```

Test 401/403/refusal không retry; 429 transient có Retry-After; explicit quota
exhaustion không retry; unknown exception không tự thành transient; timeout/abort
phân biệt; errors nonfinite snapshot bị reject, monotonic clock backward không
làm budget tăng. Retry-After vượt remaining phải kết thúc không ngủ quá budget.

- [ ] Register/chạy `translation-budget.test`, xác nhận RED.
- [ ] **GREEN:** budgets theo code khởi tạo:

```ts
const recoveryLimit=Math.max(4,Math.ceil(B*0.5))
const activeBudgetMs=Math.max(600_000,B*90_000+recoveryLimit*60_000)
```

charge trước khi request được dispatch, persisted bởi T8 callback trước network.
Mọi normal batch chỉ charge normal một lần; perBatch track original batch ID để
child không lấy identity mới vượt cap. Task rephrase là stage riêng với budget
của planned rephrase batches, cùng API và giới hạn finite; không tiêu hao translation
credits đã hoàn tất hoặc nhận Infinity chỉ vì nằm sau translation.

- [ ] Chạy tests và typecheck; document defaults chưa qualified, không sửa test
hiện tại “no default cap” thành cap thấp mà chưa có workload-based replacement.
- [ ] Commit explicit T5 files `feat(translation): add shared workload recovery budget`.

Ba method claim/record kiểm tra giới hạn và cập nhật snapshot, không charge inference
thay cho `charge`; caller phải gọi charge cho mọi request sau đó. requestKey là
hash original batch ID + exact requested IDs + prompt task, không có credential.
Giới hạn transport 2/exact requestKey, format 1/idSetKey và depth2 được giữ khi
restore; normalCharged ngăn cùng original batch lấy normal credit hai lần.

## T6 — Orchestrator chung và adapter một request

**Files:** Create `src/main/translation/orchestrator.ts`, initial
`src/main/translation/planner.ts`, `tests/translation-orchestrator.test.ts`,
`tests/translation-provider-contract.test.ts`; modify localTranslate.ts, gemini.ts,
openai.ts, autoshort.ts, autoShortItemCoordinator.ts, localTranslatePolicy.ts,
tests/local-translation.test.ts và runner.

**Interfaces:** Adapter/Capability/PlannedTranslationBatch theo spec section5.
Khởi đầu planner bọc grouping legacy, không mở rộng token behavior trước T9.

```ts
interface TranslationPlan { batches:PlannedTranslationBatch[]; planVersion:string }
function planTranslation(input:TranslationInput, capability:TranslationCapability):TranslationPlan
type BatchCallback=(batchId:string,result:TranslationBatchResult,
  budget:TranslationBudgetSnapshot)=>Promise<void>
function translateWithAdapter(input:TranslationInput, adapter:TranslationAdapter,
  signal:AbortSignal, onBatch?:BatchCallback):Promise<TranslationBatchResult>
```

Export plan type/planner API từ planner.ts. Initial orchestrator supports injected
budget in options overload at T8; keep stable default four-argument wrapper. Wrapper
legacy translateSrt vẫn gọi typed path và serialize output một lần sau validation.

- [ ] **RED:** fake adapter với missing tail, same bad output, forbidden error,
truncation, cancellation và one-cue long-response.

```ts
test('only missing work is retried and total requests is finite', async () => {
  const requested:string[][]=[]
  const adapter:TranslationAdapter={capability:fixtureCapability,
    async requestOnce(batch,signal){
      signal.throwIfAborted()
      const ids=batch.input.cues.map(c=>c.id); requested.push(ids)
      const returned=requested.length===1 ? ids.slice(0,-1) : ids
      return {raw:JSON.stringify({items:returned.map(id=>({id,t:`translated ${id}`}))}),
        truncated:false,modelIdentity:'fixture@1'}
    }}
  const result=await translateWithAdapter(fixtureInput,adapter,new AbortController().signal)
  assert.equal(result.items.length,fixtureInput.cues.length)
  assert.equal(requested[1].length,1)
})
```

Test module defines `fixtureCapability` as local/fixture@1/revisionKnown true,
json-items/contextTokens8192/outputTokens2048; fixtureInput from spec type with
two cues a/b (0–1,1–2), source zh,target en,mode subtitle,empty context/glossary.
No arbitrary external request; replace fetch in tests and restore in finally.
For every adapter inspect outgoing headers/schema/messages and response normalization
without loading real keys; test abort during model discovery and response body.

- [ ] Register/run new suites to RED and existing local-translation.test baseline.
- [ ] **GREEN:** use iterative queue of pending work; each work holds original
batchId, requested ID set, splitDepth, known valid IDs and last fingerprint.

```ts
while(pending.length){
  signal.throwIfAborted()
  const work=pending.shift()!
  budget.charge(work.kind,work.originalBatchId)
  await beforeDispatch(budget.snapshot())
  const response=await adapter.requestOnce(work.batch,requestSignal)
  // Parse with shared parser; accept only valid IDs; requeue bounded missing/split work.
}
```

`pending`/work local scheduler structures must include fields shown; `beforeDispatch`
defaults async no-op and becomes persistence hook T8. `requestSignal` combines
parent abort and min(180s, remaining) timeout. Dequeue/requeue algorithm rules:
nonempty unparsed content/truncated cannot publish partial text; valid ID subsets
from clean nontruncated response can be retained. Every rescheduled request kind
recovery. At per-batch/depth/repair limit stop original batch needs-review, checkpoint
valid prior batches. Do not eagerly spend all child credits if remainder cannot
finish; failure partial states remain inspectable.

Model fallback uses configured max2 list inside adapter selection orchestration;
adapter itself never loops models. Stop 401/403/refusal immediately. UI/key-check
paths may retain existing behavior separately, but translation cannot inherit their
unbounded model-list fallback. Discovery signal and deadline cover fetch/body.
Use getGlobalResourceManager lease exactly once at network layer; avoid nested
lease acquisition deadlock. Drain before returning retryable error.

- [ ] Run budget/orchestrator/provider/local/content/response tests. Replace old
“requests>7” expectation with shared budget/no-progress finite result, preserve
117-cue success and missing-only recovery tests. Run typecheck.
- [ ] Commit `refactor(translation): share bounded orchestration across providers`.

## T7 — Input identity và validation-aware artifact cache

**Files:** Create `src/main/translation/checkpoint.ts`, `tests/translation-identity.test.ts`;
modify autoShortItemCoordinator.ts, autoShortStageKeys.ts, autoShortArtifactCache.ts
only if metadata envelope support required, tests/autoshort-stage-cache.test.ts, runner.

**Interfaces:**

```ts
interface TranslationIdentity {
  provider:string; modelIdentity:string; revisionKnown:boolean
  profileId:string; promptVersion:string; parserVersion:string
  plannerVersion:string; assessmentVersion:string; options:Record<string,unknown>
}
function buildTranslationIdentity(input:TranslationInput, identity:TranslationIdentity):string
interface TranslationArtifact {
  schemaVersion:2; key:string; modelIdentity:string
  result:TranslationBatchResult
}
```

Hash main-process only. `profileId` opaque local app profile, not credential hash.
Canonical input includes cue order/text/timing and glossary/context; copy input
instead of mutating normalized text or stripping marks. Normalize locales only
through locale API added T10; until then canonical string normalization consistent
with prompt, do not lower/flatten text.

- [ ] **RED:** identity text correction same video/timing must change key:

```ts
test('corrected source cannot reuse an old translation',()=>{
  const a={...fixtureInput,cues:[{id:'a',sourceIndex:0,start:0,end:2,
    text:'不要摸狗',groupId:'g0'}]}
  const b={...a,cues:[{...a.cues[0],text:'可以摸狗'}]}
  assert.notEqual(buildTranslationIdentity(a,fixtureIdentity),buildTranslationIdentity(b,fixtureIdentity))
})
```

Define fixtureIdentity local/fixture@1/revisionKnown true/profileId fixture,
prompt translation-v4/parser-v2/planner-v1/assessment-v2/options{}; fixtureInput
same fields as T6. Additional tests locale variant, same object order, changed
model/prompt/context/glossary/options; secrets absent from manifest.

- [ ] Register/run identity + stage-cache suites RED.
- [ ] **GREEN:** use canonicalJson/buildStageKey helpers. Publish only after
structural assessment; envelope retains warnings. Cache get verifies key/schema/
effective model + artifact digest, then re-runs same assessment as fresh.
Unknown model revision skips persistent translation cache across job by default.
Fallback result stores actual modelIdentity; query only identities in the selected
allowed model profile, never stamp fallback output as primary model.

```ts
if(capability.revisionKnown && assessment.disposition!=='needs-review') {
  await artifactCache.put('translation',key,validatedEnvelopePath,signal)
}
```

`validatedEnvelopePath` in item scope, written using safe contained path. Cache
lease always released finally. Validation policy change invalidates assessment;
do not erase original valid bytes or source outputs. Avoid raw provider prompt logs.

- [ ] Run identity/artifact/stage-cache/coordinator suites + typecheck; cache hit
must preserve warnings and never call provider on validated hit.
- [ ] Commit `fix(translation): key reusable artifacts by validated source and model identity`.

## T8 — Batch checkpoint, migration và failure fingerprint

**Files:** Modify checkpoint.ts, orchestrator.ts, autoShortItemCoordinator.ts,
autoshort.ts; create `tests/translation-resume.test.ts`; modify item-scope/queue
tests và runner.

**Interfaces:**

```ts
interface TranslationCheckpoint {
  schemaVersion:2; key:string; generation:number; plan:TranslationPlan
  batches:Record<string,TranslationBatchResult>
  budget:TranslationBudgetSnapshot
  failures:Record<string,{fingerprint:string;repeats:number;requestedIds:string[]}>
  disposition:'running'|'validated'|'with-warnings'|'needs-review'|'error'|'cancelled'
  inFlight?:{originalBatchId:string;chargedAt:number;timeoutMs:number}
}
function readTranslationCheckpoint(path:string,root:string,key:string):Promise<TranslationCheckpoint|null>
function writeTranslationCheckpoint(path:string,root:string,data:TranslationCheckpoint):Promise<void>
```

T6 wrapper giữ nguyên, thêm optional thứ năm:
`options?: {checkpoint?: TranslationCheckpoint; beforeDispatch?: (snapshot:TranslationBudgetSnapshot)=>Promise<void>}`.
Checkpoint exports từ checkpoint.ts. Types referencing TranslationPlan/budget use
type-only imports, không tạo initialization cycle. Migration read xử lý ENOENT
như miss, permission/error disk báo đúng stage; không nuốt mọi lỗi thành cache miss.

- [ ] **RED:** simulate batch1 success, batch2 fail, resume. Assertions:

```ts
assert.deepEqual(resumedRequestedIds,failedBatchIds)
assert.equal(resumedBudget.recoveryUsed,previousRecoveryUsed+newRecoveryCalls)
assert.deepEqual(resumedWarnings,previousWarnings)
assert.equal(nextQueueItem.status,'done')
```

Các biến lấy từ fake adapter captured calls của fixture 2 batches (planner mock
1 cue/batch); một 503 rồi abort, write checkpoint, fresh orchestrator đọc lại.
Test separate no-progress terminal re-open không dispatch; key change opens new
checkpoint; legacy translation is ignored/source retained; warning content version
revalidated; truncated/partial manifest rejected; concurrent writers serialized.

- [ ] Register/run resume suite RED.
- [ ] **GREEN:** atomic temp-write+rename scoped root; persist before network and
after every accepted batch, serialized writes per item. Restore exact planned B,
used credits/depth/fingerprint and activeElapsedMs; do not replan and assign new
normal credits silently. Crash inFlight conservative timeout charge per spec.

```ts
if(saved?.key===key && saved.disposition==='needs-review') {
  return saved // caller renders review state; no provider dispatch
}
```

Đoạn trên là checkpoint/resume decision boundary, không return checkpoint từ
translateWithAdapter vốn trả TranslationBatchResult; caller map terminal typed
failure trước khi gọi orchestrator. Legacy migration không xóa cả checkpointDir
khi chỉ translationPromptVersion đổi; tách source fingerprint khỏi translation
identity. Resume validation dùng cùng functions T1/T2, không chỉ cueCount.

Manual retry API T11 tạo explicit generation mới; T8 expose
`createTranslationRetryGeneration(saved): TranslationCheckpoint` trả immutable copy,
increment generation và reset recovery/elapsed/failures/inFlight, giữ valid batches
đã revalidate cùng key và mark running. Credits normal của batches retained vẫn
tính đã dùng; chỉ các original batches chưa hoàn tất được charge normal tối đa
một lần/generation. Identity không khớp không giữ old target batches.

- [ ] Run resume/identity/orchestrator/queue/item-scope + typecheck. Inject write
failure: không dispatch request nếu charge chưa lưu; giữ source và previous checkpoint.
- [ ] Commit `feat(translation): persist validated batches and bounded retry state`.

## Gate B

- [ ] Budget holds across provider, split, repair, timeout và restart; queue không lặp item terminal.
- [ ] Cache mới không nhận legacy translation thiếu identity; source checkpoint còn nguyên.
- [ ] Run `npm.cmd run typecheck` và các suites T5–T8 + local/content/UI regression.
- [ ] Log counters normal/recovery/split/max-depth/reused-batches/no-progress; không raw secret.
- [ ] Cập nhật docs/handoff trước C; không công bố speedup chỉ từ cache fixture.
