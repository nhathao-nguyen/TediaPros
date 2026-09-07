# Translation reliability acceptance ledger

Date: 2026-09-07
Branch: `codex/autoshort-optimization`
Scope: bounded translation contract, quality assessment, cache identity,
checkpoint safety, locale planning and review UX.

| Area | Status | Evidence / boundary |
|---|---|---|
| Source cue identity and timing | PASS (offline) | Strict ID mapping and planner tests; no positional source fallback. |
| Structural response validation | PASS (offline) | `translation-response.test`, `local-translation.test`; malformed continuation is not publishable. |
| Semantic number/negation guard | PASS (offline) | `autoshort-content-quality.test`, multilingual fixture; heuristic differences are warnings. |
| Bounded recovery | PASS (offline) | `translation-budget.test`, `translation-orchestrator.test`; normal/recovery/split/transport quotas are finite. |
| Cache/checkpoint identity | PASS (offline) | `translation-identity.test`, `translation-resume.test`; source text/model/prompt identity is required. |
| Provider contract | PASS (static/offline) | Local/Gemini/OpenAI target and mode payload checks; no live credentials used. |
| Locale/capability readiness | PASS (static/offline) | `translation-language.test`, shared BCP47 validation and stage capability reporting. |
| Warning/review UI and retry IPC | PASS (static contract) | Renderer/main/preload wiring and UI contract tests; native GUI retry/restart acceptance pending. |
| Multilingual semantic quality | UNQUALIFIED | Requires competent speakers and a reviewed corpus for each model/locale pair. |
| TTS pronunciation, shaping and RTL render | UNQUALIFIED | Requires actual server/model, fonts, FFmpeg and media artifacts. |
| Live latency and cost KPI | UNQUALIFIED | Offline tests do not make network, model or hardware claims. |
| Packaged application acceptance | UNQUALIFIED | Requires rebuilt installer and clean-machine verification after this branch. |

The release gate remains closed for a universal “every language/video” claim.
An accepted pilot must show no lost cue or silent source fallback, bounded
failure, zero severe semantic errors, and separately reviewed media output. If a
row has no command or artifact pointer, it must stay `UNQUALIFIED`.
