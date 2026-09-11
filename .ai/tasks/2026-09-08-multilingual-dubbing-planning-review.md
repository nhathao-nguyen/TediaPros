# TASK-20260908-MULTILINGUAL-DUBBING-REVIEW: Đối chiếu planning với implementation

- **Trạng thái:** Hoàn thành review; các lỗi implementation chưa sửa
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-08

## 1. Mục Tiêu (Goal)

Review implementation_plan.md, walkthrough.md và spec multilingual do người dùng chỉ định, đối chiếu code thật tại HEAD `863f55c38822e28046b0f0592c206ca9303aeeb5` với base `481ae06`.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Đọc đủ ba tài liệu và các AGENTS/ADR/design liên quan.
- [x] Phân biệt lỗi planning, regression mới, hành vi đã có và claim chưa kiểm chứng.
- [x] Typecheck pass; chín suite liên quan pass 269 tests, 0 failures.
- [x] Lưu probes tái hiện cùng bằng chứng và đường dẫn code.
- [x] Giữ nguyên production code và dữ liệu untracked có trước.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- Trong phạm vi: review synthesis/adapter, content QA, prompt budget/identity, coordinator clamp và test coverage.
- Ngoài phạm vi: sửa lỗi, commit/merge, triển khai, benchmark server thật hoặc acceptance video của người dùng.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

Giữ nguyên quy tắc tempo 1.45x/protected gap 0.50 s làm chuẩn review. Dùng module production bundle trong bộ nhớ và fixture adapter để so sánh base/head, không checkout hay sửa source. Thử clamp ở cấp block và ghi rõ chưa có reproduction qua media thật.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` [REVIEW.md](/F:/Son/tool/TediaPros/docs/reviews/2026-09-08-multilingual-dubbing-review/REVIEW.md).
- `[NEW]` Evidence trong `docs/reviews/2026-09-08-multilingual-dubbing-review/evidence/`: ba scripts, ba kết quả JSON/JSONL, log chín suite và verification summary.
- `[NEW]` Bản bàn giao này. Không chỉnh production files.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-content-quality.test translation-prompts.test translation-rephrase.test dubbing-plan.test autoshort-tts-pipeline.test dubbing-grouping.test local-translation.test local-runtime.test autoshort-ocr-pipeline.test
node docs/reviews/2026-09-08-multilingual-dubbing-review/evidence/reproduce-review.cjs
node docs/reviews/2026-09-08-multilingual-dubbing-review/evidence/reproduce-premature-structural-split.mjs
node docs/reviews/2026-09-08-multilingual-dubbing-review/evidence/reproduce-rephrase-lease.mjs
git diff --check
```

Typecheck pass; 269 existing tests pass; ba probes tái hiện thành công các vấn đề. Structural split: base hợp lệ, HEAD dừng trước LLM. Lease: batch nhả trước response body hoàn tất. QA/cache/clamp: xem JSONL. Không có live TTS/media acceptance; test pass không có nghĩa implementation hết lỗi.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Ưu tiên F1 structural split; tiếp đến lease, QA, prompt version và thiết kế clamp. Đồng bộ planning/spec/walkthrough sau khi chốt phạm vi phù hợp AGENTS. Các file audit và output có trước trong checkout không thuộc review này và chưa được stage.
