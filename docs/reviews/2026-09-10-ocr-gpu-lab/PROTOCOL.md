# Giao thức thử OCR GPU cô lập

Ngày chạy: 2026-09-09 đến 2026-09-10, Asia/Saigon. Đây là spike đã được người
dùng đồng ý, không phải thay đổi hoặc phát hành runtime sản phẩm.

## Phạm vi và hàng rào

- Dùng source coordinator/OCR/mask/render hiện tại từ checkout TediaPros.
- Chỉ sửa bản sao engine và harness trong
  `F:/Son/tool/TediaPros/.runner-staging/ocr-gpu-lab-20260909-v1`.
- Electron được stub để user-data, checkpoint, work, audit và output đi vào lab.
  Không mở UI thật. Không thay runtime, receipt, cài đặt hay cache của ứng dụng.
- Không khởi động lại ứng dụng, không dừng hàng đợi thật, không tăng concurrency.
- Dịch, TTS, tách giọng, Whisper và tạo tiêu đề đều không chạy. `fetch` trong
  harness bị chặn và đếm request. Các model đã có sẵn, không tải khi inference.
- Không suy rộng kết quả một video thành bảo đảm batch 90 video hoặc mọi GPU.

## Ma trận A/B chính

| Thuộc tính | CPU | GPU |
| --- | --- | --- |
| Case | `cpu-full-c` | `dml-full-c` |
| Thứ tự | Chạy trước, hoàn tất cả render | Chạy sau CPU, không đồng thời |
| Provider det/cls/rec | Ép `CPUExecutionProvider` | Ép `DmlExecutionProvider` |
| Python | 3.12.14 | Giống CPU |
| ONNX Runtime | `onnxruntime-directml==1.24.4` | Giống CPU |
| RapidOCR | `rapidocr-onnxruntime==1.4.4` | Giống CPU |
| Input | Bản sao video `7675331033864178944` | Cùng SHA-256 |
| Vùng quét | 1080×1920: x=0..1080, y=1382..1766; halo 32 px | Giống CPU |
| Chế độ | `accurate`, 8 fps, `stream-roi`, không cache | Giống CPU |
| Nhánh sản phẩm thật | OCR → timed mask → `burnAutoShort` | Giống CPU |
| Phụ đề | Nguồn OCR, không dịch; font `noto-sans-kr`, 44 px | Giống CPU |
| Audio | Giữ audio nguồn (`mix`, volume 100) | Giống CPU |

Input đầy đủ:
`F:/Son/doyuin/VideoInput/2026-08-18_分享科普不同的螃蟹能不能吃？_科普_螃蟹_科普_涨知识_7675331033864178944.mp4`.
SHA-256 `d063313c1c908ac1f760d48ec290f8a40a130ec0e916333910fefab0889ffeb6`.

Ba model được copy nguyên trạng từ managed runtime: PP-OCRv3 detector,
PP-OCRv2 classifier và PP-OCRv3 recognizer. Hai nhánh dùng cùng normalization,
resize và tùy chọn session; khác provider. Hai nhánh đều tạo process/session mới,
nên thời gian OCR bao gồm khởi động, warm-up, decode/preprocess/inference/
postprocess/ghi kết quả, không chỉ `session.run()`.

**Không phải A/B trực tiếp với binary CPU đang cài.** Binary hiện có dùng ORT
1.29.0/RapidOCR 1.2.3; baseline CPU của phép thử dùng cùng dependency với GPU để
cô lập khác biệt provider. Tác động nâng phiên bản wrapper cần qualification riêng.

## Runtime GPU thử

Lab chọn provider bằng `TEDIAPROS_OCR_LAB_PROVIDER=cpu|dml`, kiểm tra availability
và provider của session thật cho cả det/cls/rec. Provider sai/không có bị báo lỗi,
không fallback im lặng. Chỉ lab có version `1.2.0-lab.1` và `experimental:true`.

Session có `enable_mem_pattern=false` và `ORT_SEQUENTIAL`; không gọi nhiều
`Run` đồng thời trên cùng session. Các tùy chọn này theo
[tài liệu DirectML của ONNX Runtime](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html#configuration-options).
Python 3.12 được chọn theo giới hạn `<3.13` của
[RapidOCR 1.4.4](https://pypi.org/project/rapidocr-onnxruntime/1.4.4/).

Canary ngoài khoảng benchmark: OCR thật các khung 5/35/90 giây và profiling ba
session. Ghi nhận DML Node events: det 606, cls 465, rec 822. Recognizer còn 24
Node events CPU (`Concat`, `Gather`, `Slice`); không gọi đây là 100% phép toán GPU.

## Đo và đối chiếu

- `runner.ts`: thời gian từng stage và wall-time quanh item processor thật;
  provider báo từ engine, số lần OCR, allocation sau settle, file đầu ra.
  OCR timer gồm ghi/copy timeline/SRT và mask timer gồm copy mask vào evidence;
  overhead thu thập này giống nhau giữa hai nhánh nhưng chưa đo tách riêng.
- `monitor.py`: process-tree CPU/RSS khoảng 1.5 giây/mẫu; CPU chuẩn hóa theo
  12 logical CPU. Đây là số đo gần đúng; có thể bỏ lỡ tiến trình sống rất ngắn,
  tổng RSS có thể đếm lặp trang dùng chung.
- GPU utilization/VRAM từ `nvidia-smi` là **toàn thiết bị**, gồm ứng dụng khác;
  không coi là VRAM riêng OCR. Không chạy test nặng khác trong hai lượt chính.
- So SRT, timeline/text/tọa độ (tách confidence số thực), từng khung mask được
  decode; kiểm tra hình ảnh mẫu sau render. Giống CPU không có nghĩa đúng với
  ground truth: không có transcript chuẩn được chấm toàn video.
- Thử hủy OCR GPU đang chạy, lỗi chọn provider và chạy lại clip ngắn; kiểm tra
  trạng thái, thời gian settle, lease được nhả và child process còn sót.
- Kiểm thử queue/resource manager trong repo là bằng chứng fixture, tách biệt
  với bài thử media thật. Không cố tạo driver hang, VRAM OOM hay stress batch dài.

## Các lượt không dùng làm số đo A/B

- `dml-full-a`: lỗi harness ESM (trùng tên `dirname`), chưa chạy OCR.
- `dml-full-b`: OCR/mask đã xong nhưng render lỗi font `NotoSans`; đầu lượt có
  test CPU cùng chạy. Không đưa số liệu này vào so sánh chính.
- Sửa mã font **trong harness** thành ID thực `noto-sans-kr` và thêm preflight.
  `dml-smoke-c` đã đi hết OCR → mask → render trên clip khoảng 3 giây trước
  khi bắt đầu ma trận chính. Không sửa font/render sản phẩm.
- Lượt hủy/lỗi suffix `d` đã ghi JSON kết quả hợp lệ, nhưng console Python
  CP1252 không in được thông báo tiếng Việt. Chạy lại các bài an toàn với
  `python -X utf8` và suffix `e`; không cần sửa hoặc chạy lại A/B đã hoàn tất.

## Tái chạy

Không tái dùng case name đã tồn tại: harness cố ý không ghi đè kết quả.
Từ repo root, sau khi môi trường lab đã được tạo:

```powershell
node .runner-staging/ocr-gpu-lab-20260909-v1/build-runner.mjs
& .runner-staging/ocr-gpu-lab-20260909-v1/venv/Scripts/python.exe -X utf8 -B .runner-staging/ocr-gpu-lab-20260909-v1/monitor.py cpu-full-NEW
& .runner-staging/ocr-gpu-lab-20260909-v1/venv/Scripts/python.exe -X utf8 -B .runner-staging/ocr-gpu-lab-20260909-v1/monitor.py dml-full-NEW
node .runner-staging/ocr-gpu-lab-20260909-v1/compare.mjs cpu-full-NEW dml-full-NEW
```

Thay `NEW` bằng suffix chữ thường/số chưa có. Chỉ chạy bước sau khi bước trước
exit 0. Build harness lại sẽ lấy source checkout lúc đó, có thể khác bundle đã đo.
Lab chưa phải bộ cài có checksum manifest/rollback; không copy vào managed runtime.
