# TEDIA-TRANSLATION-REVIEW-20260907: Review triển khai kế hoạch tổng

- **Trạng thái:** Hoàn thành review; implementation chưa đạt nghiệm thu.
- **Người thực hiện:** Codex, không dispatch subagent.
- **Thời gian:** 2026-09-07.
- **Commit review:** `7d86614572c6941861ee130e89e4d93e9ae2cc64`.

## 1. Mục tiêu

Đối chiếu 12 task A/B/C với production flow, test và các tuyên bố hoàn thành;
tái hiện các lỗi retry/resume/parser bằng mock để biết phần nào cần mở lại.

## 2. Tiêu chuẩn nghiệm thu review

- [x] Truy vết entry point AutoShort → ba provider; phân biệt module riêng với integration.
- [x] Bảng đối chiếu đủ T1–T12, findings theo ưu tiên và đường dẫn code.
- [x] Có runner offline và JSON chứng cứ; không gọi provider/key/media thật.
- [x] `npm.cmd run typecheck` PASS.
- [x] 67 test hiện có thuộc 14 file liên quan PASS; tách rõ 15 diagnostic tái hiện lỗi.
- [x] Hiệu chỉnh master checklist, acceptance ledger và trạng thái handoff cũ.
- [x] `git diff --check` PASS.

## 3. Phạm vi

- Trong phạm vi: review implementation, synthetic probes, evidence/docs/handoff.
- Ngoài phạm vi: sửa runtime, tăng retry budget, merge/push/commit, restart app,
  chi phí provider, GUI/TTS/font/RTL/media/package qualification.

## 4. Quyết định và lý do

- Giữ test suite hiện tại; diagnostic dùng exit 1 khi hành vi vi phạm kế hoạch,
  không chuyển các lỗi đang có thành “expected failures” trong suite PASS.
- Chỉ expose private rephrase consumer trong bundle tạm, không sửa API runtime.
- Giữ lịch sử handoff ban đầu kèm hiệu chỉnh rõ ràng. Module/unit PASS không phải
  bằng chứng adapter/checkpoint/UI thực đã đạt kế hoạch.

## 5. Tệp thay đổi

- NEW: [Audit T1–T12](../../docs/reviews/2026-09-07-translation-implementation-audit.md).
- NEW: [Runner offline](../../scripts/review-translation-implementation.mjs).
- NEW: [Fixture probes](../../docs/reviews/fixtures/translation-implementation-probes.ts).
- NEW: [Kết quả JSON](../../docs/reviews/2026-09-07-translation-implementation-probes.json).
- MODIFY: [Master plan](../../docs/superpowers/plans/2026-09-07-translation-reliability-master.md).
- MODIFY: [Acceptance ledger](../../docs/releases/translation-reliability-acceptance.md).
- MODIFY: [Handoff implementation](2026-09-07-translation-reliability-implementation.md).
- NEW: Bản ghi bàn giao review này.

## 6. Kiểm chứng và bằng chứng

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs translation-response.test translation-prompts.test translation-budget.test translation-orchestrator.test translation-identity.test translation-resume.test translation-planner.test translation-language.test translation-multilingual.test translation-qualification.test translation-rephrase.test local-translation.test autoshort-content-quality.test autoshort-ui-contract.test
node scripts/review-translation-implementation.mjs
git diff --check
```

Typecheck và 67 test hiện có PASS. Diagnostic exit 1: **15/15 counterexamples tái
hiện tiêu chí chưa đạt**, không phải số đo tỷ lệ lỗi trên corpus/video. Có chứng cứ
coordinator lưu zero usable cue sau batch tốt 10 cue, gọi lại provider từ needs-review,
cloud 20 request vượt cap 15, Local/rephrase/orchestrator giữ prefix lỗi, prompt/schema
không khớp, ko source context mất space, language warning/planner boundary chưa đúng.

UI retry/restart và qualification harness được kiểm tra bằng code, không có GUI/live
acceptance. Full runtime suite/build của lần bàn giao trước không được coi là phép
đo mới trong review này; lượt này không sửa runtime.

## 7. Bàn giao

Ưu tiên R1/R5/R6 (mất nội dung), rồi R2/R3/R4 (adapter/budget/identity/resume), sau đó
request contract/planner/locale và UI/qualification. Chi tiết regression và acceptance
nằm trong audit. Không tăng budget để che lỗi consumer hoặc thiếu integration.
