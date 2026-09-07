# AutoShort Hardware Qualification Matrix

- **Ngày:** 2026-09-07
- **Quyết định:** giữ cấu hình bảo thủ cho đến khi có run thật theo protocol

| Nền tảng / provider | Đã có evidence trong lượt này | Chính sách hiện tại |
|---|---|---|
| Windows + NVIDIA | unit/resource tests; STTN/CUDA evidence lịch sử ở report riêng | `maxActiveItems=1`, local GPU heavy capacity 1 |
| Windows + AMD/Intel DirectML | chưa có AutoShort E2E mới | không công bố concurrency/stream OCR; dùng fallback đã có khi được probe |
| Windows CPU | unit và Python engine tests | xử lý tuần tự, không suy ra throughput từ fixture |
| macOS Apple Silicon | chưa chạy trong worktree này | unqualified cho tối ưu mới |

`maxActiveItems=2` chỉ là opt-in experimental và vẫn phải qua disk admission;
nó không đồng nghĩa hai inference GPU chạy cùng lúc. Cùng một local GPU heavy
được serialize ở capacity 1. `overlapIndependentStages` chỉ khởi chạy visual
branch sau khi ASR đã lưu source cues; `prefetchTts` chỉ lookahead một cue và
server request vẫn tối đa một concurrent request.

Để qualify một row, chạy single-item và two-item trên cùng source/order/config,
đo throughput, latency từng item, fairness, RAM/VRAM, scratch, encoder session,
cancel/crash/ENOSPC và quality matrix. Row thiếu thiết bị hoặc thiếu managed
runtime ghi `unqualified`, không thay bằng số 0 hay benchmark replay.

## Evidence hiện có

`autoshort-resource-lifecycle`, `autoshort-stage-scheduling` và
`autoshort-disk-budget` kiểm tra admission/lifecycle bằng fixture local. Chưa có
run hardware two-item mới đủ để tăng capacity hoặc công bố phần trăm throughput.
