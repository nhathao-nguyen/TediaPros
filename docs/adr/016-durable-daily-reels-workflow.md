# ADR 016 — Durable daily Reels workflow

- Status: Accepted for local implementation; live Facebook/provider acceptance remains separate.
- Date: 2026-10-13

## Context

Download history prevents duplicate MP4 downloads, but cannot represent article export or AutoShort completion. Notification lists are capped at 100 videos and are unsuitable as work queues. Core AutoShort emits batch-done even when items fail, and owns a separate abort controller.

## Decision

Each channel keeps a versioned `.reels-workflow.json` ledger under its selected output root. Items are keyed by Reel ID and account digest, retain their original crawl day, and track video, caption, article, Excel and AutoShort separately. Persist the download receipt before updating download history. Persist job ID, configuration digest and each terminal output receipt during AutoShort. On subsequent scheduled/manual checks, reconcile committed core batch outputs and process unfinished stages independently of download-history filtering. Do not automatically replay a claimed daily slot on restart.

New files use the actual Vietnam crawl date, even when the scheduler is claiming yesterday's slot before 09:00. Always create video/caption/article/excel/autoshort directories for work, and export caption and Excel regardless of the optional article/render flags. Rebuild a day's workbook from the complete ledger rather than just that check's newly downloaded items. Excel errors remain retryable in the ledger. JSON, TXT and XLSX writes use containment guards and temp + rename.

Run AutoShort in chunks of at most 500. Keep the existing per-video output and audit directories under autoshort; the ledger and notices record actual output paths. Notification caps do not limit work. Join cancelAutoShort for the owned job when the monitor aborts; use actual done/error/cancelled receipts instead of treating batch-done as success.

The current AutoShort tab supplies one common configuration builder for manual jobs and workflow snapshots. Persist blur toggles/regions across tab mounts. Synchronize settings immediately through typed preload IPC and serialize snapshot writes in Main. Validate both new and legacy snapshots through the existing shared contract. Missing snapshots and invalid edits block rendering rather than silently enabling default modules. Invalid translation guidance is retained as an explicit blocked snapshot. Per-channel preset IDs and music assignments bound to existing manual item IDs are unsupported and report an error; single-track/random music can be remapped to new item IDs.

New watches default article/render flags to true per planning. Existing undefined render flags preserve their former false behavior. Existing choices remain unchanged.

Chapter discovery requires an exact story URL identity and sequential next/TOC links. Category membership, navigation CSS classes and unconstrained AI choices cannot prove story identity. Retain real chapter numbers. Report completion and stopReason; network errors, missing/ambiguous links, gaps, repeated content, starting after chapter one and the 25-page/60-second limits are partial. Continue existing DNS/IP validation on every chapter and redirect. The existing offscreen fallback remains for the production transport, without substituting a browser for injected test transports.

## Consequences and limits

Successful downloads remain usable after article/render failure, and a retry does not need a new Facebook ID. Recovery requires the same account scope and output root. Relocating a channel does not automatically migrate its previous ledger. Downloads made before the ledger existed retain their existing download-history behavior; no stage receipts are invented for them. Deleting notices never deletes work state.

The ledger is bounded to 10,000 items/32 MB per channel and reports a limit instead of silently dropping work. Completed items and outputs are not automatically deleted. Core AutoShort retains its item-scoped disk-budget/scratch cleanup behavior. A paused/removed channel keeps its ledger for inspection.

Completion describes available source/navigation evidence, not a universal website crawler guarantee. Partial chapters stay visible and retryable; sites with unsupported URL structure may require a dedicated adapter. A 25-page limit does not mean a 26-page story is complete. The workflow uses original video audio/OCR for AutoShort; article text is an exported artifact, not a new narration input.

## Validation

Regression suite: `reels-daily-workflow.test`. Existing monitor, export, detail browser, library, crawler lifecycle and AutoShort contract/pipeline suites remain relevant. Hidden Electron UI smoke checks toggle synchronization without starting a job and across tab remounts. Native FFmpeg integration is separate from Facebook, ASR/translation/TTS provider acceptance.
