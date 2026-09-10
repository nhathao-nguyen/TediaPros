# AutoShort: đánh giá OCR CPU → GPU, 2026-09-09

## Kết luận

**Đáng thử triển khai GPU OCR có kiểm soát trên máy này.** Microbenchmark detector
thật trên GTX 1660 SUPER 6 GB cho thời gian inference sau warm-up giảm từ
322.149 xuống 28.775 ms/khung (11.195x). **Không được diễn giải thành OCR toàn
phần hoặc AutoShort nhanh hơn 11 lần.** Chưa đo pipeline đầy đủ bằng GPU.

OCR đang giữ cả suất `local-cpu-heavy` và `local-gpu-heavy` kể cả khi chạy CPU.
Đổi provider không thêm khóa tài nguyên mới; nếu OCR nhanh hơn, các bước phụ
thuộc có thể chờ ít hơn. Nó không tự mở thêm song song cho toàn hàng đợi.

Phạm vi: kiểm tra và thử nghiệm cô lập; không đổi runtime, cài dependency, sửa
source sản phẩm, restart ứng dụng, dừng job hoặc xóa cache của người dùng.

## 1. Runtime hiện có — TEST_CONFIRMED / CODE_CONFIRMED

- Managed executable: `C:/Users/PC/AppData/Roaming/tedia-pros/bin/ocr-engine/ocr-engine.exe`.
- Chạy mới `--version` và `--probe`: `1.2.0`, `ready:true`, `gpu:false`,
  fingerprint `1e0c8bd778d9d97cf129c891e053b0421f5b43b4c3d0914e29e38c63b614c6a4`.
- Import ONNX Runtime trực tiếp từ `_internal` bằng Python chẩn đoán:
  `1.29.0`, providers `AzureExecutionProvider`, `CPUExecutionProvider`; không có DML.
- Python ngoài ứng dụng có ORT `1.24.4` với DML. Detector model cài sẵn chạy
  được trên DML trong phép thử tách biệt. GPU/driver không phải trở ngại của phép thử này.
- Thư mục runtime có cả metadata CPU và DirectML, nhưng **metadata/DLL hiện diện
  không chứng minh provider được nạp**; kết quả import và probe mới là bằng chứng.
- `engines/ocr-engine/requirements.txt` ghim CPU `onnxruntime==1.29.0` và
  RapidOCR `1.4.4`. Runtime đang cài chứa metadata/source RapidOCR `1.2.3`.
  Source `rapidocr_onnxruntime/utils.py` trong runtime chỉ chọn CUDA/CPU, không
  chọn DML; không thể coi việc thay một gói ORT là đủ để chuyển cả OCR sang GPU.
- `tao_ocr()` tại `engines/ocr-engine/engine.py:202` thử DML rồi fallback CPU khi
  khởi tạo thất bại; lý do fallback bị nuốt. `--probe.gpu` kiểm tra khả năng tạo
  detector session riêng, không chứng minh ba session det/cls/rec của RapidOCR.
- Các thuộc tính provider-report hiện tại không khớp `text_detector.infer.session`,
  `text_cls.infer.session`, `text_recognizer.infer.session` trong RapidOCR 1.2.3.
  Audit đang có `ocrProvider: {det:null, cls:null, rec:null}` nên không dùng nó để
  kết luận GPU thực thi. Không thay đổi telemetry trong task này.

## 2. Đo detector trên video thật — TEST_CONFIRMED, phạm vi hẹp

[detector-probe.py](./detector-probe.py) dùng model cài sẵn
`ch_PP-OCRv3_det_infer.onnx`, SHA-256
`3439588c030faea393a54515f51e983d8e155b19a2e8aba7891934c1cf0de526`.

Input là video `7675331033864178944` trong `F:/Son/doyuin/VideoInput`, lấy
3 khung ở 5/35/90 giây. Dùng ROI của audit (x=0..1080, y=1382..1766), halo 32px,
normalization/resize của detector RapidOCR cài sẵn. Tensor `[1,3,736,1760]`.

| Số đo | CPU | DirectML GPU |
| --- | ---: | ---: |
| Tạo session | 96.814 ms | 438.885 ms |
| Lần inference đầu | 286.911 ms | 3482.460 ms |
| Inference warm trung bình, 9 lần | 322.149 ms | 28.775 ms |
| Inference warm trung vị | 323.742 ms | 28.040 ms |

Hai nhánh dùng cùng ORT DirectML 1.24.4, model và tensor; ép provider khác nhau,
CPU chạy trước GPU. Không so runtime CPU 1.29.0 đóng gói trực tiếp với GPU 1.24.4.
Phép đo bao gồm `session.run()`/trả output về host, không gồm giải mã video,
preprocess, polygon postprocess, phân loại chiều chữ, nhận dạng ký tự, mask,
dịch, TTS hoặc render. Chỉ ba khung/một lượt môi trường, không phải load test.

Một session profiling riêng, ngoài đoạn tính thời gian, ghi nhận **202 Node
events có provider DirectML**, không ghi Node event CPU. Dữ liệu còn tại
`C:/Users/PC/AppData/Local/Temp/tedia-ocr-gpu-probe-f18x0njt/dml_2026-09-09_23-09-59.json`.
Sai khác cực đại output khoảng `3.20e-5`; binary map ở ngưỡng 0.3 có IoU=1.0
trên cả ba khung. Đây không phải kiểm chứng text, polygon cuối hoặc chất lượng
che chữ xuyên suốt video. Chi phí khởi động GPU lớn hơn rõ rệt.

## 3. Có block luồng không?

Phân biệt ba khái niệm:

| Loại chờ | Bằng chứng hiện có | Ảnh hưởng nếu đổi GPU |
| --- | --- | --- |
| Giao diện/event loop Electron | `ocr.ts:487` spawn sidecar bất đồng bộ; probe scheduler vẫn chạy `setImmediate` khi chờ lease | Không có cơ sở cho rằng đổi provider tự khóa main thread; chưa thử UI full-load GPU |
| Phụ thuộc pipeline | `autoShortItemCoordinator.ts:659,1235,1306,1455,1490`: OCR, tách giọng, TTS, join visual, render | Tách giọng chờ OCR; TTS nằm sau tách giọng khi bật `separate-vocals`; render cần visual xong |
| Hàng đợi tài nguyên | `autoShortResourceManager.ts:72,186`: FIFO chung, không bỏ qua request đầu khi thiếu tài nguyên | Có thể giữ request server dù server rảnh; hiện tồn tại cả với CPU OCR |

[resource-wait-probe.mjs](./resource-wait-probe.mjs) chạy **class thật**:

1. OCR giữ CPU+GPU; enqueue tách giọng cần CPU+GPU.
2. Enqueue request chỉ cần server; server đang có 0 allocation nhưng request vẫn chờ.
3. Nhả OCR: cả tách giọng và request server được cấp; cuối probe allocation về 0.

Đây là chờ đầu hàng đợi đã tái hiện, không phải bằng chứng một job production
cụ thể từng deadlock. Cấp bộ tài nguyên atomically và nhả trong `finally` tránh
kiểu deadlock lấy khóa ngược thứ tự; không khẳng định mọi native-driver hang bất khả thi.

Mặc định một video hoạt động (`autoShortExecutionPolicy.ts:8`). Với nguồn Whisper,
OCR visual được khởi chạy sau ASR và có thể overlap dịch (`coordinator:969`).
Với OCR làm nguồn phụ đề, dịch cần chờ OCR. `whisper-ocr` gọi hai nhánh nhưng
cả hai cần suất CPU nặng nên không đồng nghĩa thực thi đồng thời. Nếu audio mode
không cần tách giọng, không áp dụng kết luận “TTS phải chờ bước tách giọng”.

Watchdog OCR hiện có mốc khởi động 180 giây và không có tiến độ 120 giây
(`ocr.ts:503`), cùng hủy cây tiến trình. Không có bằng chứng về tự chạy lại toàn
item bằng CPU khi GPU lỗi giữa inference; lỗi item được xử lý và queue có thể
đi tiếp item sau. Các kiểm thử xác nhận đường hủy/lỗi mô phỏng, không phải thử
GPU driver hang thật.

## 4. Lợi ích toàn AutoShort — INFERRED / UNKNOWN

- Dự kiến hữu ích nhất khi OCR phải quét mới nhiều khung ở profile `accurate`.
  CPU vẫn xử lý giải mã, chuẩn hóa, hậu xử lý và các bước không được chuyển.
- Cache hit gần như không hưởng lợi từ GPU. Các audit job `63b6a6c4...` ghi nhiều
  hit chỉ mất 24–185 ms; không dùng chúng để đo speedup.
- Trace `de92621d...` ghi visual OCR 701.225 giây / toàn item 1353.147 giây,
  nhưng metadata có `engineVersion=1.1.0` đồng thời fingerprint streaming mới
  và provider null. Nó cho thấy workload OCR lớn, **không** là baseline sạch
  cho runtime 1.2.0 hay bằng chứng tỷ lệ cải thiện end-to-end.
- Luồng trên được xác nhận bằng checkout hiện tại và fixture. Chưa xác nhận
  source coordinator khớp hoàn toàn binary TediaPros đang mở: archive báo
  package 0.1.23 nhưng đọc entry `out/main/index.js` trực tiếp không tìm thấy;
  có các bản main dưới `.worktrees`. Không sửa hay suy diễn lỗi ứng dụng từ đó.

## 5. Điều kiện trước khi bật GPU cho batch thật

1. Build runtime cô lập, đúng bộ dependency; xác nhận det/cls/rec session và
   thực thi inference thật, không chỉ dựa vào `--probe.gpu`.
2. Dùng `enable_mem_pattern=false`, `ORT_SEQUENTIAL`, không gọi đồng thời `Run`
   trên cùng session DML. Đây là ràng buộc session, không có nghĩa Electron phải
   chạy đồng bộ. [Tài liệu ONNX Runtime DirectML](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html#configuration-options).
3. A/B CPU/GPU cùng video/ROI/8fps/models trên user-data và output riêng, tránh
   cache hit (key hiện không gồm provider/runtime identity). Không xóa cache thật.
4. Đo cold/warm, tổng wall-time, CPU/GPU/VRAM peak, OCR cue/mask parity, cancel,
   lỗi GPU và tiếp tục queue; giữ một GPU-heavy lane ban đầu trên máy 6 GB.
5. Xử lý FIFO/head-of-line như thay đổi scheduler riêng nếu được yêu cầu; không
   tăng `maxActiveItems` hoặc bỏ lease cùng lúc với đổi provider chưa được đo.

## 6. Kiểm chứng task

- `npm.cmd run typecheck`: PASS, node + web.
- 6 suite local-runtime: **48/48 PASS**; resource-manager 8, stage-scheduling 1,
  queue-throughput 4, item-scope 8, OCR-pipeline 12, OCR-runtime 15.
- Detector GPU thật và scheduler diagnostic: PASS trong phạm vi mô tả trên.
- Chưa chạy full GPU OCR, GPU AutoShort A/B, bài stress VRAM/driver hoặc bản
  đóng gói GPU. Không claim triển khai xong.
