# ADR 012: Điều tiết Upstream tại Gateway và tự phục hồi Batch

- Trạng thái: Đã chấp thuận (Accepted)
- Ngày quyết định: 2026-09-17
- Phạm vi: CreateMediaTool (Gateway v2, Upstream Governor, Operation API) và TediaPros (AutoShort Batch, Provider Wait, Checkpoint Resume)

## Bối cảnh

Khi xử lý batch nhiều video qua Gemini Gateway, các request có thể bị Google giới hạn tạm thời (throttling / 429 / cooldown). Trước đây, việc giãn cách 3 giây hay nghỉ 45 giây chỉ được thực hiện cục bộ trong TediaPros (`geminiGateway.ts`), không bao phủ các retry nội bộ gateway, ClientPool hay các ứng dụng/client khác. Khi gặp giới hạn, queue runner coi đó là terminal error và đánh lỗi hàng loạt các video đang chờ trong hàng đợi.

Đồng thời, khi request gửi lên upstream bị timeout mạng hoặc client disconnect sau khi gateway đã dispatch lên Google, client không thể biết request đã thực sự được xử lý hay chưa; việc tự động gửi lại có thể gây duplicate generation hoặc kích hoạt thêm rate limits.

## Quyết định

1. **Gateway sở hữu điều tiết Upstream (CreateMediaTool):**
   - Triển khai một `UpstreamGovernor` duy nhất được dependency injection dùng chung cho default provider và toàn bộ `ClientPool`.
   - Giới hạn concurrency upload/generation = 1 cho toàn bộ gateway `egressGroup`.
   - Giãn cách bắt buộc (minSpacing = 15 giây) sau mỗi attempt hoàn tất (kể cả retry và giữa các video).
   - Cooldown tăng dần khi có bằng chứng throttling (60 → 120 → 240 giây hoặc tôn trọng `Retry-After`/reset date do upstream trả về).
   - Half-open gate chỉ cho phép đúng 1 request công việc thực; không gửi generation ping giả lập.
   - Khóa owner liên tiến trình bằng file lock OS-backed trên state directory canonical.

2. **Phân loại lỗi dựa trên bằng chứng (Failure Evidence):**
   - Phân loại lỗi theo `FailureEvidence` (HTTPStatus, RetryAfter, AuthRequired, Challenge, Dispatched, OutcomeUnknown).
   - Không suy đoán ban IP hoặc CAPTCHA từ HTTP 405/403 chung hoặc từ chuỗi "rate limit" trong thông báo lỗi BardError.
   - Trạng thái `outcome-unknown` khi mất kết nối sau dispatch không được tự động replay.
   - Snapshot governor lưu cả `state` và `reason`. Sau restart, khóa xác thực, challenge và `outcome-unknown` giữ nguyên lý do để client không tự mở khóa sai. Snapshot `running` phục hồi thành `blocked/outcome-unknown`.
   - Snapshot `blocked` đời cũ không có lý do được gắn `recovered-from-store`. TediaPros chỉ tự phục hồi đúng một lần khi operation xác nhận `not-dispatched`, `upstream_attempts=0`; client reset scheduler, ACK operation terminal cũ, ghi lease mới bền vững rồi mới submit ID mới. Operation đã dispatch hoặc không rõ kết quả tuyệt đối không được replay.

3. **Operation API Bất Đồng Bộ và Chống Gửi Trùng (Idempotency):**
   - Bổ sung các endpoint opt-in dưới `/openai/v1/gateway` và `/v1/gateway`:
     - `GET /scheduler`: Tra cứu trạng thái governor, queue depth, nextEligibleAt.
     - `POST /requests`: Tiếp nhận request có `client_request_id`, persist trước khi trả HTTP 202 Accepted.
     - `GET /requests/:id`: Tra cứu trạng thái và nhận kết quả hoàn tất.
     - `POST /requests/:id/cancel`: Hủy request an toàn, không rò rỉ permit.
     - `POST /requests/:id/ack`: Xác nhận client đã lưu kết quả an toàn.
   - Tính canonical request hash (SHA-256) trên JSON payload đã chuẩn hóa. Cùng ID và payload trả operation hiện có; khác payload trả HTTP 409 Conflict.
   - Bảo mật owner token (256-bit) cho từng operation; kiểm tra constant-time.
   - Sau crash/restart, operation đã dispatch mà chưa có kết quả chuyển thành `outcome-unknown`, không tự động replay mù.

4. **TediaPros Lưu Trạng Thái Chờ Không Terminal:**
   - Khi gateway trả về trạng thái chờ (`waiting-provider` / cooldown), queue runner chuyển trạng thái item sang `deferred`, không gọi `onTerminal` hay đánh dấu `error`.
   - Không tăng số lần attempt của video pending khi đang chờ provider.
   - Bảo toàn checkpoint (ASR, draft, translation hợp lệ) trước khi giải phóng tài nguyên và dọn dẹp scratch.
   - Bổ sung `ProviderWaitState` vào journal schema v2 có migration an toàn từ v1.
   - `ProviderWaitState.stage` dùng chung một contract cho cả dịch văn bản (`restore-translate`, `independent-review`) và phục hồi audio/OCR (`restoration-draft`, `restoration-review`); mọi stage có thể bị deferred phải được journal chấp nhận trước khi đưa vào production.
   - Các stage phục hồi audio/OCR gửi `response_format` JSON Schema riêng cho draft và review. Validator phía client vẫn kiểm tra cue coverage, evidence refs, digest và group replacement; JSON hợp lệ đơn thuần không đủ để xuất bản.
   - Phục hồi audio/OCR có hơn 8 cue được chia tuần tự thành các chunk có draft/review và lease riêng. Chỉ sau khi từng chunk hợp lệ, client mới ghép theo thứ tự cue và validate lại toàn bộ draft/review trên evidence ledger gốc; không thay cue ID/timestamp và không xuất bản một phần.
   - Khi payload/schema mới không khớp lease cũ, client chỉ hủy và thay operation đang `not-dispatched` với 0 upstream attempt. Operation `running`, đã dispatch hoặc `outcome-unknown` tiếp tục bị giữ, không replay bằng payload mới.
   - `outcome-unknown` không có `next_eligible_at_utc` và không được mô tả là “sẽ tự tiếp tục”. Một thao tác resume rõ ràng có thể phục hồi đúng operation khi receipt vẫn là `outcome-unknown`, scheduler có zero permit/queue và block reason tương ứng; lease cũ được lưu với hậu tố `abandoned-*` trước khi tạo request identity mới.
   - Endpoint reset từ chối HTTP 409 nếu governor còn active permit hoặc đang shutdown, để thao tác phục hồi không thể xóa quyền sở hữu của request đang chạy.
   - Giao diện UI hiển thị trạng thái chờ rõ ràng với countdown, cho phép người dùng tạm dừng/hủy bất kỳ lúc nào mà không bắt duyệt từng câu.

5. **Giữ Nguyên Các Ràng Buộc Bất Khả Xâm Phạm:**
   - `TRANSLATION_BUDGET_LIMITS_ENABLED = false` theo chính sách 2026-09-08.
   - Giữ nguyên trần tempo lồng tiếng tối đa 1.80x, không drop cue, giữ nguyên cue ID và timestamp.
   - Giữ model alias `gemini-advanced`, `require_verified_model=false`, `require_complete_response=true`.
   - Giữ tính Isomorphic cho `src/shared/`, typed IPC và path containment.

6. **Phân Chặng Khôi Phục Media (P5):**
   - Tích hợp âm thanh gốc và OCR để tự đối chiếu ASR và sửa lỗi được triển khai ở P5 sau khi hạ tầng governor và batch scheduling P1–P4 được kiểm chứng hoàn tất.

## Hệ quả

### Tích cực
- Batch nhiều video chạy ổn định, tự động xếp hàng và nghỉ khi gặp giới hạn tạm thời từ Google mà không bị hỏng toàn bộ hàng đợi.
- Loại bỏ hoàn toàn race condition và duplicate requests khi mạng chập chờn.
- Tiến độ được bảo toàn tuyệt đối qua checkpoint; khi tiếp tục không phải chạy lại ASR hay bản dịch đã hợp lệ.

### Đánh đổi và giới hạn
- Concurrency = 1 có thể làm tăng tổng thời gian xử lý toàn batch nhưng bảo đảm an toàn trước upstream rate limiter.
- Các khoảng thời gian spacing (15s) và cooldown (60s/120s/240s) là chính sách cục bộ, không phải bảo đảm từ Google rằng sẽ không bao giờ bị giới hạn.
- Khi gặp yêu cầu CAPTCHA/challenge hoặc `outcome-unknown`, hệ thống dừng an toàn và yêu cầu đăng nhập/can thiệp thay vì tự thử lại vô hạn.

## Kiểm chứng

- Unit tests và race tests cho `UpstreamGovernor`, `FailureClassifier`, `GatewayRequestStore` tại `CreateMediaTool`.
- Unit tests cho `gatewayOperation.ts`, `autoShortProviderWait.ts`, journal v2 migration, và end-to-end fake clock recovery tại `TediaPros`.
- Toàn bộ test suites pass trước khi rollout; deploy gateway trước rồi mới kích hoạt client.
