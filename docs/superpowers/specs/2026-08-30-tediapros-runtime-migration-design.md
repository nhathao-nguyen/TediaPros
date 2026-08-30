# TediaPros canonical runtime migration design

## Objective

Make Faster-Whisper the only supported Whisper runtime and make every downloadable native dependency follow one verified, user-data-local lifecycle. Preserve the existing Audio→Text, Auto Short, OCR, Douyin, Video2X, subtitle, translation, TTS, and media-processing behavior except where an adapter must use the new runtime contract.

## Evidence and boundaries

- The starting point is commit `20f71441aae56b6cd1f91e05a182385e11f273be` on `main`.
- Production currently mixes `userData/bin`, legacy AppData/runtime roots, direct per-engine downloads, source `engine.py` fallback, and PATH fallback.
- The current local-runtime suite passes while asserting several legacy contracts and using synthetic files for the supposed clean-machine FFmpeg check.
- The duplicate `engines/douyin-engine/douyin-downloader-main` tree is not the build entrypoint and will be removed only after an exact content comparison.
- `tts-server` remains out of scope.

## Canonical production layout

```text
<userData>/
  bin/
    ffmpeg/ffmpeg[.exe]
    ffmpeg/ffprobe[.exe]
    whisper-engine/whisper-engine[.exe] (+ bundled _internal/)
    whisper-cuda/ (+ CUDA DLLs when installed)
    ocr-engine/ocr-engine[.exe] (+ bundled _internal/)
    douyin/dy-engine[.exe] (+ bundled _internal/)
    video2x/video2x[.exe]
    yt-dlp[.exe]
  whisper-models/<model-id>/
    model.bin, config.json, tokenizer.json, vocabulary.*
    manifest.json
  runtime-state/installed-runtime.json
```

The production resolver reads only this layout. A separate development-only resolver may use an explicitly supplied `TEDIAPROS_RUNTIME_DIR`, but packaged code must never execute Python, scan source trees, read `resources/local-assets`, or borrow legacy AppData/runtime roots. PATH is not a production fallback for FFmpeg or any bundled engine.

## Runtime contract

The supported engine kinds are `ffmpeg`, `whisper-engine`, `whisper-cuda`, `ocr-engine`, `douyin`, and `video2x`. The runtime manifest has a versioned schema, exact platform/architecture matching, required files, SHA-256, byte count, entrypoint, protocol, and capabilities. The next channel is `runtime-v2` and the app points to that exact immutable release channel.

All runtime installs use one installer:

1. Fetch and strictly validate the manifest.
2. Select an exact platform/architecture asset.
3. Download into a fresh staging directory and verify HTTP result, byte count, and SHA-256.
4. Extract with path traversal protection and verify every required file.
5. Run the component-specific real capability probe against the staged files.
6. Atomically promote staging to the canonical directory.
7. Write the receipt only after promotion and successful verification.

An existing healthy installation is reused. A failed download, checksum, extraction, required-file check, or probe leaves the current installation untouched.

## Component probes

- Faster-Whisper: exact `whisper-engine/1` version event, exact `faster-whisper` engine, then `--probe` that imports the bundled backend. CPU probe must succeed on CPU-only machines; CUDA probe must exercise the CUDA backend and fall back to CPU when it cannot be used.
- OCR: preserve the TediaPros `ocr-local/1` protocol and RapidOCR/model initialization probe; remove the permissive legacy fallback.
- FFmpeg: run both FFmpeg and FFprobe version checks; neither is healthy alone.
- Douyin and Video2X: execute their supported non-destructive version/help capability command and require a successful result; existence alone is not readiness.

## Whisper model contract

Only Faster-Whisper/CTranslate2 models are valid. The model catalog and persisted status no longer expose Whisper.cpp, GGML, legacy roots, or compatibility states. Model installation discovers the repository files, downloads the complete required set into staging, verifies each file and the manifest, asks the real engine to load/probe the staged model, and atomically promotes it to `<userData>/whisper-models/<id>`. Inference passes the resolved local model directory/path and must not silently download from the network.

The old fake worker-statistics API is removed because it has no renderer consumer. Active child-process tracking and cancellation remain real.

## Distribution and builds

Runtime packaging accepts only explicit artifacts produced by the current clean build job. It must not inspect `%APPDATA%`, `TEDIAPROS_RUNTIME_DIR`, PATH, ignored local bundles, or the developer machine. Windows runtime CI creates pinned Python environments, installs lock/pinned dependencies, builds all engine artifacts, downloads pinned third-party FFmpeg/Video2X inputs, probes them, creates the manifest from those exact files, verifies the archive, and publishes the immutable `runtime-v2` release.

The app CI remains separate: pushes to `main` build and upload non-release artifacts; `v*` tags additionally enforce version/tag agreement and publish the lightweight app installer. App packaging excludes runtime/model binaries. Release publishing is immutable: an existing tag or mismatched asset is an error, not a delete-and-reupload operation.

Third-party source URLs, versions, SHA-256 values, licenses, and upstream release references live in a reviewed provenance file and are copied into the generated runtime manifest. Generated release directories and archives are ignored.

## Regression gates

Tests will cover canonical path isolation, strict manifest validation, staged install rollback, real probe gating, local-model completeness/loadability, no packaged Python fallback, and packager refusal of developer-machine inputs. Existing subtitle, alignment, timing, OCR frame-selection/ROI, Douyin task ownership, Video2X concurrency/cancellation, yt-dlp checksum/rollback, and FFmpeg media probes remain regression-tested. Where a true clean Windows machine or GitHub release cannot be reached from this checkout, the final report will mark the gate `PARTIAL` or `BLOCKED` with evidence.
