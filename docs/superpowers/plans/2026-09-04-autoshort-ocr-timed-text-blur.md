# Auto Short OCR-Timed Text Blur Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in Auto Short mode that finds every valid RapidOCR text box inside the selected scan region, derives subtitle timing and blur timing from one visual timeline, and automatically publishes a video in which only those boxes are blurred while visible.

**Architecture:** Keep the renderer responsible only for mode/profile selection and normalized scan-region input. The Electron main process owns canonical display geometry, runtime capability checks, sidecar containment and validation, SRT projection, lossless timed-mask generation, FFmpeg validation, transactional rendering, checkpoint invalidation, audit redaction, and cleanup. OCR engine 1.1.0 emits a bounded `ocr-visual-cues/1` sidecar; a constant-size `maskedmerge` graph consumes an FFV1 grayscale mask. Manual rectangles remain a separate, unchanged rendering mode.

**Tech Stack:** Electron 34, React 19, TypeScript 5.7, Node 20 tests bundled by esbuild, Python 3.12.10, RapidOCR/ONNX Runtime, OpenCV, FFmpeg/FFprobe with FFV1 and `maskedmerge`, GitHub immutable runtime assets.

**Spec:** `docs/superpowers/specs/2026-09-04-autoshort-ocr-timed-text-blur-design.md`

## Global Constraints

- At execution time, use `superpowers:using-git-worktrees` from the latest commit containing this plan and the approved spec. Do not stash, delete, stage, or modify the unrelated `SESSION_CHAT_LOG.md` in the original checkout.
- Use red-green-refactor for every production change. A RED command must fail for the stated missing behavior before implementation.
- Stage only the files named by the current task. Run `git diff --check` before every commit.
- Run `npm run test:local-runtime` rather than `npm test`; this repository has no `npm test` script.
- Automatic blur is active only when `lamMo && blurMode === 'ocr-auto'`. It requires one valid scan region, profile `accurate|fast`, OCR feature `visual-cues-v1`, and FFmpeg capability `ocr-mask-v1`.
- Detect every RapidOCR result with non-empty text and confidence strictly greater than `0.5` when its polygon intersects the scan region. Do not add semantic/category filters.
- Accurate mode runs OCR on every sampled frame at exactly 8 fps. Fast mode retains OpenCV/Jaccard segmentation and one stable-frame OCR call per preliminary segment.
- Keep raw mask geometry at sample granularity even when adjacent equivalent text is merged for readable SRT output.
- Expand boxes by `round(0.15 * boxHeight)` pixels clamped to 4..8, clipped to both scan region and display frame. Expand mask timing by exactly one sample at each edge.
- Pass either manual rectangles or one validated timed mask to render, never both. Do not fall back from automatic blur to a static band, manual regions, or no blur.
- Keep public renderer-to-main `BurnReq` mask-free. Only main-process `burnAutoShort` may receive a timed-mask path.
- Never persist the sidecar or mask in checkpoints or normal success artifacts. Do not log raw OCR text, box coordinates, absolute source/work paths, or mask contents. The OCR done-event's output/sidecar path fields are the sole machine-transport exception: main validates them immediately, never echoes them to normal logs, audit metadata, renderer IPC, or UI, and removes temporary artifacts on every terminal path.
- Every OCR/FFmpeg child must use `trackChildProcess`; cancellation must terminate the tree, wait for close/error, and clean temporary sidecar, mask, and partial render before settling.
- Keep released runtime-v4 immutable. New distributable assets use runtime-v5, while the separator catalog reuses the exact already-qualified model bytes and hashes.
- Do not claim packaged or representative-real-video success unless those gates actually run. Report source/unit/synthetic/local results separately from packaged-runtime and real-user-media results.

---

## File Structure

### Shared contracts and pure policy

- Modify `src/shared/types.ts`: blur mode/profile and verified OCR feature types.
- Modify `src/shared/autoShortContract.ts`: legacy migration and mode-specific validation.
- Create `src/shared/autoShortOcrBlur.ts`: pure automatic-blur/needs-OCR/effective-profile policy.
- Create `src/shared/ocrVisualTimeline.ts`: schema types, strict validator, continuity rules, SRT projection, padding, and deterministic mask-frame planning.

### OCR and display geometry

- Create `src/main/canonicalDisplayGeometry.ts`: FFprobe-derived display geometry, fingerprint, extraction filter, and normalized-region projection.
- Modify `src/main/burn.ts`: consume the shared geometry and expose the probed geometry to Auto Short.
- Create `engines/ocr-engine/visual_timeline.py`: accurate/fast timeline construction and sidecar/SRT serialization.
- Modify `engines/ocr-engine/engine.py` and `engines/ocr-engine/ocr-engine.spec`: 1.1.0 protocol, new CLI, display-space frame extraction, and bounded JSONL.
- Create `engines/ocr-engine/tests/test_visual_timeline.py` and `engines/ocr-engine/tests/test_engine_cli.py`.
- Modify `package.json`: add `test:ocr-engine`.
- Modify `src/main/ocr.ts`: keep the legacy IPC API, add a main-only visual run, verify sidecar containment, and regenerate SRT from validated data.

### Mask, rendering, and Auto Short

- Create `src/main/ocrMask.ts`: raw grayscale raster stream, FFV1 writer, FFprobe/framemd5 validation, and cleanup.
- Create `src/main/burnInputPlanner.ts`: deterministic source/narration/mask input indexes.
- Modify `src/main/burn.ts`: constant-size masked graph, exact-path lower renderer, transactional `burnAutoShort`, and public-mask rejection.
- Create `src/main/autoShortOcrCheckpoint.ts`: source-cue evidence digest, forced OCR regeneration, and dependent-artifact invalidation.
- Modify `src/main/autoshort.ts`: readiness, single OCR reuse, mask lifecycle, checkpoint semantics, fail-closed behavior, audit metrics, and internal burn path.
- Modify `src/main/index.ts` and `src/preload/index.ts`: safe dependency config only; no mask/timeline IPC.

### Renderer and distribution

- Modify `src/renderer/src/components/AutoShort.tsx` and `src/renderer/src/styles/autoshort.css`: two blur modes, two OCR profiles, scan-region overlay, warning/progress copy.
- Modify `src/main/runtimeProbes.ts` and `src/main/runtimeManifest.ts`: verified feature intersection and staged OCR-mask capability.
- Modify `src/main/distributionConfig.ts`, `src/main/separation/modelManifest.ts`, `distribution/runtime-inputs.json`, `distribution/separator-model-inputs.json`, runtime/separator pack-and-verify scripts, and `.github/workflows/build-windows-runtime.yml` for runtime-v5.
- Create focused TypeScript suites and register each in `scripts/run-local-runtime-tests.mjs`.

---

### Task 1: Add the automatic-blur product contract and dependency boundary

**Files:**
- Create: `src/shared/autoShortOcrBlur.ts`
- Create: `tests/autoshort-ocr-contract.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/autoShortContract.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ocr.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/components/AutoShort.tsx`
- Modify: `scripts/run-autoshort-pipeline.ts`
- Modify: `scripts/run-local-runtime-tests.mjs`
- Modify: `tests/local-runtime.test.ts` only where existing typed fixtures need the two new fields

**Interfaces:**

~~~ts
export type AutoShortBlurMode = 'manual' | 'ocr-auto'
export type AutoShortOcrBlurProfile = 'accurate' | 'fast'

export function isAutomaticOcrBlur(
  config: Pick<AutoShortConfig, 'lamMo' | 'blurMode'>
): boolean

export function autoShortNeedsOcr(
  config: Pick<AutoShortConfig, 'subtitleMethod' | 'lamMo' | 'blurMode'>
): boolean

export function effectiveAutoShortOcrProfile(
  config: Pick<AutoShortConfig, 'lamMo' | 'blurMode' | 'ocrBlurProfile'>
): AutoShortOcrBlurProfile
~~~

- [ ] **Step 1: Register the new test suite, then write migration and validation tests**

Add `tests/autoshort-ocr-contract.test.ts` to both the esbuild entry-point array and spawned Node tests in `scripts/run-local-runtime-tests.mjs`. Use an untyped legacy request so migration is exercised:

~~~ts
test('legacy Auto Short config migrates to manual blur and accurate OCR profile', () => {
  const result = validateAutoShortStartRequest({
    items: [{ id: 'video-1', filePath: 'C:\\media\\video.mp4' }],
    config: {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      blurRegions: [],
      lamMo: false,
      translateTarget: 'none',
      translateProvider: 'local',
      ttsEnabled: false,
      audioMode: 'replace',
      originalAudioVolume: 20,
      outputDir: 'C:\\media\\out'
    }
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.config.blurMode, 'manual')
    assert.equal(result.value.config.ocrBlurProfile, 'accurate')
  }
})

test('active OCR blur requires a scan region and rejects unknown modes', () => {
  const missingRegion = autoShortRequest({
    lamMo: true,
    blurMode: 'ocr-auto',
    ocrBlurProfile: 'accurate',
    ocrRegion: null
  })
  const missing = validateAutoShortStartRequest(missingRegion)
  assert.equal(missing.ok, false)
  if (!missing.ok) assert.match(missing.error, /vùng OCR/iu)

  const invalid = autoShortRequest({ blurMode: 'band' as never })
  const invalidResult = validateAutoShortStartRequest(invalid)
  assert.equal(invalidResult.ok, false)
  if (!invalidResult.ok) assert.match(invalidResult.error, /chế độ làm mờ/iu)
})

test('stored OCR-auto mode with blur off requires no OCR work', () => {
  const config = {
    subtitleMethod: 'whisper' as const,
    lamMo: false,
    blurMode: 'ocr-auto' as const,
    ocrBlurProfile: 'fast' as const
  }
  assert.equal(isAutomaticOcrBlur(config), false)
  assert.equal(autoShortNeedsOcr(config), false)
  assert.equal(effectiveAutoShortOcrProfile(config), 'fast')
})
~~~

The local `autoShortRequest` fixture must include a valid absolute input/output path and every currently required Auto Short field; it merges only the supplied `Partial<AutoShortConfig>`.

- [ ] **Step 2: Run RED**

Run:

~~~powershell
npm run test:local-runtime
~~~

Expected: FAIL because the two types, policy module, and migrated fields do not exist.

- [ ] **Step 3: Add types, migration, validation, and pure policy**

In `src/shared/types.ts`:

- add the two union types;
- add required `blurMode` and `ocrBlurProfile` to `AutoShortConfig`;
- add required `features: string[]` to `OcrEngineStatus`; missing/legacy runtimes return an empty array;
- extend `AutoShortDependencyConfig` to carry `lamMo`, `blurMode`, and `ocrBlurProfile`.

Add `blurMode: 'manual'` and `ocrBlurProfile: 'accurate'` to the typed local CLI fixture in `scripts/run-autoshort-pipeline.ts`; this preserves its current no-blur behavior while satisfying the new canonical type.

Add the two persisted renderer states now, before their controls are introduced in Task 10, and include them plus `lamMo: blurEnabled` in readiness/install payloads and the start config. This keeps every task type-correct and gives Task 10 one contract to render rather than a second payload migration.

Implement `src/shared/autoShortOcrBlur.ts` exactly around the active predicate:

~~~ts
export function isAutomaticOcrBlur(config: Pick<AutoShortConfig, 'lamMo' | 'blurMode'>): boolean {
  return config.lamMo && config.blurMode === 'ocr-auto'
}

export function autoShortNeedsOcr(
  config: Pick<AutoShortConfig, 'subtitleMethod' | 'lamMo' | 'blurMode'>
): boolean {
  return isAutomaticOcrBlur(config) ||
    config.subtitleMethod === 'ocr' ||
    config.subtitleMethod === 'whisper-ocr'
}

export function effectiveAutoShortOcrProfile(
  config: Pick<AutoShortConfig, 'lamMo' | 'blurMode' | 'ocrBlurProfile'>
): AutoShortOcrBlurProfile {
  return isAutomaticOcrBlur(config) ? config.ocrBlurProfile : 'fast'
}
~~~

In `migrateLegacyConfig`, normalize only absent persisted values so explicit unknown values still reach validation and fail:

~~~ts
blurMode: raw.blurMode === undefined ? 'manual' : raw.blurMode,
ocrBlurProfile: raw.ocrBlurProfile === undefined ? 'accurate' : raw.ocrBlurProfile
~~~

Then validate explicit incoming values against `manual|ocr-auto` and `accurate|fast`. If active automatic blur has no valid `ocrRegion`, return `Tự động OCR cần một vùng OCR hợp lệ.`. Continue validating and retaining `blurRegions` in both modes.

- [ ] **Step 4: Widen readiness IPC without exposing artifact paths**

Update `parseAutoShortDependencyConfig` to default missing `lamMo` to false, missing `blurMode` to manual, and missing `ocrBlurProfile` to accurate; reject explicitly supplied unknown values, then return the three fields. Reject `timedOcrBlurMask`, `maskPath`, `visualTimeline`, and `visualCuesPath` in the existing forbidden-field branch. Keep preload signatures typed as `AutoShortDependencyConfig` and do not add any new mask/timeline API.

- [ ] **Step 5: Run GREEN and commit**

Run:

~~~powershell
npm run typecheck
npm run test:local-runtime
git diff --check
git add src/shared/types.ts src/shared/autoShortContract.ts src/shared/autoShortOcrBlur.ts src/main/index.ts src/main/ocr.ts src/preload/index.ts src/renderer/src/components/AutoShort.tsx scripts/run-autoshort-pipeline.ts scripts/run-local-runtime-tests.mjs tests/autoshort-ocr-contract.test.ts tests/local-runtime.test.ts
git commit -m "feat(autoshort): add OCR blur contract"
~~~

Expected: typecheck and all local-runtime suites pass.

---

### Task 2: Make canonical display geometry authoritative

**Files:**
- Create: `src/main/canonicalDisplayGeometry.ts`
- Create: `tests/canonical-display-geometry.test.ts`
- Modify: `src/main/burn.ts`
- Modify: `src/main/autoshort.ts`
- Modify: `scripts/run-local-runtime-tests.mjs`

**Interfaces:**

~~~ts
export interface CanonicalDisplayGeometry {
  codedWidth: number
  codedHeight: number
  rotation: 0 | 90 | 180 | 270
  sampleAspectRatio: { numerator: number; denominator: number }
  videoStart: number
  displayWidth: number
  displayHeight: number
  fingerprint: string
}

export function deriveCanonicalDisplayGeometry(input: {
  codedWidth: number
  codedHeight: number
  rotation?: number
  sampleAspectRatio?: string
  videoStart?: number
}): CanonicalDisplayGeometry

export function canonicalOcrExtractionFilter(
  geometry: CanonicalDisplayGeometry,
  sampleFps: 8
): string

export function canonicalBurnDisplayFilter(
  geometry: CanonicalDisplayGeometry
): string | null

export function normalizedRegionToDisplayPixels(
  region: AutoShortNormalizedRegion,
  geometry: CanonicalDisplayGeometry
): { x0: number; y0: number; x1: number; y1: number }
~~~

- [ ] **Step 1: Write geometry fixtures before moving probe logic**

Tests must cover rotation 0/90/180/270, SAR `4:3`, negative/450-degree rotation normalization, non-zero start, even downward rounding, stable SHA-256 fingerprint, and exact extraction-filter order:

~~~ts
test('canonical extraction filter uses display dimensions and fixed order', () => {
  const geometry = deriveCanonicalDisplayGeometry({
    codedWidth: 720,
    codedHeight: 576,
    rotation: 90,
    sampleAspectRatio: '16:15',
    videoStart: 1.25
  })
  assert.equal(geometry.displayWidth, 576)
  assert.equal(geometry.displayHeight, 768)
  assert.equal(
    canonicalOcrExtractionFilter(geometry, 8),
    'setpts=PTS-STARTPTS,scale=576:768:flags=lanczos,setsar=1,fps=8'
  )
})

test('preview, OCR, mask and burn project the same normalized region', () => {
  const geometry = deriveCanonicalDisplayGeometry({
    codedWidth: 1920,
    codedHeight: 1080,
    rotation: 90,
    sampleAspectRatio: '1:1',
    videoStart: 0
  })
  assert.deepEqual(
    normalizedRegionToDisplayPixels({ x0: 0.1, y0: 0.7, x1: 0.9, y1: 0.95 }, geometry),
    { x0: 108, y0: 1344, x1: 972, y1: 1824 }
  )
})
~~~

- [ ] **Step 2: Run RED**

Run `npm run test:local-runtime`.

Expected: FAIL because `canonicalDisplayGeometry.ts` is missing.

- [ ] **Step 3: Implement geometry derivation and fingerprint**

Use SHA-256 over stable JSON with exactly these keys and order:

~~~ts
{
  codedWidth,
  codedHeight,
  rotation,
  sarNumerator,
  sarDenominator,
  videoStart,
  displayWidth,
  displayHeight
}
~~~

Compute square-pixel pre-rotation width as `codedWidth * sarNumerator / sarDenominator`, round to an integer, round each final display dimension down to an even value with minimum 2, and swap dimensions for 90/270 degrees. Reject non-positive coded dimensions rather than inventing geometry.

- [ ] **Step 4: Refactor FFprobe consumption**

Have `doVideo` call the new helper once from raw stream metadata and attach the result as `geometry` on the returned probed meta. Make `canonicalDisplayVideoFilter` delegate to `canonicalBurnDisplayFilter`, while preserving the current no-op behavior for legacy square-pixel, zero-start manual fixtures. `canonicalOcrExtractionFilter` always returns the approved `setpts,scale,setsar,fps` chain. Automatic OCR/mask/burn paths must require real `meta.geometry` and must not reconstruct it from renderer dimensions.

Replace Auto Short's local normalized conversion for OCR/manual/subtitle regions with `normalizedRegionToDisplayPixels` using the probed geometry.

- [ ] **Step 5: Run GREEN and commit**

~~~powershell
npm run typecheck
npm run test:local-runtime
git diff --check
git add src/main/canonicalDisplayGeometry.ts src/main/burn.ts src/main/autoshort.ts scripts/run-local-runtime-tests.mjs tests/canonical-display-geometry.test.ts
git commit -m "refactor(video): centralize display geometry"
~~~

---

### Task 3: Build the strict visual-timeline domain and sibling projections

**Files:**
- Create: `src/shared/ocrVisualTimeline.ts`
- Create: `tests/ocr-visual-timeline.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `scripts/run-local-runtime-tests.mjs`

**Interfaces:**

~~~ts
export interface OcrVisualTimeline {
  schemaVersion: 1
  protocol: 'ocr-visual-cues/1'
  video: {
    width: number
    height: number
    durationSeconds: number
    sampleFps: number
    frameCount: number
    geometryFingerprint: string
  }
  profile: AutoShortOcrBlurProfile
  scanRegion: PixelRegion
  segments: OcrVisualSegment[]
}

export function validateOcrVisualTimeline(
  raw: unknown,
  expected: ExpectedOcrTimelineGeometry
): OcrVisualTimeline

export function stabilizeSingleSampleGaps(
  timeline: OcrVisualTimeline
): OcrVisualTimeline

export function projectOcrTimelineToSubtitleCues(
  timeline: OcrVisualTimeline
): SubtitleCue[]

export function planOcrMaskFrames(
  timeline: OcrVisualTimeline,
  durationSeconds: number
): OcrMaskFramePlan
~~~

- [ ] **Step 1: Write RED validation tests**

Use a 100x60, 8 fps, 1-second fixture. Cover:

- exact schema/protocol/profile/geometry fingerprint;
- finite integer frame coordinates and formula equality for `start/end`;
- start < end, source-duration bounds, sorted non-overlapping raw intervals;
- duplicate segment IDs;
- empty text, confidence `<= 0.5`, empty/inverted/out-of-scan boxes;
- 64 MiB read cap supplied separately by the file reader, 100,000 segment cap, 64 boxes per segment, and 4,096-code-point caps;
- sudden text length/position/size changes preserving distinct mask segments;
- multiple simultaneous spatially separate boxes;
- one-sample gap fill only at normalized-text equality, IoU >= 0.5, and inclusive width/height ratios 0.75..1.33;
- longer gaps remaining black;
- adaptive padding resolving to 4 px for short text and 8 px for tall text;
- only overlapping padded rectangles unioning;
- SRT using unpadded intervals while mask uses one-sample safety edges.

Representative assertions:

~~~ts
const timeline = validateOcrVisualTimeline(validTimeline(), EXPECTED)
const cues = projectOcrTimelineToSubtitleCues(timeline)
const mask = planOcrMaskFrames(timeline, 1)
assert.deepEqual(cues.map((cue) => [cue.start, cue.end]), [[0.25, 0.5]])
assert.deepEqual(mask.activeRanges, [{ startFrame: 1, endFrameExclusive: 5 }])
assert.equal(mask.totalFrameCount, 9)
assert.equal(mask.frames[8].boxes.length, 0)
~~~

- [ ] **Step 2: Run RED**

Run `npm run test:local-runtime`.

Expected: FAIL because the visual-timeline module and types do not exist.

- [ ] **Step 3: Implement strict parsing before continuity transformations**

Export constants:

~~~ts
export const OCR_VISUAL_MAX_BYTES = 64 * 1024 * 1024
export const OCR_VISUAL_MAX_SEGMENTS = 100_000
export const OCR_VISUAL_MAX_BOXES_PER_SEGMENT = 64
export const OCR_VISUAL_MAX_TEXT_CODE_POINTS = 4_096
export const OCR_SAMPLE_FPS = 8
~~~

Use `Array.from(text).length` for Unicode code-point limits. Reject unknown protocol/version, NaN/Infinity, fractional frame indexes, mismatched second values beyond `1e-6`, and any box that is not already clipped inside the scan region and display frame.

- [ ] **Step 4: Implement continuity, SRT projection, and mask plan**

Normalize matching text with Unicode NFKC, whitespace collapse, trim, and locale-independent lowercase. Match same-text boxes by highest IoU. For the one missing sample, create a synthetic segment whose matched rectangle is the AABB union of the two qualifying overlapping rectangles; do not interpolate motion. Do not fill longer gaps.

For each box, calculate:

~~~ts
const padding = Math.max(4, Math.min(8, Math.round((box.y1 - box.y0) * 0.15)))
~~~

Clip padded rectangles to `scanRegion` and frame bounds. Merge only rectangles that overlap. The raster plan contains `Math.ceil(durationSeconds * 8)` active frames plus one final black frame, and paints each segment over `[max(0,startFrame-1), min(activeFrameCount,endFrameExclusive+1))`.

Merge adjacent equivalent text only in `projectOcrTimelineToSubtitleCues`; never mutate or coalesce mask geometry.

- [ ] **Step 5: Run GREEN and commit**

~~~powershell
npm run typecheck
npm run test:local-runtime
git diff --check
git add src/shared/types.ts src/shared/ocrVisualTimeline.ts scripts/run-local-runtime-tests.mjs tests/ocr-visual-timeline.test.ts
git commit -m "feat(ocr): add canonical visual timeline"
~~~

---

### Task 4: Make OCR engine 1.1.0 emit accurate and fast visual sidecars

**Files:**
- Create: `engines/ocr-engine/visual_timeline.py`
- Create: `engines/ocr-engine/tests/__init__.py`
- Create: `engines/ocr-engine/tests/test_visual_timeline.py`
- Create: `engines/ocr-engine/tests/test_engine_cli.py`
- Modify: `engines/ocr-engine/engine.py`
- Modify: `engines/ocr-engine/ocr-engine.spec`
- Modify: `package.json`

**Python API:**

- `build_accurate_timeline(frame_paths, detect, metadata, scan_region) -> dict[str, object]`
- `build_fast_timeline(frame_paths, detect, metadata, scan_region, change_threshold=0.45) -> dict[str, object]`
- `timeline_to_srt(timeline) -> str`
- `write_visual_timeline(path, timeline) -> None`

- [ ] **Step 1: Write deterministic engine-domain tests**

Tests inject a deterministic detection callable, but execute real timeline construction. Assert:

- accurate calls detection once for every sampled frame and retains each frame's own geometry;
- fast calls detection once per OpenCV preliminary segment on its most stable frame;
- a below-threshold visual change is demonstrably missed by fast and retained by accurate;
- Sutherland-Hodgman polygon clipping against the scan rectangle, non-zero clipped polygon area, clipped-polygon-to-AABB conversion, `confidence > 0.5`, multi-box reading order, and stable IDs;
- legacy SRT derives from the same in-memory timeline;
- the sidecar contains no empty text/invalid box and stays within caps.

Add CLI tests that run `engine.py --version` without loading media and assert:

~~~json
{"type":"version","protocol":"ocr-local/1","engine":"rapidocr","version":"1.1.0","features":["directml-fallback","probe","rapidocr","visual-cues-v1"]}
~~~

For `--probe`, patch only the OCR constructor in the unit test and verify that the event has `ready: true` and the same feature list. The packaged-runtime gate later must run the unpatched real model probe.

- [ ] **Step 2: Run RED**

~~~powershell
python -m unittest discover -s engines/ocr-engine/tests -p "test_*.py" -v
~~~

Expected: FAIL because the timeline module and 1.1.0 feature output do not exist.

- [ ] **Step 3: Implement profiles and bounded sidecar serialization**

Move the current OpenCV mask/Jaccard/stable-frame functions into `visual_timeline.py` and preserve the proven change threshold `NG_DOI = 0.45`. Remove the cross-segment `NG_TRUNG` text-reuse shortcut: the approved fast profile must invoke RapidOCR exactly once on the stable frame of every preliminary segment so geometry is never borrowed from a previous segment. Accurate emits one valid visual segment per sampled frame that has qualifying boxes; samples with no qualifying boxes remain implicit black gaps. Fast emits one segment per preliminary interval using one stable-frame box set. Clip the actual polygon before deriving its AABB. Sort boxes by line center then x position; join their text only for each segment's readable text, and set segment confidence to the minimum confidence of its retained boxes.

The CLI adds:

~~~text
--visual-cues-output
--scan-profile accurate|fast
--display-width
--display-height
--geometry-fingerprint
~~~

Keep the standalone default `--scan-profile fast`. When visual output is requested, require all display/fingerprint arguments and `--fps 8`.

Resolve FFprobe only as the sibling of the supplied managed FFmpeg executable; never fall back to PATH. Probe the same source duration used by canonical main-process media metadata, set `video.durationSeconds` from that value, and set `video.frameCount` to the actual number of decoded samples. Validate that sampled timestamps are monotonic and do not exceed the source duration; do not infer duration from frame count because an audio stream may outlast the video stream. Clamp the last segment's seconds to the probed duration.

- [ ] **Step 4: Extract exact display-space frames**

Replace the JPEG extraction filter with PNG frames and this exact managed-FFmpeg filter order:

~~~text
setpts=PTS-STARTPTS,scale=576:768:flags=lanczos,setsar=1,fps=8
~~~

The line above is the exact expected string for the 576x768 test fixture; production substitutes only the validated display width/height and the validated sample rate. Leave FFmpeg autorotation enabled. Verify the first and every later decoded frame dimensions before cropping. A mismatch writes one bounded JSONL error event and exits non-zero.

- [ ] **Step 5: Keep JSONL bounded and SRT backward compatible**

Construct the timeline first, write JSON with UTF-8 and atomic sibling replacement, then derive the legacy `--output` SRT from it. The done event may include only output path, sidecar path, cue count, visual segment count, box segment count, scan profile, and aggregate band values needed by the old screen-text UI. Treat its two path fields as private machine transport consumed by main, not human-facing logging; main must validate containment and must not echo them. Progress events use generic phase/count text rather than recognized content. Do not emit raw OCR text or coordinates to stdout/stderr.

Update the PyInstaller spec so `visual_timeline.py` is included. Add:

~~~json
"test:ocr-engine": "python -m unittest discover -s engines/ocr-engine/tests -p \"test_*.py\" -v"
~~~

- [ ] **Step 6: Run GREEN and commit**

~~~powershell
npm run test:ocr-engine
git diff --check
git add engines/ocr-engine/visual_timeline.py engines/ocr-engine/engine.py engines/ocr-engine/ocr-engine.spec engines/ocr-engine/tests/__init__.py engines/ocr-engine/tests/test_visual_timeline.py engines/ocr-engine/tests/test_engine_cli.py package.json
git commit -m "feat(ocr-engine): emit visual cue sidecars"
~~~

---

### Task 5: Validate OCR features and sidecars in the main process

**Files:**
- Create: `tests/autoshort-ocr-runtime.test.ts`
- Modify: `src/main/runtimeProbes.ts`
- Modify: `src/main/ocr.ts`
- Modify: `scripts/run-local-runtime-tests.mjs`
- Modify: `tests/canonical-runtime-migration.test.ts`

**Main-only interfaces:**

~~~ts
export interface AutoShortOcrVideoOptions {
  input: string
  outputDir: string
  scanRegion: PixelRegion
  profile: AutoShortOcrBlurProfile
  geometry: CanonicalDisplayGeometry
  sampleFps: 8
  signal: AbortSignal
}

export interface AutoShortOcrVideoResult {
  timeline: OcrVisualTimeline
  sourceSrtPath: string
  sidecarPath: string
  engineVersion: string
  engineProtocol: 'ocr-local/1'
  visualSegmentCount: number
  boxSegmentCount: number
}

export async function ocrVideoWithVisualTimeline(
  options: AutoShortOcrVideoOptions,
  onProgress: (progress: OcrProgress) => void
): Promise<AutoShortOcrVideoResult>
~~~

- [ ] **Step 1: Write RED tests for feature intersection and path safety**

Add tests for:

- OCR version and probe must both advertise each manifest capability;
- returned `features` is the sorted intersection, not a union;
- older healthy `ocr-local/1` with no visual feature remains generically healthy;
- a done sidecar path outside the requested OCR directory, a directory/symlink instead of a regular file, a >64 MiB file, malformed JSON, mismatched geometry fingerprint, empty timeline, or zero boxes fails with sanitized Vietnamese text;
- validated sidecar data regenerates `source.srt` and ignores conflicting engine-written SRT contents;
- cancellation settles only after child close/error and removes the partial sidecar.

- [ ] **Step 2: Run RED**

Run `npm run test:local-runtime`.

Expected: FAIL because runtime features are discarded and the visual-run API is absent.

- [ ] **Step 3: Return verified OCR features**

Extend `RuntimeProbeResult` with `features?: string[]`. Parse string arrays from both `--version` and `--probe`; validate protocol `ocr-local/1`, engine `rapidocr`, exact manifest version when supplied, and real probe readiness. For manifest installs, reject if any declared capability is absent from either event. Return only their sorted intersection.

Propagate the intersection through `probeOcr` and `ocrEngineStatus`.

- [ ] **Step 4: Add a visual sidecar run without widening public OCR IPC**

Refactor child spawning and JSONL handling into one internal runner. Keep the existing positional `ocrVideo` export used by ScreenText and its existing `OcrResult` response. Add `ocrVideoWithVisualTimeline` for main-process Auto Short only.

The visual path passes all approved CLI arguments, requires `sampleFps: 8`, resolves the returned path with `realpath`, verifies the requested output directory with `realpath`, requires a regular file and containment via `relative(root, file)`, checks size before reading, validates through `validateOcrVisualTimeline`, stabilizes the one-sample gaps, and writes SRT from `projectOcrTimelineToSubtitleCues`.

Never place the sidecar path or timeline on preload/IPC responses.

- [ ] **Step 5: Run GREEN and commit**

~~~powershell
npm run typecheck
npm run test:local-runtime
git diff --check
git add src/main/runtimeProbes.ts src/main/ocr.ts scripts/run-local-runtime-tests.mjs tests/autoshort-ocr-runtime.test.ts tests/canonical-runtime-migration.test.ts
git commit -m "feat(ocr): validate visual sidecars locally"
~~~

---

### Task 6: Stream and validate the lossless timed OCR mask

**Files:**
- Create: `src/main/ocrMask.ts`
- Create: `tests/ocr-mask.test.ts`
- Modify: `scripts/run-local-runtime-tests.mjs`

**Interfaces:**

~~~ts
export interface TimedOcrBlurMask {
  path: string
  width: number
  height: number
  durationSeconds: number
  sampleFps: number
  visualCueCount: number
  boxSegmentCount: number
}

export async function writeTimedOcrBlurMask(
  timeline: OcrVisualTimeline,
  options: {
    ffmpegPath: string
    ffprobePath: string
    outputPath: string
    itemWorkDir: string
    durationSeconds: number
    signal: AbortSignal
  }
): Promise<TimedOcrBlurMask>

export async function validateTimedOcrBlurMask(
  timeline: OcrVisualTimeline,
  mask: TimedOcrBlurMask,
  options: { ffmpegPath: string; ffprobePath: string; itemWorkDir: string }
): Promise<void>
~~~

- [ ] **Step 1: Write RED raster and media tests**

Use a tiny 32x24, 8 fps timeline and a managed/local FFmpeg fixture. Assert:

- raw black/white frame MD5 values match the expected boxes;
- active frame count is `ceil(duration*8)` and exactly one terminal frame is black;
- the first PTS is zero, frame rate is 8, dimensions match, codec is FFV1, one video stream exists, and no audio stream exists;
- the muxer time base is finite/positive and decoded frame timestamps represent k/8 exactly within half one muxer tick; accept the pinned Matroska muxer's observed 1/1000 time base with PTS 0,125,250 rather than requiring literal 1/8;
- duration is not shorter than source and is no more than two samples longer;
- black-only timelines fail before render;
- bad path containment, wrong dimensions, corrupt mask, wrong frame count/hash, cancellation, and FFmpeg failure remove the partial output.

- [ ] **Step 2: Run RED**

Run `npm run test:local-runtime`.

Expected: FAIL because `ocrMask.ts` is missing.

- [ ] **Step 3: Implement streaming raster output**

For each planned frame, allocate one `Buffer.alloc(width * height)` grayscale plane, paint each clipped integer AABB to `0xff` row-by-row, update the expected frame MD5, honor backpressure on stdin, then reuse/release the frame before the next sample. Spawn:

~~~text
ffmpeg -v error -f rawvideo -pixel_format gray -video_size WxH -framerate 8
  -i pipe:0 -an -c:v ffv1 -level 3 -pix_fmt gray mask.partial.mkv
~~~

Write to a job-unique partial path inside `itemWorkDir` and rename to the requested mask path only after validation.

- [ ] **Step 4: Validate the encoded artifact exactly**

Use FFprobe JSON for stream count, codec, dimensions, rate, time base, start PTS, every decoded frame timestamp, and duration. Validate represented k/8 cadence within half a reported time-base tick. Run managed FFmpeg `-f framemd5 -hash md5 -`, parse every video frame hash, and compare against hashes recomputed from the timeline. Require the terminal expected/actual hash to equal the all-black frame. Reject any non-contained real path or unexpected stream.

All children use `trackChildProcess` and a shared abort handler; stderr retains only a bounded sanitized tail.

- [ ] **Step 5: Run GREEN and commit**

~~~powershell
npm run typecheck
npm run test:local-runtime
git diff --check
git add src/main/ocrMask.ts scripts/run-local-runtime-tests.mjs tests/ocr-mask.test.ts
git commit -m "feat(autoshort): generate timed OCR masks"
~~~

---

### Task 7: Add a constant-size masked graph and transactional Auto Short burn

**Files:**
- Create: `src/main/burnInputPlanner.ts`
- Create: `tests/autoshort-ocr-burn.test.ts`
- Modify: `src/main/burn.ts`
- Modify: `tests/e2e-autoshort.test.ts`
- Modify: `scripts/run-local-runtime-tests.mjs`

**Interfaces:**

~~~ts
export interface BurnInputPlan {
  args: string[]
  sourceVideoIndex: 0
  narrationAudioIndex: number | null
  maskVideoIndex: number | null
}

export function planBurnInputs(input: {
  sourceVideo: string
  narrationAudio?: string | null
  timedMask?: string | null
}): BurnInputPlan

export interface AutoShortBurnExecutionOptions {
  timedOcrBlurMask?: TimedOcrBlurMask | null
  finalOutputPath: string
  itemWorkDir: string
  expectedMedia: {
    durationSeconds: number
    frameRate?: number
    requireAudio: boolean
    durationToleranceFrames: number
  }
  signal: AbortSignal
}

export async function burnAutoShort(
  request: Omit<BurnReq, 'outputDir' | 'outputName'>,
  options: AutoShortBurnExecutionOptions,
  onProgress: (progress: BurnProgress) => void
): Promise<BurnResult>
~~~

- [ ] **Step 1: Write RED planner, graph, and security tests**

Assert all four source/narration/mask combinations produce correct indexes. For narration plus mask, narration must be input 1 and mask input 2.

For the one-second narration-plus-mask fixture, assert the automatic graph contains:

~~~text
[display]split=2[base][blur_source]
[blur_source]gblur=sigma=8:steps=3[blurred]
[2:v]format=gray,settb=AVTB,setpts=PTS-STARTPTS[mask]
[base][blurred][mask]maskedmerge,trim=duration=1.000[masked]
[masked]ass=sub.ass[out]
~~~

The graph must not contain `repeatlast`, `eof_action`, or `shortest`, and its filter count must be identical for 1 versus 10,000 box segments.

Also test:

- public `burnSubtitle` rejects raw keys `timedOcrBlurMask`, `maskPath`, and `visualCuesPath`;
- automatic options reject a mask outside `itemWorkDir`;
- partial render, decode, duration, stream, cancellation, and promotion failures leave no new final-name file;
- successful validation atomically promotes one hidden sibling partial and returns only the final path;
- manual `taoFilterComplex` regression strings remain unchanged.

- [ ] **Step 2: Run RED**

Run `npm run test:local-runtime`.

Expected: FAIL because the planner, graph, public-field rejection, and `burnAutoShort` do not exist.

- [ ] **Step 3: Implement the focused input planner and graph**

Append inputs in this exact order: source video, optional narration, optional mask. Build automatic audio references from `narrationAudioIndex` rather than hardcoded `[1:a]`. Normalize mask timing with `format=gray,settb=AVTB,setpts=PTS-STARTPTS`. Full-frame blur is computed once. Render subtitles after `maskedmerge` and trim the merged stream to the exact source duration.

Leave the current manual crop/gblur/overlay path in `taoFilterComplex` behaviorally unchanged.

- [ ] **Step 4: Extract an exact-output lower renderer**

Refactor `runBurnSubtitle` so a lower main-only function receives the exact output path and optional validated mask; the public wrapper continues deriving its normal Video Editor name. Do not let the lower renderer derive or publish an Auto Short final name.

Implement `burnAutoShort` to:

1. validate absolute final/work paths and contained mask;
2. reject simultaneous timed mask and active manual rectangles;
3. create `'.' + basename(finalOutputPath, '.mp4') + '.' + randomUUID() + '.partial.mp4'` beside the final;
4. render exactly to that partial;
5. decode the complete file and probe video/audio/duration/frame-rate requirements;
6. atomically rename partial to the non-existing final path;
7. remove partial in `finally` on every failure/cancel path.

Keep the global single-flight guard shared by public and Auto Short burns.

- [ ] **Step 5: Run GREEN and commit**

~~~powershell
npm run typecheck
npm run test:local-runtime
npm run test:subtitles
git diff --check
git add src/main/burnInputPlanner.ts src/main/burn.ts scripts/run-local-runtime-tests.mjs tests/autoshort-ocr-burn.test.ts tests/e2e-autoshort.test.ts
git commit -m "feat(burn): render validated timed masks"
~~~

---

### Task 8: Make readiness require capabilities only for active automatic blur

**Files:**
- Create: `src/main/ffmpegOcrMaskProbe.ts`
- Create: `scripts/run-ffmpeg-ocr-mask-probe.mjs`
- Modify: `src/main/autoshort.ts`
- Modify: `src/main/runtimeProbes.ts`
- Modify: `tests/autoshort-ocr-runtime.test.ts`

- [ ] **Step 1: Add RED readiness matrix tests**

Inject readiness hooks for FFmpeg/OCR so tests cover:

| Configuration | Healthy legacy OCR | visual-cues-v1 | ocr-mask-v1 | Expected |
|---|---:|---:|---:|---|
| Whisper, blur off, stored OCR-auto | no | no | no | ready without OCR |
| OCR subtitles, manual/off | yes | no | no | OCR ready |
| Whisper+OCR subtitles, manual | yes | no | no | OCR ready |
| Any subtitle mode, active OCR-auto | yes | no | yes | OCR update required |
| Any subtitle mode, active OCR-auto | yes | yes | no | FFmpeg capability failure |
| Any subtitle mode, active OCR-auto | yes | yes | yes | ready |

Verify dependency install reprobes and installs OCR if `visual-cues-v1` is missing; ordinary subtitle OCR must not force the update.

- [ ] **Step 2: Run RED**

Run `npm run test:local-runtime`.

Expected: FAIL because current readiness schedules OCR only from subtitle method and FFmpeg checks only file presence.

- [ ] **Step 3: Implement and test the real FFmpeg capability probe**

Create `probeFfmpegOcrMaskCapability(ffmpegPath)` in `src/main/ffmpegOcrMaskProbe.ts`. It must create three tiny source/mask cases and one optional narration WAV in a fresh temporary directory:

1. a white box appears and then disappears;
2. a final active interval is followed by the guaranteed black terminal frame;
3. a box moves/resizes beside unrelated moving imagery;
4. case 3 is rendered again with narration as input 1 and mask as input 2.

Use the exact `format=gray,settb=AVTB,setpts=PTS-STARTPTS` plus `maskedmerge` graph, FFV1 encode/decode, frame MD5 comparison, and output stream mapping. Do not pass `repeatlast`, `eof_action`, or `shortest`. Return `healthy: true` with `features: ['ocr-mask-v1']` only when every check passes, and remove the temporary directory in `finally`.

Add one managed-FFmpeg test that executes this probe when the canonical local runtime fixture is available; skip with an explicit diagnostic only when that binary is absent. Unit fakes may cover probe failure and cache behavior, but may not be the only proof.

Create `scripts/run-ffmpeg-ocr-mask-probe.mjs` as a thin esbuild wrapper that bundles this same TypeScript module into a fresh temporary directory, calls it with an explicit `--ffmpeg` path, prints one JSON result, and exits non-zero unless `ocr-mask-v1` is proven. This gives release tooling the same implementation without copying its graph.

- [ ] **Step 4: Add capability-aware readiness**

Use the pure predicates:

~~~ts
const automaticBlur = isAutomaticOcrBlur(config)
const needsOcr = autoShortNeedsOcr(config)
const ocrVisualReady = Boolean(
  ocr?.has &&
  ocr.healthy &&
  (!automaticBlur || ocr.features?.includes('visual-cues-v1'))
)
~~~

When automatic blur is active, probe the resolved FFmpeg executable for required capability `ocr-mask-v1`. Extend `probeRuntimeExecutable` with an optional required-capability list rather than treating an empty synthetic manifest as proof; delegate that capability to `probeFfmpegOcrMaskCapability`. Cache a successful expensive FFmpeg feature probe by executable realpath, size, and mtime for the current process.

Expose clear dependency messages:

- `OCR engine cần cập nhật để tạo vùng làm mờ theo chữ.`
- `FFmpeg hiện tại chưa qua kiểm tra mặt nạ OCR.`

- [ ] **Step 5: Keep installation fail closed**

The existing dependency installer must reinstall/reprobe OCR when the feature is absent, reinstall/reprobe FFmpeg when `ocr-mask-v1` is absent, and return `ready: false` if either post-install check still fails. It must not silently downgrade the selected blur mode.

- [ ] **Step 6: Run GREEN and commit**

~~~powershell
npm run typecheck
npm run test:local-runtime
git diff --check
git add src/main/ffmpegOcrMaskProbe.ts scripts/run-ffmpeg-ocr-mask-probe.mjs src/main/autoshort.ts src/main/runtimeProbes.ts tests/autoshort-ocr-runtime.test.ts
git commit -m "feat(autoshort): gate OCR blur readiness"
~~~

---

### Task 9: Integrate one OCR timeline, checkpoint evidence, cleanup, and internal burn

**Files:**
- Create: `src/main/autoShortOcrCheckpoint.ts`
- Create: `tests/autoshort-ocr-pipeline.test.ts`
- Modify: `src/main/autoshort.ts`
- Modify: `src/main/autoShortAudit.ts`
- Modify: `scripts/run-local-runtime-tests.mjs`
- Modify: `tests/local-runtime.test.ts`

**Checkpoint helpers:**

~~~ts
export interface OcrSourceCueEvidence {
  effectiveOcrProfile: AutoShortOcrBlurProfile
  engineVersion: string
  engineProtocol: 'ocr-local/1'
  cueDigest: string
}

export function mustRegenerateOcrSource(
  config: Pick<AutoShortConfig, 'subtitleMethod' | 'lamMo' | 'blurMode'>
): boolean

export function digestCanonicalSourceCues(cues: readonly AlignedCue[]): string
~~~

**Audit helper:**

~~~ts
export function createOcrBlurAuditMetadata(summary: {
  blurMode: AutoShortBlurMode
  engineVersion?: string
  scanProfile?: AutoShortOcrBlurProfile
  visualSegmentCount?: number
  boxSegmentCount?: number
  maskedDurationSeconds?: number
}): Record<string, string | number>
~~~

- [ ] **Step 1: Write RED coordinator/checkpoint tests**

Use injected fakes or focused pure seams to prove:

- OCR subtitles + active automatic blur invoke OCR exactly once and use the same timeline for SRT and mask;
- Whisper+OCR + active automatic blur runs Whisper and OCR concurrently but requires OCR success; it does not take the old fallback-to-Whisper path if OCR/mask fails;
- Whisper-only automatic blur may reuse Whisper source cues while still running OCR once for the mask;
- the old `checkpoint.sourceCues` branch is skipped when `mustRegenerateOcrSource` is true;
- canonical cue digest includes ID, text, start, end, source, and timing quality in stable order;
- digest mismatch removes `translatedCues` and dependent narration metadata before reuse; a match may reuse independently valid downstream data;
- no sidecar/mask path appears in checkpoint JSON or success artifacts;
- OCR empty/zero-box, mask failure, burn failure, validation failure, cancellation, and promotion failure clean sidecar/mask/partial and publish no final-name output;
- Auto Short source contains no call to public `burnSubtitle(`.

- [ ] **Step 2: Run RED**

Run `npm run test:local-runtime`.

Expected: FAIL because Auto Short still trusts checkpointed source cues before OCR and calls public burn.

- [ ] **Step 3: Add source-cue evidence and forced regeneration**

Bump `AUTO_SHORT_CHECKPOINT_VERSION` to 5. Keep `blurMode` itself out of the global checkpoint fingerprint. Store `OcrSourceCueEvidence` only when subtitle method is OCR/Whisper+OCR, using `effectiveAutoShortOcrProfile` and the verified runtime data.

Before source-cue reuse:

~~~ts
const forceFreshOcrSource = mustRegenerateOcrSource(config)
const canUseCheckpointSource =
  !forceFreshOcrSource &&
  Array.isArray(checkpoint.sourceCues) &&
  checkpoint.sourceCues.length > 0
~~~

After a fresh OCR-based projection, compare the complete new digest to stored evidence. On mismatch, delete translated cues and any dependent voice/narration checkpoint fields before the translation/TTS stage executes.

- [ ] **Step 4: Run OCR once and retain its validated timeline**

Create one per-item `ocrRunPromise` when `autoShortNeedsOcr(config)` is true. Pass profile explicitly and retain the validated timeline in memory. OCR/Whisper may share the existing concurrent window, but automatic blur treats OCR rejection as fatal.

For OCR-based subtitles, use the SRT/cues derived from that timeline. For Whisper-only subtitles, ignore its OCR text but retain the timeline for the mask. Reject no segments or no valid boxes with `OCR không phát hiện vùng chữ hợp lệ trong vùng quét.`.

- [ ] **Step 5: Generate the mask and route every Auto Short render internally**

If active automatic blur, emit distinct progress for scan, timeline validation, mask creation/validation, and masked render. Generate one mask inside the item work directory. Build the burn request with empty manual `blurRegions` and pass the mask only through `AutoShortBurnExecutionOptions`. If manual, pass only existing pixel rectangles. Both paths call `burnAutoShort` with the trusted final path.

Register neither sidecar nor mask in `artifactEntries`. Implement `createOcrBlurAuditMetadata` in `autoShortAudit.ts` so its parameter type cannot accept text, coordinate, or path fields, and extend audit metadata only with:

~~~ts
{
  blurMode,
  ocrEngineVersion,
  ocrSampleFps: 8,
  ocrScanProfile,
  ocrVisualSegmentCount,
  ocrBoxSegmentCount,
  ocrMaskedDurationSeconds
}
~~~

Do not include recognized text, coordinates, or paths.

- [ ] **Step 6: Consolidate cleanup and run GREEN**

Track sidecar, mask, and partial candidates immediately when their intended paths are known. In one `finally`, await child settlement and remove those files before removing the item work directory. Preserve only bounded sanitized diagnostics.

~~~powershell
npm run typecheck
npm run test:local-runtime
git diff --check
git add src/main/autoShortOcrCheckpoint.ts src/main/autoshort.ts src/main/autoShortAudit.ts scripts/run-local-runtime-tests.mjs tests/autoshort-ocr-pipeline.test.ts tests/local-runtime.test.ts
git commit -m "feat(autoshort): integrate OCR timed blur"
~~~

---

### Task 10: Add the two-mode/two-profile renderer experience

**Files:**
- Modify: `src/renderer/src/components/AutoShort.tsx`
- Modify: `src/renderer/src/styles/autoshort.css`
- Modify: `tests/local-runtime.test.ts`

- [ ] **Step 1: Add RED renderer-source assertions**

Following existing renderer assertions in `tests/local-runtime.test.ts`, require:

- persisted keys `tblao.autoshort.blurMode` and `tblao.autoshort.ocrBlurProfile`;
- labels `Thủ công`, `Tự động OCR`, `Chính xác — khuyên dùng`, and `Nhanh`;
- request/readiness payloads containing `lamMo`, `blurMode`, and `ocrBlurProfile`;
- manual rectangles rendered only in active manual mode;
- OCR region visible in active automatic mode even with Whisper subtitles;
- warning copy for small/brief fast-profile misses;
- no mask/timeline/path fields in renderer source.

- [ ] **Step 2: Run RED**

Run `npm run test:local-runtime`.

Expected: FAIL because mode/profile controls are absent.

- [ ] **Step 3: Wire the persisted contract into controls**

Reuse the persisted `blurMode` and `ocrBlurProfile` states introduced in Task 1. On load, retain only the two canonical values for each field and reset any unknown stored value to `manual`/`accurate` before rendering controls or sending a request. The definitions below are the expected final state contract, not a second migration:

~~~ts
const [blurMode, setBlurMode] = usePersistedState<AutoShortBlurMode>(
  'tblao.autoshort.blurMode',
  'manual'
)
const [ocrBlurProfile, setOcrBlurProfile] = usePersistedState<AutoShortOcrBlurProfile>(
  'tblao.autoshort.ocrBlurProfile',
  'accurate'
)
const automaticBlur = blurEnabled && blurMode === 'ocr-auto'
~~~

Include these values in start/readiness/install payloads. Do not delete or reset `blurRegions` on a mode switch.

- [ ] **Step 4: Render the approved controls and overlays**

In the blur panel:

- keep the current on/off switch;
- show exactly one selector for manual versus automatic;
- show profile choices only for active/selected automatic mode;
- show manual add/list/delete only for manual;
- show the accurate explanation and fast warning;
- state that all detected text in the dashed region is blurred for its OCR interval plus a one-frame margin, then render starts automatically;
- state that no valid detection stops that queue item.

Pass `regions={blurEnabled && blurMode === 'manual' ? blurRegions : []}`. Set `hienOcrBox` when subtitle extraction uses OCR or `automaticBlur` is true. Blur-off hides both automatic and manual blur overlays.

- [ ] **Step 5: Add progress styling/copy and run GREEN**

Reuse existing queue phases but render distinct Vietnamese messages emitted by main: scanning, timeline/mask validation, masked rendering, failure, and cancellation. Add only scoped mode/profile CSS adjacent to existing editor controls.

~~~powershell
npm run typecheck
npm run test:local-runtime
npm run build
git diff --check
git add src/renderer/src/components/AutoShort.tsx src/renderer/src/styles/autoshort.css tests/local-runtime.test.ts
git commit -m "feat(autoshort-ui): add automatic OCR blur"
~~~

---

### Task 11: Publish runtime-v5 capability contracts without breaking separator models

**Files:**
- Modify: `distribution/runtime-inputs.json`
- Modify: `distribution/separator-model-inputs.json`
- Modify: `src/main/distributionConfig.ts`
- Modify: `src/main/runtimeManifest.ts`
- Modify: `src/main/runtimeProbes.ts`
- Modify: `src/main/separation/modelManifest.ts`
- Modify: `scripts/pack-runtime-release.mjs`
- Modify: `scripts/verify-runtime-release.mjs`
- Modify: `scripts/pack-separator-model-release.mjs`
- Modify: `scripts/verify-separator-model-release.mjs`
- Modify: `scripts/publish-github-release.mjs`
- Modify: `.github/workflows/build-windows-runtime.yml`
- Modify: `tests/release-tooling.test.ts`
- Modify: `tests/canonical-runtime-migration.test.ts`

- [ ] **Step 1: Write RED release-contract tests**

Require:

- default distribution channel and workflow input are `runtime-v5`;
- OCR asset version is 1.1.0 with protocol `ocr-local/1` and capabilities exactly including `probe`, `rapidocr`, `directml-fallback`, and `visual-cues-v1`;
- FFmpeg includes `ocr-mask-v1` only after the native staged probe passes;
- release verifier rejects a v5 OCR asset missing the feature;
- separator catalog accepts runtime-v5 and preserves `separator-fast-balanced-v1` at 63,234,907 bytes / SHA-256 `4b92b6a8f15d78a8f121d58cf5f5cc1b068868a867c2ce414d3f3e1a067e4e1a` and `separator-quality-v1` at 64,894,371 bytes / SHA-256 `6b9e38ef8ffaa49f1165ad5eb42a4dfd1c3a64731f8280f339cfdf5ec8749a93`, exactly matching the approved runtime-v4 catalog baseline;
- runtime-v4 is accepted only when explicitly requested for existing immutable-release verification, never rewritten.

- [ ] **Step 2: Run RED**

Run `npm run test:local-runtime`.

Expected: FAIL on current runtime-v4 defaults and OCR 1.0.0 capability list.

- [ ] **Step 3: Move repository defaults to runtime-v5**

Change repository input/default/workflow/publisher values to `runtime-v5`. Keep the pinned FFmpeg source URL/version/hash unchanged unless the feature probe proves it incompatible. Set OCR to 1.1.0 and add `visual-cues-v1`. Add `ocr-mask-v1` to FFmpeg capabilities.

Set the separator input catalog channel to runtime-v5 while keeping all model URLs, revisions, bytes, hashes, MDX dimensions, licenses, and stable IDs byte-for-byte unchanged. Change the manifest type/validator to accept the configured runtime channel and explicitly support runtime-v5 compatibility; do not relax model integrity checks.

- [ ] **Step 4: Require the already-proven FFmpeg capability during packaging**

Invoke the `probeFfmpegOcrMaskCapability` implementation from Task 8 through `scripts/run-ffmpeg-ocr-mask-probe.mjs`, passing `--ffmpeg` followed by the resolved staged executable path, before the packer signs/writes `ocr-mask-v1`. The path is constructed from the already-validated packer input root plus the manifest entrypoint; it is never accepted from a manifest URL. The release test fixtures cover the same cases:

1. white box appears then disappears;
2. final active interval followed by guaranteed black terminal frame;
3. moving/resized box beside unrelated moving imagery;
4. case 3 repeated with narration audio.

Let `buildRuntimeRelease` accept an injectable `probeFfmpegOcrMask` hook for deterministic unit tests; its production default launches the thin wrapper against the staged executable. Record a passed probe, FFmpeg executable SHA-256, and probe schema version in runtime provenance. The verifier requires that evidence to match the packaged FFmpeg asset whenever `ocr-mask-v1` is declared. The production packer/verifier must fail if the native result is absent, stale, hash-mismatched, or failed. A manifest string alone is not proof, and unit-hook success is not reported as native acceptance. Do not duplicate a second graph implementation in release tooling.

- [ ] **Step 5: Run GREEN and commit**

~~~powershell
npm run typecheck
npm run test:local-runtime
git diff --check
git add distribution/runtime-inputs.json distribution/separator-model-inputs.json src/main/distributionConfig.ts src/main/runtimeManifest.ts src/main/runtimeProbes.ts src/main/separation/modelManifest.ts scripts/pack-runtime-release.mjs scripts/verify-runtime-release.mjs scripts/pack-separator-model-release.mjs scripts/verify-separator-model-release.mjs scripts/publish-github-release.mjs .github/workflows/build-windows-runtime.yml tests/release-tooling.test.ts tests/canonical-runtime-migration.test.ts
git commit -m "release(runtime): define OCR blur runtime v5"
~~~

---

### Task 12: Prove end-to-end media behavior and run final gates

**Files:**
- Create: `scripts/generate-ocr-blur-fixture.mjs`
- Create: `scripts/verify-ocr-blur-media.mjs`
- Create: `docs/benchmarks/2026-09-04-ocr-blur-acceptance.md`
- Modify: `tests/autoshort-ocr-burn.test.ts`
- Modify: `tests/autoshort-ocr-pipeline.test.ts`
- Modify: `tests/release-tooling.test.ts` if the final archive exposes a newly testable contract

- [ ] **Step 1: Create the deterministic acceptance fixture**

Generate a short square-pixel source containing:

- text-sized targets that appear, resize, move, change length suddenly, and disappear;
- one final OCR interval followed by text-free frames;
- unrelated moving imagery immediately beside, but outside, the target boxes;
- optional sentinel source audio and a separate narration tone;
- an ASS subtitle that visibly overlaps the old-text area so layer order is measurable.

Expose `--output-dir` and `--ffmpeg` arguments. Write `source.mp4`, `narration.wav`, `sub.ass`, `timeline.json`, and expected box/timing/inside/outside pixel samples to that directory. Do not commit third-party media; commit only the generator and compact generated-data assertions.

- [ ] **Step 2: Add automated visual/audio assertions**

Expose `--fixture-dir`, `--ffmpeg`, `--ffprobe`, and optional `--ocr-engine` arguments. The verifier must show:

- inside-box pixels are measurably blurred only during expected mask intervals;
- the same coordinates are not blurred during text-free intervals;
- outside-mask pixels remain equivalent within the repository's encode tolerance;
- blur does not persist after the final half-open interval or mask EOF;
- ASS subtitles render after masked blur;
- optional narration maps correctly while source-audio policy remains unchanged;
- output decodes, has expected streams, and matches duration within one source frame.

- [ ] **Step 3: Run focused engine and managed-runtime gates**

~~~powershell
$ocrFixtureDir = Join-Path $env:TEMP ('tediapros-ocr-blur-' + [guid]::NewGuid().ToString('N'))
$managedFfmpeg = Join-Path $env:APPDATA 'tedia-pros\bin\ffmpeg\ffmpeg.exe'
$managedFfprobe = Join-Path $env:APPDATA 'tedia-pros\bin\ffmpeg\ffprobe.exe'
npm run test:ocr-engine
npm run test:local-runtime
node scripts/generate-ocr-blur-fixture.mjs --output-dir "$ocrFixtureDir" --ffmpeg "$managedFfmpeg"
node scripts/verify-ocr-blur-media.mjs --fixture-dir "$ocrFixtureDir" --ffmpeg "$managedFfmpeg" --ffprobe "$managedFfprobe"
~~~

Build the OCR executable in an isolated Python 3.12.10 environment with the same requirements/PyInstaller spec used by the workflow, then run it unpatched:

~~~powershell
$ocrBuildRoot = Join-Path $env:TEMP ('tediapros-ocr-v1.1-' + [guid]::NewGuid().ToString('N'))
$ocrVenv = Join-Path $ocrBuildRoot 'venv'
$ocrDist = Join-Path $ocrBuildRoot 'dist'
$ocrWork = Join-Path $ocrBuildRoot 'work'
New-Item -ItemType Directory -Path $ocrBuildRoot | Out-Null
py -3.12 -m venv "$ocrVenv"
$ocrPython = Join-Path $ocrVenv 'Scripts\python.exe'
$ocrPythonVersion = & $ocrPython -c "import platform; print(platform.python_version())"
if ($ocrPythonVersion -ne '3.12.10') { throw "OCR runtime requires Python 3.12.10, got $ocrPythonVersion" }
& $ocrPython -m pip install --disable-pip-version-check --no-cache-dir -r engines/ocr-engine/requirements.txt
& $ocrPython -m PyInstaller --clean --noconfirm engines/ocr-engine/ocr-engine.spec --distpath "$ocrDist" --workpath "$ocrWork"
$ocrExe = Join-Path $ocrDist 'ocr-engine\ocr-engine.exe'
& $ocrExe --version
& $ocrExe --probe
node scripts/verify-ocr-blur-media.mjs --fixture-dir "$ocrFixtureDir" --ffmpeg "$managedFfmpeg" --ffprobe "$managedFfprobe" --ocr-engine "$ocrExe"
~~~

The verifier invokes both accurate and fast profiles at 8 fps on the generated changing-text video. Confirm sidecar/SRT output, real RapidOCR box extraction, bounded stderr, and cancellation cleanup.

Run the same Auto Short path on a representative local user video only when the user has supplied or explicitly approved that media for acceptance testing. If no such video is available, record the representative-real-video gate as `BLOCKED — no approved input`; the generated fixture does not satisfy that gate.

- [ ] **Step 4: Build and verify runtime-v5/package artifacts**

Use clean staging inputs with real byte counts/hashes:

~~~powershell
$runtimeInputDir = Join-Path (Get-Location) 'release-inputs\runtime-v5-win32-x64'
$runtimeOutputDir = Join-Path (Get-Location) 'release-artifacts'
npm run release:pack -- --input-dir "$runtimeInputDir" --output-dir "$runtimeOutputDir" --runtime-version runtime-v5 --platform win32 --arch x64
node scripts/verify-runtime-release.mjs "$runtimeOutputDir"
npm run package:win
~~~

Verify the app package remains free of managed OCR/FFmpeg/separator executables and model weights, and that on-demand runtime-v5 installation passes native probes.

- [ ] **Step 5: Run all repository gates**

~~~powershell
npm run typecheck
npm run test:ocr-engine
npm run test:separator-engine
npm run test:local-runtime
npm run test:subtitles
npm run build
git diff --check
git status --short
~~~

Expected: all available gates pass; status contains only intended task files and any explicitly preserved pre-existing user file.

- [ ] **Step 6: Record evidence with honest scope**

In `docs/benchmarks/2026-09-04-ocr-blur-acceptance.md` record exact commands, versions, hashes, fixture results, packaged-runtime result, and representative real-video result. If packaged OCR runtime or representative user media cannot run, mark that gate `PARTIAL` or `BLOCKED`; do not infer production readiness from source or synthetic tests.

After the evidence file is saved, remove only the two task-owned temporary directories after resolving and proving that each remains under the operating-system temp root:

~~~powershell
$taskTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
foreach ($taskTempCandidate in @($ocrFixtureDir, $ocrBuildRoot)) {
  $taskTempResolved = [IO.Path]::GetFullPath($taskTempCandidate)
  if (-not $taskTempResolved.StartsWith($taskTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing cleanup outside temp root: $taskTempResolved"
  }
  if (Test-Path -LiteralPath $taskTempResolved) {
    Remove-Item -LiteralPath $taskTempResolved -Recurse -Force
  }
}
~~~

- [ ] **Step 7: Request review, fix findings, rerun affected gates, and commit**

Use `superpowers:requesting-code-review` against the approved spec and this plan. Apply valid findings with `superpowers:receiving-code-review`, rerun every affected command, then:

~~~powershell
git add scripts/generate-ocr-blur-fixture.mjs scripts/verify-ocr-blur-media.mjs docs/benchmarks/2026-09-04-ocr-blur-acceptance.md tests/autoshort-ocr-burn.test.ts tests/autoshort-ocr-pipeline.test.ts tests/release-tooling.test.ts
git commit -m "test(autoshort): verify OCR timed blur"
~~~

If `tests/release-tooling.test.ts` is unchanged in this task, omit it from `git add`.

---

## Completion Checklist

- [ ] Existing saved configurations migrate to manual mode; automatic profile defaults to accurate.
- [ ] Manual rectangles remain preserved, hidden/ignored in automatic mode, and unchanged when restored.
- [ ] Accurate mode runs RapidOCR on every 8 fps sample; fast mode runs once per stable preliminary segment.
- [ ] Every qualifying in-region OCR box is retained; box size is never estimated from character count.
- [ ] SRT and mask originate from one validated visual timeline.
- [ ] Padding, single-sample gap fill, and one-sample temporal safety margins match the approved formulas.
- [ ] Automatic blur fails closed on OCR, sidecar, no-box, mask, render, validation, or promotion failure.
- [ ] Mask validation proves dimensions, timing, FFV1 round trip, every frame hash, and black terminal frame.
- [ ] Masked graph remains constant-size and handles optional narration without hardcoded input indexes.
- [ ] Every Auto Short render uses transactional `burnAutoShort`; public `burnSubtitle` remains mask-free.
- [ ] Checkpoint retries rerun automatic OCR/mask work and invalidate downstream artifacts on cue-digest mismatch.
- [ ] Logs/audits exclude raw OCR text, coordinates, sensitive paths, and mask contents.
- [ ] Sidecar, mask, partial render, and children are cleaned on success, failure, and cancellation.
- [ ] runtime-v5 advertises only proven OCR/FFmpeg capabilities and preserves exact separator model integrity.
- [ ] Unit, engine, media, repository, release, package, and representative-real-video evidence are reported separately.
