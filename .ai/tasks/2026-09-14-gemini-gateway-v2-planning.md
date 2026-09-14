# TASK-20260914-GATEWAY-V2-PLAN: Kế hoạch sửa routing, JSON và dịch hai lượt

- Trạng thái: Hoàn thành tài liệu kế hoạch; chưa triển khai.
- Người thực hiện: Codex.
- Thời gian: 2026-09-14.

## 1. Mục tiêu

Lập kế hoạch chi tiết cho CreateMediaTool và TediaPros dựa trên sáu phép thử trong `.ai/tasks/2026-09-14-gateway-root-cause/evidence.json`.

## 2. Tiêu chuẩn nghiệm thu

- [x] Thiết kế nêu root cause đã xác minh, giả thuyết chưa xác minh và phạm vi.
- [x] Tám task có file đích, interface, bước red/green, gate và lệnh kiểm tra.
- [x] JSON normalization có allowlist/denylist, không đoán nội dung.
- [x] Chốt số generation, retry owner, model evidence, resume và UI.
- [x] Tự review tên file/API, link nội bộ và consistency.

## 3. Phạm vi

Chỉ thêm tài liệu. Không sửa mã ứng dụng, restart app hay gửi generation trong lượt này. Các công cụ probe và dữ liệu untracked từ lượt điều tra trước được giữ nguyên.

## 4. Quyết định

Model catalog theo tài khoản + xác minh upstream ID; strict contract v2; normalizer gateway; prompt gọn hai lượt; draft resume riêng khỏi final; gateway giữ cap3 mỗi stage với count rõ ràng. Không có JSON repair tổng quát.

## 5. Tệp mới

- `docs/superpowers/specs/2026-09-14-gemini-gateway-reliability-design.md`.
- `docs/superpowers/plans/2026-09-14-gemini-gateway-reliability.md`.
- Bản ghi bàn giao này.

## 6. Kiểm chứng

Đã đối chiếu evidence.json, parser hiện có, provider header/response, DTO metadata, IPC `translateCheckKey`, callback shouldRetry và tên test suite. Không suy từ test cũ rằng kế hoạch đã được implement. `git diff --check` và link audit được chạy trong lượt planning; typecheck không thay thế các live gates được lên kế hoạch.

`npm.cmd run typecheck`: PASS node và web trong lượt planning. Link audit: 0 link hỏng; placeholder scan: 0; `git diff --check`: PASS. Không chạy lại generation hay build vì chỉ thêm tài liệu.

## 7. Bàn giao

Thực hiện lần lượt T1–T8 khi được yêu cầu triển khai. Cần đạt routing/evidence gate trước dùng normalizer/prompt mới. Nghiệm thu live bằng API production mới, không dùng diagnostic header override. Bảng kết quả phải phân biệt offline, live structural, semantic review và render.
