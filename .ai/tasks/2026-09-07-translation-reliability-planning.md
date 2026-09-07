# TEDIA-TRANSLATION-PLAN-20260907: Kế hoạch cải thiện prompt và dịch đa ngôn ngữ

- **Trạng thái:** Hoàn thành tài liệu planning; chưa implement runtime
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-07

## 1. Mục tiêu

Hợp nhất prompt review và multilingual audit thành spec và implementation plan
có dependencies, interface, tests, budget, migration và qualification gates.

## 2. Nghiệm thu planning

- [x] Hai review được mapping vào 12 task, chia ba phase.
- [x] Exact file paths và new interfaces/ownership được ghi trong từng task.
- [x] Retry credits/deadline/no-progress/resume semantics được định nghĩa.
- [x] Parser/cue identity/prompt variants và warning UI có regression đề xuất.
- [x] Có live/offline/GUI/media qualification và rollback boundaries riêng.
- [ ] Implementation test gates chưa chạy vì runtime chưa sửa trong lượt planning.

## 3. Phạm vi

Tạo spec, master và ba execution plans. Không sửa src/tests/config, không merge,
push, restart app hoặc gọi provider. Ba review files local vẫn được giữ nguyên.

## 4. Quyết định

Dùng contract/orchestrator chung với adapter hiện có; không vá regex riêng lẻ
hoặc thêm LLM reviewer mỗi cue. Ngân sách workload B+R, cảnh báo semantic không
chứng minh bản dịch đúng. Source/model/prompt identity xuyên cache/resume.

## 5. Tệp tạo

- docs/superpowers/specs/2026-09-07-translation-reliability-design.md
- docs/superpowers/plans/2026-09-07-translation-reliability-master.md
- docs/superpowers/plans/2026-09-07-translation-a-contract-prompt.md
- docs/superpowers/plans/2026-09-07-translation-b-recovery-cache.md
- docs/superpowers/plans/2026-09-07-translation-c-language-qualification.md
- .ai/tasks/2026-09-07-translation-reliability-planning.md

## 6. Kiểm chứng

Kiểm tra references, task coverage T1–T12, code fences và whitespace tài liệu: PASS.
`npm.cmd run typecheck` trong lượt planning: PASS, exit 0; runtime không đổi.
Không chạy lại runtime suite chỉ vì tài liệu thay đổi. Typecheck hiện tại không
được dùng như evidence triển khai kế hoạch này. Người implement phải chạy baseline
và tất cả gates sau edits.

## 7. Bàn giao

Bắt đầu master preflight rồi T1. Inline execution là mặc định đề xuất; không
dispatch subagent trong lượt planning. Các task implementation còn unchecked.
Live qualification chỉ triển khai khi có môi trường và scope chạy cụ thể;
không ghi complete nếu chỉ có offline fixture. Runtime 3d49b84 vẫn còn lỗi đã review.
