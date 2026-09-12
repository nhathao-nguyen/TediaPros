# Rà soát hiệu suất AutoShort Win Local — 12/09/2026

**Kết luận:** Hiệu suất thấp do cả tỷ lệ lỗi cao lẫn chi phí xử lý hình ảnh. Đã tái hiện lỗi hợp đồng OCR → STTN gây 13/20 video thất bại của batch cuối. Những video thành công vẫn mất trung bình 20,20 phút để xử lý khoảng 3,15 phút nội dung. Chưa sửa triển khai trong lần điều tra này.

## 1. Phiên chạy và thành phẩm

Tất cả mốc giờ dưới đây là giờ Việt Nam (UTC+7). Lúc kiểm tra đầu tiên khoảng 07:32 và kiểm tra lại cuối đợt điều tra, không còn tiến trình TediaPros. Vì vậy không thể lấy uptime tiến trình; các khoảng dưới đây là thời gian workflow có bằng chứng từ telemetry.

| Phạm vi | Bắt đầu | Kết thúc | Thời gian | Kết quả |
|---|---|---|---|---|
| Lượt đầu | 11/09 22:33:53 | 22:34:15 | 23 giây | 1 hủy |
| Lượt kế tiếp | 11/09 22:35:47 | 23:27:06 | 51 phút 18 giây | 1 thành công, 2 lỗi, 1 hủy |
| Batch cuối `ef37f1f8…` | 11/09 23:35:14 | 12/09 07:31:06 | **7 giờ 55 phút 51 giây** | **15 thành công, 20 lỗi, 1 hủy** |
| Từ dấu vết đầu tới cuối | 11/09 22:33:53 | 12/09 07:31:06 | **8 giờ 57 phút 13 giây** | 16 file thành phẩm, tương ứng **15 video nguồn khác nhau** |

Hai lượt thành công có một video nguồn trùng nhau. Không tính bản sao `output.mp4` nằm trong thư mục audit thành video mới. Tổng thời gian thực thi các item của ba lượt khoảng 8 giờ 47 phút; phần còn lại là khoảng giữa các lượt/item, không khẳng định ứng dụng tính toán liên tục gần 9 giờ.

Batch cuối: snapshot danh sách persisted chứa **90 item**, khớp cả 36 item đã chạy, còn **54 item chưa có lần xử lý trong batch này**. Trạng thái UI persisted có thể cũ (89 queued, 1 removing_subtitles), nên số thành công/lỗi lấy từ `summary.json` và file đầu ra, không lấy từ nhãn UI.

- Tỷ lệ thành công: 15/35 item đã kết thúc không do hủy = **42,86%**; nếu tính cả item bị hủy thì 15/36 = 41,67%.
- Năng suất thực tế batch: **1,89 thành phẩm/giờ**, hay **31,72 phút/thành phẩm**, đã tính thời gian dành cho video lỗi.
- Riêng 15 video thành công: trung bình **20,20 phút/video**.
- FFprobe kiểm tra được **16/16 file đầu ra**, có stream video/audio và metadata duration; đây là kiểm tra cấu trúc, không phải xem/nghe duyệt chất lượng toàn bộ.
- 15 thành phẩm batch cuối dài tổng cộng **47 phút 20,96 giây**. Nguồn tương ứng trung bình 189,08 giây, đầu ra 189,40 giây.

## 2. Thời gian mất ở đâu

Thời gian dưới đây lấy từ span của **15 video thành công**, tránh trung bình bị kéo xuống bởi những video chết sớm. Span có thể bao gồm xử lý nội bộ và thời gian chờ chưa được đo riêng; không đồng nhất với CPU/GPU compute time thuần.

| Công đoạn | Trung bình | Bằng chứng / nhận xét |
|---|---:|---|
| Whisper ASR | 13,18 giây/lần chạy mới | 14 span, 1 video dùng checkpoint; requested CUDA/small, không có effective provider trong telemetry này |
| OCR hình ảnh | 4,27 phút/video | Timeline 8 mẫu/giây; cache của 13 lỗi xác nhận stream-roi, DirectML cho det/cls/rec |
| Dịch | 1,20 phút/video | Tổng 36 item đều qua stage dịch; không có đầy đủ request spans để quy kết thời gian server |
| Tách thoại | 14,70 giây/video | Manifest xác nhận balanced / DirectML; số này là elapsedMs của separation, chưa gồm toàn bộ chờ lease |
| STTN xóa chữ | **10,70 phút/video** | Tất cả 15 thành công có effective provider CUDA |
| TTS + đo/trim/fit/recovery | **6,78 phút/video** | 502 clip đầu ra, 3 rephrase được ghi nhận trên 15 video; không phải số request server chính xác |
| Ghép timeline audio | 1,09 giây/video | Chưa bao gồm mọi bước trộn/retime instrumental |
| Render cuối | **3,59 phút/video** | 15/15 đầu ra batch ghi encoder libx264 |

**Không cộng các hàng thành thời gian thực:** OCR chồng với dịch; STTN chồng với TTS. Tổng activeMs của mọi stage toàn batch vượt wall time là bình thường. Việc tách thoại/retime/copy/SEO không có đầy đủ span riêng, nên không thể gán mọi khoảng trống vào một nguyên nhân duy nhất.

Video chậm nhất thành công, nguồn ngày 2025-10-05: **33,51 phút**, trong đó OCR 7,14 phút, STTN 19,84 phút, TTS 1,02 phút, render 5,87 phút. Trường hợp này chứng minh không thể quy toàn bộ sự chậm cho TTS/server.

## 3. Phân loại 20 lỗi

| Nhóm | Số video | Thời gian item đã tiêu tốn | Mức bằng chứng |
|---|---:|---:|---|
| OCR → STTN từ chối `gap-*` | **13** | **68,40 phút** | TELEMETRY + CODE + OFFLINE_REPRODUCED trên bản cài |
| Voice cần kéo dài hình quá trần 60% | **5** | **80,31 phút** | TELEMETRY; nguyên nhân ngữ nghĩa từng cue chưa được chốt |
| Tempo thực đo 1.808x vượt trần 1.80x | **1** | **7,44 phút** | TELEMETRY; chưa tái hiện DSP trên WAV gốc của lần lỗi |
| `chatterbox_generation_failed` | **1** | **9,67 phút** | TELEMETRY; chưa có log nội bộ server |
| Tổng video lỗi | **20** | **165,82 phút = 2 giờ 45 phút 49 giây** | Khoảng 34,85% thời gian batch |

Thời gian này là thời gian đã chi cho các video thất bại, **không phải cam kết có thể cắt bỏ toàn bộ**: sửa lỗi thành công vẫn phải chạy tiếp STTN/TTS/render cho các video đó.

### 3.1. Lỗi xác định được nguyên nhân gốc: raw và stabilized timeline dùng chung validator

1. `src/main/ocr.ts:646` kiểm tra timeline thô từ OCR.
2. `src/main/ocr.ts:655` gọi `stabilizeSingleSampleGaps()`.
3. `src/shared/ocrVisualTimeline.ts:431` sinh segment `gap-…` để nối khoảng trống đúng một mẫu.
4. `src/main/inpainting/runner.ts:146` nhận timeline đã ổn định nhưng gọi lại **validator dành cho dữ liệu thô**.
5. `src/shared/ocrVisualTimeline.ts:225` cấm prefix `gap-`, nên STTN bị từ chối trước khi chạy inference.

Đã đọc cache thật, khôi phục raw bằng cách bỏ segment tổng hợp trong bản sao bộ nhớ, validate raw, chạy lại stabilizer rồi validate như STTN. **Cả 13 trường hợp tái tạo đúng lỗi**, trên cả hàm trích từ app.asar đã cài và source hiện tại. Không ghi vào cache sản phẩm, không chạy OCR/STTN/provider lại.

Ví dụ item `8dbb3a28…`: bắt đầu 00:42:27, OCR xong 00:46:39, STTN thất bại 00:46:53; inference STTN chưa thực sự chạy. Nhãn stage STTN không có nghĩa GPU STTN đã tính toán hàng phút ở những ca này.

Hướng sửa: tách validation raw/stabilized, bảo toàn provenance và kiểm tra geometry/box/timestamp; kiểm tra trước khi chiếm tài nguyên và thêm regression OCR → stabilize → STTN từ các cache đã tái hiện. Không chỉ xóa điều kiện an toàn hoặc bỏ segment gap để che lỗi.

### 3.2. Overflow và sai số tempo

Năm lỗi cần kéo dài đoạn hình lần lượt **114,8%; 110,8%; 153,1%; 195,5%; 79,3%**, vượt trần 60%. Đây là tỷ lệ của đoạn nguồn bị thiếu thời gian, không phải cả video. Source và bản cài đều giữ trần tempo 1.80x.

Chưa đủ bằng chứng để kết luận cả năm lỗi do bản dịch dài, gán lệch nghĩa, grouping, hoặc nhịp đọc của giọng clone. Cần giữ raw request/response, đo WAV và đối chiếu từng nhóm để chọn đúng sửa chữa. Có cache/checkpoint hỗ trợ nhưng không nên chỉ tăng trần hoặc retry cùng đầu vào: hai lỗi đầu của batch cuối trùng lỗi ở lượt trước.

Lỗi 1.808x: finalization đo lại audio sau DSP và từ chối; đã có vòng calibration trong source. Cần replay WAV và cửa sổ timing thực để biết vì sao calibration không hội tụ. Không coi đổi ngưỡng 1.80 thành lớn hơn là sửa nguyên nhân.

### 3.3. Renderer đang dùng CPU nhưng GPU encoder vẫn qua probe ngắn

Metadata **16/16 file** ghi `Lavc63.1.101 libx264`. Code render có chuỗi thử NVENC → AMF → QSV → libx264 medium. Máy hiện có GTX 1660 SUPER 6 GB. Probe hiện tại bằng FFmpeg của profile Win Local, 3 frame 1080×1920 với `h264_nvenc -preset p4 -cq 23`, exit 0.

Do log render đêm đã bị xóa, **chưa chốt vì sao render thực tế chọn libx264**; probe ngắn không chứng minh filter graph/VRAM của job đầy đủ sẽ thành công. Cần ghi encoder từng lần thử và stderr đã lọc. Có cơ sở điều tra encoder fallback, không có cơ sở nói GPU hỏng hay driver thiếu.

## 4. Rà soát toàn bộ luồng điều phối

| Ranh giới | Hành vi đã đối chiếu | Tác động / giới hạn |
|---|---|---|
| Queue / admission | Mặc định `maxActiveItems=1`, `prefetchTts=false`, overlap=true | 36 item chạy nối tiếp trong telemetry; tổng khe giữa item chỉ 15,424 giây, không có dấu hiệu idle hàng giờ giữa video |
| Validate/hash/probe | Mỗi item tạo scope, kiểm tra input, hash và đọc checkpoint | Có startup/hash/copy không nằm trọn trong stage validate |
| ASR | Lấy cue nguồn, lưu checkpoint; với phương thức whisper, sau đó mới bắt đầu visual branch | ASR nhanh, không phải điểm nghẽn chính của batch này |
| Visual OCR | 8 Hz, accurate, stream-roi; stabilize timeline; cache | Lỗi hợp đồng downstream làm 13 lượt OCR/dịch không tạo thành phẩm |
| Translation | Await dịch trước synthesis; cache revision chưa xác nhận không dùng persistent translation cache | Checkpoint vẫn có thể tái sử dụng; stage dịch không thất bại trong batch cuối |
| Separation | Chạy trước TTS, cùng lease local-gpu-heavy/local-cpu-heavy với OCR/STTN | Có thể phải đợi OCR; khoảng dịch-xong → TTS-bắt-đầu không phải toàn bộ là thời gian tách thoại |
| Resource manager | Capacity 1, FIFO toàn hàng đợi; translation/rephrase/TTS dùng server-inference | Không suy ra nhiều request đang chạy song song từ các log xen kẽ; chưa có đủ request/lease spans để lượng hóa chờ server |
| STTN | Chạy cùng visual branch; CUDA; giữ lease GPU+CPU | Tốn thời gian lớn nhất trên thành phẩm; lỗi nhánh hủy việc liên quan |
| TTS | Nhóm cue → audio thật → trim → fit/rephrase/split → timing validation | Stage gồm server và DSP, không phải chỉ inference server |
| Audio / time map | Ghép timeline, trộn instrumental, có thể retime video/mask | Một số đoạn xử lý không có span riêng |
| Render / metadata | Đợi visual branch; gắn phụ đề/hiệu chỉnh; kiểm tra và publish cục bộ; SEO không làm mất video hợp lệ | 15 render thành công; chữ publish trong telemetry là lưu file cục bộ, không phải đăng mạng |
| Retry | Lỗi duration có thể xếp retry sau lượt chính | Batch bị dừng khi mới tới item 36/90 nên chưa chạy xong lượt chính/retry cuối batch |
| Cleanup / audit | Scratch dọn sau item; lưu artifact và diagnostics bên đầu ra | Telemetry còn nguyên dù log phiên bị xóa; không sửa hoặc xóa dữ liệu của người dùng |

Tài liệu architecture là bản tổng quan, không đủ để khẳng định thứ tự runtime; kết luận trên theo coordinator và timestamp thực. Đặc biệt cấu hình separate-vocals ở code hiện tại thực hiện sau dịch, không phải trước ASR như sơ đồ tài liệu tổng quan.

## 5. Logging làm mất chứng cứ sau khi đóng ứng dụng

Log profile: `C:/Users/PC/AppData/Roaming/tedia-pros/logs/tblao.log`.

`src/main/index.ts:418` gọi `wipeLogFileSync()` trong `before-quit`, trước khi shutdown runtime xong. `src/main/logger.ts:187` xóa log hiện tại và previous crash. Các request đang dừng ghi tiếp được vài dòng vào file mới; điều này giải thích trạng thái chỉ còn log 07:31:06.

`errLabel()` ánh xạ cả `abort` và `timeout` sang “quá thời gian chờ — máy chủ không phản hồi”. Do cùng lúc có item cancelled và destroyed window, **không được dùng nhãn cuối đó làm bằng chứng server timeout**.

Hướng sửa quan sát: giữ log theo session/rotation; ghi tách cancel/timeout; lưu stage riêng cho separation/retime/SEO, effective provider, encoder/attempt, request latency và queue wait. Không cần ghi secrets hoặc toàn bộ dữ liệu nhạy cảm vào log UI.

## 6. Thứ tự xử lý đề xuất

1. Sửa hợp đồng stabilized OCR → STTN, chạy lại 13 fixture lỗi trước khi thử batch thật.
2. Giữ log phiên và telemetry theo request/encoder để các lần chậm tiếp theo có thể quy nguyên nhân.
3. Replay 5 overflow + 1 calibration từ cue/WAV thật; sửa grouping/translation/timing theo bằng chứng, không nới trần tùy tiện.
4. Đo render graph thực tế để tìm vì sao ra libx264 khi NVENC probe đang hoạt động.
5. Sau khi tỷ lệ thành công ổn định, đo lại STTN/ROI, lịch separation/TTS và prefetch. Không tăng số job GPU đồng thời theo phỏng đoán trên GPU 6 GB.

Không đặt mục tiêu tăng tốc cụ thể trước khi có benchmark sau sửa. Đây là báo cáo chẩn đoán; source, ứng dụng cài đặt, cấu hình, queue và cache chưa được chỉnh sửa.

## 7. Bằng chứng và kiểm chứng

- Bản cài: 0.1.23, app.asar SHA-256 `AB7491CA5001F6516F7158651A59B68F828E1C0487FA876300048AB290A5BC0E`.
- Source checkout hiện báo package 0.1.24. Đã dùng trực tiếp hàm bản cài để kiểm chứng lỗi chính, không đồng nhất hai phiên bản.
- `metrics.json`: tổng hợp tất cả 41 item-attempt của 3 lượt, span, status, manifest chọn lọc và kết quả probe.
- `FILE_INVENTORY.json`: 82 telemetry files đã đọc/snapshot, đường dẫn gốc và SHA-256.
- `evidence/`: bản sao summary/events để số liệu không mất nếu app chạy tiếp.
- `gap-replay.json`: 13 lỗi tái hiện từ cache thật bằng installed/source functions.
- `queue-snapshot.json`: danh sách 90 item đọc từ WAL, không mở/mutate LevelDB.
- `source-probes.json`, `output-encoders.json`, `nvenc-probe.json`: probe đọc metadata và test encoder nhỏ.
- `npm.cmd run typecheck`: PASS node/web, exit 0.
- `node .ai/tasks/2026-09-12-winlocal-performance/analyze.cjs`: PASS, 16/16 outputs probe thành công.
- `node .ai/tasks/2026-09-12-winlocal-performance/replay-gap.cjs`: PASS nghĩa là **tái hiện được lỗi**, không phải lỗi đã sửa.
- `node .ai/tasks/2026-09-12-winlocal-performance/read-queue.cjs`: PASS, 90 entries, 36 matches.
- Không chạy lại batch đầy đủ, không gọi server AI; không có GPU/CPU utilization lịch sử hoặc log nội bộ server. Không khẳng định toàn bộ test suite xanh chỉ từ typecheck/probe.

## 8. Chi tiết từng video của batch cuối

| # | Video nguồn (ngày + ID) | Bắt đầu VN | Phút | Kết quả |
|---|---|---|---:|---|
| 1 | 2025-04-06 / 7490083913512045863 | 23:35:14 | 10.28 | Voice overflow |
| 2 | 2025-04-08 / 7490882160954461476 | 23:45:32 | 7.44 | Tempo 1.808x |
| 3 | 2025-04-16 / 7493809730649885992 | 23:52:59 | 17.38 | Thành công |
| 4 | 2025-04-18 / 7494584044865260852 | 00:10:22 | 16.63 | Thành công |
| 5 | 2025-04-22 / 7496063295829396736 | 00:27:00 | 15.44 | Thành công |
| 6 | 2025-04-25 / 7497198185862008116 | 00:42:27 | 4.43 | Lỗi OCR → STTN gap |
| 7 | 2025-04-30 / 7499004312666099004 | 00:46:53 | 16.15 | Voice overflow |
| 8 | 2025-05-07 / 7501226986955164985 | 01:03:03 | 18.28 | Thành công |
| 9 | 2025-05-10 / 7502790065120562444 | 01:21:21 | 20.04 | Thành công |
| 10 | 2025-05-17 / 7504953195438755130 | 01:41:24 | 18.99 | Thành công |
| 11 | 2025-05-24 / 7507926671690403130 | 02:00:24 | 5.20 | Lỗi OCR → STTN gap |
| 12 | 2025-06-06 / 7512458190290849061 | 02:05:35 | 15.89 | Thành công |
| 13 | 2025-06-07 / 7512640165548313915 | 02:21:30 | 3.85 | Lỗi OCR → STTN gap |
| 14 | 2025-06-24 / 7519434505276378428 | 02:25:21 | 18.41 | Thành công |
| 15 | 2025-07-13 / 7526498337571278089 | 02:43:46 | 5.94 | Lỗi OCR → STTN gap |
| 16 | 2025-07-19 / 7528605004752506127 | 02:49:42 | 17.53 | Thành công |
| 17 | 2025-07-24 / 7530490729127300378 | 03:07:14 | 4.74 | Lỗi OCR → STTN gap |
| 18 | 2025-07-28 / 7532054637169413434 | 03:11:59 | 20.78 | Thành công |
| 19 | 2025-07-30 / 7532329316735421756 | 03:32:46 | 6.38 | Lỗi OCR → STTN gap |
| 20 | 2025-08-12 / 7537565174984756539 | 03:39:09 | 5.71 | Lỗi OCR → STTN gap |
| 21 | 2025-08-19 / 7540139611772144956 | 03:44:52 | 9.67 | Chatterbox lỗi |
| 22 | 2025-08-22 / 7540914347288612130 | 03:54:33 | 30.73 | Voice overflow |
| 23 | 2025-08-29 / 7543837740054908219 | 04:25:18 | 25.12 | Thành công |
| 24 | 2025-08-30 / 7544306146287848755 | 04:50:26 | 9.57 | Voice overflow |
| 25 | 2025-09-01 / 7544631018629598523 | 05:00:01 | 5.16 | Lỗi OCR → STTN gap |
| 26 | 2025-09-02 / 7545083599700528444 | 05:05:10 | 6.49 | Lỗi OCR → STTN gap |
| 27 | 2025-09-07 / 7547218667608624384 | 05:11:40 | 4.51 | Lỗi OCR → STTN gap |
| 28 | 2025-09-14 / 7549814524275084583 | 05:16:11 | 17.25 | Thành công |
| 29 | 2025-09-20 / 7550933114068913465 | 05:33:26 | 13.58 | Voice overflow |
| 30 | 2025-09-24 / 7553542914803125564 | 05:47:01 | 6.04 | Lỗi OCR → STTN gap |
| 31 | 2025-09-26 / 7554275540762414345 | 05:53:04 | 22.39 | Thành công |
| 32 | 2025-10-01 / 7556199918319275305 | 06:15:28 | 5.16 | Lỗi OCR → STTN gap |
| 33 | 2025-10-05 / 7557671736314055999 | 06:20:37 | 33.51 | Thành công |
| 34 | 2025-10-06 / 7558044446756048169 | 06:54:09 | 25.32 | Thành công |
| 35 | 2025-10-11 / 7559775225307516195 | 07:19:29 | 4.79 | Lỗi OCR → STTN gap |
| 36 | 2025-10-14 / 7560623626157739322 | 07:24:16 | 6.82 | Hủy |
