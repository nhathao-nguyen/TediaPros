# Auto Short Source-Anchored Dubbing Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with red → green → refactor verification. Do not commit or push in this run because the user explicitly requested no automatic publication.

**Goal:** Replace the current Auto Short dubbing coordination with a versioned source-anchored `DubbingPlan` that keeps voice and subtitles synchronized, avoids repeated Whisper work, and records honest timing/media evidence.

**Architecture:** Keep `src/main/autoshort.ts` as the job coordinator and move domain rules into focused modules under `src/main/dubbing/`. The plan has one cue per source cue; semantic groups are used only to provide translation context. Actual TTS durations are authoritative, while the predictor selects one locked global pace and bounded local corrections before render.

**Tech Stack:** Electron + React + TypeScript, Node's built-in test runner bundled by esbuild, FFmpeg/ffprobe, existing translation/TTS/Whisper adapters, and Windows Computer Use for the final UI run.

**Spec:** `D:/nhathao/codex/tool/neeyut-blao/docs/superpowers/specs/2026-08-30-autoshort-source-anchored-dubbing-design.md`

## Global Constraints

- Modify only `D:/nhathao/codex/tool/neeyut-blao`; never edit `D:/nhathao/codex/tool/tts-server`.
- Preserve user-owned dirty changes and do not use reset, clean, checkout, commit, push, or installer packaging.
- Keep the existing preview behavior; add only pace selection and necessary progress/metric details.
- Default `paceMode` is `source-adaptive`; `fixed` uses the selected `ttsSpeed`.
- `start` is the source start; `preferredEnd` is the source end; `hardEnd` is next source start minus 500 ms or final video duration minus 120 ms.
- Never move a cue start to the prior audio end, borrow the next cue's protected margin, crop speech, change video speed, extend frames, or reorder scenes.
- Use no filename-, phrase-, language-, or cue-specific timing exceptions and no hardcoded test content in production.
- Use one capability snapshot per job and one TTS request at a time; local audio work may overlap the next request without increasing server concurrency.
- Ordinary TTS subtitles come from the accepted `finalSpokenText` and cue-level audio window; never run Whisper after TTS for this path.
- Rephrase at most once per cue, with at most three alternatives in that request; an unfit cue fails explicitly and cannot publish a successful video.
- Never place the provided API key in source, tests, logs, plans, manifests, screenshots, or command output.

---

### Task 1: Establish baseline evidence and red behavioral contract tests

**Files:**
- Create: `tests/dubbing-plan.test.ts`
- Modify: `scripts/run-local-runtime-tests.mjs`
- Inspect only: current `src/main/autoshort.ts`, `src/main/autoShortPolicy.ts`, `src/main/dubbing/plan.ts`, `src/main/dubbingDuration.ts`

**Interfaces:**
- Tests will call pure exports from `src/main/dubbing/plan.ts`, `src/main/dubbing/policy.ts`, `src/main/dubbing/durationPredictor.ts`, `src/main/dubbing/cache.ts`, and `src/main/dubbing/subtitles.ts`.
- The test runner must bundle `tests/dubbing-plan.test.ts` with the existing runtime suites.

- [ ] **Step 1: Capture read-only baseline state**

Run:

```powershell
git status --short --branch
git rev-parse HEAD
git diff --check
```

Record that the checkout is at `5dd11dd` with existing Auto Short modifications. Do not discard them. Verify `D:\nhathao\codex\tool\tts-server` status/HEAD only and do not modify it.

- [ ] **Step 2: Add behavior-first tests before new implementation**

Add tests covering:

```ts
test('builds source-anchored plan windows without cumulative start drift', () => {
  const plan = buildDubbingPlan({
    version: 1,
    videoDuration: 20,
    paceMode: 'source-adaptive',
    cues: [
      { id: 's1', start: 10, end: 12, text: 'one' },
      { id: 's2', start: 13, end: 15, text: 'two' },
      { id: 's3', start: 16, end: 18, text: 'three' }
    ]
  })
  assert.deepEqual(plan.cues.map((cue) => cue.sourceStart), [10, 13, 16])
  assert.deepEqual(plan.cues.map((cue) => cue.hardEnd), [12.5, 15.5, 19.88])
})

test('allows a voice cue to use the gap but never the protected margin', () => {
  const window = deriveDubbingWindow({ id: 's1', start: 10, end: 12 }, 14, 20)
  assert.equal(window.start, 10)
  assert.equal(window.preferredEnd, 12)
  assert.equal(window.hardEnd, 13.5)
})

test('predictor profile is isolated by effective TTS configuration', () => {
  const first = durationProfileKey({ endpoint: 'http://a', model: 'm1', voice: 'v1', language: 'vi', options: {}, referenceAudio: null })
  const second = durationProfileKey({ endpoint: 'http://a', model: 'm2', voice: 'v1', language: 'vi', options: {}, referenceAudio: null })
  assert.notEqual(first, second)
})

test('ordinary TTS subtitle is exactly final spoken text and uses cue-level timing', () => {
  const subtitle = buildDubbingSubtitle({ id: 's1', finalSpokenText: 'Câu cuối', start: 10, end: 13.2 })
  assert.deepEqual(subtitle, [{ id: 's1-subtitle', sourceIndex: 1, start: 10, end: 13.2, text: 'Câu cuối' }])
})

test('plan validation rejects source drift, overlap, hard-end overflow, and text mismatch', () => {
  const result = validateDubbingPlan(invalidPlanFixture())
  assert.equal(result.ok, false)
  assert.ok(result.violations.some((message) => message.includes('s2')))
})
```

Use generated cue fixtures with no real video text; fixture values test policy behavior only and do not enter production code.

- [ ] **Step 3: Run the focused suite and verify RED**

Run: `npm.cmd run test:local-runtime`

Expected: the new bundled test file fails because the new plan/policy/predictor/cache/subtitle exports do not yet exist or return the required behavior. Existing suites must be distinguished from the new failure in the output.

- [ ] **Step 4: Add the test entry point only**

Modify `scripts/run-local-runtime-tests.mjs` so the existing `build({ entryPoints })` list includes `tests/dubbing-plan.test.ts` and the spawned test result is included in the final non-zero condition. Do not alter production behavior in this step.

### Task 2: Implement the versioned plan and timing policy

**Files:**
- Modify: `src/main/dubbing/plan.ts`
- Create: `src/main/dubbing/policy.ts`
- Modify: `src/main/autoShortPolicy.ts` only as a compatibility re-export or removal of duplicated policy logic
- Modify: `tests/dubbing-plan.test.ts`
- Modify: `tests/autoshort-comprehensive-windows.test.ts`
- Modify: `tests/e2e-autoshort.test.ts`

**Interfaces:**
- `DubbingPlan` and `DubbingPlanCue` are the sole shared plan types for translation, TTS, subtitles, and render diagnostics.
- `buildDubbingPlan(input): DubbingPlan` creates one cue per source cue with stable IDs and derived `preferredEnd`/`hardEnd`.
- `deriveDubbingWindow(cue, nextStartOrVideoEnd, videoDuration): DubbingWindow` returns `{ start, preferredEnd, hardEnd, availableDuration }` or throws an error containing the cue ID.
- `selectSourceAdaptivePace(estimates, windows): number` returns a weighted median ratio clamped to `0.9..1.25`.
- `selectFixedPace(ttsSpeed): number` returns the validated selected speed without source-dependent adjustment.
- `planDubbingAudioWindows(cues, naturalDurations, options): DubbingTimingPlan` keeps starts source-anchored and applies local corrections only within `±0.03` of the locked baseline and the adjacent-change limit.
- `validateDubbingPlan(plan): { ok: boolean; violations: string[] }` checks identity, source anchors, hard ends, overlap, pace bounds, and subtitle/final-text equality.

- [ ] **Step 1: Implement the minimal source-window and plan builder**

Use the source cue's exact `start` and `end`; derive non-final hard end as `next.start - 0.5` and final hard end as `videoDuration - 0.12`. Throw `Cue <id> has no usable dubbing window` when `hardEnd <= start`. Keep `preferredEnd` unchanged even if it is later than `hardEnd`.

- [ ] **Step 2: Run plan tests and make the window tests green**

Run: `npm.cmd run test:local-runtime`

Expected: window identity and gap behavior pass; pace/validation tests remain red.

- [ ] **Step 3: Implement locked pace selection and bounded local fitting**

Use only predicted duration divided by each cue's available source window for adaptive selection. Do not use prior voice end to calculate any later source start. If a natural duration cannot fit at the locked pace plus the local correction, return an explicit cue error rather than cutting or moving it.

- [ ] **Step 4: Implement plan validation and regression cases**

Add cases for source starts `[10, 13, 16]`, a 10–12 cue extending to 13.2 when the next cue starts at 14, early audio completion not moving the next start, predictor under/over-estimation without overlap, a final 120 ms guard, and impossible windows. Assert behavior using numeric plan fields rather than source-string searches.

- [ ] **Step 5: Keep old imports compatible while eliminating duplicate rules**

Update `src/main/autoShortPolicy.ts` to re-export the new pure policy functions/constants or route existing callers through the new module. There must be one definition for the 500 ms protected gap, 120 ms final guard, pace bounds, local adjustment, and adjacent-change policy.

### Task 3: Implement the lightweight predictor and versioned cache

**Files:**
- Create: `src/main/dubbing/durationPredictor.ts`
- Create: `src/main/dubbing/cache.ts`
- Modify: `src/main/dubbingDuration.ts` to re-export the new predictor for existing callers or remove duplicate implementation
- Modify: `src/main/autoshort.ts` imports only after the new module is tested
- Modify: `tests/dubbing-plan.test.ts`
- Modify: `tests/autoshort-comprehensive-windows.test.ts`

**Interfaces:**
- `extractDurationFeatures(text, locale): DurationFeatures` uses graphemes, `Intl.Segmenter` word units, numerals, abbreviations, and pause punctuation.
- `createDurationPredictor(initialProfile?): DurationPredictor` exposes `estimate(text, options)` and `addSample(text, seconds, locale)`; all learned coefficients are non-negative and regularized.
- `durationProfileKey(input): string` fingerprints endpoint, model, effective voice, language, normalized options, and reference-audio identity/content metadata without including credentials.
- `selectBootstrapCues(cues, max=3): SourceCue[]` selects at most three real job cues with the greatest useful length diversity; it never creates synthetic sample text.
- `buildTtsCacheKey(input): Promise<string>` returns a versioned digest of final text and all effective voice settings.

- [ ] **Step 1: Add predictor feature and profile tests**

Assert grapheme and word counts work for Vietnamese/CJK/Latin inputs, `Intl.Segmenter` is used when available with a deterministic fallback, coefficients cannot be negative, uncertainty is non-zero before three samples, and residual metrics update after measured durations.

- [ ] **Step 2: Run predictor tests and verify RED**

Run: `npm.cmd run test:local-runtime`

Expected: the new behavior fails before implementation; no server request is made.

- [ ] **Step 3: Implement non-negative ridge fitting and job-local updates**

Keep the regression small and deterministic. Treat each measured post-silence-trim duration as a real sample. Never use the profile as proof that audio fits; callers must probe every generated clip.

- [ ] **Step 4: Implement profile/cache fingerprints**

Normalize object keys recursively before hashing. Include cache schema version, endpoint, model, voice, language, server speed, options, reference transcript, and a reference-audio content/stat fingerprint. Exclude API keys and raw response content. Wrong model/voice/language/options/reference audio must produce different keys.

- [ ] **Step 5: Run focused tests and refactor while green**

Run: `npm.cmd run test:local-runtime`.

### Task 4: Make translation consume and populate the plan without losing cue IDs

**Files:**
- Create: `src/main/dubbing/translation.ts`
- Modify: `src/main/translate-shared.ts`
- Modify: `src/main/localTranslate.ts`
- Modify: `src/main/openai.ts`
- Modify: `src/main/gemini.ts`
- Modify: `src/main/autoshort.ts`
- Modify: `tests/dubbing-plan.test.ts`
- Modify: `tests/local-runtime.test.ts`

**Interfaces:**
- `buildDubbingTranslationRequest(plan, allCues, contextRadius): string` includes group context, current cue IDs, source text, cue durations, and target-language instructions; context is explicitly read-only.
- `applyTranslations(plan, items): DubbingPlan` updates only `translatedText` by stable ID and preserves source starts/ends/IDs.
- `requestDubbingRephrases(plan, cueId, budget): Promise<string[]>` returns at most three alternatives for one cue in one bounded supplemental request.

- [ ] **Step 1: Add stable-ID and context tests**

Assert three source cues remain three plan cues after a semantic group translation, context cue IDs cannot be accepted as output, rephrase alternatives retain the same source ID, and a rephrase updates the plan's final text source.

- [ ] **Step 2: Run translation tests and verify RED**

Run: `npm.cmd run test:local-runtime`

Expected: new plan-mapping assertions fail against the existing provider-specific path.

- [ ] **Step 3: Consolidate provider-neutral request construction**

Route all providers through the shared request builder. Keep provider response parsing and schema validation, require exactly one current cue ID per output, and reapply source SRT timings locally. Do not allow groups to collapse or alter plan identity.

- [ ] **Step 4: Bound text fitting to one round**

After pace selection, evaluate predicted duration against each cue's permitted window. Request up to three concise alternatives for an over-budget cue once, choose by predictor without sacrificing meaning constraints, and write the selected text into both the plan and later TTS request. Do not loop translation and synthesis indefinitely.

- [ ] **Step 5: Run translation/runtime tests and inspect logs for secrets**

Run: `npm.cmd run test:local-runtime` and scan only sanitized test output for the key pattern. No raw authorization header or credential value may appear.

### Task 5: Replace the current TTS branch with plan-driven bounded synthesis

**Files:**
- Create: `src/main/dubbing/synthesis.ts`
- Create: `src/main/dubbing/subtitles.ts`
- Create: `src/main/dubbing/manifest.ts`
- Modify: `src/main/autoshort.ts`
- Modify: `src/main/tts.ts` only where required to expose existing request behavior without changing the server contract
- Modify: `tests/dubbing-plan.test.ts`
- Modify: `tests/autoshort-comprehensive-windows.test.ts`

**Interfaces:**
- `synthesizeDubbingPlan(input): Promise<SynthesisResult>` accepts a plan, effective model/voice config, TTS adapter, ffmpeg adapter, and abort signal; it returns the updated plan, reusable clips, cue-level subtitles, sanitized metrics, and artifact entries.
- `buildDubbingSubtitle({ id, finalSpokenText, start, end }): SubtitleCue[]` creates one cue-level subtitle window with the exact final text.
- `validateAcceptedClip({ text, path, duration, window }): void` rejects corrupt/empty audio and hard-end overflow without truncating.
- `buildDubbingManifest(plan, metrics): object` emits only sanitized plan/timing/metric data.

- [ ] **Step 1: Add fake-adapter behavior tests**

Use deterministic in-memory TTS/ffmpeg adapters in tests only. Test one request in flight, reuse of the first three real cue clips, measured duration after trim, no overlap, a clip that ends early without shifting the next start, one rephrase attempt, and explicit failure when the replacement remains over `hardEnd`.

- [ ] **Step 2: Run synthesis tests and verify RED**

Run: `npm.cmd run test:local-runtime`

Expected: the new synthesis behavior fails before wiring the coordinator to the new modules.

- [ ] **Step 3: Implement sequential server requests with local overlap**

Use a single TTS request promise at a time. Probe every response with ffprobe, trim only true outer silence using the existing conservative policy, update the predictor, and schedule by the immutable source start. Keep local tempo processing independent so it can run while the next server request is pending, but do not start a second server request.

- [ ] **Step 4: Apply pace exactly once and build subtitles from final text**

For source-adaptive mode, request at standard speed and apply the locked pace once in local audio processing. For fixed mode, use the selected `ttsSpeed` as the baseline. Apply only the bounded local adjustment. Build subtitle windows from actual accepted audio duration, clamp only to `hardEnd`, and never invoke Whisper after TTS.

- [ ] **Step 5: Enforce one rephrase and complete artifact data**

If the first measured clip cannot fit, request alternatives once, synthesize at most one replacement, validate its actual duration/completeness, and replace both plan text and subtitle text together. Write `dubbing-plan.json`, `dubbing-units.json`, `final-spoken-text.json`, `timed.srt`, and `tts-timeline.json` with source window, voice window, subtitle window, pace, rephrase, split, fit-first-pass, and predictor metrics. Do not copy raw request payloads.

- [ ] **Step 6: Run synthesis tests and refactor while green**

Run: `npm.cmd run test:local-runtime`.

### Task 6: Integrate the coordinator, capability snapshot, checkpoint policy, and real stream probing

**Files:**
- Modify: `src/main/autoshort.ts`
- Modify: `src/main/burn.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/autoShortContract.ts`
- Modify: `src/renderer/src/components/AutoShort.tsx`
- Modify: `src/renderer/src/styles/autoshort.css` only for the new pace/progress controls
- Modify: `tests/autoshort-comprehensive-windows.test.ts`
- Modify: `tests/local-runtime.test.ts`

**Interfaces:**
- `AutoShortConfig.paceMode` migrates missing legacy values to `source-adaptive` and validates `fixed | source-adaptive`.
- `AutoShortProgress` exposes phase, cue progress, locked pace, fit-first-pass count, rephrase count, and predictor residual only as optional sanitized fields.
- `probeBurnMedia`/output probe returns independent format, video-stream, and audio-stream `duration` and `start_time` fields.

- [ ] **Step 1: Add contract/probe/UI source tests**

Assert legacy config migration defaults to source-adaptive, invalid pace modes fail, timing checkpoints are not reused, stream metadata does not assign video duration to audio, renderer keeps the existing preview source behavior, and progress fields are optional/backward-compatible.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm.cmd run test:local-runtime`

Expected: at least the checkpoint/probe/progress assertions fail before coordinator integration.

- [ ] **Step 3: Integrate plan-driven stages**

Keep extraction and existing preview intact. After source extraction, create a fresh plan and use only valid source/translation checkpoint data; always derive fresh timing and pacing. Query TTS capability once for the job and pass the snapshot to synthesis. Leave existing renderer-side capability loading as a config-change lookup, but disable or deduplicate it while a job is active.

- [ ] **Step 4: Preserve no-TTS word effects and remove TTS Whisper path**

When TTS is enabled, render `timed.srt` from plan subtitles and do not call `transcribeAudio` again. When TTS is disabled, preserve the existing word-effect path and source word timing behavior.

- [ ] **Step 5: Add pace selection and progress UI without changing preview**

Keep the existing input-video preview expression and behavior. Add a persisted pace selector with source-adaptive default and fixed option, plus progress text for current stage/cue and sanitized metric summaries. Do not make the output file the automatic preview source.

- [ ] **Step 6: Validate output independently per stream**

Probe the actual output with stream-level `duration` and `start_time`, require decode success, H.264/AAC-compatible streams, expected dimensions/FPS, and video duration within one 30 fps frame of the source. Delete an invalid output and return an error status.

- [ ] **Step 7: Run all local gates**

Run:

```powershell
npm.cmd run test:local-runtime
npm.cmd run test:subtitles
npm.cmd run typecheck
git diff --check
npm.cmd run build
```

All commands must be freshly run after the final source change; record exit codes and test counts.

### Task 7: Execute real UI/media verification and reconcile any failure with a regression test

**Files:**
- Runtime only: a new output directory under `C:\Users\PC\Downloads\test\autoshort-source-anchored-<timestamp>`
- Runtime only: sanitized artifact directories and reports
- Source changes only if a failing gate is reproduced by a new test first

**Interfaces:**
- UI must use the built application and the existing secure key/configuration path; no private request script or hardcoded credential is allowed.
- Reports must include source/output probe data and timing metrics without secrets.

- [ ] **Step 1: Attempt clean baseline from `HEAD 5dd11dd` without altering the dirty worktree**

Use an isolated temporary checkout or equivalent read-only source snapshot to launch the baseline UI. If the external service/runtime prevents the run, record the exact blocker and continue local verification; do not reset the shared worktree.

- [ ] **Step 2: Launch the fresh built app with Computer Use**

Use the `computer-use:computer-use` skill. Import `C:\Users\PC\Downloads\test\short-test.mp4`, use source auto-detection, select Vietnamese translation and a capability-supported voice, choose source-adaptive pace, run the job, follow extraction → translation → TTS → audio processing → rendering, and open the actual output file from the UI. Never treat `Done` or a preview overlay as output evidence.

- [ ] **Step 3: Validate source and output media**

Use ffprobe on the supplied input and the actual output. Confirm source/output duration, dimensions, FPS, codecs, stream start times, decode success, cue count/IDs, no voice overlap, no hard-end violation, subtitle/final-text equality, and output duration within one frame. Inspect beginning-of-cue timing, scene transitions, the longest cue, and the final cue.

- [ ] **Step 4: Run 1.25x and 0.8x source copies in a new directory**

Create copies or derived test inputs without modifying `short-test.mp4`. Run both through the same UI path or an explicitly equivalent real path, and record whether adaptive pace remains locked per job and source anchors remain intact.

- [ ] **Step 5: Reconcile failures test-first**

For each failure, add the smallest behavioral regression test, verify it fails before the fix, implement the scoped fix, rerun focused tests, typecheck, build, and the affected UI/media gate. Do not add a filename/language/phrase exception.

- [ ] **Step 6: Final evidence review**

Re-run the complete local gate set after the last source change. Report `PASS` only when real output and all timing/media gates are evidenced. Otherwise report `PARTIAL` or `BLOCKED` with exact failed command, artifact, and external dependency condition. Do not commit or push.
