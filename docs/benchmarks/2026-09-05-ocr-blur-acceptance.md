# OCR Timed Blur — Acceptance Ledger 2026-09-05

## Environment

| Item | Value |
|---|---|
| Commit (pre-task-12) | `0f24538 release(runtime): define OCR blur runtime v5` |
| Branch | `codex/autoshort-background-music` |
| OS | Microsoft Windows NT 10.0.26200.0 |
| CPU | 11th Gen Intel(R) Core(TM) i5-11400F @ 2.60GHz |
| GPU | (no DirectML/QSV — h264_qsv unavailable, libx264 used) |

## Managed FFmpeg / FFprobe

| Binary | Version | SHA-256 |
|---|---|---|
| `ffmpeg.exe` | n9.0.1-11-ge47273f4d9-20260829 | `42074c0d62b0187487a3c7a9246d0dbf962bb8b75df8dd964d15c50fa55ad692` |
| `ffprobe.exe` | n9.0.1-11-ge47273f4d9-20260829 | `0e40685c56dbfe7867f9ba01cd41f15c63aa58fda2fb80f282f4e00ee7e400ca` |

Path: `%APPDATA%\tedia-pros\bin\ffmpeg\`

## Python / OCR Engine

| Item | Value |
|---|---|
| Python (system) | 3.14.7 (3.12.10 not installed — Step 12.15 BLOCKED) |
| OCR engine build | NOT RUN — requires Python 3.12.10 |
| OCR unit tests | PASS — `npm run test:ocr-engine` (15 tests) |

## Fixture

**Run ID:** `25c7f06141d443568c8679ce9af3c289`

| File | Size | SHA-256 |
|---|---|---|
| `source.mp4` | 2,163,368 B | `2268418a0ae871c7ad7629500be21844497a3cb8eb618e45716ce285feaa75bd` |
| `narration.wav` | 576,078 B | `93b8c58a520b4de9af0ef8109d5c28cb742af51cf8626cee9863804dfd3a22b7` |
| `sub.ass` | 876 B | `66990aeda486761851faeaaeaa10429e85b07cc0ec6f937b30597255aed79dff` |
| `timeline.json` | 2,436 B | `b08f368cc3dc5515a2ea3f8d1cc4fe511e4041efcf57da72f18448e2522602f4` |
| `samples.json` | 1,032 B | `85ff99dc8beec49f21380cc3db0835ddcd68ead967618b89badeaf2d937ce923` |

Canvas: 1280x720, 30 fps, 6.000 s. Source: 1500 Hz sine. Narration: 997 Hz sine.
Font hash: `bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d` (NotoSans.ttf)

## Profile Results (Step 12.14)

| Profile | Duration | File size |
|---|---|---|
| `accurate` (ground-truth timeline injection) | 6.000 s | 385,151 B |
| `fast` (ground-truth timeline injection) | 6.000 s | 385,151 B |

## Test Suite Summary

| Suite | Command | Outcome |
|---|---|---|
| TypeScript typecheck | `npm run typecheck` | PASS |
| OCR engine unit (Python) | `npm run test:ocr-engine` | PASS (15 tests) |
| Separator engine unit | `npm run test:separator-engine` | PASS (13 tests) |
| Local runtime / burn / pipeline | `npm run test:local-runtime` | PASS (all suites) |
| Subtitle smoke | `npm run test:subtitles` | PASS |
| Whitespace check | `git diff --check` | PASS |

## Gate Evidence

| Gate | Required evidence | Status |
|---|---|---|
| source/type/unit | `npm run typecheck` + `test:local-runtime` | PASS |
| Python OCR domain/CLI | `test:ocr-engine` — 15 tests | PASS |
| synthetic production path | Coordinator + real mask/burn via `verify-ocr-blur-media.mjs` — accurate+fast, duration=6.000 s | PASS |
| real RapidOCR fixture | Requires OCR engine 1.1.0 binary (Python 3.12.10) | BLOCKED — Python 3.14.7 installed, 3.12.10 unavailable |
| packaged runtime-v5 | `release-inputs/runtime-v5-win32-x64` | BLOCKED — clean runtime-v5 inputs unavailable |
| isolated on-demand install | Depends on packaged runtime-v5 | BLOCKED |
| Windows app package | `npm run package:win` | NOT RUN |
| representative user media | Approved input required | BLOCKED — no approved input provided |
