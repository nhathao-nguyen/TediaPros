# Coverage — audit workflow AutoShort, 12/09/2026

Phạm vi là toàn bộ các ranh giới workflow AutoShort liên quan batch đang hỏi, không phải rà từng file của toàn repository. Không xem/nghe toàn bộ nội dung 90 video. Source và version installed được phân biệt trong REPORT.md.

| Dữ liệu/module | Phạm vi đã đọc/kiểm tra |
|---|---|
| Root AGENTS.md; dubbing/AGENTS.md; inpainting/AGENTS.md | Định tuyến, giới hạn tempo, yêu cầu quy trình |
| docs/architecture.md; docs/domain.md | Kiến trúc tổng quan; đối chiếu với thứ tự runtime |
| src/main/logger.ts | Toàn file; cách rút gọn lỗi, xóa/rotate log |
| src/main/index.ts | Runtime profile, before-quit, logging wiring |
| src/main/autoShortQueueRunner.ts | Main queue, worker limit, retry sau lượt chính, cancel |
| src/main/autoShortExecutionPolicy.ts | Toàn file; defaults và override |
| src/main/autoShortResourceManager.ts | Acquire/lease/capacity/drain FIFO |
| src/main/autoShortItemCoordinator.ts | Các nhánh checkpoint, OCR/ASR, translation, separation, TTS, STTN, audio, retime, render, finalize và cleanup |
| src/main/autoshort.ts | Điểm tạo job, queue/resource wiring, TTS/rephrase lease, DSP adapter, encoder/preview, audit output |
| src/main/ocr.ts | Raw validation → stabilize → trả timeline và cache metadata |
| src/shared/ocrVisualTimeline.ts | Validator, kiểu timeline, stabilizeSingleSampleGaps và helper dùng trong replay |
| src/main/inpainting/runner.ts | Timeline validation, engine request, provider result, output validation/cleanup |
| src/main/dubbing/synthesis.ts | Prefetch, measured tempo/calibration, final error, counters |
| src/main/burn.ts | Encoder attempts NVENC/AMF/QSV/libx264, success/failure boundary |
| src/main/autoShortTelemetry.ts | Sanitize, span timing, summary/events paths, budget |
| src/renderer/src/components/AutoShort.tsx | Persisted tasks, progress/result handling và storage keys |
| Installed app.asar | Version/hash; trích 4 hàm và 3 hằng OCR để chạy offline, không execute Electron main |
| F:/US/MyLau telemetry | Toàn bộ 41 summary + 41 events của 3 job; copy và SHA-256 trong FILE_INVENTORY.json |
| Successful manifests | Source/output identity, source/target language, clip counts, separation/STTN providers |
| WinLocal OCR artifact cache | Tìm đủ 13 cache khớp gap ID, replay đúng lỗi; chỉ đọc |
| WinLocal checkpoint | Schema và một số checkpoint mới nhất; không coi mtime là completion |
| WinLocal LevelDB WAL | Reassemble records và parse task array; chỉ xuất field task ID/path/status |
| Thành phẩm | 16 FFprobe metadata + encoder tags; không decode/quality acceptance toàn file |
| Nguồn | 15 FFprobe metadata ứng với 15 thành phẩm batch cuối |
| GPU/encoder | NVIDIA model/driver/VRAM hiện tại; 3 synthetic frames NVENC, không benchmark full graph |

UNKNOWN: app uptime chính xác, historical utilization, raw provider requests/responses đã mất, latency từng request, server stack, lỗi encoder từng attempt trong batch, cause cụ thể của overflow/calibration từng WAV. Các thiếu sót này được giữ nguyên trong kết luận, không thay bằng suy đoán.
