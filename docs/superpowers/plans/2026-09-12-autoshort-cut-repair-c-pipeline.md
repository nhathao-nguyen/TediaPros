# AutoShort Cut Repair C — Pipeline and Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa segment/provenance qua AI và retime, review biên cắt, preview chính xác, publish/resume đúng cùng identity.

**Architecture:** Consumer xử lý từng retained segment liên tục và trả cue/mask có provenance. Mapping cut được compose một lần với dubbing map; source speech/replay, mask/subtitle và metadata theo output map. Preview và export dùng chung executor/identity.

**Tech Stack:** TypeScript, existing OCR/Whisper/STTN/separator/TTS adapters, FFmpeg, React typed IPC và Node integration tests.

**Spec:** [Repair design](../specs/2026-09-12-autoshort-cut-repair-design.md), [master](2026-09-12-autoshort-cut-repair.md), spec gốc mục7–10.

## Global Constraints

Kế thừa Global Constraints master. Đọc AGENTS của dubbing/inpainting/separation trước sửa. C01 sau A04/B04; C02 sau C01; C03 sau C02; C04 sau A05/B04/C01; C05 sau C02/C03/C04. Không claim live provider/real STTN bằng mock; không coi đọc lại edited file là đã giữ source provenance.

## File map

| Create | Trách nhiệm |
|---|---|
| `src/main/autoShortCutSegments.ts` | Leased segment views và projection consumer results |
| `src/shared/autoShortCutCues.ts` | Cue fragments, evidence/review states và resolution validation |
| `src/main/autoShortCutReview.ts` | Tạo evidence biên giữ, orchestration recognition/review |
| `src/shared/autoShortCutOutputMap.ts` | Compose cut/source/output intervals, owner provenance |
| `src/main/autoShortCutPreview.ts` | Request identity/cancel, join render qua production executor |
| `src/renderer/src/components/AutoShortCutReviewPanel.tsx` | Review cue/seam với reason/action cụ thể |
| `src/main/autoShortCutPublication.ts` | Final media/snapshot/subtitle validation và completion v2 |

## C01 — Segment-aware OCR/ASR/STTN

**Finding:** F06. **Files:** Create segments/cues modules; Modify `src/main/autoShortItemCoordinator.ts`, `src/main/ocr.ts`, `src/main/whisper.ts`, `src/shared/ocrVisualTimeline.ts`, `src/main/inpainting/runner.ts`, `src/main/autoShortCutPreparation.ts`. ASR hiện gọi `transcribeAudio` từ `./whisper`. **Tests:** new `tests/autoshort-cut-segments.test.ts`, `tests/autoshort-cut-visual.test.ts`, existing `tests/autoshort-ocr-pipeline.test.ts`.

**Interfaces:**

```ts
export type CutSegmentView = {
  segmentId: string; path: string; duration: CutTime
  sourceStart: FrameBoundary; sourceEnd: FrameBoundary; editedStart: CutTime
}
export function withCutSegment<T>(
  prepared: PreparedCutSource, segmentId: string, signal: AbortSignal,
  consume: (view: CutSegmentView) => Promise<T>
): Promise<T>
```

View materialize on demand/cache lease, release trong finally sau consumer/process close. Cues results trả CutDerivedCue; visual timeline result thêm segmentId/source boundary/edited shift và protocol revision adapter. Không thay raw/stabilized validator để fake accepted counts.

- [ ] Test coordinator thật với injected capture adapters: cut giữ hai segments phải gọi recognition/visual riêng từng segment, path và provenance đúng. Cue local 0,2s ở segment có editedStart=2s phải thành edited 2,2s, source span vẫn thuộc nguồn segment đó. No-cut vẫn gọi consumer một lần như baseline.
- [ ] Visual fixtures: box cùng vị trí nhưng text khác ở hai phía seam, đoạn một frame/đoạn ngắn, gap synthetic, rotation/SAR. Assert không merge/stabilize track qua seam; mask chuyển cứng đúng owner frame; retained frame count được kiểm từ metadata thật.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-cut-segments.test autoshort-cut-visual.test autoshort-ocr-pipeline.test sttn-contract.test`; red integration phải bắt missing segment calls của coordinator cũ.
- [ ] Implement adapter loop qua `prepared.plan.keepSegments`, dùng `withCutSegment` và existing resourceManager leases; map local timestamps bằng exact segment edited/source offset. Reset OCR stabilizer/STTN context per segment, không lấy deleted/GOP-dependency frame làm context. Branch outcomes drain như item scope hiện tại.

```ts
// Core call shape; recognition callback is injected by existing coordinator dependencies.
for (const segment of prepared.plan.keepSegments) {
  await withCutSegment(prepared, segment.segmentId, signal, async view => {
    const local = await recognizeSegment(view.path, signal)
    await persistSegmentEvidence(view, local)
  })
}
```

Trong module segments định nghĩa dependency interface `recognizeSegment(path:string,signal:AbortSignal):Promise<AlignedCue[]>` và `persistSegmentEvidence(view:CutSegmentView,cues:AlignedCue[]):Promise<void>`; coordinator cung cấp adapter actual OCR/ASR và owned evidence writer. Không thêm một provider implementation song song.

- [ ] Probe real STTN với đoạn 1 frame, 2 frames và đoạn ngắn; nếu engine cần minimum context, padding chỉ từ retained frames cùng segment và loại khỏi output theo map, phải có decoded evidence. Không đạt → CUT_BOUNDARY_DECODE_FAILED/capability reason; user có thể đổi mode sang blur qua new run, không silent fallback.
- [ ] Gate: scoped tests+typecheck; actual STTN/OCR fixture riêng với engine runtime ghi hash, nếu thiếu runtime ghi NOT_VERIFIED và giữ gate mở. Python suites nếu sửa engine. Commit `fix(autoshort): process temporal AI within retained segments`.

## C02 — Cue provenance và review nội dung ở biên

**Finding:** F06; Core R05/R07/R08. **Files:** Create `autoShortCutReview.ts`, review panel; Modify `autoShortCutCues.ts`, `autoShortItemCoordinator.ts`, `translation/sourceGroups.ts`, `translation/checkpoint.ts`, `AutoShort.tsx`, edit store/resolution types; Tests new `autoshort-cut-cues.test.ts`, `autoshort-cut-review.test.ts`.

**Interfaces:** `projectCutCues`, `assessCutCue`, `resolveCutCueReview`, CutDerivedCue/Issue/Resolution theo spec. `move-boundary` và `remove-whole-cue` tạo draft range transaction A02, không phải reviewResolution bypass. `remove-whole-cue` phải hiện vùng xóa thêm; `edit-retained-text` lưu user-edited evidence, `keep-intentional-cut` không tự đánh dấu semantic đúng.

- [ ] Test full-remove/full-keep/boundary/multiple-fragments; source ledger immutable. Partial cue không có word alignment→textProvenance unresolved và không copy full text sang mỗi fragment. Có word evidence đáng tin→chỉ lấy words nằm trong retained spans; boundary giao word→review. Với retained recognition mới, giữ evidence/source spans ngay cả khi sourceCueIds rỗng.
- [ ] Fixture phủ định/số/tên/đuôi âm: source transcript có “không”, bỏ vùng word đó; review phải chỉ ra fragment/evidence, không tự phục hồi text bị bỏ. Không có full-source transcript thì dùng retained voice/word-boundary evidence; không tự chạy full-source model để “chứng nhận nghĩa”. Speech chạm hard cut mà không có alignment đủ tin cậy→needs-review; seam im lặng/giữa cue rõ không bắt user duyệt vô ích.

```ts
const cue: CutDerivedCue = {
  id: 'fragment-1', segmentId: 'keep-1', sourceCueIds: ['source-1'],
  sourceSpans: [{ start: { num: '1', den: '1' }, end: { num: '2', den: '1' } }],
  start: 0, end: 1, text: '', textProvenance: 'unresolved',
  evidenceDigest: 'a'.repeat(64), review: 'required'
}
assert.equal(assessCutCue(cue, { partialWord: true, textReliable: false, intersectsRemoved: true }).length > 0, true)
```

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-cut-cues.test autoshort-cut-review.test translation-identity.test translation-resume.test autoshort-content-quality.test`, xác nhận red.
- [ ] Implement interval projection, stable derived IDs từ source spans/evidence/segment (không positional re-split script), resolution match editDigest+evidenceDigest+cueId+segmentId. Mismatch→CUT_STALE_REVISION và giữ nháp. Text sửa sanitize như dữ liệu, validation không cho empty fragment vào TTS nếu module cần text.
- [ ] Stage guard trước translation/TTS/SEO khi review required; needs-review không auto-retry cùng input. Original-audio-only/no-generated-text có intentional cut được chạy đúng lựa chọn; không ép tạo transcript chỉ để render. GUI play-loop source/retained evidence, action về boundary/cue cụ thể, không nút “bỏ qua tất cả lỗi kỹ thuật”.
- [ ] Dependency key translation gồm derived text/IDs,retained context,language/glossary,prompt/model/review policy. Không biết context dependency chính xác thì invalidate whole-item translation; TTS WAV vẫn reuse nếu text/voice/options khớp, timing luôn lập lại. Tests negative mutation cùng ID/khác context và equivalent edit/revision-only.
- [ ] Gate: source ledger unchanged,0 removed text trong captured final translation/TTS/SEO inputs,review resolution stale bị loại,no paid calls tự phát,suites+typecheck và review panel smoke. Commit `feat(autoshort): review cut cue boundaries with provenance`.

## C03 — Compose map TTS, replay, mix và mask

**Finding:** F01/F06; Core R09/R10/R11/R18. **Files:** Create `src/shared/autoShortCutOutputMap.ts`; Modify `src/main/dubbing/timeMap.ts`, `src/main/dubbing/retimeMedia.ts`, `src/main/dubbing/plan.ts`, `src/main/semanticGrouping.ts`, `src/main/translation/sourceGroups.ts`, `src/main/autoShortItemCoordinator.ts`, `src/main/autoShortNarratedAudio.ts`, `src/main/separation/pipeline.ts`, `src/main/separation/media.ts`; Tests new `tests/autoshort-cut-dubbing.test.ts`, existing `tests/dubbing-grouping.test.ts`, `tests/dubbing-retime.test.ts`, `tests/autoshort-publication-timeline.test.ts`.

**Interfaces:**

```ts
export type CutOutputMap = {
  outputDuration: number
  segments: {
    segmentId: string; ownerCueId?: string; mode: 'primary' | 'replay'
    sourceStart: CutTime; sourceEnd: CutTime; outputStart: number; outputEnd: number
  }[]
}
export function composeCutDubbingMap(plan: CutExecutionPlan, map: DubbingTimeMap): CutOutputMap
export function mapCutSourceToOutput(map: CutOutputMap, sourceStart: CutTime, sourceEnd: CutTime):
  { start: number; end: number; segmentId: string; mode: 'primary' | 'replay' }[]
```

`DubbingTimeMap.source*` đầu vào compose là **edited** time. Compose một lần, split primary segments tại joins; replay phải có ownerCue/segment nguyên vẹn. Source→output có thể 0/N spans; không clamp deleted point sang đoạn bên cạnh.

- [ ] Tests cue hai phía seam gần nhau không group/borrow; replay muốn đọc thêm hai frames ngược qua seam phải bị chặn. Segment một frame không đủ replay → recovery/limit error, không lấy frame đã bỏ. Assert tempo<=1.80, extension<=0.60×retained owner, slowdown<=0.20×retained owner, protected gap 0.50s theo EOF policy.
- [ ] Audio/media fixtures sau retime kiểm frame whitelist theo owner; source speech không lặp trong replay theo audio-mode policy; narration không lặp. Instrumental theo cùng cut/retime, BGM ngoài theo final duration. No-audio hoặc source audio off không tạo track giả khi không được yêu cầu. Giữ sample rounding toàn cục B02.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-cut-dubbing.test dubbing-grouping.test dubbing-retime.test autoshort-tts-pipeline.test autoshort-publication-timeline.test`; red cụ thể seam/owner violation.
- [ ] Implement hard boundaries ở source grouping/reflow trước gọi synthesis; map composition reject replay interval vượt owner retained segment. Replace fallback trong `retimeMedia.ts` đọc thêm hai frames bằng decode window nằm trong owner; nếu không đủ dữ liệu thì báo lỗi đúng cue, không dùng frame khác để bù.

```ts
// replay guard applied after locating owner in composed map
if (replayStart < ownerStart || replayEnd > ownerEnd || ownerStart >= ownerEnd) {
  throw new Error('CUT_FORBIDDEN_FRAME')
}
```

Các biến guard ở trên là rational comparisons đã quy về cùng time base, không floating-point source seconds. `composeCutDubbingMap` phải lưu rational source spans; adapter cuối sang FFmpeg mới serialize time expression sau kiểm precision.

- [ ] Final cues/word timings, ASS reveal/highlight và OCR/manual mask lấy output map/segment; hard seam không interpolate mask từ segment trước. Image adjustments, portrait và overlay giữ thứ tự composition hiện tại. Source ROI theo canonical display, không chuyển sang portrait canvas. Giữ tempo/recovery budget hiện hành; không tăng retries để che lỗi.
- [ ] Gate: decoded retained/replay whitelist, PCM và final marker sync sau codec delay, timing trong EOF, đủ audio modes gồm separate-vocals; suites + typecheck, `dubbing-plan.test autoshort-tts-cache.test separator-pipeline.test` theo module đã thay. Live voice/engine evidence riêng. Commit `fix(autoshort): keep dubbing retime within cut segment owners`.

## C04 — Exact join preview và tương tác frame

**Finding:** F12; hoàn tất F04/R12/R13. **Files:** Create `autoShortCutPreview.ts`, `tests/autoshort-cut-preview.test.ts`; Modify `AutoShortCutPanel.tsx`,`AutoShortCutTimeline.tsx`,`useAutoShortCutEditor.ts`,`AutoShort.tsx`, cut contract/typed APIs, `autoshort.ts` STTN preview adapter, smoke script.

**Interfaces:** preview/cancel API theo spec (target draft/applied tường minh). Frame step dùng B01 page/decoder. Preview result có `{identity:CutRequestIdentity;mediaToken:string;mode:'cut-only'|'sttn';durationSeconds:number;target:'draft'|'applied'}`; mediaToken scoped owner và validity, resolve qua existing safe media protocol, không tùy ý openPath từ Renderer.

- [ ] Test bỏ đầu 3s → STTN preview input đầu tiên thuộc retained source>=3s; không dùng đoạn nguồn 0–5s. `target:'draft'` phải đọc đúng autosaved revision, không mutate applied/journal. Preview và export cut-only của cùng edit có decoded frame sequence giống nhau trong window.
- [ ] Race tests bằng deferred promises: request A → switch video B → response A bị loại; cùng item nhưng revision mới → response cũ bị loại; cancel request A không cancel B. Kiểm error/loading/close panel/unmount và cleanup listener; waveform/thumbnail áp dụng cùng token rule.

```ts
export function sameCutRequest(a: CutRequestIdentity, b: CutRequestIdentity): boolean {
  return a.requestId === b.requestId && a.itemId === b.itemId &&
    a.sourceDigest === b.sourceDigest && a.frameIndexRevision === b.frameIndexRevision &&
    a.editRevision === b.editRevision
}
```

Thêm helper vào shared cut contract, test mỗi field mutation phải false, và integration chứng minh stale response không thay mediaToken đang phát; không dừng ở helper-only test.

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-cut-preview.test autoshort-ui-contract.test autoshort-region-geometry.test`; red trace bắt việc lấy source.filePath thay nguồn đã cắt.
- [ ] Implement preview bằng B02/B03/B04 cùng policy/runtime; chọn window 1–2s mỗi phía join khi đủ source, đoạn ngắn/EOF hiển thị duration thật. Dùng resource lease và cache có giới hạn; cancel chỉ settle sau child close. STTN preview qua C01 đúng segment; cut-only không được gắn nhãn final TTS.
- [ ] Wire UI source/edited toggle, clocks, previous/next/delete frame, keyboard focus guard, preview loop và progress/cancel. Previous/next dùng Main ordinal, không `currentTime += 1/fps`. Hiển thị snap diff trước Apply; source preview tua được vùng bỏ, after-cut không hiện deleted frames. Control chưa hỗ trợ phải có lý do.
- [ ] Gate: actual Electron app với video/audio; frame ordinal của preview so với export cut-only; keyboard/mouse/DPI/responsive/style A01; stale/cancel; test profile riêng không mutate user profile. Suites + typecheck. Commit `feat(autoshort): preview exact cut joins with revision ownership`.

## C05 — Publication, receipt, batch outcome và telemetry

**Findings:** F02/F05/F06/F07; Core R01/R15/R16/R17/R18. **Files:** Create `src/main/autoShortCutPublication.ts`, `tests/autoshort-cut-publication.test.ts`, `tests/autoshort-cut-batch.test.ts`; Modify `src/main/autoShortItemCoordinator.ts` (artifact/manifest publication), `src/main/autoshort.ts` (preserveAutoShortArtifacts writer và loadRecoveredBatch reconcile), `src/shared/autoShortBatchJournal.ts`, `src/main/autoShortBatchStore.ts`, `src/main/autoShortTelemetry.ts`.

**Interfaces:**

```ts
export type CutPublicationInput = {
  sourcePath: string; outputPath: string; srtPath?: string
  snapshotDigest: string; expectedIdentity: CutExecutionIdentity
  prepared: PreparedCutSource; outputMap: CutOutputMap
  retainedCues: readonly CutDerivedCue[]
  finalCues: readonly { id: string; derivedCueIds: string[]; text: string; start: number; end: number; words?: TimedWord[] }[]
  signal: AbortSignal // finalCues/words use output seconds; retainedCues use edited seconds
}
export type CutPublicationResult =
  | { ok: true; outputSha256: string; outputBytes: number; durationSeconds: number; validationDigest: string }
  | { ok: false; code: string; message: string }
export function validateCutPublication(input: CutPublicationInput): Promise<CutPublicationResult>
```

Completion manifest v2 chứa jobId/itemId/source/edit/config/executor/runtime/map/snapshot digests, output checksum/bytes/duration, validationDigest và version. V1 writer/reader no-cut được giữ để reconcile legacy; không gán các v2 fields chưa verified vào receipt cũ.

- [ ] Integration fake-provider capture: deleted text không tới final title/SEO; translated target IDs thuộc retained cues; subtitle/word timings nằm trong final outputDuration sau TTS. Title error giữ video và semantics titlePath/titleError; hashtags riêng; overlay/image effects giữ config hiện hành.
- [ ] Fault injection ở output rename, manifest write, journal receipt và restart. Video thiếu receipt chỉ reconcile khi metadata/digests/checksum/map hợp lệ; manifest khác edit/config/runtime không thành success. Source hash đổi thì không publish; output cũ giữ nguyên bytes. Needs-review không retry loop; ENOSPC pause admission theo volume; decoder failure của một file chỉ lỗi item đó.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-cut-publication.test autoshort-cut-batch.test autoshort-batch-resume.test autoshort-video-title.test autoshort-publication-timeline.test`; ghi red cho missing cut identity và review blocking.
- [ ] Implement final full decode/probe/schedule checks B04 trên output đã retime; assert mọi artifact cùng snapshot identity, final cues/word timings hợp lệ, source hash hiện tại khớp, lineage tại seam/EOF đúng. Chỉ emit item done sau exclusive publish, manifest và receipt đầy đủ. Metadata failure giữ video hợp lệ theo flow hiện có, không đổi thành cut failure.
- [ ] Telemetry thêm cut_probe/cut_prepare/cut_review/cut_preview/cut_validate: source/edited/output durations, range/segment count, revision/opaque digests, cache hit, resource wait, bytes, elapsed, codec/error code. Redact path/key/transcript. Preview cancel không tính là job failure; technical mismatch cùng input không được retry vô ích.
- [ ] Gate: interruption tại từng publication boundary; 30 mixed items ở Z01; không orphan, duplicate success, mất edit hoặc nhận receipt sai. Scoped tests + typecheck, `autoshort-telemetry.test autoshort-resource-lifecycle.test autoshort-queue-throughput.test`. Commit `fix(autoshort): publish cut outputs with validated run identity`.

## Bàn giao C

Mọi F01–F12 có thể đóng sau evidence riêng, nhưng chỉ Z01 master quyết định Core/platform enable. Mock-provider pass không chứng minh chất lượng nghĩa, live voice hoặc real STTN. Task record phải ghi source/edit/runtime/commit, cases đã chạy và NOT_VERIFIED rõ. Repair không hoàn thành khi còn thiếu preview, history, preset hoặc seam review trong Core.
