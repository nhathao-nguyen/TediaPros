# Auto Short OCR-Timed Text Blur Design

## Goal

Add an opt-in Auto Short blur mode that automatically finds every OCR-recognized
text box inside the user-selected OCR scan region and blurs only those boxes while
they are visible. The application scans and renders without a review pause.

The existing manual blur workflow remains available and unchanged. Automatic
blur fails closed: it never silently publishes an unblurred video when OCR,
timeline generation, mask validation, or rendering fails.

## Approved product decisions

- Add two mutually exclusive blur modes: **Thủ công** and **Tự động OCR**.
- Detect every OCR text result inside the scan region; do not classify or exclude
  logos, usernames, decorations, clocks, or other text.
- Blur each OCR bounding box rather than a full subtitle band.
- Expand each detected box by an adaptive 4-8 display pixels to cover outlines
  and shadows, clipping the result to the OCR scan region and video frame.
- Use OCR timing so blur exists only while the corresponding text is visible.
- Generate SRT cues and blur timing from one canonical OCR visual timeline.
- Start final rendering immediately after OCR; do not add a preview or approval
  stop.
- Offer exactly two automatic OCR scan profiles: **Chính xác** and **Nhanh**.
- Default automatic blur to **Chính xác**, which runs RapidOCR on every sampled
  frame at 8 fps.
- **Nhanh** retains OpenCV change segmentation plus one stable-frame OCR pass per
  segment and clearly discloses that very small or very brief changes may be
  missed.
- Preserve the current manual regions when switching modes, but do not mix manual
  and automatic blur in the same render.
- If OCR finds no valid text boxes, or any automatic-blur artifact is invalid,
  fail that queue item with a clear Vietnamese message.
- Never fall back from automatic OCR blur to static-band blur, manual blur, or an
  unblurred render.

## Current system and problem

The renderer currently stores one or more static manual rectangles. Auto Short
normalizes them to 0..1 coordinates, the main process converts them to source
pixels per video, and the burn pipeline crops and blurs each rectangle for the
entire output.

The managed OCR engine already samples video frames, finds text-change segments,
runs RapidOCR on a stable frame, and receives polygon boxes, recognized text, and
confidence. It currently discards per-segment geometry and returns only SRT text,
cue timing, and aggregate vertical band bounds. Consequently:

- the app cannot connect a particular text box to its visible interval;
- the existing FFmpeg graph can only blur static regions;
- SRT extraction and blur geometry cannot currently share one source of truth;
- using the aggregate band would obscure unrelated imagery and would remain
  visible while no text is present.

## Scope

### In scope

- An automatic/manual blur-mode contract and migration for existing settings.
- Accurate and fast automatic OCR scan-profile contracts.
- A versioned OCR visual-cue sidecar containing timing, text, confidence, and
  box geometry.
- A lossless, time-varying grayscale mask generated from those visual cues.
- Reuse of one OCR run when OCR is also used for subtitle extraction.
- OCR readiness, progress, cancellation, checkpoint, audit, cleanup, and Auto
  Short batch integration.
- A constant-size FFmpeg masked-blur graph for automatic mode.
- Renderer controls and scan-region behavior for the automatic mode.
- Deterministic unit, integration, real-media, packaged-runtime, and build gates.

### Out of scope

- Per-character glyph masks or semantic segmentation around individual strokes.
- Excluding selected categories of text.
- A timeline editor or pre-render review screen.
- Combining automatic and manual regions in one output.
- Cloud OCR, a new OCR model, PaddleOCR, or Tesseract.
- Optical-flow interpolation between OCR samples.
- Applying automatic OCR blur to the standalone Video Editor in this release.

## Product contract

The Auto Short configuration gains a mode whose default preserves existing
behavior:

~~~ts
export type AutoShortBlurMode = 'manual' | 'ocr-auto'
export type AutoShortOcrBlurProfile = 'accurate' | 'fast'

export interface AutoShortConfig {
  // Existing fields remain unchanged.
  lamMo: boolean
  blurMode: AutoShortBlurMode
  ocrBlurProfile: AutoShortOcrBlurProfile
  blurRegions: AutoShortBlurRegion[]
  ocrRegion?: AutoShortNormalizedRegion | null
}

export interface OcrEngineStatus {
  // Existing fields remain unchanged.
  features: string[]
}

export type AutoShortDependencyConfig = Pick<
  AutoShortConfig,
  | 'subtitleMethod'
  | 'whisperModel'
  | 'lamMo'
  | 'blurMode'
  | 'ocrBlurProfile'
>
~~~

Missing blurMode in an older persisted request migrates to manual. blurRegions
remain validated and retained in both modes, but the main process consumes them
only in manual mode. When lamMo=true and blurMode=ocr-auto, the request requires
a valid OCR region, an accurate or fast profile, and an OCR runtime advertising
the visual-cues-v1 capability. A missing profile migrates to accurate. Keeping
ocr-auto selected while blur is switched off is valid and does not schedule OCR
or blur work.

The public renderer-to-main BurnReq remains unchanged. A main-process-only
execution option carries the automatic mask so an untrusted renderer cannot
submit an arbitrary local mask path:

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

interface AutoShortBurnExecutionOptions {
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

async function burnAutoShort(
  request: Omit<BurnReq, 'outputDir' | 'outputName'>,
  options: AutoShortBurnExecutionOptions,
  onProgress: (progress: BurnProgress) => void
): Promise<BurnResult>
~~~

The existing public burnSubtitle path always executes without a timed mask and
continues to serve the standalone Video Editor. Every Auto Short render, manual
or automatic, uses burnAutoShort. That internal function validates its options,
requires the mask path to remain inside the item work directory, renders to a
hidden sibling of finalOutputPath, performs complete output validation, and
atomically promotes the file. The coordinator cannot call the public path and
cannot publish the final name before validation.

## Canonical OCR visual timeline

The OCR engine writes a bounded JSON sidecar with schema
ocr-visual-cues/1:

~~~ts
interface OcrVisualTimeline {
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
  profile: 'accurate' | 'fast'
  scanRegion: { x0: number; y0: number; x1: number; y1: number }
  segments: OcrVisualSegment[]
}

interface OcrVisualSegment {
  id: string
  startFrame: number
  endFrameExclusive: number
  start: number
  end: number
  text: string
  confidence: number
  boxes: Array<{
    text: string
    x0: number
    y0: number
    x1: number
    y1: number
    confidence: number
  }>
}
~~~

Coordinates are integer pixels in canonical display space after source rotation,
the same space used by the Auto Short preview and burn graph. Timestamps are
seconds from the displayed video's start. Each segment has start < end and is
bounded by the probed source duration. Raw intervals are half-open:
[startFrame, endFrameExclusive). start equals startFrame/sampleFps and end equals
min(endFrameExclusive/sampleFps, durationSeconds). The duplicated second values
are validated against those formulas rather than treated as independent timing.

One main-process canonicalDisplayGeometry helper is authoritative for OCR,
preview normalization, mask generation, and burn. From one FFprobe result it
derives coded dimensions, normalized 0/90/180/270 rotation, sample-aspect ratio,
video start, and the even square-pixel display width and height. The OCR command
receives only the derived display width and height, not a renderer-supplied filter
string. Its managed FFmpeg extraction keeps default autorotation enabled, then
applies setpts=PTS-STARTPTS, scale=<displayWidth>:<displayHeight>:flags=lanczos,
setsar=1, and fps=<sampleFps>, in that order. The burn path uses the same helper
and exact display dimensions after its own default autorotation.

The OCR engine verifies the first and every subsequently decoded frame has those
exact display dimensions before applying the scan region. The sidecar repeats a
SHA-256 geometry fingerprint over coded dimensions, rotation, SAR, start time,
and display dimensions. Main rejects a sidecar unless its fingerprint and
display dimensions equal the original FFprobe-derived values. Rotation and
non-square-SAR fixtures must demonstrate pixel-identical OCR/mask/burn coordinate
mapping before the feature is accepted.

The sidecar is the source of truth for OCR visual cues. OCR subtitle cues and
the mask are sibling projections:

~~~text
sampled frames
  -> OCR visual segments { timing, text, confidence, boxes }
       -> readable SRT cues
       -> time-varying blur mask
~~~

The main process never estimates box width from character count and never parses
the generated SRT back into blur geometry. Character count and normalized text
are only continuity signals. Actual RapidOCR boxes determine mask dimensions.
RapidOCR polygons are converted to their smallest axis-aligned rectangles before
padding. This may include the small amount of background inside a rotated text
rectangle; per-glyph and rotated polygon masks are explicitly out of scope and
the user approved bounding-box blur.

The sidecar file is capped at 64 MiB, 100,000 segments, 64 boxes per segment, and
4,096 Unicode code points per segment or box. It rejects duplicate IDs, non-finite
numbers, empty text, inverted or empty boxes, overlapping or unordered raw
segment timing, boxes outside the already-clipped scan region, and geometry
inconsistent with the probed display size.

A RapidOCR result is OCR-recognized for this feature only when it contains
non-empty text and its existing recognition confidence is greater than 0.5.
Every geometrically valid result meeting that definition is included in blur;
there is no category or keyword filter.

## Segmentation and sudden visual changes

Both profiles extract display-space frames at 8 fps. They differ only in how
often RapidOCR runs:

- **accurate** runs RapidOCR on every sampled frame. Each sample is represented
  by its own half-open visual segment [k,k+1), so the mask uses that sample's
  actual boxes. Adjacent samples may be merged for readable SRT text but are not
  coalesced for mask geometry. This is the default and reliably observes any
  content, position, or size change present in at least one sampled frame.
- **fast** retains the current per-sample OpenCV text-mask/Jaccard pass, creates
  preliminary change segments, and runs RapidOCR once on the most stable frame
  of each preliminary segment. One box set covers that entire segment. It is
  substantially cheaper but may miss a change that neither crosses the Jaccard
  threshold nor exists in the chosen stable frame.

Neither profile can guarantee detection of text that appears entirely between
two 8 fps samples. The accurate profile's explicit guarantee is therefore
sample-level, not sub-frame.

Adjacent visual segments with equivalent text may be merged into one readable SRT
cue, but their box segments remain separate for mask generation. This permits a
single subtitle cue while the mask follows a sudden change in text length,
position, or size.

Boxes are matched between adjacent samples or segments by normalized text and
then by the highest intersection-over-union. A one-sample interval with no valid
OCR result is filled only when the valid intervals immediately before and after
it have equivalent normalized text, matched-box intersection-over-union of at
least 0.5, and width and height ratios inside the inclusive 0.75..1.33 range.
Longer gaps remain black in the mask.

For scan-region inclusion, any RapidOCR polygon with non-zero intersection with
the selected scan rectangle is eligible. Its axis-aligned rectangle is clipped
to that scan rectangle before validation and padding; padding is clipped again
afterward, so automatic blur never paints outside the user's scan region.

Each box receives the same padding on all four sides: 15% of box height, rounded
to the nearest integer and clamped to 4..8 display pixels. Only padded boxes that
overlap are unioned; spatially separate words or lines do not become a full-width
band. No user-facing confidence or padding control is added in this release.

SRT uses the unpadded half-open source intervals. Mask rasterization expands each
interval by exactly one sample at both ends, clipped to the video, to cover the
uncertainty inherent in 8 fps sampling. The UI describes this as a one-frame
safety margin rather than claiming sub-frame visibility accuracy.

## OCR engine and runtime contract

ocr-local/1 remains backward compatible, while OCR engine version 1.1.0 adds the
feature visual-cues-v1 to its version and probe events. Automatic blur requires
that feature; ordinary OCR-to-SRT may continue to use a healthy older engine
until the user selects automatic blur.

Both --version and --probe return a features string array. The runtime probe
validates protocol, engine, exact manifest version, real model readiness, and
that every capability declared by the OCR manifest is present in both events.
OcrEngineStatus exposes the verified intersection of those feature arrays.

AutoShortDependencyConfig carries lamMo, blurMode, and ocrBlurProfile across the
renderer, preload, IPC, and main boundary. Readiness computes:

~~~ts
const automaticBlur = config.lamMo && config.blurMode === 'ocr-auto'
const needsOcr =
  automaticBlur ||
  config.subtitleMethod === 'ocr' ||
  config.subtitleMethod === 'whisper-ocr'
const ocrReady =
  genericOcrHealthy &&
  (!automaticBlur || verifiedFeatures.includes('visual-cues-v1'))
~~~

An older healthy ocr-local/1 engine remains ready for ordinary subtitle OCR. If
automaticBlur is selected and visual-cues-v1 is absent, readiness marks OCR as
requiring an update and the existing dependency dialog installs and reprobes the
runtime-v5 asset. It must not report automatic blur ready based only on the
protocol string.

The video command gains optional output arguments:

~~~text
ocr-engine.exe --input <video> --output <file.srt>
  --visual-cues-output <visual-cues.json>
  --scan-profile accurate|fast
  --display-width <px> --display-height <px>
  --geometry-fingerprint <sha256>
  --y0 <px> --y1 <px> --x0 <px> --x1 <px>
  --fps 8 --ffmpeg <managed-ffmpeg>
~~~

The engine constructs the visual timeline first. Its legacy CLI SRT remains for
backward compatibility and is derived from that same in-memory timeline. For the
application path, the done event returns only bounded metadata and the sidecar
path. Large cue data is read from the sidecar, not stdout. The main process
verifies the path is a regular file inside the requested OCR output directory,
parses and validates the sidecar, then regenerates the SRT from that validated
timeline. The engine-written SRT is never the authority for automatic blur.

The CLI defaults scan-profile to fast to preserve existing standalone OCR
behavior. Auto Short always passes the persisted automatic-blur profile
explicitly; a missing renderer setting is normalized to accurate before the
request crosses IPC.

A focused main-process mask writer consumes only the validated timeline. It
streams grayscale raw frames to managed FFmpeg and encodes a lossless FFV1
Matroska mask. Black means keep the source pixel and white means use the blurred
pixel. The mask contains no audio and starts at timestamp zero. Sparse
black-and-white frames are expected to compress efficiently without creating
thousands of temporary mask images.

The current immutable runtime-v4 channel is not mutated. A distributable release
uses runtime-v5 with the new OCR engine asset, exact byte count, SHA-256, required
files, protocol, version, and capabilities. The application installer remains
lightweight and the OCR runtime remains on-demand and offline after installation.
Because the current separator model catalog is tied to runtime-v4, runtime-v5
must also publish and validate a compatibility catalog that reuses the exact
qualified model bytes and hashes; moving the app's runtime channel must not make
the already installed separator feature unavailable.

runtime-v5 also declares ffmpeg capability ocr-mask-v1. Its staged runtime probe
does more than ffmpeg -version: it creates three tiny synthetic video inputs and
one optional audio input, runs the exact grayscale timing plus maskedmerge graph,
encodes and decodes FFV1, compares framemd5 against expected mask frames, and
verifies video/audio stream mapping when mask and narration coexist. Automatic
blur readiness requires this successfully probed capability. Existing FFmpeg
version/ffprobe readiness remains sufficient for features that do not use the
OCR mask path.

## Per-video Auto Short data flow

1. Validate the Auto Short request and probe display-space media metadata.
2. Resolve which work is required:
   - manual blur alone does not require OCR;
   - automatic blur always requires the capable OCR runtime;
   - OCR and Whisper+OCR subtitle modes reuse the same OCR result;
   - Whisper subtitle mode runs OCR only for automatic blur.
   - mustRegenerateOcrSource is true when automatic blur is active and the
     subtitle method is OCR or Whisper+OCR; the existing checkpoint.sourceCues
     fast path is allowed only when this flag is false.
3. Run Whisper and OCR concurrently where the current pipeline safely permits it,
   passing the selected accurate or fast OCR profile explicitly.
4. Read at most 64 MiB and strictly validate the OCR visual timeline before
   producing any downstream artifact.
5. Build OCR-aligned subtitle cues from the validated timeline when the selected
   subtitle method needs them. Whisper-only subtitles ignore OCR text while still
   retaining the visual timeline for automatic blur.
6. Rasterize the validated timeline into the lossless mask and verify exact
   frame hashes, timing, geometry, and media properties before final rendering.
7. Pass either the existing manual rectangles or the automatic mask to burn,
   never both.
8. Apply masked blur in canonical display space, then render the new ASS
   subtitles above the blurred source imagery.
9. Render to a hidden unique partial file in the selected output directory,
   decode-check and probe it, then atomically rename it to the final output name.
10. In one finally path, remove the sidecar, mask, and partial render on success,
    failure, or cancellation after any needed bounded diagnostics are captured.

Queue items remain sequential and each item owns a distinct mask. A normalized
scan region is converted independently for each video's dimensions.

The coordinator no longer calls burnSubtitle for Auto Short. It constructs the
trusted finalOutputPath and calls burnAutoShort; burnAutoShort alone derives the
hidden partial name, invokes the lower-level renderer with an exact partial path,
runs mask and final-media validation, and atomically promotes the result. It
returns only the promoted final path.

## Mask validation and FFmpeg rendering

Before render, mask validation requires:

- exactly one decodable video stream and no audio stream;
- width and height exactly equal to canonical display-space dimensions;
- a finite positive muxer time base, first PTS zero, finite positive frame rate
  equal to the declared sample rate, and decoded frame timestamps exactly
  following k/sampleFps within half one muxer tick. The pinned FFV1/Matroska
  muxer reports time_base=1/1000 even when encoding at 8 fps (PTS 0, 125, 250,
  ... ms), so validation checks the represented cadence rather than requiring
  the literal container value 1/8;
- activeFrameCount = ceil(videoDuration*sampleFps) raster frames plus one
  guaranteed terminal black frame;
- frame k represents [k/sampleFps, (k+1)/sampleFps), and a padded visual segment
  paints frames from max(0,startFrame-1) through
  min(activeFrameCount,endFrameExclusive+1), end-exclusive;
- every encoded frame's lossless FFV1 framemd5 exactly matches the expected
  raster hash computed from the validated timeline, proving that every intended
  box is white and every outside pixel is black;
- duration no shorter than the source and no longer than the source by more than
  two OCR samples;
- no unexpected file, stream, or path outside the item work directory.

Automatic blur uses a constant-size graph:

~~~text
canonical source -> split -> unchanged base
                          -> full-frame gblur -> blurred
mask -> gray + settb/setpts timing normalization
unchanged base + blurred + mask -> maskedmerge -> ASS subtitles -> output
~~~

The full-frame blur is computed once regardless of cue count. maskedmerge selects
blurred pixels only where the mask is white, so box count cannot explode FFmpeg's
filter graph. Manual mode continues to use the existing crop/gblur/overlay graph
unchanged.

The mask input is normalized with format=gray, settb=AVTB, and
setpts=PTS-STARTPTS. The managed FFmpeg build's maskedmerge filter does not expose
repeatlast, eof_action, or shortest options, so the graph must not pass or depend
on them. Instead, activeFrameCount plus the terminal black frame guarantees that
the mask stream extends strictly beyond the source duration. The merged output is
then trimmed to the exact probed source duration. If framesync holds the final
mask frame, it can hold only black and cannot leave the last text box blurred.

Input indexes must be assigned by a focused burn-input planner because optional
narration audio and mask inputs may coexist. No filter or stream map may depend
on a hardcoded second-input assumption.

## Checkpoint, audit, privacy, publication, and cleanup

Visual sidecars and masks are deliberately not persisted in Auto Short
checkpoints. A retry with automatic blur reruns OCR and mask generation even when
an existing checkpoint can reuse subtitle, translation, TTS, or separation
artifacts. This keeps raw OCR geometry and masks from surviving failed jobs and
avoids trusting a stale mask after engine or rendering changes.

For fingerprinting, effectiveOcrProfile is the selected automatic profile when
automatic blur is active and fast otherwise. The source-cue checkpoint records
that profile, OCR runtime version/protocol, and a SHA-256 digest of the canonical
OCR cue projection whenever the subtitle method is OCR or Whisper+OCR. blurMode
itself does not enter the source-cue fingerprint.

When automatic blur and an OCR-based subtitle method are active, a retry never
uses checkpointed source cues before the new visual timeline exists. It performs
one new OCR run, projects OCR cues from that validated timeline, and for
Whisper+OCR reruns or retrieves separately fingerprinted Whisper evidence before
fusion. It then compares the complete canonical source-cue digest, including
IDs, text, start, end, source, and timing quality. A mismatch invalidates
checkpointed translated cues and every dependent narration artifact before those
stages run. A match may reuse independently validated downstream artifacts. This
preserves one OCR timeline for the current SRT and mask without forcing a second
OCR pass.

When subtitles are Whisper-only, their existing checkpoint may be reused because
OCR contributes only the automatic mask. When automatic blur is off, existing
subtitle checkpoint behavior remains unchanged.

Normal logs and audit output include blur mode, OCR engine version, sample rate,
scan profile, visual-segment count, box-segment count, and masked duration. They
exclude raw recognized text, absolute media/work paths, box-by-box coordinates,
and mask contents. The visual sidecar and mask are temporary implementation
artifacts and are not copied into the normal success output.

Every OCR and FFmpeg child is registered with trackChildProcess. Cancellation
terminates the process tree, waits for close or error, removes partial mask,
sidecar, and render files, and only then settles the item.

Automatic-mode output is transactional. FFmpeg writes a hidden, job-unique
partial file next to the intended final file so final promotion stays on one
volume. Only after complete media validation does an atomic rename publish the
final name. The same finally block removes partial work after OCR, parse, mask,
render, validation, cancellation, or promotion failure. A failure never leaves a
new final-name file behind.

## User interface

The Auto Short **Làm mờ** panel adds a two-option selector:

- **Thủ công** — current orange rectangles and add/delete controls.
- **Tự động OCR** — no orange rectangles; the editable dashed OCR scan region is
  displayed even when the subtitle method is Whisper.

Automatic mode shows exactly two profile choices:

- **Chính xác — khuyên dùng** — OCR every sampled frame at 8 fps; persisted
  default.
- **Nhanh** — OCR stable change frames only; visibly warns that very small or
  very brief changes can be missed.

Automatic-mode copy states that every detected text item in the dashed region
will be blurred for its OCR interval plus the explicit one-frame safety margin.
It also states that rendering begins automatically after scanning and that no
valid detection will stop the item.

Switching modes does not delete manual rectangles. They are hidden and ignored
in automatic mode, then restored when the user switches back. Blur-off hides both
manual and automatic overlays and does not add OCR as a dependency.

The queue uses existing progress UI with distinct messages for OCR scanning,
timeline/mask validation, masked rendering, failure, and cancellation. The
renderer never receives the temporary mask path or raw OCR visual timeline.

## Failure behavior

- Missing or outdated OCR runtime blocks preflight and opens the existing
  dependency installation flow.
- OCR process error, timeout, malformed JSON Lines, invalid returned path, empty
  visual timeline, or zero valid boxes fails the item.
- Mask encode error, corrupt mask, black-only mask, size/timing mismatch, or
  decode failure fails before final render.
- FFmpeg maskedmerge or final output validation failure fails the item and
  removes partial output through the common finally path.
- Final promotion is atomic; a failed item never exposes a new partial file under
  its intended final output name.
- Automatic blur never falls back to a full-width band, manual rectangles, or no
  blur.
- One failed queue item follows the current batch failure policy without
  publishing that item's partial result.

All user-visible failures use concise Vietnamese copy. Bounded sanitized
diagnostics remain available locally without exposing raw recognized text or
user paths in normal UI messages.

## Testing and verification

### Pure and contract tests

- Blur-mode migration defaults old configurations to manual.
- Profile migration defaults missing values to accurate. Validation accepts only
  manual or ocr-auto and accurate or fast, and enforces mode-specific
  requirements.
- Dependency planning requires the capable OCR engine exactly when automatic
  blur is enabled or the subtitle method needs OCR.
- Visual-timeline validation covers timing, geometry, bounds, confidence,
  duplicate IDs, caps, path containment, and display-space rotation.
- Canonical-geometry tests cover 0/90/180/270 rotation, non-square SAR, non-zero
  video start, even rounding, OCR extracted-frame dimensions, geometry
  fingerprint mismatch, and exact preview/mask/burn coordinate equality.
- Segmentation tests cover sudden text-length, position, and size changes;
  equivalent text with multiple box segments; one-frame misses; multiple
  simultaneous boxes; overlapping-only union; and text-free gaps.
- Accurate-profile tests prove RapidOCR is invoked for every sampled frame and
  each frame retains its own box geometry. Fast-profile tests prove stable-frame
  reuse and explicitly demonstrate the documented below-threshold limitation.
- Padding tests prove the 4..8 pixel spatial clamp and one-sample temporal clamp.
- SRT and mask projections consume the same validated source intervals, with
  only the specified one-sample mask safety margin.
- Public burn-request validation rejects any renderer-supplied timed mask.
- Stored ocr-auto mode with blur switched off schedules neither OCR nor blur.
- Readiness requires visual-cues-v1 and the probed FFmpeg ocr-mask-v1 capability
  only for active automatic blur, while an older healthy OCR engine remains valid
  for ordinary subtitle extraction.
- A retry with automatic blur plus OCR-based subtitles regenerates OCR cues from
  the new visual timeline; source-cue digest mismatch invalidates translated and
  narration artifacts before reuse.
- The existing checkpoint.sourceCues branch is explicitly bypassed when
  mustRegenerateOcrSource is true.
- Every failure stage exercises common cleanup and leaves no final-name output.

### OCR engine tests

- Version and probe advertise visual-cues-v1 and load the real RapidOCR model.
- Deterministic synthetic detections create the expected visual sidecar without
  mocking timeline construction.
- A short local video containing changing high-contrast text exercises both scan
  profiles with real OCR, box extraction, sidecar output, cancellation, and
  bounded stderr.
- Main-process projection tests generate SRT and FFV1 mask from the validated
  sidecar, compare every mask frame hash, and prove the terminal frame is black.

### FFmpeg media acceptance

A generated video contains text-sized targets that appear, resize, move, and
disappear while unrelated moving imagery remains nearby. Automated measurements
must show:

- pixels inside each active box are blurred at its expected timestamps;
- the same coordinates are not blurred during text-free intervals;
- pixels outside the mask remain visually equivalent within the existing encode
  tolerance;
- a text box active at the final OCR segment does not persist past its half-open
  interval or through mask EOF;
- new ASS subtitles render after masked blur;
- optional narration audio maps correctly alongside the mask input;
- the output decodes, has the expected streams, and matches source duration
  within one source frame.
- The staged managed-FFmpeg probe executes the exact mask graph, FFV1 round trip,
  framemd5 comparison, and optional-audio input-index plan before advertising
  ocr-mask-v1.
- Auto Short never invokes the public burnSubtitle path; burnAutoShort alone
  validates the partial file and atomically promotes the final path.

### Repository and release gates

- npm run typecheck
- npm run test:local-runtime
- npm run test:subtitles
- npm run build
- git diff --check
- OCR engine version/probe and real short-video acceptance
- runtime-v5 archive verification
- packaged Windows application verification

If the capable packaged OCR runtime or a representative real user video cannot be
executed in this checkout, the final report must distinguish synthetic/local
proof from packaged or real-video behavior and label the missing gate partial or
blocked. No production-ready claim may be inferred from source-only tests.

## Delivery sequence

1. Add failing accurate/fast visual-timeline tests, then implement the focused
   OCR-domain helpers.
2. Extend the OCR engine protocol and sidecar generation, then add engine tests.
3. Extend main-process OCR validation, path containment, readiness, cancellation,
   and result types.
4. Add the automatic blur contract, migration, dependency planning, ephemeral
   artifact lifecycle, and single-run reuse in Auto Short.
5. Add main-process lossless mask projection, exact frame-hash validation, the
   constant-size masked-blur graph, transactional publication, and synthetic
   media acceptance.
6. Add the renderer selector, automatic scan-region state, progress, and
   Vietnamese failure copy.
7. Build and verify the new managed OCR runtime, then run repository, package,
   and real-video gates.

Each step must use test-driven development and leave the existing manual blur and
subtitle extraction behavior passing before the next step begins.
