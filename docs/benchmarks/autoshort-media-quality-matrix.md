# AutoShort Media Quality Matrix

- **Ngày:** 2026-09-07
- **Mục đích:** acceptance cho output hình, audio, subtitle trước khi bật tối ưu
- **Nguyên tắc:** cùng source/config/model/geometry/FPS/trim/encoder trong mỗi A/B

## Các chiều phải chấm

| Chiều | Kiểm tra tự động | Human review / giới hạn |
|---|---|---|
| Video transport | FFmpeg decode exit 0, stream count, duration/FPS tolerance | VFR, rotation, SAR và cảnh cắt nhanh |
| OCR blur | timeline hình học hợp lệ, mask frame/timestamp, planar RGB trước `maskedmerge` | chữ nhỏ, moving text, flicker, residual ngoài ROI |
| STTN | decoded RGB/audio/timestamp parity với mask cố định; peak scratch | nền phục hồi có thể mượt hơn vùng lân cận, không coi là khôi phục nguyên bản |
| Subtitle | cue ID, timing, ASS/font smoke và vùng hiển thị | readability, line wrap, tiếng Việt/Unicode và từng language |
| Audio/TTS | nonempty PCM, trim -50 dB, onset 30 ms, offset 100 ms, tempo ≤1.45x, gap mục tiêu 0.50 s | đầu/cuối câu, giọng tự nhiên, semantic rephrase |
| Separation | provider/fallback được ghi, không source-audio fallback khi contract cấm | dialogue suppression, BGM/SFX leakage, damage |

OCR chỉ được chấm trong `scanRegion` đã chọn. Chữ ngoài ROI là coverage
boundary, không được âm thầm coi là lỗi toàn khung. Profile `accurate` và `fast`
phải có kết quả riêng; `fast` không được gọi là tương đương nếu timeline khác.

## Manifest mẫu

Mỗi dòng report cần `caseId`, source/config/runtime hash, variant, hardware,
requested/effective provider, cold/warm/cache state, n quan sát, duration,
active/wait stages, peak RAM/VRAM/scratch, output hashes và từng chiều
`pass|fail|unverified`. Không đưa transcript, prompt, token, cookie hoặc đường
dẫn riêng vào report.

## Trạng thái lượt này

Đã chạy unit/contract cho OCR timeline, planar mask path, STTN stream reader,
TTS policy và content QA. Chưa chạy corpus media tám clip, human contact sheet,
server-backed TTS/translation hoặc full hardware matrix trong lượt triển khai
này. Những phần đó vẫn là gate trước release và trước khi gọi một biến thể là
“giữ nguyên chất lượng”.
