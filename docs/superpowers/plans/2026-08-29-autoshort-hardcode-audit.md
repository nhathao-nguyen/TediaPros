# Auto Short Hard-Code and Runtime Parity Audit Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trace every Auto Short configuration from renderer state through preload/IPC, main/worker services, and final media output; classify intentional constants, valid defaults, hidden fallbacks, user-setting overwrites, stale artifacts, and secrets with reproducible evidence.

**Architecture:** Preserve the existing renderer → preload/IPC → main/worker → local engine/service → subtitle/audio/video pipeline. Read and test only `D:\nhathao\codex\tool\neeyut-blao`; do not read, write, launch, restart, or automate `tts-server`. Apply only targeted fixes inside this repository when a runtime-impacting defect is proven.

**Tech Stack:** Electron + React + TypeScript, Electron-Vite, local Whisper/OCR assets, local translation policy, TTS HTTP client boundary, FFmpeg/ffprobe, Node test scripts, and Windows packaged output.

**Spec:** Current user task prompt in this Codex task.

## Global Constraints

- Preserve all pre-existing tracked and untracked changes in `D:\nhathao\codex\tool\neeyut-blao`; do not reset, clean, commit, push, or rewrite history.
- Never access `D:\nhathao\codex\tool\tts-server` or its UI/processes; report that boundary as out of scope.
- Never print or save secrets; if a credential pattern is detected, report only file, line, key name, and a masked value.
- Do not call a string a runtime hard-code until a caller/consumer or safe runtime test proves reachability and effect.
- Do not claim PASS from grep, typecheck, build, or an isolated API; distinguish source, `out/`, package, installed runtime, and real media evidence.
- Do not delete app profiles, caches, generated media, binaries, or user data during this audit.

---

### Task 1: Establish repository, source, build, package, and test inventory

**Files:**
- Read: `package.json`, `electron-builder.yml`, `electron.vite.config.ts`, `tsconfig*.json`
- Read: `src/main`, `src/preload`, `src/shared`, `src/renderer/src`, `scripts`, `tests`
- Read: `out`, `dist`, `resources`, and `engines` only within this repository

- [ ] Record absolute repository path, branch, HEAD, dirty paths, timestamps, package version, build scripts, and existing audit/test artifacts.
- [ ] Enumerate Auto Short entrypoints, all `window.api` methods, IPC handlers, main/worker calls, persistence keys, and package resource mappings.
- [ ] Record source/output/package file timestamps and hashes for `autoshort`, `whisper`, `ocr`, `localTranslate`, `localTranslatePolicy`, `autoShortAlignment`, `autoShortContract`, preload, and the Auto Short renderer.
- [ ] Run safe baseline commands that do not contact `tts-server`: `npm.cmd run typecheck`, `npm.cmd run test:subtitles`, and focused local policy/contract tests available in `tests`.

### Task 2: Build the complete Auto Short configuration and data-flow matrix

**Files:**
- Read: `src/renderer/src/components/AutoShort.tsx`, `src/renderer/src/lib/persist.ts`, `src/renderer/src/lib/outputDir.ts`
- Read: `src/preload/index.ts`, `src/preload/index.d.ts`, `src/main/index.ts`
- Read: `src/shared/autoShortContract.ts`, `src/shared/types.ts`
- Read: `src/main/autoshort.ts`, `src/main/autoShortPolicy.ts`, `src/main/whisper.ts`, `src/main/ocr.ts`, `src/main/localTranslate.ts`, `src/main/localTranslatePolicy.ts`, `src/main/tts.ts`, `src/main/burn.ts`, `src/main/subtitlePlanner.ts`
- Read: `src/shared/autoShortAlignment.ts`, `src/shared/subtitles.ts`, `src/shared/subtitleLayout.ts`, `src/shared/subtitleEffects.ts`

- [ ] For each language/provider/model/voice/URL/header/credential, timing, retry, concurrency, OCR, Whisper, subtitle, font, resolution, codec, path, and engine setting, record default, UI key, IPC field, main consumer, service call, fallback/overwrite, and observable output.
- [ ] Classify every value as intentional constant, valid default, user-setting overwrite, hidden fallback, test-only value, stale build/package value, or sensitive value.
- [ ] Verify renderer-only settings are present in `AutoShortConfig`, validated by `validateAutoShortStartRequest`, serialized by preload, and read by the actual main/worker consumer.
- [ ] Verify legacy compatibility mappings do not silently change a current UI selection, especially Whisper model/device, translation provider/target, TTS model/voice/language, cue timing, and subtitle layout.
- [ ] Check that persisted local-storage keys and any main/userData configuration have one authoritative source and do not diverge.

### Task 3: Perform static hard-code and secret review with call-site verification

**Files:**
- Read-only scan: all repository source/config/build/package files excluding `node_modules` and binary media
- Inspect findings in the files listed in Task 2 and their callers

- [ ] Search for literals and fallback operators covering language, provider, model, voice, API URL/host/port/endpoint/session header, token/key/credential/secret, speed/pitch/volume/timeout/retry/batch/concurrency, cue padding/gap/duration/silence/tempo, OCR thresholds/regions/confidence, Whisper options, subtitle/font/layout/video output, temp/cache/output/FFmpeg paths, and codec/FPS/resolution.
- [ ] Redact all credential-like values before output; never include raw keys, cookies, tokens, or authorization headers in logs, reports, test output, or patches.
- [ ] For every suspicious literal, follow the data-flow to a runtime consumer and record why it is harmless, a default, a hidden fallback, or a defect.
- [ ] Run Semgrep if installed using a repository-local output path that contains no secrets; if unavailable, record the tool absence and complete manual call-site verification.

### Task 4: Compare source against `out/`, package configuration, and installed project runtime

**Files:**
- Read: `out/main/index.js`, `out/preload/index.js`, `out/renderer/**`
- Read: `dist/builder-debug.yml`, `dist/latest.yml`, `dist/win-unpacked/resources/**`, and package metadata only within this repository
- Read: `resources/**`, `engines/**`, `scripts/**`, and runtime manifest/config files within this repository

- [ ] Compare source symbols, defaults, endpoint strings, timing constants, asset paths, model names, and IPC channels against compiled `out/` and packaged files.
- [ ] Verify `electron-builder.yml` actually includes the local engines/models/fonts/assets that source code resolves, and identify any source/build/package mismatch.
- [ ] Check executable version/probe/readiness metadata using only local project binaries or safe scripts; do not start or contact `tts-server`.
- [ ] Classify stale output as evidence of release drift, not as current source behavior, unless a package/runtime test reaches it.

### Task 5: Run bounded configuration-variation tests and fix only proven defects

**Files:**
- Read/modify only the single source/test file that owns each proven defect
- Add or extend deterministic tests under `tests` when a regression can be isolated without external services

- [ ] Use alternate language/provider/model/voice/timing/layout values in an injected or mocked local harness and assert the actual main/worker request, not only renderer state.
- [ ] Exercise cue mapping, translation segmentation/count, TTS timeline bounds, OCR/Whisper options, subtitle placement, and output-path selection with safe local fixtures.
- [ ] For each confirmed bug, write a failing regression assertion, run it red, make the smallest targeted fix, and run it green before broader verification.
- [ ] Do not use fallback or hard-coded content-specific phrase repairs; preserve language-aware behavior and existing compatibility identifiers.

### Task 6: Verify and produce the final audit report

**Files:**
- Read: changed source/tests and fresh command outputs
- Report: final response only, with absolute source paths and line numbers; no new report file containing secrets

- [ ] Re-run `npm.cmd run typecheck`, relevant focused tests, `npm.cmd run test:subtitles`, and safe local-runtime checks after the final source change; record exit codes and counts.
- [ ] Re-check source → `out/` parity after any rebuild and state whether packaged/runtime UI evidence was available or blocked.
- [ ] Produce the requested summary counts, finding table, Auto Short matrix, severe-issue evidence (source, reproduction, fix, before/after tests, actual result), and explicit `PASS`, `PARTIAL`, `BROKEN`, `BLOCKED`, or `CHƯA XÁC MINH` status.
- [ ] Confirm no files under `D:\nhathao\codex\tool\tts-server` were touched and no credential value was exposed.
