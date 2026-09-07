# STTN Subtitle Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add optional STTN subtitle erasure to Auto Short using existing OCR and render infrastructure.
**Architecture:** Managed standalone Python inference worker plus small Electron adapter. Reuse OCR timeline and FFmpeg; keep one lossless intermediate and one optional model.
**Tech Stack:** Electron/TypeScript, Python, PyTorch, NumPy, PyAV, managed FFmpeg.
**Spec:** `docs/superpowers/specs/2026-09-05-sttn-subtitle-removal-design.md`

## Global constraints

Preserve dirty worktree. No external publication. One model, protocol `sttn-engine/1`, default window 12 frames. STTN is opt-in via `lamMo && blurMode === 'sttn'`. No automatic blur fallback. No Python/model dependency in base Electron package. No fabricated runtime asset URLs or hashes.

## Task 1: Contract and GUI

Files: `src/shared/types.ts`, `src/shared/autoShortOcrBlur.ts`, `src/shared/autoShortContract.ts`, `src/renderer/src/components/AutoShort.tsx`, `tests/sttn-contract.test.ts`.

- [x] Test that `{lamMo:true,blurMode:'sttn',subtitleMethod:'whisper'}` needs OCR, selects accurate profile, validates an OCR region, and never counts as Gaussian auto blur. Test blur-off has no STTN dependency.
- [x] Observe failure, add mode and `isSttnRemoval(config)`, preserve legacy modes. Add dependency IDs `sttn-engine`/`sttn-model`.
- [x] Add mode UI and progress labels. Use existing dependency download flow. Preview plumbing follows Task 3's IPC.
- [x] Run focused tests and renderer typecheck.

## Task 2: Managed assets and process adapter

Files: `src/main/inpainting/{assets,runner}.ts`, runtime resolver/manifest/probes, release pack tooling, `tests/sttn-runtime.test.ts`.

- [x] Test checksum mismatch, missing runtime/model, bounded output, failing worker, and cancellation awaiting process close.
- [x] Implement managed runtime discovery/install and pinned model download with atomic promotion. Keep inference offline. Add runtime kind without making STTN mandatory in existing release manifests.
- [x] Export `getSttnReadiness()`, `installSttnDependencies(onProgress,signal)` and `runSttnRemoval({videoPath,timeline,outputPath,ffmpegPath,ffprobePath,signal,onProgress,previewSeconds?})`.
- [x] Runner writes request/timeline under item's work directory, launches `--run --request`, validates terminal event and contained output, and reports effective provider. Progress callback receives `(percent:number,message:string)`; result `{outputPath,provider,elapsedMs}`.
- [x] Run focused lifecycle/asset tests.

## Task 3: Auto Short and preview integration

Files: `src/main/autoshort.ts`, `src/main/autoShortItemCoordinator.ts`, preload/IPC contracts, `tests/sttn-pipeline.test.ts`.

- [x] Test STTN invokes OCR and removal before burn, passes cleaned video, disables manual/automatic blur, preserves SRT/title/audio, and stops on removal failure.
- [x] Readiness/install delegates to Task 2 only for selected STTN mode. Extend coordinator dependency with optional `removeSubtitles` defaulting to runSttnRemoval.
- [x] Add preview IPC using same worker for a selected short clip and existing media serving/opening patterns; pass normalized ROI, never renderer-provided executables/model paths.
- [x] Run pipeline tests; ensure manual/OCR jobs unchanged.

## Task 4: Python inference and media acceptance

Files: `engines/sttn-engine/{engine,video,inference,masking}.py`, inference-only network and license, requirements/build script, Python tests.

- [x] Write tests for temporal lookup, mask clipping, scene splits, bounded overlapping windows and outside-mask equality; observe failures.
- [x] Pin source/checkpoint provenance. Load weights using safe weights-only loading; select provider by actual probe. Implement inference-only model and real probe.
- [x] Stream decoded frames preserving PTS, mask each frame, process bounded context windows, composite predicted pixels only into mask, encode FFV1 and remux source audio with managed FFmpeg.
- [x] Check disk, drain subprocess output, clean partials, retry CUDA OOM with smaller batches, emit structured errors rather than success on failure.
- [x] Build isolated local runtime and run real checkpoint inference. Compare synthetic/source samples and record timings/quality limitations.

## Task 5: Whole-feature review and verification

- [x] Register tests; run `npm run test:local-runtime`, `npm run test:ocr-engine`, STTN Python suite, `npm run typecheck`, `npm run build`, `git diff --check`.
- [x] Review all new paths, audio/PTS preservation, model/runtime install behavior and preview usability. Correct failures and rerun affected checks.
- [x] Record actual package/model sizes, tested provider, media evidence and remaining release gates. Do not claim hosted downloads are available before publication.

## Execution ledger

- Started: 2026-09-05. Tasks separated by file ownership; parent owns Python/media qualification and whole-feature verification.
- Ruling: keep current feature checkout because new work builds on approved dirty changes from this same conversation; no reset, stash, branch switch or unrelated commit.

- Completed locally: 2026-09-06. All five implementation tasks verified. Managed runtime installed and CUDA-probed; real OCR/STTN preview and cancellation passed. See docs/benchmarks/2026-09-06-sttn-acceptance.md for precise artifacts, sizes, timings, tests and remaining external release/GUI qualification boundaries.
