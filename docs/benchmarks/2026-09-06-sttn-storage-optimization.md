# STTN 1.1.0 storage and throughput qualification

## Change

The old worker required enough free space for two complete raw BGR0 videos,
although it actually encoded FFV1. It wrote a silent FFV1 MKV, then read and
copied that entire video into a second MKV with the original audio.

The new worker streams FFV1 packets through a bounded OS pipe into FFmpeg,
which copies those packets and source audio into one MKV. It uses FFV1 range
coding, large contexts and four slices. One encoding worker overlaps the next
decode/inference window. Only one encoding batch may be outstanding; memory
does not grow with video duration. Model weights, float32 inference, spatial
resolution, temporal windows, masking and the final output codec are unchanged.

Before each window, free disk must cover two raw windows plus 512 MiB of
headroom. For 1080x1920 and 12-frame windows this is about 0.685 GiB. This is
**remaining headroom while writing, not the total disk needed by a video**.
The output still grows with content and duration. Low-space failure removes
the partial video; an unrelated process can still exhaust storage between
checks. The prior Auto Short fix keeps intermediates on the selected output
volume and cleans its private directory on success, failure and cancellation.

The packet pipeline retains audio stream mapping, time offsets and variable
frame durations. The writer handles short OS writes and kills a stalled muxer
after 120 seconds without write progress. Failure kills the muxer before
joining the encoder and closing the pipe, preventing cleanup deadlocks.

## Measurement method

Machine: local Windows / NVIDIA GTX 1660 SUPER. Same loaded CUDA model for both
variants. Input is a stream-copy excerpt of the user's Chongqing video
`75_7646384110545537203`. Seeking to 30 seconds with stream copy retains a
preceding keyframe: the measured excerpt is **10.435 seconds, 306 decoded
frames, 1080x1920**, not exactly five seconds. A fixed synthetic lower-screen
mask is used on the real footage to isolate STTN from OCR differences.

`scripts/sttn-storage-benchmark.py` samples intermediate file sizes every
10 ms, compares decoded RGB SHA-256, every frame timestamp and decoded audio
SHA-256. Timings cover media processing with the model already loaded; they
exclude OCR, translation, TTS, model loading and the final MP4 render.

Evidence root: `release-artifacts/sttn-opt-20260906` (local, excluded from Git).
`video_baseline.py` preserves the pre-change worker. `compare-1` measures only
the pipe change; `compare-2` adds compression and overlapping encoding;
`compare-3` repeats the full comparison with reversed execution order.

## Results

Pipe-only change: 585,168,280 to 292,625,491 peak video bytes (about 50% less),
50.64 to 51.54 seconds. This did not establish a speed improvement.

Full optimization, forward-order run:

| Metric | Previous worker | Optimized worker |
| --- | ---: | ---: |
| Peak intermediate video bytes | 585,168,280 | 250,747,168 |
| Completed intermediate bytes | 292,625,491 | 250,747,168 |
| Processing seconds | 55.35 | 46.72 |
| Decoded RGB / timestamps / audio | Reference | Exact match |

This run reduces peak intermediate storage by 57.15%, the completed lossless
intermediate by 14.31%, and elapsed processing time by 15.61%. These are sample
measurements, not promises for full-length jobs or other hardware.

Reversed-order repeat: optimized 44.77 seconds, baseline 54.34 seconds (17.60%
less elapsed time). Byte counts and all RGB/timestamp/audio comparisons match
the forward run. A 10 ms disk poll is an approximation of peak occupancy; the
two-file versus one-file lifecycle is independently covered by media tests.

`scripts/sttn-codec-benchmark.py` also tests 60 identical cleaned frames without
ML. Default FFV1: 40,170,173 bytes / 1.59 seconds. Range coder with large
contexts: 34,548,104 bytes / 2.06 seconds. Both decode to identical RGB. The
stronger compression alone is slower; overlapping it with STTN inference is
what allows the final pipeline to improve both storage and elapsed time.

## Verification and deployment

Media tests cover exact RGB and audio, delayed multiple audio streams,
irregular timestamps, long final-frame holds, mid-run disk exhaustion,
muxer failure, process cleanup and short pipe writes. Source/model inference
behavior is unchanged. Runtime protocol remains `sttn-engine/1`; engine version
is `1.1.0`, and the application accepts installed 1.0.0 and 1.1.0 receipts.

Fresh source verification: 352 local-runtime test executions passed, 21 Python
tests passed (none skipped), application typecheck and build passed, and
`git diff --check` passed. The build retains existing static/dynamic import
warnings; Python packaging emits upstream dependency deprecation warnings.

The new runtime is built into a separate local directory. Packaging generates
a manifest with the actual version, archive size and SHA-256. Local activation
uses `scripts/sttn-update-local-main.ts` and the normal checksum/probe/atomic
installer; its evidence records the previous and new receipts. The previous
1.0.0 archive remains available for recovery. No hosted release is published.

Packaged EXE qualification passed on all 306 frames: RGB hash, frame timestamps
and decoded audio hash match the previous worker. The ZIP contains 4,809,812,941
unpacked bytes and is 2,936,821,884 bytes; SHA-256:
`861f519865dff3c0a45a9428606ae19a7b73d27e06ba33e9937986e61941d940`.

The managed installer activated 1.1.0 at `2026-09-06T03:20:22.737Z`; its installed
receipt matches the package hash, and the application readiness check passed
with CUDA. The first installation attempt was interrupted during staging; the
old 1.0.0 remained intact and was verified before retrying the normal installer.
Installation evidence is in `installed/installation.json` beneath the evidence
root. The base Electron app was rebuilt locally; no commit or push was made.

Installed main-process acceptance also passed with real OCR and CUDA STTN:
`installed/preview/preview.mp4` is H.264/AAC, 1080x1920, 144 video frames,
5.200 seconds and 5,674,476 bytes. STTN reported 21.276 seconds; this is not
the full OCR/preview elapsed time. The complete MP4 decoded with FFmpeg exit 0.
The preview source excerpt has an initial video offset and irregular final
hold, so this output is reported with its measured duration rather than
claimed to be exactly five seconds. Only the MP4 remains in the preview
directory. Native cancellation after STTN progress exceeded 45% returned
`Đã hủy xem thử STTN.`, with no remaining STTN process or preview work directory.
These checks exercise the actual Electron main path, not GUI clicking. The
full-length user video, translation and TTS were not rerun by this benchmark.

References: [FFmpeg stream mapping and stream copy](https://ffmpeg.org/ffmpeg.html),
[FFV1 encoder options](https://www.ffmpeg.org/ffmpeg-codecs.html).
