# Translation Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cải thiện prompt, contract, guards và phục hồi dịch để không mất nội dung âm thầm và mọi item kết thúc hữu hạn.

**Architecture:** Orchestrator/provider-neutral contracts dùng chung cho Local/Gemini/OpenAI; giữ adapter và wrapper cũ. Validation, identity và retry budget được dùng như nhau trên fresh/cache/resume, có warning UI thay vì false hard block.

**Tech Stack:** Electron 34, TypeScript 5.7, React 19, Node test runner/esbuild, Intl.Locale/Segmenter; không thêm dependency runtime mặc định.

**Spec:** [Translation reliability design](../specs/2026-09-07-translation-reliability-design.md).

## Global Constraints

- Không sửa LICENSE, NOTICE hoặc làm yếu PolyForm Noncommercial.
- Không silent source fallback, không drop cue/audio hoặc cắt ý để đạt timing.
- Tempo TTS không vượt 1.45x; giữ nguyên chính sách khoảng lặng và planar RGB OCR.
- Shared contracts không import Node, Electron, React hoặc browser globals.
- Đường dẫn mới qua safeContainedPath; cache/checkpoint atomic, scoped và có quota.
- Cancellation giữ lease đến khi provider/process kết thúc; không gọi request mới sau abort.
- Không tự đổi provider, tải model/dependency, hoặc gọi dịch vụ có phí trong test mặc định.
- Config cũ vẫn đọc được; unknown capability không được ghi thành supported/qualified.
- Không tự xóa checkpoint/cache/output người dùng; migration chỉ bỏ qua phần không tương thích.
- Mọi phase thay runtime phải pass typecheck và test liên quan trước khi chuyển phase.

## Trạng thái và preflight

**Cập nhật follow-up ngày 2026-09-07:** runtime strict path đã được sửa theo các
counterexample của [review implementation](../../reviews/2026-09-07-translation-implementation-audit.md).
Auto Short, Local, Gemini và OpenAI hiện đi qua adapter/orchestrator chung; parser,
ID canonical, checkpoint/budget, readiness và retry UI đã có regression offline.
Các gate live provider, GUI thật, TTS/font/RTL/media và packaged app vẫn phải giữ
ở trạng thái chưa đủ bằng chứng. [Handoff follow-up](../../../.ai/tasks/2026-09-07-translation-reliability-followup.md)
ghi lại phạm vi đã đóng và phần còn unqualified.

[Handoff implementation ban đầu](../../../.ai/tasks/2026-09-07-translation-reliability-implementation.md)
được giữ để truy vết; dùng [handoff review](../../../.ai/tasks/2026-09-07-translation-implementation-review.md)
và [acceptance ledger đã hiệu chỉnh](../../releases/translation-reliability-acceptance.md)
để đánh giá trạng thái hiện tại. Unit tests PASS không thay cho integration acceptance.

Làm trực tiếp trên
worktree hiện có `F:\Son\tool\TediaPros\.worktrees\codex-autoshort-optimization`
sau khi kiểm tra branch/diff; không tạo thêm worktree chỉ để lập kế hoạch.
Không commit/push/merge các file không thuộc task. Ba review docs đang là tài liệu
local; các root AGENTS/docs không có trong worktree phải đọc từ root như review đã làm.

- [x] Chạy `git status --short`, `git log -1 --oneline`; giữ mọi dirty change mới.
- [x] Đọc spec + review + root AGENTS, shared/renderer/dubbing AGENTS theo phạm vi.
- [x] Chạy baseline `npm.cmd run typecheck` và các suite regression liên quan.
- [x] Không restart dev app đang chạy hoặc thực hiện live provider calls chỉ để chạy unit tests.

## Ba đợt triển khai

| Đợt | Tasks | Deliverable và gate |
|---|---|---|
| [A — Contract, guards, prompt](2026-09-07-translation-a-contract-prompt.md) | T1–T4 | Không false-block heuristic, không mất continuation/source fallback; warnings visible; ba prompt task tách biệt |
| [B — Recovery và cache](2026-09-07-translation-b-recovery-cache.md) | T5–T8 | Adapter dùng budget chung; batch resume/cache identity; legacy migration; retry có tiến triển và giới hạn |
| [C — Locale và qualification](2026-09-07-translation-c-language-qualification.md) | T9–T12 | Token/long-cue planning, locale/capability/UI, corpus và release ledger |

Thực hiện tuần tự T1→T12. T5 định nghĩa API planner consumption, T9 thay planner
legacy mà không thay cách tính budget. Không bật scheduler với cache cũ khi chưa
có T7/T8. Mỗi task có RED→GREEN, test regression, explicit-file commit; mỗi phase
có full typecheck và relevant suites. Full runtime test/build chạy tại integration
gate sau T11, không lặp full suite sau mọi thay đổi tài liệu.

## Coverage hai review

| Finding | Task |
|---|---|
| Guard phủ định/số/đơn vị chặn sai | T1, T10 |
| Parser mất continuation, missing/duplicate/unknown IDs | T2 |
| Source fallback + positional remap | T2, T6 |
| Prompt target=auto, output contract mâu thuẫn | T3 |
| Rephrase sai nhiệm vụ/thiếu source/đè nghĩa bằng timing | T4 |
| Partial recovery/retry chi phí sâu/provider lệch policy | T5, T6 |
| Cache thiếu source/model identity và publish trước QA | T7 |
| Resume mất batch tốt và lặp cùng failure | T8 |
| Token budget, single long cue, Hangul spacing | T9 |
| Hai script guards, mixed/unknown/capability | T10 |
| Warnings/needs-review UI, explicit retry, job counts | T1 tối thiểu, T11 đầy đủ |
| Corpus, test gap, A/B prompt và no KPI without evidence | T12 |

## Số mặc định cần ghi rõ khi implement

`B` normal planned requests; `R=max(4,ceil(B*0.5))` recovery requests; mỗi original
batch <=4 recovery; transport <=2 retries, format repair <=1/exact-ID set,
split depth <=2, identical nonprogress fingerprint <=2. Tổng <=B+R, không reset
khi split/resume. Per-request <=180s, stage active budget
`max(600000, B*90000+R*60000)` ms. Thay ngưỡng chỉ qua qualification có evidence.

## Final acceptance checklist

- [x] Case incident zh→en không bị heuristic chặn nhầm; cảnh báo ngôn ngữ được giữ trong assessment/checkpoint. Live quality vẫn unqualified.
- [x] Strict path không mất cue/continuation, không điền nguồn; source/timing/IDs được bảo toàn qua mapping canonical và resume.
- [x] Target/mode/schema thống nhất cả ba provider; rephrase có contract riêng và reject response không đầy đủ.
- [x] Cache hit và fresh dùng cùng validator; sửa source text làm key thay đổi.
- [x] Retry tests chứng minh hữu hạn cho HTTP, format, split, cancel và cross-resume; mọi request dùng chung budget và resume không reset quota.
- [x] Queue giữ item `needs-review/error`, retry theo tập đã chọn và hydrate state sau renderer restart; GUI thao tác thật còn unqualified.
- [x] Locale unknown không đồng nghĩa supported; không lẫn qualitative claim với unit pass.
- [x] Handoff follow-up ghi nhận typecheck/full suite/build/diff-check và probe offline sau runtime fix.
- [x] Qualification report chạy adapter/parser mock thực, có matrix 240 directed locale pairs và giữ semantic/live rows ở trạng thái unqualified.
- [x] Handoff task, release acceptance ledger, migration/rollback notes cập nhật.

## Execution handoff

Mặc định đề xuất Inline Execution với executing-plans, review theo ba phase.
Subagent-Driven là lựa chọn khác nếu người dùng yêu cầu; planning không dispatch
agent, không thay đổi app đang mở. Kế hoạch này thay phần translation tương ứng
trong master AutoShort optimization trước đó, không thay phạm vi OCR/STTN/separation.
