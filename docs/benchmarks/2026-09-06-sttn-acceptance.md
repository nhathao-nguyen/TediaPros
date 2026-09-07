# STTN local acceptance — 2026-09-06

Implemented in the existing feature checkout, preserving its earlier title,
OCR blur and media fixes. No commit, push or runtime publication was performed.

## User-visible behavior

Auto Short → Làm mờ → Xóa phụ đề AI (STTN). Enable subtitle processing and
select the dashed OCR region. Accurate visual OCR determines where and when to
erase. ASR/OCR subtitle text is retained before erasure for translation, title
generation and dubbing. The cleaned lossless video feeds the existing renderer;
Gaussian/manual blur is disabled for that render. Other modes retain their paths.

The five-second preview uses the same OCR, worker and managed FFmpeg as the job.
The user can cancel, inspect a playable MP4, or install missing optional assets.
No permanent inference server or full-video frame directory is introduced.

## Build and installation

- Host: Windows x64, GTX 1660 SUPER 6 GiB; Python 3.12, PyTorch 2.7.1 CUDA 11.8.
- Source subset: researchmm/STTN `f39f62c5bbbe3e3eba084c487353a2c651bfdcde`, MIT.
- Checkpoint: video-subtitle-remover `f78e985e1ce75c0739bee13ab12226d5e71a958a`,
  `backend/models/sttn-det/sttn.pth`, 66,252,587 bytes (63.2 MiB), SHA-256
  `25b0c2c30042d82efd1893bd42ec726764262d94115393a1718f8d65d2a7817b`.
- Built runtime: 2,219 files, 4,809,810,691 unpacked bytes (4.48 GiB).
- ZIP: 2,936,819,558 bytes (2.74 GiB), SHA-256
  `73bab10b0e656d95b33e8081f3b609b2b7ac110331f918fad96603c7b284793c`.
- Local distribution: `release-artifacts/sttn-local-20260906`. Actual managed
  installer validated ZIP size/hash, extracted, probed and promoted it under
  `%APPDATA%/tedia-pros/bin/sttn-engine`; installed receipt matches that ZIP hash.
  Model downloaded through the pinned HTTPS URL and passed size/hash checks.
  Packaged executable model probe returned CUDA ready.
- Engine, model, local archives and Python environment are excluded from the
  base Electron package. Heavy libraries remain in the optional installation.
  Local distribution streaming avoids reading the multi-GiB ZIP into RAM.

## Native media evidence

Source: the user's cat video in project `90_7656274197379478409`, first five
seconds, 1080×1920. OCR region x=0..1080, y=1450..1920. Coverage is restricted
to that region; shop signs outside it are intentionally preserved.

1. Direct worker qualification: 150 frames, CUDA, 25.107 seconds. Comparing the
   lossless intermediate against the same canonical FFmpeg RGB decode produced
   maximum difference **0 outside the active masks**, across all 150 frames.
2. Integrated Electron main-path preview via `scripts/sttn-acceptance-main.ts`,
   using installed assets with real OCR (no worker/media mocks): STTN 27.154
   seconds; total preview preparation/OCR/STTN/MP4 export 71.766 seconds.
3. Result: `F:/Son/49/_STTN_preview_20260906/preview/preview.mp4`, 9,118,058 bytes,
   H.264 yuv420p, 1080×1920, 150 frames, 5.013872 seconds; AAC audio 5.000 seconds.
   FFmpeg decoded the entire MP4 with exit 0. Intermediate clips and OCR work
   files were cleaned, leaving only the MP4 in the preview subdirectory.
4. Frame inspected at 0.5 seconds: original subtitle text is removed; image
   detail inside the repaired area can look smoother than the surrounding image.
   This is not a claim of perfect recovery or of flicker-free long-video quality.
5. Synthetic constant-background fixture, five identical frames: masked MAE
   against known background improved from 27.96 to 1.09, outside-mask difference
   0. Inference 0.565 seconds, peak allocated CUDA memory 404.54 MiB. This small
   fixture does not establish peak VRAM for the real video or a minimum GPU size.

## Automated verification

- `npm run test:local-runtime`: 350 test executions passed, no failures.
- `npm run test:ocr-engine`: 16 passed.
- Isolated Python STTN suite with managed FFmpeg: 15 passed, including real
  lossless audio/video, irregular PTS, long final-frame hold, OOM traceback
  release before retry, bounded diagnostics and subprocess timeout.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed. Build emits
  existing/mixed static-dynamic import warnings; these do not fail the build.
- Fixed renderer preview config type error and cancellation during readiness
  so a stale preflight cannot start an unwanted preview.
- Native preview cancellation at 45.5% (after inference began): returned
  `Đã hủy xem thử STTN.`, removed the new preview work directory, and left no
  `sttn-engine.exe` process. Evidence is `cancellation.json` beside the sample.

## Limits and release boundary

This qualifies local NVIDIA CUDA inference and the main-process preview path.
GUI clicking, full-length batch quality and server-backed TTS/translation were
not exercised by this acceptance harness. CPU protocol exists but real CPU
inference speed/quality was not qualified. No DirectML support is claimed.

OCR can miss text or classify other text inside the region as subtitles. The
model may soften texture or introduce temporal artifacts. Inspect the short
preview first. OOM reduces temporal window size within CUDA; exhausted retries
fail explicitly. There is no silent blur fallback.

FFV1 intermediates consume temporary disk space; a conservative free-space
preflight can reject long/high-resolution video on a nearly full system drive.
Remote installation on another machine requires publishing a qualified runtime
manifest and archive, with provenance/licenses retained. No hosted STTN release
has been fabricated or published by this work.
