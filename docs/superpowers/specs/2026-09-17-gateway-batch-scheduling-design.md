# Thiết kế: batch Gemini tự điều tiết và phục hồi

- Ngày: 2026-09-17.
- Trạng thái: thiết kế phục vụ yêu cầu lập planning; chưa triển khai runtime.
- Phân loại: thay đổi kiến trúc liên quan hai repo, operation API và batch journal.
- [Kế hoạch thực hiện, baseline và chi tiết contracts](../plans/2026-09-17-gateway-batch-scheduling-and-auto-recovery.md).

## Bối cảnh và lựa chọn

Người dùng muốn khôi phục lỗi ASR, dịch và chạy nhiều video tự động qua gateway mà không phải duyệt từng câu. Gateway Gemini Web đã nhận audio/ảnh trong một phép thử live; batch dài vẫn cần điều tiết dịch vụ và phục hồi tiến độ.

| Hướng | Đánh đổi | Quyết định |
|---|---|---|
| Chỉ tăng delay trong TediaPros | Ít sửa nhưng không bao phủ client khác và retry nội bộ gateway; cooldown dài nằm trong timeout request | Không chọn làm kiến trúc chung |
| Governor + operation API trong CreateMediaTool; TediaPros quản lý deferred state | Có thêm migration/storage, nhưng chia rõ quyền retry và bảo toàn công việc đang chạy | Chọn cho implementation hiện tại |
| Gemini API chính thức phía sau gateway | Quota API rõ hơn; cần cấu hình project/credentials/billing riêng | Work package tùy chọn, không tự chuyển backend |

## Yêu cầu có mã định danh

| ID | Yêu cầu và điều kiện nghiệm thu |
|---|---|
| R1 | Tối đa một attempt upload/generation Gemini Web active trong cùng gateway egressGroup; không route/client pool nào bypass |
| R2 | Throttling có bằng chứng mở cooldown, tôn trọng Retry-After/reset; một half-open; không thử khi CAPTCHA/auth chưa giải quyết |
| R3 | Retry cấu trúc, transport và semantic recovery không nhân lớp; actual attempt nào cũng được đếm và qua admission |
| R4 | Cùng request ID/payload chỉ một operation; khác payload trả 409; outcome unknown không tự replay |
| R5 | Cooldown/status wait tách deadline generation; client disconnect không tạo generation mới |
| R6 | Chờ provider là non-terminal: giữ thứ tự, source/draft/translation, không đánh lỗi hàng loạt video pending |
| R7 | Tự resume trong phiên khi gate cho phép; user cancel/shutdown không tự khởi động batch lại |
| R8 | UI thể hiện chờ/khôi phục/yêu cầu đăng nhập rõ ràng, qua typed IPC; không yêu cầu duyệt từng cue để batch chạy tiếp |
| R9 | State store bounded, path-contained, giữ owner scope/token; không log secrets/raw media; không prune active work |
| R10 | Legacy sync endpoints còn dùng được, vẫn qua governor; journal v1 migration có test; rollback không làm mất operation |
| R11 | Audio/OCR là chặng sau: evidence-based restoration, exact cue IDs/timing, byte preflight, checkpoint identity mới và kiểm tra quality bằng corpus |
| R12 | Không bật lại tổng ngân sách dịch đang tắt; không đổi model policy; không cam kết “không ban IP” từ delay hoặc một phép thử |

## Ranh giới các thành phần

- `UpstreamGovernor`: chỉ quyết định khi nào một attempt được chạy, phạm vi block và thời điểm thử tiếp. Không dịch, sửa JSON hay quyết định cue semantics.
- `UpstreamFailure`: giữ status/header/evidence và phân loại kết quả; không biến mọi 405/BardError thành lỗi chặn IP.
- `GatewayRequestStore` + executor: persist admission/dispatch/result, dedupe, status/cancel/ack và recovery sau restart. Không khẳng định exactly-once của upstream.
- `GeminiGatewayOperations` trong TediaPros: submit/query/cancel theo receipt, validate completion/schema, không phát minh request ID mới sau timeout chưa rõ dispatch.
- `AutoShortProviderWait`: persist non-terminal wait, wake/resume, cancellation và resource release. Chỉ chạy tiếp video khi gate cho phép.
- Media evidence/restoration: chuẩn bị dữ liệu và kiểm tra chất lượng riêng; tiêu thụ operation API chung khi được triển khai.

## Các hành vi người dùng

1. Bấm chạy: hệ thống kiểm tra local capabilities/state, không gửi generation ping riêng.
2. Đang chạy: mọi request Google được xếp hàng và tính cả các lượt sửa/review/metadata.
3. Bị giới hạn tạm thời: hiển thị thời điểm thử lại, giữ tiến độ; không cần người dùng bấm retry.
4. Hết cooldown: một request thật được chọn; thành công mới mở tiếp, thất bại lại tăng chờ theo chính sách.
5. Nguồn một video không thể sửa có căn cứ: lưu lỗi video, xử lý video kế tiếp khi dịch vụ khỏe.
6. Yêu cầu đăng nhập/challenge hoặc outcome unknown: dừng gửi, giữ tiến độ, thông báo đúng lý do. Tự động hoàn toàn không đồng nghĩa bypass các trường hợp cần phục hồi quyền truy cập.
7. Hủy: dừng timer/poll và admission ngay; receipt vẫn đủ để không dispatch trùng khi upstream chưa settle.

## Invariants phải giữ nguyên

- `TRANSLATION_BUDGET_LIMITS_ENABLED = false`, tempo tối đa `1.80x`, không drop cue.
- Alias `gemini-advanced`, `require_verified_model=false`, `require_complete_response=true`.
- Cue ID/timestamp do code sở hữu; completion/schema hợp lệ không tự chứng minh bản dịch đúng.
- Windows 10/11 x64 và macOS Apple Silicon M1+; main/preload/shared/renderer giữ ranh giới hiện tại.
- Scratch dọn theo scope, checkpoint cần resume phải được lưu bền vững trước cleanup.

## Traceability

| Hạng mục kế hoạch | Yêu cầu |
|---|---|
| P0, Task 1 | R2, R3, R12 |
| P1, Task 2–3 | R1, R2, R3, R9 |
| P2, Task 4–5 | R4, R5, R9, R10 |
| P3, Task 6–7 | R5, R6, R7, R8, R10 |
| P4, Task 8 | R1–R10, R12 và giới hạn LIVE_CONFIRMED |
| P5 | R11; là chặng triển khai chất lượng sau khi batch qua nghiệm thu |

Tham số 15 giây spacing và 60/120/240 giây cooldown là đề xuất local trong planning, chưa phải cấu hình đã chạy hoặc số liệu Google bảo đảm.
