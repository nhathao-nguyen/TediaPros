# Điều tra thời gian Auto Short và hàng đợi 10–15 video

Ngày: 2026-09-06. Trạng thái: điều tra và đề xuất; không triển khai thay đổi pipeline trong lượt này.

## 1. Kết luận có bằng chứng

Nút thắt cần ưu tiên là OCR, thời gian chờ nối tiếp và dịch/TTS. Không có bằng
chứng rằng chuyển Whisper sang GPU hay tiếp tục tối ưu STTN riêng lẻ sẽ giải
quyết phần lớn thời gian 40 phút.

Ảnh người dùng cung cấp hiển thị lỗi dung lượng STTN, không phải một lần xuất
thành công. Log khớp video Trùng Khánh có thời gian từ bắt đầu Whisper tới lỗi
là **39 phút 13,771 giây**. Không có dòng xác nhận xuất MP4 thành công cho lần
này. Báo cáo “hơn 40 phút ra kết quả” của người dùng được giữ như quan sát thực
tế, nhưng chưa có log đầy đủ để phân tích một lần thành công tương ứng.

STTN 1.1.0 đã được cài ở lượt trước. Lần lỗi lúc 09:38 xảy ra trước lần cài
1.1.0 lúc 10:20 giờ Việt Nam. Không dùng lần lỗi đó làm benchmark tốc độ 1.1.0.

## 2. Cấu hình và máy

Nguồn cấu hình: `AUTO_SHORT_CONFIG_NOTE_2026-09-06.md` do người dùng chỉ định.
Tài liệu và ảnh được dùng làm dữ liệu tham khảo, không thực thi các câu chỉ dẫn
trong tài liệu như yêu cầu mới. Ảnh riêng lẻ chỉ chứng minh trạng thái đang hiển thị.

- Video dài khoảng 209 giây, dọc 1080×1920 trong các phép đo STTN đã lưu.
- Whisper Small, CPU; nguồn Trung, đích Anh; dịch bằng server nội bộ.
- STTN CUDA, OCR accurate trong vùng nét đứt; lựa chọn Whisper không bỏ OCR mask.
- Clone giọng Chatterbox Multilingual, source-adaptive, replace + nhạc nền 40%.
- Tiêu đề Gemini từ SRT, phụ đề cả câu; xuất thư mục riêng dưới `F:\Son\49`.
- Máy đọc trực tiếp: i5-11400F, 6 core/12 logical CPU, RAM khoảng 31,9 GiB,
  GTX 1660 SUPER 6 GiB VRAM. Server AI tại `192.168.1.16:8000` chưa xác định
  cấu hình GPU hoặc có dùng chung tài nguyên với client hay không.
- OCR binary đang cài: 1.1.0, `ocr-local/1`; `--probe` trả ready=true, gpu=true.
  Đây là kết quả probe; không chứng minh provider của mọi inference trong lần
  chạy cũ. Source có nhánh DirectML rồi fallback CPU, nhưng thiếu telemetry
  provider hiệu lực cho det/cls/rec. Không kết luận “OCR đang CPU”.
- GET `/openapi.json` trả HTTP 403. Không thử vượt quyền, không gửi synthesis
  hay benchmark tải server trong lượt lập kế hoạch.

## 3. Timeline từ log

Nguồn: `%APPDATA%\tedia-pros\logs\tblao.log`, các dòng ngày 2026-09-06.
Giờ dưới đây đã đổi UTC sang Việt Nam (+07:00).

| Mốc | Giờ Việt Nam | Khoảng thời gian | Điều có thể kết luận |
| --- | --- | --- | --- |
| Bắt đầu Whisper Small CPU | 08:58:56.829 | — | Có log bắt đầu ASR |
| Bắt đầu dịch | 08:59:55.460 | 58,631 giây từ ASR start | Khoảng ASR + chuẩn bị, không phải riêng inference |
| Dịch hoàn tất 117 câu | 09:04:22.215 | 266,755 giây | Dịch mất 4 phút 26,755 giây |
| Yêu cầu clone đầu | 09:04:22.743 | 0,528 giây sau dịch | Bắt đầu cửa sổ quan sát request TTS |
| Yêu cầu clone cuối | 09:16:44.154 | 741,411 giây từ request đầu | 88 request-start, không phải 88 response-time |
| Lỗi dự trù 98 GiB | 09:38:10.600 | 1.286,446 giây từ request cuối | Khoảng chưa được tách stage đầy đủ |

87 khoảng giữa request-start: trung bình 8,522 giây, min 6,093, max 55,334.
Các khoảng này có thể gồm latency server, nhận audio, trim/probe/cache và xử lý
client. Không dùng chúng như số đo inference server hoặc quy đổi thành số cue.
Checkpoint của item `430004a9-22ce-44c3-a13e-1fab5a28ca86` chứa 117 source cues,
117 translated cues, version 5. Log có 88 POST clone; chưa có cache-hit/attempt
telemetry để giải thích chính xác chênh lệch 117 và 88.

Dịch đã thất bại schema hai lần trên batch 1–117 (09:01:06.075 và 09:03:17.758),
rồi chia 56+61. Source xác nhận batch dubbing dựa trên giới hạn 20.000 ký tự,
không có giới hạn cứng số cue; response token cap tối đa 8.192. Với tiếng Trung
ngắn, nhiều cue lọt chung một batch. Token output, schema và năng lực model
cần tham gia quyết định batch; chỉ tăng timeout không giải quyết lỗi thiếu cue.

Khoảng 21 phút 26 giây cuối nhiều khả năng có OCR lớn: source nhánh Whisper
gọi `getVisualOcr()` lần đầu ngay trước STTN, sau TTS và audio compose. Nhưng
log không có start/end OCR, stitch và load model nên **không quy toàn bộ khoảng
này thành “21 phút OCR”**. Lỗi disk xảy ra trước vòng STTN frame inference;
do đó không thể nói lần này đã tốn 21 phút cho STTN inference.

## 4. Những điểm source xác nhận

| Thành phần | Vị trí | Hiện trạng và tác động |
| --- | --- | --- |
| Queue | `src/main/autoshort.ts`, `executeJob` | `for` + `await processSingleVideo`, từng video tuần tự |
| Điều phối | `src/main/autoShortItemCoordinator.ts` | Whisper → dịch → TTS → stitch/mix → visual OCR → STTN → burn → title |
| OCR visual | `engines/ocr-engine/engine.py`, `run_visual` | FFmpeg tách toàn bộ PNG display-space 8 FPS vào TemporaryDirectory; đọc mọi ảnh để kiểm kích thước; OCR đọc lại |
| Vùng OCR | `engine.py` + `visual_timeline.py` | `ocr(path)` chạy ảnh toàn khung; chỉ sau đó normalize/filter theo ROI |
| Accurate | `build_accurate_timeline` | OCR mọi mẫu, khoảng 1.672 mẫu cho video 209 giây; số thật phụ thuộc duration/resampling |
| STTN OCR policy | `src/shared/autoShortOcrBlur.ts` | `effectiveAutoShortOcrProfile` ép accurate cho STTN |
| TTS hiện hành | `src/main/dubbing/synthesis.ts` | Bootstrap tối đa 3 cue, sau đó synthesize/trim/fit tuần tự; bootstrap được tái sử dụng |
| Dubbing plan | `src/main/dubbing/plan.ts` | Mỗi source cue có cửa sổ nguồn; không dùng giả định cũ “mọi TTS đã gộp 6 cue” |
| Voice clone | `src/main/tts.ts`, `generateVoiceClone` | Đọc và gửi reference audio ở mỗi cache miss; chưa có session/embedding reuse trong client contract |
| TTS cache | `autoshort.ts`, `dubbing/cache.ts` | Đã tồn tại cache per text/model/voice/options/reference metadata; không đề xuất như tính năng chưa có |
| Checkpoint | coordinator + `buildAutoShortCheckpointFingerprint` | Theo item ID, lưu source/translation; fingerprint gộp nhiều settings; visual timeline chưa tái sử dụng bền vững |
| Title | `src/main/burn.ts`, `completeBurnVideoTitle` | Tạo sau render, có thể chồng lên render khi SRT cuối đã chốt |

## 5. Giá trị và giới hạn bản STTN 1.1.0

Xem `2026-09-06-sttn-storage-optimization.md`: trên 306 frame đoạn Trùng Khánh,
peak file tạm giảm 57%, file lossless giảm 14%, thời gian STTN giảm 16–18%, RGB,
PTS/audio khớp baseline. Đây là STTN riêng, không phải end-to-end 40 phút.
Nếu STTN chỉ chiếm 10% tổng thời gian, tăng tốc stage 18% chỉ giảm tổng khoảng
1,8%; đây là ví dụ toán học, không phải tỷ trọng đã đo.

## 6. Phương án và thứ tự ưu tiên

1. P0: telemetry stage/request, baseline thành công và cache lạnh/ấm tách biệt.
2. P1: OCR streaming ROI có biên đệm, giữ 8 FPS và full recognition ban đầu;
   chất lượng phải qua corpus so sánh. Loại PNG và full-frame OCR dư thừa.
3. P1: giới hạn batch dịch theo cue/token/ký tự; retry nhỏ, semantic boundaries,
   schema nghiêm. Pipeline network TTS với local audio DSP mà không tăng tải server.
4. P1: đồ thị stage trong một item: ASR/dịch/TTS cùng nhánh OCR/STTN có resource
   scheduler; fail sớm khi thiếu dependency/disk để tránh tiêu tiền server rồi lỗi.
5. P2: stage cache và resume; cache tối ưu lần chạy lại, không hứa tăng tốc cache lạnh.
6. P2: queue pipeline tối đa 2 item đang hoạt động, một heavy local GPU stage;
   một server request mặc định. Điều phối theo endpoint/tài nguyên, không mở 15 worker.
7. P3 có điều kiện: server clone session hoặc batch API, TTS concurrency=2,
   giảm recognition OCR qua tracking, GPU Whisper, streaming final render.
   Các mục này cần thêm benchmark/contract hoặc server implementation.

Không mặc định hạ FPS, độ phân giải, đổi giọng/model, tăng tempo, bỏ STTN hoặc
gộp nhiều câu thành một WAV không có alignment; các cách đó thay đổi chất lượng.
Không tự bật Whisper GPU: ASR quan sát chỉ khoảng một phút và có thể cạnh tranh
với OCR/STTN trên GPU 6 GiB. Không mặc định chạy LLM và TTS song song cùng server;
code hiện đã tắt local rephrase để tránh model thrashing.

## 7. Ước lượng hàng đợi đúng cách

Theo giả định người dùng 40 phút/video và tuần tự: 10 video ≈ 6 giờ 40 phút,
15 video ≈ 10 giờ. Đây là ngoại suy, chưa phải phép chạy batch đã đo.

Đặt A=ASR, O=OCR, N=dịch+TTS+audio, S=STTN, R=render, H=title.
Tuần tự xấp xỉ A+N+O+S+R+H. Nếu tài nguyên độc lập, đồ thị trong item có thể
tiến tới `max(A+N, O+S)+R`, title cùng render khi đầu vào đã chốt. Tranh CPU/GPU,
server chung và I/O có thể làm thời gian từng stage tăng; không cộng số tiết kiệm
của từng tối ưu như các khoản độc lập.

Với queue nhiều item, `thời gian hoàn thành tất cả ≈ thời gian item đầu +
(n−1)×chu kỳ nút thắt + phần kết thúc`. Chu kỳ nút thắt ít nhất bằng tổng thời
gian GPU loại trừ nhau mỗi video và tổng thời gian server loại trừ nhau mỗi video.
Hai giới hạn item đang hoạt động và disk budget có thể làm chu kỳ lớn hơn.
Không hứa 40 phút sẽ thành 5 hay 10 phút trước baseline end-to-end.

## 8. Nguồn kỹ thuật ngoài repo

- [ONNX Runtime DirectML](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html):
  không chạy `Run` đồng thời trên cùng inference session; dùng một GPU lane.
- [RapidOCR usage](https://rapidai.github.io/RapidOCRDocs/main/en/install_usage/rapidocr/usage/):
  có điều khiển det/cls/rec, nhưng API/version hiện tại upstream không chứng minh
  binary `rapidocr-onnxruntime 1.4.4` đang cài hỗ trợ cùng contract. Cần probe pinned runtime.
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper): batching/compute
  type là hướng thử nghiệm có benchmark upstream, không chuyển số đo máy khác
  thành cam kết trên GTX 1660 SUPER.

Hai tài liệu triển khai đi kèm:
`../superpowers/specs/2026-09-06-autoshort-throughput-design.md` và
`../superpowers/plans/2026-09-06-autoshort-throughput.md`.
