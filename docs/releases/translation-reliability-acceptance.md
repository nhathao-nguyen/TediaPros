# Translation reliability acceptance ledger

Date: 2026-09-07
Branch: `codex/autoshort-optimization`
Scope: bounded translation contract, quality assessment, cache identity,
checkpoint safety, locale planning and review UX.

**Follow-up runtime verification on 2026-09-07.** The initial review at `7d86614`
provided 15 counterexamples; the strict runtime path was then corrected. See the
[task-by-task baseline audit](../reviews/2026-09-07-translation-implementation-audit.md),
[passing offline diagnostics](../reviews/2026-09-07-translation-implementation-probes.json)
and [follow-up handoff](../../.ai/tasks/2026-09-07-translation-reliability-followup.md).
All diagnostic rows now pass in the offline mock harness. This is evidence of
bounded contracts and selected regressions, not a production quality or latency rate.

| Area | Status | Evidence / boundary |
|---|---|---|
| Source cue identity and timing | PASS (offline strict path) | Canonical source IDs remain authoritative; resume filters in memory and never reserializes a subset SRT. Live/provider-specific output still requires capture. |
| Structural response validation | PASS (offline strict path) | Unparsed continuation/truncation/protocol errors invalidate the whole candidate; no partial publish or source fallback. |
| Semantic number/negation guard | PASS (offline) | `autoshort-content-quality.test`, multilingual fixture; heuristic differences are warnings. |
| Bounded recovery | PASS (offline/integration mocks) | One provider-neutral scheduler owns normal/recovery/transport/repair/split charges; needs-review is terminal until explicit retry and cross-resume budget is retained. |
| Cache/checkpoint identity | PASS (offline strict path) | Source cue text/timing, provider/model/prompt/planner/assessment identity, atomic checkpoint, per-batch progress and budget are persisted; unknown provider revisions intentionally skip persistent cache. |
| Provider contract | PASS (offline request capture) | Local/Gemini/OpenAI send the same target/mode/source JSONL and object `items[].text` schema; adapter performs one request and scheduler owns recovery. |
| Locale/capability readiness | PASS (offline guards; live capability unqualified) | BCP47 validation, source-locale grouping, exact serialized prompt budget, long-cue mapping and language suspicion are wired; actual model/font/TTS coverage is still unknown. |
| Warning/review UI and retry IPC | PASS (static/unit) | Review evidence is visible, retry selection is persisted, Start sends only selected items, generation/path/identity guards survive restart. Native GUI acceptance pending. |
| Offline A/B qualification | PASS (offline harness) | Final dry-run report covered 244 cases (240 directed locale pairs plus contract/regression cases), 245 provider calls and 1 recovery request; semantic naturalness and live A/B remain pending. |
| Multilingual semantic quality | UNQUALIFIED | Requires competent speakers and a reviewed corpus for each model/locale pair. |
| TTS pronunciation, shaping and RTL render | UNQUALIFIED | Requires actual server/model, fonts, FFmpeg and media artifacts. |
| Live latency and cost KPI | UNQUALIFIED | Offline tests do not make network, model or hardware claims. |
| Packaged application acceptance | UNQUALIFIED | Requires rebuilt installer and clean-machine verification after this branch. |

The release gate remains closed for a universal “every language/video” claim.
An accepted pilot must show no lost cue or silent source fallback, bounded
failure, zero severe semantic errors, and separately reviewed media output. If a
row has no command or artifact pointer, it must stay `UNQUALIFIED`.
