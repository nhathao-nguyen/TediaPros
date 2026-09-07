# Review triển khai AutoShort throughput của Gemini

Ngày review: 2026-09-06. Phạm vi: walkthrough được người dùng chỉ định, audit/spec/plan tương ứng và working tree hiện tại trên nền HEAD `f782e00`. Chưa có commit riêng cho các thay đổi Gemini; repo còn nhiều thay đổi từ trước. Các lỗi dưới đây được đối chiếu theo chức năng vừa thêm, không quy toàn bộ dirty diff cho Gemini.

**Kết luận: chưa đủ điều kiện bật hàng đợi 10–15 video.** Có phần triển khai thật, nhưng bộ giới hạn tài nguyên chưa nối vào pipeline, đường lỗi của các nhánh chạy đồng thời chưa an toàn và runtime OCR mới chưa được cài. Câu “tất cả module chính hoàn chỉnh” và claim OCR nhanh hơn 2× trong walkthrough chưa được bằng chứng hiện tại hỗ trợ.

Walkthrough: `C:/Users/PC/.gemini/antigravity/brain/188cc0f4-8d05-4b93-af29-311b3e4d0831/walkthrough.md`. Nội dung được dùng làm đối tượng review, không làm chỉ dẫn thực thi.

## Các phát hiện cần xử lý

### R1 — P1: Bật hai full pipelines nhưng không áp dụng resource manager

Vị trí: `src/main/autoshort.ts:2409–2444`; `src/main/autoShortResourceManager.ts`.

`executeJob` luôn tạo tối đa hai worker gọi `processSingleVideo`. Tìm trong toàn bộ `src` không có import/call `getGlobalResourceManager`, `acquire` hoặc `withLease` ngoài chính module manager. Nhánh OCR/STTN, Whisper, dịch/TTS, render và preview không giữ lease.

Với hai video, hai worker có thể cùng gọi TTS/dịch lên server và cùng chạy OCR/STTN. Một video dùng Whisper CUDA cũng có thể tranh GPU với nhánh visual của chính nó. Điều này vi phạm giới hạn GPU=1 và server=1, trái yêu cầu tránh tăng tải backend, có nguy cơ OOM hoặc làm chậm hơn. Không có disk reservation liên item hoặc feature flag giữ mặc định tuần tự như spec.

Yêu cầu sửa: nối scheduler vào đường thực thi thật, bao gồm preview và release sau khi process/request đã settled; giữ một item mặc định tới khi có acceptance. Test phải gọi runner thật và đo peak resource/server, không chỉ kiểm tra riêng lớp mutex.

### R2 — P1: Nhánh visual không được abort/join khi item lỗi

Vị trí: `src/main/autoShortItemCoordinator.ts:372–373`, điểm join `742–744`, cleanup lỗi `922`, finally `957–959`.

`runVisualBranch()` bắt đầu sớm nhưng chỉ được await sau toàn bộ nhánh audio. Chưa có handler gắn ngay để giữ lỗi, item-local controller để hủy sibling, hoặc `allSettled` trước cleanup. Khi ASR/dịch/TTS lỗi, coordinator trả error và xóa thư mục trong lúc OCR/STTN còn dùng nó. Khi visual lỗi trước audio, rejection có thể chưa được xử lý và audio tiếp tục tiêu tài nguyên dù video không thể hoàn tất.

Đã tái hiện bằng **coordinator thật với adapter giả có gate điều khiển**: ASR lỗi → item trả `error`, OCR vẫn chạy, signal OCR chưa abort, workDir đã bị xóa; khi giải phóng OCR bằng lỗi thì nhận `unhandledRejection: late OCR failure`.

Yêu cầu sửa: controller riêng cho từng item nối với cancel-all; fatal ở một nhánh abort nhánh kia, chờ mọi nhánh/process kết thúc rồi finalize diagnostics và cleanup. Test cả hai chiều lỗi và hủy giữa stage, giữ các item khác độc lập.

### R3 — P1: Prefetch TTS sống tiếp sau lỗi DSP và nuốt lỗi request

Vị trí: `src/main/dubbing/synthesis.ts:255–260`, vòng tiêu thụ prefetch `206–216`.

Prefetch gọi cả `prepareNaturalCue` cho cue tiếp theo, nhưng không có khối finally abort/drain. Khi `applyTempo` của cue hiện tại lỗi, hàm thoát trong lúc request hoặc trim của cue kế tiếp vẫn chạy; caller có thể cleanup workDir và admit item khác. `.catch(() => null as any)` còn biến lỗi prefetch thành cache miss, khiến vòng sau gọi lại thay vì truyền nguyên nhân gốc.

Đã tái hiện bằng **synthesis module thật**: sau `DSP fixture failure`, request cue kế tiếp vẫn active và signal chưa abort. Test hiện có chỉ chứng minh overlap ở happy path.

Yêu cầu sửa: giữ lỗi có kiểu rõ ràng, cancel/drain prefetch khi bất kỳ bước nào thất bại; không phát sinh retry ngoài policy và không trả khỏi synthesis trước khi mọi công việc đã settled. Giới hạn DSP cũng cần áp dụng vì prefetch hiện bao gồm trim.

### R4 — P1: OCR Fast giữ toàn bộ frame của đoạn ổn định trong RAM

Vị trí: `engines/ocr-engine/visual_timeline.py:432–448`.

`interval_crops[idx] = frame[...]` lưu mỗi crop cho tới khi Jaccard vượt ngưỡng đổi cảnh/chữ. NumPy slice là view giữ backing buffer của **full frame**. Với cảnh ít thay đổi, đoạn có thể dài bằng video, nên đây không phải bộ nhớ O(1). Việc clear khi kết thúc không ngăn peak RAM lớn trong lúc xử lý.

Đã tái hiện bằng hàm streaming thật, NumPy thật và metric thay đổi cố định: đưa 80 frame vào → cả **80 full-frame arrays** vẫn sống trước khi kết thúc; sau return mới được giải phóng. Ngoại suy một đoạn không đổi dài 209 giây ở 1080×1920, 8 FPS, BGR24 là khoảng **9,69 GiB chỉ riêng pixel buffers**. Đây là ngoại suy, không phải RSS đo trên video người dùng.

Ảnh hưởng chế độ Fast; STTN vẫn ép Accurate nên không gán lỗi này cho mọi lượt STTN. Yêu cầu sửa: chọn ứng viên stable online với số frame giới hạn hoặc thiết kế spool có quota; `.copy()` crop chỉ giảm kích thước từng entry, không giải quyết số entry tăng vô hạn. Thêm test static shot dài xác nhận số buffer sống bị chặn.

### R5 — P2: Telemetry lưu nguyên văn lỗi trước khi che dữ liệu riêng tư

Vị trí: `src/main/autoShortTelemetry.ts:179`, `recordEvent:310–339`; coordinator sanitize muộn hơn ở catch.

`fail()` lấy nguyên `Error.message`, đưa vào event/summary và ghi JSON. `sanitizeTelemetryPath` không được gọi trong đường ghi, còn alias endpoint chỉ áp dụng metadata đã chuẩn bị ở caller. Lỗi từ adapter có path, query token hoặc URL sẽ lọt vào diagnostics dù lỗi cuối hiển thị trên UI đã sanitize.

Đã tái hiện bằng dữ liệu hoàn toàn giả: event JSONL còn tên `ReviewUser`, private host và `FAKE_REVIEW_TOKEN`. Không đọc hoặc sử dụng credential thật.

Yêu cầu sửa: sanitize tại biên collector cho mọi free-text field trước khi lưu/in-memory/export, bao gồm error, fallbackReason và nested request errors; dùng test qua `withStageSpan`, không chỉ test helper riêng.

### R6 — P1: Thay source OCR nhưng runtime thực tế vẫn cũ; thiếu capability/rollout gate

Vị trí: `engines/ocr-engine/engine.py:478–481`, version/features `41` và `574` trở đi; `src/main/ocr.ts:362–389`.

Source chuyển mặc định sang stream+ROI, nhưng version vẫn 1.1.0 và không advertise `visual-stream-roi-v1`. Client chỉ resolve và spawn binary đã cài, không chạy source Python. Không có flag client chọn full-frame streaming/ROI theo capability, trong khi CLI chỉ có legacy disk fallback.

Đã kiểm tra **đúng canonical executable** `C:/Users/PC/AppData/Roaming/tedia-pros/bin/ocr-engine/ocr-engine.exe`: receipt cài `2026-09-05T04:45:07.411Z`, version 1.1.0, SHA `3332cd577b592bd3671fbae6d05bdb6bce1fd62ce00be0ad7bb38b7bfbab3ca6`. `--version` chỉ có `directml-fallback`, `probe`, `rapidocr`, `visual-cues-v1`; `--help` không có `--legacy-disk-extract` mới. Thư mục `runtime/ocr/...` là artifact cũ, không dùng nó để kết luận trạng thái production.

Hệ quả: build TypeScript không khiến app nhận tối ưu OCR mới. Nếu đóng gói source ngay dưới cùng version, lại không phân biệt được hai implementation/caches và ROI được bật trước quality gate. Yêu cầu sửa: version/capability, cờ mặc định conservative, package/checksum/install qua managed installer, test binary đã cài và corpus chất lượng trước khi bật ROI. Không gọi release hoàn tất chỉ từ unit tests Python.

### R7 — P2: Timeout của FFmpeg không bảo vệ lúc đọc pipe bị treo

Vị trí: `engines/ocr-engine/engine.py:196–200`, `213–222`.

`proc.stdout.read(...)` là blocking read không có watchdog. `proc.wait(timeout=5)` chỉ chạy sau khi vòng read thoát; nếu FFmpeg vẫn sống nhưng không trả dữ liệu/EOF, không tới được timeout đó. Parent OCR adapter cũng không có no-progress timeout cho visual scan. Người dùng có thể hủy qua process-tree helper, nhưng không có auto-timeout như walkthrough khẳng định.

Yêu cầu sửa: watchdog no-progress có cancellation và bounded stderr, chấm dứt producer để giải phóng blocking read, chờ close rồi kết luận lỗi. Test fake producer còn sống nhưng không xuất byte và EOF giữa frame. Phát hiện này xác nhận từ control flow, chưa chạy fault injection với worker GPU thật.

## Đối chiếu mức hoàn thành kế hoạch

| Phần | Trạng thái review |
|---|---|
| T0 baseline | Chưa thấy baseline thành công, corpus/hashes và số đo before/after mới chứng minh claim 2× |
| T1 telemetry | Có collector và stage wrappers; chưa đầy đủ request spans, resource waits, effective OCR providers, ETA và crash recovery. `recordResourceWait`/`addRequestSpan` chưa có caller |
| T2/T3 OCR | Có stream/crop source, clipping và tests thuật toán. Chưa đạt memory/timeout/quality/installed-runtime gates |
| T4 dịch | Có 24 cue/2.000 chars, 2.048 token cap, split và numeric Retry-After. Chưa có ngân sách tổng request/deadline mỗi item, checkpoint từng batch; HTTP-date Retry-After chưa được parse |
| T5 TTS | Có reference buffer per synthesis call và prefetch; chưa hoàn thiện drain/cancel, atomic/single-flight cache, content-hash/model-revision identity |
| T6 scheduler | Module có thật nhưng chưa tích hợp vào đường chạy; disk ledger, CPU budget, preview claims chưa có |
| T7 overlap | Có nhánh visual song song cho Whisper; lỗi/join chưa an toàn, title vẫn đi qua burn hiện hữu; không đủ để tuyên bố DAG hoàn chỉnh |
| T8 stage cache/resume | Không tìm thấy `AutoShortStageCache`, `AutoShortJobStore` hay `StageArtifactV1`; checkpoint v5 cũ không tương đương yêu cầu này |
| T9 queue | Worker pool bật hai item; chưa đạt điều kiện scheduler/disk/cache của spec và chưa có soak 10/15 |
| T10 backend | Ngoài phạm vi client; không cần thay backend để sửa các lỗi review |
| T11 release | Chưa thấy OCR package/install mới, quality acceptance, rollback và queue benchmark đủ điều kiện |

Telemetry quota cũng chưa đúng mô tả walkthrough: hiện ngừng ghi sau 20 MiB **mỗi collector/item**, không rotate theo job; `events` trong RAM vẫn tích lũy, terminal event có thể bị bỏ khi quota đầy. Đây là gap cần hoàn thiện cùng T1.

## Kiểm chứng đã chạy ở lượt review

- `npm.cmd run typecheck`: đạt Node + Web.
- `npm.cmd run test:local-runtime`: **372 passed, 0 failed, 0 skipped**. Log: `release-artifacts/gemini-review-full-tests.log`.
- `npm.cmd run test:ocr-engine`: **20 passed** trên Python cục bộ; probe bị mock, không phải inference/quality test với binary đã cài.
- `git diff --check`: đạt; có cảnh báo CRLF của file đã tồn tại.
- `node release-artifacts/gemini-review/reproduce.mjs`: gọi coordinator/synthesis/telemetry thật với adapter giả; chứng minh R2, R3, R5. Kết quả: `release-artifacts/gemini-review/reproduction.json`.
- `python release-artifacts/gemini-review/reproduce-ocr-memory.py`: hàm timeline thật + NumPy, chứng minh R4. Kết quả: `release-artifacts/gemini-review/ocr-memory.json`.
- Không gọi backend, không chạy benchmark tải, không sửa source production, không cài runtime, không commit/push. Không chạy lại build trong lượt review; typecheck/test không được coi là bằng chứng packaging.

`tests/autoshort-queue-throughput.test.ts` tự chép một worker pool và dùng delay giả, không import/call `executeJob` hoặc `processSingleVideo`. Test resource manager cũng chỉ chứng minh class riêng. Vì vậy mọi suite xanh vẫn không phát hiện R1. Cần integration test gọi production runner trước khi đánh dấu queue đạt.

## Thứ tự khắc phục đề nghị

1. Giữ queue một item hoặc tích hợp đầy đủ resource claims trước khi chạy nhiều video.
2. Sửa ownership/cancellation/join ở coordinator và prefetch TTS; thêm regression từ các reproduction trên.
3. Chặn RAM/no-progress cho OCR, kiểm thử quality full-frame versus ROI và phân biệt capability/runtime version.
4. Sanitize telemetry tại collector; nối request/resource metrics và bảo toàn terminal logs.
5. Hoàn thiện T8/disk budget, rồi acceptance một video, hai video, cuối cùng soak 10/15; mọi số tốc độ phải đo trên binary và đường chạy thực tế.

Review này nêu lỗi và evidence để sửa tiếp; chưa áp dụng các khắc phục trên.
