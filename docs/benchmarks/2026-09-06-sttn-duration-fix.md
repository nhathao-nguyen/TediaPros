# STTN 1.1.1: AAC codec delay and intermediate duration validation

## Failure and evidence

The local Auto Short run failed at `2026-09-06T07:35:46.063Z` with
`Intermediate duration mismatch`, after translation and all 47 TTS cues had
completed. Source: the 2026-06-28 cat video in
`F:/Son/doyuin/科普小卖部/post/90_7656274197379478409` (original MP4, not `-phude`).

- Source video: 1080x1920 HEVC, 2,128 frames, 29917/1000 fps, 71.130127 s.
- Source HE-AACv2: 44,100 Hz, 7,106 initial padding samples (0.161134 s).
- Reproduced intermediate: FFV1 video tag 71.130 s; AAC tag and container
  duration 71.284 s. The 0.153873 s difference exceeded the existing 0.15 s
  tolerance. Both the original and the `-phude` copy reproduce the metadata issue.
- Audio-only stream copy reproduces the inflated container duration. Decoding
  either original audio or copied audio to float32 gives identical SHA-256:
  `b5fffb28e407d7801a46522535fe0b006bedd0574ac384556709145c2e235864`.
  The first audible frame starts at zero in both. Audio was not corrupted.

FFmpeg Matroska tracks represent encoder delay separately; encoded timestamp
extent differs from decoded playback time. Reference:
[FFmpeg Matroska muxer source](https://www.ffmpeg.org/doxygen/trunk/matroskaenc_8c_source.html)
and [initial_padding contract](https://www.ffmpeg.org/doxygen/trunk/structAVCodecContext.html).
The local FFmpeg probes above, rather than a generic tolerance assumption,
establish the failure on this installation.

## Change

`engines/sttn-engine/video.py` now validates individual stream endpoints:

1. Require video duration to match the requested timeline independently of audio.
2. For audio, subtract reported initial padding/sample rate from its Matroska
   DURATION extent before checking playback bounds.
3. Validate container metadata against the encoded stream extents, and reject
   invalid/nonfinite metadata.
4. Report numeric expected/measured/codec-delay values on a real mismatch.

The tolerance remains `max(0.15 s, 3/fps)`. Encoding, stream copy, frame windows,
model inference and output cleanup are unchanged. There is no extra media pass,
no audio recompression and no additional intermediate file. Worker version is
1.1.1; the client accepts this version with matching managed-install receipt.

## Verification

- Before fix: both new regressions failed (incorrect playback-duration result
  with generated AAC, and a truncated video hidden by full-length audio).
- After fix: all 26 Python STTN tests pass with the isolated Python 3.12 runtime
  and managed FFmpeg; no skipped tests.
- Client: all 411 local-runtime tests pass; TypeScript checks pass.
- Actual original MP4, complete duration at 180x320 with empty masks: 2,128
  frames; validated playback duration 71.130 s; processing 6.561 s. This is
  transport/timing evidence, not an inference-speed benchmark.
- Real client `burnAutoShort` exported that full-duration intermediate to MP4
  with subtitles and source audio; its normal pre-publication validator passed.
  FFprobe: H.264 180x320, 29917/1000 fps, video 71.130127 s, audio 71.122018 s.
- App build passed with `electron-vite.build({build:{emptyOutDir:false}})`.
  The default build was blocked removing an existing `out/renderer/assets`
  directory; retaining old hashed assets allowed the current bundles to build
  without changing permissions or removing existing files.
- Packaged Windows EXE 1.1.1 passed the complete original source at 1080x1920:
  2,128 frames, playback duration 71.130 s. Every decoded RGB pixel and audio
  sample matched the original (SHA-256); maximum frame timestamp rounding was
  0.5 ms. Worker elapsed time was 88.889 s with empty masks. The model loaded on
  CUDA, but restoration was bypassed; this is not a full OCR/inpainting benchmark.
- Full-resolution RGB SHA-256:
  `503e7e3e0227eb3cb1e35864e5618869634734006ae69982dbf917854538fded`.
- Completed package: `package-final`, 2,936,823,518 compressed bytes,
  4,809,814,382 unpacked bytes; SHA-256
  `c2ace554b32165fbcd106651e685a277e2317919f409555a369b9ad1a58a4d05`.
  Only this completed package is used for managed installation.
- Managed installer activated 1.1.1 at `2026-09-06T07:58:37.831Z`; receipt SHA-256
  matches the completed package and both engine/model readiness checks passed.
- On 2026-09-07, rechecked the installed executable directly: version 1.1.1,
  `--probe` returned `ready: true`, provider `cuda`, exit 0. Rebuilt the main and
  preload bundles and opened TediaPros through `npm run dev`; the window was
  confirmed at 08:02 local time (PID 6720). Full Auto Short with translation/TTS
  was not rerun as part of this fix verification.

Evidence is isolated under `release-artifacts/sttn-duration-20260906`.
Native packaging, installed-runtime verification and app activation are recorded
there separately. No backend changes or remote TTS/translation calls are needed.
