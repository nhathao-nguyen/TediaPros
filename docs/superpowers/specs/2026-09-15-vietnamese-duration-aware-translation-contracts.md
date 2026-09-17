# Hợp đồng thực thi và test seed — VI-DUB-20260915

Ngày 2026-09-15. Tài liệu này bắt đầu là **DESIGN CODE**; cập nhật triển khai ngày 2026-09-15 đã thực hiện các seam core T01--T06 được liệt kê trong bản ghi [VI-DUB-20260915-CORE](../../../.ai/tasks/2026-09-15-vietnamese-duration-aware-translation-core/TASK.md). Các đoạn TypeScript dưới đây vẫn là contract/test seed cho phần roadmap chưa làm; chúng không thay thế integration/quality gates trong [nghiệm thu](../../benchmarks/2026-09-15-vietnamese-duration-aware-translation-evaluation.md).

Các module NEW được tạo ở bước triển khai, không trong lượt lập specs. Hàm/type mới bên dưới có tên thống nhất; implementation có thể thêm field nội bộ nhưng không đổi nghĩa contract mà không tăng version. Không dùng snippet test policy với dữ liệu đã gắn nhãn làm bằng chứng rằng bộ phát hiện ngôn ngữ tự động đã đúng.

## Cập nhật trạng thái thực thi

- Đã có core offline cho capacity Gateway floor 1M, output-aware planning/preflight, immutable full-source ledger, source speech plan/budget, profile văn phong Việt v1, negative controls cho quantified-object/action-order, evidence/decision helper (provider claim không tự thành verified), source-repair không compact target không đáng tin, và evaluator first-pass-fit/paired-bootstrap theo video.
- 1M hiện có provenance `user-confirmed`; bộ đếm hiện là ước lượng byte UTF-8 có nhãn, **không** được gọi là token counter exact/qualified.
- T06 mới có helper/negative controls, chưa wire persistence/recovery consumer; T07 có hardening source-repair cộng replay guard hẹp trong bộ nhớ theo job/item, còn semantic ranking/quality-repair và durable state vẫn mở. T09 chỉ có evaluator offline. Chưa đóng T00/T07--T13: không có corpus/human evaluation hoặc report, probe live gần 1M, calibration, media-context cache, package Windows hoặc phát hành. Không Gemini TTS/Live được thêm.

## 1. File ownership và consumer

| Task | Module sở hữu (NEW trừ khi ghi existing) | Consumes | Produces/consumer kế tiếp |
|---|---|---|---|
| T01 | `src/main/translation/capabilitySnapshot.ts` | config/user-confirmed capability + server metadata | `resolveGatewayCapacity` → requestBudget/Gateway |
| T02 | `src/main/translation/requestBudget.ts` | capacity, actual rendered prompt/counter, requested IDs | `checkRequestBudget`, `partitionOutputIds` → planner/Gateway |
| T03 | `src/shared/speechUnitPlan.ts`; `src/main/translation/speechUnitPlanner.ts` | source ledger, existing DP/reviewed proposals | `validateSourcePartition`, frozen SpeechUnitPlan → T04/TTS |
| T04 | `src/main/translation/speechBudget.ts` | frozen window, policy/revision | `makeSpeechBudget` → draft/review/rephrase |
| T05 | `src/main/translation/viStyleProfile.ts` | target locale/domain + human-approved examples | `selectViExamples` → existing prompt builders |
| T06 | `src/main/translation/semanticEvidence.ts`, `qualityDecision.ts` | source evidence + deterministic/reviewer findings | `decideQuality` → accepted/recovery gates |
| T07 | `src/main/dubbing/feedbackDecision.ts` | candidate verdicts, measured state, attempt journal | `nextFeedbackAction` → existing synthesis |
| T08 | `src/main/translation/acceptanceRevision.ts` | completion identity + current state | `mayCommitTranslation` → checkpoint/orchestrator |
| T09 | `scripts/evaluate-vietnamese-dubbing.mjs` | immutable run manifests, human ratings | offline metrics + report; không gọi provider |
| T10 | existing package/release scripts | qualified code/tests + operator request | artifact/hash/rollback evidence |
| T11 | existing durationPredictor/profileStore; NEW `src/main/dubbing/durationCalibration.ts` | held-out residuals + voice identity | `calibrationUpperResidual` → predictor advisory/qualified metadata |
| T12 | existing qualityDecision/feedbackDecision | measured-fit + opt-in + shared journal | `shouldAttemptQualityRepair` → same bounded recovery queue |
| T13 | NEW `src/main/translation/sourceContextCache.ts` | provider capability + entry identity + consent | `canReuseSourceContext`, `mayUploadSourceMedia` → optional context adapter |

Main owns IO/hash/clock/transport, shared owns pure types/validation only. Hàm tính token phải async tại adapter khi counter là RPC; không ép một RPC vào `countTokens?: (text)=>number` hiện có. Pure `checkRequestBudget` chỉ nhận số đã đo và không gọi mạng.

Mỗi test file có imports:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
```

Test suites NEW phải đăng ký ở `scripts/run-local-runtime-tests.mjs`. Chạy từng lệnh ghi dưới card trước và sau code: trước FAIL do chức năng thiếu/assertion sai; sau PASS. Giữ diff/test evidence; không thực thi snippets như sửa code ở giai đoạn planning.

## 2. T00/T09 — dữ liệu và metric không gọi provider

Create `scripts/evaluate-vietnamese-dubbing.mjs` ở T09, xuất hàm pure để test qua wrapper TypeScript hoặc test Node .mjs riêng. Input mỗi unit có status và số đo, không cần đọc secrets/API config. Việc load manifest dùng `fs.readFile` đúng paths được phép và validate schema theo EVAL.

```js
export function firstPassFit(units, threshold) {
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error('invalid-threshold');
  if (units.length === 0) return { fit: 0, total: 0, rate: null };
  const fit = units.filter(unit => unit.status === 'measured'
    && Number.isFinite(unit.naturalSeconds) && unit.naturalSeconds > 0
    && Number.isFinite(unit.windowSeconds) && unit.windowSeconds > 0
    && unit.naturalSeconds <= unit.windowSeconds * threshold).length;
  return { fit, total: units.length, rate: fit / units.length };
}
```

`tests/vietnamese-evaluation.test.mjs` imports từ script trên:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { firstPassFit } from '../scripts/evaluate-vietnamese-dubbing.mjs';
test('failed audio stays in denominator', () => {
  assert.deepEqual(firstPassFit([
    { status: 'measured', naturalSeconds: 4.4, windowSeconds: 4 },
    { status: 'failed', naturalSeconds: null, windowSeconds: 4 }
  ], 1.25), { fit: 1, total: 2, rate: 0.5 });
});
```

Run: `node --test tests/vietnamese-evaluation.test.mjs`. T00 thu gold/split/manifest và thống nhất rubric EVAL; T09 thêm paired bootstrap theo video, 10.000 resamples, fixed seed ghi report. Cả script aggregate lẫn unit tests không được gọi model/TTS hoặc tự thêm video chưa được đồng ý vào corpus.

## 3. T01 — Gateway capacity

Create `capabilitySnapshot.ts`, interface gọn; route/counter/byte-cap provenance nằm trong snapshot wrapper của spec, không bị hàm này giả mạo:

```ts
export interface GatewayCapacity {
  contextTokens: number
  outputTokens: number
  limitKind: 'combined' | 'input-only'
  provenance: 'user-confirmed' | 'gateway-contract'
}
export function resolveGatewayCapacity(server?: {
  contextTokens?: number
  outputTokens?: number
  limitKind?: GatewayCapacity['limitKind']
}): GatewayCapacity {
  const contextTokens = server?.contextTokens ?? 1_000_000
  const outputTokens = server?.outputTokens ?? 16_384
  if (!Number.isSafeInteger(contextTokens) || contextTokens < 1_000_000)
    throw new Error('gateway-context-contract-mismatch')
  if (!Number.isSafeInteger(outputTokens) || outputTokens <= 0)
    throw new Error('gateway-output-contract-invalid')
  if (server?.limitKind != null && !['combined', 'input-only'].includes(server.limitKind))
    throw new Error('gateway-limit-kind-invalid')
  return { contextTokens, outputTokens,
    limitKind: server?.limitKind ?? 'combined',
    provenance: server?.contextTokens == null ? 'user-confirmed' : 'gateway-contract' }
}
```

`tests/translation-capability-snapshot.test.ts`:

```ts
import { resolveGatewayCapacity } from '../src/main/translation/capabilitySnapshot'
test('1M is enabled even before metadata exposes the exact limit', () => {
  assert.equal(resolveGatewayCapacity().contextTokens, 1_000_000)
  assert.equal(resolveGatewayCapacity().outputTokens, 16_384)
  assert.equal(resolveGatewayCapacity().provenance, 'user-confirmed')
  assert.equal(resolveGatewayCapacity({ contextTokens: 1_048_576 }).contextTokens, 1_048_576)
  assert.throws(() => resolveGatewayCapacity({ contextTokens: 32_768 }), /mismatch/)
})
```

Run: `node scripts/run-local-runtime-tests.mjs translation-capability-snapshot.test gemini-gateway-contract.test`.

Nối vào `createGeminiGatewayAdapter().capability` và job snapshot; không đổi alias/policy fallback hiện tại. Vẫn phải kiểm tra route/byte limits ngoài hàm này. Không đánh đồng provenance của context với độ chính xác bộ đếm token.

## 4. T02 — actual payload, output partition

Create `requestBudget.ts`:

```ts
import type { GatewayCapacity } from './capabilitySnapshot'
export function checkRequestBudget(cap: GatewayCapacity, input: {
  inputTokens: number; outputReserve: number; safetyReserve: number
  requestBytes: number; requestByteLimit: number
}): 'fit' | 'invalid-count' | 'input-limit' | 'output-limit' | 'byte-limit' {
  const values = Object.values(input)
  if (values.some(n => !Number.isSafeInteger(n) || n < 0)) return 'invalid-count'
  if (input.outputReserve <= 0 || input.requestByteLimit <= 0) return 'invalid-count'
  if (input.outputReserve > cap.outputTokens) return 'output-limit'
  if (input.requestBytes > input.requestByteLimit) return 'byte-limit'
  const cost = input.inputTokens + input.safetyReserve
    + (cap.limitKind === 'combined' ? input.outputReserve : 0)
  return cost <= cap.contextTokens ? 'fit' : 'input-limit'
}
export function partitionOutputIds(groups: readonly {
  ids: readonly string[]; outputTokens: number
}[], limit: number, envelopeReserve: number): string[][] {
  if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(envelopeReserve)
      || limit <= envelopeReserve || envelopeReserve < 0) throw new Error('invalid-output-budget')
  const batches: string[][] = []
  const seen = new Set<string>()
  let pending: string[] = [], used = envelopeReserve
  for (const group of groups) {
    if (!group.ids.length || !Number.isSafeInteger(group.outputTokens) || group.outputTokens <= 0)
      throw new Error('invalid-output-group')
    for (const id of group.ids) {
      if (!id.trim() || seen.has(id)) throw new Error('duplicate-or-empty-id')
      seen.add(id)
    }
    if (group.outputTokens + envelopeReserve > limit) throw new Error('needs-internal-output-partition')
    if (pending.length && used + group.outputTokens > limit) {
      batches.push(pending); pending = []; used = envelopeReserve
    }
    pending.push(...group.ids); used += group.outputTokens
  }
  if (pending.length) batches.push(pending)
  return batches
}
```

Oversized group trả `needs-internal-output-partition` cho orchestrator chia **requested IDs/internal parts** bằng mapping hiện có; không sửa frozen speech plan. Một function không thể tự đoán alignment để chia. Full context được immutable-reference từ plan, không được lấy `batch.ids` làm toàn source.

`tests/translation-request-budget.test.ts`:

```ts
import { checkRequestBudget, partitionOutputIds } from '../src/main/translation/requestBudget'
import { resolveGatewayCapacity } from '../src/main/translation/capabilitySnapshot'
test('review counts draft and output has its own cap', () => {
  const cap = resolveGatewayCapacity()
  const base = { inputTokens: 983_616, outputReserve: 16_384, safetyReserve: 0,
    requestBytes: 100, requestByteLimit: 1_000_000 }
  assert.equal(checkRequestBudget(cap, base), 'fit')
  assert.equal(checkRequestBudget(cap, { ...base, inputTokens: 983_617 }), 'input-limit')
  assert.equal(checkRequestBudget({ ...cap, limitKind: 'input-only' },
    { ...base, inputTokens: 1_000_000 }), 'fit')
  assert.equal(checkRequestBudget(cap, { ...base, outputReserve: 30_000 }), 'output-limit')
  assert.deepEqual(partitionOutputIds([
    { ids: ['a'], outputTokens: 10_000 }, { ids: ['b'], outputTokens: 10_000 },
    { ids: ['c'], outputTokens: 10_000 }
  ], 16_384, 64), [['a'], ['b'], ['c']])
})
```

Run: `node scripts/run-local-runtime-tests.mjs translation-request-budget.test gemini-gateway-long-context.test`.

Integration `gemini-gateway-long-context.test.ts`: capture `requestBody.messages` của mock `/chat/completions` theo harness `gemini-gateway-contract.test.ts`; counter spy nhận **đúng messages/schema representation** trước cả hai dispatch, review lớn hơn draft vì candidate. Assert mọi output batch có full source digest, `requestedIds` disjoint union bằng expected IDs. Test helper số đếm trên không thay thế test capture này. Preflight actual-count async cần AbortSignal; cache prefix count không được thêm/bớt token schema chưa đếm.

## 5. T03 — source partition và freeze

Create validator ở `src/shared/speechUnitPlan.ts`, cạnh interfaces trong spec:

```ts
export function validateSourcePartition(sourceIds: readonly string[], groups: readonly (readonly string[])[],
  hardBoundaryAfter: readonly string[]): string[] {
  const errors: string[] = []
  const flat = groups.flat()
  if (new Set(sourceIds).size !== sourceIds.length) errors.push('duplicate-source-id')
  if (groups.some(group => group.length === 0)) errors.push('empty-group')
  if (flat.length !== sourceIds.length || flat.some((id, i) => id !== sourceIds[i]))
    errors.push('coverage-or-order')
  const hard = new Set(hardBoundaryAfter)
  if (groups.some(group => group.slice(0, -1).some(id => hard.has(id)))) errors.push('crossed-hard-boundary')
  return errors
}
```

`tests/speech-unit-plan.test.ts`:

```ts
import { validateSourcePartition } from '../src/shared/speechUnitPlan'
test('freeze rejects reorder, duplicate and hard-boundary crossing', () => {
  assert.deepEqual(validateSourcePartition(['a', 'b', 'c'], [['a', 'b'], ['c']], ['b']), [])
  assert.ok(validateSourcePartition(['a', 'b'], [['b', 'a']], []).includes('coverage-or-order'))
  assert.ok(validateSourcePartition(['a', 'b'], [['a', 'a']], []).includes('coverage-or-order'))
  assert.ok(validateSourcePartition(['a', 'b'], [['a', 'b']], ['a']).includes('crossed-hard-boundary'))
})
```

`speechUnitPlanner.ts` owns hàm mới sau; types `DubbingSourceCue`/`SpeechUnitPlan` nằm ở existing dubbing plan/spec shared mới:

```ts
export interface FreezeSpeechUnitInput {
  source: readonly DubbingSourceCue[]
  proposedMemberIds: readonly (readonly string[])[]
  videoDuration: number
  previousRevision: number
  sourceDigest: string
  temporalEditDigest: string | null
  hardBoundaryAfter: readonly string[]
}
export declare function freezeSpeechUnitPlan(input: FreezeSpeechUnitInput): SpeechUnitPlan
```

`hardBoundaryAfter` đến từ nguồn/cut planner đáng tin, không từ output model. Compiler: validate coverage → verify proposed edges against source pause/speaker/cut evidence → reuse DP chọn partition → call `deriveDubbingWindow` đúng một lần mỗi group → compute canonical digest → return revision+1 frozen. Digest không chứa createdAt/volatile predictor state. Việc nhận proposedMemberIds không cho phép bỏ source hard boundaries; compiler chịu trách nhiệm kiểm tra.

Run: `node scripts/run-local-runtime-tests.mjs speech-unit-plan.test dubbing-grouping.test translation-planner.test`. Tích hợp group 7 cue, noisy question và cue-70 trong suite existing; test pure coverage một mình chưa chứng minh grouping tự nhiên.

## 6. T04 — budget chỉ từ frozen window

Create `speechBudget.ts`:

```ts
export interface SpeechBudget {
  unitId: string; revision: number; availableSeconds: number
  targetNaturalSeconds: number; hardMaxNaturalSeconds: number
}
export function makeSpeechBudget(unitId: string, revision: number, window: {
  start: number; hardEnd: number
}, targetTempo: number, hardTempo: number): SpeechBudget {
  const availableSeconds = window.hardEnd - window.start
  if (!unitId || !Number.isSafeInteger(revision) || revision < 1
      || ![window.start, window.hardEnd, targetTempo, hardTempo].every(Number.isFinite)
      || availableSeconds <= 0 || targetTempo <= 0 || hardTempo < targetTempo || hardTempo > 1.8)
    throw new Error('invalid-speech-budget')
  return { unitId, revision, availableSeconds,
    targetNaturalSeconds: availableSeconds * targetTempo,
    hardMaxNaturalSeconds: availableSeconds * hardTempo }
}
```

Trong implementation thay literal `1.8` bằng constant policy hiện hữu qua Main import; helper này ở Main, không đưa import Main vào shared. Rounding chỉ ở wire display, không tích lũy round vào timeline.

`tests/speech-budget.test.ts`:

```ts
import { makeSpeechBudget } from '../src/main/translation/speechBudget'
import { deriveDubbingWindow } from '../src/main/dubbing/plan'
test('six fragments reserve their external gap once', () => {
  const window = deriveDubbingWindow({ id: 'g', start: 0, end: 6, text: 'Một câu.' }, 6, 8)
  const budget = makeSpeechBudget('g', 1, window, 1.1, 1.8)
  assert.equal(budget.availableSeconds, 5.5)
  assert.ok(Math.abs(budget.targetNaturalSeconds - 6.05) < 1e-9)
  assert.ok(Math.abs(budget.hardMaxNaturalSeconds - 9.9) < 1e-9)
})
```

Run: `node scripts/run-local-runtime-tests.mjs speech-budget.test translation-prompts.test dubbing-plan.test`.

Consumers phải adapter frozen `window.scheduledStart/deadline` vào `start/hardEnd`; không lấy timestamps cue con. Prompt request có unit-level budget, TTS dùng cùng revision. Subtitle mode không gọi budget helper để tạo speech pressure.

## 7. T05 — ví dụ văn phong có nguồn gốc

Create `viStyleProfile.ts`:

```ts
export interface ViStyleExample {
  id: string; domain: string; source: string; target: string
  approved: boolean; split: 'development' | 'held-out'
}
export function selectViExamples(examples: readonly ViStyleExample[], domain: string): ViStyleExample[] {
  return examples.filter(e => e.approved && e.split === 'development'
      && (e.domain === domain || e.domain === 'general'))
    .sort((a, b) => Number(b.domain === domain) - Number(a.domain === domain)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 3)
}
```

`tests/vietnamese-style-profile.test.ts`:

```ts
import { selectViExamples } from '../src/main/translation/viStyleProfile'
test('held-out examples never leak into prompts', () => {
  const base = { domain: 'kitchen', source: 'source', target: 'đích', approved: true }
  const selected = selectViExamples([
    { ...base, id: 'gold', split: 'held-out' },
    { ...base, id: 'dev', split: 'development' }
  ], 'kitchen')
  assert.deepEqual(selected.map(e => e.id), ['dev'])
})
```

Run: `node scripts/run-local-runtime-tests.mjs vietnamese-style-profile.test gemini-gateway-prompts.test translation-prompts.test`.

Prompt builders nối source → profile/glossary/examples data → unit budgets → requested IDs. Giữ rules source CTA/modality/number; audit before/after text. Profile version + selected example IDs tham gia request digest. Dùng rubric đã ghi ở spec, không đưa fixture từ này vào production example corpus.

## 8. T06 — mức bằng chứng quyết định hành vi

Create `qualityDecision.ts`; `semanticEvidence.ts` chuẩn hóa findings vào type dưới, không tự nâng confidence do cùng model đồng ý với chính nó:

```ts
export interface QualityFinding {
  kind: 'structural' | 'semantic' | 'style'
  evidence: 'verified' | 'suspect' | 'advisory'
  code: string
  sourceCueIds: string[]
  sourceSpans: string[]
}
export function decideQuality(findings: readonly QualityFinding[]): 'reject' | 'review' | 'eligible' {
  if (findings.some(f => f.kind === 'structural'
    || (f.kind === 'semantic' && f.evidence === 'verified'))) return 'reject'
  if (findings.some(f => f.kind === 'semantic' && f.evidence === 'suspect')) return 'review'
  return 'eligible'
}
```

`tests/translation-semantic-evidence.test.ts`:

```ts
import { decideQuality } from '../src/main/translation/qualityDecision'
test('shorter or more fluent cannot compensate a verified changed object', () => {
  assert.equal(decideQuality([{ kind: 'semantic', evidence: 'verified', code: 'changed-object',
    sourceCueIds: ['a'], sourceSpans: ['muối'] }]), 'reject')
  assert.equal(decideQuality([{ kind: 'semantic', evidence: 'suspect', code: 'uncertain-source',
    sourceCueIds: ['a'], sourceSpans: ['1.250'] }]), 'review')
  assert.equal(decideQuality([{ kind: 'style', evidence: 'suspect', code: 'word-hint',
    sourceCueIds: ['a'], sourceSpans: [] }]), 'eligible')
  assert.equal(decideQuality([{ kind: 'semantic', evidence: 'advisory', code: 'unqualified-heuristic',
    sourceCueIds: ['a'], sourceSpans: [] }]), 'eligible')
})
```

Run: `node scripts/run-local-runtime-tests.mjs translation-semantic-evidence.test autoshort-content-quality.test translation-rephrase.test`.

Hai tests detection bắt buộc thêm trong existing `autoshort-content-quality.test.ts`: gọi verifier thực bằng source/candidate nguyên văn “muối/đường” và đảo “rút phích cắm/vệ sinh”, không truyền sẵn verdict như test decision trên. `verified` chỉ đến từ qualified deterministic mapping hoặc evidence đã được kiểm tra theo policy; raw LLM finding mặc định suspect. Suspect được kiểm tra/sửa trong review hiện hữu; unresolved candidate mới không thay candidate đầy đủ đã accepted. Không dùng `eligible` để UI in “đã chứng minh đủ ý”.

## 9. T07 — feedback hữu hạn, giữ bản tốt

Create `dubbing/feedbackDecision.ts`:

```ts
export interface FeedbackCandidate {
  hash: string; text: string; quality: 'reject' | 'review' | 'eligible'
}
export type FeedbackAction = { type: 'stop'; reason: string }
  | { type: 'synthesize'; candidate: FeedbackCandidate }
export function nextFeedbackAction(candidates: readonly FeedbackCandidate[], tried: ReadonlySet<string>,
  cancelled: boolean): FeedbackAction {
  if (cancelled) return { type: 'stop', reason: 'cancelled' }
  const next = candidates.find(c => c.quality === 'eligible' && c.text.trim() && !tried.has(c.hash))
  return next ? { type: 'synthesize', candidate: next } : { type: 'stop', reason: 'no-progress' }
}
```

`tests/dubbing-feedback-decision.test.ts`:

```ts
import { nextFeedbackAction } from '../src/main/dubbing/feedbackDecision'
test('tried candidate is not replayed under a renamed recovery stage', () => {
  const candidate = { hash: 'same-text-voice', text: 'Giữ đủ ý.', quality: 'eligible' as const }
  assert.deepEqual(nextFeedbackAction([candidate], new Set([candidate.hash]), false),
    { type: 'stop', reason: 'no-progress' })
  assert.deepEqual(nextFeedbackAction([candidate], new Set(), true),
    { type: 'stop', reason: 'cancelled' })
})
```

Run: `node scripts/run-local-runtime-tests.mjs dubbing-feedback-decision.test autoshort-tts-pipeline.test translation-rephrase.test`.

Synthesis owns persistent `tried` set keyed source group/recovery chain + candidate text/voice/options; không tạo set mới ở mọi call. Mark attempt trước dispatch, lưu completed/failed outcome riêng. Uncertain provider completion không tự khởi động attempt chồng. `stop` không xóa accepted audio; overflow vẫn đi finite retime/split/error theo policy, measured-fit fallback vẫn giữ được. Tối đa ba candidate ở producer, helper không tự sinh thêm.

**Cập nhật triển khai 2026-09-15:** `createDubbingFeedbackJournal()` hiện được tạo một lần trong `AutoShortJob`, dùng `item.id` làm ranh giới map và chỉ lưu SHA-256 opaque hash cùng outcome `dispatching|completed|failed`. `hashFeedbackCandidate()` canonicalize source cue IDs, text, model, voice và TTS options, không bao gồm `recoveryAttempt`; do đó retry trong cùng job không phát lại candidate đã claim. Journal không được đưa vào checkpoint, IPC hay log và không sống qua job/process restart. Đây là slice replay guard, không phải semantic-quality verdict hay durable resume implementation.

## 10. T08 — stale response không commit

Create `acceptanceRevision.ts`:

```ts
export interface AcceptanceIdentity { jobId: string; planDigest: string; requestDigest: string; revision: number }
export function mayCommitTranslation(current: AcceptanceIdentity & { cancelled: boolean },
  incoming: AcceptanceIdentity & { complete: boolean; protocolValid: boolean; semanticDecision: 'reject' | 'review' | 'eligible' }): boolean {
  return !current.cancelled && incoming.complete && incoming.protocolValid
    && incoming.semanticDecision === 'eligible'
    && current.jobId === incoming.jobId && current.revision === incoming.revision
    && current.planDigest === incoming.planDigest && current.requestDigest === incoming.requestDigest
}
```

`tests/translation-policy-migration.test.ts`:

```ts
import { mayCommitTranslation } from '../src/main/translation/acceptanceRevision'
test('complete old response cannot replace a new accepted plan', () => {
  const identity = { jobId: 'job', planDigest: 'p2', requestDigest: 'req', revision: 2 }
  const current = { ...identity, cancelled: false }
  const incoming = { ...identity, complete: true, protocolValid: true, semanticDecision: 'eligible' as const }
  assert.equal(mayCommitTranslation(current, incoming), true)
  assert.equal(mayCommitTranslation(current, { ...incoming, planDigest: 'p1', revision: 1 }), false)
  assert.equal(mayCommitTranslation({ ...current, cancelled: true }, incoming), false)
})
```

Run: `node scripts/run-local-runtime-tests.mjs translation-policy-migration.test gemini-gateway-draft-resume.test autoshort-tts-cache.test`.

Persist commit sau gate bằng atomic checkpoint writer hiện hữu; phải kiểm tra ownership lại ngay trước rename/commit trong critical section, không chỉ trước await. Legacy checkpoint không có new identity không được tự đắp revision=2; đọc legacy namespace và revalidate theo config. `with-warnings` legacy không tự thành semantic failure ở toàn hệ thống; gate mới chỉ áp candidate thuộc policy mới.

## 11. T10 — release là gate vận hành

Không tạo test đỏ bằng cố ý làm hỏng bản cài. Sau G5 và yêu cầu release:

```powershell
git status --short
git worktree list --porcelain
npm.cmd run typecheck
npm.cmd run test:local-runtime
npm.cmd run package:win
npm.cmd run release:verify-assets
```

Đối chiếu `resources/app.asar` package và installed bằng `Get-FileHash -Algorithm SHA256` trên exact paths đã inventory, lưu rollback trước khi cài. Artifact tên/version đọc từ build output, không dựng sẵn một filename chưa tồn tại. `package:win` hiện có `-p never`; không đổi thành publish. Window/process/installed hash phải có bằng chứng sau startup, không kết luận từ source branch. Người dùng không yêu cầu cài thì dừng ở handoff build-ready, không tự chạy installer.

## 12. T11 — cận residual độc lập không phải confidence từ train

Create `durationCalibration.ts`. Hàm nhận **held-out calibration residuals** `measured - predicted`; không nhận residual của tập fit để qualify:

```ts
export function calibrationUpperResidual(residuals: readonly number[], alpha: number): number | null {
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) throw new Error('invalid-alpha')
  if (residuals.some(r => !Number.isFinite(r))) throw new Error('invalid-residual')
  const rank = Math.ceil((residuals.length + 1) * (1 - alpha))
  if (residuals.length === 0 || rank > residuals.length) return null
  const sorted = [...residuals].sort((a, b) => a - b)
  return Math.max(0, sorted[rank - 1])
}
```

`tests/dubbing-duration-calibration.test.ts`:

```ts
import { calibrationUpperResidual } from '../src/main/dubbing/durationCalibration'
test('insufficient calibration cannot invent an upper bound', () => {
  assert.equal(calibrationUpperResidual([], 0.1), null)
  assert.equal(calibrationUpperResidual([0.2], 0.1), null)
  assert.equal(calibrationUpperResidual(Array.from({ length: 10 }, (_, i) => i / 10), 0.1), 0.9)
})
```

Run: `node scripts/run-local-runtime-tests.mjs dubbing-duration-calibration.test dubbing-duration-profile.test`.

Hàm này chỉ tính quantile; bên ngoài phải enforce split/voice identity/sample-size/held-out performance G-PREDICTOR. Có quantile không tự cho phép `calibration=qualified`. Predictor hiện hữu vẫn ridge baseline, giữ feature v2; v3 thêm pronunciation uncertainty có migration. Dupper cho ranking, không thay measured gate hoặc hứa coverage cho từng câu.

## 13. T12 — quality repair opt-in không tạo vòng thứ hai vô hạn

Thêm vào `feedbackDecision.ts`:

```ts
export function shouldAttemptQualityRepair(input: {
  enabled: boolean; measuredFit: boolean; requiredTempo: number
  verifiedVerboseFinding: boolean; alreadyAttemptedInChain: boolean
}): boolean {
  return input.enabled && input.measuredFit && Number.isFinite(input.requiredTempo)
    && input.requiredTempo > 1.25 && input.requiredTempo <= 1.8
    && input.verifiedVerboseFinding && !input.alreadyAttemptedInChain
}
```

`tests/dubbing-feedback-decision.test.ts` thêm import helper và case:

```ts
import { shouldAttemptQualityRepair } from '../src/main/dubbing/feedbackDecision'
test('word hint alone and repeated quality repair do not dispatch', () => {
  const base = { enabled: true, measuredFit: true, requiredTempo: 1.5,
    verifiedVerboseFinding: true, alreadyAttemptedInChain: false }
  assert.equal(shouldAttemptQualityRepair(base), true)
  assert.equal(shouldAttemptQualityRepair({ ...base, verifiedVerboseFinding: false }), false)
  assert.equal(shouldAttemptQualityRepair({ ...base, alreadyAttemptedInChain: true }), false)
})
```

Run: `node scripts/run-local-runtime-tests.mjs dubbing-feedback-decision.test translation-rephrase.test`.

Đây là quality mode opt-in riêng, không đổi preferred fixed pace của user. Producer sắp candidate theo semantic/naturalness trước duration; khi quality ngang nhau mới dùng qualified predictor/interval. Ghi Pareto elimination reason; giữ bản đủ ý đã measured-fit. Triển khai dùng constants policy thay literals để không drift.

## 14. T13 — cache và media consent

Create `sourceContextCache.ts`:

```ts
export interface SourceContextIdentity { accountProfile: string; route: string; sourceDigest: string; version: string }
export function canReuseSourceContext(entry: SourceContextIdentity & { expiresAtMs: number },
  request: SourceContextIdentity, nowMs: number, capabilitySupported: boolean): boolean {
  return capabilitySupported && Number.isFinite(nowMs) && Number.isFinite(entry.expiresAtMs)
    && nowMs < entry.expiresAtMs && entry.accountProfile === request.accountProfile
    && entry.route === request.route && entry.sourceDigest === request.sourceDigest
    && entry.version === request.version
}
export function mayUploadSourceMedia(input: {
  userOptIn: boolean; capabilitySupported: boolean; sourceAuthorized: boolean
}): boolean { return input.userOptIn && input.capabilitySupported && input.sourceAuthorized }
```

`tests/source-context-cache.test.ts`:

```ts
import { canReuseSourceContext, mayUploadSourceMedia } from '../src/main/translation/sourceContextCache'
test('expired or cross-account cache is a miss; text-only does not upload video', () => {
  const identity = { accountProfile: 'a', route: 'r', sourceDigest: 's', version: 'v1' }
  const entry = { ...identity, expiresAtMs: 1000 }
  assert.equal(canReuseSourceContext(entry, identity, 999, true), true)
  assert.equal(canReuseSourceContext(entry, identity, 1000, true), false)
  assert.equal(canReuseSourceContext(entry, { ...identity, accountProfile: 'b' }, 999, true), false)
  assert.equal(mayUploadSourceMedia({ userOptIn: false, capabilitySupported: true, sourceAuthorized: true }), false)
})
```

Run: `node scripts/run-local-runtime-tests.mjs source-context-cache.test gemini-gateway-contract.test`.

Transport adapter vẫn phải kiểm tra Files/media byte limits, retention/delete lifecycle và actual upload response; helper boolean không chứng minh upload đã thành công. Không gửi video chỉ vì source text chứa local path. Cache optional; context 1M ở T01/T02 vẫn chạy khi cache không hỗ trợ. Không có Gemini audio generation trong cả happy/fallback paths.

## 15. Coverage và điều kiện bàn giao mỗi card

T01–T04 là các interface cần freeze trước tích hợp prompt; T05–T08 không được dùng tên/field khác mà không cập nhật cả consumers và tests. Data/quality functions chỉ trả bằng chứng/decision; Main orchestrator mới quyết định transition và IO.

Mỗi card có một test nhỏ và một gate integration. Để hoàn thành task không chỉ cho helper test pass: chạy toàn matrix IDs được gán task, verify source mapping và request trace; human/live gates được ghi pending cho đến khi thực sự chạy. Typecheck/docs/test success không được viết thành tuyên bố “giọng đã tự nhiên như YouTube”.
