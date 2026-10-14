# Evidence: balanced video export, 2026-10-13

Current accepted measurements are `pipeline-motion.json`, `pipeline-static.json` and `pipeline-grain.json`, with their matching logs. `summary.json` selects the new policy's CPU/GPU path and compares it against the representative previous NVENC path; the per-case files also retain the CPU-vs-CPU and GPU-vs-GPU comparisons. Size refers to encoded MP4 bytes including the same copied audio. Timings are median of three subprocess renders, not full batch or UI latency.

`balanced-motion.mp4` is the accepted GPU example. Source media is generated, while texture assets come from the inspected local Nhiễu 2 package. The original source is not a quality reference because effects deliberately change pixels; comparison uses a high-quality export of the same final graph. SSIM is a sample metric. See [ADR 014](../../../docs/adr/014-balanced-video-export-policy.md) for decisions and limitations.

`pipeline-benchmark.json` and `.log` are superseded exploratory evidence from the first cumulative run, before splitting experiments and the final protected grain policy. Do not use them as acceptance results. `encoder-probe.json` explains P4/P5 and CPU preset choices. `filter-threads-0.json` and `filter-threads-4.json` have equal decoded frame hashes but show fixed four threads slower on this sample.

Verification logs: `tests.log`, `selection-and-telemetry-tests.log`, `typecheck.log`, `build.log` and `ui-smoke.log`. Run all scripts from the repository root with `TEDIAPROS_TEST_FFMPEG` set to the actual FFmpeg executable. Texture experiments require the inspected package to remain available. Benchmark scripts accept one case/thread-count per invocation; do not aggregate them behind a cumulative deadline.

## Cleanup boundary

Two early cumulative experimental runs exceeded their parent harness deadline (not the application's export deadline) and left their own test directories after FFmpeg held a file during cleanup:

- `C:\Users\PC\AppData\Local\Temp\tedia-balanced-benchmark-vCoIzP`
- `C:\Users\PC\AppData\Local\Temp\tedia-filter-threads-QVWFPZ`

Codex policy rejected the native PowerShell recursive cleanup command for the first directory before process creation. The deletion was not retried or bypassed using another shell/runtime. Both directories were preserved. Later single-case runs complete and clean their independent scopes normally. A final read-only process check found no running FFmpeg. These remnants are experimental artifacts, not proof of a production AutoShort scratch leak.
