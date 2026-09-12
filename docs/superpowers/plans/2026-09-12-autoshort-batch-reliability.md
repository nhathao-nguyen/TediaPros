# AutoShort Batch Reliability and Performance Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task. Chỉ dùng subagent khi người dùng yêu cầu delegation. Các checkbox là công việc triển khai chưa thực hiện.

**Goal:** Chạy ổn định hàng loạt 90 video, phục hồi được phần chưa xong sau gián đoạn và tăng số thành phẩm hợp lệ mỗi giờ.

**Architecture:** Giữ Electron coordinator, queue runner, checkpoint và ArtifactCache hiện có. Sửa lỗi tại ranh giới dữ liệu; thêm journal do Main quản lý để không phụ thuộc localStorage. Đo từng stage/request/encoder trước khi thay đổi concurrency và lịch tài nguyên.

**Tech Stack:** Electron, TypeScript, React, node:test, FFmpeg/FFprobe, OCR DirectML, STTN CUDA, server TTS hiện có.

**Spec:** `docs/superpowers/specs/2026-09-12-autoshort-batch-reliability-design.md`.

**Trạng thái:** Kế hoạch đề xuất; chưa sửa hoặc cài lại sản phẩm. Chỉ đánh dấu hoàn thành task khi có bằng chứng tương ứng. Phần có nguyên nhân chưa xác định là task điều tra có đầu ra cụ thể, không phải chỉ dẫn sửa theo phỏng đoán.

## Global Constraints

- Chỉ AutoShort; giữ typed IPC, safeContainedPath, LICENSE/NOTICE và runtime/model SHA-256.
- Tempo **≤1.80x**, protected gap **0.50s**, kéo dài đoạn nguồn **≤60%**; không mất cue, lời, nghĩa hoặc thay source identity.
- Tổng ngân sách request/recovery/thời gian dịch tiếp tục tắt theo override. Không dùng một quota tổng mới để tránh giải quyết lỗi không tiến triển.
- Baseline chất lượng: cùng video/giọng/ngôn ngữ/ROI, OCR accurate **8 Hz**, STTN; không tự giảm độ phân giải hoặc thay STTN bằng blur.
- Ban đầu giữ **1 item**, **1 local-gpu-heavy lease**, **1 server-inference lease**, `prefetchTts=false`.
- Journal không lưu credential/header/cookie/audio buffer. Config fingerprint phải whitelist dữ liệu ảnh hưởng kết quả và bỏ secrets; khi resume lấy credential từ cơ chế bảo mật hiện có.
- Dữ liệu cũ/dirty của người dùng giữ nguyên. Khi bắt đầu implement, dùng worktree `codex/…` nếu cần cô lập; không cài ghi đè Win Local trước khi qua release gate.
- Source lập kế hoạch tại HEAD `7e2b93e`, package 0.1.25. Audit phiên trước ghi source 0.1.24 và installed 0.1.23/hash `AB7491CA5001F6516F7158651A59B68F828E1C0487FA876300048AB290A5BC0E`. Hash/version installed là baseline đã đo của phiên trước, phải xác minh lại trước khi implement/deploy; không gán HEAD hiện tại cho snapshot cũ.

## Trình tự và kết quả cần đạt

| Thứ tự | Công việc | Điều kiện qua |
|---|---|---|
| P0.1 | Sửa raw/stabilized OCR → STTN | 13/13 fixture hợp lệ đi qua, gap giả vẫn bị chặn |
| P0.2 | Giữ log, đo request/stage/encoder | Đóng app không mất log; cancel và timeout phân biệt được |
| P1.1 | Queue journal + resume + receipt | 1.000 item giả lập qua; restart không tạo output trùng |
| P1.2 | Replay và sửa voice/tempo/Chatterbox | Có proof cho từng lỗi; không retry mù và không mất lời |
| P2.1 | Sửa render fallback theo graph thật | Biết chính xác vì sao dùng CPU; GPU nếu hợp lệ, fallback có chứng cứ |
| P2.2 | Tách phụ thuộc separation, cache STTN | TTS không chờ stem khi không cần; retry tái sử dụng đúng artifact |
| P2.3 | Benchmark prefetch/concurrency/STTN | Chỉ nhận thay đổi có tốc độ tăng và chất lượng/tài nguyên đạt |
| P3 | Nghiệm thu 90 video, soak và bản cài | Ít nhất 86/90 thành phẩm hợp lệ; không treo/mất trạng thái |

P0.1/P0.2 là bản sửa đầu tiên có thể phát hành độc lập sau smoke. P1 tạo năng lực chạy batch có phục hồi. P2 được thử từng biến sau khi P0/P1 ổn định. P3 là bằng chứng phát hành, không thay bằng unit tests.

## Task 1 — Hợp đồng OCR đã ổn định

**Files**
- Modify: `src/shared/ocrVisualTimeline.ts`, `src/main/inpainting/runner.ts`, `src/main/autoShortItemCoordinator.ts` (cache-read), `src/main/ocr.ts` nếu cần làm rõ raw/result boundary.
- Test: `tests/ocr-visual-timeline.test.ts`, `tests/sttn-contract.test.ts`, `tests/sttn-pipeline.test.ts`, `tests/autoshort-stage-cache.test.ts`.
- Create: `tests/fixtures/ocr-stabilized-gap/` chứa 13 fixture thu nhỏ đủ láng giềng và geometry; không copy toàn video/cache cá nhân vào repository.
- Docs: cập nhật ADR 006 và bản ghi `.ai/tasks/TASK-YYYYMMDD-autoshort-stabilized-ocr.md`.

**Interfaces đề xuất**

```ts
// Giữ API cũ nghiêm ngặt cho raw provider output.
validateOcrVisualTimeline(raw: unknown, expected: ExpectedOcrTimelineGeometry): OcrVisualTimeline
// API mới cho kết quả nội bộ hoặc cache đã stabilize.
validateStabilizedOcrVisualTimeline(raw: unknown, expected: ExpectedOcrTimelineGeometry): OcrVisualTimeline
```

- [ ] Trích fixture theo `gap-replay.json`; giữ raw neighbor ID, frame, text, box, confidence và gap tương ứng. Kiểm tra hash nguồn trước khi trích; bản gốc chỉ đọc.
- [ ] Thêm test red trong `ocr-visual-timeline.test.ts`, dùng `validTimeline` và `EXPECTED` đang có:

```ts
test('stabilized timeline crosses STTN boundary; raw endpoint stays strict', () => {
  const raw = validTimeline()
  raw.segments.push({ ...structuredClone(raw.segments[0]),
    id: 'accurate-4', startFrame: 4, endFrameExclusive: 5,
    start: 0.5, end: 0.625 })
  const derived = stabilizeSingleSampleGaps(validateOcrVisualTimeline(raw, EXPECTED))
  assert.ok(derived.segments.some(s => s.id.startsWith('gap-')))
  assert.throws(() => validateOcrVisualTimeline(derived, EXPECTED), /gap-/)
  assert.deepEqual(validateStabilizedOcrVisualTimeline(derived, EXPECTED), derived)
  const forged = structuredClone(derived)
  forged.segments.find(s => s.id.startsWith('gap-'))!.boxes[0].x1 += 1
  assert.throws(() => validateStabilizedOcrVisualTimeline(forged, EXPECTED))
})
```

- [ ] Chạy test red. Cài validator: parse shape có giới hạn trước; lấy raw segment trong bản sao; raw-validate đầy đủ; tái chạy stabilizer; so sánh **từng trường canonical** của toàn timeline với input. Có gap bị thêm, thiếu, sửa text/box/confidence/frame đều reject. Không dùng cast type như một phép validation, không trả lại object raw chưa chuẩn hóa.
- [ ] Dùng validator mới ở STTN và cached stabilized timeline. Sửa tests pipeline đang mock `removeSubtitles` bỏ qua validator: thêm ít nhất một case đi qua runner thật với engine command stub để chứng minh boundary được kiểm tra.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs ocr-visual-timeline.test`, `sttn-contract.test`, `sttn-pipeline.test`, `autoshort-stage-cache.test` riêng từng lệnh.
- [ ] Replay đủ 13 fixture trên source mới. Script audit cũ có mục đích **reproduce old defect**, không sửa expected của script đó để làm mất chứng cứ cũ; tạo verifier sau sửa riêng.
- [ ] Kiểm tra hủy/output containment không thay đổi; typecheck, cập nhật tài liệu, commit giới hạn task.

**Gate:** Raw provider vẫn không được inject gap; 13 stabilized fixture hợp lệ qua runner; test sai geometry/provenance vẫn fail đúng.

## Task 2 — Log bền vững và telemetry đủ để quy nguyên nhân

**Files**
- Modify: `src/main/logger.ts`, `src/main/index.ts`, `src/main/autoShortTelemetry.ts`, `src/main/autoShortItemCoordinator.ts`, `src/main/burn.ts`, `src/main/tts.ts`, `src/main/autoshort.ts`, `src/shared/types.ts`.
- Create: `src/main/logRetention.ts` để tách logic rotation khỏi Electron; `tests/log-retention.test.ts`.
- Test: `tests/autoshort-telemetry.test.ts`; đăng ký test mới tại `scripts/run-local-runtime-tests.mjs`.

**Interfaces đề xuất**

```ts
export type FailureKind = 'cancelled' | 'timeout' | 'transport' | 'provider' | 'content' | 'unknown'
export function classifyFailure(input: {
  aborted: boolean; timeoutTriggered: boolean; transportCode?: string;
  httpStatus?: number; providerCode?: string; contentFailure?: boolean
}): FailureKind
export function pruneSessionLogs(input: {
  rootDir: string; activeFiles: readonly string[];
  nowMs: number; maxAgeMs: number; maxBytes: number
}): Promise<{ removedFiles: number; removedBytes: number }>
```

- [ ] Red tests: session file còn sau shutdown; active log không bị xóa bởi rotation; hết quota giảm chi tiết/đặt incomplete; `AbortError` do user cancel không thành timeout; timeout thật có flag riêng; secrets không xuất hiện ở log.
- [ ] Test phân loại tối thiểu:

```ts
assert.equal(classifyFailure({ aborted: true, timeoutTriggered: false }), 'cancelled')
assert.equal(classifyFailure({ aborted: false, timeoutTriggered: true }), 'timeout')
assert.equal(classifyFailure({ aborted: false, timeoutTriggered: false,
  providerCode: 'chatterbox_generation_failed' }), 'provider')
```

- [ ] Bỏ `wipeLogFileSync()` khỏi quit flow; chờ runtime dừng rồi flush log; chỉ thao tác Clear do người dùng mới xóa log theo semantics công khai. Lưu session cũ theo ID, giữ API mở log đang dùng tương thích. Rotation 7 ngày/100 MiB là default **đề xuất**, constants có test.
- [ ] Thêm stage separation, retime, metadata, artifact-copy. Request telemetry ghi queue/start/first-response/end, status/retry/reason; không log body chứa secrets. Async overlap phải giữ parent/child span, không cộng thời gian chồng vào wall time.
- [ ] Ghi mỗi encoder attempt: codec, result, elapsed, exit code, filtered diagnostic, selected encoder; lưu ở audit cuối video. Engine provider phải lấy từ response/probe thực, không gán requested thành effective.
- [ ] Chạy `log-retention.test`, `autoshort-telemetry.test`, typecheck; kiểm tra mở/đóng app trong profile thử không mất log.
- [ ] Cập nhật tài liệu và commit task.

**Gate:** Từ một job lỗi có thể phân biệt thời gian chờ lease, server, DSP và render; shutdown không mất bằng chứng.

## Task 3 — Durable batch journal và tiếp tục phần chưa xong

**Files**
- Create: `src/shared/autoShortBatchJournal.ts` (types/pure validation), `src/main/autoShortBatchStore.ts` (contained/atomic persistence), `tests/autoshort-batch-store.test.ts`, `tests/autoshort-batch-resume.test.ts`.
- Modify: `src/main/autoshort.ts`, `src/main/autoShortQueueRunner.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/src/components/AutoShort.tsx`.
- Test: `tests/autoshort-queue-throughput.test.ts`, `tests/autoshort-resource-lifecycle.test.ts`; đăng ký suites mới.

**Interfaces đề xuất, chưa phải API đã tồn tại**

```ts
export type BatchItemState = 'pending' | 'running' | 'succeeded' |
  'failed' | 'needs-review' | 'interrupted' | 'cancelled'
export interface BatchItemRecord {
  itemId: string; inputPath: string; inputDigest: string; configDigest: string;
  ordinal: number; attempt: number; state: BatchItemState;
  checkpointId?: string; outputReceipt?: {
    path: string; sha256: string; bytes: number; durationSeconds: number
  };
  failure?: { code: string; message: string; recoverable: boolean }
}
export interface BatchSnapshot {
  schemaVersion: 1; jobId: string; revision: number;
  createdAtUtc: string; updatedAtUtc: string; items: BatchItemRecord[]
}
export function recoverInterruptedBatch(snapshot: BatchSnapshot): BatchSnapshot
export function resumeCandidateIds(snapshot: BatchSnapshot): string[]
// Main store serializes writes and rejects stale revision.
export interface AutoShortBatchStore {
  load(jobId: string): Promise<BatchSnapshot | null>
  save(snapshot: BatchSnapshot, expectedRevision: number | null): Promise<void>
}
// Add signatures to existing typed preload/API, no raw renderer IPC.
autoShortGetBatch(jobId?: string): Promise<BatchSnapshot | null>
autoShortResumeBatch(input: { jobId: string; expectedRevision: number;
  config: AutoShortConfig }): Promise<AutoShortStartResult>
```

- [ ] Pure tests thể hiện quy tắc, dùng fixture thật trong suite:

```ts
const states: BatchItemState[] = ['succeeded', 'running', 'pending', 'failed', 'needs-review']
const snapshot: BatchSnapshot = {
  schemaVersion: 1, jobId: 'batch-1', revision: 1,
  createdAtUtc: '2026-09-12T00:00:00Z', updatedAtUtc: '2026-09-12T00:00:00Z',
  items: states.map((state, i) => ({ itemId: `item-${i}`, inputPath: `input-${i}.mp4`,
    inputDigest: 'a'.repeat(64), configDigest: 'b'.repeat(64),
    ordinal: i, attempt: 1, state }))
}
const recovered = recoverInterruptedBatch(snapshot)
assert.equal(recovered.items[1].state, 'interrupted')
assert.deepEqual(resumeCandidateIds(recovered), ['item-1', 'item-2'])
assert.equal(snapshot.items[1].state, 'running') // Không mutate source snapshot.
```

- [ ] Store: validate job ID thành safe segment; snapshot/tmp/backup chỉ dưới root riêng; atomic rename cùng volume và hàng ghi serialized. Kiểm tra revision, schema, path containment trước read/write; trường hợp thiếu lần ghi cuối đọc snapshot trước có checksum hợp lệ. Không dùng user-supplied jobId để ghép path trực tiếp.
- [ ] Fault tests: process ngắt trước/sau rename; stale write; JSON bị cắt; symlink/junction thoát root; migration version không hỗ trợ; snapshot credential injection bị loại.
- [ ] Reconcile output: receipt chỉ ghi sau file final validate; trường hợp crash sau promote file nhưng trước journal commit phải reconcile bằng completion manifest chứa source/config digest và output hash. File tồn tại cùng tên chưa đủ để skip. Không đủ evidence thì giữ file nguyên, báo cần review; không tự ghi đè/đếm succeeded.
- [ ] Integrate queue: persist pending trước chạy, running trước gọi engine, terminal trước phát terminal UI; không tạo hai active jobs. Renderer lấy snapshot Main khi reconnect, subscribe và loại stale event bằng jobId/revision. App restart không tự chạy AI; nút Tiếp tục chỉ chạy pending/interrupted đã qua kiểm tra input/config.
- [ ] Import 90 task cũ bằng ID/path: đối chiếu receipt/audit/fingerprint; không tin 89 nhãn queued cũ để chạy lại video đã xong. Vì audit cũ có thể thiếu config digest, đánh dấu legacy completion evidence cần xác nhận reuse thay vì bịa fingerprint. Một lần reconcile được lưu vào journal, giữ localStorage cũ để rollback.
- [ ] Queue 1.000 item giả lập lỗi ở item 17/31/501: các item còn lại kết thúc; thứ tự hiển thị nguyên; terminal/receipt không lặp. Cancel với engine còn chạy: chưa thả lease trước exit. Restart/resume không chạy succeeded lại, retry lỗi cần thao tác rõ ràng.
- [ ] Chạy `autoshort-batch-store.test`, `autoshort-batch-resume.test`, `autoshort-queue-throughput.test`, `autoshort-resource-lifecycle.test`, typecheck; test UI reconnect/close-reopen ở profile thử.
- [ ] Cập nhật docs/architecture.md đúng source-of-truth Main; commit task.

**Gate:** Không mất queue sau restart; không chạy trùng; missing/changed input hoặc receipt hỏng không bị skip nhầm; không lưu secrets.

## Task 4 — Dubbing overflow, calibration và lỗi provider

**Files**
- Inspect/modify theo nguyên nhân đã replay: `src/main/dubbing/synthesis.ts`, `src/main/dubbing/plan.ts`, `src/main/semanticGrouping.ts`, `src/main/dubbing/translation.ts`, `src/main/autoshort.ts`, `src/main/tts.ts`, `src/main/translation/`.
- Test: `tests/dubbing-plan.test.ts`, `tests/dubbing-grouping.test.ts`, `tests/autoshort-tts-pipeline.test.ts`, `tests/autoshort-tts-cache.test.ts`.
- Create: `.ai/tasks/autoshort-voice-recovery-evidence/` (evidence cục bộ), fixtures thu nhỏ trong tests sau khi biết nguyên nhân.

- [ ] Thu đủ bảng cho 5 overflow: source cue IDs/text/times, translated group, candidate giữ/bỏ và lý do, raw PCM/trim duration, slot start/deadline, tempo request/actual, required extension. Bắt đầu từ item IDs trong metrics.json; dùng request capture của Task 2 nếu phải tái thu dữ liệu còn thiếu.
- [ ] Với lỗi 1.808x: replay cùng PCM từ cache vào `applyTempo`; ghi target/actual mỗi calibration. Test so tempo thực và deadline, không chỉ so tham số FFmpeg.
- [ ] Các assertion bắt buộc trong test tích hợp sau sửa:

```ts
// Bind to actual fixture measurements returned by production synthesis/DSP.
assert.ok(measuredNaturalSeconds / measuredFinalSeconds <= 1.80)
assert.ok(voiceEndSeconds <= deadlineSeconds + timingToleranceSeconds)
assert.deepEqual(finalSourceCueIds, expectedSourceCueIds)
assert.equal(contentDropped, false)
```

Các biến trên là đầu ra fixture bắt buộc thu ở bước đầu; không dùng duration mock để tuyên bố audio thật đã fit. Nếu fixture vẫn không fit một cách hợp lệ thì test phải xác nhận error có code và queue tiếp tục, không ép success.

- [ ] Khi xác nhận mapping/grouping sai, viết red test từ đúng boundary, sửa upstream rồi đo TTS lại. Khi candidate không bảo toàn tên/số/phủ định/ý, loại candidate; không nối whole-script theo vị trí. Không thêm vòng gọi model nếu input/response không có tiến triển.
- [ ] Chatterbox: lấy request ID/timestamp/HTTP status từ client rồi log server nếu có quyền truy cập. Có server stack thì sửa nguyên nhân; không có thì giữ UNKNOWN và task evidence mở, không giả định retry chữa được generation_failed. Transport recovery giữ chính sách hiện hành; auth/model config lỗi chung đưa batch sang trạng thái cần xử lý.
- [ ] Run các test trên và `npm.cmd run typecheck`; benchmark lại các fixture có voice để chứng minh không tăng request vô ích. Cập nhật ADR 005 chỉ về cơ chế đã chứng minh; không sửa giới hạn.
- [ ] Commit từng root-cause fix riêng; evidence thiếu được ghi rõ và giữ gate tương ứng chưa đạt.

**Gate:** Không còn lỗi implementation tái diễn trên fixtures đã sửa; không có silent drop hoặc vượt policy. Content/provider case chưa giải quyết không được gắn nhãn fixed.

## Task 5 — Điều tra và sửa đường encode CPU fallback

**Files**
- Inspect/modify: `src/main/burn.ts`, `src/main/autoShortItemCoordinator.ts`, `src/main/dubbing/retimeMedia.ts`.
- Test: `tests/autoshort-ocr-burn.test.ts`, `tests/burn-video-title.test.ts`; create `tests/autoshort-encoder-selection.test.ts` nếu cần tách contract encoder.
- Evidence: `.ai/tasks/autoshort-encoder-benchmark/`.

- [ ] Tái dùng tối thiểu 3 video thành công baseline gồm video chậm nhất; dựng graph thật với ASS/geometry/retime/âm thanh. Ghi cả encoder attempts từ Task 2, không chỉ chạy color test.
- [ ] Chốt failure thuộc options/format/graph/hardware/resource nào bằng stderr và reproduction. Nếu không reproduce, lưu trạng thái chưa xác định và benchmark không thay đổi code.
- [ ] Sau khi có root cause, red test đúng graph/options boundary. Contract phải giữ fallback và báo selected codec:

```ts
// Test adapter records real decision sequence from injected command outcomes.
assert.deepEqual(attemptedCodecs, ['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264'])
assert.equal(selectedCodec, 'libx264')
assert.equal(validatedOutputExists, true)
assert.ok(attemptDiagnostics.every(x => !x.includes(secretSentinel)))
```

- [ ] Sửa nhỏ đúng nguyên nhân; test GPU success không chạy fallback; cancel không đi thử codec kế tiếp; output lỗi không publish. Nếu cache negative capability, key theo binary hash/driver/codec và không coi lỗi graph một video là GPU unavailable toàn phiên.
- [ ] So sánh metadata, full decode errors, ASS visibility và A/V sync; kiểm tra chất lượng hình vùng chữ và phần chuyển cảnh. GPU encode nhanh hơn nhưng chất lượng không đạt thì chưa bật.
- [ ] Run targeted suites/typecheck, commit root-cause fix và bảng benchmark.

**Gate:** Mỗi output biết codec và lý do fallback; chỉ tuyên bố GPU hiệu quả khi graph đầy đủ tạo video hợp lệ.

## Task 6 — Separation độc lập và cache STTN khi retry

**Files**
- Modify: `src/main/autoShortItemCoordinator.ts`, `src/main/autoShortArtifactCache.ts`, `src/main/autoShortDiskBudget.ts` nếu accounting chưa bao phủ artifact mới.
- Test: `tests/autoshort-resource-lifecycle.test.ts`, `tests/autoshort-stage-cache.test.ts`, `tests/autoshort-artifact-cache.test.ts`, `tests/sttn-pipeline.test.ts`.
- Docs: architecture + cache invalidation table.

- [ ] Red concurrency test bằng deferred promises: giữ separation chưa resolve nhưng TTS phải bắt đầu; mix chưa bắt đầu cho tới khi cả narration/stem ready. Không dùng sleep để đo logic scheduling.

```ts
// Trace is captured from coordinator dependency hooks controlled by deferred promises.
assert.ok(trace.indexOf('tts-start') < trace.indexOf('separation-end'))
assert.ok(trace.indexOf('mix-start') > trace.indexOf('separation-end'))
assert.ok(trace.indexOf('mix-start') > trace.indexOf('tts-end'))
assert.equal(peakGpuLeases, 1)
assert.equal(orphanChildCount, 0)
```

- [ ] Tách separation thành scoped branch, ghi checkpoint stem sau validate; join tại audio mix. Failure policy vẫn bảo toàn mode separate-vocals, không tự bỏ nhạc nền. Scope abort/drain bảo đảm không giải phóng GPU sớm.
- [ ] STTN cache key: input digest + validated canonical timeline digest + geometry + engine version/fingerprint + model SHA-256 + run options ảnh hưởng output. Chỉ cache success validated; acquire ArtifactLease tới khi retime/render không còn đọc. Giữ quota default 2 GiB của ArtifactCache, không tăng ngầm.
- [ ] Tests: cùng key retry chỉ chạy engine một lần; đổi input/ROI/model/version invalidates; artifact corrupt thành miss; cancel put không lưu half-file; prune không xóa leased file; file vượt quota vẫn cho job tiếp tục không cache.
- [ ] Ghi dung lượng scratch/audit/cache theo item và job; không copy thêm video/WAV để cache khi vượt budget. STTN cache chỉ là cơ hội tiết kiệm retry; không đặt KPI first-run dựa trên cache hit.
- [ ] Chạy các suite trên/typecheck, benchmark cùng một video fail-then-resume và video cold để tách lợi ích; cập nhật docs và commit task.

**Gate:** TTS không bị giữ bởi phụ thuộc stem không cần thiết; GPU không oversubscribe; resume chỉ reuse khi digest đúng.

## Task 7 — Chọn tối ưu qua thí nghiệm từng biến

**Files**
- Inspect/modify nếu kết quả ủng hộ: `src/main/autoShortExecutionPolicy.ts`, `src/main/autoShortResourceManager.ts`, `src/main/dubbing/synthesis.ts`, `src/main/inpainting/runner.ts`, `engines/sttn-engine/` (đọc AGENTS.md trước thay engine).
- Test: `tests/autoshort-queue-throughput.test.ts`, `tests/autoshort-resource-manager.test.ts`, `tests/autoshort-resource-lifecycle.test.ts`, `tests/autoshort-tts-pipeline.test.ts`.
- Create: `scripts/benchmark-autoshort-batch.mjs` ở implementation, đọc batch manifest chỉ định, ghi raw measurements và report; không mặc định chạy profile sản phẩm hoặc tất cả 90 video.

- [ ] Manifest benchmark gồm IDs/hash của đúng 15 nguồn baseline, version/config/model/voice, cache mode, output root riêng. Credentials truyền qua cơ chế hiện có, không persist trong manifest.
- [ ] Thu 3 lượt mỗi cấu hình trên tập 5 video đại diện trước; khi chọn được cấu hình tốt chạy cả 15. So sánh cùng output quality/cold-warm cache, xen kẽ thứ tự A/B để giảm ảnh hưởng tải server/nhiệt độ.
- [ ] Thử riêng: A bản sửa ổn định; B thêm prefetch một nhóm; C maxActiveItems=2 nhưng GPU capacity=1; D admission cho resource-disjoint requests nếu đo được head-of-line blocking. Không bật B+C+D cùng lúc rồi không biết biến nào có lợi.
- [ ] Với D, giữ thứ tự các waiter cạnh tranh cùng resource, chỉ vượt request chờ nếu tập tài nguyên không giao nhau; bảo đảm starvation không xảy ra trong fixture finite queue. Giữ server inference capacity=1 cho đến khi server năng lực và benchmark có bằng chứng khác.
- [ ] Tách thời gian STTN load/decode/infer/encode. Chỉ làm persistent worker nếu load model là chi phí đáng kể; test worker reset/cancel/model switch/memory trước khi giữ lâu. Không thay sampling/ROI/window/resolution trong experiment bảo toàn chất lượng.
- [ ] Tiêu chí nhận mỗi tối ưu: median valid-output throughput tăng ≥10% trên cùng tập test nhỏ, không có regression correctness, P95 không xấu quá 10%, không OOM/orphan, không tăng unbounded RAM/disk, request bị prefetch bỏ được đo rõ. Đây là ngưỡng lựa chọn đề xuất, không cam kết hiệu quả.
- [ ] Cuối cùng mục tiêu ≥25% giảm wall time trên 15 baseline so với bản sửa ổn định, và báo riêng so với phiên lỗi cũ. Nếu không đạt, giữ cấu hình tốt nhất đã đo và ghi mục tiêu chưa đạt; không hạ chất lượng để đổi số liệu.
- [ ] Chạy tests phù hợp đúng thay đổi, typecheck và engine tests nếu sửa Python; commit từng tối ưu được chấp nhận, giữ feature flags có rollback.

**Gate:** Không bật mặc định tùy chọn không có lợi ích đã đo.

## Task 8 — Nghiệm thu dài hạn và Win Local

**Files**
- Test: suites liên quan phía trên; toàn bộ runtime trước đóng gói.
- Docs/evidence: `.ai/tasks/autoshort-batch-acceptance/`, bản ghi bàn giao theo `.ai/tasks/TASK_TEMPLATE.md`.
- Package tools: `package.json`, scripts release hiện có; không sửa release tooling nếu không có lỗi thuộc scope.

- [ ] Freeze commit/config/input manifest; giữ 15 output cũ; output thử trong root riêng. Import queue 90 với quy tắc receipt của Task 3. Không lấy 15 thành phẩm cũ vào numerator của lượt benchmark cold mới.
- [ ] Tăng lô: 5 video smoke → 20 video gồm 13 gap và 6 voice cases (loại trùng input) → 90 video. Nhóm fixture có thể overlap; manifest ghi unique input ID để không đếm sai.
- [ ] Chạy soak ít nhất 12 giờ; nếu 90 video lâu hơn thì chạy đến terminal toàn bộ. Trong một lượt riêng, thử restart tại OCR/TTS/STTN/render/publish để verify resume và reconcile; không trộn lượt fault-injection vào số throughput bình thường.
- [ ] Checklist: 90/90 có outcome rõ, ≥86/90 hợp lệ khi provider/input khỏe; không gap-contract defect, không silent drop/tempo vượt policy; 0 output trùng do resume; 0 orphan; scratch đã dọn hoặc có durable owner/quota; review log khi job chậm/no-progress.
- [ ] Phân loại lỗi còn lại, không loại input khỏi mẫu để đạt KPI. Provider outage phải được báo riêng nhưng vẫn có kết quả queue đúng; chất lượng content còn lỗi giữ release gate mở.
- [ ] Decode tất cả output; kiểm tra timeline/EOF/audio completeness bằng validator; xem/nghe các đoạn overflow, gap, phụ đề, chuyển cảnh, đầu/cuối của mỗi output. Các case sửa voice cần đối chiếu nghĩa nguồn/đích, không chỉ đo bytes/duration.
- [ ] Chạy tuần tự các lệnh phát hành:

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime
npm.cmd run test:subtitles
npm.cmd run fonts:verify
npm.cmd run package:win
npm.cmd run release:verify-assets
```

- [ ] Nếu sửa engine, chạy Python suite của engine và checksum/probe package tương ứng. Build/test failures không liên quan phải được báo và giải quyết release gate, không ghi “toàn bộ pass”.
- [ ] Cài gói khi đã được yêu cầu triển khai Win Local và không còn active job; giữ installer rollback, profile và engines. So sánh installed app.asar với package hash, khởi động và xác nhận process/version/profile.
- [ ] Smoke bản cài với ít nhất một case gap, voice recovery và resume. Ghi rõ dev, packaged smoke và full batch nào đã chạy trên build nào; không dùng full batch dev để tuyên bố full batch installed đã pass.

**Gate:** Bằng chứng thực đủ trước khi gọi là “chạy hàng loạt ổn định”.

## Handoff

Thực hiện từ Task 1 → Task 2. Task 3 là điều kiện để chạy đêm và resume an toàn. Task 4/5 có phần điều tra bắt buộc vì audit chưa xác định root cause; không suy diễn implementation. Task 6/7 chỉ bật sau regression và benchmark. Task 8 chốt bản phát hành.

Kế hoạch này hoàn thành khi tài liệu được bàn giao; triển khai, benchmark dài và cài bản mới là các công việc tiếp theo, hiện chưa thực hiện.

## Kiểm tra kế hoạch trước bàn giao

- Spec A → Task 1; B → Task 2; C → Task 3; D → Task 4; E → Task 6/7; F → Task 5/7; nghiệm thu/rollback → Task 8.
- Các API journal/failure/validator mới được ghi là đề xuất, không trình bày như đã có trong source.
- Mọi task điều tra có output và gate; lỗi server/voice chưa xác định không có fix giả định.
- Không có bước giảm chất lượng, nới trần tempo hoặc quota tổng mới để đạt KPI.
- Typecheck chạy lại khi bàn giao kế hoạch: PASS node/web, exit 0, package 0.1.25. Chỉ chỉnh tài liệu nên không chạy lại runtime suite; không coi typecheck là proof các tính năng đề xuất đã chạy.
