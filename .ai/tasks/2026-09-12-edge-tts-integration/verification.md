# Verification evidence

- Base: `42f92a5da88ed407fd320686e1acc1c765f044c5`
- Incoming tip rechecked: `1d61ef744384208382de3903b73b2953d45553ab`; local base is 93 commits ahead, 0 behind.
- `npm.cmd run typecheck`: exit 0.
- `npm.cmd run build`: exit 0.
- First full local-runtime: exit 1 only because a fresh worktree lacked prepared font files; two overlay tests reported `Font đã chọn không còn khả dụng`.
- `npm.cmd run fonts:prepare`: exit 0; 4 pinned OFL fonts downloaded.
- `npm.cmd run fonts:verify`: exit 0; 4 fonts, 12.90 MiB verified.
- `node scripts/run-local-runtime-tests.mjs autoshort-overlays.test`: 11 pass, 0 fail.
- Second `npm.cmd run test:local-runtime`: exit 0.
- Live Edge-TTS smoke: 4 pass, 0 fail; managed FFprobe decoded all outputs. Structured measurements are in `live-smoke.json`; generated MP3 files were deleted after hashing/probing.
- Review remediation suites: locale, adapter lifecycle, dynamic capability/cache and IPC origin tests pass; Edge output-path cache contains PCM WAV.
- Requalification after review fixes: live catalog returned 322 voices; synthesis WebSocket probe passed; 4/4 language samples passed full FFmpeg decode and FFprobe duration measurement.
- Final cancellation review: no Critical/Important findings. The 100-iteration late-cancel cache probe rejected 100 requests and published zero cache files.
- Final `npm.cmd run typecheck`, `npm.cmd run build`, and `npm.cmd run test:local-runtime`: exit 0 after the late-cancel fix.
- Current-source Windows packaging: `electron-builder --win -p never`, packaged font verification, and package forbidden-runtime verification all exit 0. Artifact: `dist/TediaPros-0.1.26-setup.exe` (local, not published).
- `npm.cmd run release:verify`: exit 1 because existing `RELEASE_NOTES.md` does not start with `## TediaPros v0.1.26`; this feature task did not change release metadata.
- Interactive Voice UI and real-video AutoShort live matrix were not run. Live evidence in this folder qualifies the adapter/network/decode boundary only.
