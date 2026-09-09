# Review thời gian AutoShort và các stage có thể bỏ

Ngày: 2026-09-08. Phạm vi: job `52a748c0-b894-4e47-a603-bd9aca49bc5e`, output `F:\Test_video`, đối chiếu mã nguồn hiện tại và artifact thực tế. Review này đã được dùng làm cơ sở cho một lượt tối ưu P0/P1 nhỏ, có kiểm soát; benchmark real-media sau khi runtime 1.2.0 được cài lại vẫn còn phải chạy.

## Kết luận

OCR tự động profile `accurate` là stage chiếm thời gian lớn nhất: khoảng 58–60% wall time của hai item có diagnostics hoàn tất trong snapshot. Có thể bỏ toàn bộ visual OCR và tạo timed mask nếu dùng Whisper để lấy phụ đề, cùng vùng làm mờ thủ công cố định hoặc tắt làm mờ. Giữ dịch và TTS qua server nội bộ.

Trước khi giảm chất lượng OCR, nên sửa việc không tái sử dụng cache sau transport fallback và tránh chạy lại video đã thành công. Source có streaming nhưng binary đang dùng chưa có capability này.

Con số 2 giờ 32 phút do người dùng báo là thời gian trải nghiệm thử nghiệm. Log xác nhận video đầu tiên đã OCR nhiều lượt, render thành công nhiều lượt; số này không đại diện cho một lượt pipeline sạch trên ba video riêng biệt. Không có đủ dữ liệu giữ lại để chia chính xác toàn bộ 152 phút theo stage. Snapshot hiện có hai item thành công, item 2 bị chặn checkpoint và item 4 đang OCR.

## Số đo từ artifact

| Stage | video-input-01 | video-input-03 | Ý nghĩa |
| --- | ---: | ---: | --- |
| Tổng wall time | 1.312,016 s (21m52s) | 1.513,819 s (25m14s) | diagnostics/summary.json |
| Dịch | 113,502 s | 137,413 s | 108 / 118 cue nguồn |
| TTS | 237,430 s | 300,507 s | 41 / 40 đoạn thoại; rephraseCount = 0 |
| Tách nhạc | 14,087 s | 16,506 s | manifest.separation; DirectML |
| Ghép audio | 1,170 s | 1,127 s | Không bao gồm toàn bộ xử lý audio ngoài span |
| Visual OCR | 781,593 s (13m02s) | 874,387 s (14m34s) | accurate, 8 fps, legacy-disk |
| Render/publish qua burn | 149,276 s | 166,656 s | Có hậu kiểm MP4 và chờ title trong đường gọi |
| ASR | cache hit 10 ms | source checkpoint | Không phải benchmark ASR chạy mới |

Tổng stage không bằng wall time: tạo mask, kiểm tra file, trộn audio và các công việc giữa stage chưa có span riêng. Tách nhạc lấy từ manifest, không cộng trùng vào một stage khác.

Thời lượng hình nguồn trong manifest OCR: 166,666667 s / 188,166667 s. `ocrVisualSegmentCount`: 1.213 / 1.381. Engine version trong artifact: 1.1.0.

Nếu chỉ trừ OCR khỏi wall time đã đo, còn khoảng 8m50s / 10m39s (tiết kiệm 58–60%). Đây là ước tính với ASR/cache hiện có; chưa phải benchmark manual blur. Render manual khác filter hiện tại và nguồn chưa có ASR cache sẽ mất thêm thời gian.

## Stage có thể bỏ và đánh đổi

1. **Bỏ visual OCR + timed-mask bằng blur thủ công:** chọn `subtitleMethod: whisper`, `lamMo: true`, `blurMode: manual`, thêm hình chữ nhật thật vào `blurRegions`. Không thể chỉ đổi mode khi danh sách vùng vẫn rỗng. Vùng làm mờ tồn tại xuyên suốt video, có thể che cảnh khi không có chữ và bỏ sót chữ di chuyển ngoài vùng. Hợp với video có bố cục chữ cố định; cần kiểm tra vài khung của từng bố cục trước khi dùng chung.
2. **Tắt làm mờ:** `lamMo: false` cùng Whisper bỏ OCR/mask hoàn toàn. Chữ gốc vẫn còn. Dịch, TTS, phụ đề mới vẫn chạy.
3. **Giữ automatic blur, đổi sang fast:** giảm số lần nhận diện bằng cách tìm các khoảng hình ổn định rồi OCR khung đại diện. Vẫn lấy mẫu hình 8 fps; không đồng nghĩa đổi CLI sang 2 fps. Có thể bỏ sót thay đổi chữ nhỏ/nhanh. Chưa đo mức tăng tốc trên batch này.
4. **Bỏ tách nhạc:** chuyển audio mode nếu chấp nhận thay toàn bộ audio gốc bằng TTS/nhạc riêng. Tiết kiệm chỉ 14–17 giây trong các sample; mất nhạc/SFX gốc. Không phải ưu tiên.
5. **Bỏ title Gemini:** được vì title tùy chọn, hiện timeout. Title đã chuẩn bị song song khi render nên không được cộng toàn bộ timeout 60 giây thành lợi ích wall time. Có thể tạo title riêng sau video.
6. **Bỏ TTS:** giảm 4–5 phút nhưng mất lồng tiếng, thay đổi mục tiêu sản phẩm; không đề xuất cho yêu cầu hiện tại.
7. **Bỏ burn/render:** chỉ phù hợp nếu chấp nhận phụ đề rời và không sửa hình. Với phụ đề gắn vào hình + blur, vẫn cần render.

Giữ kiểm tra cue identity/chất lượng, đo duration WAV, căn timeline và giới hạn tempo 1.80x. TTS ở sample có `rephraseCount=0`, vì vậy bỏ rephrase không tiết kiệm thời gian đã đo. STTN chưa bật trong batch này nên không có stage STTN để cắt.

## Phát hiện code và runtime

### P1: Cache OCR không dùng lại khi fallback transport

- Coordinator tạo cache key bằng transport yêu cầu ở `src/main/autoShortItemCoordinator.ts:577`.
- Khi đọc cache, `payload.transport` phải bằng `requestedTransport` ở dòng 595.
- Khi ghi cache, lưu transport thực tế `ocrRes.transport` ở dòng 668.
- Runner yêu cầu `stream-full`; runtime fallback `legacy-disk` ở `src/main/ocr.ts:63`.
- Đã đọc hai `artifact.bin` trong `autoshort-artifact-cache-v1/visual-ocr`: đều có `transport: legacy-disk`, `engineVersion: 1.1.0`.
- Do đó với cùng yêu cầu `stream-full` sau fallback, artifact bị loại và OCR có thể phải quét lại. Đây là kết luận từ nhánh code và payload thật, chưa có regression mới cho fix.

Hướng sửa: negotiate capability trước cache lookup; khóa artifact theo effective transport và implementation identity, vẫn kiểm tra source digest, profile, ROI, geometry và timeline. Không bỏ kiểm tra transport hoặc gán nhãn giả cho artifact.

### P1: Binary đang chạy chưa dùng đường streaming trong source

Manifest kết quả và log báo 1.1.0 / legacy-disk. `distribution/runtime-inputs.json:44` mô tả 1.2.0 với `visual-stream-full-v1` và `visual-stream-roi-v1`. Việc build Electron không chứng minh binary OCR trong userData được cập nhật.

Nhánh legacy trong source (`engines/ocr-engine/engine.py:530`) ghi PNG toàn hình, đọc lại để kiểm tra kích thước rồi nhận diện. Profile accurate gọi detector mỗi sample (`visual_timeline.py:329`). ROI ở nhánh này lọc kết quả sau nhận diện; không tự bỏ chi phí full-frame OCR. Đây là hành vi source nhánh legacy hiện tại; chưa kiểm chứng source build provenance của binary cài đặt.

Cập nhật/import runtime theo manifest và checksum, kiểm tra `--version`/capability, rồi benchmark streaming. Không hứa tỷ lệ nhanh hơn khi chưa đo. `stream-roi` thay đổi phạm vi ảnh detector nên cần so sánh coverage chữ.

### P2: Lịch chạy vẫn tuần tự; bật overlap đơn thuần có giới hạn

Runner dòng 210 đặt `overlapIndependentStages: false`, `maxActiveItems: 1`, `prefetchTts: false`.

Code hỗ trợ chạy visual branch sau ASR và trước dịch ở coordinator dòng 945. Tuy nhiên OCR và separation cùng lấy lease local CPU/GPU; separation đứng trước TTS (dòng 1192). Chỉ bật overlap có thể giúp dịch chồng với OCR, trong khi TTS còn chờ separation bị xếp sau OCR. Muốn overlap cả TTS phải điều chỉnh lịch/dependency và kiểm tra tài nguyên, không chỉ tăng concurrency.

Translation/TTS vẫn dùng `server-inference` dung lượng 1. Không tự tăng request đồng thời lên server.

### P2: Render đang fallback sang CPU

Log ghi lỗi khởi tạo NVENC, AMF, QSV rồi thành công bằng libx264. `burn.ts:1101` thử cả ba encoder phần cứng trước libx264 medium/CRF20. Cần kiểm tra một probe encode thật và chỉ chọn encoder dùng được. GPU được liệt kê không chứng minh encode thành công. Chưa xác định nguyên nhân chính xác NVENC từ log đã lọc.

Đây là tối ưu thứ cấp sau OCR; không bỏ hậu kiểm MP4.

### Chi phí thử nghiệm lặp

Trong log `tblao.log`, cùng video đầu tiên:
- 13:12 UTC bắt đầu OCR; 13:26 lỗi duration.
- 13:32 OCR lại; render xong 13:47.
- 13:54 OCR lại; render xong 14:13.
- 14:32 OCR lại; render xong 14:48.

Ngoài thời gian từng stage, các lần rerun từ đầu đã làm tăng đáng kể tổng thử nghiệm. Với những lần sau, chỉ retry item/stage lỗi; giữ các output đã xác minh và cache hợp lệ. Giữ lịch sử attempt trong báo cáo thay vì lấy tổng thời gian debug làm benchmark throughput.

## Thứ tự cải thiện đề xuất

1. Giữ output thành công, sửa OCR fallback cache và ghi riêng attempt timing.
2. Nếu chấp nhận blur vùng cố định: dùng chế độ Thủ công hiện có để bỏ visual OCR/mask; benchmark một video trước khi chạy toàn batch.
3. Nếu cần blur bám chữ: cập nhật runtime streaming; benchmark accurate và fast với cùng video, ROI và quality check.
4. Khắc phục encoder selection; sắp lịch OCR/separation/TTS theo tài nguyên thực.
5. Giữ local server, TTS đo thật, validator và khả năng kéo dài video hiện tại. Không giảm an toàn nội dung để đổi lấy vài giây.

## Cập nhật triển khai sau review

- `src/main/autoShortExecutionPolicy.ts`: vẫn giữ `maxActiveItems: 1`, nhưng mặc định bật overlap visual branch và yêu cầu `stream-roi`; `src/main/ocr.ts` vẫn tự fallback an toàn khi runtime cũ.
- `src/main/autoShortItemCoordinator.ts`: cache revision tăng lên `ocr-visual-cues-v2`, bỏ transport yêu cầu khỏi cache key và cho phép tái sử dụng artifact `legacy-disk` khi yêu cầu stream bị runtime cũ fallback. Artifact stream không được dùng ngược cho một request legacy rõ ràng.
- `engines/ocr-engine/engine.py`: legacy-disk vẫn materialize frame để tương thích binary cũ, nhưng detector chỉ nhận ROI có halo 32px và chuyển polygon về display-space trước khi normalize.
- `scripts/run-video-input-batch.ts`: batch harness dùng `stream-roi` và overlap để benchmark đúng workflow tối ưu.
- Regression coverage: test cache fallback/default policy trong `autoshort-ocr-pipeline.test.ts` và `autoshort-ocr-runtime.test.ts`; Python OCR engine tests vẫn kiểm tra toàn bộ contract hiện có.

Chưa cập nhật runtime binary trong user data bằng lượt thay đổi này và chưa claim tỷ lệ nhanh hơn trước khi chạy lại cùng video, cùng profile, cùng vùng ROI.

## Bằng chứng và giới hạn

Xem `2026-09-08-autoshort-stage-cost-evidence.json` cùng thư mục: snapshot số đo và đường dẫn nguồn evidence. Dữ liệu nguồn là `F:\Test_video\...\.autoshort-audit-52a748c0-...\diagnostics\summary.json`, `events.jsonl`, `manifest.json` và `%APPDATA%\tedia-pros\logs\tblao.log`.

Không chạy thêm toàn batch real-media để đo tối ưu trong lượt này. Không khẳng định đã hoàn tất 15 video hay toàn bộ 152 phút đã được phân rã.
