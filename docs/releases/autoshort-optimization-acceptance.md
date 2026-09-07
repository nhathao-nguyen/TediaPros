# AutoShort Optimization Acceptance Ledger

- **Ngày:** 2026-09-07
- **Branch:** `codex/autoshort-optimization`
- **Release decision:** code/regression changes ready for review; release defaults remain conservative

## Feature matrix

| Feature | Default in this branch | Evidence | Release status |
|---|---:|---|---|
| Tempo/gap hard ceiling | enabled | dubbing policy/synthesis tests | eligible, ≤1.45x and no truncation |
| Path/junction and atomic output guards | enabled | OCR mask and burn tests | eligible |
| Lease until provider close + process registry | enabled | resource lifecycle and engine tests | eligible |
| Disk reservation race repair | enabled | disk budget tests | eligible |
| OCR/Douyin/verifier fail-closed results | enabled | standalone/release tests | eligible |
| OCR stream-full | off by default; capability negotiated | Python stream tests; installed OCR 1.1.0 has no stream feature | opt-in only after packaged qualification |
| Overlap after ASR | off by default | stage scheduling + OCR pipeline tests | experimental; no KPI claim |
| One-cue TTS prefetch | off by default | TTS pipeline/determinism tests | experimental; server remains serialized |
| Stage artifact cache + content keys | available to AutoShort job | cache/key/integration tests | eligible with quota/pin/integrity; cache hit is not inference speed |
| Trim PCM cache | enabled when the shared artifact cache is available | trim-stage keying and artifact-cache integrity tests | eligible for reruns; cache hit still probes duration and copies into item scope |
| Title preparation during render | available when video title enabled | title overlap/burn tests | eligible; sidecar failure keeps video |
| Content structural QA | enabled after translation | content quality tests | eligible; semantic fidelity still unverified |
| Renderer progress coalescing | enabled | UI contract tests | eligible; GUI acceptance still required |
| AutoShort IPC origin/navigation guard | enabled for AutoShort + Whisper model/process paths | IPC origin tests; build/typecheck | eligible for guarded paths; wider app IPC audit remains |
| Resident Whisper worker / server conditioning | off | no backend/hardware evidence | unqualified |
| Two-item concurrency | explicit `maxActiveItems=2` only | resource/disk fixture tests | experimental; default remains 1 |

## Migration and rollback

Saved configs without `executionPolicy` resolve to the conservative policy:
`maxActiveItems=1`, no overlap, no TTS prefetch and `legacy-disk` OCR. Unknown
transport values fall back to legacy. New cache entries are content-keyed and
can be ignored safely; they never replace source/output artifacts. A rollback
must disable optimization flags, keep tempo/path/lifecycle correctness fixes,
and use the previous verified runtime receipt before activation.

`tieude.txt` is written only after the MP4 has passed decode/probe validation and
atomic publication. A title provider failure or cancellation leaves the valid
video and reports `titleError`; it never writes a placeholder.

## Verification recorded in this implementation pass

- `npm.cmd run typecheck:node`: PASS
- `npm.cmd run typecheck:web`: PASS
- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS (Vite emitted existing dynamic-import chunk warnings only)
- `npm.cmd run test:local-runtime`: PASS (all registered TypeScript suites)
- focused local-runtime suites for cache, stage scheduling, OCR pipeline,
  TTS, title, content QA, UI, trim-key, IPC and release tooling: PASS
- `npm.cmd run test:ocr-engine`: PASS (32 Python tests)
- `npm.cmd run test:sttn-engine`: PASS (26 tests, 17 dependency-gated skips)
- `npm.cmd run test:separator-engine`: PASS (13 tests)
- `npm.cmd run test:subtitles`: PASS (logic; FFmpeg render skipped because the
  binary is not in PATH)
- `npm.cmd run release:verify`: PASS

The source and local-runtime gates pass. `fonts:verify` remains blocked by the
missing bundled `NotoSans.ttf`; `release:verify-runtime` lacks
`release-artifacts/runtime-manifest.json`; package and installer asset verifiers
fail closed because no `dist` package or setup executable is present. Fresh
package install, full media corpus, live translation/TTS, two-item hardware
matrix and macOS qualification were not performed in this branch. Installed OCR
probe is healthy at version 1.1.0 but does not advertise
`visual-stream-full-v1`; stream-full therefore remains unqualified. No speed
percentage is published without benchmark-v1 records.
