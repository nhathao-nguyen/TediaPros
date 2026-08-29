# Auto Short Cue and Voice E2E Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce the Auto Short cue, timing, voice, and mapping behavior from a clean application profile, fix only proven application defects, and verify the final output against the original video.

**Architecture:** Keep the existing renderer → preload/IPC → main/worker layering. Treat the original Whisper alignment as the source cue baseline, keep translated cue indexes and source timing mapped one-to-one, and generate a full voice timeline without dropping narration. Do not modify, restart, or automate the `tts-server` project or UI.

**Tech Stack:** Electron + React + TypeScript, local Whisper.cpp worker, existing tts-server HTTP client, FFmpeg/ffprobe, Node test runner, Windows Computer Use.

**Spec:** Current user task prompt in this Codex task.

## Global Constraints

- Only modify `D:\nhathao\codex\tool\neeyut-blao` source/tests and generated verification artifacts.
- Never edit, restart, click, or automate `D:\nhathao\codex\tool\tts-server` or its Admin UI.
- Preserve all pre-existing tracked and untracked user changes; review the diff before each source edit.
- Keep the supplied API key out of source files, logs, reports, and final responses.
- Use `C:\Users\PC\Downloads\test\short-test.mp4` as the original input and compare all 56 baseline cues.

---

### Task 1: Establish clean-state baseline and original cue inventory

**Files:**
- Read: `src/main/autoshort.ts`, `src/main/autoShortPolicy.ts`, `src/shared/autoShortContract.ts`, `src/shared/subtitles.ts`, `tests/local-runtime.test.ts`
- Evidence: `C:\Users\PC\Downloads\test\short-test.mp4`, `C:\Users\PC\Downloads\test\autoshort-e2e\diag\daemon-real\short-test.srt`, `C:\Users\PC\Downloads\test\autoshort-e2e\diag\daemon-real\short-test.alignment.json`

- [ ] Record repo status, current app profile contents, existing temp artifacts, original media metadata, 56 baseline cue rows, and voice word timing.
- [ ] Delete only the current app profile's caches/settings/key files, stale Auto Short temp directories, and the old generated `autoshort-e2e` output directory; retain verified dependency binaries/models and the original input video.
- [ ] Build the current checkout and launch the application without touching `tts-server`.
- [ ] Use Windows Computer Use to select the Auto Short page, input video, fresh output folder, translation/TTS settings, and run one real output.
- [ ] Preserve the first-run UI result, output path, logs, generated SRT/alignment/audio artifacts, and exact error text if the run fails.

### Task 2: Add the smallest failing regression test for the observed defect

**Files:**
- Modify: `tests/local-runtime.test.ts`
- Modify: the single source file that owns the proven defect in cue mapping/timeline/rendering

- [ ] Convert the observed mismatch into one deterministic assertion over cue count/order/text/timestamps or voice timeline bounds.
- [ ] Run the targeted test and confirm it fails for the observed reason before changing production code.
- [ ] Do not bundle unrelated renderer, provider, or cleanup changes into the regression test.

### Task 3: Implement and verify one root-cause fix at a time

**Files:**
- Modify: only the source file identified by the trace from Task 2.
- Test: `tests/local-runtime.test.ts` or the existing focused test runner.

- [ ] Implement the minimum change that fixes the failing assertion while preserving source cue order and full translated text.
- [ ] Run the targeted regression test and the full typecheck/runtime/subtitle smoke suite.
- [ ] Rebuild the application so `out/` reflects the current source before the next UI run.
- [ ] Use Computer Use for the next real run and capture a fresh output, not a previous artifact.
- [ ] Re-analyze the output cue-by-cue and repeat this task for each remaining code-fixable mismatch.

### Task 4: Final evidence and bounded completion

**Files:**
- Evidence/report: fresh output directory under `C:\Users\PC\Downloads\test\`

- [ ] Probe original and final video duration/streams with ffprobe.
- [ ] Parse original and final SRT/alignment/timed SRT and compare all cue rows by index, content, start/end, display duration, voice start/end, voice content, and mapping.
- [ ] Measure final audio presence and duration, and inspect representative final frames/audio artifacts.
- [ ] Run the full verification commands again after the last source change.
- [ ] Report each discovered defect, exact source location and reason, every important rerun result, the final 56-row comparison table, and any external blocker with evidence.
