# Neeyut-blao Reset and CUDA Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reset all Neeyut-blao build/runtime/engine data without deleting source or touching `tts-server`, reinstall Node dependencies, and make Whisper CUDA discovery work from the current profile with a legacy path fallback.

**Architecture:** Cleanup is an explicit allowlist of absolute paths: repository source and `tts-server` remain outside the destructive set. Whisper CUDA path selection is extracted into a pure, testable helper; installation always writes to the current Electron `userData` profile, while runtime discovery can recognize the old `%APPDATA%\\tediapros\\bin\\whisper-cuda` location.

**Tech Stack:** Electron, TypeScript, Node.js, PowerShell/.NET filesystem APIs, npm lockfile, assertion-based smoke tests.

**Spec:** Approved conversation design and reset scope from 2026-08-27.

## Global Constraints

- Do not delete source files, the `.git` directory, `package.json`, `package-lock.json`, or committed runtime logic.
- Do not read/write/delete under `D:\\nhathao\\codex\\tool\\tts-server`.
- Do not run `npm run build`, `electron-vite build`, `electron-builder`, or packaging commands.
- Delete only Neeyut-blao build outputs, temporary verification artifacts, downloaded engines/models, app profiles, and `tblao` temp data explicitly identified during baseline.
- Reinstall Node dependencies with `npm ci` before tests.
- Preserve unrelated pre-existing working-tree changes; do not reset, checkout, clean, commit, or rewrite history.

---

### Task 1: Reset generated and downloaded Neeyut-blao state

**Files:**
- Delete only the verified repository outputs: `node_modules`, `dist`, `out`, `.tmp-packaged-userdata`, `.tmp-packaged-userdata-2`, `.tmp-whisper-runtime-check`, `.tmp-packaged-appdata`, and generated engine `__pycache__` directories.
- Delete only the verified Neeyut-blao profiles: `%APPDATA%\\tedia-pros`, `%APPDATA%\\tediapros`, `%APPDATA%\\t-blao`, `%LOCALAPPDATA%\\TediaPros`, `%LOCALAPPDATA%\\t-blao-updater`, `%TEMP%\\tblao-burn`, and `%TEMP%\\tblao-tts-preview`.
- Preserve `D:\\nhathao\\codex\\tool\\tts-server`, `%APPDATA%\\tediapros-*` gateway temp items, `%APPDATA%\\Local\\com.tediapros.ttsservermanager`, source directories, and repository resources.

- [x] Stop/confirm no packaged Neeyut-blao process is using deleted files.
- [x] Delete the allowlisted paths with filesystem-aware absolute-path operations.
- [x] Verify every allowlisted path is absent and the `tts-server` repository status remains unchanged.

### Task 2: Reinstall Node dependencies and establish a clean test baseline

**Files:**
- Create: `node_modules/` from `package-lock.json` via `npm ci`.

- [x] Run `npm ci` from the repository root.
- [x] Run `npm run typecheck` and record the exit status.
- [x] Run `npm run test:subtitles` and record the exit status.

### Task 3: Make Whisper CUDA path discovery testable and compatible

**Files:**
- Create: `src/main/whisperPaths.ts` with pure candidate ordering and an injected filesystem predicate.
- Modify: `src/main/whisper.ts` to use the helper for status, probe, and transcription, while installing new CUDA files in the current `userData/bin/whisper-cuda` directory.
- Test: `scripts/smoke-subtitles.ts` with current-profile-first and legacy-profile fallback assertions.

**Interfaces:**
- Produces `whisperCudaCandidateDirs(userData: string, appData: string): string[]`.
- Produces `findWhisperCudaDir(candidates: string[], isUsable: (path: string) => Promise<boolean>): Promise<string | null>`.

- [ ] Add assertions that current `userData/bin/whisper-cuda` is first and `%APPDATA%/tediapros/bin/whisper-cuda` is second.
- [ ] Run the smoke test and confirm it fails because the new helper is not implemented.
- [ ] Implement the smallest helper and wire `whisperCudaStatus`, `whisperCudaProbe`, and CUDA transcription arguments to the resolved directory.
- [ ] Run the smoke test again and confirm it passes.

### Task 4: Verify red-error scope and final invariants

**Files:**
- Modify only source files required by a reproduced Neeyut-blao error; otherwise keep the existing passing source unchanged.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test:subtitles`.
- [ ] Confirm no build/package command ran and no build output was recreated.
- [ ] Confirm the cleanup allowlist is still absent except for freshly installed `node_modules`.
- [ ] Confirm `git status --short` contains only pre-existing changes plus the CUDA helper/test/plan changes.
- [ ] Confirm `tts-server` status and commit are unchanged.
