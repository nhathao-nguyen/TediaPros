# Translation C — Locale, User Flow and Qualification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thích nghi batching/ngôn ngữ và cung cấp trạng thái rõ ràng; đánh giá chất lượng bằng corpus, không suy từ test pass.

**Architecture:** Planner/capability cấp input cho orchestrator B; language assessment trả evidence thay boolean cứng. UI nối warning/review/resume qua typed IPC; qualification là opt-in harness riêng.

**Tech Stack:** TypeScript, Intl.Locale/Segmenter, React/Electron IPC, Node test runner, existing FFmpeg/media tooling.

**Spec:** [Design](../specs/2026-09-07-translation-reliability-design.md), sections 5–8; prerequisites Gates A và B.

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

## T9 — Locale-aware grouping và token planning

**Files:** Modify `src/main/translation/planner.ts`, `src/main/semanticGrouping.ts`,
`src/main/translate-shared.ts`, `src/main/translation/orchestrator.ts`;
create `tests/translation-planner.test.ts`, register runner.

**Interfaces:** `planTranslation`/TranslationPlan từ T6; tăng planVersion thành
`translation-plan-v2`. Thêm:

```ts
interface TranslationUnitMapping {
  unitId:string; originalId:string; partIndex:number
  startOffset:number; endOffset:number
}
function restoreOriginalCues(source:readonly TranslationCue[], items:readonly TranslationItem[],
  mapping:readonly TranslationUnitMapping[], targetLocale:string):TranslationItem[]
function joinGroupText(cues:readonly SemanticCue[], locale?:string):string
```

TranslationPlan thêm `mapping: TranslationUnitMapping[]` bắt buộc cho plan-v2;
plan-v1 checkpoint đọc với single-unit identity mapping, không biến phần đã làm
thành credit mới. Các string offsets là JS UTF-16 offsets, không split surrogate
pair; segmenter return index để reconstruct nguyên source byte-equivalent string.

- [ ] **RED:** Hangul spacing và long cue roundtrip:

```ts
test('Korean context keeps word spacing',()=>{
  assert.equal(joinGroupText([{text:'나는'},{text:'학생입니다'}],'ko'),'나는 학생입니다')
})
test('all source spans survive internal unit planning',()=>{
  const p=planTranslation(longCueInput,tinyCapability)
  const spans=p.mapping.filter(m=>m.originalId==='a').sort((a,b)=>a.partIndex-b.partIndex)
  assert.equal(spans.map(m=>longCueInput.cues[0].text.slice(m.startOffset,m.endOffset)).join(''),longCueInput.cues[0].text)
  assert.equal(new Set(p.batches.flatMap(b=>b.input.cues.map(c=>c.id))).size,spans.length)
})
```

Define longCueInput one cue a, text `'Một câu dài. '.repeat(200)`, 0–30s/group g,
source vi/target en/mode subtitle; tinyCapability local/fixture@1/revisionKnown
true/json-items/contextTokens4096/outputTokens512/countTokens=text=>UTF8 byteLength
for deterministic test (a fake counter, not real tokenizer). Include zh/ja no
spurious spaces, Thai/Hindi combining marks, emoji, RTL, no whitespace long string,
tiny output limit, empty/inconsistent capability, context overhead > allowance,
missing unit, duplicate part and unchanged original timing after restore.

- [ ] Register/run planner and local suites RED.
- [ ] **GREEN:** compute system+schema+context+source serialized cost before grouping;
reserve output budget based on target profile when qualified. Unknown tokenizer
estimate is labeled; never count 24 cues as proof output <=1536 tokens.

```ts
const inputCost = capability.countTokens?.(serializedRequest)
  ?? new TextEncoder().encode(serializedRequest).length
const limit = capability.contextTokens
if(limit !== null && inputCost + reservedOutput > limit) splitAtSemanticBoundary()
```

`serializedRequest` exact request messages/schema representation, `reservedOutput`
finite output allowance from capability, `splitAtSemanticBoundary` local planner
function implementing sentence→word→grapheme splitting and source mappings. If
instructions alone exceed profile, return unsupported-capability before any request.
Unknown context/output limits use legacy compatibility profile and warning; do
not invent a detected token limit. For unknown output limit keep existing max_tokens
2048 ceiling initially; qualified profile may override explicitly. Do not use
Unicode code-point count as exact model-token count.

Join locale ko with whitespace, zh/ja script boundaries according context, other
scripts preserve natural separators. Stable source ID and exact spans survive
internal parts; restore rejects incomplete set, joins target parts by locale and
uses original cue timing. Large cue split occurs during planning before B defined;
runtime truncation split is recovery with same B and <=2 depth.

- [ ] Run planner/orchestrator/response/identity/semantic grouping existing tests
and typecheck; no timing or tempo policy drift.
- [ ] Commit `feat(translation): plan locale-aware units within provider budgets`.

## T10 — Language assessment và stage capability matrix

**Files:** Create `src/main/translation/language.ts`, `tests/translation-language.test.ts`;
modify localTranslate.ts, autoshort.ts, autoShortItemCoordinator.ts,
src/shared/translation.ts, src/shared/autoShortContract.ts, src/main/tts.ts và runner.

**Interfaces:**

```ts
type StageCapability={stage:'asr'|'ocr'|'translation'|'tts'|'render';required:boolean;
  support:'supported'|'unsupported'|'unknown';qualified:boolean;reason:string}
function normalizeTranslationLocale(value:string, allowAuto?:boolean):string
function assessTranslationLanguage(input:TranslationInput,
  items:readonly TranslationItem[]):Pick<TranslationAssessment,'languageEvidence'|'issues'>
function resolveTranslationReadiness(stages:readonly StageCapability[]):{
  canStart:boolean;warnings:StageCapability[];blocking:StageCapability[]
}
```

Validate target BCP47; migrate empty saved locale to existing explicit default,
not auto, preserve valid variants. Source allowAuto accepts auto/mixed/unknown
sentinels without passing them to Intl.Locale. Invalid explicit tag báo config
error; arbitrary natural-language labels do not become locale tags silently.

- [ ] **RED:** same-script case cannot become matched by script alone:

```ts
test('same script is not proof of French translation',()=>{
  const input:TranslationInput={sourceLanguage:'en',targetLocale:'fr',mode:'subtitle',
    cues:[{id:'a',sourceIndex:0,start:0,end:2,groupId:'g',text:'This dog is friendly.'}],
    contextBefore:[],contextAfter:[],glossary:[]}
  const a=assessTranslationLanguage(input,[{id:'a',text:'This dog is friendly.'}])
  assert.notEqual(a.languageEvidence,'matched')
  assert.ok(a.issues.every(i=>i.severity==='warning'))
})
```

Test named-brand-only output, mixed zh/en, source=target, ja/ko/Thai/Arabic/Hindi,
locale variants and unknown. Capability test TTS unknown with ttsEnabled false
không block; explicit unsupported required TTS block; unknown required warns.

- [ ] Register/run language/contract suites RED.
- [ ] **GREEN:** consolidate two script implementations; script/content-copy ratio
đều heuristic. Không có qualified detector thì không trả matched chỉ nhờ script.
Trường hợp source=target không bắt dịch vòng để khác chữ. Semantic unknown
warn không tự trigger repair. Use actual cue text, configured/detected source
metadata, explicit mismatch warning, không override user locale.

```ts
const blocking=stages.filter(s=>s.required && s.support==='unsupported')
const warnings=stages.filter(s=>s.required && (s.support==='unknown'||!s.qualified))
return {canStart:blocking.length===0,blocking,warnings}
```

Readiness health-check chỉ report connectivity. Capability metadata từ TTS/server
có allowed language list; missing list→unknown. Qualification record không tự
được tạo khi model endpoint trả 200. Font readiness dựa trên existing font resolver
và glyph support; render shaping/RTL chất lượng thật vẫn T12. No-speech source
trả needs-review với code invalid-source/no source cues và message riêng.

- [ ] Run language/content/contract/TTS regression + typecheck; unknown không
phải universal language support claim.
- [ ] Commit `feat(translation): report locale evidence and stage capabilities`.

## T11 — Full warning/review/resume UX và typed IPC

**Files:** Modify src/shared/types.ts, src/shared/translation.ts, src/preload/index.ts,
src/main/index.ts, src/main/autoshort.ts, src/main/autoShortItemCoordinator.ts,
src/main/autoShortQueueRunner.ts, src/renderer/src/components/AutoShort.tsx,
src/renderer/src/lib/autoshortProgressCoalescer.ts only if terminal handling needs
extension; tests/autoshort-ui-contract.test.ts, tests/ipc-origin-validation.test.ts;
create `tests/translation-review-flow.test.ts`, register runner.

**Interfaces:** optional assessment from T1; `needsReviewCount` subset existing
errorCount, warnings count independent of total. Add typed method:

```ts
autoShortRetryTranslation(request:{itemId:string;expectedIdentity:string}):Promise<{
  ok:boolean;generation?:number;error?:string
}>
```

Main resolves checkpoint paths from app-owned item registry, never accepts arbitrary
path from Renderer. Request only prepares one new generation via T8; UI then calls
normal job-start once. Main prevents duplicate in-flight generation requests;
stale expectedIdentity refuses without deleting existing data. Authenticated app
renderer origin gate applies exactly like current AutoShort start/cache handlers.

- [ ] **RED:** review-flow fixture runs item A fails contract, B done. Assert:

```ts
assert.equal(summary.totalCount,2)
assert.equal(summary.completedCount,1)
assert.equal(summary.errorCount,1)
assert.equal(summary.needsReviewCount,1)
assert.equal(summary.cancelledCount,0)
assert.equal(fakeProvider.callsAfterAutomaticRerender,0)
```

Fixture uses queueRunner with mocked processItem/events and UI state transitions.
Test repeated retry click creates exactly one generation; no auto-trigger from
progress listener; missing old optional fields render normally; terminal warning
flush; IPC rejects frame/untrusted origin and arbitrary path key.

- [ ] Register/run review-flow/UI/IPC suites RED.
- [ ] **GREEN:** statuses Vietnamese “Hoàn tất”, “Hoàn tất · N cảnh báo”, “Cần kiểm tra”,
“Lỗi kỹ thuật”, “Đã hủy”. Expandable details show full error not truncated-only text,
stage/cue/time and retry credit usage. Existing buttons open app-owned valid source/
translated SRT; no claimed final MP4 for needs-review.

```ts
const displayNeedsReview = result.status==='error' &&
  result.translationAssessment?.disposition==='needs-review'
const displayWarnings = result.status==='done' &&
  (result.translationAssessment?.issues.some(i=>i.severity==='warning') ?? false)
```

Explicit retry button displays operation scope and possible new provider calls;
doesn't require a second prompt if existing UI click clearly authorizes retry.
Keeps valid batches only under same identity; user editing config starts new key.
No UI promise that warnings mean meaning verified. Cleanup listeners retained;
don't show internal provider raw prompts/credentials in diagnosis.

- [ ] Run typecheck + review/UI/IPC/queue/scope suites. Then full integration:
`npm.cmd run test:local-runtime`, `npm.cmd run build`, `git diff --check`.
- [ ] GUI acceptance on actual app: warning video, structural failure, multi-item
queue, restart/resume, retry double-click and cancel. If native GUI unavailable,
record blocker, don't equate source tests with visual acceptance.
- [ ] Commit `feat(autoshort): expose translation review and bounded retry actions`.

## T12 — Multilingual corpus và release decision

**Files:** Create `tests/translation-multilingual.test.ts`,
`tests/fixtures/translation-multilingual/cases.json`,
`scripts/translation-qualification-main.ts`,
`docs/benchmarks/translation-qualification.md`,
`docs/releases/translation-reliability-acceptance.md`;
modify runner, package.json only for harness entry script, handoff.

**Interfaces:** JSON fixture/harness record schemas defined here; default offline.

```ts
interface TranslationQualificationCase {
  id:string;sourceLocale:string;targetLocale:string
  source:string;reference:string
  expected:'valid'|'warning'|'needs-review'
  tags:string[]
}
interface TranslationQualificationRun {
  schemaVersion:1;caseId:string;variant:'baseline'|'candidate';run:number
  modelIdentity:string;promptVersion:string;mode:'offline'|'live'
  inputDigest:string;elapsedMs:number;requests:number;recoveryRequests:number
  lostCueCount:number;unexpectedCueCount:number
  semanticReview:'pending'|'pass'|'fail';naturalness:number|null
}
```

Live reference text must be reviewed by a competent source/target speaker; fixture
labels generated by model alone are not semantic gold. Offline cases arbitrary
texts only validate preservation/contract. Redact filenames/server credentials
from exported run report, keep human reviewer identity optional local metadata.

- [ ] **RED:** create actual cases with known behavior:

```json
[
  {"id":"zh-en-negation","sourceLocale":"zh","targetLocale":"en","source":"不要摸这只狗。","reference":"Do not touch this dog.","expected":"warning","tags":["negation","cross-script"]},
  {"id":"vi-en-number-word","sourceLocale":"vi","targetLocale":"en","source":"Có 2 con chó.","reference":"There are two dogs.","expected":"warning","tags":["numeric-representation"]},
  {"id":"en-ar-digits","sourceLocale":"en","targetLocale":"ar","source":"There are 12 dogs.","reference":"هناك ١٢ كلبًا.","expected":"warning","tags":["unicode-digits","rtl"]}
]
```

Expected warning reflects unqualified semantic/language assessment, not claim
that these translations are wrong. Add contract fixture malformed continuation
needs-review; number/sign/negation changes warnings; empty ID/cue hard error.
Generate 240 directed locale-pair mock passes from DICH_LANGS only for transport
contract; do not synthesize “reference translations” and call them reviewed.

- [ ] Register/run multilingual suite and harness dry-run schema tests; RED for
missing corpus loader/report. Register `translation-qualification.test` if new
harness contract tests are created; all names added knownTests before invocation.
- [ ] **GREEN:** harness flags `--mode offline|live`, `--manifest <absolute file>`,
`--output <absolute contained dir>`, `--variant baseline|candidate`, `--runs 3`,
`--dry-run`. Offline default never fetches, live only explicit. Dry-run enumerates
cases/model/provider/request upper bounds and outputs pending review report,
never silently credentials or raw source. No seed determinism claim unless
selected provider actually supports validated seed behavior.

```ts
if (mode==='offline') {
  await runOfflineCases(manifest)
} else {
  if (!explicitLiveFlag) throw new Error('Live qualification requires --mode live')
  await runLiveCases(manifest)
}
```

`runOfflineCases`/`runLiveCases` local harness functions output exact run schema
and resource limits; explicitLiveFlag set only by command-line argument (not
manifest instruction). Integrate existing translator adapter code, mock transport
offline; no UI automation to dispatch cloud calls.

- [ ] Run offline suite, full typecheck/runtime test/build if any source changed
after T11; if only corpus/docs changed, relevant suites suffice. Run FFmpeg
subtitle/font smoke when render qualification touched; missing dependency is
documented unqualified, not auto-download.
- [ ] Execute live pilot only when authorized scope/models/inputs/cost preflight
are concrete; 8 pairs ×3 clip types ×3 repetitions ×2 variants is maximum initial
matrix, not an automatically dispatched workload. Keep pilot results separate
from matrix completion. Human review checks severe semantic errors, omissions,
numbers/names/negation and naturalness, plus actual TTS/video artifacts.
- [ ] Apply gates section8 spec: no loss/silent fallback; bounded failure; 0 severe
errors in accepted corpus; naturalness median >=4/5, latency p95 <=1.10x baseline,
repair calls not worse. Compare comparable workload and report sample count;
when insufficient sample don't declare universal reliability.
- [ ] Fill acceptance ledger for source, offline, live, GUI, media, package rows
with pass/fail/unqualified and artifact pointers. No empty “pass” without command.
- [ ] Commit `test(translation): add multilingual qualification and release evidence`.

## Gate C / rollout

- [ ] Config/cache migration tested against pre-series data without deletion.
- [ ] Finish full local checks, UI gate and target pilot evidence separately.
- [ ] Keep model/locale profiles unqualified outside observed matrix; don't market all-language support.
- [ ] Rollback record points to last known-good commit in series with P1 fixes;
do not restore old lossy parser or false-block guard as a performance fallback.
- [ ] Handoff reports commits, tests and remaining gates; merge/push/package only
when separately requested. App behavior changes are delivered as code, not claimed
running until the user-visible app is rebuilt/restarted and verified.
