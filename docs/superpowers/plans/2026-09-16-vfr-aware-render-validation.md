# VFR-Aware Render Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép AutoShort giữ nguyên video VFR hợp lệ và không thất bại hậu render chỉ vì nominal FPS khác FPS trung bình.

**Architecture:** FFprobe sẽ lưu cả `r_frame_rate` (nominal) và `avg_frame_rate` (average). Coordinator truyền average rate cùng cờ VFR vào cổng xác thực; validator ưu tiên so sánh average-to-average, chỉ dùng nominal làm fallback khi average không có. Không thêm bộ lọc `fps` hoặc ép CFR vào đường render.

**Tech Stack:** TypeScript, Node.js `node:test`, FFprobe/FFmpeg, Electron main process.

**Spec:** `docs/adr/011-vfr-preserving-render-validation.md`

## Global Constraints

- Không sửa LICENSE/NOTICE và không thay đổi hợp đồng IPC.
- Không ép CFR; giữ timestamp/frame pacing VFR của input và STTN.
- Mọi thay đổi mã nguồn phải có test hồi quy trước khi triển khai.
- Chạy `npm.cmd run typecheck` và test local-runtime liên quan trước khi bàn giao.
- Giữ nguyên mọi thay đổi dirty/untracked hiện có trong worktree.

### Task 1: Mở rộng metadata FPS và cổng probe

**Files:**
- Modify: `src/main/canonicalDisplayGeometry.ts`
- Modify: `src/main/burn.ts`
- Test: `tests/canonical-display-geometry.test.ts`

**Interfaces:**
- `FFprobeRawStream.avg_frame_rate?: string`.
- `CanonicalMediaMetadata.averageFrameRate?: number` và `isVariableFrameRate?: boolean`.
- `Meta.averageFrameRate?: number` và `isVariableFrameRate?: boolean`.

- [x] **Step 1: Write the failing test** asserting `r_frame_rate=30/1` plus `avg_frame_rate=20375/689` produces average `29.571843...` and `isVariableFrameRate=true`.
- [x] **Step 2: Run the focused test and confirm it fails because average metadata is absent.**
- [x] **Step 3: Add parsing and probe selection for `avg_frame_rate` without changing the existing nominal `frameRate` field.**
- [x] **Step 4: Run the focused canonical metadata tests and confirm they pass.**

### Task 2: VFR-aware post-render validator

**Files:**
- Modify: `src/main/burn.ts`
- Modify: `src/main/autoShortItemCoordinator.ts`
- Test: `tests/rendered-media-validation.test.ts`

**Interfaces:**
- `AutoShortBurnExecutionOptions.expectedMedia.averageFrameRate?: number`.
- Exported pure helper `validateFrameRateMeasurement(expected, actual)` used by `validateRenderedMedia`.

- [x] **Step 1: Write failing pure-helper tests:** a VFR measurement with expected average `20375/689` passes despite nominal `30`, and a CFR mismatch still throws the localized FPS error.
- [x] **Step 2: Run the focused validator test and confirm the VFR case fails under nominal-only behavior.**
- [x] **Step 3: Include `avg_frame_rate` in FFprobe validation, implement average-first comparison, and pass `processingMeta.averageFrameRate`/`isVariableFrameRate` from the coordinator.**
- [x] **Step 4: Run canonical and validator tests together and confirm they pass.**

### Task 3: Document policy and handoff evidence

**Files:**
- Create: `docs/adr/011-vfr-preserving-render-validation.md`
- Create: `.ai/tasks/TASK-20260916-vfr-preserving-render-validation.md`

- [x] **Step 1: Record the root cause, VFR policy, fallback behavior, and non-goals in the ADR.**
- [x] **Step 2: Record changed files, exact verification commands/results, and remaining production risks in the task handoff.**
- [x] **Step 3: Run `npm.cmd run typecheck` and the related local-runtime tests; update handoff with the fresh evidence.**
