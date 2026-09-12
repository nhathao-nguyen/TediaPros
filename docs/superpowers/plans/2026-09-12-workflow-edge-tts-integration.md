# Workflow Branch / Edge-TTS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Chỉ triển khai khi người dùng yêu cầu thực hiện bản kế hoạch; hiện tại đây là tài liệu đề xuất.

**Goal:** Bổ sung Edge-TTS cho Voice và AutoShort từ incoming commit `1d61ef744384208382de3903b73b2953d45553ab`, bảo toàn pipeline và dữ liệu Local hiện tại.

**Architecture:** Port provider qua typed contract và TTS adapter; tiếp tục dùng dubbing planner, cache v2, batch journal và coordinator hiện tại. Tách transport/cancellation khỏi audio conversion và catalog; không thay nguyên file bằng phiên bản branch.

**Tech Stack:** Electron 34, React 19, TypeScript, Node test runner, msedge-tts (candidate exact version 2.0.7), FFmpeg/FFprobe hiện có.

**Spec:** [Báo cáo đối chiếu và thiết kế](../specs/2026-09-12-workflow-branch-integration-review.md). Đọc cả hai tài liệu; findings F1–F8 là yêu cầu nghiệm thu.

## Global Constraints

- Giữ LICENSE/NOTICE PolyForm Noncommercial; giữ attribution dependency khi đóng gói.
- Windows 10/11 x64 và macOS Apple Silicon M1+ là target; chỉ công bố platform đã chạy qualification.
- `TtsProvider = 'local-tts' | 'edge-tts'`; provider thiếu = Local tại runtime; không tự thêm default field làm đổi legacy digest.
- AutoShort Edge synthesis ở rate **1.0**; DSP hard tempo **1.80x**, protected gap **0.50s**, trim **-50 dB / onset 30ms / offset 100ms**.
- Không drop cue; không silent fallback provider hoặc audio mode. Giữ budgets tổng dịch/recovery đang tạm tắt.
- Edge transport mặc định deadline **60.000ms**, audio tối đa **16 MiB**, Voice text tối đa **20.000 Unicode code points**; giới hạn transport không lấy từ renderer options.
- Path input phải contained; FFmpeg child phải track/terminate qua `processTree.ts`; partial files phải dọn khi lỗi/hủy.
- Typed IPC; shared không import Node/DOM; UI listener/effect có cleanup.
- Tôn trọng dirty work AI-output/translation/SEO hiện có; không tự stash/reset/clean hoặc stage cả repository.
- Các tên file/hàm mới bên dưới là thiết kế sẽ tạo, không phải code đã tồn tại.

## Thứ tự, effort và điểm dừng

`T0 base → T1 contract/catalog → T2 adapter/audio → T3 Voice → T4 AutoShort/identity → T5 qualification`.

Ước lượng kỹ thuật, chưa phải cam kết: T0 0,5–1 giờ; T1 2–3 giờ; T2 4–8 giờ; T3 2–4 giờ; T4 4–8 giờ; T5 3–6 giờ. Tổng khoảng 2–4 ngày làm việc, phụ thuộc API và platform. Nếu package candidate không hoạt động thì ghi evidence và đổi adapter/package trong phạm vi T2; không chữa bằng tăng retry vô hạn.

## T0 — Chốt base và workspace triển khai

**Files:** đọc `AGENTS.md`, `.ai/tasks/2026-09-12-workflow-branch-integration/*`; tạo `.ai/tasks/TASK-<execution-date>-edge-tts-integration.md` theo template và thư mục evidence riêng tại ngày triển khai.

**Interfaces:** consumes SHA khảo sát và dirty inventory; produces base SHA thực thi cùng worktree riêng. Đây là preflight, không phải commit feature.

- [ ] Đối soát remote và local; nếu tip thay đổi, review delta mới trước dùng kế hoạch.

```powershell
git status --short
git rev-parse HEAD
git fetch --no-tags origin fix/workflow-capcut-youtube
git rev-parse FETCH_HEAD
git rev-list --left-right --count HEAD...FETCH_HEAD
```

- [ ] Kiểm tra các công việc dirty đã được chủ task chốt vào base hay chưa. Nếu chưa, có thể làm adapter/contract trên committed base riêng; trước tích hợp cuối bắt buộc rebase/review trên base chứa công việc vừa chốt. Không coi worktree tạo từ HEAD là đã chứa dirty edits.
- [ ] Dùng skill `using-git-worktrees` để tạo branch `codex/integrate-edge-tts` tại path đã kiểm tra chưa tồn tại. Không chạy cherry-pick/merge incoming trên checkout chính.
- [ ] Chạy baseline typecheck và sáu suite trong báo cáo. Lưu output và exit code; lỗi baseline phải tách khỏi lỗi Edge.

## T1 — Contract, catalog và tương thích config

**Files:**

- Create `src/shared/edgeTtsContract.ts`, `tests/edge-tts-contract.test.ts`.
- Modify `src/shared/types.ts`, `src/shared/autoShortContract.ts`, `scripts/run-local-runtime-tests.mjs`.
- Update execution handoff với contract decisions.

**Interfaces đề xuất:**

```ts
// types.ts
export type TtsProvider = 'local-tts' | 'edge-tts'
export interface EdgeVoiceDefinition {
  id: string
  name: string
  gender: 'female' | 'male'
  language: string
  locale: string
  isDefault?: boolean
}
export interface EdgeVoiceCatalogResult {
  ok: boolean
  voices: EdgeVoiceDefinition[]
  source: 'live' | 'fallback'
  checkedAtUtc: string
  error?: string
}
// Thêm provider?: TtsProvider vào TtsSpeechRequest và ttsProvider?: TtsProvider vào AutoShortConfig.
// edgeTtsContract.ts
export function resolveTtsProvider(value?: TtsProvider): TtsProvider
export function resolveEdgeVoice(
  voices: readonly EdgeVoiceDefinition[], language: string, requestedVoice?: string
): EdgeVoiceDefinition
export function validateEdgeProsody(
  input: { speed?: number; pitch?: string }, context: 'voice' | 'autoshort'
): { speed: number; pitch?: string }
```

- [ ] Viết regression test trước implementation; đăng ký `edge-tts-contract.test` vào runner.

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveTtsProvider, resolveEdgeVoice, validateEdgeProsody } from '../src/shared/edgeTtsContract'
const voices = [
  { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My', gender: 'female' as const, language: 'vi', locale: 'vi-VN' },
  { id: 'es-ES-ElviraNeural', name: 'Elvira', gender: 'female' as const, language: 'es', locale: 'es-ES' }
]
test('legacy defaults to Local and Spanish resolves to Spanish', () => {
  assert.equal(resolveTtsProvider(undefined), 'local-tts')
  assert.equal(resolveEdgeVoice(voices, 'es').id, 'es-ES-ElviraNeural')
  assert.throws(() => resolveEdgeVoice(voices, 'es', 'clone:old-local-id'))
  assert.throws(() => resolveEdgeVoice(voices, 'xx'))
})
test('AutoShort rejects provider acceleration and Voice rejects nonfinite speed', () => {
  assert.deepEqual(validateEdgeProsody({}, 'autoshort'), { speed: 1 })
  assert.throws(() => validateEdgeProsody({ speed: 1.8 }, 'autoshort'))
  assert.throws(() => validateEdgeProsody({ speed: NaN }, 'voice'))
})
```

- [ ] Run `node scripts/run-local-runtime-tests.mjs edge-tts-contract.test`; xác nhận FAIL vì chưa có implementation.
- [ ] Chuyển seed catalog từ commit gốc vào shared module; chuẩn hóa language bằng helper hiện có. Resolver ưu tiên exact locale rồi base language; requested voice không có hoặc sai language phải báo lỗi. Dynamic voices được validate/deduplicate trước khi bổ sung catalog; không giữ seed đã bị server xác nhận loại bỏ như giọng chắc chắn live.
- [ ] Implement runtime default bằng `return value ?? 'local-tts'`; validator reject provider lạ, Edge clone/ref transcript, model khác `edge-tts`, options lạ. Voice chỉ cho speed 0.5–2.0 hữu hạn, pitch dạng signed integer Hz trong -100..100; AutoShort chỉ speed 1 và không pitch/volume/rate option. UI loại bỏ Local options khi tạo Edge request; Main vẫn validate independently.
- [ ] Test config legacy không có field provider sau normalization; Local fields/clone vẫn được giữ. Test Edge đang tắt TTS không gây network call, và Edge + separate-vocals vẫn cần `ttsEnabled=true` như cũ.
- [ ] Run contract suite, `autoshort-ocr-contract.test`, `separator-contract.test`, typecheck; commit riêng `feat(tts): define Edge provider and compatible voice contract` chỉ stage file T1.

## T2 — Transport Edge, cancellation và audio hợp lệ

**Files:**

- Create `src/main/edgeTtsTransport.ts`, `src/main/edgeTtsAudio.ts`, `src/main/edgeTts.ts`, `tests/edge-tts-adapter.test.ts`.
- Modify `src/main/tts.ts`, `package.json`, `package-lock.json`, `scripts/run-local-runtime-tests.mjs`.
- Read `safeContainedPath.ts`, `processTree.ts`, `autoShortDiskBudget.ts`, `burn.ts` để dùng APIs đang có.

**Interfaces:** consumes T1; produces `generateEdgeTTS(req, signal?, savePath?): Promise<TtsGenerateResult>` giữ contract generateSpeech và `fetchEdgeVoices(): Promise<EdgeVoiceCatalogResult>`.

```ts
// Low-level injectable boundary trong edgeTtsTransport.ts.
export interface EdgeAudioSession {
  audio: AsyncIterable<Uint8Array>
  dispose(): void
}
export interface EdgeTtsTransport {
  open(input: { text: string; voice: string; speed: number; pitch?: string },
    signal: AbortSignal): Promise<EdgeAudioSession>
  getVoices(signal: AbortSignal): Promise<unknown>
}
// edgeTtsAudio.ts: đường dẫn chỉ do Main tạo/kiểm tra, không lấy từ raw renderer.
export function normalizeEdgeAudio(input: {
  mp3Path: string; wavPath: string; signal: AbortSignal
}): Promise<{ path: string; durationMs: number }>
```

- [ ] Xác minh source/API đúng version package, gồm public cleanup/close API và SSML escaping. Cài candidate trong worktree bằng `npm.cmd install --save-exact msedge-tts@2.0.7`; không copy lockfile remote. Nếu chọn version khác, cập nhật namespace identity/spec và evidence trước đi tiếp.
- [ ] Viết adapter tests qua transport injection: abort trước open, abort khi đang mở, abort trong stream, abort trong write/probe, timeout, stream rỗng/corrupt, quá 16 MiB, XML metacharacters. Fake session phải đếm `dispose`, assert đúng một lần, không file final/cache mới sau abort. Đăng ký suite rồi chạy để thấy FAIL.
- [ ] Implement transport state machine:

```text
opening -> receiving -> validating -> publishing -> succeeded
bất kỳ bước chưa terminal + abort/error/timeout -> dispose -> delete partial -> failed/cancelled
terminal -> bỏ mọi callback tới muộn; không append bytes hoặc publish tiếp
```

  `open` phải tự dispose tài nguyên nếu bị hủy trước khi trả session; adapter dispose session trong finally. Escape text đúng một lần tại boundary thư viện dùng SSML; voice/pitch chỉ nhận từ contract. Deadline áp dụng cả mở stream và nhận bytes, timeout không chỉ resolve một promise còn để socket chạy.
- [ ] Ghi audio vào file tạm UUID trong scope; kiểm tra header rồi normalize sang WAV PCM mono 24kHz bằng FFmpeg hiện có với tracked process và AbortSignal. Probe duration phải hữu hạn >0, full decode không lỗi trước publish vào savePath. Giữ MP3 cho Voice preview; probe duration thực tế. Không báo success chỉ vì file có byte.
- [ ] Dispatch `generateSpeech` trước Local URL/auth resolution khi provider Edge. `generateVoiceClone` phải reject Edge rõ ràng. Trả requestSpans có queued/start/first response/end, phân biệt cancelled/timeout/transport/provider; không log text hoặc credential. Catalog fetch có deadline, request single-flight và fallback source rõ ràng; fallback không được gán network-ready.
- [ ] Run adapter suite, `autoshort-tts-pipeline.test`, `autoshort-tts-cache.test`, typecheck. Commit `feat(tts): add cancellable Edge speech adapter` cùng lockfile và tests.

## T3 — Voice UI, typed catalog IPC và đúng định dạng khi lưu

**Files:**

- Modify `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/components/Voice.tsx`, `src/main/tts.ts`, `src/shared/types.ts`.
- Create `src/shared/ttsAudioFormat.ts`, `tests/tts-audio-format.test.ts`; register runner.
- Read `src/renderer/AGENTS.md` và `src/renderer/src/lib/persist.ts` để giữ cơ chế persisted state hiện có.

**Interfaces:** `ttsGetEdgeVoices(): Promise<EdgeVoiceCatalogResult>`. Mở rộng backward-compatible `ttsSaveAudio(audioBase64, defaultName?, audioMimeType?)`; metadata trong history thêm optional `audioMimeType`, entry cũ mặc định WAV.

```ts
// ttsAudioFormat.ts: unknown MIME phải reject; legacy undefined = WAV.
export function ttsAudioFormat(mime?: string): { mime: string; extension: 'wav' | 'mp3' }
```

- [ ] Test format trước UI:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { ttsAudioFormat } from '../src/shared/ttsAudioFormat'
test('result MIME owns saved format', () => {
  assert.deepEqual(ttsAudioFormat('audio/mpeg'), { mime: 'audio/mpeg', extension: 'mp3' })
  assert.deepEqual(ttsAudioFormat(), { mime: 'audio/wav', extension: 'wav' })
  assert.throws(() => ttsAudioFormat('text/html'))
})
```

- [ ] Run suite để thấy FAIL, implement normalizer; Main kiểm tra audio header khớp format và tạo filter/đuôi mặc định tương ứng. File write từ dialog phải theo cơ chế path authorization hiện có; không tin tên/path raw từ renderer.
- [ ] Thêm IPC/catalog từ T2 qua bridge typed, giữ origin checks. UI hiển thị trạng thái kết nối thực tế và lỗi/fallback; không hiển thị online cố định. Catalog fetch chỉ khi chọn Edge, cleanup effect khi unmount/chuyển provider.
- [ ] Giữ Local mặc định; dùng `tblao.voice.edgeVoice` riêng. Đổi language phải resolve voice hợp lệ; lựa chọn clone chỉ ở Local. Không nhập UI save-key thay đổi ngoài phạm vi.
- [ ] Preview và history lấy MIME từ result. Save lấy result format kể cả khi provider selector đã đổi; legacy history WAV vẫn phát được. Test thủ công: generate Edge → đổi selector Local → save vẫn MP3; generate Local → đổi selector Edge → save vẫn WAV.
- [ ] Run suite mới, `autoshort-ui-contract.test`, `ipc-origin-validation.test`, typecheck; smoke UI Local/Edge/clone/no-network. Commit `feat(voice): expose Edge voices with correct audio export`.

## T4 — AutoShort adapter, preflight, cache và resume

**Files:**

- Modify `src/main/autoshort.ts`, `src/main/autoShortItemCoordinator.ts`, `src/renderer/src/components/AutoShort.tsx`.
- Modify `src/main/autoShortCutIdentity.ts` chỉ nếu cần canonicalization Local field; không đổi legacy formulas hoặc chấp nhận digest tùy ý.
- Create `src/main/edgeTtsIdentity.ts`, `tests/autoshort-edge-tts.test.ts`; register runner.
- Extend `tests/autoshort-tts-cache.test.ts`, `tests/autoshort-cut-legacy-resume.test.ts`, `tests/dubbing-duration-profile.test.ts`.
- Read `src/main/dubbing/cache.ts`, `src/main/dubbing/synthesis.ts`, `src/main/dubbing/durationPredictor.ts`, `src/shared/autoShortBatchJournal.ts`.

**Interfaces:** `edgeTtsIdentity.ts` exports `EDGE_TTS_ENDPOINT_ID = 'edge-tts:msedge-tts:2.0.7'` (đổi exact version nếu T2 đã chọn khác). Tiếp tục `TtsCacheStore.getOrCreate`, `buildTtsCacheKey`, `durationProfileKey` và `synthesizeDubbingPlan`; không tạo pipeline thứ hai.

- [ ] Test identity trước implementation:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTtsCacheKey } from '../src/main/dubbing/cache'
import { EDGE_TTS_ENDPOINT_ID } from '../src/main/edgeTtsIdentity'
test('Edge cache never aliases Local and voice changes invalidate it', () => {
  const base = { finalSpokenText: 'Hola', language: 'es', model: 'edge-tts', voice: 'es-ES-ElviraNeural', serverSpeed: 1 }
  const local = buildTtsCacheKey({ ...base, endpoint: 'http://127.0.0.1:8000' })
  const edge = buildTtsCacheKey({ ...base, endpoint: EDGE_TTS_ENDPOINT_ID })
  assert.notEqual(edge, local)
  assert.notEqual(edge, buildTtsCacheKey({ ...base, endpoint: EDGE_TTS_ENDPOINT_ID, voice: 'es-ES-AlvaroNeural' }))
})
```

- [ ] Run suite để xác nhận FAIL vì identity chưa có; bổ sung tests preflight: Edge không gọi Local TTS health, nhưng Edge + Local translation vẫn gọi translation preflight; unsupported voice/language/clone fail trước synthesis.
- [ ] Port capabilities và request dispatch vào **synthesizeVoice hiện tại**. Legacy synthesize helper nếu vẫn reachable phải dùng cùng resolver; nếu không reachable, không phục hồi helper cũ từ branch. AutoShort adapter gửi rate 1.0 và options Edge rỗng; `ttsSpeed` vẫn dùng DSP planner hiện tại. Không gọi batch helper riêng.
- [ ] Dùng resolved voice, endpoint namespace và adapter version trong cache/profile. Giữ reference hash/model revision cho Local, single-flight/bypass/producer cancellation. AutoShort cache chỉ nhận WAV đã validate từ T2; trim/probe giữ nguyên. Coordinator telemetry ghi provider alias Edge đúng thay vì Local URL rỗng.
- [ ] UI dùng `tblao.autoshort.edgeVoice` riêng, provider mặc định Local; không để Local capabilities effects sửa Edge voice. Giữ Local server controls nếu translation cần Local. Với config Local, có thể omit `ttsProvider` khi gửi để giữ identity cũ; với Edge luôn ghi explicit provider/model/resolved voice. Snapshot Edge khác voice/provider phải tạo run mới hoặc reject resume; không fallback bằng cách bỏ field.
- [ ] Extend legacy resume tests bằng frozen config/digest trước thêm Edge và Edge config không được nhận Local legacy digests. Chạy cả no-cut và cut V1/V2. Giữ cue IDs/timestamps, measured-first recovery, rephrase/split, 1.80x, nhạc nền, separate-vocals, cut seams, overlay và SEO.
- [ ] Run:

```powershell
node scripts/run-local-runtime-tests.mjs autoshort-edge-tts.test dubbing-plan.test dubbing-duration-profile.test autoshort-tts-cache.test autoshort-tts-pipeline.test autoshort-cut-legacy-resume.test autoshort-batch-resume.test autoshort-cut-pipeline.test separator-pipeline.test autoshort-ui-contract.test
npm.cmd run typecheck
```

- [ ] Commit `feat(autoshort): integrate Edge speech with existing timing and resume` chỉ sau pass và review diff UI chống mất các controls hiện tại.

## T5 — Qualification, documentation và integration gate

**Files:** update `docs/architecture.md`, `docs/domain.md`, `src/main/dubbing/AGENTS.md` đúng phạm vi đã có implementation; create `docs/edge-tts.md`; update task/evidence thực thi. Những tài liệu dirty từ công việc khác chỉ sửa sau khi chốt base, không ghi đè.

**Interfaces:** consumes các task đã pass; produces bảng offline/live/packaged evidence với SHA code, package version, platform, sample text và output duration thực tế.

- [ ] Run `npm.cmd run typecheck`, `npm.cmd run test:local-runtime`, `npm.cmd run build`. Baseline khảo sát 74 tests chỉ là subset; không dùng nó thay full gate sau integration.
- [ ] Live Voice smoke bằng câu fixture không chứa dữ liệu riêng: tiếng Việt, Anh, Tây Ban Nha, Nhật; ghi voice ID, exact package, MIME, duration probe, generation time. Catalog fallback/no-network không được tính là live synthesis PASS.
- [ ] AutoShort smoke fixture: một no-cut video, một cut video, các mode replace/mix/separate-vocals; verify đầy đủ cue IDs, trần tempo, audio tail, protected gaps, subtitle sync, video valid và sidecar SEO còn nguyên. Mất mạng/hủy giữa stream: không request chạy tiếp, không final/partial dư; restart batch không tái dùng audio sai provider.
- [ ] Preview/history/save đúng MP3/WAV; đổi provider qua lại không mất clone, không thay Edge voice bằng Local voice. Dùng kết quả media probe, nghe mẫu và xem UI; typecheck không chứng minh các hành vi này.
- [ ] Packaged Windows qualification trong output riêng theo quy trình release hiện tại; macOS chỉ đánh dấu PASS nếu có host và đã chạy. Nếu chưa có macOS, ghi UNKNOWN và không công bố cả hai nền tảng đã sẵn sàng. Task này không publish release tự động.
- [ ] Documentation nêu rõ Edge cần mạng, text gửi dịch vụ Read Aloud, không voice clone, trạng thái catalog fallback và giới hạn transport; bỏ lời hứa miễn phí vĩnh viễn/300+ giọng luôn sẵn sàng/tăng tốc batch chưa đo. Update evidence mapping F1–F8 và phạm vi còn chưa test.
- [ ] Review change set với base mới nhất chứa công việc AI-output đã chốt; rerun checks khi rebase/resolve tạo thay đổi mới. Commit docs; bàn giao SHA và diff cho bước tích hợp Git theo yêu cầu người dùng. Không tạo merge giả chỉ để đánh dấu `1d61ef7` là ancestor.

## Rollback và nghiệm thu

- Trước tích hợp cuối, checkpoint Git phải được chốt ở worktree riêng; không rollback bằng reset/clean checkout chính.
- Trong runtime, chọn Local provider để trở lại đường xử lý Local; lỗi Edge không tự đổi provider. Config/catalog Edge nằm riêng, cache namespace riêng.
- Nếu cần rollback code, revert các commit T4 → T3 → T2 → T1 theo dependency, giữ logs và user media; legacy Local config/history tiếp tục hoạt động. Không xóa userData hoặc runtime engine cache.
- Hoàn thành tích hợp chỉ khi F1–F8 có evidence tương ứng, Local regressions pass, full typecheck/test/build pass và phạm vi live/platform được ghi đúng. Hết T5 mà live không chạy được thì phân biệt “code/offline complete” với “Edge service qualified”.

## Plan self-review

| Spec requirement | Task |
|---|---|
| Bảo toàn dirty work và remote snapshot | T0, T5 |
| Provider/catalog/language/migration (F3) | T1, T3, T4 |
| Cancel/SSML/bytes/path/audio (F1, F2, F5) | T2 |
| Readiness và truthful UI (F4) | T2, T3, T5 |
| Audio history/export (F5) | T3 |
| Rate/tempo/options (F6) | T1, T4 |
| Không gắn batch helper chưa qualification (F7) | T4, T5 |
| Cache/resume/telemetry (F8) | T4 |
| Tests, docs, Windows/macOS evidence | T5 |

Đây là kế hoạch hoàn chỉnh để review, chưa phải xác nhận người dùng đã chấp thuận các giới hạn transport hoặc bắt đầu implementation.
