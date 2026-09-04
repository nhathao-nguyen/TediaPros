# Auto Short Client-Side Vocal Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third Auto Short audio mode that locally removes source dialogue, retains the recovered music/SFX bed, mixes the existing TTS narration over it, and runs on Windows 10/11 x64 with DirectML acceleration plus one deterministic CPU fallback.

**Architecture:** Ship a minimal, network-free MDX ONNX separator as a managed `separator-engine/1` runtime, while shipping two independently licensed model packages through a separate checksum-verified model manifest. The Electron main process owns installation, readiness, extraction, process execution, fallback, validation, checkpointing, mixing, and cleanup; the renderer owns only the three-mode/preset UI and progress display. Integrate the feature as a sequential stage in the current Auto Short coordinator so Whisper and separation never contend for the GPU.

**Tech Stack:** Electron 34, React 19, TypeScript 5.7, Node 20 tests bundled by esbuild, Python 3.12.10, ONNX Runtime DirectML 1.29.0, NumPy 2.5.2, SoundFile 0.13.1, PyInstaller 6.22.2, FFmpeg/FFprobe, GitHub immutable release assets.

**Spec:** `docs/superpowers/specs/2026-09-04-autoshort-client-vocal-separation-design.md`

## Global Constraints

- Target Windows 10/11 x64 clients with NVIDIA, AMD, or Intel DirectX 12 GPUs; CPU remains the correctness fallback.
- Expose exactly three presets: `fast`, `balanced`, and `quality`; persist `balanced` as the default for the new mode.
- Use exactly two qualified MDX ONNX model packages: `separator-fast-balanced-v1` for Fast/Balanced and `separator-quality-v1` for Quality.
- Fix preset parameters at overlap `0.10`/`0.25`/`0.50` and batch `1`; use each model's cataloged native FFT and segment dimensions.
- Preserve existing `replace`, `mix`, and replace-mode background-music behavior byte-for-byte unless a focused regression test requires a shared compositor refactor.
- Do not show the existing background-music controls when `audioMode === 'separate-vocals'`.
- Require `TTS` for `separate-vocals` and never silently restore source dialogue by falling back to `mix`, `replace`, or raw source audio.
- Run queue items sequentially and await subtitle extraction completely before separator inference; do not overlap Whisper and separator GPU work.
- Attempt DirectML first, retry from the beginning on CPU exactly once after a DirectML provider failure, then pin the remainder of that job to CPU.
- A source with no audio stream produces TTS-only output and a visible warning; corrupt or unsupported source audio fails before inference.
- The separator executable has no network client. Only Electron main may download a runtime or model.
- Keep `runtime-v3` immutable; publish this feature through the new immutable `runtime-v4` channel.
- Install the engine under `<userData>/bin/separator-engine`, models under `<userData>/separator-models/<stable-id>`, and receipts under `<userData>/runtime-state`.
- Keep the app installer free of the separator executable, DLLs, model weights, archives, and benchmark media.
- Reject unsafe archive paths and engine-returned paths outside the per-item work directory.
- Drain stderr continuously, keep a bounded sanitized tail, and register every FFmpeg/separator child with `trackChildProcess`.
- Never preserve `vocals.wav` in success or failure artifacts; delete source/stem intermediates after success and after failure diagnostics are recorded.
- “Free” means no separation API or per-minute fee; do not claim zero bandwidth, disk, electricity, hosting, or support cost.
- Treat inference-code licensing and model-weight redistribution licensing as separate hard release gates.
- Do not claim a vendor verified without a recorded real-hardware run. Missing AMD/Intel evidence ships as beta/partial for that vendor.
- Use red-green-refactor for production changes and commit only the files named by the current task.
- Run `npm run test:local-runtime`, not `npm test`; this repository has no `npm test` script.
- Do not start execution from the current dirty checkout by stashing, resetting, cleaning, or overwriting user work. At execution time use `superpowers:using-git-worktrees` from a commit that contains the intended `src/main/autoShortBackgroundAudio.ts`, `src/main/burn.ts`, and `tests/local-runtime.test.ts` changes.

---

## File Structure

### Qualification and release evidence

- Create `scripts/separator_qualification.py`: deterministic corpus runner, metrics aggregation, acceptance-gate evaluation, and machine-readable report writer.
- Create `scripts/requirements-separator-qualification.txt`: pinned reference-harness dependency used only during model selection.
- Create `tests/python/test_separator_qualification.py`: gate math, license rejection, and deterministic selection tests.
- Create `scripts/generate-separator-test-fixtures.py`: generated known-stem synthetic fixtures with no redistributable third-party media.
- Create `tests/fixtures/separator/README.md`: exact private-corpus layout and scoring instructions.
- Modify `.gitignore`: exclude `tests/fixtures/separator/private/` and benchmark audio/results.
- Create `distribution/separator-model-inputs.json`: the two accepted source artifacts, immutable hashes/bytes, MDX metadata, license evidence, and attribution.
- Create `distribution/separator-release-status.json`: qualification and hardware claim state consumed by the release gate.
- Create `docs/benchmarks/2026-09-04-separator-model-qualification.md`: reviewed evidence and selected stable-ID mapping.

### Shared product contract

- Create `src/shared/autoShortSeparation.ts`: stable model IDs, preset mapping, release-status types, and pure lookup helpers.
- Modify `src/shared/types.ts`: audio-mode, preset, dependency, readiness, provider, and progress types.
- Modify `src/shared/autoShortContract.ts`: migration and request validation.
- Create `tests/separator-contract.test.ts`: pure contract and preset regressions.
- Modify `scripts/run-local-runtime-tests.mjs`: bundle and execute the new TypeScript suites.

### Separator engine

- Create `engines/separator-engine/protocol.py`: `separator-engine/1` JSON Lines output.
- Create `engines/separator-engine/audio_io.py`: stereo 44.1 kHz PCM WAV validation and finite-sample writes.
- Create `engines/separator-engine/mdx.py`: the audited, minimal MDX STFT/ONNX overlap-add path.
- Create `engines/separator-engine/engine.py`: CLI dispatch, provider selection, probe, progress, result, and error events.
- Create `engines/separator-engine/requirements.txt`: exact build pins only.
- Create `engines/separator-engine/separator-engine.spec`: deterministic PyInstaller bundle.
- Create `engines/separator-engine/tests/test_protocol.py`, `test_audio_io.py`, and `test_mdx.py`.
- Modify `package.json`: add the separator-engine test command.

### Runtime and model distribution

- Modify `src/main/runtimeResolver.ts`, `src/main/runtimeManifest.ts`, `src/main/runtimeProbes.ts`, and `src/main/runtimeInstaller.ts`: add `separator-engine` to the managed runtime lifecycle.
- Modify `src/main/distributionConfig.ts`: expose `runtime-v4` and the separator-model manifest/asset URLs.
- Create `src/main/separation/modelManifest.ts`: schema-1 remote and local model metadata validation.
- Create `src/main/separation/modelStore.ts`: canonical model paths, checksums, and installed-model resolution.
- Create `src/main/separation/modelInstaller.ts`: staged download/extraction/probe/atomic promotion.
- Create `src/main/separation/runner.ts`: version/probe JSON Lines client, extended with separation execution in Task 6.
- Create `src/main/separation/releaseGate.ts`: bundled qualification/hardware status validation and development override.
- Create `scripts/pack-separator-model-release.mjs` and `scripts/verify-separator-model-release.mjs`.
- Modify `distribution/runtime-inputs.json`, `scripts/pack-runtime-release.mjs`, `scripts/verify-runtime-release.mjs`, `scripts/publish-github-release.mjs`, `scripts/verify-packaged-app.mjs`, `electron-builder.yml`, `.github/workflows/build-windows-runtime.yml`, and `tests/release-tooling.test.ts`.
- Modify `THIRD-PARTY-NOTICES.txt` and `src/renderer/src/components/License.tsx` with reviewed engine/runtime/model notices.

### Main-process integration

- Create `src/main/separation/media.ts`: source-audio probe/extraction, stem probing, duration normalization, and decode checks.
- Modify `src/main/separation/runner.ts`: extend the version/probe client with cancellable separation execution and sanitized bounded diagnostics.
- Create `src/main/separation/disk.ts`: model-install and per-job free-space calculations.
- Create `src/main/separation/pipeline.ts`: DirectML-to-CPU policy and validated instrumental result.
- Create `src/main/autoShortNarratedAudio.ts`: common narration/bed compositor supporting looping music and finite separated beds.
- Modify `src/main/autoShortBackgroundAudio.ts`: compatibility wrapper over the common compositor.
- Modify `src/main/autoshort.ts`: readiness, dependency installation, checkpoint v4, separation stage, audit, cleanup, and burn wiring.
- Modify `src/main/index.ts` and `src/preload/index.ts`: widen readiness/install IPC without exposing filesystem control.
- Create `tests/separator-runtime.test.ts` and `tests/separator-pipeline.test.ts`.
- Modify `tests/local-runtime.test.ts` and `tests/e2e-autoshort.test.ts` for non-regression and full-pipeline coverage.

### Renderer and release validation

- Modify `src/renderer/src/components/AutoShort.tsx`: third mode, preset cards, install state, effective provider, warnings, and phase labels.
- Modify `src/renderer/src/styles/autoshort.css`: mode/preset/download-state layouts.
- Create `docs/benchmarks/2026-09-04-separator-hardware-acceptance.md`: signed-off Windows GPU/CPU results and release tier.
- Modify `README.md`: accurate local/offline, hardware, download, cost, and beta wording.

---

### Task 1: Qualify and license exactly two model weights

**Files:**
- Create: `scripts/separator_qualification.py`
- Create: `scripts/requirements-separator-qualification.txt`
- Create: `tests/python/test_separator_qualification.py`
- Create: `scripts/generate-separator-test-fixtures.py`
- Create: `tests/fixtures/separator/README.md`
- Modify: `.gitignore`
- Create after the gate passes: `distribution/separator-model-inputs.json`
- Create: `distribution/separator-release-status.json`
- Create: `docs/benchmarks/2026-09-04-separator-model-qualification.md`

**Interfaces:**
- Consumes: a local corpus manifest with `known_stem` and `real_clip` cases; two to four MDX ONNX candidates with independently reviewed source-code and weight licenses; the qualification-only `audio-separator[dml]` 0.47.0 reference harness pinned to upstream tag commit `c7f2a5c8c3beea1f9ec9ab7206caaebc05f45ac4`.
- Produces: `evaluate_release_pair(compact: CandidateSummary, quality: CandidateSummary) -> QualificationDecision`; an accepted `distribution/separator-model-inputs.json` containing exactly `separator-fast-balanced-v1` and `separator-quality-v1`; a release status with `qualificationPassed` and `enabledByDefault` booleans.

- [ ] **Step 1: Write failing unit tests for the fixed acceptance gates**

Create `tests/python/test_separator_qualification.py`:

```python
import unittest
from scripts.separator_qualification import CandidateSummary, LicenseReview, evaluate_release_pair

APPROVED = LicenseReview(
    code_spdx="MIT",
    weight_license_name="Reviewed redistribution grant",
    weight_license_url="https://example.invalid/license-evidence-used-only-in-unit-test",
    weight_redistribution_approved=True,
)

class QualificationGateTests(unittest.TestCase):
    def test_accepts_pair_when_speed_quality_and_licenses_pass(self):
        compact = CandidateSummary(
            candidate_id="compact",
            license_review=APPROVED,
            fast_median_seconds=7.0,
            balanced_median_seconds=10.0,
            balanced_no_intelligible_dialogue_ratio=0.80,
            balanced_severe_damage_ratio=0.10,
            quality_leakage_improvement_db=0.0,
            quality_blind_win_ratio=0.0,
        )
        quality = CandidateSummary(
            candidate_id="hq",
            license_review=APPROVED,
            fast_median_seconds=0.0,
            balanced_median_seconds=0.0,
            balanced_no_intelligible_dialogue_ratio=0.0,
            balanced_severe_damage_ratio=0.08,
            quality_leakage_improvement_db=2.2,
            quality_blind_win_ratio=0.68,
        )
        decision = evaluate_release_pair(compact, quality)
        self.assertTrue(decision.accepted)
        self.assertEqual(decision.fast_balanced_candidate_id, "compact")
        self.assertEqual(decision.quality_candidate_id, "hq")

    def test_rejects_ambiguous_weight_rights_even_when_metrics_pass(self):
        unapproved = LicenseReview("MIT", "Unknown", "", False)
        compact = CandidateSummary("compact", unapproved, 7.0, 10.0, 0.9, 0.02, 0.0, 0.0)
        quality = CandidateSummary("hq", APPROVED, 0.0, 0.0, 0.0, 0.02, 3.0, 0.8)
        self.assertFalse(evaluate_release_pair(compact, quality).accepted)

    def test_rejects_fast_when_it_is_not_twenty_five_percent_faster(self):
        compact = CandidateSummary("compact", APPROVED, 7.6, 10.0, 0.9, 0.02, 0.0, 0.0)
        quality = CandidateSummary("hq", APPROVED, 0.0, 0.0, 0.0, 0.02, 3.0, 0.8)
        self.assertFalse(evaluate_release_pair(compact, quality).accepted)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the qualification tests and confirm red**

Run:

```powershell
python -m unittest tests/python/test_separator_qualification.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.separator_qualification'`.

- [ ] **Step 3: Implement the gate evaluator before adding inference code**

In `scripts/separator_qualification.py` define these immutable records and exact gate logic:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class LicenseReview:
    code_spdx: str
    weight_license_name: str
    weight_license_url: str
    weight_redistribution_approved: bool

@dataclass(frozen=True)
class CandidateSummary:
    candidate_id: str
    license_review: LicenseReview
    fast_median_seconds: float
    balanced_median_seconds: float
    balanced_no_intelligible_dialogue_ratio: float
    balanced_severe_damage_ratio: float
    quality_leakage_improvement_db: float
    quality_blind_win_ratio: float

@dataclass(frozen=True)
class QualificationDecision:
    accepted: bool
    reasons: tuple[str, ...]
    fast_balanced_candidate_id: str | None
    quality_candidate_id: str | None

def evaluate_release_pair(compact: CandidateSummary, quality: CandidateSummary) -> QualificationDecision:
    reasons: list[str] = []
    if not compact.license_review.weight_redistribution_approved:
        reasons.append("compact_weight_redistribution_not_approved")
    if not quality.license_review.weight_redistribution_approved:
        reasons.append("quality_weight_redistribution_not_approved")
    if compact.balanced_median_seconds <= 0 or compact.fast_median_seconds > compact.balanced_median_seconds * 0.75:
        reasons.append("fast_speed_gate_failed")
    if compact.balanced_no_intelligible_dialogue_ratio < 0.80:
        reasons.append("balanced_dialogue_gate_failed")
    if compact.balanced_severe_damage_ratio > 0.10:
        reasons.append("balanced_damage_gate_failed")
    quality_improves = (
        quality.quality_leakage_improvement_db >= 2.0
        or quality.quality_blind_win_ratio >= 0.70
    )
    if not quality_improves:
        reasons.append("quality_improvement_gate_failed")
    if quality.balanced_severe_damage_ratio > compact.balanced_severe_damage_ratio:
        reasons.append("quality_damage_regression")
    return QualificationDecision(
        accepted=not reasons,
        reasons=tuple(reasons),
        fast_balanced_candidate_id=compact.candidate_id if not reasons else None,
        quality_candidate_id=quality.candidate_id if not reasons else None,
    )
```

- [ ] **Step 4: Run the unit tests and confirm green**

Run:

```powershell
python -m unittest tests/python/test_separator_qualification.py -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Add deterministic generated fixtures and private-corpus containment**

Implement `scripts/generate-separator-test-fixtures.py` so it synthesizes stereo 44.1 kHz PCM16 speech-like chirps, tonal music, transient SFX, silence, and known isolated stems from mathematical signals. Write only under the explicit `--output-dir` argument and emit a manifest with `caseId`, `kind`, `mixturePath`, `vocalsReferencePath`, `instrumentalReferencePath`, and `durationSeconds`.

Add to `.gitignore`:

```gitignore
tests/fixtures/separator/generated/
tests/fixtures/separator/private/
separator-benchmark-results/
```

Document `tests/fixtures/separator/private/manifest.json` as an untracked file containing licensed internal real clips with categories `speech_music`, `speech_transient_sfx`, `multiple_speakers`, `singing`, `silence`, and `compressed_social_video`; include short, two-minute, and ten-minute cases. The runner must reject paths escaping the manifest directory and must never copy corpus media to release output.

- [ ] **Step 6: Add the pinned reference harness and machine-readable benchmark evidence**

Create `scripts/requirements-separator-qualification.txt` with the single top-level pin `audio-separator[dml]==0.47.0`. Record `pip freeze`, Python version, the upstream tag commit `c7f2a5c8c3beea1f9ec9ab7206caaebc05f45ac4`, and ONNX Runtime providers in every report. This dependency may contain Torch and download helpers because it is an isolated research harness; no file from its environment is copied into the production engine or app.

Extend `scripts/separator_qualification.py` with CLI arguments `--candidate-manifest`, `--corpus-manifest`, `--output-json`, and `--output-markdown`. Instantiate `audio_separator.separator.Separator` with the candidate's already-downloaded immutable file directory, WAV output, sample rate 44100, `mdx_params` containing overlap 0.10/0.25/0.50 and batch size 1, and `use_directml=True` for the GPU pass. Disable the harness's download path after candidate staging and fail if it attempts network access during inference. Record provider/version, elapsed time, peak working set when available, speech leakage in dB for known stems, real-clip dialogue/damage scores from a completed reviewer sheet, and all license fields. Sort cases and candidates before aggregation so repeated runs are stable. On acceptance, copy the two verified local inputs into the ignored directories `separator-benchmark-results/accepted/separator-fast-balanced-v1/` and `separator-benchmark-results/accepted/separator-quality-v1/`, then write their local benchmark manifests.

Use this reference-harness construction inside the runner:

```python
separator = Separator(
    model_file_dir=str(candidate_path.parent),
    output_dir=str(case_output_dir),
    output_format="WAV",
    sample_rate=44_100,
    use_soundfile=True,
    use_directml=provider == "directml",
    mdx_params={
        "hop_length": candidate.mdx.hop_length,
        "segment_size": candidate.mdx.segment_size,
        "overlap": preset_overlap,
        "batch_size": 1,
        "enable_denoise": False,
    },
)
separator.load_model(model_filename=candidate_path.name)
outputs = separator.separate(str(case_path))
```

Run:

```powershell
python -m venv separator-benchmark-tools\venv
& 'separator-benchmark-tools\venv\Scripts\python.exe' -m pip install --disable-pip-version-check --no-cache-dir -r scripts/requirements-separator-qualification.txt
python scripts/generate-separator-test-fixtures.py --output-dir tests/fixtures/separator/generated
& 'separator-benchmark-tools\venv\Scripts\python.exe' scripts/separator_qualification.py --candidate-manifest tests/fixtures/separator/private/candidates.json --corpus-manifest tests/fixtures/separator/private/manifest.json --output-json separator-benchmark-results/qualification.json --output-markdown docs/benchmarks/2026-09-04-separator-model-qualification.md
```

Expected: exit 0 only when one compact/HQ pair passes every numeric and license gate; otherwise exit non-zero with stable reason codes and keep `enabledByDefault: false`.

- [ ] **Step 7: Lock the accepted artifact metadata without aliases or mutable URLs**

When and only when Step 6 exits 0, write `distribution/separator-model-inputs.json` with schema version 1, runtime channel `runtime-v4`, and exactly two object keys. Each record must contain:

```text
id, version, source.url, source.revision, source.bytes, source.sha256,
license.codeSpdx, license.weightName, license.weightUrl,
license.weightRedistributionApproved=true, license.attribution,
model.path="model.onnx", model.bytes, model.sha256,
mdx.sampleRate=44100, mdx.channels=2, mdx.nFft, mdx.hopLength,
mdx.dimF, mdx.dimT, mdx.segmentSamples, mdx.primaryStem,
qualificationReport
```

The validator must reject redirects to an unrecorded final URL, all-zero hashes, non-positive byte counts, mutable branch names, absent license evidence, duplicate artifacts, and any key other than `separator-fast-balanced-v1` or `separator-quality-v1`.

Write `distribution/separator-release-status.json` as:

```json
{
  "schemaVersion": 1,
  "qualificationPassed": true,
  "enabledByDefault": false,
  "vendors": {
    "nvidia": "pending",
    "amd": "pending",
    "intel": "pending",
    "cpu": "pending"
  },
  "qualificationReport": "docs/benchmarks/2026-09-04-separator-model-qualification.md"
}
```

If no pair passes, write the same file with `qualificationPassed: false`, omit model inputs, commit the failure report, and stop this implementation plan before Task 2.

- [ ] **Step 8: Review the report against source and weight license evidence**

Independently open every source revision, code license, weight license, and final artifact URL recorded in the report. Verify the downloaded byte count and SHA-256 a second time from the candidate manifest:

```powershell
$candidateManifest = Get-Content -LiteralPath 'tests\fixtures\separator\private\candidates.json' -Raw | ConvertFrom-Json
foreach ($candidate in $candidateManifest.candidates) {
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $candidate.localPath).Hash.ToLowerInvariant()
  if ($actual -ne $candidate.sha256.ToLowerInvariant()) { throw ('Hash mismatch: ' + $candidate.id) }
  if ((Get-Item -LiteralPath $candidate.localPath).Length -ne [int64]$candidate.bytes) { throw ('Byte mismatch: ' + $candidate.id) }
}
```

Expected: every digest and byte count exactly matches the report and both weight records explicitly authorize the intended redistribution.

- [ ] **Step 9: Commit the qualification gate**

Run:

```powershell
git add .gitignore scripts/separator_qualification.py scripts/requirements-separator-qualification.txt scripts/generate-separator-test-fixtures.py tests/python/test_separator_qualification.py tests/fixtures/separator/README.md distribution/separator-model-inputs.json distribution/separator-release-status.json docs/benchmarks/2026-09-04-separator-model-qualification.md
git diff --cached --check
git commit -m "research(separator): qualify redistributable MDX models"
```

Expected: one commit containing no model weights or corpus audio. If qualification failed, omit the nonexistent model-input file from `git add` and stop after the failure-evidence commit.

---

### Task 2: Define the shared audio-mode and preset contract

**Files:**
- Create: `src/shared/autoShortSeparation.ts`
- Modify: `src/shared/types.ts:802-917`
- Modify: `src/shared/autoShortContract.ts:97-240`
- Create: `tests/separator-contract.test.ts`
- Modify: `scripts/run-local-runtime-tests.mjs`

**Interfaces:**
- Consumes: stable IDs from Task 1.
- Produces: `AutoShortAudioMode`, `AutoShortSeparationPreset`, `SeparatorModelId`, `SeparatorProvider`, `SEPARATION_PRESETS`, `isAutoShortSeparationPreset(value)`, and widened readiness/dependency/status types.

- [ ] **Step 1: Write failing preset and migration tests**

Create `tests/separator-contract.test.ts`:

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'
import { modelIdForSeparationPreset, separationPresetConfig } from '../src/shared/autoShortSeparation'
import { validateAutoShortStartRequest } from '../src/shared/autoShortContract'
import type { AutoShortStartRequest } from '../src/shared/types'

const validRequest = (): AutoShortStartRequest => ({
  items: [{ id: 'video-1', filePath: 'C:\\media\\one.mp4' }],
  config: {
    subtitleMethod: 'whisper',
    whisperModel: 'base',
    whisperDevice: 'cpu',
    blurRegions: [],
    lamMo: false,
    translateTarget: 'none',
    translateProvider: 'local',
    ttsEnabled: true,
    voiceOverMode: false,
    audioMode: 'replace',
    originalAudioVolume: 20,
    outputDir: 'C:\\media\\out'
  }
})

test('Fast and Balanced share the compact model with fixed overlap', () => {
  assert.equal(modelIdForSeparationPreset('fast'), 'separator-fast-balanced-v1')
  assert.equal(modelIdForSeparationPreset('balanced'), 'separator-fast-balanced-v1')
  assert.deepEqual(separationPresetConfig('fast'), { modelId: 'separator-fast-balanced-v1', overlap: 0.10, batch: 1 })
  assert.deepEqual(separationPresetConfig('balanced'), { modelId: 'separator-fast-balanced-v1', overlap: 0.25, batch: 1 })
})

test('Quality uses only the HQ model', () => {
  assert.deepEqual(separationPresetConfig('quality'), { modelId: 'separator-quality-v1', overlap: 0.50, batch: 1 })
})

test('separate-vocals requires TTS and defaults a missing preset to balanced', () => {
  const request = validRequest()
  request.config.audioMode = 'separate-vocals'
  delete request.config.separationPreset
  const result = validateAutoShortStartRequest(request)
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.config.separationPreset, 'balanced')
})

test('other audio modes normalize away a stale separation preset', () => {
  const request = validRequest()
  request.config.audioMode = 'replace'
  request.config.separationPreset = 'quality'
  const result = validateAutoShortStartRequest(request)
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.config.separationPreset, undefined)
})
```

Keep `validRequest()` local to this test file; do not import a request fixture from a production module.

- [ ] **Step 2: Add the test entry and confirm red**

Append `'tests/separator-contract.test.ts'` to the esbuild `entryPoints` and add its generated file to the status aggregation in `scripts/run-local-runtime-tests.mjs`.

Run:

```powershell
npm run test:local-runtime
```

Expected: build fails because `src/shared/autoShortSeparation.ts` and the new type fields do not exist.

- [ ] **Step 3: Implement the pure preset module**

Create `src/shared/autoShortSeparation.ts`:

```typescript
import type { AutoShortSeparationPreset, SeparatorModelId } from './types'

export interface SeparationPresetConfig {
  modelId: SeparatorModelId
  overlap: 0.10 | 0.25 | 0.50
  batch: 1
}

export const SEPARATION_PRESETS: Readonly<Record<AutoShortSeparationPreset, SeparationPresetConfig>> = {
  fast: { modelId: 'separator-fast-balanced-v1', overlap: 0.10, batch: 1 },
  balanced: { modelId: 'separator-fast-balanced-v1', overlap: 0.25, batch: 1 },
  quality: { modelId: 'separator-quality-v1', overlap: 0.50, batch: 1 }
}

export function separationPresetConfig(preset: AutoShortSeparationPreset): SeparationPresetConfig {
  return SEPARATION_PRESETS[preset]
}

export function modelIdForSeparationPreset(preset: AutoShortSeparationPreset): SeparatorModelId {
  return separationPresetConfig(preset).modelId
}

export function isAutoShortSeparationPreset(value: unknown): value is AutoShortSeparationPreset {
  return value === 'fast' || value === 'balanced' || value === 'quality'
}
```

- [ ] **Step 4: Add exact shared types**

In `src/shared/types.ts` add:

```typescript
export type AutoShortAudioMode = 'replace' | 'mix' | 'separate-vocals'
export type AutoShortSeparationPreset = 'fast' | 'balanced' | 'quality'
export type SeparatorModelId = 'separator-fast-balanced-v1' | 'separator-quality-v1'
export type SeparatorProvider = 'directml' | 'cpu'
export type SeparatorProviderPolicy = 'auto'

export interface AutoShortSeparationReadiness {
  preset: AutoShortSeparationPreset
  modelId: SeparatorModelId
  providerPolicy: SeparatorProviderPolicy
  effectiveProvider: SeparatorProvider | null
  offlineReady: boolean
  releaseTier: 'verified' | 'beta' | 'development'
  message?: string
}
```

Change `AutoShortConfig.audioMode` to `AutoShortAudioMode` and add `separationPreset?: AutoShortSeparationPreset`. Add `'separator-engine'` and `'separator-model'` to `AutoShortDependencyId`, add `separation?: AutoShortSeparationReadiness` to `AutoShortReadiness`, and add `'separating_audio'` to `AutoShortItemStatus`.

- [ ] **Step 5: Implement normalization and strict validation**

Update `migrateLegacyConfig` so it returns `separationPreset: 'balanced'` only when `raudioMode === 'separate-vocals'` and the incoming value is absent; for `replace` and `mix` destructure the migrated object and return it without `separationPreset`.

Update `validateConfigRecord` with these exact rules:

```typescript
if (raw.audioMode !== 'replace' && raw.audioMode !== 'mix' && raw.audioMode !== 'separate-vocals') {
  return 'Chế độ âm thanh không hợp lệ.'
}
if (raw.audioMode === 'separate-vocals') {
  if (raw.ttsEnabled !== true) return 'Tách thoại gốc cần bật lồng tiếng AI.'
  if (!isAutoShortSeparationPreset(raw.separationPreset)) {
    return 'Chất lượng tách thoại không hợp lệ.'
  }
  if (raw.backgroundMusic != null) {
    return 'Không dùng nhạc background riêng khi giữ nhạc và SFX từ video nguồn.'
  }
}
```

Preserve the current `backgroundMusic` checks for replace mode exactly.

- [ ] **Step 6: Add negative request tests**

Test invalid preset values, TTS disabled, background music present, and old `replace`/`mix` requests. Assert the validator never rewrites `separate-vocals` to another mode and that the original two modes still pass with their current semantics.

```typescript
test('separate-vocals rejects background music and disabled TTS', () => {
  const disabled = validRequest()
  disabled.config.audioMode = 'separate-vocals'
  disabled.config.separationPreset = 'balanced'
  disabled.config.ttsEnabled = false
  assert.equal(validateAutoShortStartRequest(disabled).ok, false)

  const music = validRequest()
  music.config.audioMode = 'separate-vocals'
  music.config.separationPreset = 'balanced'
  music.config.backgroundMusic = {
    folderPath: 'C:\\music',
    mode: 'single',
    volume: 15,
    assignments: { 'video-1': 'C:\\music\\track.wav' }
  }
  assert.equal(validateAutoShortStartRequest(music).ok, false)
})
```

- [ ] **Step 7: Run focused and type gates**

Run:

```powershell
npm run test:local-runtime
npm run typecheck
```

Expected: all suites pass and TypeScript reports no errors.

- [ ] **Step 8: Commit the shared contract**

```powershell
git add src/shared/autoShortSeparation.ts src/shared/types.ts src/shared/autoShortContract.ts tests/separator-contract.test.ts scripts/run-local-runtime-tests.mjs
git diff --cached --check
git commit -m "feat(autoshort): define vocal separation contract"
```

---

### Task 3: Build the minimal network-free MDX ONNX engine

**Files:**
- Create: `engines/separator-engine/protocol.py`
- Create: `engines/separator-engine/audio_io.py`
- Create: `engines/separator-engine/mdx.py`
- Create: `engines/separator-engine/engine.py`
- Create: `engines/separator-engine/requirements.txt`
- Create: `engines/separator-engine/separator-engine.spec`
- Create: `engines/separator-engine/tests/test_protocol.py`
- Create: `engines/separator-engine/tests/test_audio_io.py`
- Create: `engines/separator-engine/tests/test_mdx.py`
- Modify: `package.json`

**Interfaces:**
- Consumes: a local absolute input WAV, local `model.onnx`, catalog metadata JSON, preset, output directory, and provider `auto|directml|cpu`.
- Produces: `separator-engine/1` JSON Lines events on stdout, bounded human diagnostics on stderr, and `vocals.wav` plus `instrumental.wav` inside the requested output directory.

- [ ] **Step 1: Write failing protocol tests**

In `test_protocol.py` capture stdout and assert `emit_event` emits one compact JSON object per line, with non-ASCII text preserved and no diagnostic text mixed into stdout. Test `--version` against this exact shape:

```json
{"type":"version","protocol":"separator-engine/1","engine":"mdx-onnx","version":"1.0.0","features":["directml","cpu","mdx-two-stem"]}
```

Test malformed arguments return a single `error` event with `retryable: false` and a non-zero exit code.

```python
def test_version_is_one_json_line(self):
    completed = subprocess.run(
        [sys.executable, ENGINE, "--version"],
        check=True,
        capture_output=True,
        text=True,
    )
    lines = completed.stdout.splitlines()
    self.assertEqual(len(lines), 1)
    self.assertEqual(json.loads(lines[0]), {
        "type": "version",
        "protocol": "separator-engine/1",
        "engine": "mdx-onnx",
        "version": "1.0.0",
        "features": ["directml", "cpu", "mdx-two-stem"],
    })
```

- [ ] **Step 2: Write failing PCM and MDX-window tests**

In `test_audio_io.py` generate PCM16 mono, stereo, 48 kHz, truncated, and valid stereo 44.1 kHz WAVs. Assert only the valid contract passes `read_pcm_wav` and that `write_pcm_wav` rejects NumPy arrays containing NaN or infinity.

In `test_mdx.py` test:

```python
self.assertEqual(provider_chain("auto", ["DmlExecutionProvider", "CPUExecutionProvider"]), ["DmlExecutionProvider"])
self.assertEqual(provider_chain("auto", ["CPUExecutionProvider"]), ["CPUExecutionProvider"])
self.assertEqual(provider_chain("cpu", ["DmlExecutionProvider", "CPUExecutionProvider"]), ["CPUExecutionProvider"])
with self.assertRaises(EngineError):
    provider_chain("directml", ["CPUExecutionProvider"])
self.assertEqual(overlap_starts(total=1000, segment=400, overlap=0.25), [0, 300, 600])
```

Also test that overlap-add reconstructs an identity-model window without seams and progress percentages are monotonic and bounded from 0 through 100.

- [ ] **Step 3: Run the Python suite and confirm red**

Run:

```powershell
python -m unittest discover -s engines/separator-engine/tests -p "test_*.py" -v
```

Expected: imports fail because the engine modules do not exist.

- [ ] **Step 4: Implement protocol and strict WAV I/O**

`protocol.py` defines the constants, typed error, and single-line writer:

```python
PROTOCOL = "separator-engine/1"
ENGINE = "mdx-onnx"
VERSION = "1.0.0"

class EngineError(Exception):
    def __init__(self, code: str, message: str, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable

def emit_event(payload: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()
```

`audio_io.py` uses exact SoundFile calls and finite checks:

```python
def read_pcm_wav(path: str) -> np.ndarray:
    samples, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    if sample_rate != 44_100 or samples.shape[1] != 2 or samples.shape[0] == 0:
        raise EngineError("invalid_audio", "Expected stereo 44.1 kHz WAV.", False)
    if not np.isfinite(samples).all():
        raise EngineError("invalid_audio", "Input contains non-finite samples.", False)
    return samples

def write_pcm_wav(path: str, samples: np.ndarray) -> None:
    if samples.ndim != 2 or samples.shape[1] != 2 or not np.isfinite(samples).all():
        raise EngineError("non_finite_output", "Output samples are invalid.", False)
    sf.write(path, samples, 44_100, subtype="PCM_16", format="WAV")
```

- [ ] **Step 5: Implement the audited MDX execution core**

`mdx.py` must:

1. Load only the model path and metadata supplied on the command line.
2. Compare ONNX input/output shapes with `nFft`, `dimF`, `dimT`, and `segmentSamples` from the installed manifest.
3. Create `ort.SessionOptions()` with `execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL` and `enable_mem_pattern = False`.
4. Select only `DmlExecutionProvider` for `auto`/`directml` when available, and only `CPUExecutionProvider` for `cpu`.
5. Compute stereo STFT windows at the cataloged native dimensions, apply the ONNX mask/output contract recorded during Task 1, overlap-add with a Hann weighting accumulator, inverse-STFT, and trim to the input sample count.
6. Derive the complementary stem according to the qualified model's cataloged `primaryStem`; never guess stem order from filenames.
7. Check all tensors and output samples with `numpy.isfinite` before writing.

The provider/session boundary is exact:

```python
def create_session(model_path: str, provider: str) -> ort.InferenceSession:
    available = ort.get_available_providers()
    providers = provider_chain(provider, available)
    options = ort.SessionOptions()
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.enable_mem_pattern = False
    return ort.InferenceSession(model_path, sess_options=options, providers=providers)

def complementary_stem(mixture: np.ndarray, primary: np.ndarray) -> np.ndarray:
    secondary = mixture - primary
    if not np.isfinite(secondary).all():
        raise EngineError("non_finite_output", "Complementary stem is invalid.", False)
    return secondary
```

Keep the production imports limited to Python stdlib, `numpy`, `onnxruntime`, and `soundfile`. Add a static test that rejects `requests`, `urllib`, `httpx`, `torch`, `torchaudio`, `Demucs`, and automatic download functions in this directory.

- [ ] **Step 6: Implement CLI provider behavior and real probe**

`engine.py` accepts:

```text
--version
--probe --provider auto|directml|cpu --model <absolute path> --model-manifest <absolute path>
--separate --input <absolute WAV> --output-dir <absolute dir>
  --model <absolute path> --model-manifest <absolute path>
  --model-id <stable ID> --preset fast|balanced|quality
  --overlap 0.10|0.25|0.50 --batch 1 --provider auto|directml|cpu
```

`--probe` must load the real model and run one small inference tensor matching the cataloged native shape. `--separate` emits `loading`, `separating`, and `writing` progress, then a result containing absolute paths inside `output-dir`, effective provider, and elapsed milliseconds. Convert ONNX/DirectML failures to stable codes such as `provider_unavailable`, `provider_execution_failed`, `model_metadata_mismatch`, `invalid_audio`, and `non_finite_output`.

- [ ] **Step 7: Pin and package only required dependencies**

Create `requirements.txt` exactly as:

```text
numpy==2.5.2
onnxruntime-directml==1.29.0
soundfile==0.13.1
pyinstaller==6.22.2
```

In `separator-engine.spec` resolve all paths from `SPECPATH`, collect the ONNX Runtime DirectML and SoundFile native libraries, exclude test packages and unused providers, name the executable `separator-engine`, and do not embed any `.onnx` file.

- [ ] **Step 8: Run unit and real-model engine gates**

Run:

```powershell
python -m unittest discover -s engines/separator-engine/tests -p "test_*.py" -v
python engines/separator-engine/engine.py --version
python engines/separator-engine/engine.py --probe --provider cpu --model separator-benchmark-results/accepted/separator-fast-balanced-v1/model.onnx --model-manifest separator-benchmark-results/accepted/separator-fast-balanced-v1/manifest.json
```

Expected: all tests pass; version reports protocol `separator-engine/1`; probe reports `ready: true` and `provider: cpu`. Then run the same probe with `--provider auto` on the GTX 1660 SUPER and expect `provider: directml`.

- [ ] **Step 9: Add the package script and commit**

Add to `package.json`:

```json
"test:separator-engine": "python -m unittest discover -s engines/separator-engine/tests -p \"test_*.py\" -v"
```

Run:

```powershell
npm run test:separator-engine
git add engines/separator-engine package.json
git diff --cached --check
git commit -m "feat(separator): add MDX ONNX engine protocol"
```

---

### Task 4: Add the separator engine to immutable runtime-v4

**Files:**
- Modify: `src/main/runtimeResolver.ts:8-25`
- Modify: `src/main/runtimeManifest.ts:28-35`
- Modify: `src/main/runtimeProbes.ts:133-180`
- Modify: `src/main/runtimeInstaller.ts:95-149`
- Modify: `src/main/distributionConfig.ts`
- Modify: `distribution/runtime-inputs.json`
- Modify: `scripts/pack-runtime-release.mjs`
- Modify: `scripts/verify-runtime-release.mjs`
- Modify: `scripts/publish-github-release.mjs`
- Modify: `.github/workflows/build-windows-runtime.yml`
- Modify: `tests/release-tooling.test.ts`
- Modify: `tests/canonical-runtime-migration.test.ts`

**Interfaces:**
- Consumes: `engines/separator-engine` and protocol/version from Task 3.
- Produces: `RuntimeEngineKind = 'ffmpeg' | 'whisper-engine' | 'whisper-cuda' | 'ocr-engine' | 'video2x' | 'douyin' | 'separator-engine'`, `resolveSeparatorEngine() -> Promise<string | null>`, and a checksum-verified `separator-engine` runtime asset on `runtime-v4`.

- [ ] **Step 1: Write failing runtime-manifest and resolver tests**

Add tests that a schema-1 runtime manifest accepts `separator-engine` only with `protocol: "separator-engine/1"`, `entrypoint: "separator-engine.exe"`, positive bytes, a 64-character SHA-256, and a required-file list containing the entrypoint. Assert an unknown kind is still rejected.

Under `TEDIAPROS_TEST_USER_DATA` create `bin/separator-engine/separator-engine.exe` and assert `resolveSeparatorEngine()` returns only that canonical path; a developer `engines/separator-engine/dist` copy must not be discovered.

```typescript
test('runtime manifest accepts the separator protocol on runtime-v4', () => {
  const result = validateRuntimeDistributionManifest({
    schemaVersion: 1,
    runtimeVersion: 'runtime-v4',
    platform: 'win32',
    arch: 'x64',
    assets: {
      'separator-engine': {
        version: '1.0.0',
        platform: 'win32',
        arch: 'x64',
        asset: 'separator-engine-1.0.0-win32-x64.zip',
        sha256: 'a'.repeat(64),
        bytes: 1024,
        entrypoint: 'separator-engine.exe',
        files: ['separator-engine.exe'],
        protocol: 'separator-engine/1'
      }
    }
  })
  assert.equal(result.ok, true)
})
```

- [ ] **Step 2: Run the local runtime suite and confirm red**

Run:

```powershell
npm run test:local-runtime
```

Expected: type/build failures because `separator-engine` is not a recognized runtime kind and `resolveSeparatorEngine` is absent.

- [ ] **Step 3: Extend the canonical runtime types and probe**

Add `'separator-engine'` to `RuntimeEngineKind` and `RUNTIME_KINDS`. Add:

```typescript
export async function resolveSeparatorEngine(): Promise<string | null> {
  return resolveRuntimeExecutable('separator-engine', ['separator-engine.exe', 'separator-engine'])
}
```

In `probeRuntimeAsset`, handle `separator-engine` by executing `--version` with a 30-second timeout and accepting only a parsed event whose `type` is `version`, `protocol` is `separator-engine/1`, `engine` is `mdx-onnx`, and `features` contains both `directml` and `cpu`. This runtime-only probe does not claim a provider is usable until a model probe in Task 5 succeeds.

- [ ] **Step 4: Move all default release references to runtime-v4**

Change the default `getDistributionConfig().runtimeChannel`, workflow dispatch default, workflow fallback expression, input spec `runtimeVersion`, publisher guard, release-tooling assertions, and human-readable step names from `runtime-v3` to `runtime-v4`. Do not edit or republish the existing `runtime-v3` release.

- [ ] **Step 5: Define exact separator runtime metadata**

Add `separator-engine` to `distribution/runtime-inputs.json` with:

```json
{
  "version": "1.0.0",
  "entrypoint": "separator-engine.exe",
  "protocol": "separator-engine/1",
  "capabilities": ["directml", "cpu", "mdx-two-stem"],
  "files": ["separator-engine.exe"],
  "source": {
    "kind": "repository-build",
    "path": "engines/separator-engine",
    "python": "3.12.10"
  }
}
```

The packer discovers the complete built directory and records every included file, so the input spec does not guess PyInstaller DLL names.

- [ ] **Step 6: Build and probe the engine in the Windows runtime workflow**

Create an isolated venv, install `engines/separator-engine/requirements.txt` with exact pins, run the Python tests, build the PyInstaller spec, copy the generated directory to `$env:RUNTIME_INPUT_ROOT\separator-engine`, and run `separator-engine.exe --version` in the existing native probe stage. Keep `-ExecutionPolicy Bypass` scoped to the existing archive PowerShell child process and do not change machine policy.

```yaml
- name: Build separator engine from pinned environment
  shell: pwsh
  run: |
    python -m venv (Join-Path $env:RUNNER_TEMP 'separator-build-venv')
    $python = Join-Path $env:RUNNER_TEMP 'separator-build-venv\Scripts\python.exe'
    & $python -m pip install --disable-pip-version-check --no-cache-dir -r engines/separator-engine/requirements.txt
    & $python -m unittest discover -s engines/separator-engine/tests -p 'test_*.py' -v
    & $python -m PyInstaller --clean --noconfirm engines/separator-engine/separator-engine.spec --distpath (Join-Path $env:RUNNER_TEMP 'separator-dist') --workpath (Join-Path $env:RUNNER_TEMP 'separator-work')
    $target = Join-Path $env:RUNTIME_INPUT_ROOT 'separator-engine'
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -Path (Join-Path $env:RUNNER_TEMP 'separator-dist\separator-engine\*') -Destination $target -Recurse -Force
```

- [ ] **Step 7: Update packer/verifier invariants**

Add `separator-engine` to `REQUIRED_KINDS` and `SUPPORTED_KINDS`. Assert a packed `runtime-v4` has seven runtime assets, every archive member is declared, and the engine archive contains no `.onnx`, benchmark audio, URL cache, or source corpus. Keep explicit `--input-dir` enforcement and canonical userData behavior.

```javascript
const REQUIRED_KINDS = [
  'ffmpeg',
  'whisper-engine',
  'whisper-cuda',
  'ocr-engine',
  'video2x',
  'douyin',
  'separator-engine'
]
```

- [ ] **Step 8: Run release-tooling gates**

Run:

```powershell
npm run test:local-runtime
$separatorRuntimeInput = Join-Path $env:TEMP 'tediapros-runtime-v4-inputs'
node scripts/pack-runtime-release.mjs --input-dir $separatorRuntimeInput --output-dir release-artifacts --runtime-version runtime-v4 --platform win32 --arch x64
node scripts/verify-runtime-release.mjs release-artifacts
```

Expected: local tests pass; packer reports `runtime-v4` with seven assets; verifier exits 0. Before running, resolve `$separatorRuntimeInput` and verify it is the clean output created by the workflow-equivalent local build.

- [ ] **Step 9: Commit runtime-v4 support**

```powershell
git add src/main/runtimeResolver.ts src/main/runtimeManifest.ts src/main/runtimeProbes.ts src/main/runtimeInstaller.ts src/main/distributionConfig.ts distribution/runtime-inputs.json scripts/pack-runtime-release.mjs scripts/verify-runtime-release.mjs scripts/publish-github-release.mjs .github/workflows/build-windows-runtime.yml tests/release-tooling.test.ts tests/canonical-runtime-migration.test.ts
git diff --cached --check
git commit -m "feat(runtime): package separator engine in runtime-v4"
```

---

### Task 5: Build the independent separator-model store and installer

**Files:**
- Create: `src/main/separation/modelManifest.ts`
- Create: `src/main/separation/modelStore.ts`
- Create: `src/main/separation/modelInstaller.ts`
- Create: `src/main/separation/runner.ts`
- Modify: `src/main/distributionConfig.ts`
- Create: `scripts/pack-separator-model-release.mjs`
- Create: `scripts/verify-separator-model-release.mjs`
- Modify: `scripts/publish-github-release.mjs`
- Modify: `.github/workflows/build-windows-runtime.yml`
- Create: `tests/separator-runtime.test.ts`
- Modify: `scripts/run-local-runtime-tests.mjs`
- Modify: `tests/release-tooling.test.ts`

**Interfaces:**
- Consumes: accepted `distribution/separator-model-inputs.json`, `resolveSeparatorEngine()`, safe ZIP validation, `trackChildProcess()`, and `replaceDirectoryAtomic()`.
- Produces: `validateSeparatorModelReleaseManifest(raw: unknown) -> { ok: true; manifest: SeparatorModelReleaseManifest } | { ok: false; error: string }`; `separatorModelRoot() -> string`; `resolveInstalledSeparatorModel(id: SeparatorModelId) -> Promise<InstalledSeparatorModel | null>`; `fetchSeparatorModelManifest(fetchImpl?: typeof fetch) -> Promise<SeparatorModelReleaseManifest | null>`; `probeSeparatorModel(input) -> Promise<SeparatorProbeResult>`; and `installSeparatorModel(id, onProgress, signal, hooks) -> Promise<InstalledSeparatorModel>`.

- [ ] **Step 1: Write failing manifest-validation tests**

In `tests/separator-runtime.test.ts` construct a valid schema-1 manifest with exactly the two stable IDs and assert validation fails for:

- wrong schema/runtime channel;
- unsafe asset/model paths;
- missing or duplicate stable IDs;
- non-positive `archiveBytes`, `expandedBytes`, or `model.bytes`;
- invalid SHA-256;
- absent native MDX dimensions;
- unapproved redistribution;
- model ID/key mismatch;
- mutable source revision.

Also assert Fast and Balanced resolve the same installed directory while Quality resolves its own directory.

- [ ] **Step 2: Write failing installer rollback/offline tests**

Use a temporary `TEDIAPROS_TEST_USER_DATA`, injected `fetch`, `extract`, `probe`, and `freeBytes` hooks. Assert:

1. checksum or byte mismatch leaves an existing healthy model untouched;
2. traversal and duplicate archive entries are rejected before extraction;
3. CPU real-inference probe failure prevents promotion;
4. successful install writes `model.onnx` and `manifest.json` atomically;
5. an already complete model returns without a network request;
6. cancellation removes staging and preserves the previous model.

- [ ] **Step 3: Add the suite to the runner and confirm red**

Add `tests/separator-runtime.test.ts` to `scripts/run-local-runtime-tests.mjs` and run:

```powershell
npm run test:local-runtime
```

Expected: build fails because the model modules do not exist.

- [ ] **Step 4: Implement schema-1 release and local manifests**

Define:

```typescript
export interface SeparatorMdxMetadata {
  sampleRate: 44100
  channels: 2
  nFft: number
  hopLength: number
  dimF: number
  dimT: number
  segmentSamples: number
  primaryStem: 'vocals' | 'instrumental'
}

export interface SeparatorModelReleaseSpec {
  id: SeparatorModelId
  version: string
  asset: string
  archiveBytes: number
  expandedBytes: number
  archiveSha256: string
  model: { path: 'model.onnx'; bytes: number; sha256: string }
  mdx: SeparatorMdxMetadata
  source: { url: string; revision: string }
  license: {
    codeSpdx: string
    weightName: string
    weightUrl: string
    weightRedistributionApproved: true
    attribution: string
  }
}

export interface SeparatorModelReleaseManifest {
  schemaVersion: 1
  runtimeChannel: 'runtime-v4'
  models: Record<SeparatorModelId, SeparatorModelReleaseSpec>
}
```

The local `manifest.json` contains the exact selected model record plus `installedAt` and the verified engine protocol. Validation accepts only safe forward-slash relative paths and exact stable IDs.

Extend `DistributionConfig` with `separatorModelManifestUrl: string` and `getSeparatorModelAssetUrl(assetName: string): string`. Both use the same immutable `runtime-v4` release base as the runtime manifest; no raw upstream weight URL is exposed to the renderer.

- [ ] **Step 5: Implement canonical resolution and complete-model verification**

`separatorModelRoot()` returns `join(app.getPath('userData'), 'separator-models')`. `resolveInstalledSeparatorModel(id)` must resolve `<root>/<id>/manifest.json` and `model.onnx`, verify regular-file type, byte count, model SHA-256, manifest ID, MDX metadata, and license approval, then return:

```typescript
export interface InstalledSeparatorModel {
  id: SeparatorModelId
  directory: string
  modelPath: string
  manifestPath: string
  spec: SeparatorModelReleaseSpec
}
```

No legacy/developer/PATH fallback is allowed.

- [ ] **Step 6: Implement staged installation with exact disk math**

`installSeparatorModel` must fetch `separator-model-manifest.json` from `runtime-v4`, select only the requested stable ID, and calculate:

```typescript
const MIB = 1024 * 1024
export function requiredModelInstallBytes(spec: SeparatorModelReleaseSpec): number {
  const payload = spec.archiveBytes + spec.expandedBytes
  return payload + Math.max(256 * MIB, Math.ceil(payload * 0.10))
}

export interface SeparatorModelInstallerHooks {
  fetch?: typeof fetch
  extract?: (archivePath: string, destination: string) => Promise<void>
  probe?: typeof probeSeparatorModel
  freeBytes?: (path: string) => Promise<number>
  now?: () => string
}

export async function installSeparatorModel(
  id: SeparatorModelId,
  onProgress: (progress: AutoShortDependencyProgress) => void,
  signal?: AbortSignal,
  hooks: SeparatorModelInstallerHooks = {}
): Promise<InstalledSeparatorModel>
```

Before downloading, compare required bytes with free bytes for the userData volume. Download into `<id>.staging`, verify response byte count and SHA-256, validate ZIP paths before extraction, verify every local file, run `probeSeparatorModel` with provider `cpu`, then atomically promote. Always delete staging in `finally`.

Create `src/main/separation/runner.ts` with a shared bounded JSON Lines reader and:

```typescript
export interface SeparatorProbeResult {
  ready: boolean
  provider: SeparatorProvider
  modelId: SeparatorModelId
  message?: string
}

export async function probeSeparatorModel(input: {
  executablePath: string
  model: InstalledSeparatorModel
  provider: 'directml' | 'cpu'
  signal?: AbortSignal
}): Promise<SeparatorProbeResult>
```

Spawn with `shell: false`, register through `trackChildProcess`, accept only protocol `separator-engine/1`, cap/sanitize stderr, and settle cancellation after child `close`/`error`. Task 6 reuses the same reader for `--separate`.

- [ ] **Step 7: Add model release packing and verification**

`pack-separator-model-release.mjs` must take explicit `--input-dir`, `--model-inputs`, `--output-dir`, and `--runtime-version runtime-v4`. It must independently verify each raw model against Task 1, write each package's `manifest.json`, create immutable ZIPs, and emit `separator-model-manifest.json` with actual archive bytes/hashes and expanded bytes.

`verify-separator-model-release.mjs` must validate the remote manifest, archive membership, embedded manifest equality, raw model hash/bytes, license fields, exact two-ID set, no path traversal/duplicates, and no executable or corpus media in model archives.

Update `publish-github-release.mjs` to run both release verifiers before creating a draft and include `separator-model-manifest.json` plus the two model archives in its immutable expected-asset list. An existing `runtime-v4` release is accepted only when byte counts and SHA-256 values match all runtime and model artifacts; the publisher must never delete or replace a mismatched asset.

- [ ] **Step 8: Extend the release workflow without coupling model and engine archives**

The Windows workflow downloads each accepted raw model URL, rejects changed final URLs/bytes/hashes, stages `model.onnx` by stable ID, runs the packer/verifier, and uploads the model manifest plus two ZIPs alongside the runtime manifest. Engine archives never include models; model archives never include executables.

- [ ] **Step 9: Run unit, pack, rollback, and offline-reuse gates**

Run:

```powershell
npm run test:local-runtime
$separatorModelInput = Join-Path $env:TEMP 'tediapros-separator-model-inputs'
node scripts/pack-separator-model-release.mjs --input-dir $separatorModelInput --model-inputs distribution/separator-model-inputs.json --output-dir release-artifacts --runtime-version runtime-v4
node scripts/verify-separator-model-release.mjs release-artifacts
```

Expected: all tests pass; exactly two model archives and one model manifest verify; the offline second-run test records zero fetch calls.

- [ ] **Step 10: Commit model distribution**

```powershell
git add src/main/separation/modelManifest.ts src/main/separation/modelStore.ts src/main/separation/modelInstaller.ts src/main/separation/runner.ts src/main/distributionConfig.ts scripts/pack-separator-model-release.mjs scripts/verify-separator-model-release.mjs scripts/publish-github-release.mjs .github/workflows/build-windows-runtime.yml tests/separator-runtime.test.ts scripts/run-local-runtime-tests.mjs tests/release-tooling.test.ts
git diff --cached --check
git commit -m "feat(separator): add verified model distribution"
```

---

### Task 6: Implement the cancellable separation adapter and fallback policy

**Files:**
- Create: `src/main/separation/media.ts`
- Modify: `src/main/separation/runner.ts`
- Create: `src/main/separation/disk.ts`
- Create: `src/main/separation/pipeline.ts`
- Create: `tests/separator-pipeline.test.ts`
- Modify: `scripts/run-local-runtime-tests.mjs`
- Modify: `src/main/autoShortAudit.ts`

**Interfaces:**
- Consumes: managed FFmpeg/FFprobe, `resolveSeparatorEngine()`, `InstalledSeparatorModel`, `SeparationPresetConfig`, `probeSeparatorModel()`, `trackChildProcess()`, and an `AbortSignal`.
- Produces: `runSeparatorEngine(input) -> Promise<SeparatorRunResult>`, `prepareSourceAudio(input) -> Promise<PreparedSourceAudio>`, `separateSourceAudio(input) -> Promise<SourceSeparationResult>`, and deterministic job-level provider pinning.

- [ ] **Step 1: Write failing protocol-runner tests**

In `tests/separator-pipeline.test.ts` inject a fake child-process factory and test:

- a valid sequence `loading -> separating -> writing -> result` is accepted;
- progress must be monotonic and within 0..100;
- more than one terminal event, malformed JSON, or stdout after a terminal event fails;
- a result path outside the requested output directory fails;
- stderr is drained and only the last 64 KiB is retained;
- diagnostics redact source, model, work, and output paths;
- timeout and abort terminate the tracked process tree and settle only after `close` or `error`.

Use this explicit result interface in the assertions:

```typescript
export interface SeparatorRunResult {
  vocalsPath: string
  instrumentalPath: string
  provider: SeparatorProvider
  elapsedMs: number
  stderrTail?: string
}
```

- [ ] **Step 2: Write failing media, disk, and provider-policy tests**

Test a source with no audio as a non-error discriminated result, stereo 44.1 kHz extraction arguments, a corrupt decode, stem duration delta over 0.100 seconds, wrong channels/rate, empty stems, and exact duration normalization.

Test this workspace formula:

```typescript
const PCM_BYTES_PER_SECOND = 44_100 * 2 * 2
const MIB = 1024 * 1024
export function requiredSeparationWorkspaceBytes(durationSeconds: number): number {
  const fourPcmFiles = Math.ceil(durationSeconds * PCM_BYTES_PER_SECOND * 4)
  return Math.ceil(fourPcmFiles * 1.25) + 256 * MIB
}
```

Test that one retry occurs only after a retryable DirectML provider error; partial stems are deleted before the CPU attempt; CPU failure ends the item; a validation/security/protocol error does not retry; and a mutable `providerState.mode` remains `cpu` for later items after fallback.

- [ ] **Step 3: Add the suite to the runner and confirm red**

Add `tests/separator-pipeline.test.ts` to the entry and exit-status lists in `scripts/run-local-runtime-tests.mjs`.

Run:

```powershell
npm run test:local-runtime
```

Expected: build fails because the separation adapter modules do not exist.

- [ ] **Step 4: Implement a strict JSON Lines runner**

Define:

```typescript
export interface RunSeparatorEngineInput {
  executablePath: string
  inputPath: string
  outputDir: string
  model: InstalledSeparatorModel
  preset: AutoShortSeparationPreset
  provider: 'auto' | 'cpu'
  signal: AbortSignal
  timeoutMs: number
  onProgress?: (percent: number, phase: 'loading' | 'separating' | 'writing') => void
  spawnChild?: typeof spawn
}

export async function runSeparatorEngine(input: RunSeparatorEngineInput): Promise<SeparatorRunResult>
```

Spawn with `shell: false` and path values as separate arguments. Register the child immediately with `trackChildProcess`. Parse complete newline-delimited frames with a maximum line length of 64 KiB, reject unknown terminal shapes, and cap stderr at 64 KiB. On abort/timeout call `terminateProcessTree` and wait for `close`/`error` before rejecting. Sanitize all configured paths through `sanitizeAutoShortAuditError` before exposing diagnostic text.

- [ ] **Step 5: Implement source extraction and stem validation**

`probeSourceAudio(ffprobePath, sourcePath, signal)` and `prepareSourceAudio(input)` return:

```typescript
export type SourceAudioProbe =
  | { kind: 'audio'; durationSeconds: number }
  | { kind: 'no-audio'; warning: 'Video nguồn không có audio; sẽ xuất TTS-only.' }

export type PreparedSourceAudio =
  | { kind: 'audio'; wavPath: string; durationSeconds: number }
  | { kind: 'no-audio'; warning: string }

export async function prepareSourceAudio(input: {
  sourcePath: string
  outputPath: string
  ffmpegPath: string
  ffprobePath: string
  signal: AbortSignal
}): Promise<PreparedSourceAudio>
```

For audio sources, `extractNormalizedSourceAudio` invokes managed FFmpeg with `-vn -ac 2 -ar 44100 -c:a pcm_s16le` and writes `source.wav`. Probe and decode-check it before inference.

`validateSeparatorStem` requires a regular non-empty PCM16 WAV, two channels, 44.1 kHz, successful full decode, and pre-normalization duration within 0.100 seconds of source. The engine's finite-array guard is authoritative before PCM16 quantization; main-process PCM16 validation proves every persisted sample is an integer and therefore finite. `normalizeInstrumentalDuration` uses `apad` plus an `atrim` duration argument formatted from the probed video duration and verifies the exact target duration after writing.

- [ ] **Step 6: Implement the one-retry provider state machine**

Define:

```typescript
export interface SeparatorProviderState {
  mode: 'auto' | 'cpu'
  fallbackReasonCode?: string
}

export interface SeparationPipelineProgress {
  stage: 'extracting' | 'separating' | 'cpu-retry' | 'normalizing'
  percent: number
}

export type SourceSeparationResult =
  | {
      kind: 'separated'
      instrumentalPath: string
      vocalsPath: string
      requestedProvider: 'auto'
      effectiveProvider: SeparatorProvider
      fallbackReasonCode?: string
      elapsedMs: number
    }
  | { kind: 'no-audio'; warning: string }

export async function separateSourceAudio(input: {
  sourcePath: string
  videoDurationSeconds: number
  workDir: string
  ffmpegPath: string
  ffprobePath: string
  enginePath: string
  model: InstalledSeparatorModel
  preset: AutoShortSeparationPreset
  providerState: SeparatorProviderState
  signal: AbortSignal
  onProgress?: (event: SeparationPipelineProgress) => void
}): Promise<SourceSeparationResult>
```

Attempt `providerState.mode`. Retry with CPU only when the first attempt used `auto` and failed with `provider_unavailable` or `provider_execution_failed` marked retryable. Before retry, remove the entire stem-output directory and recreate it. Set `providerState.mode = 'cpu'` and retain the stable reason code before starting CPU. Never catch the final error to return source audio.

- [ ] **Step 7: Add malicious-path and cancellation integration fixtures**

Use a temporary fake executable that emits JSON Lines and creates tiny PCM fixtures. Assert `..` paths, sibling-directory paths, symlink/reparse escapes, malformed events, and a child that ignores stdin all fail safely. On Windows, assert the child PID no longer exists after cancellation resolves.

- [ ] **Step 8: Run adapter gates**

Run:

```powershell
npm run test:local-runtime
npm run typecheck
```

Expected: all suites pass with fallback count exactly one and no raw temporary path in captured errors.

- [ ] **Step 9: Commit the adapter**

```powershell
git add src/main/separation/media.ts src/main/separation/runner.ts src/main/separation/disk.ts src/main/separation/pipeline.ts src/main/autoShortAudit.ts tests/separator-pipeline.test.ts scripts/run-local-runtime-tests.mjs
git diff --cached --check
git commit -m "feat(separator): add validated DirectML CPU pipeline"
```

---

### Task 7: Generalize narration/bed composition without changing old modes

**Files:**
- Create: `src/main/autoShortNarratedAudio.ts`
- Modify: `src/main/autoShortBackgroundAudio.ts`
- Modify: `tests/local-runtime.test.ts`
- Modify: `tests/separator-pipeline.test.ts`

**Interfaces:**
- Consumes: narration WAV, either a looping user-music file or a finite separated instrumental WAV, video duration, and `AbortSignal`.
- Produces: `composeAutoShortNarratedAudio(input) -> Promise<void>` and a backward-compatible `composeAutoShortBackgroundAudio(input)` wrapper.

- [ ] **Step 1: Freeze current background-music behavior with failing compatibility tests**

Capture the current accepted graph as assertions: background music uses `-stream_loop -1`, selected volume, narration split into independent sidechain/mix branches, sidechain compression, `amix`, final limiter, stereo 44.1 kHz PCM16 output, exact duration trim, `shell: false`, and process-tree cancellation.

Do not update snapshots to accommodate a semantic change. The existing `replace` and `mix` burn graph tests remain required.

- [ ] **Step 2: Write failing finite-bed tests**

Assert `buildAutoShortNarratedAudioArgs` with `bedMode: 'finite-source'`:

- omits `-stream_loop`;
- applies nominal bed gain `1.0`;
- normalizes/pads/trims the bed to video duration;
- splits narration with `asplit=2[narr_sc][narr_mix]`;
- feeds `narr_sc` to `sidechaincompress` and `narr_mix` to `amix`;
- ends with `alimiter` and PCM16 output;
- never references the source video as an input.

- [ ] **Step 3: Run focused tests and confirm red**

Run:

```powershell
npm run test:local-runtime
```

Expected: tests fail because `autoShortNarratedAudio.ts` is absent.

- [ ] **Step 4: Implement one focused compositor**

Create:

```typescript
export interface AutoShortNarratedAudioInput {
  ffmpegPath: string
  narrationPath: string
  bedPath: string
  outputPath: string
  durationSeconds: number
  bedMode: 'looping-music' | 'finite-source'
  bedVolume: number
  signal: AbortSignal
}

export function buildAutoShortNarratedAudioArgs(
  input: Omit<AutoShortNarratedAudioInput, 'signal'>
): string[]

export async function composeAutoShortNarratedAudio(
  input: AutoShortNarratedAudioInput
): Promise<void>
```

Use the current accepted sidechain parameters. For `finite-source` force `bedVolume: 100` and omit looping. Keep bounded/sanitized stderr, `windowsHide: true`, `shell: false`, `trackChildProcess`, and settle-after-close cancellation.

- [ ] **Step 5: Convert the old module into a compatibility wrapper**

`composeAutoShortBackgroundAudio` resolves managed FFmpeg exactly as it does now and calls:

```typescript
return composeAutoShortNarratedAudio({
  ffmpegPath,
  narrationPath: input.narrationPath,
  bedPath: input.musicPath,
  outputPath: input.outputPath,
  durationSeconds: input.duration,
  bedMode: 'looping-music',
  bedVolume: input.volume,
  signal: input.signal
})
```

Keep its exported public input type and function names unchanged.

- [ ] **Step 6: Run regression and type gates**

Run:

```powershell
npm run test:local-runtime
npm run typecheck
```

Expected: old background-music, replace, and mix tests pass; finite separated-bed tests pass.

- [ ] **Step 7: Commit the compositor refactor**

```powershell
git add src/main/autoShortNarratedAudio.ts src/main/autoShortBackgroundAudio.ts tests/local-runtime.test.ts tests/separator-pipeline.test.ts
git diff --cached --check
git commit -m "refactor(autoshort): support finite narrated audio beds"
```

---

### Task 8: Extend dependency readiness and IPC for engine/model/provider state

**Files:**
- Modify: `src/shared/types.ts:868-896`
- Create: `src/main/separation/releaseGate.ts`
- Modify: `src/main/autoshort.ts:146-310`
- Modify: `src/main/index.ts:954-990`
- Modify: `src/preload/index.ts:374-389`
- Modify: `tests/separator-runtime.test.ts`
- Modify: `tests/local-runtime.test.ts`

**Interfaces:**
- Consumes: runtime/model installers from Tasks 4-5 and engine probe from Task 3.
- Produces: `AutoShortDependencyConfig`, widened `getAutoShortReadiness(config)` and `installAutoShortDependencies(config, onProgress, signal)`, plus unchanged IPC channel names with richer validated input.

- [ ] **Step 1: Write failing readiness tests**

Test exactly these states:

1. `replace` and `mix` request no separator dependency.
2. Fast/Balanced require `separator-engine` and only `separator-fast-balanced-v1`.
3. Quality requires `separator-engine` and only `separator-quality-v1`.
4. Missing assets expose exact manifest `downloadBytes`.
5. DirectML real-model probe success reports `effectiveProvider: 'directml'`.
6. DirectML probe failure plus CPU probe success reports `effectiveProvider: 'cpu'` and `releaseTier` without blocking.
7. Both probes failing makes readiness false.
8. A complete installed model is ready offline when manifest fetch fails.
9. A failed download/install retains the previously healthy asset.

- [ ] **Step 2: Write failing IPC boundary tests**

Assert main and preload accept only:

```typescript
export type AutoShortDependencyConfig = Pick<
  AutoShortConfig,
  'subtitleMethod' | 'whisperModel' | 'whisperDevice' | 'audioMode' | 'separationPreset'
>
```

Reject unknown audio modes/presets before any download. Assert the renderer cannot send a model URL, model path, engine path, or provider override.

- [ ] **Step 3: Run tests and confirm red**

Run:

```powershell
npm run test:local-runtime
```

Expected: new readiness assertions fail because separator dependencies are absent.

- [ ] **Step 4: Implement release-gated separation readiness**

Create `src/main/separation/releaseGate.ts`, importing the checked-in JSON at build time so packaged clients never depend on a repository-relative file:

```typescript
import bundledStatus from '../../../distribution/separator-release-status.json'

export type SeparatorVendorStatus = 'pending' | 'verified' | 'beta'

export interface SeparatorReleaseStatus {
  schemaVersion: 1
  qualificationPassed: boolean
  enabledByDefault: boolean
  vendors: Record<'nvidia' | 'amd' | 'intel' | 'cpu', SeparatorVendorStatus>
  qualificationReport: string
}

export function separatorFeatureEnabled(
  status: SeparatorReleaseStatus,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return status.qualificationPassed &&
    (status.enabledByDefault || env.TEDIAPROS_ENABLE_SEPARATOR === '1')
}
```

`loadSeparatorReleaseStatus()` validates every field and returns the bundled record. Development override `TEDIAPROS_ENABLE_SEPARATOR=1` may expose a qualified-but-default-off feature; it must not bypass failed license/qualification validation.

When separation is requested, readiness must:

- resolve and version-probe the engine;
- resolve and checksum-verify the selected installed model;
- if both exist, probe DirectML with the real model;
- if DirectML fails, probe CPU and report CPU fallback;
- derive exact missing download bytes from validated remote manifests;
- return sanitized messages and no paths.

- [ ] **Step 5: Extend dependency installation in deterministic order**

Install in this order: FFmpeg, subtitle dependencies, `separator-engine`, selected `separator-model`. After each stage recompute readiness. After model install, run the combined provider probe. Emit existing phases `downloading`, `installing`, `verifying`, `done`, or `error` with exact bytes when available.

Cancellation uses the existing install abort controller and removes staging without removing active assets.

- [ ] **Step 6: Widen main/preload signatures without new privileged channels**

Keep `autoshort:getReadiness` and `autoshort:installDependencies`. Validate the five allowed fields in main before passing them to Auto Short. Preload exposes only the typed configuration and progress events; it never exposes filesystem paths or raw manifest download functions.

- [ ] **Step 7: Run readiness, IPC, and offline gates**

Run:

```powershell
npm run test:local-runtime
npm run typecheck
```

Expected: all nine readiness states and IPC-negative tests pass.

- [ ] **Step 8: Commit readiness and IPC**

```powershell
git add src/shared/types.ts src/main/separation/releaseGate.ts src/main/autoshort.ts src/main/index.ts src/preload/index.ts tests/separator-runtime.test.ts tests/local-runtime.test.ts
git diff --cached --check
git commit -m "feat(autoshort): expose separator dependency readiness"
```

---

### Task 9: Integrate separation, checkpointing, cleanup, and burn output

**Files:**
- Modify: `src/main/autoshort.ts:83-125, 2019-2476`
- Modify: `src/main/burn.ts:697-820`
- Modify: `tests/e2e-autoshort.test.ts`
- Modify: `tests/separator-pipeline.test.ts`
- Modify: `tests/local-runtime.test.ts`

**Interfaces:**
- Consumes: `separateSourceAudio()`, `composeAutoShortNarratedAudio()`, prepared engine/model identity, existing TTS timeline, `BurnReq`, and final output validation.
- Produces: Auto Short checkpoint version 4, job-scoped provider pin, `separating_audio` progress, TTS-only no-audio behavior, separated-bed final render, and sanitized audit fields.

- [ ] **Step 1: Write failing coordinator tests for ordering and mode isolation**

With injected fake subtitle, separator, TTS, compositor, and burn services, assert call order is:

```text
subtitle extraction complete
translation complete
source audio extraction
separator complete
TTS generation
TTS timeline stitching
finite-bed composition
burn
ffprobe/decode validation
publish success
```

For `whisper-ocr`, assert its current parallel subtitle branches both settle before separator start. Assert `replace` and `mix` never call the separator, and `separate-vocals` never passes source audio gain above zero.

- [ ] **Step 2: Write failing no-audio, fallback, failure, and cancellation tests**

Assert:

- no source audio skips separator, displays `Video nguồn không có audio; sẽ xuất TTS-only.`, and completes with narration;
- a DirectML failure produces `Đang thử lại bằng CPU`, retries once, and later queue items start on CPU;
- CPU failure marks the item error and never calls burn;
- malformed engine output, escaped result path, corrupt stem, or timeout never changes audio mode;
- cancellation waits for separator/FFmpeg child close, removes partial files, and returns cancelled;
- no partial rendered output is published as success.

- [ ] **Step 3: Write failing checkpoint and cleanup tests**

Increment expected checkpoint version from 3 to 4. Assert the separation fingerprint changes for source size/mtime, engine version/protocol, model ID/hash, catalog schema, preset, overlap, batch, sample rate, channels, or PCM format.

A checkpoint may reuse `checkpointDir/separation/instrumental.wav` only when the fingerprint matches and full stem validation passes again. Assert a mismatch removes the old separated checkpoint; success removes the entire checkpoint; failure/cancellation never preserves `vocals.wav` or raw `source.wav` in the audit directory.

- [ ] **Step 4: Run the local runtime suite and confirm red**

Run:

```powershell
npm run test:local-runtime
```

Expected: coordinator/checkpoint tests fail because the new stage is not wired.

- [ ] **Step 5: Lock separation resources once per job**

Extend `AutoShortJob`:

```typescript
interface PreparedAutoShortSeparation {
  enginePath: string
  engineVersion: string
  engineProtocol: 'separator-engine/1'
  model: InstalledSeparatorModel
  preset: AutoShortSeparationPreset
  presetConfig: SeparationPresetConfig
}

interface AutoShortJob {
  id: string
  request: AutoShortStartRequest
  controller: AbortController
  emit: (event: AutoShortEvent) => void
  done: Promise<AutoShortBatchResult>
  cancelled: boolean
  ttsCapabilities?: Awaited<ReturnType<typeof getTtsModels>>
  ttsCapabilitiesUrl?: string
  separation?: PreparedAutoShortSeparation
  separationProviderState: SeparatorProviderState
}
```

During preflight resolve and verify these resources once, calculate workspace bytes for each source duration, check the output/temp volume, and fail before inference on insufficient space. Initialize provider state to `{ mode: 'auto' }`.

- [ ] **Step 6: Extend checkpoint version and fingerprint**

Set `AUTO_SHORT_CHECKPOINT_VERSION = 4`. Add `audioMode` and, when separated, this exact object to the stable hash:

```typescript
separation: job.separation ? {
  engineVersion: job.separation.engineVersion,
  engineProtocol: job.separation.engineProtocol,
  modelId: job.separation.model.id,
  modelSha256: job.separation.model.spec.model.sha256,
  catalogSchema: 1,
  preset: job.separation.preset,
  overlap: job.separation.presetConfig.overlap,
  batch: 1,
  audio: { codec: 'pcm_s16le', sampleRate: 44100, channels: 2 }
} : null
```

Store only the validated instrumental checkpoint path and fingerprint metadata; do not store vocals.

- [ ] **Step 7: Add the separation stage after translation and before TTS**

For `separate-vocals`:

1. Emit `separating_audio` with `Đang trích audio`.
2. Revalidate a matching checkpoint or call `separateSourceAudio`.
3. Map engine progress to `Đang tách thoại` and CPU fallback to `Đang thử lại bằng CPU`.
4. Copy/normalize only instrumental audio into the checkpoint.
5. Delete `vocals.wav` immediately after its validation is no longer needed.
6. Await completion before entering existing TTS generation.

For no audio, set a sanitized warning and continue with existing TTS-only path.

- [ ] **Step 8: Compose and burn without the original source stream**

Extend the final validator with a sixth parameter while preserving its current default:

```typescript
async function probeOutputMediaWithFfprobe(
  ffmpegPath: string,
  outputPath: string,
  ttsExpected = false,
  expectedVideoDuration?: number,
  expectedFrameRate?: number,
  maxDurationFrames = 8
): Promise<{ ok: boolean; error?: string }>
```

Calculate `maxDurationDelta = Math.max(0.001, maxDurationFrames / (expectedFrameRate || 30))`. After narration stitching, call `composeAutoShortNarratedAudio` with `bedMode: 'finite-source'` and `bedVolume: 100`. Set:

```typescript
batAmThanh: true,
amThanhFile: separatedNarratedAudioPath,
amLuongGoc: 0
```

Keep existing values for the other audio modes. In `taoFilterComplex` assert a zero source gain does not add the original source-audio branch. For separate mode, pass `1` as `maxDurationFrames`; omit the argument for replace/mix so their eight-frame default remains unchanged.

- [ ] **Step 9: Add sanitized audit metadata and cleanup**

Record only:

```typescript
{
  audioMode: 'separate-vocals',
  separationPreset,
  separatorModelId,
  separatorModelSha256,
  separatorEngineVersion,
  requestedProvider: 'auto',
  effectiveProvider,
  fallbackReasonCode,
  separationElapsedMs
}
```

Do not record absolute paths or copy stems. On success, delete checkpoint and all temporary WAVs after final output validation/publish. On failure, sanitize/cap diagnostics, save no source/stem audio, then remove the work directory in `finally`.

- [ ] **Step 10: Run all coordinator gates**

Run:

```powershell
npm run test:local-runtime
npm run typecheck
```

Expected: all three audio modes pass; the separate mode has exactly one output audio stream and no source-audio mix branch.

- [ ] **Step 11: Commit Auto Short integration**

```powershell
git add src/main/autoshort.ts src/main/burn.ts tests/e2e-autoshort.test.ts tests/separator-pipeline.test.ts tests/local-runtime.test.ts
git diff --cached --check
git commit -m "feat(autoshort): render TTS over separated source bed"
```

---

### Task 10: Add the third mode, three presets, and honest provider/download UI

**Files:**
- Modify: `src/renderer/src/components/AutoShort.tsx:215-225, 439-465, 753-850, 900-940, 1804-1900`
- Modify: `src/renderer/src/styles/autoshort.css`
- Modify: `tests/local-runtime.test.ts`

**Interfaces:**
- Consumes: shared audio/preset types, separator readiness, dependency progress, and `separating_audio` events.
- Produces: persisted `tblao.autoshort.separationPreset`, the third audio-mode card, three preset cards, install/provider copy, and phase labels.

- [ ] **Step 1: Write failing renderer wiring tests**

Add source-level and pure-state tests that assert:

- the audio mode state uses `AutoShortAudioMode`;
- `balanced` is the persisted default for the new preset;
- exactly three audio-mode choices and exactly three preset choices exist;
- `Cân bằng — khuyên dùng` is the default label;
- new mode is disabled when TTS is off;
- background-music controls render only for `replace`;
- the request includes `separationPreset` only for `separate-vocals`;
- readiness/install calls include `audioMode` and `separationPreset`;
- no model URL/path/provider override exists in renderer state.

- [ ] **Step 2: Run tests and confirm red**

Run:

```powershell
npm run test:local-runtime
```

Expected: the new UI assertions fail.

- [ ] **Step 3: Widen persisted state and request construction**

Use:

```typescript
const [audioMode, setAudioMode] = usePersistedState<AutoShortAudioMode>(
  'tblao.autoshort.audioMode',
  'replace'
)
const [separationPreset, setSeparationPreset] =
  usePersistedState<AutoShortSeparationPreset>(
    'tblao.autoshort.separationPreset',
    'balanced'
  )
```

When TTS turns off while the new mode is selected, move the UI selection to `replace` and show an explanatory message; do not mutate an already-running job. When building the request, include `separationPreset` only for the new mode and include `backgroundMusic` only for existing replace mode.

- [ ] **Step 4: Render exact mode and preset copy**

Add the mode label `Tách thoại gốc, giữ nhạc & SFX` and explanation that AI narration is required. Under it render:

- `Nhanh` — compact model, fastest qualified profile;
- `Cân bằng — khuyên dùng` — compact model, default;
- `Chất lượng cao` — separate HQ download, slower.

Show exact manifest bytes and `Chưa cài`, `Đang tải`, or `Sẵn sàng`. Show `DirectML · NVIDIA/AMD/Intel` when the effective provider is DirectML, otherwise `CPU fallback`. Always show `Sau khi cài model có thể xử lý offline`. Do not show fixed seconds-per-minute estimates.

- [ ] **Step 5: Map progress and warnings to user-safe text**

Map events to:

```typescript
const SEPARATION_MESSAGES = {
  extracting: 'Đang trích audio',
  separating: 'Đang tách thoại',
  cpuRetry: 'Đang thử lại bằng CPU',
  mixing: 'Đang trộn TTS'
} as const
```

Display the no-audio warning on the queue row. Never render raw stderr, absolute paths, model filenames, or engine exception text.

- [ ] **Step 6: Style for narrow and standard layouts**

Add grid/card rules that keep three presets usable at current Auto Short panel width, collapse to one column under the existing mobile breakpoint, preserve keyboard focus indicators, and use text plus state—not color alone—for install/provider status.

- [ ] **Step 7: Run UI build gates**

Run:

```powershell
npm run test:local-runtime
npm run typecheck
npm run build
```

Expected: tests/typecheck/build pass; no renderer bundle contains a model source URL.

- [ ] **Step 8: Perform a manual renderer acceptance pass**

Start `npm run dev` and verify keyboard/mouse selection, persisted reload, TTS-disabled behavior, dependency modal, exact bytes, provider label, background-control hiding, queue progress, no-audio warning, and Vietnamese copy at normal and narrow widths.

- [ ] **Step 9: Commit renderer integration**

```powershell
git add src/renderer/src/components/AutoShort.tsx src/renderer/src/styles/autoshort.css tests/local-runtime.test.ts
git diff --cached --check
git commit -m "feat(ui): add Auto Short separation presets"
```

---

### Task 11: Close packaging, licensing, real-media, hardware, and deployment gates

**Files:**
- Modify: `scripts/verify-packaged-app.mjs`
- Modify: `electron-builder.yml`
- Modify: `tests/release-tooling.test.ts`
- Modify: `THIRD-PARTY-NOTICES.txt`
- Modify: `src/renderer/src/components/License.tsx`
- Modify: `distribution/separator-release-status.json`
- Create: `docs/benchmarks/2026-09-04-separator-hardware-acceptance.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the complete feature, immutable runtime/model release artifacts, qualification corpus, and clean Windows clients.
- Produces: a lightweight verified app package, reviewed third-party notices, vendor-specific release tier, and a deployable `runtime-v4` release.

- [ ] **Step 1: Write failing package-exclusion and notice tests**

Assert packaged app verification rejects any path matching:

```javascript
/separator-engine(\.exe)?$/i
/separator-models/i
/\.onnx$/i
/separator-model-manifest\.json$/i
/separator-model-inputs\.json$/i
/separator-benchmark-results/i
/tests[\\/]fixtures[\\/]separator/i
```

Assert `electron-builder.yml` excludes those assets. Assert both stable model IDs, their exact weight-license names/URLs/attributions from Task 1, ONNX Runtime DirectML, the MDX-derived inference source, and the separator engine are represented in `THIRD-PARTY-NOTICES.txt` and the License view.

- [ ] **Step 2: Run release-tooling tests and confirm red**

Run:

```powershell
npm run test:local-runtime
```

Expected: new package/notice assertions fail.

- [ ] **Step 3: Add package exclusions and audited notices**

Extend verifier and builder exclusions without excluding normal user-generated `.onnx` files outside the packaged application tree. Populate notices from the accepted catalog; do not infer a weight license from the inference repository. Include the sentence that separation is local after assets install and that existing translation/TTS network behavior is unchanged.

- [ ] **Step 4: Run repository and package gates**

Run in this order:

```powershell
npm run test:separator-engine
npm run typecheck
npm run test:local-runtime
npm run test:subtitles
npm run build
npm run package:win
node scripts/verify-runtime-release.mjs release-artifacts
node scripts/verify-separator-model-release.mjs release-artifacts
npm run package:verify
git diff --check
```

Expected: every command exits 0. Record exact test counts and artifact SHA-256 values in the hardware-acceptance report.

- [ ] **Step 5: Run objective and listening acceptance on the frozen artifacts**

Re-run Task 1 using the exact packaged engine and released model archives. Confirm:

- Fast median time is at most 75% of Balanced;
- Balanced has no intelligible original dialogue in at least 80% of real clips;
- Balanced severe music/SFX damage is at most 10%;
- Quality improves median known-stem leakage by at least 2 dB or wins at least 70% blind A/B;
- Quality severe-damage rate is no higher than Balanced.

A failure keeps `enabledByDefault` false and blocks publishing the app build as production-ready.

- [ ] **Step 6: Run the real hardware matrix**

Record Windows version, GPU model/driver, system RAM, engine/model hashes, provider, wall time, peak working set/VRAM when available, output probe, and reviewer result for:

1. GTX 1660 SUPER 6 GB under normal desktop load: Fast, Balanced, and Quality via DirectML, with no OOM.
2. One AMD or Intel DirectX 12 GPU: Fast and Balanced via DirectML.
3. Forced CPU: the ten-minute stability input completes without crash, corrupt output, or unbounded memory growth.

If AMD is untested, set AMD to `beta`; if Intel is untested, set Intel to `beta`. Never mark an untested vendor `verified`.

- [ ] **Step 7: Validate a clean installed-client lifecycle**

Use an explicit disposable profile:

```powershell
$separatorProfile = Join-Path $env:TEMP 'tediapros-separator-clean-profile'
if (Test-Path -LiteralPath $separatorProfile) {
  $resolvedProfile = (Resolve-Path -LiteralPath $separatorProfile).Path
  $resolvedTemp = (Resolve-Path -LiteralPath $env:TEMP).Path
  if (-not $resolvedProfile.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove a profile outside TEMP.'
  }
  Remove-Item -LiteralPath $resolvedProfile -Recurse -Force
}
& '.\dist\win-unpacked\TediaPros.exe' ('--user-data-dir=' + $separatorProfile)
```

Verify the clean client downloads the engine plus only the selected preset model, completes an Auto Short job, supports cancellation, retries DirectML once on an injected provider failure, and renders source imagery/subtitles/recovered bed/new TTS without original-source audio mixing. Close the app, disable network, relaunch the same profile, and verify a second job uses installed assets with zero download requests.

- [ ] **Step 8: Set the release tier from recorded evidence**

Update `distribution/separator-release-status.json`:

- `qualificationPassed` is true only while frozen-artifact gates pass;
- `enabledByDefault` becomes true only after clean-client, GTX 1660 SUPER, and CPU gates pass;
- each vendor is `verified` only after its hardware run, otherwise `beta`;
- CPU is `verified` only after the ten-minute run;
- the report path points to `docs/benchmarks/2026-09-04-separator-hardware-acceptance.md`.

The UI must surface beta/partial vendor wording from this file.

- [ ] **Step 9: Publish runtime-v4 assets before distributing the app**

Stop at this checkpoint and obtain explicit user approval for the exact GitHub repository, immutable `runtime-v4` tag, and asset list. Passing local verification does not itself authorize creating or updating a remote release.

Run the reviewed GitHub workflow:

```powershell
gh workflow run build-windows-runtime.yml -f runtime_version=runtime-v4 -f publish=true
$runtimeRun = gh run list --workflow build-windows-runtime.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $runtimeRun --exit-status
gh release view runtime-v4 --json assets --jq '.assets[].name'
```

Expected assets include `runtime-manifest.json`, seven runtime ZIPs, `runtime-provenance.json`, `separator-model-manifest.json`, and exactly two separator-model ZIPs. Download the release into an empty verification directory and rerun both release verifiers before publishing the app installer.

- [ ] **Step 10: Document honest client requirements and cost semantics**

In `README.md` state Windows 10/11 x64, DirectX 12 DirectML for NVIDIA/AMD/Intel, CPU fallback, on-demand download size from the release manifest, offline separation after installation, and no separation API fee. Explicitly state that bandwidth, disk, electricity, hosting, support, translation, and TTS may still have costs or network dependencies.

- [ ] **Step 11: Commit release closure**

```powershell
git add scripts/verify-packaged-app.mjs electron-builder.yml tests/release-tooling.test.ts THIRD-PARTY-NOTICES.txt src/renderer/src/components/License.tsx distribution/separator-release-status.json docs/benchmarks/2026-09-04-separator-hardware-acceptance.md README.md
git diff --cached --check
git commit -m "release(separator): verify Windows client distribution"
```

---

## Plan self-review record

### Spec coverage

| Spec requirement | Implemented by |
| --- | --- |
| Third mode, TTS requirement, three presets, Balanced default | Tasks 2 and 10 |
| Two qualified redistributable MDX weights and numeric gates | Tasks 1 and 11 |
| Minimal network-free `separator-engine/1` | Task 3 |
| DirectML NVIDIA/AMD/Intel with deterministic CPU fallback | Tasks 3, 6, 8, and 11 |
| Runtime-v4 plus independent on-demand model packages | Tasks 4 and 5 |
| Canonical userData paths, checksums, safe extraction, rollback, offline reuse | Tasks 4, 5, and 11 |
| Sequential Whisper/separator pipeline | Task 9 |
| Source/stem validation, exact-duration finite bed, ducking, limiter | Tasks 6, 7, and 9 |
| No-audio TTS-only warning | Tasks 6, 9, and 10 |
| No silent source-audio fallback | Tasks 2, 6, and 9 |
| Checkpoint fingerprint, free-space gate, cleanup, no vocal persistence | Tasks 5, 6, and 9 |
| Process-tree cancellation and bounded redacted diagnostics | Tasks 6 and 9 |
| Installer exclusions and separate code/weight notices | Task 11 |
| Automated, real-media, hardware, and clean-client acceptance | Tasks 1, 3, 6, 9, and 11 |
| Honest cost/performance/vendor claims | Tasks 1, 10, and 11 |

### Type consistency

- `AutoShortSeparationPreset`, `SeparatorModelId`, `SeparatorProvider`, and `AutoShortDependencyConfig` originate in Task 2/8 and are consumed unchanged afterward.
- `InstalledSeparatorModel` originates in Task 5 and is the only model object accepted by the runner/pipeline.
- `SeparatorProviderState` and `SourceSeparationResult` originate in Task 6 and are stored by `AutoShortJob` in Task 9.
- `composeAutoShortNarratedAudio` originates in Task 7 and accepts both old looping music and the new finite bed.
- Runtime protocol stays `separator-engine/1` and release channel stays `runtime-v4` across engine, manifests, installer, UI, and release workflow.

### Placeholder and scope check

- The plan contains no dummy production URLs, hashes, byte counts, model names, or license guesses. Task 1 generates and independently verifies those immutable facts; Tasks 2-11 stop if that gate does not produce the accepted two-record catalog.
- Private benchmark media remains untracked and outside every package.
- The four architectural units are interdependent stages of one user-visible vertical slice, so one plan preserves interface consistency while every numbered task remains independently reviewable and testable.
