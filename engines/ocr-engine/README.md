# OCR runtime 1.2.1

Windows OCR ưu tiên GPU DirectML cho cả detector, classifier và recognizer. Giao
thức `ocr-local/1`, sáu capability visual timeline, 8 fps, vùng OCR/halo và các
thuật toán SRT/mask giữ nguyên. Không cần đổi tuỳ chọn AutoShort để bật GPU.

## Chọn thiết bị và lỗi

- Mặc định `auto`: thử DirectML; nếu provider thiếu, session không thực sự dùng
  DML hoặc khởi tạo GPU thất bại, dựng lại cả ba session trên CPU một lần.
- `--device cpu` ép CPU; `--device dml` yêu cầu GPU và báo lỗi nếu không dùng được.
- Biến môi trường `TEDIAPROS_OCR_DEVICE=auto|cpu|dml` tương đương; CLI ưu tiên hơn.
  Không ghi biến môi trường toàn hệ thống trong quá trình cài đặt.
- `--probe` và kết quả visual OCR trả `ocr_provider` từ ba session thật. Trường
  `gpu` chỉ đúng khi cả ba chọn DML; không suy luận từ danh sách provider đã cài.
  `fallback_reason` trong status giải thích lý do quay về CPU lúc khởi tạo.
- Fallback chỉ ở lúc khởi tạo. Lỗi native giữa quá trình nhận diện được trả về
  main process; không âm thầm đổi thiết bị giữa video hoặc retry vô hạn.
  Cơ chế watchdog/hủy cây tiến trình của main process giữ nguyên.

Adapter RapidOCR được khoá khi khởi tạo, đặt `enable_mem_pattern=False` và
`ORT_SEQUENTIAL`, theo [yêu cầu DirectML của ONNX Runtime](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html).
Một session không chạy nhiều lệnh nhận diện đồng thời. AutoShort vẫn giữ lease
`local-gpu-heavy`/`local-cpu-heavy` hiện có; đây không phải thay đổi scheduler.
GPU vẫn có thể giao một số toán tử phụ cho CPU: provider DML không có nghĩa
toàn bộ công việc decode/mask/render hoặc 100% toán tử chạy trên GPU.

## Build Windows trong môi trường riêng

Dùng Python 3.12 x64 và **venv mới**. `requirements.txt` là lock toàn bộ dependency
để cài bằng `--no-deps`: RapidOCR khai báo dependency `onnxruntime` CPU, có thể
ghi đè module DirectML nếu để pip tự resolve. Không cài đồng thời `onnxruntime`,
`onnxruntime-gpu` và `onnxruntime-directml`. `pip check` có thể báo thiếu tên
distribution `onnxruntime`; đừng sửa cảnh báo này bằng cách cài lại bản CPU.

Ví dụ chạy từ root repo, chọn các thư mục build chưa tồn tại:

```powershell
$ErrorActionPreference = 'Stop'
py -3.12 -m venv .runner-staging/ocr-build/venv
if ($LASTEXITCODE -ne 0) { throw 'venv failed' }
$ocrPython = '.runner-staging/ocr-build/venv/Scripts/python.exe'
& $ocrPython -m pip install --no-deps -r engines/ocr-engine/requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'install failed' }
& $ocrPython -c "import onnxruntime as o; assert 'DmlExecutionProvider' in o.get_available_providers(); print(o.__version__, o.get_available_providers())"
if ($LASTEXITCODE -ne 0) { throw 'provider verification failed' }
$env:TEDIAPROS_OCR_MODELS_DIR = "$PWD/.runner-staging/ocr-build/models"
& $ocrPython engines/ocr-engine/prepare_models.py --output $env:TEDIAPROS_OCR_MODELS_DIR
if ($LASTEXITCODE -ne 0) { throw 'model preparation failed' }
& $ocrPython -m unittest discover -s engines/ocr-engine/tests -p 'test_*.py' -v
if ($LASTEXITCODE -ne 0) { throw 'tests failed' }
& $ocrPython -m PyInstaller --clean --noconfirm engines/ocr-engine/ocr-engine.spec --distpath .runner-staging/ocr-build/dist --workpath .runner-staging/ocr-build/work
if ($LASTEXITCODE -ne 0) { throw 'build failed' }
Remove-Item Env:TEDIAPROS_OCR_MODELS_DIR
& .runner-staging/ocr-build/dist/ocr-engine/ocr-engine.exe --version
& .runner-staging/ocr-build/dist/ocr-engine/ocr-engine.exe --probe
& .runner-staging/ocr-build/dist/ocr-engine/ocr-engine.exe --probe --device cpu
```

Workflow `.github/workflows/build-windows-runtime.yml` chạy lock/provider check,
chuẩn bị model, Python tests và build. CI có thể chỉ fallback CPU do không có
GPU; probe CI không thay thế kiểm chứng DML trên máy thật. Marker non-Windows
dùng ORT CPU, nhưng bản 1.2.1 này chưa được kiểm chứng trên macOS.

## Bảo toàn model / checksum

RapidOCR API dùng 1.4.4 nhưng giữ đúng model của bản 1.2.3 đã dùng trong phép
A/B, không vô tình đổi sang model v4 được đóng kèm API mới. Chuẩn hoá ảnh
detector (`std`, `mean`, cạnh min 736) cũng giữ nguyên phép A/B.

`prepare_models.py` chỉ chạy lúc build, tải đúng
[wheel RapidOCR 1.2.3 từ PyPI](https://pypi.org/project/rapidocr-onnxruntime/1.2.3/),
đối chiếu kích thước 12,326,259 byte và SHA-256
`c707d3a6eb72d13119afe9602d3cc36d8b2a4a4d74e9575cf1b0e67ed6a27819`.
Có thể truyền `--wheel <file.whl>` để build offline. Thư mục output đã tồn tại
sẽ bị từ chối, không ghi đè. Chỉ ba member allowlist được lấy ra:

| Thành phần | Model | SHA-256 |
| --- | --- | --- |
| det | `ch_PP-OCRv3_det_infer.onnx` | `3439588c030faea393a54515f51e983d8e155b19a2e8aba7891934c1cf0de526` |
| cls | `ch_ppocr_mobile_v2.0_cls_infer.onnx` | `e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c` |
| rec | `ch_PP-OCRv3_rec_infer.onnx` | `897a3ededb38fee0dae2c1ccee38241f37df202c9509e3abca02e9217c5ee615` |

Spec đóng gói đúng ba model này và giấy phép Apache 2.0
[`RapidOCR-LICENSE.txt`](RapidOCR-LICENSE.txt), giữ nguyên từ
[RapidOCR upstream](https://raw.githubusercontent.com/RapidAI/RapidOCR/main/LICENSE),
vào `_internal/models/MODEL-LICENSE.txt`. OCR kiểm checksum model mỗi lần khởi
tạo, không tải model trên mạng lúc chạy. Model hỏng là lỗi, không fallback sang
model khác. Không thay đổi LICENSE/NOTICE của TediaPros.

Trên Windows, AppContainer có thể ánh xạ riêng đường dẫn file trong AppData qua
`LocalCache` dù đường dẫn thư mục cha vẫn giữ nguyên. Resolver giữ đường dẫn
tuyệt đối do runtime cung cấp và từ chối symlink ở thư mục/model trước khi kiểm
SHA-256; không dùng `Path.resolve()` để so containment vì hai tên đường dẫn hợp
lệ có thể trỏ tới cùng một file nhưng bị so thành hai cây khác nhau.

## Cài đặt và bằng chứng

Chỉ thay **toàn bộ thư mục** runtime sau khi các tác vụ OCR đang chạy đã kết
thúc; không chỉ chép mỗi EXE vì DLL/model nằm trong `_internal`. Giữ bản cũ và
receipt, xác minh `--version`, `--probe` và real-media smoke trước/sau kích hoạt.
Không xoá cache OCR của người dùng: video có cache hợp lệ có thể không cần quét
lại. Bản cập nhật runtime cục bộ không phải bản release từ xa.

Kết quả A/B trước tích hợp: xem
[`docs/reviews/2026-09-10-ocr-gpu-lab/README.md`](../../docs/reviews/2026-09-10-ocr-gpu-lab/README.md).
Thời gian đo chỉ đại diện cho video/máy/cấu hình đã thử, không là cam kết tốc độ
cho mọi video hay toàn bộ dịch/lồng tiếng.
