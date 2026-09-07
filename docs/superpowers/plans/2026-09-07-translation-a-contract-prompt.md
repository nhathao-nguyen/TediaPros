# Translation A — Contract, Quality and Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loại bỏ semantic false block và mất nội dung âm thầm; tách prompt dịch/rephrase/repair.

**Architecture:** Đặt assessment/response/prompt contracts chung trước khi thay scheduler. Giữ wrappers provider đang dùng; thêm warnings qua typed AutoShort events và giữ stable cue mapping.

**Tech Stack:** TypeScript, Electron IPC, React, node:test/esbuild.

**Spec:** [Design](../specs/2026-09-07-translation-reliability-design.md), sections 2–4 và 7.

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

## T1 — Assessment và warning UI tối thiểu

**Files:** Create `src/shared/translation.ts`; modify `src/main/autoShortContentQuality.ts`,
`src/main/autoShortItemCoordinator.ts`, `src/shared/types.ts`,
`src/renderer/src/components/AutoShort.tsx`, `tests/autoshort-content-quality.test.ts`,
`tests/autoshort-ui-contract.test.ts`; register new tests in `scripts/run-local-runtime-tests.mjs`.

**Interfaces:** tiêu thụ SubtitleCue hiện có; sản xuất `TranslationIssue`,
`TranslationAssessment` theo spec, `assessContentQuality(source, target): TranslationAssessment`.
Giữ `validateAutoShortContentQuality` compatibility wrapper `{ok,findings}` nếu còn
callers, ok chỉ false cho structural error. Thêm optional
`translationAssessment?: TranslationAssessment` vào item progress/result/event.
Không thêm terminal enum mới trong phase A.

- [ ] **RED:** thêm test tái hiện đa ngôn ngữ; giữ test numeric mismatch nhưng đổi
  expectation từ hard error sang warning. Structural mismatch vẫn false.

```ts
test('negation across scripts is review evidence, not a structural failure', () => {
  const source = [{ id:'c1', start:0, end:2, text:'不要摸这只狗。' }]
  const target = [{ id:'c1', start:0, end:2, text:'Do not touch this dog.' }]
  const result = assessContentQuality(source, target)
  assert.notEqual(result.disposition, 'needs-review')
  assert.ok(result.issues.every(i => i.severity === 'warning'))
})
```

Thêm `2→two`, `12→١٢`, same-source unchanged, empty target, missing/duplicate ID.
UI test terminal done chứa warning vẫn còn badge sau progress flush và reload
queue state; không dùng source-grep test làm bằng chứng GUI render.

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-content-quality.test autoshort-ui-contract.test`, xác nhận RED vì behavior mới chưa có.
- [ ] **GREEN:** tách hai nhóm evidence. Dùng cấu trúc sau tại coordinator:

```ts
const assessment = assessContentQuality(sourceCues, targetCues)
if (assessment.disposition === 'needs-review') {
  throw new Error(assessment.issues.find(i => i.severity === 'error')!.message)
}
// Carry assessment in item state and terminal result, not only a transient log.
```

Structural checks gồm source nonempty/unique ID, finite start/end, end>=start,
target exactly expected IDs và nonempty. Không ép timestamp của text-only provider;
mapping lấy source timing. Semantic regex không được trả certainty=certain.
UI hiển thị “Hoàn tất · N cảnh báo” và danh sách cue/code/message có thể mở.
Lỗi severe source invalid không cho qua chỉ để giữ queue chạy.

- [ ] Rerun hai suite + `npm.cmd run typecheck`; cập nhật docs benchmark quality
  với ý nghĩa warning/validated, lưu evidence issue regression.
- [ ] `git diff --check`, stage explicit files T1, commit `fix(translation): separate structural errors from semantic warnings`.

## T2 — Parser không mất nội dung và mapping strict theo ID

**Files:** Create `src/main/translation/response.ts`, `tests/translation-response.test.ts`;
modify `src/main/translate-shared.ts`, `src/main/localTranslate.ts`, `src/main/gemini.ts`,
`src/main/openai.ts`, `src/main/autoshort.ts`, test runner.

**Interfaces:**

```ts
type ParseOutcome = {
  items: TranslationItem[]
  issues: TranslationIssue[]
  complete: boolean
}
function parseTranslationResponse(
  raw: string, format: TranslationFormat, expectedIds: readonly string[],
  truncated: boolean, contextIds: readonly string[] = []
): ParseOutcome
function mapTranslationsStrict(
  source: readonly SubtitleCue[], items: readonly TranslationItem[]
): SubtitleCue[]
```

`ParseOutcome` export từ response.ts; source/target runtime types import từ shared.
Compatibility parser dùng cùng engine nhưng không được bỏ `unparsed-content`.

- [ ] **RED:** viết test continuation mất chữ và JSON newline hợp lệ:

```ts
test('cannot certify a response whose continuation would be discarded', () => {
  const result = parseTranslationResponse('[c1] First part\nsecond part', 'id-lines', ['c1'], false)
  assert.equal(result.complete, false)
  assert.ok(result.issues.some(i => i.code === 'unparsed-content'))
})
test('maps by identity even when provider changes order', () => {
  const src = ['a','b'].map((id,i) => ({id,start:i,end:i+1,text:`source ${id}`}))
  const out = mapTranslationsStrict(src,[{id:'b',text:'B'},{id:'a',text:'A'}])
  assert.deepEqual(out.map(c=>[c.id,c.start,c.text]),[['a',0,'A'],['b',1,'B']])
  assert.throws(()=>mapTranslationsStrict(src,[{id:'a',text:'A'}]))
})
```

Test thêm complete/incomplete fence, JSON root mismatch, escaping, unknown ID,
duplicate, known context extra, malformed JSON, truncated response đủ ID.
Boundary test translateStrict count mismatch không được copy nguồn hoặc ghi output.

- [ ] Register `translation-response.test`; chạy suite đó và `local-translation.test`, xác nhận RED.
- [ ] **GREEN:** chọn grammar theo format; nếu fallback compatibility nhận JSON
  thì detect toàn response, không trộn line parsing vào JSON parse lỗi.

```ts
const extraLines = lines.filter(line => line.trim() && !idLinePattern.test(line))
if (extraLines.length) issues.push({
  code:'unparsed-content',severity:'error',confidence:'certain',cueIds:[],
  message:'Phản hồi có nội dung ngoài định dạng; cần sửa trước khi dùng.'
})
```

`idLinePattern` local const `/^\s*\[[^\]]+\]\s*.+$/u` chỉ là grammar screening;
parse chi tiết vẫn kiểm ID và text. Không đưa extraLines raw vào IPC/log.
Trong autoshort.ts loại bỏ fallback `match?.text || srcCue.text`; map strict trước
serialize. Các adapter trả typed items nội bộ; wrappers cũ trả SRT/count như trước.
Nếu mất ID sau SRT boundary, kiểm nguồn/cardinality và mapping upstream, không
đoán missing ID. Phase B sẽ dùng typed items trực tiếp end-to-end.

- [ ] Chạy response/local/content suites + typecheck; output cũ không bị ghi đè
  khi response fail; giữ metadata caption nguyên khi không nằm trong format header.
- [ ] Stage explicit T2 files, commit `fix(translation): reject lossy responses and remove source fallback`.

## T3 — Prompt dịch và repair contract nhất quán

**Files:** Create `src/main/translation/prompts.ts`, `tests/translation-prompts.test.ts`;
modify translate-shared.ts, localTranslate.ts, gemini.ts, openai.ts, autoshort.ts,
autoShortItemCoordinator.ts và test runner.

**Interfaces:**

```ts
type ModelMessage = { role:'system'|'user'; content:string }
const TRANSLATION_PROMPT_VERSION = 'translation-v4'
const TRANSLATION_PARSER_VERSION = 'translation-parser-v2'
function buildTranslationMessages(input: TranslationInput, format: TranslationFormat): ModelMessage[]
function buildRepairMessages(input: TranslationInput, format: TranslationFormat,
  issues: readonly TranslationIssue[], expectedIds: readonly string[]): ModelMessage[]
```

ModelMessage/type/constants export từ prompts.ts; repair source vẫn có đầy đủ context
nhưng expectedIds chỉ là tập cần sửa. Không echo raw model prose vào instruction.

- [ ] **RED:** test matrix provider/mock + mode cho target cụ thể:

```ts
test('one target and one output grammar per request', () => {
  const input: TranslationInput = {
    sourceLanguage:'zh',targetLocale:'en',mode:'subtitle',cues:[],
    contextBefore:[],contextAfter:[],glossary:[]
  }
  const messages = buildTranslationMessages(input,'json-items')
  assert.match(messages[0].content,/target_locale=en/u)
  assert.doesNotMatch(messages.map(m=>m.content).join('\n'),/target_language=auto/u)
  assert.throws(()=>buildTranslationMessages({...input,targetLocale:'auto'},'json-items'))
})
```

Add tests actual provider body schema/payload, target variants, subtitle mode không
có duration hint/13 graphemes, source text có instructions vẫn nằm trong data,
repair chỉ expected ID lỗi. Test exact stable prompt snapshot như contract;
snapshot không được tuyên bố semantic quality.

- [ ] Register/chạy `translation-prompts.test`, `local-translation.test` để RED.
- [ ] **GREEN:** lấy nguyên prompt lõi trong review, sửa header `source_language`,
  `target_locale`, task và mode theo spec. Output schema được chọn một lần:

```ts
const mode = config.ttsEnabled ? 'dubbing' : 'subtitle'
const messages = buildTranslationMessages({...input,mode}, adapterFormat)
```

`input` là TranslationInput của request; `adapterFormat` là format đã chọn cho
provider hiện tại (Local id-lines, cloud json-items). Gemini schema object items
và OpenAI schema phải cùng map về `{id,text}`; không đổi raw public API checkKey.
Nếu keep legacy `huongDan`, wrapper phải chọn task/contract rõ ràng, không để
rephrase tiếp tục nhận translate system sau T4.
Bump translation prompt reference trong checkpoint và stage key; legacy translation
bị bỏ qua có thông báo, source checkpoint không bị xóa chỉ vì prompt đổi.

- [ ] Rerun prompt/response/local/stage-cache suites + typecheck. Đo prompt UTF-8
  bytes trên cùng fixture, chỉ báo bytes giảm/tăng, không suy ra speedup.
- [ ] Commit `refactor(translation): unify prompt targets modes and output contracts` với explicit files.

## T4 — Rephrase tách nhiệm vụ và có source context

**Files:** Modify prompts.ts, autoshort.ts, src/main/dubbing/synthesis.ts;
tests/translation-prompts.test.ts, tests/autoshort-tts-pipeline.test.ts;
create `tests/translation-rephrase.test.ts`, register runner.

**Interfaces:**

```ts
interface RephraseInput {
  targetLocale: string
  cues: Array<{id:string;sourceText?:string;currentText:string;targetDuration:number;
    contextBefore:string[];contextAfter:string[]}>
}
function buildRephraseMessages(input: RephraseInput): ModelMessage[]
```

Source lấy từ DubbingPlanCue.sourceText, currentText từ final translated cue.
Context giữ theo original source cue order. Unknown source không được ghi như
đã kiểm chứng. Prompt trả `[id:1] text` tối đa 3, parser rephrase giữ grammar riêng.

- [ ] **RED:** test prompt không chứa one-translation-per-ID contract và có nguồn:

```ts
test('rephrase is editing existing translation with source evidence', () => {
  const messages = buildRephraseMessages({targetLocale:'en',cues:[{
    id:'c1',sourceText:'不要摸这只狗。',currentText:'Do not touch this dog.',
    targetDuration:2,contextBefore:[],contextAfter:[]
  }]})
  assert.match(messages[0].content,/task=rephrase/u)
  assert.match(messages[1].content,/不要摸这只狗/u)
  assert.doesNotMatch(messages[0].content,/target_language=auto/u)
})
```

Thêm cases không rút ngắn an toàn→giữ currentText, không quá 3 candidates,
sign/negation preserved in prompt, no candidate→TTS không bỏ cue. Mocks kiểm
request body và parser; semantic fidelity thật dành T12.

- [ ] Register/chạy rephrase/prompts/TTS suites để RED.
- [ ] **GREEN:** dùng rephrase prompt review riêng, bỏ 14-grapheme hint. Dedup
candidates, giữ original translation immutable và finalSpokenText riêng:

```ts
const candidates = [...new Set(parsedCandidates.map(t=>t.trim()).filter(Boolean))].slice(0,3)
return candidates.length ? candidates : [currentText]
```

`parsedCandidates` từ extractRephrasedTexts hiện có. Candidate không khác current
không được tự tạo một lượt TTS/cache-miss vô ích. Dừng no-fit đúng policy, không
đổi hardEnd/tempo để vượt gate. Local single rephrase bổ sung deadline 90s như
batch path, signal timeout và parent abort hợp nhất; phase B đưa credit chung.

- [ ] Rerun rephrase/TTS/dubbing-plan/cache tests + typecheck; `git diff --check`.
- [ ] Commit `fix(dubbing): separate rephrase contract and preserve source context`.

## Gate A

- [ ] `npm.cmd run typecheck` và relevant translation/tts/UI suites pass.
- [ ] Tái hiện fixture incident offline: 101 đủ cue không false hard block; warning
  đến final state, không gọi live provider.
- [ ] Migration prompt change không xóa source artifact; source fallback và lossy
  parsing không còn. Cập nhật handoff/acceptance bằng evidence mới.
- [ ] Duyệt diff, chưa merge/push/restart app tự động. Chuyển B sau Gate A.
