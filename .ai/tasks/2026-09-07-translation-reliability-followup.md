# TEDIA-TRANSLATION-FOLLOWUP-20260907: Đóng các lỗi reliability sau review

- **Trạng thái:** Đã triển khai; kiểm chứng cuối đã pass
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-07
- **Branch:** `codex/autoshort-optimization`
- **Baseline review:** [translation implementation audit](../../docs/reviews/2026-09-07-translation-implementation-audit.md)

## 1. Mục tiêu

Đóng các khoảng trống R1–R12 được phát hiện sau lần review implementation:
không mất continuation/cue, không source fallback, adapter và schema thống nhất,
retry/resume hữu hạn, checkpoint/cache có identity, planning theo payload thực,
đánh giá locale/capability có bằng chứng, retry UI theo từng item và qualification
offline đo được.

## 2. Tiêu chuẩn nghiệm thu

- [x] Strict Auto Short, Local, Gemini và OpenAI dùng adapter/orchestrator chung.
- [x] Response truncated/unparsed/protocol không được commit; không xuất bản một phần.
- [x] Canonical cue ID, source timing và batch progress được giữ qua resume.
- [x] Shared request/recovery/format/split budget không reset khi split hoặc retry.
- [x] `needs-review` là terminal gate cho đến khi người dùng chuẩn bị generation rõ ràng.
- [x] Prompt target/mode/schema và rephrase contract tách biệt, đủ source JSONL.
- [x] Cache/checkpoint có source/model/prompt/planner/assessment identity và ghi atomic.
- [x] Token planner đo payload serialize thực, split semantic group khi đủ điều kiện.
- [x] Unknown capability không biến thành supported/qualified; language suspicion đi tới UI/checkpoint.
- [x] Retry UI persist tập item được chọn và khôi phục state sau renderer/main restart.
- [x] Qualification offline chạy adapter/parser mock, counters thực và matrix 240 cặp locale.
- [ ] Live provider, GUI thật, TTS/font/RTL/media và packaged clean-machine vẫn cần gate riêng.
- [x] `npm.cmd run typecheck` pass.
- [x] Test liên quan và full local-runtime pass.

## 3. Phạm vi triển khai

**Trong phạm vi:**

- `src/main/translation/*` và các provider adapters/wrappers.
- Auto Short coordinator/strict translation/retry checkpoint.
- Typed IPC, renderer queue persistence/retry selection.
- Parser, prompt, language/readiness guards và offline qualification.
- Regression tests, review probes, acceptance ledger và rollback notes.

**Ngoài phạm vi:**

- Gọi provider thật hoặc dùng API key thật trong test.
- Khẳng định chất lượng ngữ nghĩa mọi locale, TTS pronunciation, font/RTL,
  FFmpeg/media và installer trên máy sạch.

## 4. Quyết định kiến trúc và lý do

- **Một orchestrator provider-neutral:** adapter chỉ gửi một request; scheduler
  giữ deadline, retry, repair, split, cancellation và budget chung để không có
  fallback riêng vượt quota.
- **Full source làm input authoritative:** resume lọc theo ID trong memory; không
  serialize subset SRT vì parser SRT tạo lại index và làm mất identity.
- **Assessment có disposition:** `validated`, `with-warnings` và `needs-review`
  được lưu cùng batch/checkpoint; warning heuristic không tự chặn, lỗi cấu trúc
  vẫn chặn publish.
- **Revision chưa biết thì không dùng persistent cache:** checkpoint cùng identity
  vẫn resume được, nhưng cache cross-job phải fail closed.
- **Retry là hành động có generation:** mở lại `needs-review` không tự gọi provider;
  người dùng phải chuẩn bị generation, cùng budget cũ được tiếp tục.

## 5. Tệp thay đổi

- `[NEW]` `src/main/translation/fileRunner.ts`
- `[NEW]` `tests/translation-provider-contract.test.ts`
- `[NEW]` `scripts/review-translation-implementation.mjs`
- `[NEW]` `docs/reviews/2026-09-07-translation-implementation-audit.md`
- `[NEW]` `docs/reviews/2026-09-07-translation-implementation-probes.json`
- `[NEW]` `docs/reviews/fixtures/translation-implementation-probes.ts`
- `[MODIFY]` `src/main/autoShortItemCoordinator.ts`
- `[MODIFY]` `src/main/autoshort.ts`
- `[MODIFY]` `src/main/localTranslate.ts`
- `[MODIFY]` `src/main/gemini.ts`, `src/main/openai.ts`
- `[MODIFY]` `src/main/index.ts`, `src/preload/index.ts`
- `[MODIFY]` `src/main/translation/{budget,checkpoint,orchestrator,planner,prompts}.ts`
- `[MODIFY]` `src/main/translate-shared.ts`
- `[MODIFY]` `src/renderer/src/components/AutoShort.tsx`
- `[MODIFY]` translation regression tests and qualification scripts.
- `[MODIFY]` [master plan](../../docs/superpowers/plans/2026-09-07-translation-reliability-master.md)
  and [acceptance ledger](../../docs/releases/translation-reliability-acceptance.md)

## 6. Kiểm chứng và bằng chứng

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime
npm.cmd run build
node scripts/run-local-runtime-tests.mjs translation-planner.test translation-orchestrator.test translation-provider-contract.test translation-budget.test translation-resume.test local-translation.test
node scripts/review-translation-implementation.mjs
node scripts/translation-qualification-main.mjs --mode offline --matrix --dry-run
git diff --check
```

Kết quả lượt chạy cuối:

- `npm.cmd run typecheck`: **PASS** (node và web).
- `npm.cmd run test:local-runtime`: **PASS**, mọi suite được runner báo `fail 0`.
- `npm.cmd run build`: **PASS** (main, preload và renderer đều build được).
- `node scripts/review-translation-implementation.mjs`: **15/15 diagnostics PASS**.
- `node scripts/translation-qualification-main.mjs --mode offline --matrix --dry-run`:
  **244 cases**, **245 provider calls**, **1 recovery request**, exit code 0.
- `git diff --check`: **PASS**.

Các kết quả mock/offline chỉ xác nhận contract, bounded recovery, identity và
counters; không đại diện cho chất lượng dịch/ngữ âm/độ trễ production.

## 7. Rủi ro còn lại và rollback

- Capability model revision, live language quality, TTS, font/RTL, media render,
  GUI restart và packaged app chưa có bằng chứng trong worktree này.
- Legacy non-strict public wrappers còn giữ để tương thích; Auto Short và generic
  IPC đã chuyển strict path. Khi xóa legacy cần migration/test riêng.
- Checkpoint/cache cũ sai schema hoặc identity sẽ bị bỏ qua an toàn; không xóa
  output người dùng. Rollback phải giữ review artifacts, không phục hồi parser
  lossy/source fallback hoặc retry không giới hạn.

## 8. Bàn giao

Đọc acceptance ledger trước release. Chỉ đóng release gate khi có provider scope,
corpus được người biết ngôn ngữ review, media artifacts và clean-machine package
verification tương ứng; không dùng test mock để khẳng định “mọi video/mọi ngôn ngữ”.
