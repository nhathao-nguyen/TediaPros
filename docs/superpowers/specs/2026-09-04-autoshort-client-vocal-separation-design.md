# Auto Short Client-Side Vocal Separation Design

## Goal

Add an optional, fully local Auto Short audio mode that removes the source
dialogue while retaining as much of the source music and sound effects as the
selected model can recover. TediaPros then mixes the existing AI narration over
that retained bed with ducking and renders the final video without sending source
audio to a separation API.

The feature targets distributable Windows 10/11 x64 clients, not only the current
development computer. Each client downloads a verified engine and only the model
assets required by the selected preset. After those assets are installed, source
separation works offline.

## Approved product decisions

- Add a third output-audio mode named **Tách thoại gốc, giữ nhạc & SFX**.
- Preserve the existing `replace` and `mix` behavior unchanged.
- Support NVIDIA, AMD, and Intel DirectX 12 GPUs through DirectML, with a CPU
  fallback.
- Offer exactly three user-facing presets: `fast`, `balanced`, and `quality`.
- Use two qualified MDX ONNX models: one shared by Fast and Balanced, and one HQ
  model used by Quality.
- Keep the main application installer free of separator binaries and models;
  install them on demand into the current Electron `userData` profile.
- Do not expose model segment, overlap, provider, or FFT controls in the primary
  UI.
- Do not add user-selected background music in this new mode in the first
  release. The separated source music and SFX are already the background bed.
- Never silently fall back to source `mix` or to another mode that can restore
  the original dialogue.
- Do not promise a fixed processing speed before a real benchmark has measured
  the selected models on supported hardware.

## Scope

### In scope

- An MDX ONNX separator engine with a versioned process protocol.
- DirectML execution and a CPU execution fallback.
- A model-qualification spike that selects and records exactly two redistributable
  model weights.
- Immutable, checksum-verified runtime and model installation with rollback.
- Auto Short request validation, readiness, progress, cancellation, checkpoint,
  audit, and render integration.
- Fast, Balanced, and Quality UI presets.
- Automated media tests, packaged-app tests, real hardware acceptance, and a
  staged release gate.

### Out of scope for the first release

- A LAN or cloud separation service.
- macOS or Linux support.
- Four-stem or six-stem export.
- A general-purpose stem editor or standalone vocal-removal tab.
- User-imported separation models.
- Concurrent separator inference across queue items.
- Demucs, RoFormer, and multi-model ensemble inference in production.
- Permanent storage of the isolated vocal stem.
- A guarantee that every sound effect will survive every source mix. Separation
  is model inference and its perceptual limitations must be stated honestly.

## Product contract

`AutoShortConfig.audioMode` gains `separate-vocals`:

```ts
export type AutoShortAudioMode = 'replace' | 'mix' | 'separate-vocals'
export type AutoShortSeparationPreset = 'fast' | 'balanced' | 'quality'

export interface AutoShortConfig {
  // Existing fields remain unchanged.
  audioMode: AutoShortAudioMode
  separationPreset?: AutoShortSeparationPreset
}
```

The request validator requires `ttsEnabled === true` and a valid
`separationPreset` when `audioMode === 'separate-vocals'`. The preset is ignored
and removed during normalization for the other two modes. A missing preset in an
old persisted configuration migrates to `balanced` only when the new audio mode
is selected.

`AutoShortItemStatus` gains `separating_audio`. Progress messages distinguish
audio extraction, model inference, CPU retry, narration stitching, final mixing,
and render validation.

## Architecture

The feature has four bounded units:

1. **Separator engine** — a headless Windows executable that accepts normalized
   WAV audio and a local model path, runs MDX inference, and emits JSON Lines.
2. **Separator model store** — a main-process service that validates, installs,
   resolves, and probes the compact and HQ model packages under `userData`.
3. **Auto Short separation adapter** — a main-process service that extracts source
   audio, starts and cancels the engine, validates stems, applies provider fallback,
   and returns a verified instrumental WAV.
4. **Narrated-audio compositor** — a focused FFmpeg service that mixes either a
   non-looping separated bed or the existing looping background-music bed with the
   narration timeline, using sidechain ducking and a final limiter.

`src/main/autoshort.ts` remains the job coordinator. It must not contain MDX
pre/post-processing, runtime download logic, or provider-specific inference code.
The React renderer only owns selection and display state; it cannot access model
files or start the engine directly.

## Per-video data flow

Auto Short continues to process queue items sequentially. One item follows this
order:

1. Validate source, output directory, runtime readiness, translation, and TTS.
2. Probe source media and obtain subtitle cues through the existing Whisper/OCR
   path. Whisper and separator inference are never active on the GPU at the same
   time.
3. Translate cues through the existing path when requested.
4. When `audioMode === 'separate-vocals'`, use managed FFmpeg to decode the source
   audio to stereo, 44.1 kHz PCM WAV.
5. Run the separator with the requested preset and `provider=auto`.
6. Validate and normalize the instrumental output to the exact source-video
   duration. The vocal output remains temporary and is deleted.
7. Generate and timeline the AI narration through the existing source-anchored
   dubbing path.
8. Mix the non-looping instrumental bed at full nominal gain with narration at
   full gain. Sidechain compression ducks the bed while narration is active; a
   limiter prevents final clipping.
9. Pass the composed WAV to `BurnReq.amThanhFile`, set `batAmThanh=true`, and set
   source-audio gain to zero. The original source audio stream is never also mixed
   into the result.
10. Probe and decode-check the rendered file before publishing success.

For `replace`, the existing TTS-only or user-selected looping background-music
flow remains unchanged. For `mix`, the existing source-audio ducking flow remains
unchanged.

## Separator engine contract

The engine protocol is `separator-engine/1`. It is line-oriented JSON on stdout;
bounded diagnostics go to stderr. Paths are supplied as separate process
arguments with `shell: false`.

Supported commands:

```text
separator-engine.exe --version
separator-engine.exe --probe --provider auto --model <absolute-model-path>
separator-engine.exe --separate --input <absolute-wav> --output-dir <absolute-dir>
  --model <absolute-model-path> --model-id <catalog-id>
  --preset fast|balanced|quality --provider auto
```

Required events:

```ts
type SeparatorEngineEvent =
  | {
      type: 'version'
      protocol: 'separator-engine/1'
      engine: 'mdx-onnx'
      version: string
      features: string[]
    }
  | {
      type: 'probe'
      protocol: 'separator-engine/1'
      ready: boolean
      provider: 'directml' | 'cpu'
      modelId: string
      message?: string
    }
  | { type: 'progress'; percent: number; phase: 'loading' | 'separating' | 'writing' }
  | {
      type: 'result'
      vocalsPath: string
      instrumentalPath: string
      provider: 'directml' | 'cpu'
      elapsedMs: number
    }
  | { type: 'error'; code: string; message: string; retryable: boolean }
```

The production engine has no network client and never downloads a model. The
main process supplies an already verified local model. The engine uses one pinned
ONNX Runtime DirectML build that exposes both `DmlExecutionProvider` and
`CPUExecutionProvider`. DirectML sessions use sequential execution and disable
memory-pattern optimization as required by that provider.

The qualification spike may use the maintained MIT-licensed
`python-audio-separator` project as a reference harness. The production engine
packages only the audited MDX ONNX inference path and its required dependencies;
it does not bundle the UVR GUI, unused Torch architectures, remote APIs, or
automatic model download behavior.

## Presets and model qualification

The stable product model IDs are:

- `separator-fast-balanced-v1` — compact model shared by Fast and Balanced.
- `separator-quality-v1` — HQ model used only by Quality.

The catalog maps those stable IDs to an exact upstream artifact, immutable source
revision or release, SHA-256, byte count, model-native MDX metadata, license, and
attribution. Production integration cannot start until the qualification report
has populated and independently verified every catalog field.

Preset behavior is fixed as follows:

| Preset | Model | Overlap | Batch | Purpose |
| --- | --- | ---: | ---: | --- |
| Fast | `separator-fast-balanced-v1` | 0.10 | 1 | Minimum processing time |
| Balanced | `separator-fast-balanced-v1` | 0.25 | 1 | Default quality/speed balance |
| Quality | `separator-quality-v1` | 0.50 | 1 | Best qualified single-model result |

Every model runs at its native FFT and segment dimensions. The engine rejects a
catalog/model metadata mismatch instead of converting the model to Torch or
guessing parameters.

The qualification spike evaluates two to four MDX ONNX candidates whose code and
weight licenses both permit the intended TediaPros distribution. It produces a
checked-in report containing source URLs, licenses, hashes, sizes, hardware,
provider versions, peak memory, timings, objective metrics, listening scores,
and the selected mapping to the two stable product IDs.

Selection gates:

- Fast must be at least 25% faster than Balanced on the reference corpus.
- Balanced must leave no intelligible original dialogue in at least 80% of the
  real-clip review set and must avoid severe music/SFX damage in at least 90%.
- Quality must improve median known-stem speech leakage by at least 2 dB over
  Balanced or win at least 70% of blind A/B comparisons without increasing the
  severe-damage rate.
- A candidate that has ambiguous weight redistribution rights cannot be selected,
  regardless of benchmark quality.
- If no pair passes, the feature remains behind a development flag and is not
  presented as production-ready.

## Runtime and model distribution

The current immutable `runtime-v3` channel is not mutated. The release containing
this feature creates `runtime-v4` and adds a `separator-engine` asset to the
existing runtime manifest lifecycle.

Canonical production layout:

```text
<userData>/
  bin/
    separator-engine/
      separator-engine.exe
      required runtime libraries
  separator-models/
    separator-fast-balanced-v1/
      model.onnx
      manifest.json
    separator-quality-v1/
      model.onnx
      manifest.json
  runtime-state/
    installed-runtime.json
```

The lightweight application installer excludes the engine, model weights, native
DLLs, archives, and local benchmark media. The runtime release hosts:

- the existing runtime manifest and engine archive;
- `separator-model-manifest.json` with schema version 1;
- one immutable archive for each qualified model package;
- reviewed license and provenance records.

Installation uses a fresh staging directory, validates safe archive paths, exact
bytes, SHA-256, required files, engine protocol, provider availability, and real
model load/inference. Atomic promotion and the installed receipt happen only after
all gates pass. A failed update leaves the previously healthy engine/model intact.

Fast and Balanced install only `separator-fast-balanced-v1`. Quality installs
`separator-quality-v1` only when selected. Readiness and the install dialog display
the exact manifest byte count rather than a hardcoded estimate.

## Provider policy

`provider=auto` has this deterministic behavior:

1. Probe DirectML and execute a small real inference with the selected model.
2. If the probe succeeds, run the item with DirectML.
3. If DirectML fails before or during separation, remove partial stems and retry
   the separation from the beginning on CPU exactly once.
4. After a DirectML failure, pin the remaining queue items in that job to CPU so
   the same GPU failure is not repeated.
5. If CPU also fails, fail the item. Do not emit a successful render and do not
   change its audio mode.

The audit records the requested provider policy, effective provider, fallback
reason code, elapsed time, and peak-memory observation when available. It does not
include raw absolute media paths.

## Media validation and composition

Before inference, FFprobe must confirm that the normalized input is a decodable,
finite-duration, stereo 44.1 kHz PCM WAV. After inference, both stems must:

- exist as regular non-empty files;
- decode without errors;
- contain finite audio samples rather than NaN or infinity;
- have the expected channel count and sample rate;
- differ from the source duration by no more than 100 ms before normalization.

The instrumental stem is padded or trimmed to the exact video duration before
composition. The final compositor uses the existing sidechain settings unless the
benchmark demonstrates a regression against the already accepted background-music
mix. The source bed does not loop; the existing user-selected background music
continues to loop in `replace` mode.

Final output validation requires a decodable file, one expected video stream, one
expected audio stream, and duration within one source frame according to the
existing Auto Short output gate.

## Checkpoints, disk use, and cleanup

The Auto Short checkpoint version is incremented. Its separation fingerprint is a
digest of:

- source media identity and stat data;
- separator engine version and protocol;
- selected model ID, model hash, and catalog schema;
- preset and all effective inference parameters;
- normalized input-audio contract.

A checkpointed instrumental stem is reused only when the fingerprint matches and
the complete media validation passes again. It is not a general permanent cache.
Successful jobs delete their checkpoint and temporary source/vocal/instrumental
WAV files after the audited final output has been published.

Before model installation, the client requires free space for the archive, the
extracted package, and a safety margin. Before a job, it estimates PCM workspace
from duration using stereo 44.1 kHz 16-bit audio and reserves space for source,
two stems, composed audio, and a safety margin. Insufficient space fails preflight
before inference.

The vocal stem is never copied into the success audit directory. Failure audit
contains only sanitized metadata and bounded diagnostics; temporary stems are
deleted after diagnostics are recorded.

## Failure and cancellation behavior

- A source with no audio stream skips separation and produces TTS-only audio with
  a visible warning.
- Corrupt or unsupported audio fails before inference.
- DirectML provider failure triggers the single CPU retry defined above.
- Engine timeout, malformed JSON Lines, invalid result paths, corrupt stems, or a
  failed media probe fail the item after any permitted CPU retry.
- Separation failure never falls back to `mix`, never restores source audio, and
  never publishes a partially rendered file as success.
- Every separator and FFmpeg child is registered with `trackChildProcess`.
- Cancellation sends the shared abort signal, terminates the Windows process tree,
  waits for child `close` or `error`, removes partial files, and only then settles
  the cancelled item.
- stderr is drained continuously, retained as a bounded tail, sanitized against
  media/model/output paths, and included only in the local diagnostic error.

## User interface

The Lồng tiếng audio-mode section adds a third radio/card:

> Tách thoại gốc, giữ nhạc & SFX

It is disabled while TTS is off and explains that AI narration is required. When
selected, it replaces the background-music controls with three preset cards:

- **Nhanh** — fastest qualified profile, with the compact-model download state.
- **Cân bằng — khuyên dùng** — persisted default, sharing the compact model.
- **Chất lượng cao** — slower HQ profile, with its separate download state.

The panel shows exact required download bytes, `Chưa cài`, `Đang tải`, or
`Sẵn sàng`, the effective `DirectML · NVIDIA/AMD/Intel` or `CPU fallback`
provider, and the statement **Sau khi cài model có thể xử lý offline**.

Starting a batch with missing assets opens the existing dependency-install flow.
During processing, the queue row shows `Đang trích audio`, `Đang tách thoại`,
`Đang thử lại bằng CPU`, `Đang trộn TTS`, and the existing render phases. No raw
engine diagnostics or filesystem paths appear in renderer messages.

## Security, privacy, and licensing

- Source audio and stems used by separation remain local; the separator engine
  has no network code. Existing translation and TTS networking is unchanged and
  remains governed by its existing UI/configuration contract.
- Only the Electron main process downloads runtime/model assets.
- Every remote artifact is pinned by immutable version, byte count, and SHA-256.
- Archive extraction rejects absolute paths, traversal segments, duplicate paths,
  and files outside staging.
- The app validates every engine-returned result path remains inside the requested
  work directory.
- Runtime/model paths and user media paths are redacted from normal logs and audit
  summaries.
- Third-party notices include the engine implementation, ONNX Runtime/DirectML,
  MDX-derived code, both selected model weights, and their required attribution.
- “Free” means no per-minute or per-token separation API fee. It does not promise
  zero Internet bandwidth, storage, electricity, release-hosting, or support cost.
- Code licensing and model-weight licensing are separate release gates. An
  open-source inference implementation does not by itself grant redistribution
  rights for a weight file.

## Verification and release gates

### Qualification corpus

Use known-stem synthetic mixtures plus real clips containing speech over music,
speech over transient SFX, multiple speakers, singing, silence, and compressed
social-video audio. Include short clips, two-minute clips, and a ten-minute
stability input. Test media must be licensed for internal testing and excluded
from release artifacts.

### Automated gates

- Unit tests cover contract migration, preset validation, model catalog
  validation, hashes, safe paths, provider selection, fallback, checkpoint keys,
  disk estimates, and audit redaction.
- Engine integration tests cover version/probe protocol, real compact and HQ
  model inference, progress monotonicity, malformed output, timeout, cancellation,
  DirectML failure, CPU retry, and non-finite samples.
- Media acceptance uses known stems to measure speech leakage and bed damage, then
  verifies decoding, channels, sample rate, duration, clipping, ducking, and the
  absence of the original source stream in the final FFmpeg graph.
- Auto Short tests cover all three audio modes so the existing `replace`, `mix`,
  and background-music contracts cannot regress.
- Release tests verify that the application installer excludes separator assets,
  runtime archives contain only declared files, clean-profile installation works,
  a second run works offline, and failed updates roll back.
- Repository gates remain `npm run typecheck`, `npm run test:local-runtime`,
  `npm run test:subtitles`, `npm run build`, `npm run package:win`, runtime archive
  verification, packaged-app verification, and `git diff --check`.

### Hardware acceptance

- GTX 1660 SUPER 6 GB: all three presets complete through DirectML without OOM
  while normal desktop GPU usage is present.
- At least one AMD or Intel DirectX 12 GPU: Fast and Balanced complete through
  DirectML.
- Forced CPU: the ten-minute input completes without crash, corruption, or an
  unbounded memory increase. CPU is a correctness fallback, not a promised speed.
- If AMD/Intel hardware is unavailable, the release is labeled beta/partial for
  those vendors rather than “verified on every GPU.”

### User-visible acceptance

A clean installed application must download only the selected preset's missing
assets, run a complete Auto Short job, survive cancellation and retry, and play a
rendered video containing source imagery, requested subtitles, retained source
music/SFX, and new TTS narration without intentionally reintroducing the original
audio stream. Human reviewers score the benchmark corpus against the preset gates
before the feature flag is enabled by default.

## Delivery sequence

1. **Model qualification:** benchmark eligible candidates, confirm weight rights,
   and commit the two exact catalog mappings and evidence report.
2. **Engine vertical slice:** build the minimal MDX ONNX executable, implement the
   protocol, and pass DirectML/CPU real-media tests outside Auto Short.
3. **Managed distribution:** add immutable engine/model assets, staged installers,
   probes, receipts, offline reuse, and rollback tests.
4. **Auto Short integration:** add the contract, readiness, pipeline stage,
   compositor path, checkpoint, audit, and cancellation behavior.
5. **Renderer integration:** add the third mode, three presets, dependency state,
   provider display, and progress copy.
6. **Release qualification:** run repository, package, clean-profile, real-media,
   and hardware gates; ship as beta wherever hardware evidence is incomplete.

Each sequence step produces an independently testable deliverable. A failed model
license or qualification gate stops the production work before TediaPros exposes
an unsupported or misleading feature.

## Primary upstream evidence

- [ONNX Runtime DirectML execution provider](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)
- [ONNX Runtime CUDA execution provider](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)
- [Meta Demucs repository and documented memory behavior](https://github.com/facebookresearch/demucs)
- [Ultimate Vocal Remover GUI repository and attribution notice](https://github.com/Anjok07/ultimatevocalremovergui)
- [Python Audio Separator reference implementation](https://github.com/nomadkaraoke/python-audio-separator)
