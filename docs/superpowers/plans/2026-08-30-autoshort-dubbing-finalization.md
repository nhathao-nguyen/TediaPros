# Auto Short Dubbing and Subtitle Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Auto Short produce duration-aware Vietnamese dubbing whose final spoken text, subtitles, and rendered timeline stay semantically complete and synchronized in a real UI run.

**Architecture:** Preserve the renderer → preload/IPC → main-process extraction/translation/TTS → FFmpeg boundary. Translation providers will receive bounded semantic-group context and speaking budgets while still returning one stable translation per source cue. The main process will use the resulting grouped target text as the sole TTS/subtitle source, plan each unit against its own effective source window without estimated cumulative starts, and retain sanitized artifacts for validation.

**Tech Stack:** Electron + React + TypeScript, local Whisper/OCR, configured translation/TTS HTTP services, FFmpeg/ffprobe, Node test runner with the existing esbuild test harness, and Windows Computer Use for the final UI path.

**Spec:** `C:\Users\PC\.codex\attachments\fc1b219e-4317-40c1-bbd9-2182acae2aa3\goal-objective.md`

## Global Constraints

- Work directly in `D:\nhathao\codex\tool\neeyut-blao`; preserve unrelated changes and do not edit `tts-server`.
- Never hard-code or print the API key; enter it only through the real Auto Short UI/configuration during E2E.
- Keep language, provider, model, voice, and endpoint resolution dynamic; do not add filename-, phrase-, cue-count-, timestamp-, or language-specific repairs.
- Use duration-aware translation before TTS, bounded fitting, at most one rephrase per synthesized unit, and structural split only as a final fallback.
- Never crop phonemes or speech; trim only true outer silence and preserve a safe trailing margin.
- Do not claim PASS from tests, build, or UI completion alone; validate source and output media artifacts and synchronization metrics.
- Run production changes through red → green → refactor tests and use fresh verification before any completion claim or commit.

---

### Task 1: Add duration-aware semantic translation contract and prompt tests

**Files:**
- Modify: `src/main/translate-shared.ts`
- Modify: `src/main/localTranslate.ts`
- Modify: `src/main/openai.ts`
- Modify: `src/main/gemini.ts`
- Test: `tests/local-runtime.test.ts`

**Interfaces:**
- `buildTranslationBatches(cues, maxChars?)` returns `SrtBlock[][]` with semantic groups kept intact until a group itself must be split.
- `buildDubbingTranslationPayload(batch, allCues, contextRadius?)` returns a provider-neutral payload containing current cue ids, source text, cue durations, semantic-group text/duration, and bounded read-only neighboring context.
- Existing provider `translateSrt` functions continue returning one `{ id, t }` translation per current cue and continue restoring SRT timing locally.

- [ ] **Step 1: Write failing tests**

Add pure assertions to `tests/local-runtime.test.ts` for a multi-cue sentence: the generated dubbing payload includes the semantic-group duration, every current stable cue id, neighboring context only in a context section, and instructions for concise spoken target-language phrasing that preserve meaning. Add a batching assertion that a group is not split at a normal provider batch boundary.

- [ ] **Step 2: Run the focused test file and verify RED**

Run: `npm.cmd run test:local-runtime`

Expected: the new helper imports or assertions fail because group payload/batching helpers do not exist yet; existing tests remain the only passing tests.

- [ ] **Step 3: Implement the shared helpers and prompt contract**

In `src/main/translate-shared.ts`, build semantic groups from the full cue list, batch whole groups within `MAX_CHARS`, and format a provider-neutral payload. Update `huongDan(..., { mode: 'dubbing' })` to explicitly require spoken, concise, natural target-language wording, complete meaning, no hallucination, and a speaking-duration budget without demanding destructive shortening. Keep context cues read-only and instruct providers to return only current cue ids.

- [ ] **Step 4: Route all three providers through the same group-aware payload**

Use the helper in OpenAI, Gemini, and local translation adapters. Keep their response schema parsing and `validateTranslationItems` checks unchanged in spirit: current batch ids only, no context ids, no missing/duplicate/empty items. Preserve source SRT order and `start`/`end` from the input when writing the result. Retain local bounded transport/schema retries and semantic fallback splitting.

- [ ] **Step 5: Run focused tests and refactor only while green**

Run: `npm.cmd run test:local-runtime`

Expected: all existing tests plus the new prompt/group-contract tests pass with no credential or raw response output.

- [ ] **Step 6: Commit the independently testable translation slice**

Run:

```powershell
git add src/main/translate-shared.ts src/main/localTranslate.ts src/main/openai.ts src/main/gemini.ts tests/local-runtime.test.ts
git commit -m "fix: make Auto Short translation duration aware"
```

Before committing, run `git diff --check` and confirm only these paths are staged.

### Task 2: Replace estimated timeline propagation with effective-window planning

**Files:**
- Modify: `src/main/autoShortPolicy.ts`
- Test: `tests/autoshort-comprehensive-windows.test.ts`
- Test: `tests/local-runtime.test.ts`

**Interfaces:**
- `planAutoShortVoiceTimeline(cues, naturalDurations, videoDuration, maxTempo)` continues returning `AutoShortVoiceTimelinePlan`.
- Each `AutoShortVoiceCuePlan.start` is anchored to the cue’s effective source start unless the input source windows themselves overlap; `availableDuration` is calculated from that unit’s own safe end and video boundary.
- `tempo`, `plannedDuration`, `voiceEnd`, `semanticOverflowMs`, and slack metrics describe the actual per-unit plan, never a preliminary estimated start.

- [ ] **Step 1: Write the regression test first**

Add a case with a first cue that needs near-hard-limit tempo and a following cue whose source start is close enough that using the first natural/estimated duration would shift it. Assert that every planned start remains within a small tolerance of its source start, no unit overlaps the prior voice, and the plan either fits at the selected hard tempo or reports an impossible timeline without cropping.

- [ ] **Step 2: Run the new test and verify RED**

Run: `npm.cmd run test:local-runtime`

Expected: the new no-cumulative-drift assertion fails against the current `prevEnd`/`estimatedStepDuration` first pass or the test exposes a plan that shifts a later start beyond its source anchor.

- [ ] **Step 3: Implement the minimal planner fix**

Remove the preliminary `prevEnd` estimate and the whole-video `roughGlobalRatio` start propagation. Derive each safe window from its raw source start, raw end, next source start minus `AUTO_SHORT_TTS_MIN_GAP_SECONDS`, and the last-video end guard. Choose the robust global baseline from required per-window tempos, then apply `max(globalTempo, requiredLocalTempo)` capped at the requested hard ceiling. Keep starts anchored, reject an actually impossible unit, and compute subtitle anchors from the source window.

- [ ] **Step 4: Strengthen policy assertions for no crop and no overlap**

Extend deterministic tests for: normal units staying at 1.0x, slightly overlong units using only local tempo, hard-tempo ceilings, gaps not being borrowed, final video guard, and impossible single-cue behavior. Do not add an output-file crop fallback.

- [ ] **Step 5: Run the focused suite and refactor**

Run: `npm.cmd run test:local-runtime`

Expected: all timeline, grouping, subtitle, and existing runtime tests pass.

- [ ] **Step 6: Commit the planner slice**

Run:

```powershell
git add src/main/autoShortPolicy.ts tests/autoshort-comprehensive-windows.test.ts tests/local-runtime.test.ts
git commit -m "fix: anchor Auto Short voice to effective cue windows"
```

### Task 3: Enforce final target text, bounded fitting, and semantic validation

**Files:**
- Modify: `src/main/autoshort.ts`
- Modify: `src/main/autoShortPolicy.ts`
- Test: `tests/autoshort-comprehensive-windows.test.ts`
- Test: `tests/local-runtime.test.ts`

**Interfaces:**
- `synthesizeVoice` returns `dubbingUnits`, `targetGroupInputs`, `sourceGroupInputs`, diagnostics, and timed subtitles derived from the same `finalSpokenText` used in the accepted TTS request.
- `validateAutoShortTimelineSync` rejects source/target group anchor drift, speech outside its semantic source window, voice overlap, subtitle/voice mismatch, and final text/subtitle mismatch.
- The existing trim, tempo, one-rephrase, and multi-cue structural split policies remain bounded and never trim speech content.

- [ ] **Step 1: Add failing invariant tests**

Add tests that construct a modern `AutoShortDubbingUnit` and verify validation fails when final voice extends beyond its source group, units overlap, subtitle text differs from `finalSpokenText`, or target group anchors differ from source anchors. Add a test that a valid unit with a slight tempo fit passes and does not require rephrase behavior in the orchestration source.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm.cmd run test:local-runtime`

Expected: the new violations are not reported by the current modern validation path, which currently ignores the source/target group arguments and checks only a subset of unit fields.

- [ ] **Step 3: Implement minimal validation and orchestration changes**

In modern validation, consume the supplied source and target group arrays, compare ids and anchors, check unit voice bounds/overlap/tempo, and require normalized subtitle text to equal normalized final text. In synthesis, retain the group’s translated text as the initial final target, use it for the first TTS request and generated subtitles, rephrase at most once only when natural duration exceeds the normal tempo allowance, validate the replacement audio duration/content plausibility, and use the replacement text for both TTS and subtitles. Keep structural split as the bounded fallback for overlong multi-cue groups.

- [ ] **Step 4: Add explicit diagnostic fields and safe artifacts**

Ensure `dubbing-units.json`, `final-spoken-text.json`, `timed.srt`, and `tts-timeline.json` expose final text, source window, voice window, subtitle window, tempo, rephrase, and split outcomes without API keys or raw service payloads. Record split/rephrase counts in the sanitized timeline manifest when available.

- [ ] **Step 5: Run focused tests and refactor while green**

Run: `npm.cmd run test:local-runtime`

Expected: all focused tests pass and no log/test output contains the supplied key or authorization material.

- [ ] **Step 6: Commit the invariant slice**

Run:

```powershell
git add src/main/autoshort.ts src/main/autoShortPolicy.ts tests/autoshort-comprehensive-windows.test.ts tests/local-runtime.test.ts
git commit -m "fix: keep Auto Short voice and subtitles on final text"
```

### Task 4: Make the real Auto Short UI preview the rendered artifact

**Files:**
- Modify: `src/renderer/src/components/AutoShort.tsx`
- Test: `tests/local-runtime.test.ts`

**Interfaces:**
- The selected preview source is `selectedTask.outputPath || selectedTask.filePath`.
- Existing queue output/open behavior, task state, and Auto Short config contract remain intact.

- [ ] **Step 1: Write the failing source-level regression assertion**

Add a test that reads the Auto Short component and asserts the preview transport and `<video>` source can resolve to `outputPath` after a successful item result rather than always using only `filePath`.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd run test:local-runtime`

Expected: the assertion fails because both current preview references use `selectedTask.filePath` unconditionally.

- [ ] **Step 3: Implement the smallest UI change**

Introduce one `previewPath` expression and use it in `useVideoTransport` and the preview `<video src>`. Preserve input-video preview before completion and switch automatically after `outputPath` is stored by the existing event handler.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm.cmd run test:local-runtime` and `npm.cmd run typecheck`.

Expected: all tests pass and both TypeScript projects typecheck successfully.

### Task 5: Full focused verification, build, and real UI/media loop

**Files:**
- Build outputs: `out/**`, `dist/**` only through the build commands.
- Runtime evidence: a fresh isolated output directory under `C:\Users\PC\Downloads\test\` and its sanitized `.autoshort-audit-*` artifacts.
- Do not hand-edit generated output or add credentials to any artifact.

- [ ] **Step 1: Run all focused static and smoke gates**

Run:

```powershell
npm.cmd run test:local-runtime
npm.cmd run test:subtitles
npm.cmd run typecheck
git diff --check
```

Expected: exit code 0 for every command, with the complete focused test counts recorded.

- [ ] **Step 2: Build the current Windows application**

Run: `npm.cmd run build`

Expected: Electron-Vite produces a fresh `out/` build with exit code 0. Record build timestamps and verify source/build parity for changed symbols.

- [ ] **Step 3: Launch and operate the real UI with Computer Use**

Use the `computer-use:computer-use` skill to open TediaPros, open Auto Short, add `C:\Users\PC\Downloads\test\test-30s.mp4`, select a fresh output directory, choose the real subtitle/transcript method and detected/source language, choose Vietnamese target, enable TTS, choose a dynamically available Vietnamese model/voice, enter the provided API key through the visible configuration field, click Run, and observe extraction → translation → TTS → stitching → rendering → done. Never bypass the UI with an internal API or hard-code the test config.

- [ ] **Step 4: Validate the original video with real media tools**

Use FFprobe and available local Whisper/source artifacts to record duration, stream metadata, source language/transcript summary, cue count/timing, speech regions, pauses, and semantic sections. Keep any output report sanitized.

- [ ] **Step 5: Validate the rendered output artifact**

Confirm the exact output file exists, decodes, contains video and Vietnamese audio, has a plausible duration and expected container/codec, and has the copied source/translated/timed SRT, TTS timeline, dubbing units, and sanitized manifest. Play/open the output from the UI and inspect the actual rendered preview.

- [ ] **Step 6: Compute synchronization and content metrics**

From `dubbing-units.json`, `tts-timeline.json`, and timed subtitles calculate max/average voice-vs-source offset, max/average subtitle-vs-voice offset, max/average tempo, rephrase count, split count, no-overlap count, and source/target cue identity/count preservation. Compare source meaning → Vietnamese subtitle → Vietnamese voice. If final Vietnamese ASR is available locally, use it only as post-render validation.

- [ ] **Step 7: Iterate on evidence, not symptoms**

If any quality gate fails, read the relevant artifact/log and source boundary, write a regression test first, make one scoped fix, rerun the focused suite/build/UI/media checks, and repeat. Continue until the output satisfies the objective or a verified external service/runtime blocker remains after safe retries.

- [ ] **Step 8: Final verification and commit**

Run the complete verification commands again after the last source change, inspect `git diff --check`, confirm the staged diff contains only scoped Auto Short changes and the plan/evidence files, then commit the exact tested source with a descriptive message. Report `PASS` only if the real UI-generated video and artifact analysis satisfy every required quality gate; otherwise report `PARTIAL` or `BLOCKED` with concrete evidence.
