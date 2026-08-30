# Plan: TediaPros canonical runtime migration

> **For the implementation agent:** follow this plan task-by-task, keeping each red/green/refactor cycle observable.

## 1. Replace legacy contracts with tested canonical primitives

- Add failing tests for the supported runtime-kind union, canonical `userData/bin` paths, exact platform/arch manifest matching, non-empty assets, required files, and rejection of Whisper.cpp/legacy protocol.
- Add failing tests proving production resolution ignores `TEDIAPROS_RUNTIME_DIR`, legacy AppData/runtime roots, PATH, and source `engine.py`; add a separate explicit development resolver test.
- Add failing tests for the generic installer: checksum/size verification, required-file validation, real probe gating, atomic promotion, rollback, and receipt-after-success ordering.
- Implement the smallest changes in `runtimeResolver.ts`, `runtimeManifest.ts`, `runtimeInstaller.ts`, `distributionConfig.ts`, and a new probe module; keep public adapters temporarily compiling.

## 2. Make Whisper runtime and model lifecycle canonical

- Add failing tests for Faster-Whisper-only protocol/catalog/model manifests, complete model files, local model path selection, no network inference, CPU probe, CUDA probe/fallback, and removal of fake worker stats.
- Add a real `--probe` contract to `engines/whisper-engine/engine.py`; add local model path handling and ensure CUDA library setup occurs before backend import.
- Refactor `whisper.ts`, `modelStore.ts`, `engineProtocol.ts`, shared types, IPC/preload, and Auto Short readiness to use the canonical installer/probes without changing media/subtitle/timing logic.
- Run typecheck and the focused runtime tests after each red/green cycle.

## 3. Migrate OCR, FFmpeg, Douyin, Video2X, and yt-dlp adapters

- Add failing tests that each installer delegates to the shared verified installer and that status means probe success, not file existence.
- Preserve OCR algorithm/frame selection/ROI/cancellation, Douyin request/task behavior, Video2X concurrency/output validation, and yt-dlp official checksum/rollback behavior.
- Remove direct delete-before-extract and swallowed install errors; make all failures visible and leave the previous install intact.
- Ensure FFmpeg readiness requires a working FFmpeg/FFprobe pair and has no PATH/developer-cache production fallback.

## 4. Clean source/assets and make builds reproducible

- Compare and remove the exact duplicate Douyin subtree; remove stale local-assets Whisper.cpp documentation/manifests and tracked generated runtime manifests.
- Add a reviewed pinned provenance/config file for runtime inputs, update `.gitignore`, and ensure no generated archive is source-controlled.
- Rewrite runtime packaging to require an explicit clean-build input directory and reject APPDATA/PATH/runtime overrides.
- Add clean Windows runtime CI with pinned Python/dependencies, PyInstaller builds, third-party verification, archive probes, generated manifest, and immutable runtime release publishing.
- Separate main-branch app CI from tag release CI; fix repository/product metadata and app release asset verification.

## 5. Verify and report honestly

- Run `git diff --check`, typecheck, focused tests, full local runtime/subtitle tests, packaging checks, and available real probes/media tests.
- Inspect generated artifacts, hashes, process cleanup, and final Git state; do not claim clean-machine or GitHub-release success without evidence.
- Report baseline/current commit, removed legacy paths, canonical architecture, model/runtime paths, sources/provenance, release assets/hashes, CI behavior, clean-machine status, and each feature/regression as `PASS`, `PARTIAL`, or `BLOCKED`.
