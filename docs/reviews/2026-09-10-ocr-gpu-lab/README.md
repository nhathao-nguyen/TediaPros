# AutoShort OCR GPU: kết quả thử nghiệm cô lập

Ngày kiểm chứng: **2026-09-10**, Windows, GTX 1660 SUPER 6 GB, driver 595.79.

## Kết luận

**GPU OCR có lợi rõ rệt trên video đã thử:** OCR nhanh 3.05×; chuỗi thực
OCR → timed mask → render nhanh 2.42×, giảm 58.76% thời gian. Hai video xuất ra
giống nhau từng byte. Không quan sát thấy rò lease, tiến trình con còn sót hoặc
không thể chạy tiếp sau hủy/lỗi trong các bài thử mô tả bên dưới.

Đây là **TEST_CONFIRMED cho lab**, không phải đã triển khai GPU vào AutoShort
đang cài. Runtime thật giữ nguyên SHA-256 và vẫn báo `gpu:false`. Không đổi
scheduler, cài đặt, cache, hàng đợi hoặc source sản phẩm trong task này.

## 1. Số đo thực tế

Video 1080×1920, dài 166.666667 giây, ROI như cấu hình đã kiểm tra, `accurate`
8 fps. Hai lượt chạy **lần lượt** CPU rồi GPU, cùng executable lab, model,
dependency và cấu hình; process/session mới mỗi lượt, không lấy cache.

| Số đo | CPU | GPU DirectML |
| --- | ---: | ---: |
| OCR đầy đủ, gồm startup/decode/pre/postprocess | 600.833 s — 10:01 | 197.231 s — 3:17 |
| Tạo timed mask | 11.844 s | 11.719 s |
| Render | 81.666 s | 77.084 s |
| Tổng item | 694.688 s — 11:35 | 286.488 s — 4:46 |
| CPU trung bình, cửa sổ bên trong stage OCR | 56.40% | 12.62% |
| CPU trung bình, toàn lượt | 54.83% | 23.74% |
| RSS đỉnh lấy mẫu process-tree, cửa sổ giữa OCR | 652 MiB | 787 MiB |
| VRAM đỉnh lấy mẫu **toàn thiết bị**, cửa sổ giữa OCR | 895 MiB | 1,120 MiB |

Tải CPU được chuẩn hóa theo 12 logical CPU, lấy mẫu gần đúng khoảng 1.5 giây;
cửa sổ OCR bỏ 5 giây ở mỗi biên và dùng mốc tương đối của monitor, không có
timestamp đồng bộ chính xác lúc OCR bắt đầu. Không coi các đỉnh này là đỉnh
bao gồm toàn bộ startup/teardown. RSS có thể đếm lặp trang dùng chung. VRAM gồm
cả ứng dụng khác, **không phải VRAM riêng OCR**; không lấy hiệu hai đỉnh làm
mức cấp phát GPU chính xác. Render của **cả hai** lượt đã dùng `h264_nvenc`;
chênh lệch nhỏ ở mask/render không được quy thành lợi ích trực tiếp của GPU OCR.

Timer OCR còn bao gồm ghi bản sao timeline/SRT làm bằng chứng; timer mask có
copy mask sang evidence. Hai nhánh cùng chịu overhead này, chưa tách riêng
thời gian instrumentation khỏi số đo của lab.

Chi tiết: [comparison.json](./evidence/comparison.json),
[giao thức và dependency](./PROTOCOL.md).

**Giới hạn baseline:** cả hai lượt dùng RapidOCR 1.4.4 + ORT DirectML 1.24.4,
khác binary CPU đang cài (RapidOCR 1.2.3 + ORT 1.29.0). Đây là phép so provider
công bằng trong cùng runtime thử, không phải số đo trước/sau nâng cấp ứng dụng.
Chưa bật dịch, TTS, Whisper, tách giọng hay tạo tiêu đề; không gọi là tăng tốc
2.42× cho mọi cấu hình AutoShort đầy đủ.

## 2. Chất lượng và thực thi GPU

- Ba session thật det/cls/rec chọn DML. Profiling ngoài benchmark ghi nhận
  kernel DML ở cả ba; recognizer còn một số phép shape trên CPU. Không dựa
  riêng vào GPU utilization hoặc cờ `--probe.gpu` để kết luận.
- Cả hai lượt: 1,225 visual segments, 1,247 box segments; tọa độ, text, thời
  gian và ID giống nhau khi bỏ confidence số thực khỏi phép so.
- SRT giống hệt, SHA-256
  `0128d1b97ac26af08396b8123415df92555c7b7676b079b082acf9b6d2da64ab`.
- **1,335/1,335 khung mask decode giống hệt**, gồm khung đệm/kết thúc.
- Hai MP4 cùng 203,283,033 bytes, cùng SHA-256
  `d40315332c2d97a34bb39b51670fe2da671ad3774965ca40d11e2df5a468466f`.
- FFprobe xác nhận geometry/thời lượng/audio; giải mã toàn MP4 bằng FFmpeg
  với `-xerror` thành công, không có lỗi. Vì hai file trùng hash, chỉ cần
  decode một bản để kiểm tra dữ liệu giống nhau.
- Đã xem khung GPU ở 5/35/90 giây và source ở 35 giây: chữ gốc trong vùng quét
  được làm mờ, phụ đề mới hiển thị. Đây là blur hình chữ nhật hiện tại, không
  phải STTN xóa chữ và phục hồi nền.

**Không phải xác nhận OCR đúng 100%.** Ví dụ ở 35 giây, source là `可能含有寄生虫`,
nhưng OCR/subtitle có `可能合有寄生虫` ở cả CPU và GPU. Chuyển provider giữ nguyên
kết quả trên video này, không tự sửa lỗi nhận chữ. Log render có font fallback
CJK của Windows; không sửa hệ font trong phạm vi thử nghiệm.

Bằng chứng: [media-validation.json](./evidence/media-validation.json),
[provider/model/hash postflight](./evidence/postflight.json).
Ảnh mẫu và video nằm trong lab tại
`F:/Son/tool/TediaPros/.runner-staging/ocr-gpu-lab-20260909-v1/visual-check` và
`runs/dml-full-c/output/source-phude.mp4`.

## 3. Có làm block luồng không?

**Không quan sát thấy kẹt trong bài thử; chưa có cơ sở bảo đảm mọi batch/UI/driver.**

| Bài thử thực tế | Kết quả |
| --- | --- |
| Hủy sau tiến độ đầu tiên của GPU OCR | `cancelled`; settle sau abort 232.387 ms |
| Ép tên provider sai | `error` sau 596.309 ms; không fallback âm thầm |
| Chạy GPU lại sau hủy/lỗi | OCR → mask → render clip ngắn thành công, 8.171 s |
| Tài nguyên sau từng lượt | CPU/GPU/server allocations đều 0 |
| Tiến trình sau từng lượt | Không còn observed child PID; kiểm tra OS sau cùng cũng không thấy OCR/FFmpeg lab |
| Xuất bản khi lỗi/hủy | Không có output video; work scratch đã được dọn |

Bài chạy tiếp là **process/item mới trong lab**, không phải đã chạy batch thật
90 item hoặc chứng minh hàng đợi production tự phục hồi sau driver hang. Lỗi
thử là cấu hình provider sai, không phải mô phỏng đầy đủ VRAM OOM/native hang.
Tests queue thật của repo xác nhận qua fixture rằng một item lỗi không làm
rơi các kết quả trước và queue tiếp tục; queue cancellation dừng nhận item mới
theo thiết kế.

Về code: OCR chạy sidecar bất đồng bộ; provider không làm inference chạy trong
main thread Electron. OCR hiện giữ **cả** `local-cpu-heavy` và `local-gpu-heavy`
kể cả CPU; chuyển DML không tạo thêm loại khóa. Kết thúc sớm hơn có thể giảm
thời gian tách giọng/render chờ. Nhưng strict FIFO vẫn có head-of-line waiting,
đã tái hiện ở [đánh giá trước](../2026-09-09-ocr-gpu-assessment/README.md).
Không đổi provider để tuyên bố đã sửa scheduler hoặc tăng song song toàn queue.
UI Electron thật khi full-load GPU, nhiều GPU-heavy workload cùng lúc, driver
hang và batch dài vẫn **UNKNOWN**.

## 4. Kiểm chứng và bàn giao

- `npm.cmd run typecheck`: PASS, node + web.
- OCR Python sản phẩm: **32/32 PASS**.
- Lab provider characterization: **4/4 PASS**, đã thực hiện red/green khi sửa
  provider reporting và lựa chọn CPU/DML trong bản sao.
- 5 suite local-runtime liên quan: **45/45 PASS**.
- Assertion native mask ban đầu bỏ qua vì thiếu managed fixture; đã cấp cặp
  FFmpeg/FFprobe trong user-data **lab riêng** và chạy lại suite mask:
  **6/6 PASS**, assertion FFV1/hash thật được chạy, không skip. Đây là chạy
  lại 6 test trong 45 test trên, không cộng thành 51 test độc lập.
- `git diff --check`: PASS; có cảnh báo CRLF từ file thay đổi sẵn, không sửa nó.
- [verification.json](./evidence/verification.json) lưu lệnh, exit code và log;
  [native mask log](./evidence/verification-native-mask-tests.log) lưu lượt bổ sung.
- `--version` + `--probe` CPU/DML lab và managed runtime đều đã kiểm tra.
  Managed executable vẫn SHA-256
  `7ac0d6fe1bc497544a60a74cd6ae66878158a8e772ea86c12ce3b1a3e190f781`,
  version 1.2.0, `ready:true`, `gpu:false`.
- Giữ runtime/build/input/output/evidence thử trong thư mục lab để tái kiểm tra;
  scratch của các item đã được coordinator dọn. Không commit hoặc phát hành binary.
- Rà soát độc lập: không có finding chặn bàn giao lab; hai lưu ý về cửa sổ lấy
  mẫu và overhead lưu evidence đã được bổ sung. [Biên bản](./evidence/review.md).

## Bước tiếp theo đề xuất — chưa thực hiện

Đủ bằng chứng để chuyển sang **tích hợp GPU có kiểm soát**: provider reporting
đúng, chọn GPU/CPU rõ ràng, lý do fallback được ghi log, identity cache/runtime
được phân biệt; bộ dependency/build/manifest/checksum và rollback phải được
qualification. Giữ một GPU-heavy lane và `maxActiveItems=1` lúc đầu. Sau đó
pilot nhiều video với cấu hình dịch/TTS/tách giọng thật và kiểm tra UI.

Việc sửa source sản phẩm, phát hành/đổi managed runtime hay chạy batch thật
cần được người dùng đồng ý riêng; **task này chỉ hoàn tất thử nghiệm cô lập**.
