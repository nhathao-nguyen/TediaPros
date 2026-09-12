# AutoShort Cut Repair B — Frame and Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Có frame boundaries thật, lịch hình/sample chung, prepared media đúng fidelity, tài nguyên có giới hạn và cache ổn định.

**Architecture:** Probe/index bằng runtime quản lý, biên dịch rational plan từ nguồn; chuẩn bị theo plan qua graph file/chunks với lease. Validate independent decoded sequence/PCM, checksum artifact và semantic key tách riêng.

**Tech Stack:** TypeScript/BigInt rational, managed FFmpeg/FFprobe, Node stream/process, existing resource/disk/cache managers.

**Spec:** [Repair design](../specs/2026-09-12-autoshort-cut-repair-design.md), [master](2026-09-12-autoshort-cut-repair.md).

## Global Constraints

Kế thừa Global Constraints master. B01 sau A02; B02 sau B01; B03 sau B02; B04 sau B03. Không nới timeline/fidelity tolerance để pass. Không hardcode binary từ PATH nếu managed runtime chưa probe. Không gọi model/provider trong media fixtures. Ghi mọi probe codec/flag/capability và selection policy, không coi đề xuất codec là capability đã có.

## File map

| Create | Trách nhiệm |
|---|---|
| `src/main/autoShortFrameIndex.ts` | Index PTS/EOF trên disk, paging, exact decode/thumbnail và source ownership |
| `src/shared/autoShortCutPlan.ts` | Pure rational timeline, keep/join/sample schedule |
| `src/main/autoShortCutPreparation.ts` | Orchestrate resources, execution, validation/cache manifest |
| `src/main/autoShortCutValidation.ts` | Probe/decode/plan consistency, independent result checks |
| `scripts/generate-autoshort-cut-fixtures.mjs` | Seeded source frame payload, PCM markers, expected ledger |
| `tests/fixtures/autoshort-cut/manifest.json` | Small fixture descriptions/oracle policy; generated media ngoài Git |

Modify `autoShortCutMedia.ts` để chỉ xây/chạy graph từ validated plan; không để media parser, cache, quota và UI logic dồn vào file này.

## B01 — Frame index, audio epoch và capability probe

**Findings:** F01/F09/F12. **Files:** Create frame index/generator/manifest; Modify `autoShortCutContract.ts`, `types.ts`, `main/index.ts`, `preload/index.ts`; Test new `autoshort-frame-index.test.ts`, `autoshort-cut-fixtures.test.ts`.

**Interfaces:** probe/resolve/waveform APIs theo spec. `CutFrameIndex` là compiler view đã được Main xác thực, không phải full frame array truyền IPC:

```ts
export type CutFrameIndex = {
  identity: CutIdentity; frameCount: number
  videoEpoch: CutTime; sourceDuration: CutTime
  audio?: { sampleRate: number; channels: number; startRelativeToVideo: CutTime }
  validatedBoundaries: readonly FrameBoundary[] // requested endpoints + EOF, read from paged disk index
}
export function resolveFrameBoundary(
  orderedBoundaries: readonly FrameBoundary[], seconds: CutTime, videoEpoch: CutTime
): FrameBoundary
```

Full index lưu theo source hash/stream/probe policy trên disk có quota, không append vô hạn vào JS array. IPC page<=256 boundary entries, thumbnail window<=24 frames, waveform<=2048 bins; invalid limit/cursor/item/source trả lỗi, không silently cap response sai semantics. Waveform min/max envelope lấy retained/source window được yêu cầu và có no-audio outcome; không phải ASR.

- [ ] Viết fixture generator độc lập production compiler: frame payload gồm binary ordinal/checksum vùng luma an toàn compression, PCM impulses/frequency markers tại timestamp đã biết; manifest mô tả expected source boundaries. Tạo CFR24/25/30/60,fractional30000/1001,VFR durations khác nhau,longGOP/Bframes,nonzero/negative starts,1-frame/EOF,rotation/SAR,8/10-bit,no-audio,audio lead/lag,corruption gần seam. Không import production cut normalizer để tạo expected output.
- [ ] Viết tests resolve: nhập1.001s ở25fps→1.04s; hai đầu1.001/1.019 cùng boundary; end cuối→EOF; unknown/duplicate PTS không có deterministic mapping→CUT_FRAME_INDEX_UNSUPPORTED. Kiểm fractional bằng rational cross multiply, không `fps` average.

```ts
const boundaries = [0, 1, 2, 3].map(i => ({
  presentationIndex: i, ptsTicks: String(i),
  timeBase: { num: 1, den: 25 }, eof: i === 3
}))
assert.equal(resolveFrameBoundary(boundaries, { num: '1', den: '1000' }, { num: '0', den: '1' }).presentationIndex, 1)
assert.equal(resolveFrameBoundary(boundaries, { num: '3', den: '25' }, { num: '0', den: '1' }).eof, true)
```

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-frame-index.test autoshort-cut-fixtures.test`, lưu red; probe thực `ffmpeg -version`, `ffprobe -version`, supported muxer/encoder/sample/pixel formats và time-base behavior vào evidence B01. Không thêm network downloads để chạy probe.
- [ ] Implement streaming index và exact decode on-demand, keyframe seek→decode đến presentation boundary; decoder dependency trước start bị loại khỏi thumbnail/AI/output. Common source epoch lấy video frame đầu; audio start/video start cùng rational scale, không reset từng stream về0. Source changed trong hash/index→CUT_SOURCE_CHANGED.
- [ ] Initial probe không đòi digest chưa tồn tại; Main trả authoritative source/index identity. Request tiếp theo bắt buộc match. Thumbnails/media token scoped sender/item/request; cancel on switch/unmount, source path contained/approved, worker stop trước release lease. Index thiếu/chưa hoàn thành hiển thị progress và disable exact actions.
- [ ] Gate: actual decoded thumbnail ordinal đúng request, paging bounded, source mutation/missing file/junction/stale token/cancel, first/last/fractional/VFR test. Resource manager quota áp dụng index/waveform; `npm.cmd run typecheck` + suites pass. Commit `feat(autoshort): index exact presentation frame boundaries`.

## B02 — Compile một lịch hình và sample

**Findings:** F01/F11; Core R02/R03/R06/R10. **Files:** Create `autoShortCutPlan.ts`; Modify `autoShortTemporalEdit.ts` legacy adapter, `autoShortCutContract.ts`; Test new `autoshort-cut-plan.test.ts`.

**Interfaces:** `compileFrameCutPlan` theo spec; `CutExecutionPlan/CutKeepSegment` canonical definitions trong spec; pure helpers `sampleAt(time:CutTime,sampleRate:number):bigint`, `projectCutInterval(plan,start:CutTime,end:CutTime):{segmentId:string;sourceStart:CutTime;sourceEnd:CutTime;editedStart:CutTime;editedEnd:CutTime}[]`. Rational normalize/add/sub/compare exact, denominator>0 và overflow kiểm trước chuyển Number.

- [ ] Tests property/invariant: overlap/touch/order equivalent; deleted time→0 fragments; interval crossing two kept segments→2 fragments; keep IDs unique; all-delete/no-frame invalid; EOF exclusive. Reuse fixture endpoints B01, dùng expected literal index sequence độc lập.
- [ ] Regression review microcuts: mỗi input range snap hai đầu cùng boundary → CUT_INVALID_RANGE, không xóa audio. Audio starts0.5,keep `[0,2),[4,6)`→plan4s/192000 samples ở48k với0.5s initial silence. Many fractional boundaries round absolute cumulative positions, không cộng rounded length từng segment.

```ts
export function sampleAt(time: CutTime, sampleRate: number): bigint {
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new Error('CUT_INVALID_RANGE')
  const n = BigInt(time.num) * BigInt(sampleRate)
  const d = BigInt(time.den)
  if (d <= 0n) throw new Error('CUT_INVALID_RANGE')
  const sign = n < 0n ? -1n : 1n
  const abs = n < 0n ? -n : n
  return sign * ((2n * abs + d) / (2n * d)) // nearest, ties away from zero
}
assert.equal(sampleAt({ num: '1', den: '3' }, 48000), 16000n)
assert.equal(sampleAt({ num: '-1', den: '2' }, 48000), -24000n)
```

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-cut-plan.test autoshort-cut-v2-contract.test`; red phải bắt drift/no-frame/ID cases.
- [ ] Implement verify edit/source/index identity, kiểm endpoints trong validatedBoundaries, canonical union; giữ frame ordinal/time-base/duration cuối thật. `outputSampleStart=sampleAt(editedStart)`, `outputSampleEnd=sampleAt(editedEnd)`; source sample interval theo audio-relative epoch. Phần thiếu audio tại head/tail source biểu diễn explicit silence, không kéo sample sang sớm. Rounding residual tối đa lượng tử sample được ghi schedule, không pad narration để vá drift.
- [ ] Compile joins theo adjacent keep IDs; source interval projection half-open, không envelope che deleted gaps. No-edit trả identity fast path; không graph/copy mới. Shared không có filesystem/crypto; edit/executor hashes được Main đưa vào sau canonical validation.
- [ ] Gate: >=1000 deterministic seed interval/property cases, signed offsets/fractional/VFR/EOF, unique keep IDs/equivalent ranges; suites+typecheck. Commit `fix(autoshort): compile linked frame and audio cut schedules`.

## B03 — Executor bounded, giữ fidelity và bảo vệ volume thật

**Findings:** F05/F08/F09/F01. **Files:** Create `autoShortCutPreparation.ts`; Modify `autoShortCutMedia.ts`, `autoShortDiskBudget.ts`, `autoShortResourceManager.ts`, `autoShortItemScope.ts`, `autoShortItemCoordinator.ts`, `autoshort.ts`, process wrapper nếu cần context error; Test `autoshort-cut-media.test.ts`, new `autoshort-cut-resources.test.ts`.

**Interfaces:** `prepareCutSource` theo spec dùng injected runtime/resource/cache dependencies của factory Main, không tạo global scheduler khác. `buildCutChunks(plan:CutExecutionPlan,maxSegments:number):CutKeepSegment[][]`, `cutVolumeReservations({scratchVolume,outputVolume,cacheVolume,bytesByVolume})` được triển khai trong preparation (union cùng volume, không đếm trùng file đã ghi). Type `bytesByVolume:Record<string,number>`; return danh sách reservation ownership từ ledger hiện có.

- [ ] Convert hai string-only tests hiện tại thành real media tests từ B01/B02; assert prepared video frame payload/PTS,PCM marker và output sample count. Giữ vài filter unit tests chỉ phục vụ syntax; không dùng thay acceptance.
- [ ] Viết resource tests fake volumes: C scratch thiếu,F output dư,maxActiveItems1 và2; process spy phải chưa spawn khi reserve fail. Cancel ở chunk thứ2,encoder fail,ENOSPC trong write→close child→cleanup→release ownership; item kế không chạy admission mù. Windows 1.000 ranges fixture phải spawn/decode thật.

```ts
export function buildCutChunks(plan: CutExecutionPlan, maxSegments: number): CutKeepSegment[][] {
  if (!Number.isSafeInteger(maxSegments) || maxSegments < 1 || maxSegments > 64) throw new Error('CUT_RESOURCE_LIMIT')
  const chunks: CutKeepSegment[][] = []
  for (let i = 0; i < plan.keepSegments.length; i += maxSegments) {
    chunks.push(plan.keepSegments.slice(i, i + maxSegments))
  }
  return chunks
}
```

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-cut-media.test autoshort-cut-resources.test autoshort-disk-budget.test autoshort-resource-lifecycle.test`, ghi red cho ENAMETOOLONG/8-bit/offset thiếu.
- [ ] Implement graph-file invocation theo flag được managed runtime B01 probe, không interpolated shell command/filter nhận từ UI. Giới hạn64 keep segments/chunk, một active preparation process/lease; join chunks bằng global schedule và bounded open inputs, không cộng reset timestamps trôi giữa chunks. Decode needed GOP dependencies nhưng select output frame ordinal của plan. Full-master file tạm có suffix incomplete, chỉ rename sau B04 validation.
- [ ] Chọn format bằng rule đo được: thử FFV1 lossless với pixel format nguồn được decoder/encoder hỗ trợ; preserve8/10-bit,chroma,range,primaries,transfer,matrix,rotation/SAR canonical policy. PCM preserve sample rate/channels/int16/int24 via int32/float32 theo nguồn; không ép s16 mọi nguồn. Container chọn từ probe NUT/Matroska với frame identity/time-base tolerance; cả hai không đạt→CUT_FRAME_INDEX_UNSUPPORTED/media capability error. Codec/policy/runtime digest đưa vào identity. Không tự tone-map HDR hoặc convert30fps.
- [ ] Reserve scratch/master/chunk/cache bytes trên volume thật, input compressed bytes chỉ là telemetry. Upper bound từ decoded frame bytes×retained frames + audio bytes + measured mux overhead và peak simultaneously alive artifacts; quá lớn→bounded staging hoặc CUT_RESOURCE_LIMIT trước model. Update remaining reservation khi ghi, không hạ safety margin chưa có evidence. Processing CPU lease trước FFmpeg; preview/index dùng cùng arbiter. Track child cho hủy cây tiến trình, contextual cut error có stderr redacted.
- [ ] Gate: Windows1000ranges không ENAMETOOLONG,peak RAM/process bounded,bit-depth probe/pixel oracle,nonzero starts,VFR,resource fault/cancel cleanup; suites+typecheck và `autoshort-item-scope.test`. Commit `fix(autoshort): bound cut preparation and preserve media fidelity`.

## B04 — Validate prepared media và cache semantic identity

**Findings:** F01/F07/F09; Core R01/R16/R17. **Create:** `autoShortCutValidation.ts`, `tests/autoshort-cut-validation.test.ts`, `tests/autoshort-cut-cache.test.ts`; **Modify:** `autoShortCutPreparation.ts`, `autoShortCutIdentity.ts`, `autoShortArtifactCache.ts`, `autoShortStageKeys.ts`, `autoShortItemCoordinator.ts`.

**Interfaces:** `validatePreparedCut(input:{sourcePath:string;preparedPath:string;plan:CutExecutionPlan;signal:AbortSignal}):Promise<{ok:true;artifactSha256:string}|{ok:false;code:string;details:string}>`; `preparationIdentityKey(identity)` exact spec. Extend `PreparedCutSource` with validated manifest only after success; same source/edit may differ artifact bytes but key stable.

- [ ] Tests semantic key same effective boundaries/order/undo content with different operation IDs/revision; changed boundary/runtime/format/geometry→miss; corrupted checksum→reject. Same real prepare twice must hit cache or produce equal semantic key despite different muxer bytes; no-cut keys/fingerprint remain legacy A03.

```ts
const identity: CutExecutionIdentity = {
  sourceDigest: 'a'.repeat(64), editDigest: 'b'.repeat(64),
  executorRevision: 'cut-executor-v2', runtimeDigest: 'c'.repeat(64), mediaPolicyDigest: 'd'.repeat(64)
}
assert.equal(preparationIdentityKey(identity), preparationIdentityKey({ ...identity }))
assert.notEqual(preparationIdentityKey(identity), preparationIdentityKey({ ...identity, runtimeDigest: 'e'.repeat(64) }))
```

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-cut-validation.test autoshort-cut-cache.test autoshort-stage-cache.test`; real fixture red gồm video6/audio5.91,offset missing,source mutation,valid container truncatedtail.
- [ ] Implement key từ canonical semantic identity, không checksum master làm sourceDigest downstream. Artifact manifest gồm semantic key,source/edit/policy/runtime,actual streams/frame count/start/end,sample count/chunks,checksum và validation revision. Put/cache promotion atomic sau validate; cache lease đang đọc không bị eviction; corruption miss→rebuild bounded, không loop retry không tiến triển.
- [ ] Production validator full decode để phát hiện stream hỏng/truncated, check actual schedule/framecount/PTS/samplecount và supported format policy; seam/EOF selection map phải khớp. Synthetic verifier độc lập dùng pixel/frame payload/PCM markers để kiểm không lọt frame bỏ. Không tuyên bố production tự hiểu semantic nội dung; errors CUT_TIMELINE_MISMATCH/CUT_FORBIDDEN_FRAME chặn downstream trước AI.
- [ ] Validate source hash/mutation trước prepare và trước publish; keep source digest memo scoped run, không dùng mtime/size làm content equality. Không tự nâng lower-bit artifact lên lossless label. Hook cleanup chuẩn: process close, artifact leases closed, scratch removed, reservation released; startup chỉ sweep owned manifest paths, không glob xóa temp người dùng.
- [ ] Gate: review probes chuyển từ thất bại thành expected outcomes; true warm retry recognition/translation không chạy lại do mux nondeterminism; quota/cache corruption/cancel suites+typecheck. Lưu raw measured JSON; commit `fix(autoshort): validate prepared cuts and stabilize cache identity`.

## Bàn giao B

`PreparedCutSource` có identity/plan/manifest đã validate, đủ thông tin để C01 tạo segment view có lease; chưa được bỏ cut guard P00. Audio/video correctness synthetic không chứng minh AI semantics hoặc GUI preview; C/Z gates vẫn bắt buộc. Media policies và unsupported reasons ghi vào spec/runtime notes từ phép đo, không dùng “lossless” cho cả nguồn chưa kiểm.
