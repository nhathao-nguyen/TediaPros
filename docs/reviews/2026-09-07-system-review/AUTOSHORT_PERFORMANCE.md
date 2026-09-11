# Auto Short: tăng tốc nhưng giữ chất lượng

Ngày: 07/09/2026. Snapshot: `main`, `6291184eddc6df893ef13eaae68bdd1d27736812`, app `0.1.22`.

**Kết luận:** còn cơ hội giảm thời gian chờ, I/O và tính toán lặp mà không chủ động giảm chất lượng model, mật độ OCR, độ phân giải hay chất lượng encode. Ưu tiên OCR streaming toàn khung, TTS prefetch một câu, rồi sắp xếp xử lý hình vào khoảng chờ dịch/TTS. Chưa có benchmark toàn pipeline cho các phương án này, nên chưa thể hứa tỷ lệ tăng tốc.

Đây là kết quả khảo sát, không phải thay đổi đã triển khai. Không sửa code sản phẩm hoặc cấu hình đang dùng. Flow dưới đây áp dụng cho Whisper + xử lý chữ bằng OCR/STTN; chế độ lấy phụ đề từ OCR có phụ thuộc khác.

## 1. Flow hiện tại và khoảng chờ

Mặc định: chuẩn bị → Whisper → dịch → tách thoại nếu chọn separate-vocals → TTS → ghép audio → OCR hình → STTN → render cuối → tạo tiêu đề nếu bật → kiểm tra/xuất kết quả.

[autoShortExecutionPolicy.ts:8](F:/Son/tool/TediaPros/src/main/autoShortExecutionPolicy.ts:8) đang đặt `maxActiveItems=1`, `overlapIndependentStages=false`, `prefetchTts=false`, `ocrTransport=legacy-disk`. Các đường thực thi tối ưu đã tồn tại một phần nhưng không bật mặc định.

Lịch đáng thử cho Whisper + STTN:

```text
Chuẩn bị → Whisper ┬→ dịch → TTS → ghép audio ──┐
                  └→ OCR hình → STTN ──────────┤→ render → kiểm tra/xuất
                                               ┘
```

Nếu dùng separate-vocals, thêm separation vào lịch tài nguyên cục bộ; audio cần instrumental trước khi trộn. Không chạy tất cả tác vụ GPU cùng lúc. Tạo tiêu đề có thể được chuẩn bị khi render nếu đầu vào tiêu đề đã chốt, nhưng chỉ ghi kết quả sau kiểm tra video.

## 2. Các cải thiện theo thứ tự ưu tiên

### A. OCR `stream-full`: giảm ghi/đọc PNG trung gian

**Hiện trạng:** [engine.py](F:/Son/tool/TediaPros/engines/ocr-engine/engine.py) có đường legacy xuất toàn bộ frame PNG ra đĩa, đọc kiểm tra kích thước rồi đọc cho OCR. Đường stream truyền raw frame qua pipe và queue giới hạn hai frame. Auto Short hiện yêu cầu legacy rõ ràng.

**Đề xuất:** thử `stream-full` với cùng model, profile, geometry và 8 mẫu/giây hiện tại. Đây là thay đổi vận chuyển frame, không chủ động cắt giảm lượng thông tin OCR. Lợi ích phụ thuộc thời gian PNG/I/O so với inference; không mặc định inference nhanh hơn.

**Điều kiện:** executable đang cài tại `C:/Users/PC/AppData/Roaming/tedia-pros/bin/ocr-engine/ocr-engine.exe` trả phiên bản `1.1.0`, features chưa có streaming. Cần runtime hỗ trợ, probe thành công và quy trình cài checksum hợp lệ. Bản build 1.2.0 trong tài liệu remediation trước đó còn lỗi thiếu dependency khi probe; không coi source có tính năng là đã deploy thành công.

**Giữ chất lượng:** so frame/timestamp thực tế và visual timeline trên video đại diện. Raw BGR và PNG decode cần kiểm chứng tương đương. Chưa ưu tiên `stream-roi`: crop có thể thay đổi ngữ cảnh/resize của OCR, nhất là chữ nhỏ hoặc sát biên.

### B. TTS prefetch một câu: che thời gian DSP

**Hiện trạng:** [synthesis.ts:272](F:/Son/tool/TediaPros/src/main/dubbing/synthesis.ts:272) đã có nạp câu tiếp theo trong lúc xử lý audio câu hiện tại. Mặc định tắt; chỉ có tối đa một request server đang chạy. Các bài kiểm thử bao gồm hủy/drain khi lỗi và so plan, thứ tự clip, timing giữa bật/tắt.

**Đề xuất:** thử bật có kiểm soát sau baseline. Giữ nguyên text, model, voice, options và quy tắc tempo. Phần tiết kiệm là DSP có thể chạy trong lúc đợi request kế tiếp, không phải làm inference server nhanh hơn. Khi DSP rất ngắn, lợi ích có thể nhỏ.

**Bằng chứng mới:** cả 5 test TTS pipeline pass; kiểm tra bằng fixture chưa chứng minh chất lượng tiếng nói live hay hiệu năng server thực.

### C. Đặt OCR/STTN sau Whisper, chạy cùng nhánh dịch/TTS

**Hiện trạng:** [coordinator:403](F:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts:403) khi bật overlap sẽ khởi động nhánh hình trước Whisper. OCR giữ cả slot CPU và GPU tại dòng 305; Whisper cũng cần CPU, thêm GPU nếu dùng CUDA. Vì thế bật cờ có thể chỉ đổi thứ tự sang OCR trước, làm chậm thời điểm bắt đầu dịch.

**Đề xuất:** Whisper xong thì khởi động nhánh OCR → STTN trong lúc nhánh ngôn ngữ chờ server. Chờ hai nhánh xong mới render. Trong trường hợp độc lập lý tưởng, thời gian hai nhánh từ tổng chuyển gần về giá trị lớn hơn; tranh chấp CPU, GPU, disk hoặc server sẽ giảm lợi ích đó.

**Điều kiện:** giữ một video đang chạy ở bước đầu. Sửa vòng đời resource lease trước khi tăng song song: [R5 trong review hệ thống](F:/Son/tool/TediaPros/docs/reviews/2026-09-07-system-review/REPORT.md) xác nhận slot được trả khi abort trước khi tác vụ dừng hẳn. Nếu thử hai video, xử lý thêm race disk ledger R4 và đo RAM/VRAM/đĩa. Hai video cùng chạy không bảo đảm mỗi video hoàn thành nhanh hơn.

### D. Cache riêng từng công đoạn: hiệu quả nhất khi chỉnh rồi chạy lại

**Hiện trạng:** đã có TTS cache v2 với key chi tiết và singleflight; visual OCR được memoize trong một lần xử lý. Checkpoint hiện gắn item ID, dùng fingerprint chung chứa cả cấu hình TTS; checkpoint bị xóa sau thành công. Đổi giọng có thể làm mất khả năng tái sử dụng bước nguồn/dịch, dù nội dung video không đổi.

**Đề xuất:** cache ASR, bản dịch, visual timeline và STTN theo dependency riêng của từng stage. Đổi voice chỉ tính lại phần phụ thuộc voice; đổi style phụ đề chỉ render lại nếu các đầu vào trước đó vẫn hợp lệ. Key cần nguồn/nội dung, model và revision, cấu hình, geometry/timestamps, phiên bản thuật toán; kiểm tra artifact trước khi dùng.

**Giới hạn:** không giúp lần chạy đầu. STTN lossless tốn dung lượng nên phải có quota/TTL/LRU và eviction an toàn. Không giữ toàn bộ scratch vô hạn. Với provider AI có tính ngẫu nhiên, tái sử dụng kết quả cũ cần được phân biệt rõ với yêu cầu tạo lại.

### E. Chuẩn bị tiêu đề trong lúc render

**Hiện trạng:** [completeBurnVideoTitle:1794](F:/Son/tool/TediaPros/src/main/burn.ts:1794) đợi render xong, probe duration thật, đọc SRT cuối rồi mới gọi tạo tiêu đề.

**Đề xuất:** chuẩn bị request khi phụ đề sau rephrase đã chốt, chạy cùng render; chỉ ghi `tieude.txt` sau video được xác thực. Nếu duration thật làm thay đổi SRT đầu vào, phải tính lại theo đầu vào đúng. Giữ hành vi lỗi tiêu đề không làm mất video thành công. Mức lợi ích chỉ là thời gian tạo tiêu đề có thể che được.

### F. Kiểm tra cache conditioning và model thường trú ở server TTS

Đây là hạng mục cần đọc wrapper server; chưa có bằng chứng deployment hiện tại đang làm thừa. [Mã nguồn Chatterbox multilingual chính thức](https://raw.githubusercontent.com/resemble-ai/chatterbox/master/src/chatterbox/mtl_tts.py) cho thấy chuẩn bị reference audio/conditioning là bước riêng và lưu trạng thái trong `self.conds`.

Nếu server đang lặp bước này cho mỗi cue, có thể cache conditioning theo nội dung reference, model/revision và tham số liên quan; giữ worker đã load model. Phải cô lập theo giọng/phiên và tránh request khác ghi đè `self.conds`. Client hiện đọc reference một lần trong mỗi lượt synthesis nhưng vẫn gửi reference trong request; giao thức dùng hash/session chỉ có ích khi server hỗ trợ rõ ràng.

Tương tự, worker Whisper thường trú có thể giảm load model trong batch, nhưng cần đo riêng thời gian load và ngân sách RAM/VRAM. Giữ model GPU có thể làm STTN thiếu bộ nhớ; xếp sau các phương án ít thay đổi hơn.

## 3. Những tối ưu đã có, không tính lại thành lợi ích mới

- TTS cache v2, chống request trùng, tái sử dụng các cue bootstrap, retry có giới hạn và local translation batching đã tồn tại.
- STTN đã có pipe lossless, giảm số file trung gian và chồng encoding với inference.
- [Benchmark STTN ngày 06/09](F:/Son/tool/TediaPros/docs/benchmarks/2026-09-06-sttn-storage-optimization.md) đo mẫu 306 frame, 10,435 giây, 1080×1920 trên GTX 1660 SUPER: 55,35 → 46,72 giây; lượt đảo thứ tự 54,34 → 44,77 giây. Giảm thời gian riêng stage khoảng 15,6–17,6%, RGB/timestamp/audio khớp theo báo cáo. Lần review này đọc lại JSON xác nhận wall time và RGB/timestamp; không chạy lại benchmark. Đây là tối ưu đã có và số đo mẫu trước đó, không phải mức tăng tốc toàn Auto Short còn có thể cộng thêm.

## 4. Cách quyết định có giữ nguyên chất lượng hay không

1. Ghi baseline theo stage: thời gian tính toán, thời gian chờ resource/server, cold/warm/cache hit, peak RAM/VRAM và disk. Tách latency một video khỏi throughput batch.
2. Thử từng thay đổi, cùng video/config/provider/model/codec. Với thay đổi lịch/I/O, dùng cùng WAV TTS đã tạo để loại bỏ ngẫu nhiên của dịch vụ AI; đo lại live riêng để biết lợi ích vận hành.
3. So frame decode và timestamp, visual cues/mask, text và timing phụ đề, PCM audio và độ đầy đủ clip ở các chặng phải tương đương. Nếu container metadata khác, không dùng riêng hash file MP4 để kết luận chất lượng khác.
4. Kiểm tra video thật có chữ nhỏ, chuyển cảnh, xoay khung, nhiều ngôn ngữ, thoại dày và các đường cancel/retry/thiếu đĩa. Chỉ đổi mặc định khi quality gate và kết quả đo đều đạt.

Không dùng giảm OCR FPS, giảm độ phân giải/STTN window, thay model nhẹ hơn, tăng CRF hoặc tăng tempo thoại để đạt yêu cầu “giữ nguyên chất lượng”. Review trước còn phát hiện tempo có thể vượt trần 1,45× (R1); đây là vấn đề chất lượng cần xử lý riêng, không phải cách tối ưu hiệu năng.

## 5. Kiểm chứng lượt khảo sát

- `npm.cmd run typecheck`: PASS, node + web.
- `npm.cmd run test:local-runtime -- autoshort-tts-pipeline.test autoshort-ocr-runtime.test autoshort-queue-throughput.test`: **22/22 PASS** (5 + 13 + 4), [log](F:/Son/tool/TediaPros/docs/reviews/2026-09-07-system-review/evidence/performance-focused-tests.log).
- Probe `--version` runtime OCR đã cài: 1.1.0, chưa có stream features.
- Chưa benchmark E2E mới, chưa chạy TTS/dịch live, chưa xác nhận backend wrapper hoặc GUI bật các tùy chọn này.

**Thứ tự đề nghị:** baseline → runtime OCR đạt probe + `stream-full` → TTS prefetch một câu → sửa resource lifecycle và đổi lịch overlap trong một video → cache từng stage. Chỉ xét hai video đồng thời sau khi các bước trên ổn định và số đo bộ nhớ cho phép.
