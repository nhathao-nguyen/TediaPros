# TASK-20260913: Lập kế hoạch tăng tốc và phục hồi Edge TTS

- **Trạng thái:** Hoàn thành planning; implementation chưa bắt đầu
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-13

## 1. Mục Tiêu (Goal)

Lập kế hoạch có thể triển khai cho AutoShort 400–500 request/video: scheduler, recovery, parallel preparation, resume, telemetry và benchmark, dựa trên code hiện tại.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Đối chiếu code, routing docs, ADR 005 và probe hiện có.
- [x] Phân biệt hiện trạng, đề xuất và kết quả live chưa kiểm chứng.
- [x] Có thứ tự triển khai, phạm vi tệp, tham số thử nghiệm, test gates và rollback.
- [x] `npm.cmd run typecheck` hoàn tất: node và web pass, exit code 0.
- [x] Không chạy benchmark mạng 500 request trong task planning.
- [x] Bổ sung hai video tại `F:\Son\doyuin\LauHaiSan\dalam`, metadata/hash đã kiểm tra và ma trận A/B, warm-cache, cancel/resume, lỗi mạng giả lập.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- In scope: viết tài liệu kế hoạch và handoff.
- Out of scope: sửa runtime/UI, tăng concurrency app đang chạy, live load test, commit/push/release.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

Đề xuất scheduler Edge toàn Main process; cache lookup trước admission; parallel natural preparation nhưng consume/finalize theo source order; phục hồi lỗi vận chuyển hữu hạn, không thay ngân sách translation hiện tại. Đo ở 1/2 trước khi thử 4 request đồng thời.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- NEW: `docs/plans/2026-09-13-autoshort-edge-tts-throughput.md`
- NEW: `.ai/tasks/TASK-20260913-edge-tts-throughput-planning.md`

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

- Baseline `main@0c743aa`. Trước task có 8 MP4 untracked thuộc benchmark khác; giữ nguyên.
- Đã chạy `npm.cmd run typecheck`: node và web pass, exit code 0.
- Không chạy test runtime mới: chỉ thay tài liệu. Các lệnh trong plan là yêu cầu cho implementation sau này, không phải kết quả test của task này.
- Live Edge 500 request và video thật: UNKNOWN, chưa chạy.
- Bổ sung theo yêu cầu: `DALAM-01` dài 131.007007 giây, `DALAM-02` dài 169.110998 giây; cả hai H.264 1080×1920 30 fps + AAC stereo 44.1 kHz. Đã chạy FFprobe read-only và `Get-FileHash -Algorithm SHA256`; chi tiết/hash tại mục 4.1 trong plan. Chưa xác minh số cue hoặc thực hiện full-decode/ASR/TTS/render.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Bắt đầu M0 (metrics/error contract), rồi M1 (scheduler/recovery với concurrency 1). Chưa mở preset 2 mặc định cho đến gate chất lượng và benchmark. Không diễn giải mốc 500 request là quota Edge được Microsoft bảo đảm.
