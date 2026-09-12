# TASK-20260912-AI-OUTPUT-REVIEW: Review worst-case cho spec và plan

- **Trạng thái:** Hoàn thành review và cập nhật tài liệu; chưa triển khai runtime.
- **Người thực hiện:** Codex, review cục bộ không subagent.
- **Thời gian:** 2026-09-12.
- **Baseline:** HEAD `cd7d865`; không có tracked source changes trước review.

## 1. Mục tiêu (Goal)

Review bộ spec/plan đã viết trong session theo lỗi nặng, lỗi kết hợp, tương thích cũ, Unicode, cancellation, checkpoint/resume, publication crash và giới hạn bằng chứng. Sửa các khoảng trống ở cấp thiết kế, giữ scope runtime cho lần implement sau.

## 2. Tiêu chuẩn nghiệm thu (Acceptance Criteria)

- [x] Review có finding severity, vị trí trước sửa, tác hại, quyết định sau review và scenario traceability.
- [x] 14 findings (10 P1, 4 P2) được xử lý trong tài liệu; không khẳng định đã fix runtime.
- [x] Spec revision 2 có AC01–AC20; plan P0–P6 có dependency/exit gates tương ứng.
- [x] Ma trận C01–C60 có expected outcomes và AC; tất cả vẫn PLANNED.
- [x] Typecheck baseline lần review pass, exit 0; log được lưu riêng.
- [x] Document integrity/traceability verifier pass, có local links, whitespace, ID coverage và count checks.
- [ ] Thực thi test runtime mới, platform atomic commit và live provider/server-stop qualification — chưa thực hiện.

## 3. Phạm vi (Scope & Boundaries)

Đã làm: lưu snapshot spec/plan trước review; đọc các đoạn transport/lease/writer/checkpoint/budget/digest hiện có; viết review report, sửa spec/plan, thêm scenario matrix và verifier tài liệu, cập nhật liên kết từ bàn giao ban đầu.

Không sửa src/tests/package/scripts sản phẩm, không gọi provider thật, không deploy/build/package, không thay gateway/concurrency/tempo/quota dịch, không commit và không đụng các task untracked khác.

## 4. Quyết định và lý do

- Generation/attempt fencing chặn stale callback; content digest không thay quyền sở hữu output.
- Logic task completion, client lease và server liveness là ba trạng thái riêng. Cancel không tự chứng minh request remote đã dừng.
- Atomic no-replace publication có commit point/receipt/reconcile; exclusive create đơn lẻ không đủ crash integrity.
- Unknown model completion không bao gồm incomplete transport; không gộp candidates/thought/tool content.
- Termination dựa vào recovery rank + durable counters + wire attempt accounting, không dựa riêng fingerprint hoặc tăng quota.
- Strict AI validation khác legacy state migration; version/identity đổi cùng caller trước rollout, không chờ cuối plan.
- Các semantic/Unicode positive controls ngăn giải pháp reject quá mức; live/platform chưa có evidence được giữ UNKNOWN.

## 5. Tệp thay đổi (Changes Made)

- [MODIFY] [Spec revision 2](../../docs/superpowers/specs/2026-09-12-ai-output-reliability-design.md).
- [MODIFY] [Plan revision 2](../../docs/superpowers/plans/2026-09-12-ai-output-reliability.md).
- [NEW] [60 scenarios](../../docs/superpowers/specs/2026-09-12-ai-output-reliability-adversarial-cases.md).
- [NEW] [Review report](2026-09-12-ai-output-reliability-review/review.md).
- [NEW] [Snapshot spec](2026-09-12-ai-output-reliability-review/spec-before-review.md), [snapshot plan](2026-09-12-ai-output-reliability-review/plan-before-review.md).
- [NEW] [Document verifier](2026-09-12-ai-output-reliability-review/verify-review-docs.mjs), [verification log](2026-09-12-ai-output-reliability-review/document-verification.log), [typecheck log](2026-09-12-ai-output-reliability-review/typecheck.log).
- [MODIFY] [Bàn giao lần lập plan](TASK-20260912-ai-output-reliability-planning.md): chỉ thêm chỉ dẫn revision 2, giữ evidence baseline cũ.
- [NEW] Bản bàn giao review này.

## 6. Kiểm chứng và bằng chứng (Verification & Evidence)

Lệnh chạy từ root:

```powershell
npm.cmd run typecheck
node .ai/tasks/2026-09-12-ai-output-reliability-review/verify-review-docs.mjs
git diff --check
git status --short
git rev-parse --short HEAD
```

Typecheck kiểm chứng baseline Node/Web. Verifier kiểm chứng cấu trúc tài liệu/links/traceability, không chạy C01–C60. `git diff --check` chỉ cover tracked diff; verifier đọc trực tiếp các Markdown đang untracked.

100/100 tests ở bàn giao trước là kết quả có sẵn trong cùng session; không chạy lại vì review chỉ sửa tài liệu và code baseline không đổi. Không gán số baseline đó cho scenarios mới. Chưa chạy full regression, Electron UI, gateway/model thật, filesystem platform spike hoặc power-loss test.

## 7. Bàn giao tiếp theo

Bắt đầu P0 theo plan revision 2. Các gate cần triển khai/probe trước khi claim support: atomic no-replace filesystem, server stop/status, deep checkpoint validation, semantic corpus và live capability qualification. Spec đã định nghĩa hành vi fail-safe khi chưa hỗ trợ; không giả vờ mọi gate đã được chứng minh ở lần review này.
