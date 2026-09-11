# AutoShort Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa F1–F6 trong review, bảo toàn source ledger/nội dung/audio đo thật và chốt acceptance bằng bằng chứng tương ứng.

**Architecture:** Giữ ba pha inference; phân biệt lịch measured tạm với lịch DSP đã chốt, hoãn split phụ thuộc predecessor và để adapter sở hữu toàn pha LLM. Tách helper QA theo trách nhiệm, version prompt mới và validation publication thuần thay cho mutation metadata.

**Tech Stack:** Electron/Node, TypeScript, Node test runner, esbuild test bundling, FFmpeg adapters hiện có; không thêm runtime dependency.

**Spec:** [AutoShort Review Fixes Design](/F:/Son/tool/TediaPros/docs/superpowers/specs/2026-09-08-autoshort-review-fixes-design.md).

Trạng thái: **Đã implement các fix F1–F6 và pass gate local ngày 2026-09-08; Gate B với provider/video lỗi gốc còn pending**. Baseline `863f55c38822e28046b0f0592c206ca9303aeeb5`. Chi tiết lệnh và giới hạn bằng chứng nằm tại [.ai task handoff](/F:/Son/tool/TediaPros/.ai/tasks/2026-09-08-autoshort-review-fixes-implementation.md).

Phần checklist bên dưới được giữ như nhật ký kế hoạch chi tiết. Trạng thái hoàn tất được xác định bằng handoff và test thực tế; các mục mở rộng late-split/worklist chưa cần để đóng regression F1 hiện tại vẫn là follow-up, không được suy thành behavior đã có.

## Global Constraints

- Tempo trần `1.45x`, preferred `1.10x`, normal `1.25x`; protected gap `0.50s`; early lead tối đa `0.35s` chỉ khi không mix thoại nguồn.
- TTS `speed: 1`; trim `-50 dB`, onset `0.03s`, offset `0.10s`.
- Không drop cue, cắt tiếng, đổi source IDs/order/start/end hoặc tăng retry/deadline để che lỗi.
- Một pha LLM; initial measured-overflow request tối đa 8 cue; repair missing tối đa một pass trong cùng `90_000 ms`; tối đa 3 candidate TTS/unit; structural replacement tối đa 8/invocation.
- Không đổi IPC/SRT/assessment schema, LICENSE/NOTICE, blur hay engine ngoài phạm vi; không thêm dependency.
- Giữ nguyên PCM đo thực và scope cleanup; cancellation phải settle/drain trước release.
- Bất kỳ regression probe lịch sử nào trong thư mục review đều giữ nguyên; viết test mới cho hành vi đúng, không sửa evidence cũ thành pass giả.
- Mọi lệnh chạy từ Git root của checkout thực thi. Dùng `npm.cmd` trên Windows. Giữ files dirty/untracked có trước; không stage `git add .`.

## Thứ tự và phạm vi file

| Task | Finding | Production files | Test chính |
|---|---|---|---|
| 1 | F1 | `src/main/dubbing/synthesis.ts` | `tests/dubbing-plan.test.ts`, `tests/dubbing-grouping.test.ts` |
| 2 | F2 | `src/main/autoshort.ts`, `src/main/dubbing/synthesis.ts` | `tests/translation-rephrase.test.ts`, `tests/dubbing-plan.test.ts` |
| 3 | F6 | `src/main/autoShortPolicy.ts`, `src/main/autoShortItemCoordinator.ts` | mới `tests/autoshort-publication-timeline.test.ts`, `tests/autoshort-ocr-pipeline.test.ts` |
| 4 | F3 | `src/main/autoShortContentQuality.ts`, mới `src/main/contentQuality/negation.ts` | `tests/autoshort-content-quality.test.ts` |
| 5 | F4 | `src/main/autoShortContentQuality.ts`, mới `src/main/contentQuality/numerals.ts` | mới `tests/content-quality-numerals.test.ts`, QA suite |
| 6 | F5 | `src/main/translation/prompts.ts`, `src/main/translation/checkpoint.ts` | prompt/identity/resume suites, coordinator fixture |
| 7 | Planning/claims | Spec, ADR, plans cũ, walkthrough và handoff | Kiểm tra tài liệu với code/metrics |
| 8 | Acceptance | Không kỳ vọng sửa source | Full suite, typecheck/build, media gate riêng |

Task 1 → Task 2 dùng chung synthesis, làm tuần tự. Task 4 → Task 5 dùng chung QA, làm tuần tự. Task 3 độc lập với QA; Task 6 đi sau thay đổi QA để xác nhận revalidation. Task 7–8 chỉ chốt evidence sau các fix. Mỗi task có thể là một commit riêng sau red/green và review; không commit tự động trong bước lập planning này.

## Chuẩn bị thực thi

- [ ] Đọc root AGENTS, `src/main/AGENTS.md`, `src/main/dubbing/AGENTS.md`, ADR 005 và spec mới. Nếu thay shared types thì đọc thêm `src/shared/AGENTS.md`; plan này không yêu cầu thay chúng.
- [ ] Kiểm tra branch/dirty state, chọn checkout cô lập bằng workflow worktree hiện có tại thời điểm bắt đầu implementation. Baseline phải là code vừa review hoặc phải cập nhật đối chiếu khi HEAD đã đổi.

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

- [ ] Đọc ba scripts trong `docs/reviews/2026-09-08-multilingual-dubbing-review/evidence/`: `reproduce-premature-structural-split.mjs`, `reproduce-rephrase-lease.mjs`, `reproduce-review.cjs`. Chúng assert lỗi baseline đang tồn tại; sau fix có thể fail theo thiết kế. Test acceptance mới không phụ thuộc `git show` hoặc commit cũ.

## Task 1 — Hoãn split phụ thuộc predecessor, chốt lịch rescue theo thứ tự

**Files:** sửa `src/main/dubbing/synthesis.ts`, test `tests/dubbing-plan.test.ts`, `tests/dubbing-grouping.test.ts`. Chỉ sửa `plan.ts`/`translation.ts` nếu cần dùng chung helper hiện có, không đổi policy gap.

**Interfaces:** giữ public `DubbingSynthesisInput/Result`. Nội bộ `MeasuredCueState` thêm trạng thái và kết quả chốt:

```ts
type MeasuredDecision = 'fit' | 'overflow' | 'deferred'
interface SettledCueAudio {
  path: string
  start: number
  duration: number
  targetDuration: number
  tempo: number
  voiceEnd: number
}
// Fields thêm vào MeasuredCueState:
// decision: MeasuredDecision
// settled?: SettledCueAudio
```

- [ ] **Red: thêm regression độc lập với commit cũ.** Đoạn sau dùng aliases import đã có ở đầu `tests/dubbing-plan.test.ts`:

```ts
test('predecessor rescue preserves a grouped cue that fits with released lead', async () => {
  const original = planModule.buildDubbingPlan({
    videoDuration: 3.5, paceMode: 'fixed', cues: [
      { id: 'a', start: 0, end: 1.4, text: 'Opening sentence.' },
      { id: 'b1', start: 2, end: 2.3, text: 'source fragment one' },
      { id: 'b2', start: 2.4, end: 2.8, text: 'source fragment two' }
    ]
  })
  const plan = planModule.groupDubbingPlanForSpeech(
    translationModule.applyDubbingTranslations(original, [
      { id: 'a', text: 'Opening sentence.' },
      { id: 'b1', text: 'First translated part.' },
      { id: 'b2', text: 'Second translated part.' }
    ]), 'en')
  const splits: string[] = []
  const spoken: string[] = []
  const result = await synthesisModule.synthesizeDubbingPlan({
    plan, language: 'en', model: 'fixture', fixedTempo: 1,
    localTempoDelta: 0.15, maxEarlyStartSeconds: 0.35,
    predictor: {
      profile: { version: 2, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 },
      estimate: () => ({ seconds: 1, uncertaintySeconds: 0, confidence: 1 }),
      addSample: () => {}
    },
    tts: { synthesize: async request => {
      spoken.push(request.text)
      return { path: request.text }
    } },
    audio: {
      trim: async path => ({ path, duration:
        path === 'Opening sentence.' ? 3 : path === 'Short opener.' ? 0.5 :
        path.includes('First translated part. Second translated part.') ? 1.8 : 0.7 }),
      applyTempo: async (path, _hint, duration) => ({ path, duration })
    },
    rephraseBatch: async requests => new Map(requests.map(request => [
      request.cueId, request.cueId === 'a' ? ['Short opener.'] : []
    ])),
    onStructuralSplit: event => splits.push(event.cueId)
  })
  assert.equal(planModule.validateDubbingPlan(result.plan).ok, true)
  assert.deepEqual(result.plan.cues.flatMap(cue => cue.sourceCueIds), ['a', 'b1', 'b2'])
  assert.deepEqual(splits, [])
  const group = result.plan.cues.find(cue => cue.sourceCueIds.includes('b2'))!
  assert.deepEqual(group.sourceCueIds, ['b1', 'b2'])
  assert.ok(Math.abs(group.start - 1.7586206896551724) < 0.0001)
  assert.ok(Math.abs(group.voiceEnd! - 3) < 0.0001)
  assert.ok(group.tempo <= 1.45)
  assert.equal(spoken.filter(text => text === group.finalSpokenText).length, 1)
})
```

- [ ] Chạy red; baseline phải fail với `Cue b1 có audio không hợp lệ.`, không phải lỗi import/type.

```powershell
node scripts/run-local-runtime-tests.mjs dubbing-plan.test dubbing-grouping.test
```

- [ ] **Green: sửa phân loại ở measure.** Trước split, dùng `measuredSpeechSlot` hiện có với predecessor tạm và một slot optimistic chỉ để xét dependency; `previousVoiceEnd=null` chỉ được dùng cho optimistic calculation, tuyệt đối không đưa lịch đó vào output. `buildStructuralSplitPlan` chỉ trả plan khi tất cả child có duration dương từ `dubbingSpeakingDurations(splitPlan.cues, videoDuration)`. Dùng cùng dữ liệu source-anchored như đường synthesis hiện tại.

```ts
function classifyMeasuredCue(
  naturalDuration: number,
  provisionalAvailable: number,
  optimisticAvailable: number,
  unresolvedPredecessor: boolean,
  tolerance: number
): MeasuredDecision {
  if (naturalDuration <= provisionalAvailable * 1.45 + tolerance) return 'fit'
  if (unresolvedPredecessor && naturalDuration <= optimisticAvailable * 1.45 + tolerance) {
    return 'deferred'
  }
  return 'overflow'
}
```

Truyền `maximumAvailableDuration` của hai slot vào helper. Chỉ trạng thái `overflow` mới xét split sớm; `deferred` giữ group và vào queue dự phòng. Dependency chưa chốt phải được truyền qua các unit tiếp theo chịu ảnh hưởng, không xóa cờ chỉ vì một unit trung gian fit ở lịch tạm.

- [ ] **Green: thay rescue loop chỉ duyệt overflow bằng pass chốt mọi unit.** Tính lại slot từ predecessor đã chốt, thử original trước; chỉ synthesize candidate nếu original vẫn không vừa. `fitPreparedCue` trả audio/DSP thật; lưu vào `state.settled`, dùng `settled.voiceEnd` cho cue sau. Reuse provisional audio khi text/slot/deadline còn đúng, không DSP hai lần chỉ vì chia phase. Finalize đọc `settled`, không lên lịch lại.
- [ ] **Green: xử lý deferred fallback hữu hạn.** Nếu vẫn overflow sau candidates, split an toàn trong rescue bằng child source boundaries và measure các child mới; không quay lại recursive `synthesizeDubbingPlan` sau khi batch bắt đầu. Chuyển child vào worklist theo thứ tự, giữ kết quả predecessor, không mở thêm LLM round. Counter structural replacement được chia sẻ giữa measure và rescue, tối đa 8; khi hết thì diagnostic policy.
- [ ] Bổ sung regression cho `prefetchTts=true/false`; `maxEarlyStartSeconds=0` không được mượn lead; predecessor rescue không đủ chỗ thì giữ hard ceiling; split child window bằng 0 phải bị từ chối trước TTS child; split hợp lệ vẫn hoạt động; cancellation khi rescue không có work sống sau settle. Với late split, kiểm tra không có trace `batch-rephrase` sau rescue TTS đầu tiên, số IDs không thiếu/lặp và không synthesize lại predecessor.
- [ ] Chạy xanh hai suite trên và `autoshort-tts-pipeline.test`. Kiểm tra metrics: original được cứu nhờ lịch mới không tăng `rescueAcceptedCount/rephraseCount`; candidate được chọn mới tăng các counter này. Lưu red/green logs, review diff, commit khu trú nếu đang thực thi theo Git workflow.

**Đầu ra task:** F1 fixture pass, các grouped/single overflow cũ giữ policy và ba-phase ordering; chưa đổi ownership/chunking adapter.

## Task 2 — Một adapter call, một lease cho toàn phase LLM

**Files:** sửa `src/main/autoshort.ts`, `src/main/dubbing/synthesis.ts`; test `tests/translation-rephrase.test.ts`, `tests/dubbing-plan.test.ts`, `tests/autoshort-resource-manager.test.ts`.

**Interfaces:** giữ `rephraseDubbingCues(config, requests, targetLanguage, sourceLanguage?, signal?)` và map return; giữ `DubbingRephraseAdapter` signature. Ý nghĩa mới: callback nhận toàn queue, adapter chịu giới hạn request.

- [ ] **Red: chuyển delayed-body probe thành test.** Import `AutoShortResourceManager`, `getGlobalResourceManager`, `setGlobalResourceManager` từ `src/main/autoShortResourceManager.ts` và `rephraseDubbingCues` từ `autoshort.ts`. Tạo test với body gate, restore global fetch/manager trong finally:

```ts
test('batch lease remains held while response JSON is incomplete', async () => {
  const previousFetch = globalThis.fetch
  const previousManager = getGlobalResourceManager()
  const manager = new AutoShortResourceManager()
  setGlobalResourceManager(manager)
  let beginBody!: () => void
  let releaseBody!: () => void
  const bodyStarted = new Promise<void>(resolve => { beginBody = resolve })
  const trace: string[] = []
  globalThis.fetch = async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      releaseBody = () => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ choices: [
          { message: { content: '[c1:1] Short line.' }, finish_reason: 'stop' }
        ] })))
        controller.close()
      }
    } })
    const response = new Response(stream, { status: 200 })
    const json = response.json.bind(response)
    response.json = async () => {
      trace.push('body-start'); beginBody()
      const data = await json()
      trace.push('body-complete')
      return data
    }
    return response
  }
  let work: Promise<unknown> | undefined
  let competitor: Promise<unknown> | undefined
  try {
    const config = {
      translateProvider: 'local', translateServerUrl: 'http://fixture.invalid'
    } as Parameters<typeof rephraseDubbingCues>[0]
    work = rephraseDubbingCues(config, [{ cueId: 'c1', currentText: 'A long sentence.',
      targetDuration: 1, measuredDuration: 3, maxDuration: 1.45 }], 'en')
    await bodyStarted
    competitor = manager.withLease(['server-inference'], undefined, async () => { trace.push('tts') })
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.deepEqual(trace, ['body-start'])
    releaseBody()
    await Promise.all([work, competitor])
    assert.deepEqual(trace, ['body-start', 'body-complete', 'tts'])
  } finally {
    if (trace.includes('body-start') && !trace.includes('body-complete')) releaseBody()
    await Promise.allSettled([work, competitor].filter(Boolean))
    globalThis.fetch = previousFetch
    setGlobalResourceManager(previousManager)
  }
})
```

- [ ] Thêm case 10 overflow: synthesis callback nhận `[10]` một lần; HTTP adapter nhận `[8,2]`. Khi cue thứ 9 missing, repair chỉ ID missing, không gửi lại các ID usable. Consumer TTS chờ không vào giữa initial/repair; body lỗi/cancel phải settle và release đúng một lần.
- [ ] Chạy red:

```powershell
node scripts/run-local-runtime-tests.mjs translation-rephrase.test dubbing-plan.test autoshort-resource-manager.test
```

- [ ] **Green: sửa synthesis thành một callback.** Đặt `batchCount=Math.ceil(overflowRequests.length/8)` nếu callback thực sự chạy; queue rỗng giữ 0. Preserve deprecated `rephrase` path nhưng không dùng trong active AutoShort.

```ts
const result = await input.rephraseBatch(overflowRequests, signal)
for (const request of overflowRequests) {
  const candidates = result.get(request.cueId)
  if (candidates?.length) candidatesByCue.set(request.cueId, [...candidates])
}
```

- [ ] **Green: chuyển lease ra ngoài Local initial/repair loops.** `requestBatch` dùng direct fetch bên trong outer lease; chờ đọc JSON hoặc cancel body trong nhánh HTTP lỗi trước khi throw. Dùng một `AbortSignal.timeout(90_000)` kết hợp caller signal cho cả wait/requests/repair. Nhánh provider non-Local giữ đường single adapter như hiện tại.

```ts
await getGlobalResourceManager().withLease(['server-inference'], requestSignal, async () => {
  for (let offset = 0; offset < requests.length; offset += initialBatchLimit) {
    requestSignal.throwIfAborted()
    await requestBatch(requests.slice(offset, offset + initialBatchLimit), false)
  }
  const missing = requests.filter(request => !result.has(request.cueId))
  for (let offset = 0; offset < missing.length; offset += 8) {
    requestSignal.throwIfAborted()
    await requestBatch(missing.slice(offset, offset + 8), true)
  }
})
```

- [ ] Trong catch, caller abort phải throw/propagate; provider error còn partial Map thì giữ Map, không reset deadline. Drain pending prefetch trước khi gọi batch; không giữ LLM lease trong khi chờ TTS cần cùng resource. Thêm test deadlock bằng promise gates và test queued-cancel không khởi chạy fetch, không thêm sleeps theo thời gian thực.
- [ ] Cập nhật kỳ vọng `['batch:8','batch:2']` ở synthesis test thành `['batch:10']`; giữ HTTP chunk assertion ở adapter test. Kiểm tra `batchCount=2`, `batchCueCount=10`, zero-overflow counters bằng 0; log phase wait mang nghĩa elapsed adapter.
- [ ] Chạy xanh các suite trên và `autoshort-tts-pipeline.test`, `autoshort-resource-lifecycle.test`; lưu log và diff. Không thay class resource manager để né bug nằm ở scope callback.

**Đầu ra task:** không release lease trước body hoặc giữa batch/repair; không lấy nested Local lease; một pha adapter, không có TTS xen trong lease phase.

## Task 3 — Bỏ metadata clamp, kiểm tra publication mà không mutation

**Files:** sửa `src/main/autoShortPolicy.ts`, `src/main/autoShortItemCoordinator.ts`, `scripts/run-local-runtime-tests.mjs`; thêm `tests/autoshort-publication-timeline.test.ts`; bổ sung coordinator fixture trong `tests/autoshort-ocr-pipeline.test.ts`.

**Interfaces:** thêm export `validateAutoShortPublicationTimeline(units: readonly AutoShortDubbingUnit[], videoDuration: number): TimelineSyncValidationResult`. Giữ validator legacy hiện có. Trong `AutoShortItemCoordinatorDeps`, thêm `synthesizeVoice?: typeof synthesizeVoice`, `stitchAudioTimeline?: typeof stitchAudioTimeline`; production chọn `deps.synthesizeVoice || synthesizeVoice` và `deps.stitchAudioTimeline || stitchAudioTimeline`.

- [ ] **Red: test validator thuần và EOF.** Fixture phải có audio đo thực và source ledger; không assert duration đã bị viết lại:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAutoShortPublicationTimeline, type AutoShortDubbingUnit } from '../src/main/autoShortPolicy'

function unit(end: number): AutoShortDubbingUnit {
  const duration = end - 9
  return {
    id: 'tail', timingPolicy: 'source-anchored-v2', sourceCueIds: ['tail'],
    sourceStart: 9, sourceEnd: 10, sourceText: 'Hello', translatedText: 'Hello',
    finalSpokenText: 'Hello', rephrased: false, naturalDuration: 1.2,
    finalDuration: duration, plannedStart: 9, plannedEnd: end, plannedDuration: duration,
    tempo: Number((1.2 / duration).toFixed(4)), hardEnd: 10, finalAudioPath: 'unchanged.wav',
    words: [], alignmentConfidence: 0, alignmentQuality: 'cue',
    subtitles: [{ id: 'tail', start: 9, end, text: 'Hello' }]
  }
}
for (const overshoot of [0.003, 0.01, 0.3]) {
  test(`blocks measured EOF overshoot ${overshoot} without changing evidence`, () => {
    const current = unit(10 + overshoot)
    const before = structuredClone(current)
    const result = validateAutoShortPublicationTimeline([current], 10)
    assert.equal(result.ok, false)
    assert.match(result.violations.join(' '), /EOF|thời lượng video/u)
    assert.deepEqual(current, before)
  })
}
test('metadata drift inside a longer video does not rewrite measured duration', () => {
  const current = unit(10)
  current.plannedEnd = 10.003
  const before = structuredClone(current)
  assert.equal(validateAutoShortPublicationTimeline([current], 11).ok, true)
  assert.deepEqual(current, before)
})
```

- [ ] Đăng ký `autoshort-publication-timeline.test` vào `knownTests` rồi chạy red; chưa export helper phải fail build, sau đó cần đảm bảo EOF tests bắt đúng lỗi hành vi trước implementation guard.

```powershell
node scripts/run-local-runtime-tests.mjs autoshort-publication-timeline.test local-runtime.test
```

- [ ] **Green: wrapper validator thuần.** Chạy `validateAutoShortTimelineSync` trước, bổ sung vi phạm finite/video EOF từ actual end, không mutate input. Khi `finalDuration` thiếu/không dương phải trả violation, không mặc định thành `plannedDuration`. Giữ warnings từ validator cũ.

```ts
export function validateAutoShortPublicationTimeline(
  units: readonly AutoShortDubbingUnit[],
  videoDuration: number
): TimelineSyncValidationResult {
  const previous = validateAutoShortTimelineSync(units, videoDuration)
  const violations = [...previous.violations]
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
    violations.push('Thời lượng video không hợp lệ.')
  }
  if (!units.length) violations.push('Danh sách dubbing unit rỗng.')
  const epsilon = 1e-6
  for (const current of units) {
    const duration = current.finalDuration ?? Number.NaN
    const actualEnd = current.plannedStart + duration
    if (!Number.isFinite(actualEnd) || !Number.isFinite(current.plannedEnd) || !(duration > 0)) {
      violations.push(`Unit ${current.id}: thiếu duration audio đo thực hoặc end không hợp lệ.`)
    } else if (actualEnd > videoDuration + epsilon || current.plannedEnd > videoDuration + epsilon) {
      violations.push(`Unit ${current.id}: audio vượt EOF/thời lượng video.`)
    }
  }
  return {
    ok: violations.length === 0,
    violations,
    ...(violations.length ? { error: violations.join(' | ') } : {}),
    ...(previous.warnings?.length ? { warnings: [...previous.warnings] } : {})
  }
}
```

- [ ] Xóa block coordinator clamp và gọi wrapper trước stitch/burn. Giữ lỗi policy vào structured item result hiện có. Không xử lý FFmpeg ở wrapper; sửa DSP chỉ ở `fitPreparedCue` Task 1.
- [ ] Test coordinator với deps mới: fixture synth trả unit EOF 3 ms; `stitchAudioTimeline` và `burn` spy phải có count 0, result.status=`error`, original unit/diagnostics giữ nguyên. Control hợp lệ phải đi qua stitch/burn và có artifact. Dùng context/source/temp directory từ fixture coordinator đã có trong `tests/autoshort-ocr-pipeline.test.ts`; phần thay đổi dependency phải dùng `typeof` hàm thật, không sửa IPC.
- [ ] Bổ sung tests: NaN/Infinity/zero-duration, `plannedEnd` trong video nhưng `plannedStart+finalDuration` vượt video, tempo mismatch vẫn fail, 0.3 s bị chặn, deep-frozen units không bị mutation. Không đổi expected thành success bằng cách tăng tolerance.
- [ ] Chạy xanh:

```powershell
node scripts/run-local-runtime-tests.mjs autoshort-publication-timeline.test autoshort-ocr-pipeline.test local-runtime.test dubbing-plan.test
```

**Đầu ra task:** không che lỗi bằng metadata, không cắt tiếng ở stitch để giả success; EOF thật có diagnostic riêng. Không gọi fixture EOF 3 ms là “benign rounding đã cứu thành công”.

## Task 4 — Giữ phủ định thật, chỉ miễn đúng trợ từ nghi vấn

**Files:** thêm `src/main/contentQuality/negation.ts`; sửa `src/main/autoShortContentQuality.ts`; bổ sung `tests/autoshort-content-quality.test.ts`.

**Interfaces:** helper mới thuần, không import Electron/provider:

```ts
export interface ComparedNegationTokens {
  source: readonly string[]
  target: readonly string[]
}
export function negationTokensForComparison(
  sourceText: string,
  targetText: string
): ComparedNegationTokens
```

- [ ] **Red: thêm cả false-negative và controls.** Dùng hàm `cue` đang có trong QA suite:

```ts
for (const [source, target, warning] of [
  ['你为什么不去学校？', 'Tại sao bạn đi học?', true],
  ['不要看星星。', 'Hãy nhìn các vì sao.', true],
  ['你明天去学校吗？', 'Ngày mai bạn có đi học không?', false],
  ['你吃饭了吗？', 'Bạn đã ăn cơm chưa?', false],
  ['我们可以走吗？', 'Chúng ta có thể đi được không?', false],
  ['不要摸这只狗。', 'Đừng chạm vào con chó này.', false],
  ['你为什么不去学校？', 'Tại sao bạn không đi học?', false],
  ['可以走了。', 'Không được đi.', true],
  ['你吃饭了吗？不要喝酒。', 'Bạn đã ăn cơm chưa? Hãy uống rượu.', true]
] as const) {
  test(`polarity evidence: ${source} -> ${target}`, () => {
    const result = assessContentQuality([cue('a', source, 0)], [cue('a', target, 0)])
    assert.equal(result.issues.some(issue => issue.code === 'protected-token-suspect'), warning)
    assert.ok(result.issues.every(issue => issue.severity === 'warning'))
  })
}
```

- [ ] Chạy red `node scripts/run-local-runtime-tests.mjs autoshort-content-quality.test`; xác nhận hai false-negative đầu đang fail assertion.
- [ ] **Green: di chuyển tokenizer phủ định nguyên bản vào helper**, trước khi áp rule mới. Chuẩn hóa NFKC/case, giữ tập marker Latin và CJK/Arabic/Thai hiện có, không để digit substitution làm thay đổi word boundary của polarity.
- [ ] Thay blanket `continue` bằng so sánh danh sách token số/đơn vị + polarity tokens đã xử lý. Rule exemption chỉ chạy khi nguồn không có phủ định thật, nguồn là một mệnh đề polar question kết `吗/嗎`, đích là một mệnh đề nghi vấn tiếng Việt có suffix đã nhận diện; loại một token cuối, không xóa mọi token `neg`.

```ts
// Pure rule trong negation.ts; chỉ được dùng khi tokenizer đã chứng minh
// nguồn không có neg và đích có đúng một neg nằm trong suffix match.
function positiveChinesePolarQuestion(text: string): boolean {
  const normalized = text.normalize('NFKC').trim().replace(/[?？。.!！]+$/u, '')
  return !/[。.!！?？;；\n]/u.test(normalized) && /[吗嗎]$/u.test(normalized)
}
function vietnameseQuestionSuffix(text: string): RegExpMatchArray | null {
  const normalized = text.normalize('NFKC').trim()
  if (!/[?？]$/u.test(normalized)) return null
  const body = normalized.replace(/[?？]+$/u, '').trim()
  if (/[.!?。！？;；\n]/u.test(body)) return null
  if (/(?:^|\s)có\s+.+\s+không$/iu.test(body)) return body.match(/không$/iu)
  if (/(?:^|\s)đã\s+.+\s+chưa$/iu.test(body)) return body.match(/chưa$/iu)
  return null
}
```

- [ ] Helper trả nguyên tokens khi không đủ evidence, kể cả `sao`, wh-question, câu ghép hoặc marker mới chưa có fixture. `sourceNeg.length===0` và đúng một `targetNeg` ở suffix là điều kiện bắt buộc; nguồn đã có neg giữ nguyên comparison, không miễn hai chiều theo dấu hỏi.
- [ ] Loại `isQuestionSentence` khỏi QA path khi không còn consumer; giữ severity/disposition contract. Test trực tiếp helper để phủ định thật và interrogative marker cùng xuất hiện không bị gộp mất; giữ default behavior cho Japanese/Korean/Arabic/Thai.
- [ ] Chạy xanh `autoshort-content-quality.test translation-orchestrator.test local-translation.test`, rồi review diff. Nếu fixture câu dịch thiếu phủ định phải sửa fixture hoặc kỳ vọng warning, không xóa marker để suite pass.

**Đầu ra task:** hai ví dụ F3 hiện warning; ba controls câu hỏi đúng không warning; không biến QA heuristic thành hard semantic gate hoặc thêm LLM call.

## Task 5 — Parse cụm số Hán, giữ ordinal và tránh từ vựng

**Files:** thêm `src/main/contentQuality/numerals.ts`, `tests/content-quality-numerals.test.ts`; sửa `src/main/autoShortContentQuality.ts`, `tests/autoshort-content-quality.test.ts`, `scripts/run-local-runtime-tests.mjs`.

**Interfaces:** span dùng chỉ số UTF-16 trong chuỗi NFKC đã normalize, `end` exclusive:

```ts
export interface ContextualNumberToken {
  start: number
  end: number
  token: `num:${number}` | `ordinal:${number}`
}
export function normalizeUnicodeDecimalDigits(text: string): string
export function parseChineseInteger(text: string): number | null
export function extractContextualNumberTokens(text: string): readonly ContextualNumberToken[]
```

- [ ] **Red: test parser độc lập, đăng ký suite mới.**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseChineseInteger, extractContextualNumberTokens } from '../src/main/contentQuality/numerals'

for (const [text, value] of [
  ['零', 0], ['两', 2], ['十', 10], ['十二', 12], ['二十', 20],
  ['一百零二', 102], ['一千零二十', 1020], ['一万零三', 10003],
  ['二〇二四', 2024], ['兩萬', 20000]
] as const) {
  test(`Chinese integer ${text}`, () => assert.equal(parseChineseInteger(text), value))
}
for (const invalid of ['十十', '一百百', '一亿', '一半', '十二点五', '']) {
  test(`no partial integer parse for ${invalid}`, () => assert.equal(parseChineseInteger(invalid), null))
}
for (const text of ['我们一起走吧。', '一定要来。', '一直向前。', '万一失败。', '千万不要走。']) {
  test(`lexical numeral characters: ${text}`, () => {
    assert.deepEqual(extractContextualNumberTokens(text), [])
  })
}
test('quantity and ordinal are extracted as separate semantic classes', () => {
  assert.deepEqual(extractContextualNumberTokens('十二个苹果').map(item => item.token), ['num:12'])
  assert.deepEqual(extractContextualNumberTokens('这是第三次。').map(item => item.token), ['ordinal:3'])
  assert.deepEqual(extractContextualNumberTokens('Đây là lần thứ tư.').map(item => item.token), ['ordinal:4'])
})
```

- [ ] Bổ sung QA pairs: `十二个苹果` ↔ `12 quả táo` không warning; `十二` ↔ `13` warning; `一起` ↔ `cùng` không warning; `第三次` ↔ `lần thứ ba` không warning, ↔ `lần thứ tư` warning; `第3次` ↔ `the third time` không warning; Eastern Arabic control, signed `-5` vs `5` và unit change vẫn giữ finding.
- [ ] Chạy red:

```powershell
node scripts/run-local-runtime-tests.mjs content-quality-numerals.test autoshort-content-quality.test
```

- [ ] **Green: parse số theo grammar, không replace đơn vị theo từng glyph.** Normalize `兩→两`, `萬→万`; chuỗi chỉ có digit thì parse base-10. Với dạng unit, tách tối đa một `万`, parse hai section nhỏ hơn 10000 theo thứ tự unit giảm dần `千→百→十`. Cho phép digit ẩn bằng 1 trước `十` ở đầu section; reject unit lặp/tăng ngược, ký tự dư, fraction/decimal/亿 và kết quả ngoài 0–99,999,999. Hàm trả `null` nếu toàn span không parse được, không trả phần prefix đã hiểu.

```ts
// Quy tắc ghép section sau khi parse hai section hợp lệ:
// Ví dụ 一万零三: high=1, low=3, result=10003.
function combineWanSections(high: number, low: number): number | null {
  if (!Number.isInteger(high) || !Number.isInteger(low)) return null
  if (high < 1 || high > 9999 || low < 0 || low > 9999) return null
  return high * 10000 + low
}
```

- [ ] **Green: scanner span theo ngữ cảnh.** Thu ordinal trước quantity; span không overlap. `第+numeral` và ordinal rõ trong Vietnamese/English tạo `ordinal:N`. Với quantity, chỉ nhận khi ngay sau là classifier/unit cho phép hoặc toàn cue là numeral; numeral lexical span không qua grammar/context phải bị bỏ qua toàn span, không tách chữ số đơn bên trong. Tránh parse prefix `十二` của `十二点五`.
- [ ] Bảng ordinal words hỗ trợ 1–10, hạn chế theo cấu trúc: Vietnamese `thứ nhất/hai/ba/tư/bốn/năm/sáu/bảy/tám/chín/mười`, English `first…tenth` trong ngữ cảnh ordinal rõ như `the third time`. Cụm `thứ ba` chỉ được chuẩn hóa khi có danh từ thứ tự như `lần/bước/chương/mục`, tránh biến thứ trong tuần thành quantity. `第3`, `thứ 3`, `3rd` cùng canonical class. Không parse mọi số viết bằng chữ của mọi ngôn ngữ trong task này.
- [ ] **Green: tích hợp không double-count.** Lấy tokens contextual từ normalized text, blank đúng spans bằng số lượng UTF-16 code units tương ứng, rồi chạy number/unit matcher cũ trên phần còn lại. Numeric quantity dạng digit vẫn do matcher cũ xử lý; contextual scanner không được ăn span digit quantity nếu việc đó làm mất canonical unit. Chỉ digit ordinal do scanner mới sở hữu. Polarity dùng raw normalized text qua helper Task 4.

```ts
const contextual = extractContextualNumberTokens(normalized)
const units = normalized.split('')
for (const span of contextual) {
  for (let index = span.start; index < span.end; index++) units[index] = ' '
}
const numericRemainder = units.join('')
const contextualTokens = contextual.map(span => span.token)
// numberPattern hiện có chạy trên numericRemainder; merge contextualTokens
// vào numeric/unit tokens trước khi sort, không blank sourceText dùng cho negation.
```

- [ ] Xóa CJK replacement trong `unicodeDigitsToAscii`, thay bằng helper decimal Unicode; xóa `.replace(/第.../)`. Sửa test `Chinese ordinal cue markers do not become protected quantities`: nội dung source ordinal là nội dung thật, không metadata. Dùng bản dịch giữ ordinal, hoặc giữ bản dịch mất ordinal và assert warning.
- [ ] Chạy xanh suite mới, QA, `translation-orchestrator.test`, `translation-multilingual.test`, `local-translation.test`; rà fixture failures để phân biệt bản dịch sai với parser sai. Unknown-language number words vẫn là heuristic warning như contract trước.

**Đầu ra task:** F4 examples đúng; parser xử lý cụm số trong phạm vi grammar có kiểm chứng, không claim hiểu mọi số/từ Hán. Không thêm hard character cap hay semantic rewrite.

## Task 6 — Version prompt mới và identity theo speakingDuration

**Files:** sửa `src/main/translation/prompts.ts`, `src/main/translation/checkpoint.ts`, `tests/translation-prompts.test.ts`, `tests/translation-identity.test.ts`, `tests/translation-resume.test.ts`; bổ sung fixture coordinator reuse trong `tests/autoshort-ocr-pipeline.test.ts` nếu chưa có test đường checkpoint đủ sâu.

**Interfaces:** giữ `TranslationIdentity`/`TranslationInput`. Đổi literal `TRANSLATION_PROMPT_VERSION` sang `translation-v6`; giữ `TRANSLATION_PARSER_VERSION=translation-parser-v2`. `speakingDuration` là field có sẵn trên cue input, chỉ thêm vào canonical identity khi được cung cấp.

- [ ] **Red: test constant và key behavior.** Bổ sung import constant trong identity suite; dùng biến `input`, `identity` fixture đang có:

```ts
test('current prompt cannot reuse v5 translation identity', () => {
  assert.equal(TRANSLATION_PROMPT_VERSION, 'translation-v6')
  const before = buildTranslationIdentity(input, { ...identity, promptVersion: 'translation-v5' })
  const after = buildTranslationIdentity(input, { ...identity, promptVersion: TRANSLATION_PROMPT_VERSION })
  assert.notEqual(before, after)
})
test('different dubbing speaking windows invalidate reuse', () => {
  const a = { ...input, mode: 'dubbing' as const,
    cues: [{ ...input.cues[0]!, speakingDuration: 1 }] }
  const b = { ...a, cues: [{ ...a.cues[0]!, speakingDuration: 2 }] }
  assert.notEqual(buildTranslationIdentity(a, identity), buildTranslationIdentity(b, identity))
  assert.equal(buildTranslationIdentity(a, identity), buildTranslationIdentity(structuredClone(a), identity))
})
```

- [ ] Chạy red `node scripts/run-local-runtime-tests.mjs translation-identity.test translation-prompts.test translation-resume.test`; constant/key tests phải fail trên baseline.
- [ ] **Green: cập nhật version và canonicalization.** Giữ mode/context/glossary/options hiện có. Không default missing speakingDuration thành 0, vì thiếu field và cửa sổ thật bằng 0 là hai input khác nhau.

```ts
// Trong canonicalInput.cues.map của buildTranslationIdentity:
({ id: cue.id, sourceIndex: cue.sourceIndex, start: cue.start, end: cue.end,
   groupId: cue.groupId, text: cue.text,
   ...(cue.speakingDuration === undefined ? {} : { speakingDuration: cue.speakingDuration }) })
```

- [ ] Test resume đường thật: ghi checkpoint v5 có translatedCues và cùng source/model/config; chạy coordinator v6 phải gọi dịch lại, không khôi phục bản dịch dài cũ. Control checkpoint v6 cùng key phải reuse; sửa source/duration phải invalidate; QA revalidate cảnh báo mới F3/F4 khi reuse phải phản ánh assessment hiện hành. Không xóa artifact/cache cũ, không reset budget khi key không đổi.
- [ ] Rà các cache/identity call sites qua `rg -n 'TRANSLATION_PROMPT_VERSION|promptVersion|buildTranslationIdentity' src/main tests`; cập nhật tests literal version chỉ nơi thể hiện version hiện tại, không sửa fixture lịch sử v4/v5 dùng để test migration. Giữ parser/assessment schema version vì không thay shape IPC.
- [ ] Test prompt budgets vẫn xuất với `mode=dubbing`, không xuất với subtitle; bảng profile có đúng 12 keys và fallback được mô tả. Không đổi rate để cố giảm overflow trong task này. Ghi quy tắc bump prompt version khi thay rate/payload.
- [ ] Chạy xanh:

```powershell
node scripts/run-local-runtime-tests.mjs translation-prompts.test translation-identity.test translation-resume.test translation-orchestrator.test autoshort-ocr-pipeline.test
```

**Đầu ra task:** retry/resume không dùng prompt v5 như v6; cùng identity vẫn reuse; `speakingDuration` khác không cùng key.

## Task 7 — Đồng bộ planning, spec, ADR và walkthrough theo code cuối

**Files:** cập nhật các file sau khi Task 1–6 hoàn tất:

- `docs/superpowers/specs/2026-09-08-autoshort-review-fixes-design.md` và plan này: checkbox/status theo bằng chứng.
- `docs/superpowers/specs/2026-09-08-autoshort-reliable-multilingual-dubbing-pipeline.md`.
- `docs/superpowers/specs/2026-09-08-autoshort-decoupled-dubbing-design.md`.
- `docs/superpowers/plans/2026-09-08-autoshort-decoupled-dubbing.md`.
- `docs/adr/005-source-anchored-dubbing-tempo-policy.md`.
- `C:\Users\PC\.gemini\antigravity\brain\5b368140-d2f7-402f-8038-d087e1ba07d4\implementation_plan.md` và `walkthrough.md`.
- Tạo `.ai/tasks/2026-09-08-autoshort-review-fixes-implementation.md` theo template khi bắt đầu thực thi; chưa đánh dấu implemented trong task lập planning.

**Interfaces:** không đổi API; tài liệu phải dùng đúng tên field/API sau Task 1–6.

- [ ] Gắn trạng thái tài liệu cũ là phạm vi ban đầu đã được điều chỉnh bởi design fixes; giữ mục lịch sử, thêm đường dẫn bản thay thế, không giả rằng soft ceiling/gap 0.25 từng được chấp nhận.
- [ ] Chỉnh active requirements: tempo 1.45x/protected gap 0.50 s, một callback toàn queue nhưng nhiều HTTP batches ≤8; first-fit candidate được đo, không phải shortest toàn bộ; adapter elapsed không phải chỉ thời gian chờ lease; 12 profiles heuristic và fallback, không “chuẩn quốc tế/toàn bộ ngôn ngữ”.
- [ ] Thay claim “luôn xuất thành phẩm”, “giảm 90%”, “hết 100% cảnh báo”, “không còn regression” bằng acceptance đo được. Walkthrough chỉ liệt kê tests thực chạy và gate media `pending` nếu chưa chạy. Không chép số test 269 cũ làm kết quả fixes.
- [ ] Giữ review report/scripts và input hashes nguyên trạng làm evidence lịch sử. Với hai file ngoài repo, đọc lại hash trước ghi, backup nội dung cũ vào evidence execution; nếu file đã thay đổi, cập nhật phần điều chỉnh dựa trên nội dung mới, không overwrite mù.
- [ ] Rà consistency theo bảng sau và kiểm tra đường dẫn links:

| Khái niệm | Cách ghi phải thống nhất |
|---|---|
| Nguồn chân lý timing | Duration WAV/DSP đo thật, source ledger bất biến |
| Tempo/gap | 1.45x trần, 0.50 s gap, early lead ≤0.35 s khi đủ điều kiện |
| Batch | Một adapter phase, nhiều initial requests ≤8 và một repair pass |
| Candidate | Thử original với lịch mới trước; sau đó first-fit measured candidate ≤3 |
| Split | Kiểm tra child windows; deferred dependency không split theo lịch tạm |
| EOF | Validator thuần, actual overshoot bị chặn trước stitch, không metadata clamp |
| QA | Số/phủ định heuristic warning; structural mapping error vẫn chặn |
| Prompt | translation-v6, budget mềm, invalidate key cũ |
| Evidence | CODE_CONFIRMED / TEST_CONFIRMED / DOCUMENTED_ONLY / UNKNOWN |

**Đầu ra task:** mọi tài liệu mô tả cùng một behavior có thể kiểm chứng; lịch sử review không bị chỉnh cho khớp claim mới.

## Task 8 — Gate kiểm chứng local và media acceptance

**Files:** không kỳ vọng thay source; ghi logs trong `docs/reviews/2026-09-08-autoshort-review-fixes-verification/` và handoff implementation Task 7.

### Gate A — Local fixes verified

- [ ] Chạy các suite liên quan khi code/docs đã hoàn tất, kiểm tra exit code thật:

```powershell
node scripts/run-local-runtime-tests.mjs dubbing-plan.test dubbing-grouping.test translation-rephrase.test autoshort-publication-timeline.test autoshort-content-quality.test content-quality-numerals.test translation-prompts.test translation-identity.test translation-resume.test translation-orchestrator.test autoshort-tts-pipeline.test autoshort-tts-cache.test autoshort-resource-manager.test autoshort-resource-lifecycle.test autoshort-item-scope.test autoshort-disk-budget.test autoshort-ocr-pipeline.test local-runtime.test
```

- [ ] Chạy checks tổng thể một lần sau targeted tests pass; nếu sau đó sửa code thì kết quả kiểm chứng cũ không đủ, chạy lại phần bị ảnh hưởng và final gate:

```powershell
$ErrorActionPreference = 'Stop'
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'typecheck failed' }
npm.cmd run test:local-runtime
if ($LASTEXITCODE -ne 0) { throw 'local-runtime failed' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'build failed' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'diff check failed' }
git status --short
git rev-parse HEAD
```

- [ ] Lưu HEAD, command, exit code, count pass/fail/skip và runtime vào handoff. Regression F1 phải chạy trên code thật qua public synthesis API; F2 qua resource manager và response thật; F3–F5 qua public QA/identity APIs; F6 qua pure validator và coordinator seam.
- [ ] Review diff theo finding; không stage artifacts có trước, không cập nhật review cũ thành “fixed”. Nếu tạo commit, stage explicit production/tests/docs của task; ghi commit hash fixes vào evidence.

### Gate B — Media acceptance độc lập

- [ ] Xác định video lỗi ban đầu từ artifact/log/checkpoint có sẵn trong workspace, cấu hình provider/model/voice/output tương ứng và hash video. Nếu không xác định được duy nhất, chỉ lúc này hỏi người dùng đường dẫn video và cấu hình còn thiếu; không suy đoán video khác là lỗi cũ.
- [ ] Dùng thư mục output mới trong scope, không ghi đè video thành công trước. Ghi cấu hình đã redact secrets, OS, model/voice revision, TTS endpoint identity, media duration và cue count.
- [ ] Chạy tối thiểu các nhóm sau; cùng video/voice/config cho so sánh trước/sau nếu baseline thực thi được:

| Case | Tiêu chí |
|---|---|
| Video lỗi gốc, Local, replace | Không split premature; cue IDs/ý nghĩa còn đủ; MP4 valid hoặc diagnostic overflow đúng nếu input vẫn không thể fit |
| Fixture media tương ứng F1 | Phải xuất thành công, giữ group khi predecessor rescue giải phóng lead |
| Không overflow | Không LLM rescue, không TTS lại original đã fit |
| Nhiều overflow >8 | Initial HTTP chunks ≤8, body và repair trong cùng lease phase |
| Cạnh tranh inference + cancel | Trace ownership không overlap; cancellation drain, không process/artifact scratch còn treo |
| Source mix | Early lead bằng 0; không lấn thoại nguồn |
| Subtitle-only | Không TTS/budget áp sai; translation/QA vẫn hoạt động |
| QA corpus zh→vi/en | Positive questions không warning giả; mất phủ định/số có warning; lexical 一 không tạo quantity giả |

- [ ] Kiểm tra FFprobe audio/video duration, subtitle bounds, source ledger đủ/một-một qua grouping, tempo từ natural/final duration, waveform-tail ở cue cuối và nghe các cue rescue; không dùng file tồn tại hoặc status xanh làm bằng chứng duy nhất.
- [ ] Thu timeline phase/request/repair, `overflowCount`, `rescueAttemptCount`, `rescueAcceptedCount`, model load/unload và peak memory nếu server cung cấp. Nếu không có server telemetry, ghi `UNKNOWN`; không suy từ số callback thành số swap GPU.
- [ ] Chốt `media acceptance passed` chỉ khi các case bắt buộc có bằng chứng. Nếu thiếu provider/video/voice, Gate A có thể đóng riêng, Gate B giữ `pending`; không gọi full implementation production-ready.

## Checklist nghiệm thu theo finding

| Finding | Test quyết định | Điều kiện đóng |
|---|---|---|
| F1 | Predecessor rescue + real grouping; late split/cancel; prefetch on/off | Không lỗi `audio không hợp lệ` do split sai; đủ ledger, tempo/gap đúng |
| F2 | Delayed body + queued competitor + >8/repair/cancel | Lease giữ hết action, không nested deadlock, không reset deadline |
| F3 | Mất neg thật / polar controls / câu ghép | Warning đúng các false-negative; không blanket exemption |
| F4 | Parser units/ordinal/lexical + public QA | Không parse 十二 thành 2, 一起 thành 1; ordinal giữ ý nghĩa |
| F5 | v5→v6 key, differing speakingDuration, resume control | Key cũ không reuse; key hiện tại giữ reuse/budget đúng |
| F6 | Frozen input + EOF guard + coordinator stitch/burn spies | Không metadata mutation; overshoot thật không bị cắt để xuất |
| Claims | Tài liệu + exact logs + media status | Không biến plan/test local thành kết luận server/production |

## Bàn giao và rollback

- Sáu fixes production được nghiệm thu theo từng task; Task 7–8 chốt tài liệu và toàn hệ thống. Không mark task xanh chỉ vì suite hiện có pass khi regression mới chưa được thêm.
- Nếu phải revert một fix khi thực thi, revert commit khu trú; không xóa cache/file output của người dùng, không hạ prompt version để trộn artifact hai policy. Luôn kiểm tra dependency Task 1→2 và Task 4→5 trước revert.
- Plan này hoàn thành ở mức thiết kế và checklist thực thi. Các checkbox implementation còn trống có chủ đích; không có production fixes trong lượt lập planning.
