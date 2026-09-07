# AutoShort Optimization Benchmark Protocol v1

- **Ngày:** 2026-09-07
- **Trạng thái:** schema và công cụ local đã được kiểm tra; baseline live chưa được chạy
- **Mục tiêu:** đo thời gian, tài nguyên và chất lượng trước khi bật từng tối ưu

## Phạm vi đo

Mỗi run phải ghi commit, biến thể cấu hình, source/config/runtime hash, provider
được yêu cầu và provider thực tế, trạng thái cold/warm/cache, số request/retry,
bytes request, thời gian active/wait theo stage, peak RAM/VRAM/scratch và trạng
thái chất lượng. Không ghi transcript, prompt, URL có credential, API key,
đường dẫn người dùng hoặc response thô.

`BenchmarkV1` trong `scripts/autoshort-benchmark-main.ts` chỉ nhận các trường
được whitelist. Hash phải là SHA-256 hex; RAM/VRAM không đo được ghi `null`,
không ghi `0` giả. `workload` phân biệt `fixed-output-replay`, `live-single` và
`live-batch`; `mode=replay` không được dùng để dự báo tốc độ inference live.

## Đo overlap đúng nghĩa

`calculateCriticalPathMs()` tính hợp các khoảng thời gian giao nhau. Khi ASR
20–120 ms chạy cùng visual OCR 40–80 ms, critical path là 100 ms theo mốc đầu
và cuối, không phải tổng active 140 ms. `e2eMs` lấy từ terminal job event hoặc
đồng hồ monotonic bao quanh job; không cộng span overlap để tạo số tổng.

Stage map vẫn giữ active và wait riêng để tìm nút nghẽn. Cache hit chỉ là tái sử dụng
artifact; không được trình bày như inference nhanh hơn. Trim PCM cache hit phải
ghi riêng thời gian copy và probe duration. Một biến thể chỉ được
coi là nhanh hơn khi median và p95 trên cùng workload, cùng source hash, model,
runtime, hardware và trạng thái cache vượt noise đo; phần trăm của các stage
không được cộng thành phần trăm toàn pipeline.

## Quy trình bắt buộc

1. Chuẩn bị manifest nguồn được phép dùng. Tối thiểu tám clip ngắn thuộc các
   lớp chữ, chuyển cảnh, VFR/rotation, audio offset và một clip dài; frozen
   WAV/cues chỉ dùng cho replay. Ghi hash file, không ghi tên riêng nhạy cảm.
2. Chạy mỗi biến thể ở trạng thái cold và warm/cache-hit riêng. Giữ model,
   geometry, sample FPS, trim policy, FFmpeg và encoder cố định khi đo một thay
   đổi I/O hoặc lịch chạy.
3. Chấm media bằng `autoshort-media-quality-matrix.md`, chấm cue mapping và
   token rủi ro bằng `autoshort-content-quality.md`; semantic fidelity và nghe
   giọng vẫn cần người duyệt. `quality=unverified` khi thiếu một gate.
4. Xuất JSONL vào thư mục run riêng, sau đó tổng hợp bằng lệnh có đường dẫn
   tường minh:

   ```powershell
   node scripts/summarize-autoshort-benchmark.mjs `
     --input release-artifacts/autoshort-benchmark/<run>.jsonl `
     --output release-artifacts/autoshort-benchmark/<run>.summary.json
   ```

   CLI không tự tìm manifest, API key hay output mặc định. Summary được ghi qua
   file tạm rồi rename nguyên tử.
5. Giữ cả run lỗi/hủy với terminal status và diagnostics đã redact. Không xóa
   output đã publish để làm đẹp benchmark; chỉ dọn scratch thuộc scope run.

## Gate hiện tại

Đã kiểm tra:

- critical path không cộng trùng overlap;
- schema bounded, endpoint alias và hash được redact;
- peak VRAM thiếu dữ liệu giữ `null`;
- summarizer từ chối input thiếu hoặc schema sai và ghi output nguyên tử.

Chưa có trong lượt này: manifest tám clip, benchmark live server/TTS, phép đo
hardware matrix, hoặc KPI before/after. Vì vậy chưa công bố phần trăm tăng tốc
cho AutoShort. Các cờ `maxActiveItems=2`, overlap, prefetch và stream OCR vẫn
phải qua protocol này trước khi đổi mặc định.
