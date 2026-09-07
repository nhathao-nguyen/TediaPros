# TEDIA-TRANSLATION-IMPLEMENTATION-20260907: Triển khai kế hoạch reliability

- **Trạng thái:** Đã triển khai runtime và kiểm chứng offline; live/GUI/media/package còn unqualified
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-07
- **Branch:** `codex/autoshort-optimization`

## 1. Mục tiêu

Hiện thực kế hoạch tổng cho flow dịch Auto Short: contract và prompt chung,
strict parsing theo ID, warning semantic thay false block, recovery hữu hạn,
cache/checkpoint có identity, locale planning, capability/readiness và retry UX.

## 2. Đã triển khai

- [x] T1–T4: shared translation contract, structural/content assessment,
  parser không bỏ continuation, strict mapping, prompt subtitle/dubbing/repair/
  rephrase, typed warning state và UI details.
- [x] T5–T6: workload recovery budget, structured failure classification,
  iterative provider-neutral orchestrator, timeout/cancel/no-progress/split limits.
- [x] T7–T8: source/model/prompt identity, v2 translation artifact envelope,
  atomic checkpoint writes, stale checkpoint preservation, explicit retry generation.
- [x] T9–T10: locale-aware grouping, long cue spans, capability/readiness matrix,
  BCP47 target validation và language evidence heuristic fail-open.
- [x] T11: typed `autoshort:retryTranslation` IPC, stale identity/path guard,
  warning/needs-review counters and queue rendering.
- [x] T12 offline: multilingual fixture, qualification harness/dry-run, release
  acceptance ledger; live adapter intentionally fails closed.

## 3. Kiểm chứng

- [x] `npm.cmd run typecheck`: PASS.
- [x] `node scripts/run-local-runtime-tests.mjs local-runtime.test`: 156/156 PASS.
- [x] Translation suites: response, prompts, budget, planner, language,
  orchestrator, identity, resume, multilingual and qualification PASS.
- [x] Local provider regression: `local-translation.test` PASS after bounded
  request/split changes.
- [x] `npm.cmd run test:local-runtime`, `npm.cmd run build`, `git diff --check`:
  PASS sau khi sửa false label từ số dòng stack.
- [ ] Native GUI/restart/retry acceptance, live provider/corpus, TTS/RTL/font/
  media và packaged clean-machine gates còn unqualified.

## 4. Giới hạn và rollback

Provider wrappers hiện vẫn giữ public SRT API và model discovery tương thích;
orchestrator là contract chung để các adapter chuyển dần sang một-request path.
Không có source fallback khi strict boundary thất bại. Translation cache cũ thiếu
schema/identity bị bỏ qua, source/checkpoint cũ được giữ lại dưới
`checkpoint.previous.json`. Rollback về commit trước chỉ sau khi giữ evidence; không
khôi phục parser lossy hoặc semantic hard block.

## 5. Bàn giao

Đọc [translation-reliability-acceptance.md](../../docs/releases/translation-reliability-acceptance.md)
trước khi tuyên bố release. Chỉ chạy `--mode live` khi có adapter, scope, model,
chi phí và người review ngôn ngữ được phê duyệt.
