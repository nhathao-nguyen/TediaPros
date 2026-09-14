# TASK-20260914-GEMINI-GATEWAY-PLAN: Khôi phục và dịch qua CreateMediaTool

- **Trạng thái:** Hoàn thành phần planning; implementation chưa bắt đầu.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-14.

## 1. Mục tiêu

Lập kế hoạch sửa hai dự án để dùng Gemini qua gateway CreateMediaTool, giảm lượt request không cần thiết, khôi phục nguồn có bằng chứng và dịch đúng nghĩa/tự nhiên theo locale. Người dùng đã chọn mặc định hai lượt: restore+translate, rồi audit và patch trong phiên riêng.

## 2. Tiêu chuẩn nghiệm thu planning

- [x] Đối chiếu code ở cả TediaPros và CreateMediaTool, cùng artifact Volvo.
- [x] Nêu contract, prompt hai lượt, evidence, locale, recovery, cache và cancellation.
- [x] Chia bước/file sửa, regression tests, live qualification và rollout.
- [x] Giữ nguyên override không chặn tổng request và trần tempo 1.80x.
- [x] `npm.cmd run typecheck`: PASS, exit 0 (node và web).
- [x] Không sửa product code, restart gateway/app hoặc gửi media lên Gemini trong task planning.

## 3. Phạm vi

- Kế hoạch chi tiết ở `docs/superpowers/plans/2026-09-14-gemini-gateway-restoration-translation.md`.
- Chỉ tạo tài liệu planning/handoff. Không sửa subtitle/video người dùng hoặc tích hợp worktree metadata.

## 4. Quyết định và lý do

- Provider `gemini-gateway` riêng, URL/model riêng với local TTS; không dùng `llm-default` vì gateway working tree có fallback sang model khác.
- Người dùng xác nhận ánh xạ Gemini 3.1 Pro = `gemini-advanced`. Chốt wire ID này cho draft/review/recovery, UI hiển thị Gemini 3.1 Pro; base API URL `http://127.0.0.1:4982/openai/v1`, không tự fallback model.
- Hai lượt toàn bài khi vừa envelope, semantic audit có patch ngay; code giữ ID/timestamp và tự tính disposition.
- Audio/OCR/frame là bằng chứng khôi phục; đồng thuận giữa hai lượt Gemini không được gọi là bằng chứng nguồn độc lập.
- Không coi schema prompt-only, usage 0 hoặc finish `stop` hardcode là capability/thống kê thật.

## 5. Tệp tạo

- `[NEW]` `docs/superpowers/plans/2026-09-14-gemini-gateway-restoration-translation.md`.
- `[NEW]` `.ai/tasks/2026-09-14-gemini-gateway-translation-planning.md`.

## 6. Kiểm chứng và giới hạn

- Đã đọc các module planner, prompts, shared contract, coordinator, local adapter, UI config; gateway DTO/service/provider/upload và ba dirty diff.
- Đã dùng review Volvo có hash/ảnh nguồn và replay offline. Không có raw request dịch lịch sử; không quy lỗi cho một model cụ thể.
- GET live `/openai/v1/models` và `/v1/models` tại `127.0.0.1:4982` đều trả 14 ID, có `gemini-advanced`. Chỉ đọc discovery; không gửi generation hoặc upload media. Ánh xạ tên Gemini 3.1 Pro lấy từ xác nhận người dùng.
- Chưa chạy live inference, chưa qualification audio/schema/model identity trên gateway; mọi đường API mới và suite mới trong kế hoạch là đề xuất.
- `npm.cmd run typecheck`: PASS, exit 0 (node và web). Không có thay đổi runtime cần chạy regression trong task chỉ viết kế hoạch này.
- Kiểm tra hai tài liệu bằng script Node: code fence cân bằng, không trailing whitespace, liên kết nội bộ tồn tại. `git diff --check` không báo lỗi trong tracked diff; hai file mới được kiểm tra riêng bằng script vì còn untracked.

## 7. Bàn giao

Triển khai theo P0–P6 trong kế hoạch. Trước khi sửa gateway, kiểm tra lại các thay đổi chưa commit ở `openai_module.go`, `client_pool.go`, `gemini_service.go`. Không ghi đè công việc có sẵn. Tạo fixture/gates trước khi coi luồng mới là đã tích hợp hoặc dịch đúng.
