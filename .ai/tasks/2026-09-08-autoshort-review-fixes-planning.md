# TASK-20260908-AUTOSHORT-REVIEW-FIXES-PLANNING: Lập kế hoạch sửa F1–F6

- **Trạng thái:** Hoàn thành planning; implementation chưa bắt đầu
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-08

## 1. Mục Tiêu (Goal)

Chuyển sáu findings trong review thành design và implementation plan có phạm vi file, thứ tự phụ thuộc, interface, test hồi quy và gate nghiệm thu. Baseline code `863f55c38822e28046b0f0592c206ca9303aeeb5` trên `codex/measured-dubbing-first`.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] F1–F6 đều có task và test quyết định.
- [x] Design giữ tempo 1.45x, protected gap 0.50 s, no-silent-drop và measured duration.
- [x] Mô tả ownership batch/response rõ; không nested lease Local.
- [x] Tách local verification khỏi live media acceptance.
- [x] Typecheck của code hiện tại pass trong lượt planning; không coi là test fixes.
- [x] Rà cú pháp snippets, links, coverage và trạng thái implementation trống có chủ đích.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

Trong phạm vi: tạo ba file tài liệu mới. Ngoài phạm vi: sửa production/tests, thực thi plan, commit/merge, đổi cache của người dùng hoặc gọi provider thật.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

Giữ pipeline ba pha, dùng lịch predecessor đã rescue/DSP chốt để quyết định slot; chỉ split an toàn và trong budget chung. Adapter nhận toàn queue, chia request và giữ lease suốt LLM phase. QA tách helper số/phủ định có ngữ cảnh. Version prompt v6 invalidate cache đúng phạm vi. Coordinator validation thuần; EOF audio thật bị chặn thay vì sửa metadata hoặc cắt tiếng.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` [Design](/F:/Son/tool/TediaPros/docs/superpowers/specs/2026-09-08-autoshort-review-fixes-design.md).
- `[NEW]` [Implementation plan](/F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-08-autoshort-review-fixes.md).
- `[NEW]` Bản bàn giao planning này.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

- `git rev-parse HEAD`: baseline không đổi.
- `npm.cmd run typecheck`: Node/Web PASS, exit 0 trong lượt lập planning; production chưa sửa.
- Rà 17 fenced TypeScript snippets bằng `esbuild.transformSync` trong bộ nhớ: PASS cú pháp; không phải typecheck/test toàn implementation dự kiến. Chạy riêng các ví dụ rule trợ từ nghi vấn trong plan: PASS controls đã nêu.
- Kiểm tra đủ Task 1–8, mapping F1–F6, sáu file links tồn tại, không có placeholder mở và `git diff --check`: PASS.
- Không chạy các test fix chưa được viết; 269 tests của lượt review trước chỉ là evidence baseline, không phải kết quả mới của fixes.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Khi được yêu cầu implement, thực thi Task 1→2 trước, sau đó Task 3→6; Task 7 đồng bộ tài liệu theo kết quả thật và Task 8 chốt local/media riêng. Giữ review artifacts lịch sử; không dùng failure của script chuyên assert lỗi cũ làm lý do rollback fix đúng. Bản implementation handoff có tên riêng được nêu trong Task 7.
