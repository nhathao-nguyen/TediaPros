# Auto Short Translation Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair Auto Short's source/target/context/cue identity contract, remove hidden language fallbacks and target-specific repairs, improve sanitized diagnostics, retain auditable artifacts, and prove the result through a fresh UI-to-video run.

**Architecture:** Keep the current renderer → preload/IPC → main/worker → local Whisper/translation/TTS → FFmpeg boundaries. All translation contract normalization and timing reconstruction stays in the main process. Do not access or modify `D:\nhathao\codex\tool\tts-server`.

**Spec:** `docs/superpowers/specs/2026-08-29-autoshort-translation-contract-design.md`

## Global constraints

- Preserve unrelated user work; do not reset, clean, commit, push, or rewrite history.
- Never read, write, launch, restart, or automate the `tts-server` repository or UI. Auto Short's configured service call is only exercised through the app UI for the required E2E evidence.
- Never print or save secrets. Keep `lk.bin`, keys, cookies, auth headers, and raw remote response bodies out of logs, tests, reports, and artifacts.
- Production code follows red → green → refactor. One behavior change at a time with focused verification.
- Do not claim PASS from source inspection, unit tests, typecheck, or build alone.

### Task 1: Add failing contract tests

**Files:** `tests/local-runtime.test.ts`, pure contract helper test imports

- [ ] Add tests for explicit source-language precedence and `auto` fallback without script-specific source inference.
- [ ] Add tests that prompt/context construction carries source code, target code, stable cue ids, and neighboring context without target-specific repair instructions.
- [ ] Add tests for response identity validation: complete ids pass; duplicate, missing, unknown, empty, and extra context-only ids fail.
- [ ] Add a source assertion proving Auto Short does not use a Vietnamese TTS fallback.
- [ ] Run `npm.cmd run test:local-runtime` and record the expected RED failure before production edits.

### Task 2: Implement generic translation context and response validation

**Files:** `src/main/translate-shared.ts`, `src/main/localTranslatePolicy.ts`, `src/main/localTranslate.ts`

- [ ] Define the shared context types/helpers and bounded context-window construction from full source cues.
- [ ] Replace local-only positional numbering with stable cue identity and strict response validation.
- [ ] Pass explicit/detected source language into local requests and retain target language from config.
- [ ] Remove the Han-specific repair predicate and any language-specific retry wording; retries must be schema/transport based.
- [ ] Preserve line text and SRT timing while reconstructing translated output in source order.
- [ ] Run focused local runtime tests and refactor only after green.

### Task 3: Update OpenAI/Gemini adapters and Auto Short orchestration

**Files:** `src/main/openai.ts`, `src/main/gemini.ts`, `src/main/autoshort.ts`

- [ ] Add the shared source/target/context contract to OpenAI and Gemini request construction.
- [ ] Validate structured provider ids against the current cue batch and restore source times by id.
- [ ] Propagate Whisper's detected language through `WhisperResult` and the Auto Short extraction path.
- [ ] Resolve translation source language from explicit config, detected Whisper language, or `auto` with no phrase/script guess.
- [ ] Resolve TTS language without a Vietnamese fallback; return a clear sanitized configuration error when unresolved.
- [ ] Improve preflight/item diagnostics with bounded stage labels and preserve the existing public UI error-safety boundary.

### Task 4: Add source-language UI/config and audit artifact retention

**Files:** `src/shared/types.ts`, `src/shared/autoShortContract.ts`, `src/renderer/src/components/AutoShort.tsx`, `src/main/autoshort.ts`, `src/preload/**` only if contract typing requires it

- [ ] Add the source-language selector using the existing supported language catalog and persist it as `whisperLanguage`.
- [ ] Keep old saved configs valid while ensuring the selected source/target values reach the main consumer.
- [ ] Copy source/translated/timed SRT, sanitized TTS timeline, and run manifest to an isolated per-item audit directory under output.
- [ ] Ensure failed runs retain only safe diagnostics and no credentials or raw service payloads.
- [ ] Add deterministic tests for config validation and artifact manifest shape.

### Task 5: Build and parity verification

**Files:** generated `out/`/`dist/` only through the repository build; no hand edits

- [ ] Run `npm.cmd run test:local-runtime`, `npm.cmd run test:subtitles`, `npm.cmd run typecheck`, and `npm.cmd run build` with explicit outputs.
- [ ] Compare source symbols/defaults/contracts against rebuilt `out/`, packaged resources, and package metadata.
- [ ] Confirm the launched runtime uses the current build rather than the pre-existing installed executable; isolate or document any single-instance/profile drift.
- [ ] Record all command results and do not treat stale installed output as current source evidence.

### Task 6: Fresh real UI → backend → media verification

**Files:** fresh isolated output and safe sanitized evidence only

- [ ] Use Computer Use on the Auto Short UI with a fresh isolated output directory and a known source video; do not use the `tts-server` UI.
- [ ] Capture UI selections, queue state, extraction, translation, TTS, timeline, render, and terminal status.
- [ ] Compare every source/translated/timed cue for count, stable identity, preserved start/end, non-empty text, and mapping.
- [ ] Verify TTS clip count, timeline coverage, audio/video duration, codec/container, and output resolution with local ffprobe; inspect/listen only if explicitly available.
- [ ] If a criterion cannot be proven, report `CHƯA XÁC MINH`/`PARTIAL`/`BROKEN`/`BLOCKED` with the exact missing evidence.
