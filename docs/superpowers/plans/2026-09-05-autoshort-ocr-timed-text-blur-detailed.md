# Auto Short OCR-Timed Text Blur Detailed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement two mutually exclusive Auto Short blur modes so automatic mode scans every qualifying RapidOCR text box in the selected region, derives subtitle timing and blur geometry from one validated visual timeline, and publishes only a fully validated masked render.

**Architecture:** The renderer sends only persisted mode/profile and normalized regions. Electron Main owns canonical display geometry, capability proof, sidecar validation, SRT projection, mask generation, transactional rendering, checkpoint invalidation, redacted audit data, and cleanup; OCR engine 1.1.0 owns sampled-frame analysis and emits one bounded `ocr-visual-cues/1` sidecar. A lossless FFV1 grayscale mask feeds one constant-size `maskedmerge` graph, while the existing manual rectangle graph remains isolated and behaviorally unchanged.

**Tech Stack:** Electron 34, React 19, TypeScript 5.7, Node.js 20 test runner, Python 3.12.10, RapidOCR/ONNX Runtime, OpenCV, FFmpeg/FFprobe with FFV1 and `maskedmerge`, PyInstaller, electron-vite, electron-builder, GitHub immutable runtime assets.

**Spec:** `docs/superpowers/specs/2026-09-04-autoshort-ocr-timed-text-blur-design.md`

**Base plan:** `docs/superpowers/plans/2026-09-04-autoshort-ocr-timed-text-blur.md`

**Planning baseline:** commit `f7ce00dd8b6627ef8564a7422853243b25d06769`. Line anchors below refer to that commit; if earlier tasks move a symbol, locate it by the named symbol rather than by stale line number.

## Authority and execution rules

- The approved spec controls product behavior. This runbook supersedes only the procedural detail in the base plan.
- Execute tasks in numeric order. Do not combine commits or begin a dependent task before its entry gate is green.
- At implementation time, use `superpowers:using-git-worktrees` from the latest commit containing the spec, base plan, and this runbook.
- Preserve the unrelated untracked `SESSION_CHAT_LOG.md` in the original checkout. Never stash, stage, edit, move, or delete it.
- Use RED-GREEN-REFACTOR for every production change. Capture the named RED failure before writing the implementation.
- Run `npm run test:local-runtime`, never `npm test`; this repository has no `npm test` script.
- Use `apply_patch` for hand edits. Stage only paths listed in the current task and run `git diff --check` before every commit.
- Do not use PATH fallbacks for OCR, FFmpeg, or FFprobe. Resolve only managed runtime paths or explicit task-owned fixture paths.
- Spawn every new child with `shell: false` and `windowsHide: true`, register it with `trackChildProcess`, bound stdout/stderr, and settle only after `close` or `error`.
- Automatic blur fails closed through the publication commit point. OCR, sidecar, no-box, mask, render, validation, cancellation, or promotion failure must leave no new final-name output. After atomic promotion, artifact copying, checkpoint deletion, and UI notification are best-effort housekeeping: they may emit a sanitized warning but must not retroactively mark the already-published item as failed.
- Never send raw visual timelines, box coordinates, sidecar paths, mask paths, or work paths through preload/renderer IPC.
- Never place raw recognized text, box coordinates, absolute media/work paths, sidecar paths, mask paths, or mask bytes in ordinary logs, UI messages, audits, checkpoints, or success artifacts.
- The OCR done event may carry the exact engine-output and sidecar paths only as private machine transport. Main validates them immediately and never echoes them.
- runtime-v4 remains immutable. Local verification must not create, mutate, publish, overwrite, or delete a runtime-v4 release or tag.
- No task in this plan uploads or publishes a GitHub release. Publication requires a separate explicit user decision after all applicable gates pass.

## Resolved implementation decisions

These decisions remove ambiguities from the base plan without changing the approved product scope.

| Topic | Locked behavior |
|---|---|
| Video duration | `videoDurationSeconds` is the positive video-stream duration. Use positive format duration only when the selected video stream omits duration. Keep container duration separately for legacy/final-media compatibility; never let longer audio inflate OCR frame count. |
| Display size | Normalize finite rotations modulo 360 and accept only 0/90/180/270. Convert SAR width with `max(2, floor((codedWidth * sarNum / sarDen) / 2) * 2)`, convert coded height with the same even-floor rule, then swap for 90/270. |
| Normalized regions | Preserve current behavior: multiply by canonical display dimensions, `Math.round` every edge, clamp to frame bounds, then reject empty/inverted results. |
| Geometry fingerprint | SHA-256 of stable JSON keys in this order: coded width, coded height, normalized rotation, SAR numerator, SAR denominator, video start, display width, display height. Duration is not part of the fingerprint. |
| OCR sampling | Files are contiguous `f000000.png`, `f000001.png`, and so on. Sample `k` represents `[k/8, min((k+1)/8, videoDurationSeconds))`. |
| Sidecar names | Main creates a unique item OCR directory and passes `source.engine.srt` plus `visual-cues.json`; the engine may return only those exact paths. Main writes authoritative `source.srt` after validation. |
| Path safety | Before reading a returned file: reject `lstat().isSymbolicLink()`, require `stat().isFile()`, compare `realpath` against the `realpath` root using `path.relative`, and reject reparse/junction escapes through real-parent validation. |
| Fast profile | Keep `NG_DOI = 0.45`; invoke RapidOCR exactly once for every preliminary segment's stable frame. Delete the `NG_TRUNG` previous-text reuse branch. |
| Box inclusion | Include non-empty text with recognition confidence strictly greater than `0.5` whenever the true RapidOCR polygon has positive-area intersection with the scan region. Clip polygon first, then derive its AABB. |
| Gap fill | Fill exactly one absent sample only when normalized segment text is equal and every box has a deterministic one-to-one match with IoU at least `0.5` and width/height ratios within inclusive `0.75..1.33`. |
| Mask counts | `activeFrameCount = ceil(videoDurationSeconds * 8)`. `totalFrameCount = activeFrameCount + 1`; the extra frame is always completely black. |
| Blur strength | Automatic blur uses the existing manual policy `max(8, round(displayHeight * 0.03))`. Small synthetic fixtures therefore use sigma 8; 1080-high display space uses sigma 32. |
| Final output | Reject a pre-existing final path before rendering and recheck immediately before promotion. The application-wide single-flight guard prevents internal races. Never delete or overwrite a pre-existing final file. |
| Runtime capability | A checked-in input capability is an intended requirement. Only version/probe intersection or the staged native FFmpeg probe is verified evidence; generated manifests must not claim an unproven feature. |
| Visual progress privacy | Visual-sidecar runs emit phase/count-only progress. Legacy ScreenText runs may retain current recognized-text progress because their output contract is unchanged. |

## Ownership and dependency map

| Data | Creator | Consumers | Forbidden destinations |
|---|---|---|---|
| `blurMode`, `ocrBlurProfile`, normalized regions | Renderer | request validator, readiness, coordinator | mask writer internals |
| `CanonicalDisplayGeometry` | Main FFprobe parser | OCR CLI, region conversion, mask validator, burn graph | renderer-supplied filter strings |
| raw `ocr-visual-cues/1` sidecar | OCR engine | Main sidecar reader only | preload, renderer, checkpoint, audit, success artifact |
| validated visual timeline | Main validator | SRT projection, mask planner, coordinator memory | IPC, disk persistence after item finishes |
| FFV1 mask | Main mask writer | `burnAutoShort` only | public `BurnReq`, checkpoint, audit, artifact folder |
| hidden partial MP4 | `burnAutoShort` | final validator and promotion | final basename before validation |
| final MP4 | `burnAutoShort` after validation | artifact preservation and user output | cleanup routine |

Task dependency order:

| Task | Requires | Review gate before next task |
|---|---|---|
| 1. Contract and test harness | clean baseline | types, migration, IPC boundary green |
| 2. Canonical geometry | Task 1 | rotations/SAR/duration/filter tests green |
| 3. Timeline domain | Tasks 1–2 types | strict validation, SRT, mask-plan tests green |
| 4. OCR engine 1.1 | Task 3 schema | Python domain/CLI tests green |
| 5. Main OCR validation | Tasks 2–4 | capability/path/sidecar tests green |
| 6. Mask writer | Tasks 2–3 | pure raster plus managed FFmpeg tests green |
| 7. Burn and publication | Tasks 2 and 6 | manual regression and transaction tests green |
| 8. Readiness/probe | Tasks 1, 4, 6, 7 | dependency matrix and native probe green |
| 9. Coordinator/checkpoint | Tasks 1–8 | single-OCR/fail-closed/cleanup matrix green |
| 10. Renderer | Tasks 1 and 9 events | typecheck, UI source tests, build green |
| 11. runtime-v5 | Tasks 4 and 8 | release-contract tests green; no publication |
| 12. Acceptance | Tasks 1–11 | all available evidence recorded honestly |

## One-time implementation preflight

- [ ] **Preflight 1: Create or enter the isolated implementation worktree**

Invoke `superpowers:using-git-worktrees` using the latest documentation commit. Do not create the worktree inside the repository directory.

- [ ] **Preflight 2: Confirm repository identity and base commit**

Run:

~~~powershell
git rev-parse --show-toplevel
git branch --show-current
git log -1 --format='%H %s'
git status --short
~~~

Expected: root is `F:/Son/tool/TediaPros` or the isolated worktree for that repository; branch is non-empty; the latest commit contains this runbook; no implementation file is already modified.

- [ ] **Preflight 3: Capture baseline type and local-runtime evidence**

Run:

~~~powershell
npm run typecheck
npm run test:local-runtime
npm run test:subtitles
~~~

Expected: all three commands exit 0 before feature work. If a baseline fails, stop feature work and diagnose it separately with `superpowers:systematic-debugging`.

- [ ] **Preflight 4: Record managed runtime availability without installing anything**

Run:

~~~powershell
$managedFfmpeg = Join-Path $env:APPDATA 'tedia-pros\bin\ffmpeg\ffmpeg.exe'
$managedFfprobe = Join-Path $env:APPDATA 'tedia-pros\bin\ffmpeg\ffprobe.exe'
[pscustomobject]@{
  FfmpegExists = Test-Path -LiteralPath $managedFfmpeg -PathType Leaf
  FfprobeExists = Test-Path -LiteralPath $managedFfprobe -PathType Leaf
} | Format-List
~~~

Expected: availability is recorded. Absence does not block Tasks 1–5; native portions of Tasks 6, 8, and 12 remain explicitly pending until a managed fixture is available.

---

### Task 1: Lock the product contract, migration, IPC boundary, and focused test runner

**Entry gate:** one-time baseline is green.

**Files:**
- Create: `src/shared/autoShortOcrBlur.ts`
- Create: `tests/autoshort-ocr-contract.test.ts`
- Modify: `src/shared/types.ts:273-309`
- Modify: `src/shared/types.ts:757-923`
- Modify: `src/shared/autoShortContract.ts:98-130`
- Modify: `src/shared/autoShortContract.ts:134-270`
- Modify: `src/main/index.ts:956-986`
- Modify: `src/main/ocr.ts:16-31`
- Modify: `src/preload/index.ts:181-204`
- Modify: `src/renderer/src/components/AutoShort.tsx:149-220`
- Modify: `src/renderer/src/components/AutoShort.tsx:824-900`
- Modify: `scripts/run-autoshort-pipeline.ts`
- Modify: `scripts/run-local-runtime-tests.mjs:1-80`
- Modify: `tests/local-runtime.test.ts` only for existing typed Auto Short fixtures

**Consumes:** existing `AutoShortConfig`, `AutoShortDependencyConfig`, `AutoShortNormalizedRegion`, validation helpers, renderer persistence helper, and OCR status IPC.

**Produces:**

~~~ts
export type AutoShortBlurMode = 'manual' | 'ocr-auto'
export type AutoShortOcrBlurProfile = 'accurate' | 'fast'

export interface PixelRegion {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function isAutomaticOcrBlur(
  config: Pick<AutoShortConfig, 'lamMo' | 'blurMode'>
): boolean

export function autoShortNeedsOcr(
  config: Pick<AutoShortConfig, 'subtitleMethod' | 'lamMo' | 'blurMode'>
): boolean

export function effectiveAutoShortOcrProfile(
  config: Pick<AutoShortConfig, 'lamMo' | 'blurMode' | 'ocrBlurProfile'>
): AutoShortOcrBlurProfile

export function normalizeAutoShortBlurMode(value: unknown): AutoShortBlurMode

export function normalizeAutoShortOcrBlurProfile(value: unknown): AutoShortOcrBlurProfile
~~~

- [ ] **Step 1.1: Refactor the local-runtime runner into one explicit basename registry**

Replace the duplicated entrypoint/result variables with this structure and keep all existing test basenames:

~~~js
const knownTests = [
  'local-runtime.test',
  'canonical-runtime-migration.test',
  'e2e-autoshort.test',
  'release-tooling.test',
  'dubbing-plan.test',
  'separator-contract.test',
  'separator-runtime.test',
  'separator-pipeline.test',
  'autoshort-ocr-contract.test'
]

const requestedTests = process.argv.slice(2)
const selectedTests = requestedTests.length > 0 ? requestedTests : knownTests
for (const testName of selectedTests) {
  if (!knownTests.includes(testName)) throw new Error(`Unknown local-runtime test: ${testName}`)
}

await build({
  entryPoints: selectedTests.map((testName) => `tests/${testName}.ts`),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outdir: outDir,
  sourcemap: false,
  plugins: [electronMockPlugin]
})

const results = selectedTests.map((testName) =>
  spawnSync(process.execPath, ['--test', join(outDir, `${testName}.js`)], { stdio: 'inherit' })
)
if (results.some((result) => result.status !== 0)) process.exit(1)
~~~

- [ ] **Step 1.2: Run the unchanged baseline suites through the refactored registry**

Run `npm run test:local-runtime`.

Expected: every pre-existing suite still runs and exits 0. This proves the harness refactor itself did not hide a test.

- [ ] **Step 1.3: Create the complete typed request fixture**

Add to `tests/autoshort-ocr-contract.test.ts`:

~~~ts
function autoShortRequest(config: Partial<AutoShortConfig> = {}): AutoShortStartRequest {
  return {
    items: [{ id: 'video-1', filePath: 'C:\\media\\input.mp4' }],
    config: {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      whisperDevice: 'cpu',
      ocrRegion: null,
      blurRegions: [],
      lamMo: false,
      blurMode: 'manual',
      ocrBlurProfile: 'accurate',
      translateTarget: 'none',
      translateProvider: 'local',
      ttsEnabled: false,
      voiceOverMode: false,
      audioMode: 'replace',
      originalAudioVolume: 20,
      outputDir: 'C:\\media\\out',
      ...config
    }
  }
}
~~~

- [ ] **Step 1.4: Add RED migration, validation, and policy tests**

Add named tests for all rows:

| Test name | Input | Exact assertion |
|---|---|---|
| `legacy config migrates to manual and accurate` | omit both new fields from an untyped request | validation succeeds; mode `manual`; profile `accurate` |
| `explicit unknown blur mode is rejected` | `blurMode: 'band'` | error `Chế độ làm mờ không hợp lệ.` |
| `explicit unknown OCR profile is rejected` | `ocrBlurProfile: 'balanced'` | error `Hồ sơ quét OCR không hợp lệ.` |
| `active automatic blur requires OCR region` | blur on, OCR-auto, region null | error `Tự động OCR cần một vùng OCR hợp lệ.` |
| `blur-off retains OCR-auto selection` | blur off, OCR-auto, fast | validation succeeds; no OCR need; persisted profile remains fast |
| `manual mode retains rectangles` | manual with two valid rectangles | both rectangle objects survive validation unchanged |
| `automatic mode retains but does not activate rectangles` | OCR-auto with two valid rectangles | validation retains them; `isAutomaticOcrBlur` is true |
| `OCR subtitle methods still need OCR` | OCR and Whisper+OCR with blur off | `autoShortNeedsOcr` true |
| `persisted mode normalizer rejects stale values` | `undefined`, `null`, `band`, `ocr-auto` | first three return `manual`; canonical value is preserved |
| `persisted profile normalizer rejects stale values` | `undefined`, `null`, `balanced`, `fast` | first three return `accurate`; canonical value is preserved |

- [ ] **Step 1.5: Run the focused suite and capture RED**

Run:

~~~powershell
npm run test:local-runtime -- autoshort-ocr-contract.test
~~~

Expected: esbuild or assertions fail because new types/policy/migration do not exist. Existing production code has not yet changed.

- [ ] **Step 1.6: Add the shared types**

In `src/shared/types.ts`, add `PixelRegion`, the two unions, required `blurMode` and `ocrBlurProfile` fields on `AutoShortConfig`, and required `features: string[]` on `OcrEngineStatus`. Extend `AutoShortDependencyConfig` with exactly `lamMo`, `blurMode`, and `ocrBlurProfile` while retaining current optional device/audio fields.

- [ ] **Step 1.7: Add missing-only migration and exact validation**

In `migrateLegacyConfig`, add:

~~~ts
blurMode: raw.blurMode === undefined ? 'manual' : raw.blurMode,
ocrBlurProfile: raw.ocrBlurProfile === undefined ? 'accurate' : raw.ocrBlurProfile
~~~

In `validateConfigRecord`, validate explicit values before returning the typed config:

~~~ts
if (raw.blurMode !== 'manual' && raw.blurMode !== 'ocr-auto') {
  return 'Chế độ làm mờ không hợp lệ.'
}
if (raw.ocrBlurProfile !== 'accurate' && raw.ocrBlurProfile !== 'fast') {
  return 'Hồ sơ quét OCR không hợp lệ.'
}
if (raw.lamMo === true && raw.blurMode === 'ocr-auto') {
  if (!isRecord(raw.ocrRegion) || region(raw.ocrRegion, 'Vùng OCR') !== null) {
    return 'Tự động OCR cần một vùng OCR hợp lệ.'
  }
}
~~~

Continue validating and returning `blurRegions` in both modes.

- [ ] **Step 1.8: Implement the pure policy module**

Create `src/shared/autoShortOcrBlur.ts`:

~~~ts
import type { AutoShortConfig, AutoShortOcrBlurProfile } from './types'

export function isAutomaticOcrBlur(
  config: Pick<AutoShortConfig, 'lamMo' | 'blurMode'>
): boolean {
  return config.lamMo === true && config.blurMode === 'ocr-auto'
}

export function autoShortNeedsOcr(
  config: Pick<AutoShortConfig, 'subtitleMethod' | 'lamMo' | 'blurMode'>
): boolean {
  return isAutomaticOcrBlur(config) ||
    config.subtitleMethod === 'ocr' ||
    config.subtitleMethod === 'whisper-ocr'
}

/** Use only when selecting an Auto Short OCR invocation/checkpoint profile. */
export function effectiveAutoShortOcrProfile(
  config: Pick<AutoShortConfig, 'lamMo' | 'blurMode' | 'ocrBlurProfile'>
): AutoShortOcrBlurProfile {
  return isAutomaticOcrBlur(config) ? config.ocrBlurProfile : 'fast'
}

export function normalizeAutoShortBlurMode(value: unknown): AutoShortBlurMode {
  return value === 'ocr-auto' ? 'ocr-auto' : 'manual'
}

export function normalizeAutoShortOcrBlurProfile(value: unknown): AutoShortOcrBlurProfile {
  return value === 'fast' ? 'fast' : 'accurate'
}
~~~

The inactive return value preserves the legacy fast OCR profile for source-cue evidence; it must never cause a visual OCR invocation by itself. The two normalizers are for renderer persistence only; request validation still rejects an explicit noncanonical value instead of silently repairing it.

- [ ] **Step 1.9: Harden the dependency IPC parser before widening it**

Extend the existing forbidden-key condition with:

~~~ts
'timedOcrBlurMask' in r ||
'maskPath' in r ||
'visualTimeline' in r ||
'visualCuesPath' in r
~~~

Then default missing dependency fields to `lamMo: false`, `blurMode: 'manual'`, and `ocrBlurProfile: 'accurate'`; reject explicitly unknown values with the same messages as the start validator.

- [ ] **Step 1.10: Thread only safe fields through preload and renderer payloads**

Add raw persisted states beside the existing blur state, derive their canonical values with `normalizeAutoShortBlurMode`/`normalizeAutoShortOcrBlurProfile`, and repair a stale stored value once in an effect. Use only the normalized values in `refreshAutoShortReadiness`, `installDependencies`, and `startBatch`; include `blurEnabled`, normalized `blurMode`, and normalized `ocrBlurProfile` in the relevant `useCallback`/effect dependency arrays so a mode/profile change cannot leave stale readiness. Add the three dependency fields to readiness/install payloads and add mode/profile to the start config. Do not render new controls yet. Do not add a preload method or type containing a timeline or mask.

- [ ] **Step 1.11: Make every OCR status branch return `features`**

Update `src/main/ocr.ts` so missing, unhealthy, and legacy executable status objects use `features: []`. Keep the current public OCR behavior otherwise unchanged until Task 5.

- [ ] **Step 1.12: Update every typed fixture and run GREEN**

Add `blurMode: 'manual'` and `ocrBlurProfile: 'accurate'` to existing typed CLI/test fixtures. Run:

~~~powershell
npm run typecheck
npm run test:local-runtime -- autoshort-ocr-contract.test
npm run test:local-runtime
git diff --check
~~~

Expected: all commands exit 0; the focused suite prints every named contract case.

- [ ] **Step 1.13: Review the boundary and commit**

Confirm `git diff -- src/preload/index.ts src/renderer/src/components/AutoShort.tsx` contains no path/timeline/mask IPC. Then:

~~~powershell
git add src/shared/types.ts src/shared/autoShortContract.ts src/shared/autoShortOcrBlur.ts src/main/index.ts src/main/ocr.ts src/preload/index.ts src/renderer/src/components/AutoShort.tsx scripts/run-autoshort-pipeline.ts scripts/run-local-runtime-tests.mjs tests/autoshort-ocr-contract.test.ts tests/local-runtime.test.ts
git diff --cached --check
git commit -m "feat(autoshort): add OCR blur contract"
~~~

**Exit gate:** contract, migration, policy, status defaults, and forbidden IPC fields are independently tested; no UI controls or OCR visual processing exists yet.

---

### Task 2: Make canonical display geometry and video-stream duration authoritative

**Entry gate:** Task 1 commit exists and its full local-runtime suite is green.

**Files:**
- Create: `src/main/canonicalDisplayGeometry.ts`
- Create: `tests/canonical-display-geometry.test.ts`
- Modify: `src/main/burn.ts:135-259`
- Modify: `src/main/burn.ts:373` (`probeBurnMedia` export)
- Modify: `src/main/autoshort.ts:553-569`
- Modify: `src/main/autoshort.ts:2310-2320`
- Modify: `scripts/run-local-runtime-tests.mjs`

**Consumes:** `PixelRegion`, `AutoShortNormalizedRegion`, the current FFprobe JSON, and legacy `Meta` fields.

**Produces:**

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

export interface CanonicalVideoTiming {
  videoDurationSeconds: number
  containerDurationSeconds: number
  frameRate?: number
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
): PixelRegion
~~~

- [ ] **Step 2.1: Register the geometry suite**

Append `canonical-display-geometry.test` to `knownTests` in the local-runtime runner.

- [ ] **Step 2.2: Write RED rotation and SAR tests**

Cover exact outputs for 0, 90, 180, 270, -90, and 450 degrees; reject 45 degrees, zero/negative coded dimensions, malformed SAR, zero denominator, and non-finite start time.

Use this fixture:

~~~ts
const pal = deriveCanonicalDisplayGeometry({
  codedWidth: 720,
  codedHeight: 576,
  rotation: 90,
  sampleAspectRatio: '16:15',
  videoStart: 1.25
})
assert.equal(pal.displayWidth, 576)
assert.equal(pal.displayHeight, 768)
assert.equal(
  canonicalOcrExtractionFilter(pal, 8),
  'setpts=PTS-STARTPTS,scale=576:768:flags=lanczos,setsar=1,fps=8'
)
~~~

- [ ] **Step 2.3: Write RED duration-selection tests**

Test the FFprobe-to-meta seam with these cases:

| Video stream duration | Format duration | Audio duration | `videoDurationSeconds` |
|---:|---:|---:|---:|
| 5.0 | 8.0 | 8.0 | 5.0 |
| absent | 8.0 | 8.0 | 8.0 |
| 0 | 8.0 | 8.0 | 8.0 |
| absent | absent | 8.0 | reject automatic path |

Assert container duration remains available separately and does not affect OCR sample count when stream duration is positive.

- [ ] **Step 2.4: Write RED region and fingerprint tests**

Assert normalized edges use `Math.round`, are clamped, and reject an empty result. Assert equal input objects create identical lowercase 64-character SHA-256 fingerprints and changing any of the eight fingerprint fields changes the digest.

- [ ] **Step 2.5: Run the focused suite and capture RED**

Run `npm run test:local-runtime -- canonical-display-geometry.test`.

Expected: module resolution fails for `canonicalDisplayGeometry` or its named exports.

- [ ] **Step 2.6: Implement strict rotation, SAR, and even-floor helpers**

Use these rules:

~~~ts
function evenFloor(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error('Kích thước video không hợp lệ.')
  return Math.max(2, Math.floor(value / 2) * 2)
}

function normalizeRotation(value: number | undefined): 0 | 90 | 180 | 270 {
  const raw = value ?? 0
  if (!Number.isFinite(raw)) throw new Error('Góc xoay video không hợp lệ.')
  const normalized = ((raw % 360) + 360) % 360
  if (normalized !== 0 && normalized !== 90 && normalized !== 180 && normalized !== 270) {
    throw new Error('Góc xoay video phải là bội số của 90 độ.')
  }
  return normalized
}
~~~

Parse SAR as two positive finite integers. Do not silently turn an explicitly malformed SAR into `1:1`; only a missing SAR defaults to `1:1`.

- [ ] **Step 2.7: Implement the stable geometry fingerprint**

Serialize one object literal in the locked key order and hash its UTF-8 bytes with SHA-256. Do not include duration, paths, frame rate, or renderer state.

- [ ] **Step 2.8: Extract FFprobe parsing into a testable pure function**

Make the selected video stream authoritative. Return legacy `w`, `h`, `giay`, and `videoDuration` during migration plus new `geometry`, `videoDurationSeconds`, and `containerDurationSeconds`. Select duration as:

~~~ts
const positive = (value: unknown): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
const videoDurationSeconds =
  positive(videoStream?.duration) ?? positive(parsed.format?.duration)
~~~

Automatic consumers must reject null duration; legacy manual consumers may retain their current fallback behavior until Task 7 completes the migration.

- [ ] **Step 2.9: Delegate both filter builders to canonical geometry**

`canonicalOcrExtractionFilter` always returns `setpts`, `scale`, `setsar`, `fps` in that order. `canonicalBurnDisplayFilter` preserves the existing manual no-op only when start is zero, SAR is square, and display dimensions already match decoded display space.

- [ ] **Step 2.10: Replace Auto Short's local region conversion**

Use `normalizedRegionToDisplayPixels` for OCR, subtitle, and blur regions after `probeBurnMedia` supplies geometry. Preserve region IDs/colors when converting manual rectangles.

- [ ] **Step 2.11: Run geometry GREEN and the full regression set**

Run:

~~~powershell
npm run typecheck
npm run test:local-runtime -- canonical-display-geometry.test
npm run test:local-runtime
git diff --check
~~~

Expected: exact rotation/SAR/duration/fingerprint/filter tests and all legacy suites pass.

- [ ] **Step 2.12: Commit the geometry boundary**

~~~powershell
git add src/main/canonicalDisplayGeometry.ts src/main/burn.ts src/main/autoshort.ts scripts/run-local-runtime-tests.mjs tests/canonical-display-geometry.test.ts
git diff --cached --check
git commit -m "refactor(video): centralize display geometry"
~~~

**Exit gate:** every later OCR/mask/burn component can consume one display geometry and one video-stream duration without consulting renderer dimensions or container audio duration.

---

### Task 3: Implement the strict visual-timeline domain, continuity rules, SRT projection, and lazy mask plan

**Entry gate:** Task 2 geometry and duration contracts are committed.

**Files:**
- Create: `src/shared/ocrVisualTimeline.ts`
- Create: `tests/ocr-visual-timeline.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `scripts/run-local-runtime-tests.mjs`

**Consumes:** `PixelRegion`, existing `SubtitleCue` including required `sourceIndex`, `AutoShortOcrBlurProfile`, geometry fingerprint, and video-stream duration.

**Produces:**

~~~ts
export interface OcrVisualBox extends PixelRegion {
  text: string
  confidence: number
}

export interface OcrVisualSegment {
  id: string
  startFrame: number
  endFrameExclusive: number
  start: number
  end: number
  text: string
  confidence: number
  boxes: OcrVisualBox[]
}

export interface OcrVisualTimeline {
  schemaVersion: 1
  protocol: 'ocr-visual-cues/1'
  video: {
    width: number
    height: number
    durationSeconds: number
    sampleFps: 8
    frameCount: number
    geometryFingerprint: string
  }
  profile: AutoShortOcrBlurProfile
  scanRegion: PixelRegion
  segments: OcrVisualSegment[]
}

export interface ExpectedOcrTimelineGeometry {
  width: number
  height: number
  durationSeconds: number
  sampleFps: 8
  geometryFingerprint: string
  scanRegion: PixelRegion
}

export interface PaddedMaskSegment {
  startFrame: number
  endFrameExclusive: number
  boxes: PixelRegion[]
}

export interface OcrMaskFramePlan {
  sampleFps: 8
  width: number
  height: number
  activeFrameCount: number
  totalFrameCount: number
  segments: PaddedMaskSegment[]
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

export function boxesForMaskFrame(
  plan: OcrMaskFramePlan,
  frameIndex: number
): PixelRegion[]
~~~

- [ ] **Step 3.1: Register the timeline suite**

Append `ocr-visual-timeline.test` to `knownTests`.

- [ ] **Step 3.2: Create one valid 100x60 fixture builder**

The fixture has 8 fps, duration 1 second, frame count 8, scan region `{x0:0,y0:0,x1:100,y1:60}`, and deterministic fingerprint `a` repeated 64 times. Override one field per negative test so failures identify one invariant.

- [ ] **Step 3.3: Add RED schema and numeric-validation tests**

Cover wrong schema/protocol/profile/fingerprint/dimensions/sample rate; NaN/Infinity; fractional frame indexes; negative frames; duplicate IDs; unordered/overlapping segments; invalid time formulas beyond epsilon `1e-6`; start not less than end; end beyond video duration; frame count inconsistent with sampled indexes.

- [ ] **Step 3.4: Add RED text, confidence, and box-validation tests**

Cover empty/whitespace text, confidence exactly `0.5`, more than 4,096 Unicode code points using `Array.from`, 65 boxes, empty/inverted/fractional/out-of-frame/out-of-scan boxes, and segment confidence not equal to the minimum retained box confidence.

- [ ] **Step 3.5: Add RED segment-ID and ordering tests**

Require engine IDs `accurate-<frameIndex>` or `fast-<startFrame>-<endFrameExclusive>`. Permit Main-generated gap IDs only from `stabilizeSingleSampleGaps`; raw engine input may not use the `gap-` prefix.

- [ ] **Step 3.6: Add RED gap-fill boundary tests**

Use table-driven cases for normalized text equality, one absent sample, two absent samples, IoU `0.49`/`0.50`, width and height ratios `0.74`/`0.75`/`1.33`/`1.34`, unequal box counts, unmatched text, touching-edge IoU zero, and input immutability.

- [ ] **Step 3.7: Add RED subtitle-projection tests**

Assert only adjacent/touching equal normalized text merges; first start and final end are retained; first segment ID becomes cue ID; cue `sourceIndex` is sequential from zero; line ordering remains stable; differing geometry does not prevent readable cue merge.

- [ ] **Step 3.8: Add RED lazy mask-plan tests**

Assert a source interval `[2,4)` becomes mask interval `[1,5)`, padding is `max(4,min(8,round(height*0.15)))`, padded boxes are clipped to scan/frame, only positive-area overlaps union, separate boxes remain separate, total frames are 9 for a one-second source, and `boxesForMaskFrame(plan, 8)` is empty. Add a segment `[7,8)` ending exactly at `activeFrameCount`; its safety expansion remains exclusive at 8 and must never paint terminal frame index 8.

- [ ] **Step 3.9: Run the focused suite and capture RED**

Run `npm run test:local-runtime -- ocr-visual-timeline.test`.

Expected: the new module or named exports are missing.

- [ ] **Step 3.10: Implement strict parsing before all transforms**

Export and enforce:

~~~ts
export const OCR_VISUAL_MAX_BYTES = 64 * 1024 * 1024
export const OCR_VISUAL_MAX_SEGMENTS = 100_000
export const OCR_VISUAL_MAX_BOXES_PER_SEGMENT = 64
export const OCR_VISUAL_MAX_TEXT_CODE_POINTS = 4_096
export const OCR_SAMPLE_FPS = 8 as const
~~~

Validate unknown input field-by-field, create fresh objects, and freeze or deep-copy returned arrays so caller mutation cannot alter the parsed raw object.

- [ ] **Step 3.11: Implement deterministic normalization and matching**

Normalize text with Unicode NFKC, whitespace collapse, trim, and locale-independent lowercase. Define IoU as positive intersection area divided by union area; edge contact is zero. For each sorted left box, choose the unused same-text right box with highest IoU and use right-array index as the tie breaker.

- [ ] **Step 3.12: Implement one-sample gap stabilization without mutation**

Fill only when the full one-to-one match succeeds. Build each synthetic box as the AABB union of its matched pair, use minimum confidence, and create ID `gap-<missingFrame>-<leftId>-<rightId>`. Return a new validated-shape timeline and leave longer gaps absent.

- [ ] **Step 3.13: Implement SRT projection with the existing `SubtitleCue` type**

Merge adjacent equal normalized text only in this function. Set `id` from the first visual segment, `start` from the first, `end` from the last, `text` from the first normalized group presentation, and `sourceIndex` from output order. Never feed projected cues back into mask planning.

- [ ] **Step 3.14: Implement the lazy mask plan**

Store padded segment ranges and boxes, not one buffer or box array per video frame. `boxesForMaskFrame` returns `[]` for the terminal index and otherwise finds ranges containing the index. Merge only boxes with positive-area overlap after padding.

- [ ] **Step 3.15: Run timeline GREEN and the full regression set**

Run:

~~~powershell
npm run typecheck
npm run test:local-runtime -- ocr-visual-timeline.test
npm run test:local-runtime
git diff --check
~~~

Expected: every cap/boundary/projection/mask-plan case and all prior suites pass.

- [ ] **Step 3.16: Commit the timeline domain**

~~~powershell
git add src/shared/types.ts src/shared/ocrVisualTimeline.ts scripts/run-local-runtime-tests.mjs tests/ocr-visual-timeline.test.ts
git diff --cached --check
git commit -m "feat(ocr): add canonical visual timeline"
~~~

**Exit gate:** untrusted sidecar-shaped input has one strict validator, while SRT and mask are separate immutable projections of its validated result.

---

### Task 4: Upgrade the Python OCR engine to protocol-compatible visual cues 1.1.0

**Entry gate:** Task 3 schema and timing rules are committed.

**Files:**
- Create: `engines/ocr-engine/visual_timeline.py`
- Create: `engines/ocr-engine/tests/__init__.py`
- Create: `engines/ocr-engine/tests/test_visual_timeline.py`
- Create: `engines/ocr-engine/tests/test_engine_cli.py`
- Modify: `engines/ocr-engine/engine.py:1-317`
- Modify: `engines/ocr-engine/ocr-engine.spec`
- Modify: `package.json:8-27`

**Consumes:** schema/caps/timing rules from Task 3, managed FFmpeg path, sibling FFprobe, canonical display dimensions, pixel scan region, and geometry fingerprint.

**Produces:**

~~~py
FEATURES = ["directml-fallback", "probe", "rapidocr", "visual-cues-v1"]

def build_accurate_timeline(frame_paths, detect, metadata, scan_region):
    """Return an ocr-visual-cues/1 dict with one retained geometry segment per qualifying sample."""

def build_fast_timeline(frame_paths, detect, metadata, scan_region, change_threshold=0.45):
    """Return one OCR geometry segment per OpenCV preliminary interval."""

def timeline_to_srt(timeline):
    """Return readable SRT derived from the same timeline object."""

def write_visual_timeline(path, timeline):
    """Atomically write bounded UTF-8 JSON to the caller-selected path."""
~~~

- [ ] **Step 4.1: Add the Python test script before engine changes**

Add this exact package script:

~~~json
"test:ocr-engine": "python -m unittest discover -s engines/ocr-engine/tests -p \"test_*.py\" -v"
~~~

- [ ] **Step 4.2: Create deterministic metadata and detection fixtures**

Use a two-frame 100x60 fixture with files `f000000.png` and `f000001.png`. The detector callable returns normalized tuples `(polygon, text, confidence)` and records every input path; domain tests must not load RapidOCR, FFmpeg, or the model.

- [ ] **Step 4.3: Add the accurate-profile RED test**

Use this complete behavior assertion:

~~~py
def test_accurate_detects_every_sample_and_preserves_each_geometry(self):
    calls = []

    def detect(path):
        calls.append(path)
        index = int(Path(path).stem[1:])
        return [(
            [(10 + index, 10), (30 + index, 10), (30 + index, 20), (10 + index, 20)],
            "hello",
            0.9,
        )]

    timeline = build_accurate_timeline(
        ["f000000.png", "f000001.png"],
        detect,
        metadata(width=100, height=60, duration_seconds=0.25, frame_count=2),
        {"x0": 0, "y0": 0, "x1": 100, "y1": 60},
    )
    self.assertEqual(calls, ["f000000.png", "f000001.png"])
    self.assertEqual(
        [(s["startFrame"], s["endFrameExclusive"], s["boxes"][0]["x0"])
         for s in timeline["segments"]],
        [(0, 1, 10), (1, 2, 11)],
    )
~~~

- [ ] **Step 4.4: Add the fast-profile RED matrix**

Assert `NG_DOI = 0.45`, preliminary intervals are half-open, the least-motion frame is deterministic, and RapidOCR is called exactly once for every interval even when adjacent masks have Jaccard distance below the old `NG_TRUNG` threshold. Assert a below-threshold brief change can be missed by fast but is retained by accurate.

- [ ] **Step 4.5: Add polygon-clipping and reading-order RED tests**

Cover polygons crossing each scan edge, rotated quadrilaterals, zero-area clipped polygons, confidence `0.5` versus `0.500001`, whitespace text, two lines, left-to-right words, and stable segment IDs. Require Sutherland-Hodgman clipping before AABB calculation; a center-point-only implementation must fail the tests.

- [ ] **Step 4.6: Add CLI RED tests**

Run `engine.py --version` without constructing RapidOCR and require exactly:

~~~json
{"type":"version","protocol":"ocr-local/1","engine":"rapidocr","version":"1.1.0","features":["directml-fallback","probe","rapidocr","visual-cues-v1"]}
~~~

Patch only the OCR constructor for the unit `--probe` test and require `ready: true`, the same protocol/engine/version, and the same sorted feature list. Add invalid-CLI cases for missing visual arguments, non-8 visual FPS, invalid display size, invalid scan rectangle, and non-64-hex fingerprint.

- [ ] **Step 4.7: Run Python RED**

Run:

~~~powershell
python -m unittest discover -s engines/ocr-engine/tests -p "test_*.py" -v
~~~

Expected: import/version/CLI assertions fail because `visual_timeline.py` and 1.1.0 features do not exist.

- [ ] **Step 4.8: Move pure mask/Jaccard/stable-frame helpers**

Move current helpers from `engine.py:49-170` into `visual_timeline.py`, preserve `NG_DOI = 0.45`, and delete `NG_TRUNG`. Keep imports injectable so domain tests use fixture arrays without model/runtime dependencies.

- [ ] **Step 4.9: Normalize RapidOCR output at one adapter boundary**

Implement an adapter that converts engine-specific result tuples into `(list[(float,float)], stripped_text, float_confidence)`. Reject malformed polygons, non-finite coordinates/confidence, empty text, and confidence not greater than `0.5` before timeline construction.

- [ ] **Step 4.10: Implement true polygon clipping and deterministic AABBs**

Clip successively against left, right, top, and bottom scan edges, compute shoelace area, reject non-positive area, then derive integer AABB using floor for minima and ceil for maxima. Clamp to display and scan bounds and reject empty rectangles.

- [ ] **Step 4.11: Implement accurate and fast segment construction**

Accurate calls detection for every contiguous sample and emits ID `accurate-k` only when that sample has qualifying boxes. Fast builds preliminary segments from every frame mask, selects one stable frame, calls detection once, and emits ID `fast-a-b` using half-open frames. Neither path reuses previous text/geometry.

- [ ] **Step 4.12: Make extraction filenames and dimensions auditable**

Build the filter only from validated CLI values:

~~~py
filter_value = (
    "setpts=PTS-STARTPTS,"
    f"scale={display_width}:{display_height}:flags=lanczos,"
    "setsar=1,fps=8"
)
~~~

Invoke the supplied managed FFmpeg with `shell=False`, `-hide_banner`, `-nostdin`, `-loglevel error`, `-start_number 0`, PNG output `f%06d.png`, and a bounded stderr tail. Enumerate only names matching `^f[0-9]{6}\.png$`, require contiguous indexes beginning at zero, and verify every decoded image shape equals `(displayHeight, displayWidth, 3)`.

- [ ] **Step 4.13: Probe video-stream duration through sibling FFprobe**

Resolve FFprobe only as a sibling of `args.ffmpeg`. Query the selected video stream and format duration, choose positive stream duration first and positive format duration only as fallback, and set `video.frameCount` from actual contiguous decoded samples. Reject samples whose derived start is not less than the chosen duration.

- [ ] **Step 4.14: Serialize the sidecar and legacy SRT atomically**

Encode compact UTF-8 JSON, enforce 64 MiB/segment/box/text caps before writing, write a random sibling temp, flush/close, then `os.replace` the exact caller-selected `visual-cues.json`. Derive `source.engine.srt` from that same timeline after sidecar success.

- [ ] **Step 4.15: Separate visual and legacy JSONL privacy behavior**

For visual mode, emit only generic status/count progress and one done object containing exact requested output/sidecar paths plus aggregate counts/profile/band values. Do not print recognized text or coordinates. For legacy mode without `--visual-cues-output`, preserve current ScreenText recognized-text progress.

- [ ] **Step 4.16: Update CLI and PyInstaller entry points**

Default `--scan-profile` to `fast`. When visual output is present, require output path, display dimensions, fingerprint, all four scan edges, `--fps 8`, and explicit FFmpeg. Import `visual_timeline.py` from `engine.py` so PyInstaller includes it; add an explicit hidden import only if the clean PyInstaller test proves discovery fails.

- [ ] **Step 4.17: Run Python GREEN**

Run:

~~~powershell
npm run test:ocr-engine
& python engines/ocr-engine/engine.py --version
git diff --check
~~~

Expected: unit tests exit 0; `--version` prints one valid JSON line without loading a model; no raw path/text appears outside the allowed done transport.

- [ ] **Step 4.18: Commit the engine layer**

~~~powershell
git add engines/ocr-engine/visual_timeline.py engines/ocr-engine/engine.py engines/ocr-engine/ocr-engine.spec engines/ocr-engine/tests/__init__.py engines/ocr-engine/tests/test_visual_timeline.py engines/ocr-engine/tests/test_engine_cli.py package.json
git diff --cached --check
git commit -m "feat(ocr-engine): emit visual cue sidecars"
~~~

**Exit gate:** deterministic Python tests prove both profiles and CLI contracts; real packaged model readiness remains intentionally unclaimed until Task 12.

---

### Task 5: Validate OCR capabilities and sidecars in Electron Main

**Entry gate:** the 1.1.0 Python contract and Task 3 TypeScript schema are green.

**Files:**
- Create: `src/main/safeContainedPath.ts`
- Create: `tests/autoshort-ocr-runtime.test.ts`
- Modify: `src/main/runtimeProbes.ts:1-205`
- Modify: `src/main/ocr.ts:1-283`
- Modify: `scripts/run-local-runtime-tests.mjs`
- Modify: `tests/canonical-runtime-migration.test.ts:1-190`

**Consumes:** `CanonicalDisplayGeometry`, `PixelRegion`, strict timeline functions, managed OCR/FFmpeg resolution, Task 4 JSONL events.

**Produces:**

~~~ts
export interface RuntimeProbeResult {
  healthy: boolean
  version?: string | null
  protocol?: string | null
  features?: string[]
  message?: string
}

export interface AutoShortOcrVideoOptions {
  input: string
  outputDir: string
  scanRegion: PixelRegion
  profile: AutoShortOcrBlurProfile
  geometry: CanonicalDisplayGeometry
  videoDurationSeconds: number
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

export async function assertContainedRegularFile(
  candidate: string,
  root: string,
  label: string
): Promise<string>
~~~

- [ ] **Step 5.1: Register the runtime suite and create injected child fixtures**

Append `autoshort-ocr-runtime.test` to `knownTests`. Build fixture executables/scripts that emit controlled JSONL and create controlled output files inside a unique test root; never depend on the real OCR model for these contract tests.

- [ ] **Step 5.2: Add RED version/probe feature tests**

Cover sorted deduplicated intersection, a feature present in only one event, malformed arrays, duplicate strings, wrong protocol/engine/version, probe `ready:false`, and a new manifest capability absent from the intersection.

Lock compatibility rules:

| Probe context | Legacy feature array | Result |
|---|---|---|
| installed executable without manifest requirements | absent | generically healthy with `features: []` |
| staged/new manifest declaring `visual-cues-v1` | absent from either event | unhealthy |
| staged/new manifest with all declared features in both events | complete | healthy with sorted intersection |

- [ ] **Step 5.3: Add RED exact-output and path-safety tests**

Main must pass `<ocrDir>/source.engine.srt` and `<ocrDir>/visual-cues.json`. Reject done paths that are different, relative, outside root, directories, symlinks/junctions, files through an escaping parent, missing, or larger than 64 MiB.

- [ ] **Step 5.4: Add RED sidecar-authority tests**

Write a valid sidecar and a conflicting engine SRT. Assert Main ignores engine SRT content, stabilizes the timeline, generates `<ocrDir>/source.srt`, returns cues/timeline counts from validated data, and removes `source.engine.srt` before resolving.

- [ ] **Step 5.5: Add RED malformed/empty/cancellation tests**

Cover malformed JSONL, overlong JSONL line, nonzero exit, malformed JSON file, geometry/fingerprint/duration/scan mismatch, empty segments, zero total boxes, abort before spawn, abort after spawn, and child that closes after termination. Require promise settlement only after `close`/`error` and sanitized Vietnamese errors without raw paths/text.

- [ ] **Step 5.6: Run the focused suite and capture RED**

Run `npm run test:local-runtime -- autoshort-ocr-runtime.test`.

Expected: missing API/features/path helper assertions fail.

- [ ] **Step 5.7: Implement the reusable contained-file check**

Validate in this order: absolute inputs, `realpath(root)`, candidate `lstat`, reject symbolic-link/Windows reparse-point candidates, require candidate `stat().isFile()`, `realpath(candidate)`, then `relative(rootReal,candidateReal)`. Accept only a non-empty relative path that is neither `..` nor absolute. Walk and validate real parents when creating a future output so junction/reparse escapes fail before spawn.

- [ ] **Step 5.8: Parse OCR version/probe events once**

Create a strict event parser that accepts only non-empty string feature arrays. Compute:

~~~ts
const verifiedFeatures = [...new Set(versionFeatures)]
  .filter((feature) => probeFeatures.includes(feature))
  .sort()
~~~

For `probeRuntimeAsset`, require every `spec.capabilities` entry in `verifiedFeatures`. For `probeRuntimeExecutable` with no manifest requirements, allow a valid legacy engine with `features: []`; automatic readiness will reject it later.

- [ ] **Step 5.9: Propagate verified features through OCR status**

Make `probeOcr` and every `ocrEngineStatus` branch return `features`, never raw event arrays. Do not infer `visual-cues-v1` from version number or manifest text.

- [ ] **Step 5.10: Factor a bounded settled JSONL child runner**

Use `shell: false`, `windowsHide: true`, `trackChildProcess`, maximum 64 KiB per JSONL line, maximum 256 KiB retained stdout metadata, and maximum 8 KiB sanitized stderr tail. On abort, terminate the tree and resolve/reject only after `close` or `error`.

- [ ] **Step 5.11: Preserve the public positional OCR API**

Keep `ocrVideo(input, outputDir, y0, y1, x0, x1, formats, onProgress, signal, sampleFps)` and its preload response compatible for ScreenText. Route only child collection through the shared internal runner.

- [ ] **Step 5.12: Implement the main-only visual run**

Create a unique child directory under the item-owned output root, derive fixed filenames, and pass every approved visual CLI argument plus the managed FFmpeg path. Do not accept output filenames or a sidecar path from renderer/config input.

- [ ] **Step 5.13: Validate visual results in one fixed order**

After exit code zero: exact done-path equality, contained regular-file validation, size cap, UTF-8 read, JSON parse, strict timeline validation against geometry/duration/scan, one-sample stabilization, nonempty segment and box totals, authoritative SRT projection/write, then removal of engine SRT. Register the Main-generated sidecar candidate for cleanup before parsing; never register a different engine-reported path until exact-path and containment checks succeed.

- [ ] **Step 5.14: Run GREEN and full regression**

Run:

~~~powershell
npm run typecheck
npm run test:local-runtime -- autoshort-ocr-runtime.test
npm run test:local-runtime
git diff --check
~~~

Expected: all path/capability/authority/cancellation tests and prior suites exit 0.

- [ ] **Step 5.15: Commit the Main OCR boundary**

~~~powershell
git add src/main/safeContainedPath.ts src/main/runtimeProbes.ts src/main/ocr.ts scripts/run-local-runtime-tests.mjs tests/autoshort-ocr-runtime.test.ts tests/canonical-runtime-migration.test.ts
git diff --cached --check
git commit -m "feat(ocr): validate visual sidecars locally"
~~~

**Exit gate:** only Electron Main can obtain a validated visual timeline; public OCR remains compatible and no temporary visual data crosses IPC.

---

### Task 6: Stream, validate, and clean a lossless timed OCR mask

**Entry gate:** validated timeline and contained-path helpers are committed.

**Files:**
- Create: `src/main/ocrMask.ts`
- Create: `tests/ocr-mask.test.ts`
- Modify: `scripts/run-local-runtime-tests.mjs`

**Consumes:** validated `OcrVisualTimeline`, lazy `OcrMaskFramePlan`, `boxesForMaskFrame`, managed FFmpeg/FFprobe paths, `assertContainedRegularFile`, `trackChildProcess`, `AbortSignal`.

**Produces:**

~~~ts
export interface TimedOcrBlurMask {
  path: string
  width: number
  height: number
  durationSeconds: number
  sampleFps: 8
  visualCueCount: number
  boxSegmentCount: number
}

export function rasterizeOcrMaskFrame(
  width: number,
  height: number,
  boxes: readonly PixelRegion[]
): Buffer

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
  options: {
    ffmpegPath: string
    ffprobePath: string
    itemWorkDir: string
    signal: AbortSignal
  }
): Promise<void>
~~~

- [ ] **Step 6.1: Register the mask suite and isolate its temp root**

Append `ocr-mask.test` to `knownTests`. Each test uses `mkdtemp(join(tmpdir(), 'tedia-ocr-mask-'))` and removes only that resolved root in `finally`.

- [ ] **Step 6.2: Add pure RED raster tests**

Use width 32, height 24, duration 0.5, and interval `[1,3)`. Assert temporal padding paints frames 0 through 3, active count is 4, total count is 5, frame 4 is black, separate boxes remain separate white islands, row boundaries are correct, and black-only input rejects before any spawn. Add a second segment ending exactly at `endFrameExclusive === activeFrameCount`; clamp its expanded exclusive end to `activeFrameCount` and prove terminal index `activeFrameCount` remains black. Never treat an exclusive end as a painted index.

- [ ] **Step 6.3: Lock exact raw-frame MD5 values in the fixture**

Compute expected hashes from `createHash('md5').update(frame).digest('hex')`; assert the terminal expected hash equals the hash of `Buffer.alloc(32 * 24)`. Do not hardcode hashes generated by FFmpeg as the source of truth.

- [ ] **Step 6.4: Add conditional native RED tests**

Resolve only the canonical managed fixture. If missing, skip with `managed FFmpeg fixture unavailable; native mask assertion skipped.` If present, require FFV1 stream/dimensions/count/rate/timestamps/duration and every framemd5 record.

- [ ] **Step 6.5: Add RED containment, corruption, process, and abort tests**

Cover outside output, symlink/junction escape where supported, non-regular output, nonzero fake FFmpeg, stdin write failure, corrupt MKV, wrong dimensions/count/hash, abort while child is alive, and validation failure. Assert no requested or partial mask remains and settlement happens after child close/error.

- [ ] **Step 6.6: Run the focused suite and capture RED**

Run `npm run test:local-runtime -- ocr-mask.test`.

Expected: missing mask module/functions fail; conditional native test does not count as green proof if skipped.

- [ ] **Step 6.7: Implement one-frame rasterization**

Allocate `Buffer.alloc(width * height)`. For each validated integer AABB and each `y` in `[y0,y1)`, call `frame.fill(0xff, y * width + x0, y * width + x1)`. Reject boxes outside bounds instead of clamping a second time.

- [ ] **Step 6.8: Create and validate one job-local partial name**

Require absolute item root and output, validate output parent containment, reject existing output, and create `join(itemWorkDir, '.ocr-mask.' + randomUUID() + '.partial.mkv')`. Never use a shared temp filename.

- [ ] **Step 6.9: Spawn the exact rawvideo encoder**

Use this argument order, replacing dimensions/path only:

~~~text
-hide_banner -nostdin -nostats -loglevel error
-f rawvideo -pixel_format gray -video_size 32x24 -framerate 8
-i pipe:0 -an -c:v ffv1 -level 3 -pix_fmt gray <partial.mkv>
~~~

Spawn with `shell: false`, `windowsHide: true`, track the child, and keep at most 8 KiB of sanitized stderr.

- [ ] **Step 6.10: Stream frames with backpressure and settled cancellation**

For indexes `0..totalFrameCount-1`: check `signal.aborted`, rasterize one frame, hash it, write it, await `drain` when needed, then release the reference. End stdin once, handle stdin error, and wait for child `close`/`error` before continuing or cleaning.

- [ ] **Step 6.11: Probe stream metadata and every timestamp**

Run sibling FFprobe with:

~~~text
-v error -select_streams v:0
-show_frames
-show_entries stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,time_base,start_pts,duration
-show_entries frame=best_effort_timestamp_time,pkt_pts_time,pkt_dts_time
-show_format -of json <partial.mkv>
~~~

Bound output to 32 MiB. Require one video and no audio/data/subtitle, FFV1, exact dimensions, finite positive time base/rate, first PTS zero, and exact frame count. For every decoded frame, choose the first finite value from `best_effort_timestamp_time`, `pkt_pts_time`, then `pkt_dts_time`; reject the frame if all are absent. Require timestamp `k/8` within half one muxer tick. Accept Matroska time base `1/1000`; stream-level rate/duration alone never satisfies cadence validation.

- [ ] **Step 6.12: Compare decoded framemd5 records on the fly**

Run:

~~~text
-hide_banner -nostdin -nostats -loglevel error -i <partial.mkv>
-map 0:v:0 -an -pix_fmt gray -f framemd5 -hash md5 -
~~~

Ignore comment headers, parse one data row at a time with a bounded line buffer, compare index and MD5 against expected hashes, reject extra/missing rows, and separately assert final actual/expected hash is black.

- [ ] **Step 6.13: Enforce duration and non-black requirements**

Require decoded duration at least source duration and at most source duration plus `2/8` seconds. Require at least one active frame with a non-black expected hash before promotion.

- [ ] **Step 6.14: Promote only the validated mask and clean every failure**

Rename partial to the non-existing requested mask only after all validation passes, validate the promoted file as contained/regular, and return aggregate metadata. In `finally`, settle children and remove partial; on any failure also remove only the task-owned requested mask.

- [ ] **Step 6.15: Run mask GREEN and full regression**

Run:

~~~powershell
npm run typecheck
npm run test:local-runtime -- ocr-mask.test
npm run test:local-runtime
git diff --check
~~~

Expected: pure tests pass. Native mask evidence must be labeled PASS if run or SKIPPED with the exact reason; a skip is not packaged/native acceptance.

- [ ] **Step 6.16: Commit the mask writer**

~~~powershell
git add src/main/ocrMask.ts scripts/run-local-runtime-tests.mjs tests/ocr-mask.test.ts
git diff --cached --check
git commit -m "feat(autoshort): generate timed OCR masks"
~~~

**Exit gate:** a validated timeline can become one contained FFV1 mask whose geometry, cadence, contents, and terminal black frame are proven before any render consumes it.

---

### Task 7: Add deterministic burn inputs, one masked graph, and transactional Auto Short publication

**Entry gate:** Task 6 can create and validate a timed mask; Task 2 supplies canonical display metadata.

**Files:**
- Create: `src/main/burnInputPlanner.ts`
- Create: `tests/autoshort-ocr-burn.test.ts`
- Modify: `src/main/burn.ts:697-832`
- Modify: `src/main/burn.ts:835-885`
- Modify: `src/main/burn.ts:899-1130`
- Modify: `src/main/burn.ts:1132-1316`
- Modify: `tests/e2e-autoshort.test.ts:114`
- Modify: `scripts/run-local-runtime-tests.mjs`

**Consumes:** `TimedOcrBlurMask` from `src/main/ocrMask.ts`, canonical geometry, managed FFmpeg/FFprobe, existing ASS/audio builders, and `BurnReq` without any new public fields.

**Produces:**

~~~ts
export interface BurnInputPlan {
  inputArgs: string[]
  sourceVideoIndex: 0
  narrationAudioIndex: 1 | null
  maskVideoIndex: 1 | 2 | null
}

export function planBurnInputs(input: {
  sourceVideo: string
  narrationAudio?: string | null
  timedMask?: string | null
}): BurnInputPlan

export function blurSigmaForDisplayHeight(displayHeight: number): number

export interface AutoShortBurnExecutionOptions {
  timedOcrBlurMask?: TimedOcrBlurMask | null
  ffmpegPath: string
  ffprobePath: string
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

- [ ] **Step 7.1: Register the burn suite**

Append `autoshort-ocr-burn.test` to `knownTests`.

- [ ] **Step 7.2: Add RED input-planner tests**

Compare the complete `inputArgs` and indexes for all four rows:

| Narration | Mask | Input args after global FFmpeg flags | Narration index | Mask index |
|---|---|---|---:|---:|
| no | no | `-i source.mp4` | null | null |
| yes | no | `-i source.mp4 -i narration.wav` | 1 | null |
| no | yes | `-i source.mp4 -i mask.mkv` | null | 1 |
| yes | yes | `-i source.mp4 -i narration.wav -i mask.mkv` | 1 | 2 |

- [ ] **Step 7.3: Freeze manual graph regressions before refactoring**

Add exact-string assertions for manual no-audio, manual narration replace, manual narration mix, and two manual rectangles plus ASS. These tests call the existing `taoFilterComplex`; their expected strings must be captured from baseline `f7ce00d`, not rewritten to resemble the automatic graph.

- [ ] **Step 7.4: Add RED automatic graph tests**

For a display height at or below 266, narration input 1, and mask input 2, require these video filter nodes in order:

~~~text
[0:v]null[display]
[display]split=2[base][blur_source]
[blur_source]gblur=sigma=8:steps=3[blurred]
[2:v]format=gray,settb=AVTB,setpts=PTS-STARTPTS[mask]
[base][blurred][mask]maskedmerge,trim=duration=1.000[masked]
[masked]ass=sub.ass[out]
~~~

For display height 1080, require sigma 32. Substitute the actual mask index from the plan; never hardcode input 2 in implementation.

- [ ] **Step 7.5: Add RED constant-size and forbidden-option tests**

Build graphs with masks representing one and 10,000 box segments and assert identical filter-node count. Reject any graph containing `repeatlast`, `eof_action`, or `shortest`.

- [ ] **Step 7.6: Add RED audio-index tests**

For automatic replace/mix/no-source-audio cases, assert every narration reference uses `plan.narrationAudioIndex`, source references remain `0:a`, and the mask index is never referenced as audio. Preserve current original-audio gain, resample, pad, trim, limiter, and codec behavior.

- [ ] **Step 7.7: Add RED public request injection tests**

Pass raw IPC objects containing each of `timedOcrBlurMask`, `maskPath`, `visualCuesPath`, and `visualTimeline`. Require `validateBurnRequest` to reject before file access or process spawn. Assert the validated `BurnReq` object is built from explicit allowlisted keys rather than spreading raw input.

- [ ] **Step 7.8: Add RED transaction and no-clobber tests**

Cover invalid partial bytes, decode failure, wrong duration/frame rate/audio, abort after partial creation, FFmpeg nonzero exit, promotion error, pre-existing final, and success. Every failure leaves no task-created final/partial; a pre-existing final's bytes and mtime remain unchanged. Success creates one final only after validation and returns that exact path.

- [ ] **Step 7.9: Run the focused suite and capture RED**

Run `npm run test:local-runtime -- autoshort-ocr-burn.test`.

Expected: planner, automatic graph, public-field rejection, and `burnAutoShort` are missing.

- [ ] **Step 7.10: Implement the pure input planner and sigma helper**

Start with source index 0, append narration if present, then append mask if present. Implement:

~~~ts
export function blurSigmaForDisplayHeight(displayHeight: number): number {
  const height = Number.isFinite(displayHeight) && displayHeight > 0 ? displayHeight : 720
  return Math.max(8, Math.round(height * 0.03))
}
~~~

Make the manual graph call the helper without changing its output.

- [ ] **Step 7.11: Implement a separate automatic video graph builder**

If canonical display filtering is empty, emit `[0:v]null[display]`; otherwise emit `[0:v]<canonical>[display]`. Split once, blur the full display frame once, normalize the mask, `maskedmerge`, trim to exact video-stream duration, then apply ASS. Never loop over timeline boxes.

- [ ] **Step 7.12: Make automatic audio filters index-aware**

Extract only the audio-string construction needed by both paths. Receive `narrationAudioIndex` explicitly and throw if narration is requested with null index. Do not change manual map behavior or source-audio policy.

- [ ] **Step 7.13: Replace raw-object spreading with an explicit public allowlist**

The allowlist is exactly: `video`, `srt`, `outputDir`, `outputName`, `mode`, `bandTop`, `bandBot`, `bandLeft`, `bandRight`, `blurRegions`, `lamMo`, `subRegion`, `catSrt`, `batAmThanh`, `amThanhFile`, `amLuongGoc`, `fontId`, `textColor`, `outlineColor`, `outlinePx`, `bgEnabled`, `bgColor`, `bgOpacity`, `subtitleDisplayStyle`, `highlightColor`, `subtitleHighlightPop`, `subtitleLayoutProfile`, `subtitleAutoOptimize`, `subtitleFontSize`, `wordTimings`, `requireWordTimings`, `subtitleFontScale`, and `outlineScale`. Reject the four sensitive keys even if future fields are otherwise tolerated.

- [ ] **Step 7.14: Extract an exact-output lower renderer**

Refactor `runBurnSubtitle` into a main-only lower function that receives exact output path, input plan, optional validated mask, and item `AbortSignal`. Keep public Video Editor naming and soft-subtitle behavior in its wrapper. Use item-scoped cancellation for the new path rather than global `daHuy`; both paths continue sharing the application-wide `burnInFlight` guard.

- [ ] **Step 7.15: Implement complete pre-promotion media validation**

Decode the full partial with managed FFmpeg `-v error -i <partial> -map 0:v:0 -f null -`. Probe with sibling FFprobe and require one video stream, a positive duration within `durationToleranceFrames / expectedFrameRate` when frame rate is known or within 0.10 seconds otherwise, frame-rate delta at most 0.1 when expected, and at least one audio stream when `requireAudio` is true. Require file size greater than 4,096 bytes.

- [ ] **Step 7.16: Implement `burnAutoShort` path and exclusivity validation**

Require mode `burn`, contained regular explicit FFmpeg/FFprobe paths supplied by the Main coordinator, absolute existing work directory, absolute `.mp4` final path, existing final parent, and no final file. Require a provided mask to be a contained regular file with exact geometry/duration metadata. Reject timed mask plus any active manual rectangle. Manual Auto Short calls pass rectangles and null mask; automatic calls pass empty rectangles and one mask. The internal function never consults PATH or APPDATA after entry.

- [ ] **Step 7.17: Render to one hidden sibling and promote safely**

Use `.<finalStem>.<randomUUID>.partial.mp4` in the final directory. Render, validate, recheck that final still does not exist, then rename once. The single-flight guard prevents internal writers from racing. On `EEXIST`, `EPERM`, or any promotion failure, leave any external/pre-existing final untouched and remove only the partial.

- [ ] **Step 7.18: Consolidate item-scoped child cleanup**

Every encoder retry, decode, and probe uses `shell: false`, is tracked, listens to the supplied signal, bounds diagnostics, and waits for close/error. `finally` removes the hidden partial only; it never removes the final path or mask owned by the coordinator.

- [ ] **Step 7.19: Run GREEN and all burn regressions**

Run:

~~~powershell
npm run typecheck
npm run test:local-runtime -- autoshort-ocr-burn.test
npm run test:local-runtime
npm run test:subtitles
git diff --check
~~~

Expected: planner/security/transaction tests pass and every frozen manual graph remains byte-for-byte equal.

- [ ] **Step 7.20: Commit the burn boundary**

~~~powershell
git add src/main/burnInputPlanner.ts src/main/burn.ts scripts/run-local-runtime-tests.mjs tests/autoshort-ocr-burn.test.ts tests/e2e-autoshort.test.ts
git diff --cached --check
git commit -m "feat(burn): render validated timed masks"
~~~

**Exit gate:** `burnAutoShort` is directly testable and transactional, while the production coordinator still migrates in Task 9 and the public renderer API remains mask-free.

---

### Task 8: Prove OCR-mask capability and make readiness/install capability-aware

**Entry gate:** Task 7's direct automatic render tests are green.

**Files:**
- Create: `src/main/ffmpegOcrMaskProbe.ts`
- Create: `scripts/run-ffmpeg-ocr-mask-probe.mjs`
- Modify: `src/main/autoshort.ts:198-315`
- Modify: `src/main/autoshort.ts:446-534`
- Modify: `src/main/runtimeProbes.ts:133-205`
- Modify: `src/main/deps.ts:473-499`
- Modify: `tests/autoshort-ocr-runtime.test.ts`
- Modify: `scripts/run-local-runtime-tests.mjs`

**Consumes:** pure blur predicates, verified OCR feature intersection, automatic graph, mask writer/validator, runtime resolver/installer, and Task 7 input planner.

**Produces:**

~~~ts
export interface FfmpegOcrMaskProbeResult {
  healthy: boolean
  features: string[]
  ffmpegSha256?: string
  probeSchemaVersion: 1
  message?: string
}

export async function probeFfmpegOcrMaskCapability(
  ffmpegPath: string,
  options?: { signal?: AbortSignal }
): Promise<FfmpegOcrMaskProbeResult>

export interface FfmpegInstallOptions {
  forceCapabilityReinstall?: 'ocr-mask-v1'
}
~~~

- [ ] **Step 8.1: Extend deterministic readiness hooks**

Add injectable hooks for `resolveFfmpeg`, `ocrEngineStatus`, `probeFfmpegOcrMaskCapability`, `installFfmpeg`, and `installOcrEngine`. Keep current separator/Whisper hooks unchanged.

- [ ] **Step 8.2: Add the complete RED readiness matrix**

| Subtitle method | Blur enabled | Mode | Legacy OCR healthy | visual cues | mask probe | Expected OCR dependency | Expected FFmpeg dependency |
|---|---:|---|---:|---:|---:|---|---|
| Whisper | no | OCR-auto stored | no | no | no | not required | ordinary FFmpeg only |
| OCR | no | manual | yes | no | no | ready | ordinary FFmpeg only |
| Whisper+OCR | yes | manual | yes | no | no | ready | ordinary FFmpeg only |
| Whisper | yes | OCR-auto | yes | no | yes | update required | ready |
| Whisper | yes | OCR-auto | yes | yes | no | ready | capability failure |
| OCR | yes | OCR-auto | yes | yes | yes | ready | ready |

Assert exact user messages `OCR engine cần cập nhật để tạo vùng làm mờ theo chữ.` and `FFmpeg hiện tại chưa qua kiểm tra mặt nạ OCR.`.

- [ ] **Step 8.3: Add RED install/reprobe tests**

When OCR feature is missing, assert one OCR reinstall then one fresh readiness call. When FFmpeg mask capability is missing, assert `installFfmpeg` receives `{forceCapabilityReinstall:'ocr-mask-v1'}` even though version resolution succeeds. If post-install readiness remains false, require rejection and preserve `ocr-auto` selection.

- [ ] **Step 8.4: Add RED native-probe unit fixtures**

Test path validation, missing sibling FFprobe, cache success, no failure caching, executable replacement at same path with changed size/mtime, child failure, bounded diagnostics, cancellation settlement, and guaranteed task-temp cleanup.

- [ ] **Step 8.5: Define the four native fixture cases**

| Case ID | Source/mask behavior | Required proof |
|---|---|---|
| `appear-disappear` | white box active then black | inside changes only while white; terminal source resumes |
| `terminal-black-frame` | final active interval followed by black terminal mask | no held final blur past half-open end |
| `moving-resize` | box moves/resizes beside moving unmasked control | blur follows box; control stays unblurred |
| `moving-resize-with-narration` | previous case plus input-1 tone and input-2 mask | video plus exactly one correctly mapped narration stream |

- [ ] **Step 8.6: Run readiness/native wrapper RED**

Run:

~~~powershell
npm run test:local-runtime -- autoshort-ocr-runtime.test
node scripts/run-ffmpeg-ocr-mask-probe.mjs --ffmpeg "$managedFfmpeg"
~~~

Expected: readiness assertions fail and the wrapper is missing. If managed FFmpeg is absent, record native RED as not runnable rather than substituting PATH FFmpeg.

- [ ] **Step 8.7: Implement the native probe's isolated lifecycle**

Validate absolute regular FFmpeg and sibling FFprobe, create `mkdtemp(join(tmpdir(),'tedia-ffmpeg-ocr-mask-probe-'))`, generate all sources with the supplied FFmpeg's deterministic `lavfi` filters, and remove only that resolved root in `finally` after all children settle.

- [ ] **Step 8.8: Reuse the production graph and validator**

Call Task 6 mask functions and Task 7 planner/graph; do not duplicate graph strings. For every case, verify mask framemd5, output decode, expected streams, source/mask pixel controls, and forbidden-option absence. Return `features:['ocr-mask-v1']` only after all four pass.

- [ ] **Step 8.9: Cache native success by executable identity**

Key the in-process cache with `realpath + ':' + stat.size + ':' + stat.mtimeMs`. Cache only healthy results. Include SHA-256 of the executable in a healthy result for Task 11 provenance.

- [ ] **Step 8.10: Implement the thin command wrapper**

Bundle `src/main/ffmpegOcrMaskProbe.ts` into a fresh temp CommonJS file with esbuild, pass only an explicit absolute `--ffmpeg` path, print one JSON result, return nonzero unless healthy with `ocr-mask-v1`, and remove its bundle temp root in `finally`.

- [ ] **Step 8.11: Make readiness use actual capabilities**

Compute `automaticBlur` and `needsOcr` with Task 1 predicates. Schedule visual-feature validation and native mask probe only for active automatic blur. Keep ordinary FFmpeg version readiness for every Auto Short job and generic legacy OCR readiness for OCR subtitle methods.

- [ ] **Step 8.12: Add force-capability FFmpeg installation**

Change `doInstallFfmpeg`/`installFfmpeg` to accept `FfmpegInstallOptions`. Skip the current early return when `forceCapabilityReinstall === 'ocr-mask-v1'`, let the manifest installer stage/probe/atomically replace, then rerun the native capability probe before reporting done.

- [ ] **Step 8.13: Make dependency installation fail closed**

After each OCR/FFmpeg install, recompute readiness. If either required capability is still absent, throw the exact readiness error; do not mutate the requested blur mode/profile and do not silently continue with manual/no blur.

- [ ] **Step 8.14: Run focused and full GREEN gates**

Run:

~~~powershell
npm run typecheck
npm run test:local-runtime -- autoshort-ocr-runtime.test
npm run test:local-runtime
node scripts/run-ffmpeg-ocr-mask-probe.mjs --ffmpeg "$managedFfmpeg"
git diff --check
~~~

Expected: deterministic readiness/install tests pass. The native wrapper exits 0 and reports the executable hash when the managed fixture exists; otherwise record that native gate as SKIPPED, not PASS.

- [ ] **Step 8.15: Commit readiness and native probing**

~~~powershell
git add src/main/ffmpegOcrMaskProbe.ts scripts/run-ffmpeg-ocr-mask-probe.mjs src/main/autoshort.ts src/main/runtimeProbes.ts src/main/deps.ts tests/autoshort-ocr-runtime.test.ts scripts/run-local-runtime-tests.mjs
git diff --cached --check
git commit -m "feat(autoshort): gate OCR blur readiness"
~~~

**Exit gate:** automatic mode cannot become ready from manifest strings or executable presence alone; install can replace an incapable but version-runnable FFmpeg.

---

### Task 9: Integrate one visual OCR run, checkpoint evidence, audit redaction, cleanup, and internal burn

**Entry gate:** Tasks 1–8 APIs are committed and green.

**Files:**
- Create: `src/main/autoShortOcrCheckpoint.ts`
- Create: `src/main/autoShortItemCoordinator.ts`
- Create: `tests/autoshort-ocr-pipeline.test.ts`
- Modify: `src/main/autoshort.ts:126-168`
- Modify: `src/main/autoshort.ts:2245-2399`
- Modify: `src/main/autoshort.ts:2614-2743`
- Modify: `src/main/autoShortAudit.ts:1-28`
- Modify: `scripts/run-local-runtime-tests.mjs`
- Modify: `tests/local-runtime.test.ts`

**Consumes:** `ocrVideoWithVisualTimeline`, `writeTimedOcrBlurMask`, `burnAutoShort`, `isAutomaticOcrBlur`, `autoShortNeedsOcr`, canonical geometry/duration, and current Whisper/fusion/translation/TTS paths.

**Produces:**

~~~ts
export interface OcrSourceCueEvidence {
  effectiveOcrProfile: AutoShortOcrBlurProfile
  engineVersion: string
  engineProtocol: 'ocr-local/1'
  cueDigest: string
}

export interface OcrBlurAuditMetadata {
  blurMode: AutoShortBlurMode
  ocrEngineVersion?: string
  ocrSampleFps: 8
  ocrScanProfile?: AutoShortOcrBlurProfile
  ocrVisualSegmentCount?: number
  ocrBoxSegmentCount?: number
  ocrMaskedDurationSeconds?: number
}

export interface AutoShortItemCoordinatorDeps {
  resolveFfmpeg: () => Promise<string | null>
  resolveFfprobe: () => Promise<string | null>
  runVisualOcr: typeof ocrVideoWithVisualTimeline
  writeTimedMask: typeof writeTimedOcrBlurMask
  burn: typeof burnAutoShort
}

export interface AutoShortItemContext {
  jobId: string
  request: AutoShortStartRequest
  item: AutoShortQueueItemInput
  index: number
  total: number
  signal: AbortSignal
  emit: (event: AutoShortEvent) => void
  checkpointDir: string
  workDir: string
  artifactDir: string
  ttsCapabilities?: Awaited<ReturnType<typeof getTtsModels>>
  ttsCapabilitiesUrl?: string
  separation?: PreparedAutoShortSeparation
  separationProviderState: SeparatorProviderState
}

export function createAutoShortItemProcessor(
  deps: AutoShortItemCoordinatorDeps
): (context: AutoShortItemContext) => Promise<AutoShortItemResult>

export function mustRegenerateOcrSource(
  config: Pick<AutoShortConfig, 'subtitleMethod' | 'lamMo' | 'blurMode'>
): boolean

export function digestCanonicalSourceCues(cues: readonly AlignedCue[]): string

export function sameOcrSourceCueEvidence(
  previous: OcrSourceCueEvidence | undefined,
  next: OcrSourceCueEvidence
): boolean

export function createOcrBlurAuditMetadata(summary: {
  blurMode: AutoShortBlurMode
  engineVersion?: string
  scanProfile?: AutoShortOcrBlurProfile
  visualSegmentCount?: number
  boxSegmentCount?: number
  maskedDurationSeconds?: number
}): OcrBlurAuditMetadata
~~~

- [ ] **Step 9.1: Register the pipeline suite and extract one coordinator seam**

Append `autoshort-ocr-pipeline.test` to `knownTests`. Move the item orchestration into `createAutoShortItemProcessor(deps)` in `autoShortItemCoordinator.ts`; production `autoshort.ts` constructs it with the real managed resolvers/OCR/mask/burn functions. Tests and Task 12 provide the complete dependency object—there is no optional fallback—so an omitted fake cannot silently touch APPDATA or PATH. Keep this Main-only export out of `index.ts`, preload, and renderer. Fakes for visual OCR, mask, burn, checkpoint, cleanup, and progress record call order/object identity without logging payload text or paths.

- [ ] **Step 9.2: Add RED OCR-only automatic reuse test**

Require one visual OCR call; require SRT projection and mask creation to receive the same timeline object; require empty manual regions plus one timed mask at `burnAutoShort`; require zero calls to public `burnSubtitle`.

- [ ] **Step 9.3: Add RED Whisper+OCR concurrency/failure tests**

Use deferred promises to prove both start before either settles. Lock behavior:

| Whisper | Visual OCR | Automatic result |
|---|---|---|
| success | success | fuse and continue |
| failure | success | continue with OCR cues and sanitized Whisper warning |
| success | failure | fail item; no Whisper-only fallback |
| failure | failure | fail item |

Manual/off Whisper+OCR retains the existing any-valid-source fallback.

For the success/success row, assert projected OCR cues are passed as the `visual` argument to the existing `fuseWhisperAndOcr(whisperCues, visualCues)` exactly once. A second OCR invocation or replacement of the fusion helper fails the test.

- [ ] **Step 9.4: Add RED Whisper-only automatic test**

Restore valid Whisper source cues from checkpoint, run visual OCR once only for the mask, ignore OCR text for subtitles, retain Whisper cue identity, and do not invalidate source/translation solely because mask geometry changed.

- [ ] **Step 9.5: Add RED checkpoint decision tests**

Require automatic OCR/Whisper+OCR to skip old source cues until fresh visual OCR succeeds; manual/off behavior may reuse. Require checkpoint version 5 and optional `ocrSourceEvidence`; prohibit sidecar/mask/timeline fields.

- [ ] **Step 9.6: Add RED canonical digest, evidence comparison, and invalidation tests**

Sort a copied cue array by `(start,end,id)` and hash stable JSON containing only `id`, `text`, `start`, `end`, `source`, and `timingQuality`. Reordering input without semantic change keeps digest; changing any one field changes it. Compare all four evidence fields with `sameOcrSourceCueEvidence`; a profile/version/protocol/digest change invalidates reuse. Set `checkpoint.translatedCues = undefined` and persist before translation/TTS, but preserve cue-independent `instrumentalPath`. Write the new `ocrSourceEvidence` only after fresh projected OCR cues are validated.

- [ ] **Step 9.7: Add RED privacy and artifact tests**

Assert sidecar/mask/work/partial values never reach checkpoint JSON, `artifactEntries`, `preserveAutoShortArtifacts`, ordinary logs, audit metadata, or renderer events. The permitted OCR audit object has exactly seven aggregate keys and no recognized text/coordinate/path key.

- [ ] **Step 9.8: Add the parameterized failure/cleanup matrix**

Cover OCR process, empty OCR, invalid sidecar, mask encode, mask validation, render, final validation, promotion, abort during OCR, abort during mask, and abort during render. After each: children settled; sidecar/mask/partial absent; new final absent; pre-existing final untouched; exactly one terminal error/cancel event.

- [ ] **Step 9.9: Run pipeline RED**

Run `npm run test:local-runtime -- autoshort-ocr-pipeline.test`.

Expected: missing checkpoint helper/integration seams and current public burn call fail named tests.

- [ ] **Step 9.10: Implement checkpoint helpers and schema version 5**

Implement `mustRegenerateOcrSource` as `isAutomaticOcrBlur(config) && (subtitleMethod === 'ocr' || subtitleMethod === 'whisper-ocr')`. Add `ocrSourceEvidence?: OcrSourceCueEvidence`; keep both `blurMode` and `ocrBlurProfile` out of the global fingerprint while retaining `ocrRegion`. The profile/version/protocol participate only in `OcrSourceCueEvidence`; active automatic blur independently forces fresh visual OCR for its mask because no mask/sidecar is checkpointed, while Whisper-only source cues may still be reused. Write stable digest from a sorted copy so the caller's cue array is not mutated.

- [ ] **Step 9.11: Decide checkpoint reuse before starting extraction**

Compute `forceFreshOcrSource` before the current `checkpoint.sourceCues` branch. Permit that branch only when false. On a new OCR-based projection, construct evidence from effective profile, engine version, engine protocol, and `digestCanonicalSourceCues(projectedCues)`. Use `sameOcrSourceCueEvidence`; when any field differs, clear `translatedCues` and persist that deletion before downstream work, then store the fresh source cues/evidence together.

- [ ] **Step 9.12: Create exactly one per-item automatic visual OCR promise**

When automatic blur is active, create `visualOcrPromise` once after canonical metadata/region validation. Reuse it for OCR-based source cues and mask. Whisper-only waits for it only when mask generation begins; Whisper+OCR starts it concurrently with Whisper. When automatic blur is off, retain the current checkpoint fast path: invoke legacy OCR only if OCR source cues are actually missing. Pass `effectiveAutoShortOcrProfile(config)` explicitly to every OCR call; its inactive `fast` value is the deliberate legacy default, never the persisted automatic profile.

- [ ] **Step 9.13: Keep legacy OCR isolated when automatic blur is off**

OCR/Whisper+OCR subtitle modes without active automatic blur continue using the public-compatible legacy OCR path and current checkpoint behavior. Do not request visual sidecars or mask capability.

- [ ] **Step 9.14: Build source cues from the validated timeline without changing fusion semantics**

For `subtitleMethod === 'ocr'`, set source cues to `alignedFromSrt(projectOcrTimelineToSubtitleCues(timeline), 'ocr')`. For `subtitleMethod === 'whisper-ocr'`, pass those projected cues as the `visual` input to `fuseWhisperAndOcr(whisperCues, visualCues)` without invoking OCR again, then apply the locked failure matrix. For Whisper-only, ignore projected OCR text. Reject an automatic visual timeline with no segments/boxes using `OCR không phát hiện vùng chữ hợp lệ trong vùng quét.`.

- [ ] **Step 9.15: Create one timed mask and route every Auto Short render internally**

Create mask under item work directory. Automatic request uses `blurRegions: []`; manual request uses converted rectangles and null mask. Both call `burnAutoShort` with trusted final path, resolved FFmpeg/FFprobe, and expected media. Delete the coordinator's call/import of public `burnSubtitle` and its old post-publication validation block. Copy required non-output audit artifacts before invoking burn; copying the validated partial/final video into the audit folder is optional best-effort work after publication.

- [ ] **Step 9.16: Emit distinct progress without new IPC payloads or enum values**

Emit the first three stages with `itemStatus: 'extracting_sub'` and exact messages `Đang quét chữ trong video…`, `Đang kiểm tra timeline OCR…`, and `Đang tạo và kiểm tra mặt nạ OCR…`. Emit `Đang làm mờ OCR, gắn phụ đề và xuất video…` only with `itemStatus: 'rendering_video'`. Do not add enum values or attach geometry, text, or temporary paths.

- [ ] **Step 9.17: Add exact aggregate-only audit metadata**

Return `OcrBlurAuditMetadata`, not `Record<string, unknown>`. Emit only `blurMode`, `ocrEngineVersion`, `ocrSampleFps`, `ocrScanProfile`, `ocrVisualSegmentCount`, `ocrBoxSegmentCount`, and `ocrMaskedDurationSeconds`; test the exact serialized key set and reject spread-in arbitrary records.

- [ ] **Step 9.18: Consolidate cleanup ownership and the publication commit point**

Record only Main-generated candidates under the validated item `workDir`: `ocr/visual-cues.json`, `ocr/source.engine.srt`, authoritative `ocr/source.srt`, mask, and hidden partial. Never add an engine-reported path to cleanup until exact-path and lstat/realpath containment validation succeeds. Before promotion, cancellation/failure awaits children and removes trusted sidecar/mask/partial/work paths. Check `signal.aborted` immediately before the atomic rename. After `burnAutoShort` returns the promoted final, set `published = true`; all remaining artifact copying, checkpoint deletion, and progress notification is individually best-effort and cannot change the item to error/cancelled. Add a test where audit copying throws after promotion and require one `done` result with a sanitized warning, not an error with a surviving final.

- [ ] **Step 9.19: Run pipeline GREEN and source-boundary checks**

Run:

~~~powershell
npm run typecheck
npm run test:local-runtime -- autoshort-ocr-pipeline.test
npm run test:local-runtime
$matches = rg -n "burnSubtitle\(" src/main/autoshort.ts
if ($LASTEXITCODE -eq 0) { $matches; throw 'Auto Short must not call public burnSubtitle.' }
if ($LASTEXITCODE -ne 1) { throw 'rg failed while checking burnSubtitle calls.' }
git diff --check
~~~

Expected: tests exit 0; `rg` returns no production call in `autoshort.ts`; all failure rows prove cleanup/no publication.

- [ ] **Step 9.20: Commit coordinator integration**

~~~powershell
git add src/main/autoShortOcrCheckpoint.ts src/main/autoShortItemCoordinator.ts src/main/autoshort.ts src/main/autoShortAudit.ts scripts/run-local-runtime-tests.mjs tests/autoshort-ocr-pipeline.test.ts tests/local-runtime.test.ts
git diff --cached --check
git commit -m "feat(autoshort): integrate OCR timed blur"
~~~

**Exit gate:** each automatic item has one canonical visual OCR result shared by subtitle/mask consumers, every Auto Short render is transactional, and cleanup/privacy are tested at every failure stage.

---

### Task 10: Implement the two-mode/two-profile renderer without losing manual regions

**Entry gate:** Task 9 emits the locked progress messages and accepts the safe mode/profile fields end to end.

**Files:**
- Modify: `src/renderer/src/components/AutoShort.tsx:149-230`
- Modify: `src/renderer/src/components/AutoShort.tsx:824-900`
- Modify: `src/renderer/src/components/AutoShort.tsx:1030-1090`
- Modify: `src/renderer/src/components/AutoShort.tsx:1630-1710`
- Modify: `src/renderer/src/components/RegionBox.tsx:40-115`
- Modify: `src/renderer/src/components/RegionBox.tsx:590-620`
- Modify: `src/renderer/src/styles/autoshort.css` beside the current blur/editor rules
- Modify: `tests/local-runtime.test.ts`

**Consumes:** Task 1 types/normalizers/policy, current `RegionBox`, current persisted-state helper, Task 9 messages, and the existing readiness/install/start methods.

**Produces these renderer-only derived values:**

~~~ts
const automaticBlur = blurEnabled && blurMode === 'ocr-auto'
const subtitleUsesOcr = subtitleMethod === 'ocr' || subtitleMethod === 'whisper-ocr'
const visibleManualBlurRegions = blurEnabled && blurMode === 'manual' ? blurRegions : []
const showOcrScanRegion = subtitleUsesOcr || automaticBlur
~~~

- [ ] **Step 10.1: Add RED persistence/source-boundary assertions**

Extend the renderer-source section of `tests/local-runtime.test.ts` to require both storage keys, both normalizer calls, all four approved option labels, all three safe dependency fields, and the mode-specific overlay expressions. Also assert renderer/preload sources contain none of `timedOcrBlurMask`, `maskPath`, `visualTimeline`, `visualCuesPath`, or `source.engine.srt`.

- [ ] **Step 10.2: Add RED state-transition assertions**

Lock this matrix in named source/behavior tests:

| Transition | Stored rectangles | Rectangle overlay | OCR scan overlay |
|---|---:|---:|---:|
| manual + blur on -> OCR-auto | preserved | hidden | shown |
| OCR-auto + blur on -> manual | restored unchanged | shown | only if subtitle mode uses OCR |
| either mode -> blur off | preserved | hidden | shown only when subtitle mode itself uses OCR |
| blur off -> OCR-auto selected | preserved | hidden | not an OCR dependency until blur is enabled |

The last row permits retaining the user's selection but prohibits readiness/start from scheduling visual OCR merely because the inactive selector says OCR-auto.

- [ ] **Step 10.3: Run renderer RED**

Run `npm run test:local-runtime -- local-runtime.test`.

Expected: the new persistence labels/normalization/overlay assertions fail while existing renderer assertions remain green.

- [ ] **Step 10.4: Verify Task 1 normalization remains the sole persisted-state boundary**

Retain the Task 1 normalizers around the raw persisted values:

~~~ts
const [storedBlurMode, setStoredBlurMode] = usePersistedState<unknown>(
  'tblao.autoshort.blurMode',
  'manual'
)
const [storedOcrBlurProfile, setStoredOcrBlurProfile] = usePersistedState<unknown>(
  'tblao.autoshort.ocrBlurProfile',
  'accurate'
)
const blurMode = normalizeAutoShortBlurMode(storedBlurMode)
const ocrBlurProfile = normalizeAutoShortOcrBlurProfile(storedOcrBlurProfile)
~~~

Confirm one effect per key writes the normalized value only when the raw stored value differs. Control handlers write only canonical union values. Do not introduce a second UI-local normalizer or weaken Main request validation: malformed explicit IPC remains an error.

- [ ] **Step 10.5: Derive the four visibility/dependency booleans once**

Place the four values shown above near the other derived config flags. Reuse them in editor props, control rendering, readiness payloads, and start payloads; do not reproduce slightly different inline conditions.

- [ ] **Step 10.6: Thread safe values through all three request paths**

Ensure readiness, dependency installation, and Auto Short start each send `lamMo: blurEnabled`, `blurMode`, and `ocrBlurProfile`. The start request still serializes all preserved `blurRegions`; Main chooses which source is active. No renderer code sends a mask, sidecar, absolute temporary path, or OCR timeline.

- [ ] **Step 10.7: Render one accessible mode selector**

Inside the existing blur tool panel, directly below the on/off switch and not gated by that switch, add a labeled native radio group or equivalent keyboard-accessible inputs with exactly:

- `Thủ công`
- `Tự động OCR`

Keep current add/list/delete rectangle UI mounted only for selected manual mode. Switching mode calls only `setStoredBlurMode`; it must not call `setBlurRegions`, clear the active video's regions, or rewrite the OCR region. Turning blur off hides overlays and disables OCR dependency work, but does not prevent the user from selecting/persisting a mode or profile for the next run.

- [ ] **Step 10.8: Render the profile selector and exact explanatory copy**

Whenever `blurMode === 'ocr-auto'`, show exactly these persisted choices even if blur is currently off; OCR work/readiness remains gated by `automaticBlur`:

- `Chính xác — khuyên dùng`
- `Nhanh`

Render these two paragraphs adjacent to the choices:

~~~text
Mọi chữ OCR phát hiện trong vùng nét đứt sẽ được làm mờ đúng thời gian xuất hiện, cộng biên an toàn 1 khung OCR. Ứng dụng tự render ngay sau khi quét.
Không phát hiện vùng chữ hợp lệ sẽ dừng video này.
~~~

For fast mode add: `Chế độ Nhanh có thể bỏ sót chữ rất nhỏ hoặc xuất hiện quá ngắn.` Do not promise speedup percentages or hardware-specific throughput.

- [ ] **Step 10.9: Apply the overlay and editability matrix exactly**

Pass `regions={visibleManualBlurRegions}` and `hienOcrBox={showOcrScanRegion}` to `RegionBox`. Add `ocrInteractive?: boolean` to `RegionBox`, defaulting to `true` to preserve ScreenText/VideoEditor behavior, and gate OCR move/resize handlers, handles, cursor, and title just like `subInteractive`. Auto Short passes `ocrInteractive={(tool === 'blur' && automaticBlur) || (tool === 'subtitle' && subtitleUsesOcr)}`. The dashed OCR region remains visible with blur off only when OCR/Whisper+OCR subtitle extraction itself requires it; that scan box is not a blur overlay. Never draw detected OCR boxes in the renderer. Add a behavior/source assertion that inactive tools cannot change OCR geometry.

- [ ] **Step 10.10: Keep one OCR region editor for both consumers**

Automatic blur and OCR-based subtitle extraction edit the same normalized `ocrRegion`. If the region is not initialized when either consumer becomes active, initialize the current `defaultOcrRegion(videoW, videoH)` once. Do not create a second automatic-blur region or convert OCR boxes in the renderer.

- [ ] **Step 10.11: Surface progress through existing queue rows**

Map Task 9's messages through the current progress/event renderer without adding IPC fields or phases. Confirm cancellation and failure text remains visually distinct, and the final error `OCR không phát hiện vùng chữ hợp lệ trong vùng quét.` is visible without coordinates or file paths.

- [ ] **Step 10.12: Add scoped styles**

Add only Auto Short-prefixed classes for the mode group, profile group, explanation, and warning. Reuse current colors, focus ring, spacing tokens, disabled state, and responsive breakpoint. Verify radio inputs remain reachable and visibly focused at 200% browser zoom.

- [ ] **Step 10.13: Run automated GREEN gates**

Run:

~~~powershell
npm run typecheck
npm run test:local-runtime -- local-runtime.test autoshort-ocr-contract.test
npm run test:local-runtime
npm run build
git diff --check
~~~

Expected: all commands exit 0; source-boundary assertions confirm no private mask/timeline fields crossed into renderer/preload.

- [ ] **Step 10.14: Perform and preserve the renderer transition smoke evidence**

Run `npm run dev` and use only a task-owned synthetic clip under the OS temp directory. In the development UI, create two manual regions, switch to OCR-auto, select Fast, turn blur off/on, then return to manual. Save a screenshot or concise observation under a task-owned temp evidence directory and copy only the result summary into Task 12's acceptance ledger. Record that both rectangles retain coordinates/colors/order, automatic mode shows only the dashed scan region, the profile survives the toggle, the OCR box cannot be dragged from an inactive tool, and OCR subtitle mode can still show its scan region with blur disabled. If an interactive Electron surface is unavailable, record `NOT RUN — interactive UI unavailable`; this smoke check is not media acceptance.

- [ ] **Step 10.15: Commit the renderer task**

~~~powershell
git add src/renderer/src/components/AutoShort.tsx src/renderer/src/components/RegionBox.tsx src/renderer/src/styles/autoshort.css tests/local-runtime.test.ts
git diff --cached --check
git commit -m "feat(autoshort-ui): add automatic OCR blur"
~~~

**Exit gate:** the UI exposes exactly two blur modes/two automatic profiles, preserves manual work across transitions, and derives every dependency/overlay decision from one active-mode predicate.

---

### Task 11: Define runtime-v5 and bind advertised features to packaged bytes

**Entry gate:** OCR engine 1.1.0 and the native FFmpeg probe are green from Tasks 4 and 8. Do not begin from unqualified third-party binaries.

**Files:**
- Modify: `distribution/runtime-inputs.json`
- Modify: `distribution/separator-model-inputs.json`
- Modify: `src/main/distributionConfig.ts:1-35`
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
- Modify: `scripts/run-local-runtime-tests.mjs` only if either basename is not already registered

**Consumes:** Task 8 `FfmpegOcrMaskProbeResult`, the staged runtime input root, current archive collector/verifier, current immutable runtime-v4 contracts, and current separator model catalog.

**Produces this exact native-proof shape in both manifest provenance and `runtime-provenance.json`:**

~~~ts
interface FfmpegOcrMaskProofV1 {
  schemaVersion: 1
  capability: 'ocr-mask-v1'
  native: true
  passed: true
  runtimeVersion: 'runtime-v5'
  platform: 'win32' | 'darwin' | 'linux'
  arch: 'x64' | 'arm64' | 'ia32'
  asset: string
  entrypoint: string
  ffmpegExecutableSha256: string
  executedAt: string
  cases: [
    { id: 'appear-disappear'; passed: true },
    { id: 'terminal-black-frame'; passed: true },
    { id: 'moving-resize'; passed: true },
    { id: 'moving-resize-with-narration'; passed: true }
  ]
}

interface RuntimeProvenanceV1 {
  // existing fields remain
  nativeCapabilityProofs?: {
    ffmpegOcrMask?: FfmpegOcrMaskProofV1
  }
}
~~~

- [ ] **Step 11.1: Snapshot the immutable separator facts before edits**

Create a frozen `V4_SEPARATOR_BASELINE` constant in `tests/release-tooling.test.ts` from the approved catalog and deep-compare every model field after omitting only top-level `runtimeChannel`. Do not derive the baseline with `git show HEAD` because the plan commit itself is the implementation base. Record these locked model facts in the fixture:

| Stable id | Bytes | SHA-256 |
|---|---:|---|
| `separator-fast-balanced-v1` | 63,234,907 | `4b92b6a8f15d78a8f121d58cf5f5cc1b068868a867c2ce414d3f3e1a067e4e1a` |
| `separator-quality-v1` | 64,894,371 | `6b9e38ef8ffaa49f1165ad5eb42a4dfd1c3a64731f8280f339cfdf5ec8749a93` |

The constant and test must deep-compare URLs, revisions, MDX dimensions, licenses, and stable IDs while allowing only the runtime channel to change.

- [ ] **Step 11.2: Add RED runtime-v5 default tests**

Require `runtime-v5` in `distributionConfig`, workflow dispatch default/fallback, publisher default, runtime input, separator input, and separator packer default. Require explicit runtime-v4 verification to remain accepted, but forbid any pack/default/publish path from silently selecting v4.

- [ ] **Step 11.3: Add RED OCR capability tests**

Require OCR asset version `1.1.0`, protocol `ocr-local/1`, and capabilities exactly—without duplicates or extras—`['probe', 'rapidocr', 'directml-fallback', 'visual-cues-v1']`. Require runtime status feature intersection to omit `visual-cues-v1` if the executable probe omits it even when the manifest declares it.

- [ ] **Step 11.4: Add RED staged-FFmpeg proof tests**

Use a fake staged `ffmpeg.exe` and injected hook to lock all branches:

| Input intent | Hook result | Generated manifest | Expected result |
|---|---|---|---|
| no `ocr-mask-v1` | not called | feature absent; proof absent | success |
| requests feature | built-in native runner: all cases pass, matching executable hash | feature and `native:true` proof present | success |
| requests feature | failed/throws/missing case | no outputs accepted | pack rejects |
| requests feature | pass but hash differs | no outputs accepted | pack rejects |
| requests feature | injected unit hook marked non-native | feature absent; nonpublishable unit result only | production verifier rejects |
| generated manifest declares feature | proof absent/invalid/stale | verification rejects | failure |

Factor the proof/capability derivation into a pure helper so success/failure branches are deterministic. A custom unit hook is always tagged `native:false` by the packer regardless of hook payload and cannot produce an accepted release; only the module's built-in child-process runner can set `native:true`. Unit-hook output is never recorded as a completed native acceptance gate in Task 12.

- [ ] **Step 11.5: Run the focused release RED**

Run:

~~~powershell
npm run test:local-runtime -- release-tooling.test canonical-runtime-migration.test
~~~

Expected: failures identify runtime-v4 defaults, OCR 1.0.0/missing feature, fixed-v4 separator validation, and missing native proof.

- [ ] **Step 11.6: Move defaults and intended inputs to runtime-v5**

Change the checked-in runtime/version defaults listed in the file table to `runtime-v5`. In `distribution/runtime-inputs.json`, set OCR 1.1.0 with the exact capability order above and add `ocr-mask-v1` to the FFmpeg input capability list as an intended packaging requirement. Do not change the pinned FFmpeg source URL/version/hash unless the real Task 8 native probe fails.

- [ ] **Step 11.7: Preserve separator model bytes and widen only the channel contract**

Set `runtimeChannel` and the separator packer default to `runtime-v5`. Make `modelManifest.ts` and the verifier accept the configured v5 channel while preserving exact two-model membership and every integrity field. Keep an explicit read-only compatibility path for verifying an already-existing v4 manifest; do not generate or rewrite v4 files.

- [ ] **Step 11.8: Inject the packer's clock and FFmpeg probe**

Extend `buildRuntimeRelease` with:

~~~js
export async function buildRuntimeRelease({
  inputDir,
  outputDir,
  runtimeVersion,
  platform = currentPlatform(),
  arch = currentArch(),
  inputSpecPath = resolve('distribution/runtime-inputs.json'),
  probeFfmpegOcrMask = runNativeFfmpegOcrMaskProbe,
  now = () => new Date().toISOString()
})
~~~

The production default executes `scripts/run-ffmpeg-ocr-mask-probe.mjs --ffmpeg <validated-staged-entrypoint>` with `execFile`/`shell:false`/`windowsHide:true`, a timeout, bounded output, and JSON-only parsing. Tests inject a pure hook and fixed clock, but `buildRuntimeRelease` marks that path non-native and refuses publishable `ocr-mask-v1` output. Test the successful proof derivation through the pure helper and run the real built-in runner conditionally when a managed executable exists.

- [ ] **Step 11.9: Bind the probe to the staged executable before archiving**

Resolve the FFmpeg entrypoint from `inputRoot/ffmpeg/<metadata.entrypoint>`, require it to be a contained regular non-symlink file, compute its SHA-256, and run the probe only when the input requests `ocr-mask-v1`. Require the returned executable hash and exact four passed case IDs to match. Abort before writing a manifest when any check fails.

- [ ] **Step 11.10: Derive capabilities inside a transactional release staging root**

Reject duplicate input capability strings. Treat input capabilities as requested intent: remove `ocr-mask-v1`, then add it back only after Step 11.9 succeeds. Attach the exact proof object using the injected ISO timestamp, current runtime version/platform/arch, generated FFmpeg asset name, and normalized entrypoint to both embedded manifest provenance and the separate provenance file. Every other FFmpeg capability retains its original order.

Build every archive/manifest/provenance file under a unique hidden sibling such as `.<outputName>.<uuid>.partial`; reject a pre-existing requested output directory. Verify the complete staging root, recheck the requested output is absent, then atomically rename staging to the requested output. On any error remove only staging in `finally`; never leave partial ZIPs in the requested output or overwrite an older release directory.

- [ ] **Step 11.11: Verify the actual archived executable, not the ZIP hash**

Add a bounded `sha256ArchiveEntry(archivePath, normalizedEntrypoint)` helper to `verify-runtime-release.mjs`. It must reject unsafe/duplicate entry names and stream only the exact FFmpeg entry bytes into SHA-256—PowerShell `System.IO.Compression.ZipArchiveEntry.Open()` on Windows and argument-array `unzip -p <archive> <entry>` on Unix—without loading the executable into one string or trusting the outer archive digest. The packer also invokes this helper against the staged archive before writing the final proof, so an archive containing bytes different from the probed staged executable is rejected.

- [ ] **Step 11.12: Enforce proof semantics in the release verifier**

First make the generic manifest validator reject duplicate capability strings for every asset. When generated FFmpeg capabilities include `ocr-mask-v1`, require schema 1, capability name, `native:true`, `passed:true`, exact runtime version/platform/arch/asset/entrypoint binding, a timestamp whose `new Date(value).toISOString()` round-trips exactly, exactly the four ordered unique passed cases with no extras, and `ffmpegExecutableSha256` equal to Step 11.11's archived-entry hash. Require the embedded and standalone proof objects to deep-equal. If the feature is absent, reject a stray success proof so evidence cannot drift from the manifest.

- [ ] **Step 11.13: Keep generic runtime manifest parsing forward-compatible but evidence-strict**

`src/main/runtimeManifest.ts` continues accepting explicit nonempty runtime versions for immutable verification, but runtime-v5 OCR/FFmpeg feature checks apply when those features are consumed. `runtimeProbes.ts` reports the set intersection of manifest capabilities and executable probe features; strings alone never promote readiness.

- [ ] **Step 11.14: Rename workflow labels without adding publication**

Update the workflow's v4-facing labels, defaults, and artifact names to v5. Retain `workflow_dispatch` and current pinned inputs. The workflow may build/verify artifacts but no plan step invokes the publisher or creates/releases a tag.

- [ ] **Step 11.15: Run focused GREEN and tamper tests**

Run:

~~~powershell
npm run typecheck
npm run test:local-runtime -- release-tooling.test canonical-runtime-migration.test autoshort-ocr-runtime.test
npm run test:local-runtime
git diff --check
~~~

Expected: all commands exit 0. The release suite must physically tamper the archived FFmpeg entry or proof hash and observe verifier failure, rather than merely unit-testing a predicate.

- [ ] **Step 11.16: Audit the v4 and separator diffs**

Run:

~~~powershell
git diff -- distribution/separator-model-inputs.json src/main/separation/modelManifest.ts scripts/pack-separator-model-release.mjs scripts/verify-separator-model-release.mjs
rg -n "runtime-v4" distribution src/main scripts .github/workflows tests
~~~

Expected: separator differences are channel/validation only; remaining `runtime-v4` references are explicit immutable-compatibility tests or messages, not defaults.

- [ ] **Step 11.17: Commit release contracts without generated archives**

~~~powershell
git add distribution/runtime-inputs.json distribution/separator-model-inputs.json src/main/distributionConfig.ts src/main/runtimeManifest.ts src/main/runtimeProbes.ts src/main/separation/modelManifest.ts scripts/pack-runtime-release.mjs scripts/verify-runtime-release.mjs scripts/pack-separator-model-release.mjs scripts/verify-separator-model-release.mjs scripts/publish-github-release.mjs .github/workflows/build-windows-runtime.yml tests/release-tooling.test.ts tests/canonical-runtime-migration.test.ts
git diff --cached --check
git commit -m "release(runtime): define OCR blur runtime v5"
~~~

Do not stage `release-inputs/`, `release-artifacts/`, `dist/`, an executable, an archive, or `SESSION_CHAT_LOG.md`.

**Exit gate:** runtime-v5 defaults are consistent, OCR capability is an executable/manifest intersection, FFmpeg mask support is cryptographically bound to the archived executable, and separator bytes remain unchanged.

---

### Task 12: Prove the production path with deterministic media and report evidence by scope

**Entry gate:** Tasks 1–11 are committed and their full suites are green. A missing managed runtime, network/build prerequisite, or approved user video changes only the corresponding acceptance row to `BLOCKED`; it does not permit a fallback binary or an inflated claim.

**Files:**
- Create: `scripts/generate-ocr-blur-fixture.mjs`
- Create: `scripts/ocr-blur-acceptance-main.ts`
- Create: `scripts/verify-ocr-blur-media.mjs`
- Create: `docs/benchmarks/2026-09-05-ocr-blur-acceptance.md`
- Modify: `tests/autoshort-ocr-burn.test.ts`
- Modify: `tests/autoshort-ocr-pipeline.test.ts`
- Modify: `tests/release-tooling.test.ts` only if the built archive exposes a new contract not already covered in Task 11
- Modify: `scripts/run-local-runtime-tests.mjs` only if a new test basename is added

**Fixture contract:**

| Property | Locked value |
|---|---|
| canvas | 1280x720 display pixels, square pixels, rotation 0 |
| source rate/duration | constant 30 fps, exactly 6.000 s |
| OCR sampling | 8 fps, 48 active samples plus one terminal black mask frame |
| target font | prepared `resources/fonts/NotoSans.ttf`, SHA-256 `bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d` |
| target backdrop | alternating 6x6-pixel light/dark checkerboard under the entire OCR region, so blur has measurable spatial energy even inside glyph counters |
| source audio | mono 48 kHz sine at 1500 Hz |
| narration audio | mono 48 kHz sine at 997 Hz |
| OCR region | `(64, 80)` through `(960, 680)` in display space |
| unrelated control | animated checkerboard at `(980, 470)` through `(1180, 620)`, always outside OCR/mask bounds |

**Ground-truth visual intervals:**

| Half-open interval | Text/boxes before safety padding | Required behavior |
|---|---|---|
| `[0.000, 0.500)` | none | no mask |
| `[0.500, 1.500)` | `ALPHA 123`, `(120,500)-(430,570)` | first stable box |
| `[1.500, 2.250)` | `ALPHA 123`, `(180,480)-(520,558)` | same text moves/resizes |
| `[2.250, 3.250)` | `LONGER TEXT 456`, `(100,480)-(650,562)` | abrupt length change |
| `[3.250, 4.000)` | `TOP 789`, `(120,420)-(390,480)` and `BOTTOM 012`, `(300,545)-(650,615)` | two independent boxes |
| `[4.000, 4.750)` | none | disappearance/no mask |
| `[4.750, 5.500)` | `FINAL 345`, `(160,500)-(500,575)` | terminal active interval |
| `[5.500, 6.000)` | none | four active-domain black samples before terminal frame |

The generator writes expected unpadded ground truth; production code alone applies the approved 15%/4..8 pixel padding and one-sample time margin.

- [ ] **Step 12.1: Add a real-main-path test before writing fixture scripts**

Extend `autoshort-ocr-pipeline.test.ts` to call the Task 9 item coordinator, not `burnAutoShort` directly. Inject a deterministic validated timeline but use the real Task 6 mask writer, Task 7 renderer, FFprobe validation, cleanup, and promotion against an explicit test FFmpeg/FFprobe pair. Assert the coordinator calls one visual timeline producer, passes the same object to SRT and mask consumers, and publishes exactly one validated final.

- [ ] **Step 12.2: Add the complete audio/input-index characterization matrix**

Run the same coordinator test for: source only/no narration (1500 Hz survives), replace (997 Hz present and 1500 Hz absent), mix (both tones within the configured gain tolerance), and narration plus mask (narration input 1, mask input 2). Assert ASS is applied after masked merge in every video variant. This closes the gap between Task 7 direct rendering tests and Task 9 production orchestration; stream count alone is not sufficient audio evidence.

- [ ] **Step 12.3: Run the conditional integration characterization gate**

Run:

~~~powershell
npm run test:local-runtime -- autoshort-ocr-pipeline.test autoshort-ocr-burn.test
~~~

Expected: the already-implemented coordinator cases pass, or the native rows print exactly `SKIP: managed FFmpeg fixture unavailable`; they must not use PATH. The RED cycle in this task applies to the still-missing generator/verifier CLI and their tamper self-tests, not to production behavior completed in Tasks 6–9.

- [ ] **Step 12.4: Implement the deterministic generator CLI**

`generate-ocr-blur-fixture.mjs` accepts only `--output-dir`, `--ffmpeg`, `--ffprobe`, and `--font`. Reject unknown/missing args, an existing nonempty output directory, non-regular binaries/font, a font hash mismatch, or a non-30-fps result. Spawn with argument arrays, `shell:false`, `windowsHide:true`, bounded diagnostics, and a 60-second timeout.

- [ ] **Step 12.5: Generate all fixture artifacts from code**

Write only these files beneath the resolved fixture root:

- `source.mp4`: the table above, high-contrast OCR text over the 6x6 target checkerboard, animated nontext control, and 1500 Hz source tone;
- `narration.wav`: 997 Hz sentinel covering 6.000 seconds;
- `sub.ass`: Noto Sans `RENDERED AFTER BLUR` in yellow plus the fixed cyan registration square during `[2.500,3.500)` across the previous-text area;
- `timeline.json`: schema-valid ground-truth `ocr-visual-cues/1` data at 8 fps;
- `samples.json`: named inside, cleared, outside-control, final-tail, and subtitle-layer sample windows;
- `fixture.json`: dimensions/rates/durations, exact source commands, font hash, and SHA-256 for the five other files.

Do not commit generated media or embed a third-party clip.

- [ ] **Step 12.6: Make generator output reproducible enough for assertions**

Use fixed colors, coordinates, seedless filters, the 6x6 checkerboard target backdrop, `-vsync cfr`, `-r 30`, `-t 6`, `libx264`, `-preset medium`, `-crf 10`, `-g 30`, `-bf 0`, `yuv420p`, mono PCM source generation before mux, and fixed metadata. Store source decoded `framemd5` in `fixture.json`. Do not assert the final MP4 byte hash across FFmpeg builds; assert decoded frame/audio facts and record the actual generated hashes.

- [ ] **Step 12.7: Implement the Electron acceptance entrypoint**

`ocr-blur-acceptance-main.ts` accepts `--operation render|install-readiness`, explicit fixture root, task-owned `--user-data`, output root, FFmpeg/FFprobe paths, OCR executable path or validated-timeline fixture, and profile. Parse/resolve `--user-data`, call `app.setPath('userData', resolvedRoot)`, and only then dynamically import any Main module that can call `app.getPath`. Render operation invokes the Task 9 item coordinator with blur on, `blurMode:'ocr-auto'`, the fixture OCR region, no manual rectangles, translation/TTS off, and source subtitles derived from the requested mode.

- [ ] **Step 12.8: Keep the acceptance entrypoint private and redacted**

Emit one final JSON object containing status, aggregate counts/durations, sanitized error code, and task-owned final path. Do not print OCR text, polygons, sidecar/mask/work paths, or environment contents. Exit nonzero on any failed/cancelled item and always wait for tracked children before quitting Electron.

- [ ] **Step 12.9: Implement the verifier/orchestrator CLI**

`verify-ocr-blur-media.mjs` accepts `--operation render|install-readiness`, `--fixture-dir`, `--output-dir`, `--user-data`, `--electron`, `--ffmpeg`, `--ffprobe`, optional `--ocr-engine`, optional `--runtime-release-dir`, and `--profile accurate|fast|both`. It validates containment, fixture hashes, and that Electron is an absolute regular non-reparse executable; creates non-existing per-run children such as `ground-truth-accurate`, `engine-accurate`, and `engine-fast` so transactional no-clobber rules never collide; bundles `ocr-blur-acceptance-main.ts` with the repository's installed esbuild into a unique temp directory; then spawns the explicit Electron executable as `[bundlePath, ...args]` with `shell:false`. Bound output/time and remove only the task-owned bundle directory in `finally`; never launch `electron.cmd` through a shell.

- [ ] **Step 12.10: Verify exact mask-domain behavior**

Decode the validated FFV1 mask to raw gray frames and assert:

- 49 frames total and frame 48 is all zero;
- expected active/cleared sample indexes reflect exactly one sample of temporal margin;
- padding uses `clamp(round(0.15 * height),4,8)` independently for every box;
- moving/resized and sudden-length boxes use actual geometry, not character-count estimates;
- every pixel outside the padded clipped boxes is zero;
- the `[5.500,6.000)` tail and terminal frame remain black except the single allowed leading safety sample at 5.500.

- [ ] **Step 12.11: Verify rendered video spatially**

Decode the product output and a no-blur control render to raw `rgb24`. For each named window in `samples.json`, compute mean absolute error (MAE), p99 absolute error, and horizontal/vertical gradient energy. Require target-region gradient energy during active intervals to be at most 65% of the control. In text-free/no-mask windows require luma MAE at most 4 and p99 absolute error at most 12. Require the outside checkerboard's gradient-energy ratio to remain within `0.90..1.10`. Store measured values in result JSON so a threshold failure is diagnosable without storing decoded frames.

- [ ] **Step 12.12: Verify half-open ending, layer order, and audio**

Assert the last OCR blur is absent at/after 5.625 seconds. Author `sub.ass` with Noto Sans, yellow text, and a fixed 8x8 cyan registration square at `(640,520)` during `[2.500,3.500)`; require that marker and the glyph window to retain at least 90% of the no-blur ASS control edge/color energy, proving subtitle composition occurs after blur. Compare final decoded video-frame timestamp/cadence to the 30-fps source and allow at most `1/30 + half one output time-base tick`; do not use MP4 format duration alone. Decode mono PCM and require: source-only 1500-Hz energy at least 20 dB above 997 Hz; replace 997-Hz energy at least 20 dB above 1500 Hz; mix both sentinel bins at least 15 dB above median neighboring-bin noise and their measured gain ratio within ±2 dB of the configured mix ratio.

- [ ] **Step 12.13: Add verifier self-tamper cases**

In the focused test, alter one expected mask frame, paint one outside pixel, hold the final active frame through EOF, swap audio tones, and blur the ASS layer. Require each mutation to fail its named assertion. A verifier that only checks decode/duration is insufficient.

- [ ] **Step 12.14: Run pure/source and managed-FFmpeg gates**

First prepare and verify the pinned font, then use only the managed FFmpeg pair:

~~~powershell
npm run fonts:prepare
npm run fonts:verify
$ocrAcceptanceRunId = [guid]::NewGuid().ToString('N')
$ocrFixtureDir = Join-Path $env:TEMP ('tediapros-ocr-blur-' + $ocrAcceptanceRunId)
$ocrOutputDir = Join-Path $env:TEMP ('tediapros-ocr-blur-output-' + $ocrAcceptanceRunId)
$ocrUserDataDir = Join-Path $env:TEMP ('tediapros-ocr-blur-userdata-' + $ocrAcceptanceRunId)
$ocrBuildRoot = Join-Path $env:TEMP ('tediapros-ocr-v1.1-' + $ocrAcceptanceRunId)
$runtimeOutputDir = Join-Path $env:TEMP ('tediapros-runtime-v5-' + $ocrAcceptanceRunId)
$taskOwnedTempRoots = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($taskOwnedCandidate in @($ocrFixtureDir, $ocrOutputDir, $ocrUserDataDir, $ocrBuildRoot, $runtimeOutputDir)) {
  [void]$taskOwnedTempRoots.Add([IO.Path]::GetFullPath($taskOwnedCandidate))
}
$managedFfmpeg = Join-Path $env:APPDATA 'tedia-pros\bin\ffmpeg\ffmpeg.exe'
$managedFfprobe = Join-Path $env:APPDATA 'tedia-pros\bin\ffmpeg\ffprobe.exe'
$fixtureFont = Join-Path (Get-Location) 'resources\fonts\NotoSans.ttf'
$electronExe = (& node -e "process.stdout.write(require('electron'))").Trim()
if (-not (Test-Path -LiteralPath $fixtureFont -PathType Leaf)) { throw "Prepared fixture font missing: $fixtureFont" }
$fixtureFontHash = (Get-FileHash -LiteralPath $fixtureFont -Algorithm SHA256).Hash.ToLowerInvariant()
if ($fixtureFontHash -ne 'bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d') { throw 'Fixture font hash mismatch.' }
if (-not (Test-Path -LiteralPath $electronExe -PathType Leaf)) { throw "Electron executable missing: $electronExe" }
if ((Get-Item -LiteralPath $electronExe -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Electron executable must not be a reparse point.' }
node scripts/generate-ocr-blur-fixture.mjs --output-dir "$ocrFixtureDir" --ffmpeg "$managedFfmpeg" --ffprobe "$managedFfprobe" --font "$fixtureFont"
node scripts/verify-ocr-blur-media.mjs --operation render --fixture-dir "$ocrFixtureDir" --output-dir "$ocrOutputDir" --user-data "$ocrUserDataDir" --electron "$electronExe" --ffmpeg "$managedFfmpeg" --ffprobe "$managedFfprobe" --profile both
~~~

The no-engine invocation validates the complete Main/mask/render path with ground-truth timeline injection. Record it as synthetic production-path evidence, not RapidOCR evidence.

- [ ] **Step 12.15: Build OCR engine 1.1.0 in an isolated Python 3.12.10 environment**

Use the same requirements and PyInstaller spec as the workflow:

~~~powershell
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
$ocrVersionLines = @(& $ocrExe --version)
if ($LASTEXITCODE -ne 0 -or $ocrVersionLines.Count -ne 1) { throw 'OCR --version must emit exactly one successful JSON line.' }
$ocrVersionEvent = $ocrVersionLines[0] | ConvertFrom-Json
$ocrProbeLines = @(& $ocrExe --probe)
if ($LASTEXITCODE -ne 0 -or $ocrProbeLines.Count -ne 1) { throw 'OCR --probe must emit exactly one successful JSON line.' }
$ocrProbeEvent = $ocrProbeLines[0] | ConvertFrom-Json
$expectedOcrFeatures = 'directml-fallback,probe,rapidocr,visual-cues-v1'
if ($ocrVersionEvent.version -ne '1.1.0' -or $ocrVersionEvent.protocol -ne 'ocr-local/1' -or (@($ocrVersionEvent.features) -join ',') -ne $expectedOcrFeatures) { throw 'OCR version contract mismatch.' }
if ($ocrProbeEvent.ready -ne $true -or $ocrProbeEvent.protocol -ne 'ocr-local/1' -or (@($ocrProbeEvent.features) -join ',') -ne $expectedOcrFeatures) { throw 'OCR probe contract mismatch.' }
~~~

If dependency download needs network permission, request it at execution time. Never install into the system Python environment.

- [ ] **Step 12.16: Run unpatched RapidOCR acceptance for both profiles**

Run:

~~~powershell
npm run test:ocr-engine
node scripts/verify-ocr-blur-media.mjs --operation render --fixture-dir "$ocrFixtureDir" --output-dir "$ocrOutputDir" --user-data "$ocrUserDataDir" --electron "$electronExe" --ffmpeg "$managedFfmpeg" --ffprobe "$managedFfprobe" --ocr-engine "$ocrExe" --profile both
~~~

Require the parsed version/probe contracts above; accurate invokes RapidOCR once per 8-fps frame and fast once per preliminary segment. Validate recognized normalized strings, nonempty boxes contained in/intersecting the scan region, sidecar/SRT projection, bounded diagnostics, cancellation cleanup, and final media assertions. OCR polygons may vary by provider/model build: do not require byte-identical authored coordinates, patch engine output, or substitute ground-truth boxes in this row.

- [ ] **Step 12.17: Build and verify a local runtime-v5 archive only when clean inputs exist**

Preflight `release-inputs/runtime-v5-win32-x64` for all required runtime directories and input hashes. If present, run:

~~~powershell
$runtimeInputDir = Join-Path (Get-Location) 'release-inputs\runtime-v5-win32-x64'
npm run release:pack -- --input-dir "$runtimeInputDir" --output-dir "$runtimeOutputDir" --runtime-version runtime-v5 --platform win32 --arch x64
node scripts/verify-runtime-release.mjs "$runtimeOutputDir"
~~~

Confirm the generated manifest contains the OCR exact feature list and a native FFmpeg proof whose executable hash matches the archive entry. If clean inputs do not exist, record `BLOCKED — clean runtime-v5 inputs unavailable`; do not reconstruct them from APPDATA.

- [ ] **Step 12.18: Install the local archive into isolated userData and rerun readiness**

When Step 12.17 succeeds, invoke the acceptance entrypoint's `install-readiness` operation through the verifier:

~~~powershell
node scripts/verify-ocr-blur-media.mjs --operation install-readiness --fixture-dir "$ocrFixtureDir" --output-dir "$ocrOutputDir" --user-data "$ocrUserDataDir" --electron "$electronExe" --ffmpeg "$managedFfmpeg" --ffprobe "$managedFfprobe" --runtime-release-dir "$runtimeOutputDir" --profile accurate
~~~

Inside Electron, create a local fetch hook that maps only the configured manifest and asset URLs to files under the verified release root. Invoke `downloadRuntimeEngineFromManifest` for FFmpeg and OCR using the real ZIP validator/extractor and real `probeRuntimeAsset`; do not inject a passing probe. Then call `getAutoShortReadiness` for active OCR-auto and assert both verified `visual-cues-v1` and native `ocr-mask-v1` readiness. Verify installed receipts/active paths stay under the task-owned userData root and tampered archive/hash/probe cases leave the previous active tree untouched. This is the on-demand-install gate; archive verification alone does not satisfy it.

- [ ] **Step 12.19: Build and inspect the Windows application package**

Run `npm run package:win`, then `npm run package:verify`. Confirm the app package contains no managed OCR/FFmpeg/separator executables or model weights, bundled fonts pass their verifier, and on-demand v5 install remains the only runtime route. Packaging success does not imply a GitHub release exists.

- [ ] **Step 12.20: Gate representative user-media testing on explicit scope**

Run one automatic accurate-profile job on a representative local user video only when the user separately supplies or approves that file and output directory for acceptance. Never infer approval from the screenshot or scan unrelated media directories. Without approved input, record `BLOCKED — no approved representative input`; the generated fixture cannot satisfy this row.

- [ ] **Step 12.21: Run the final repository gates**

Run:

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

Expected: every available command exits 0, and status lists only intended task files plus explicitly preserved pre-existing user files. A blocked external gate stays blocked; it does not convert a passing source suite into production proof.

- [ ] **Step 12.22: Write the acceptance ledger with exact evidence boundaries**

Create `docs/benchmarks/2026-09-05-ocr-blur-acceptance.md` with: commit, OS/CPU/GPU, managed FFmpeg/FFprobe versions and SHA-256, OCR/Python/model versions, exact commands, fixture hashes, profile measurements, cleanup result, and this table using only `PASS`, `FAIL`, `PARTIAL`, `BLOCKED`, or `NOT RUN`:

| Gate | Required evidence |
|---|---|
| source/type/unit | exact command and counts |
| Python OCR domain/CLI | exact command and engine probe |
| synthetic production path | coordinator plus real mask/burn/validation metrics |
| real RapidOCR fixture | unpatched accurate and fast runs |
| packaged runtime-v5 | packer/verifier plus archived-executable proof |
| isolated on-demand install | real extract/probes plus OCR-auto readiness |
| Windows app package | package verifier and contents audit |
| representative user media | approved input identity and observed result |

Never write OCR text/coordinates from user media into the ledger; generated fixture facts may be recorded because they are committed design data.

- [ ] **Step 12.23: Clean only task-owned temporary roots after evidence is saved**

Place this cleanup block in the outer acceptance driver's `finally` so failed generation/build/probe runs also converge here after any partial ledger entry is written. Resolve and validate every candidate before recursive deletion:

~~~powershell
$taskTempRoot = [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath([IO.Path]::GetTempPath()))
$taskTempPrefix = $taskTempRoot + [IO.Path]::DirectorySeparatorChar
foreach ($taskTempResolved in $taskOwnedTempRoots) {
  if (-not $taskTempResolved.StartsWith($taskTempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing cleanup outside task temp root: $taskTempResolved"
  }
  if (Test-Path -LiteralPath $taskTempResolved) {
    $taskTempItem = Get-Item -LiteralPath $taskTempResolved -Force
    if ($taskTempItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "Refusing cleanup of reparse-point root: $taskTempResolved"
    }
    $taskTempCursor = $taskTempItem.Parent
    while ($null -ne $taskTempCursor -and $taskTempCursor.FullName -ne $taskTempRoot) {
      if ($taskTempCursor.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing cleanup through reparse-point ancestor: $($taskTempCursor.FullName)"
      }
      $taskTempCursor = $taskTempCursor.Parent
    }
    $nestedReparse = Get-ChildItem -LiteralPath $taskTempResolved -Force -Recurse |
      Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } |
      Select-Object -First 1
    if ($null -ne $nestedReparse) {
      throw "Refusing cleanup with nested reparse point: $($nestedReparse.FullName)"
    }
    Remove-Item -LiteralPath $taskTempResolved -Recurse -Force
  }
}
~~~

The `HashSet` created in Step 12.14 is the ownership registry; never add a discovered path to it later. If reparse validation fails, leave that root in place and record cleanup `PARTIAL` for manual inspection. Do not delete APPDATA runtimes, source videos, final user outputs, `release-inputs`, repository artifacts, or any directory not created by these commands.

- [ ] **Step 12.24: Request independent code review and address findings**

Use `superpowers:requesting-code-review` against the approved spec and both plans. For each finding, use `superpowers:receiving-code-review`, reproduce it, change the smallest responsible task, and rerun every affected focused and full gate. Do not accept a finding solely because it sounds plausible.

- [ ] **Step 12.25: Commit scripts/tests/evidence only**

~~~powershell
git add scripts/generate-ocr-blur-fixture.mjs scripts/ocr-blur-acceptance-main.ts scripts/verify-ocr-blur-media.mjs docs/benchmarks/2026-09-05-ocr-blur-acceptance.md tests/autoshort-ocr-burn.test.ts tests/autoshort-ocr-pipeline.test.ts
git diff --cached --check
git commit -m "test(autoshort): verify OCR timed blur"
~~~

If Task 12 legitimately changed `tests/release-tooling.test.ts` or the test registry, stage those exact files explicitly. Never stage generated media, runtime archives, `dist/`, task temp directories, or `SESSION_CHAT_LOG.md`.

**Exit gate:** deterministic media proves spatial/temporal/layer/audio behavior through the Main coordinator, unpatched RapidOCR and packaged-runtime results are reported only when actually run, and every absent external proof is visibly blocked rather than inferred.

---

## Completion checklist

- [ ] Legacy saved configurations normalize to manual/accurate, while malformed explicit IPC values are rejected.
- [ ] Manual rectangles remain stored and unchanged while OCR-auto is selected, disabled, or switched back.
- [ ] Automatic mode consumes the shared OCR scan region and never combines manual rectangles with a timed mask.
- [ ] Accurate runs RapidOCR on every 8-fps sample; Fast uses OpenCV/Jaccard segmentation and exactly one RapidOCR call per preliminary segment.
- [ ] Every nonempty RapidOCR detection with confidence strictly greater than 0.5 and positive polygon/scan-region intersection is retained.
- [ ] Box width/height comes from the true clipped polygon; text length is never used to estimate geometry.
- [ ] One validated visual timeline is the source for both OCR-derived SRT timing and per-sample mask geometry.
- [ ] Single-sample gap fill, 15% padding clamped to 4..8 pixels, one-sample temporal margin, and half-open intervals match the approved formulas.
- [ ] Video-stream duration controls sample count even when container audio is longer.
- [ ] The FFV1 mask has exact dimensions/rate/frame count, hashes match the pure raster plan, and its terminal frame is black.
- [ ] Automatic blur uses the existing blur-strength policy and a constant-size `maskedmerge` graph with computed input indexes.
- [ ] Manual graph output remains regression-equivalent and public `BurnReq` rejects every mask-related field.
- [ ] A pre-existing final is never overwritten/deleted; new output is promoted only after complete media validation.
- [ ] OCR, empty result, invalid sidecar, mask, render, validation, promotion, or cancellation failure publishes no new final.
- [ ] Checkpoint v5 reruns required visual OCR and invalidates dependent translation/TTS only when canonical source-cue evidence changes.
- [ ] Ordinary logs, UI, audit, checkpoint, and success artifacts contain no OCR text, coordinates, temporary paths, sidecars, or mask contents.
- [ ] OCR/mask/render children settle and sidecar/mask/partial/work artifacts are cleaned on success, failure, and cancellation.
- [ ] UI has exactly two blur modes/two automatic profiles, accessible focus behavior, approved warnings, and correct overlay transitions.
- [ ] OCR readiness is the manifest/probe feature intersection; FFmpeg readiness is a successful native four-case probe.
- [ ] runtime-v5 advertises `ocr-mask-v1` only with proof bound to the packaged FFmpeg executable SHA-256.
- [ ] Separator model IDs, URLs, revisions, dimensions, licenses, byte sizes, and hashes remain unchanged from the approved v4 catalog.
- [ ] runtime-v4 remains immutable and no task creates or publishes a release/tag.
- [ ] Source, engine, synthetic media, real RapidOCR, packaged runtime, app package, and representative user-media evidence are reported as separate rows.

## Implementation handoff

Before implementation, commit this runbook and use the latest documentation commit as the worktree base. Execute one task per commit, stop at every exit gate, and update checkboxes only from command output or observed UI/media evidence. If a native/runtime/user-media gate cannot run, continue only with independent tasks and preserve its explicit `BLOCKED` row for the acceptance ledger.
