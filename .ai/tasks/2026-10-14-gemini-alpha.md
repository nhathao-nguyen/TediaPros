# GEMINI-ALPHA: tích hợp khử logo cố định

- Trạng thái: Đã kiểm chứng local.
- Người thực hiện: Codex
- Thời gian: 2026-10-14

## Mục tiêu và nghiệm thu

Thêm lựa chọn Alpha, xem thử 5 giây, xuất video không cần model, tiền kiểm và dừng khi mẫu không khớp. Giữ các thay đổi Facebook có sẵn.

## Phạm vi và quyết định

Profile hiệu chỉnh cho 720x1280 từ video người dùng, không giả định một mẫu dùng cho mọi độ phân giải. Khử alpha và inpaint biên bằng CPU, FFmpeg native; không thêm Python/runtime hoặc tải model. Giữ luồng STTN cũ. Đưa vào release v0.1.38 theo yêu cầu build/push/publish ngày 2026-10-15.

## Tệp thay đổi

Runner và math/profile trong inpainting, mode/IPC contracts, coordinator/preview, renderer, telemetry stage, tests và danh sách test runtime.

## Kiểm chứng

Typecheck, build; 57 test liên quan math/IPC/readiness/pipeline/preview/telemetry đã qua, không skip; native fixtures xác minh pixel, frames/audio, từ chối logo sai độ trong suốt/no-logo, hủy khi đang ghi và bảo vệ output có sẵn. File gốc thật có 192 frame và offset video 0.083333s; runner giữ offset trong trung gian, hoàn tất 7.955s CPU trong lần chạy cuối, matchScore 0.996 và opacityRatio 1.019. Kiểm tra frame cho thấy thanh xe đẩy rõ hơn STTN nhưng còn viền nhẹ ở vài frame. Không có clean ground truth; chưa kiểm chứng GUI trực tiếp hoặc độ tổng quát trên nhiều video.

## Bàn giao

Làm mờ -> Logo Gemini cố định Alpha, chọn vùng bao phủ logo góc phải và xem thử. Mẫu không khớp sẽ báo lỗi; dùng STTN vùng thủ công hoặc hiệu chỉnh profile ngoài phạm vi hiện tại.

Release gates 2026-10-15: metadata, typecheck, subtitle smoke và package:win passed; full local-runtime 1247 passed, 6 conditional skips, 0 failures. CI và published asset verification được kiểm tra sau khi push tag.
