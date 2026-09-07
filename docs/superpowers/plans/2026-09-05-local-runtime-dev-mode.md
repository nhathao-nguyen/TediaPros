# Dev-Local Runtime Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Let the unpackaged Electron app install verified runtime archives from an explicit local release directory so Auto Short can be tested before any GitHub publication.

**Architecture:** `TEDIAPROS_LOCAL_RUNTIME_DIR` is honored only when Electron reports `app.isPackaged === false`. Distribution URLs become `local-runtime:///...` pseudo-URLs, and a bounded local fetch adapter maps only the manifest and one-level asset filenames inside that directory. Production keeps the existing GitHub URLs and native capability checks unchanged.

**Tech Stack:** Electron, TypeScript, Node `fs/promises`, native `fetch`/`Response`, Node test runner bundled by the repository's local-runtime harness.

**Spec:** `docs/superpowers/specs/2026-09-04-autoshort-ocr-timed-text-blur-design.md`

## Global Constraints

- Never honor the local runtime directory in a packaged application.
- Do not bypass manifest validation, archive checksum/size checks, extraction safety, or native capability probes.
- Keep the existing remote owner/repository/channel defaults unchanged when local mode is absent.
- Preserve uncommitted user changes and do not stage generated runtime archives or user data.

---

### Task 1: Add the dev-only distribution source contract

**Files:**
- Modify: `src/main/distributionConfig.ts`
- Test: `tests/local-runtime.test.ts`

**Interfaces:**
- `getDistributionConfig()` exposes `runtimeSource`, optional `localRuntimeDir`, and local pseudo-URLs only for unpackaged dev mode.
- `createDistributionFetch(config)` returns a `fetch` implementation that serves `runtime-manifest.json` and safe one-level asset files from `localRuntimeDir`.

- [x] Write tests for local URL selection, packaged-mode rejection, bounded local file serving, and traversal rejection.
- [x] Run the focused local-runtime test and confirm the new tests fail because the contract is absent.
- [x] Implement the minimal config and fetch adapter in `distributionConfig.ts`.
- [x] Re-run the focused tests and the full local-runtime suite.

### Task 2: Bind runtime and separator installers to the local fetch source

**Files:**
- Modify: `src/main/runtimeInstaller.ts`
- Modify: `src/main/separation/modelInstaller.ts`
- Test: `tests/local-runtime.test.ts`

**Interfaces:**
- Installer hook fetches remain injectable; absent hooks use `createDistributionFetch(getDistributionConfig())`.

- [x] Add a test that installs a hook-probed runtime archive from a local directory without network access.
- [x] Run it red and confirm the installer still attempts the remote URL.
- [x] Use the local fetch adapter as the default for both runtime and separator model manifests/assets.
- [x] Run the focused installer tests and full local-runtime/typecheck gates.

### Task 3: Document and validate the local click path

**Files:**
- Modify: `README.md` or the nearest developer runtime documentation only if an existing section is present.
- Test: existing `scripts/verify-ocr-blur-media.mjs` local acceptance path.

- [x] Run local acceptance render with ground-truth timeline injection.
- [x] Verify a real OCR `1.1.0` archive is required for automatic blur; never downgrade the capability gate.
- [x] Report the exact environment variable and command sequence without publishing anything.

**Current environment note:** `release-artifacts/` now contains a verified
dev-only runtime directory with FFmpeg/FFprobe and OCR 1.1.0. It is generated
from the machine's Python 3.14.7/RapidOCR 1.2.3 environment and must not be
published as production runtime-v5; production packaging still requires the
pinned release inputs. A clean-profile install-readiness run now reports both
FFmpeg `ocr-mask-v1` and OCR `visual-cues-v1` ready.
