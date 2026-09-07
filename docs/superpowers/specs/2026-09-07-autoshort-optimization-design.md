# Auto Short: thiết kế đợt cải thiện hiệu năng, tốc độ và chất lượng

Ngày 07/09/2026. Trạng thái: **đề xuất để triển khai theo từng gói**, chưa thay đổi sản phẩm.
Nguồn: [review hệ thống](F:/Son/tool/TediaPros/docs/reviews/2026-09-07-system-review/REPORT.md) và [khảo sát hiệu năng](F:/Son/tool/TediaPros/docs/reviews/2026-09-07-system-review/AUTOSHORT_PERFORMANCE.md).
Snapshot được đối chiếu: main, `6291184eddc6df893ef13eaae68bdd1d27736812`, app 0.1.22.

## 1. Mục tiêu và phạm vi

Giảm thời gian hoàn thành một video, tăng throughput batch trong ngân sách phần cứng, giảm scratch/cache không cần thiết và tăng độ đúng của phụ đề/lồng tiếng/xử lý hình. Không dùng tốc độ xử lý làm lý do bỏ câu, tăng tempo ngoài policy hoặc giảm thông tin OCR.

Phạm vi chính là Auto Short và các phụ thuộc trực tiếp: OCR, Whisper, dịch/TTS, STTN, separation, burn, cache, scheduler, IPC/GUI, runtime/release. Chín phát hiện R1–R9 của review được đưa vào kế hoạch vì liên quan tính đúng, đầu vào hoặc khả năng vận hành. Không viết lại toàn app, không đổi licensing, không thiết kế thêm sản phẩm độc lập.

Kế hoạch phân biệt:
- **Sửa lỗi bắt buộc:** kết quả sai, vượt policy, lifecycle, containment và release verifier.
- **Tối ưu có thử nghiệm:** stream-full, prefetch, overlap, cache; chỉ bật mặc định sau gate.
- **Nhánh có điều kiện:** server conditioning, worker thường trú, hai item đồng thời; dừng ở kết luận không triển khai nếu số đo không có lợi.
- **Nghiên cứu chưa đủ bằng chứng:** ROI OCR, precision/model/encoder khác; không thuộc cấu hình mặc định của đợt này.

## 2. Ba phương án và lựa chọn

| Phương án | Lợi ích | Đánh đổi |
| --- | --- | --- |
| Sửa tính đúng → đo baseline → tối ưu lần lượt (chọn) | Biết chính xác thay đổi nào làm nhanh/chậm hoặc đổi chất lượng; rollback nhỏ | Nhiều mốc nghiệm thu hơn |
| Bật ngay stream/overlap/prefetch/hai item | Nhanh có bản thử | Runtime OCR hiện không đủ capability; race R4/R5 chưa xử lý; khó quy nguyên nhân |
| Viết lại orchestrator/đổi model toàn diện | Có thể thiết kế lại mọi giới hạn | Phạm vi lớn, khó giữ output; chưa có evidence cần viết lại |

Đơn vị release là một gói có thể bật/tắt và kiểm chứng độc lập. Dùng scheduler, telemetry, item scope, TTS cache hiện có; chỉ tách module khi có trách nhiệm mới rõ ràng.

## 3. Global Constraints

- Giữ nguyên LICENSE và NOTICE, PolyForm Noncommercial.
- Giữ typed IPC, validate dữ liệu tại Main; src/shared không import Node, Electron, React hoặc browser API.
- Giữ model/revision, precision, OCR 8 FPS ở flow đang dùng 8 FPS, geometry, STTN window và final encode settings trong phép so tối ưu tương đương.
- Tempo điều chỉnh theo policy: ưu tiên 1.10x, thông thường 1.25x, trần tuyệt đối 1.45x; raw TTS 1.0x là đầu vào tự nhiên, không buộc tăng tốc mọi câu.
- Chừa ít nhất 0.50s giữa các đoạn thoại kế tiếp theo policy dubbing; không nới hardEnd để hợp thức hóa audio không vừa. Nếu mốc nguồn không khả thi, rephrase/split đúng quy tắc hoặc báo lỗi.
- Trim giữ -50 dB, onset 30ms, offset 100ms; mọi thay đổi ngưỡng là thí nghiệm chất lượng riêng.
- Không silent drop cue, không cắt đuôi audio, không fallback âm nguồn vào chế độ separate-vocals.
- Blur dùng planar RGB trước maskedmerge; phạm vi xử lý chữ vẫn là vùng OCR người dùng chọn.
- MDX offline sau cài; pin URL/SHA-256. Giữ runtime-inputs.json và separator-model-inputs.json theo vai trò hiện tại, verifier đối chiếu cả hai; cập nhật tài liệu đang mô tả lệch, không bỏ pin để hợp nhất tên file.
- Scratch riêng từng item, cleanup sau close/drain. Cache bền vững là vùng riêng có quota, TTL và pin trong lúc đọc.
- Một local-gpu-heavy tại một thời điểm cho tới khi có qualification riêng; không nhả lease chỉ vì nhận abort.
- Mặc định maxActiveItems=1 trong các gói tối ưu đầu; prefetch server tối đa một request đang chạy.
- Bảo toàn replace/mix/separate-vocals, background music, subtitle styles, file người dùng và config cũ; migration phải có test.
- Không commit media/cookie/token/reference giọng vào Git hoặc log. Không sửa, reset, stash, clean các thay đổi ngoài phạm vi.
- Số đo cũ là evidence lịch sử; không gọi test mock hoặc build pass là E2E/live/production pass.

## 4. Kiến trúc đích

Flow Whisper:
```text
Preflight / fingerprint / cache lookup
                ↓
          ASR hoặc cache hit
                ↓
       ┌────────┴────────────────────┐
       │ Nhánh ngôn ngữ              │ Nhánh hình
       │ dịch → TTS + DSP prefetch    │ OCR → STTN hoặc timed mask
       │             ↓               │
       │       audio composition     │
       └────────┬────────────────────┘
                ↓
        final subtitle + burn ── chuẩn bị title
                ↓
     validate media → commit output/title → cleanup
```

Separation là tác vụ GPU cục bộ độc lập với request dịch/TTS sau preflight, nhưng phải xong trước audio composition. Scheduler không để nó làm mất cơ hội gọi server sớm. OCR/whisper-ocr giữ đúng thứ tự tạo/đối chiếu source cues; không áp lịch Whisper vào mọi mode.

Runtime capability quyết định transport thực tế. Requested/effective policy và lý do fallback được ghi lại. Kill switch chỉ đổi lịch/transport, không phục hồi các lỗi correctness đã sửa.

## 5. Hợp đồng cache và khôi phục

Cache theo stage dependency thay vì item ID:
- ASR: hash nguồn, audio stream, model/revision, language, decode options.
- Dịch: canonical source cues/context, source/target language, provider/model/revision, prompt/policy, options.
- OCR: hash nguồn, display geometry, ROI, sample FPS, model/profile, timeline algorithm. Transport được giữ trong key cho tới khi chứng minh tương đương.
- STTN: nguồn, digest visual mask/timeline, model/revision, precision/window/geometry và engine revision.
- TTS: tái sử dụng key v2 hiện có; không làm yếu reference content hash/options/model revision.
- Trim PCM: raw WAV content hash, trim policy, FFmpeg revision và audio format; timing/tempo đích không nằm trong cache trim.
- Render: chưa thêm cache MP4 toàn cục; ưu tiên giữ output đã có và chỉ render khi đầu vào cuối đổi.

Mỗi entry có version, digest, kích thước, lastAccess, trạng thái verified. Atomic temp → verified publish. Lease pin bảo vệ reader; cleanup không xóa entry đang dùng. Corrupt/missing là miss, không là success. Cache source audio/video lớn mặc định tắt; metadata/cues/trim được thử quota nhỏ trước.

Checkpoint giữ graph tiến độ và tham chiếu artifact đã xác minh; khi app crash, chỉ resume từ stage hợp lệ. Publish thành phẩm dùng đường dẫn dự phòng riêng; không overwrite output cũ. Durable cache không biến scratch thành thư mục lưu vô hạn.

## 6. Chất lượng: hai đường kiểm chứng

**Tối ưu tương đương:** cùng model/runtime/provider, frozen translation/TTS inputs. So decoded RGB/timestamps, timeline/mask, cue/text/timing, PCM ở các stage kỳ vọng deterministic. Container metadata khác không đủ kết luận chất lượng khác. Cross-device/backend inference có thể không bit-identical: ghi khác biệt và xét chất lượng riêng, không bỏ qua.

**Sửa chất lượng có chủ đích:** R1 hoặc rephrase đúng policy có thể thay output cũ. So với yêu cầu nghiệp vụ và bộ tham chiếu được duyệt, không đòi tái tạo output đang sai. Cue-ID completeness chỉ là kiểm tra cấu trúc; ASR đối chiếu tiếng nói là tín hiệu nghi vấn, không tự động chứng minh ý nghĩa đúng hoặc tự xóa câu.

Đánh giá thêm: tên riêng/số/phủ định, nội dung rephrase, onset/offset không cụt, khoảng nghỉ, residual text và flicker, nét khuôn mặt ngoài vùng mask, SFX/background, subtitle clipping và font nhiều ngôn ngữ. Human review tập trung các mẫu thay đổi hoặc nghi vấn; full ASR/LLM QC không bật trên mọi job vì tăng latency/chi phí.

## 7. Đo lường và ngưỡng quyết định đề xuất

Các ngưỡng dưới đây là tiêu chí dự kiến, không phải kết quả hay cam kết đạt:
- Corpus cốt lõi: ít nhất 8 clip đại diện gồm chữ nhỏ/chuyển cảnh/thoại dày/VFR hoặc rotation/audio offset/nhiều ngôn ngữ; thêm 1 video dài và batch 20 item cho soak. Có manifest checksum, config và quyền dùng dữ liệu; không invent file chưa có.
- Mỗi A/B ít nhất 3 cặp, đảo AB/BA, cùng model warm state và cache state. Báo median và range; chỉ báo p95 có ý nghĩa vận hành khi có tối thiểu 20 quan sát tương đương, kèm n.
- Gate tối ưu: không regression chất lượng; cải thiện lớn hơn 2 lần độ dao động tương đối đo ở baseline lặp. Mục tiêu chọn việc là ít nhất 5% E2E hoặc 10% stage đang chiếm đáng kể thời gian. Không đạt thì giữ experimental/off hoặc bỏ thay đổi.
- Không che trường hợp chậm bằng trung bình: công bố từng class và cold/warm/rerun. Regression latency trên class bất kỳ >5% cần điều tra trước đổi mặc định.
- Đo peak RAM/VRAM/scratch và quota theo volume; chưa đặt trần GB theo suy đoán. Chỉ chạy hai item nếu có headroom thật và batch không OOM/ENOSPC.
- Correctness gate: 0 output success giả, 0 cue bị drop âm thầm, 0 tempo vượt trần, 0 slot oversubscription trong fault tests, 0 child mồ côi sau teardown đã xác minh.
- Telemetry overhead mục tiêu <2% median E2E so với tắt instrumentation cùng workload; nếu không đạt, giảm sampling và giữ terminal events.
- Không gom tổng active time stage có overlap thành E2E; E2E đo theo đồng hồ monotonic của job.

## 8. Rollout và quay lui

Development → local opt-in → qualification thiết bị/provider → mặc định theo capability → release artifact đã test. Windows NVIDIA/DirectML/CPU và macOS ARM64 được công bố riêng; không suy “Windows pass” thành “mọi GPU/macOS pass”.

Fallback runtime không có streaming về legacy với reason; giữ archive/receipt trước để atomic rollback. Cache version mới không ghi đè cache cũ; kill switch bỏ đọc cache nhưng không xóa output. Overlap/prefetch/hai item có cờ độc lập; rollback về một item tuần tự vẫn giữ correctness fixes. Publish ra kênh ngoài và benchmark server tính phí chỉ chạy trong phạm vi được người dùng cho phép lúc thực thi.

## 9. Ranh giới thực thi

User đã yêu cầu lập kế hoạch đầy đủ; việc lập các tài liệu này được thực hiện ngay. Kế hoạch không tự cho phép triển khai, tải model lớn, thay server hay phát hành. Các bước cần input bên ngoài được gom tại gate liên quan, không chặn sửa lỗi/test cục bộ độc lập. Chi tiết đầu việc nằm ở master plan và bốn gói thực thi.
