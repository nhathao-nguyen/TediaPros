# Facebook Reels article export implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Export selected profile Reels as MP4, caption TXT, linked website article TXT and XLSX, with explicit partial/error status.

**Architecture:** Reuse owner-bound Reels jobs and the existing video downloader. Resolve external URLs from ID-associated captions/comments in an isolated Facebook session; fetch external HTML without Facebook cookies and extract article text using Mozilla Readability. Write contained, per-run output folders and retain results when cancelled.

**Tech Stack:** Electron/TypeScript, ExcelJS 4.4, Readability 0.6, jsdom 26.1 (scripts/resources disabled).

**Spec:** User's 2026-10-02 request and screenshots; article TXT means content of the website linked in the Reel.

## Constraints and review focus

- Preserve dirty workspace and existing queue behavior; typed IPC with renderer/job ownership.
- Never mix captions/comments from a different Reel or send Facebook cookies to article websites.
- Unknown end-of-list remains partial. Address virtualized scrolling and newest bootstrap payloads without hiding missing network responses.
- Website failure, no link, download failure and cancellation must be reflected separately in rows and XLSX.
- Containment validation, unique run folders, ID filenames; full article text remains in TXT even beyond Excel cell limits.

## Tasks

- [x] Write failing regression tests for new bootstrap data and scrolling.
- [x] Fix discovery; validate relevant crawler suites.
- [x] Write article/link extraction and export artifact tests; observe RED.
- [x] Implement safe HTTP article extraction, scoped Reel detail resolver and batch exporter.
- [x] Add owner-bound export lifecycle, typed IPC and progress/cancellation.
- [x] Add output folder/export controls, counters and results table to selection flow.
- [x] Verify tests, typecheck, build; review changes and document handoff/live limitations.

## Execution ledger

- Ruling: continue in existing dirty SonVersion workspace — this request extends its uncommitted Reels implementation; moving checkouts would detach the user's running development app. No commit/merge/package was requested.
- Reference inspected: fb-reels exporter/openpyxl, caption TXT, trafilatura article extractor and creator comment URL flow. Reuse TediaPros native downloader/session services rather than introducing a second Python runtime.
- RED→GREEN: newest bootstrap beyond30, nearest scrolling ancestor, article/URL/writer outputs, export owner+cancel, visible matching Reel comment control, slug creator association,16s navigation, lookup failure status, foreign DOM removal and response-before-DOM ordering.
- Review: independent reels_export_review confirmed all Important findings resolved after regression fixes; final18 parser/lifecycle tests pass, no Important/Critical remaining.
- Final local validation: typecheck/build exit0; full suite1153 tests,1118pass,35 existing FFmpeg/runtime skips,0fail;49 focused Facebook tests.
- Live website proof: creator article for Reel936934766124971 read6623characters/32paragraphs, TXT/XLSX written. Full live profile crawl/app batch export remains unverified.
