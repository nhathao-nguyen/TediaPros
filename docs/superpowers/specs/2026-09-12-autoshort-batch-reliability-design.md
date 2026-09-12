# Thiết kế sửa và tối ưu AutoShort chạy hàng loạt

**Trạng thái:** Đề xuất để duyệt; chưa triển khai. 2026-09-12, source HEAD `7e2b93e`, package 0.1.25 tại lần kiểm tra cuối. Báo cáo phiên chạy trước ghi source 0.1.24 và installed 0.1.23; không dùng số phiên bản cũ làm trạng thái hiện tại.

## Mục tiêu và phạm vi

Cho phép nạp 90 video, chạy không cần trông từng video, xử lý lỗi riêng từng item, tiếp tục phần chưa làm sau khi mở lại ứng dụng và không xuất trùng video đã hoàn thành. Cải thiện năng suất thành phẩm hợp lệ trên giờ, đồng thời giữ nguyên chất lượng hình/tiếng và dữ liệu gốc.

Baseline lấy từ `.ai/tasks/2026-09-12-winlocal-performance/REPORT.md`: batch 7:55:51, 15 thành công, 20 lỗi, 1 hủy trong 90 item; 13 lỗi hợp đồng OCR/STTN tái hiện được. Năng suất 1,89 thành phẩm/giờ; video thành công mất trung bình 20,20 phút. Đây là số liệu phiên đã điều tra, không phải benchmark mới.

## Các phương án

| Phương án | Lợi ích | Đánh đổi | Quyết định đề xuất |
|---|---|---|---|
| Sửa lỗi + phục hồi bền vững + tối ưu có đo trên kiến trúc hiện có | Xử lý đúng nguyên nhân; tận dụng queue, checkpoint, cache, resource manager | Cần nghiệm thu theo từng tầng | **Chọn** |
| Tăng số item/request đồng thời ngay | Có thể che một số thời gian chờ | Không chữa gap/overflow; có thể tăng OOM, nghẽn server và render fallback | Chỉ thử sau các gate ổn định |
| Chuyển mặc định từ STTN sang blur nhẹ | Giảm công đoạn nặng | Đổi chất lượng/chức năng xóa chữ | Không chọn mặc định; chỉ làm benchmark riêng khi người dùng chọn chế độ đó |

## Ràng buộc chung

- Chỉ AutoShort; không thay hành vi Video Editor, downloader hay công cụ khác ngoài lỗi dùng chung thực sự cần sửa.
- Không xóa/sửa LICENSE hoặc NOTICE.
- Giữ tempo tối đa **1.80x**, protected gap **0.50s**, trần kéo dài đoạn nguồn **60%** hiện tại; không cắt lời, bỏ cue, đổi nghĩa hoặc tự nới trần.
- Giữ nguồn cue ID/timestamp; sửa grouping/bản dịch đúng ranh giới ngữ nghĩa nếu bằng chứng yêu cầu.
- Giữ override ngân sách dịch: tổng request/recovery/thời gian **không bị chặn bằng quota mới**. Timeout từng request, hủy và dừng khi không tiến triển vẫn theo chính sách hiện hành.
- Giữ OCR ROI do người dùng chọn, 8 Hz/accurate và STTN của baseline cho phép so sánh chất lượng tương đương. Không tự chuyển STTN sang blur/giảm độ phân giải để đạt KPI.
- Mọi input/path đều qua safeContainedPath và kiểm tra symlink/junction thích hợp; cache/runtime dùng hash, model/runtime được ghim SHA-256.
- GPU nặng mặc định **1 lease**, server-inference **1 lease**, maxActiveItems **1**, prefetchTts **false** cho đến khi benchmark cho phép bật riêng.
- Tất cả giao tiếp UI/Main qua typed IPC; journal không lưu API key, cookie, token, reference audio buffer hoặc header xác thực.
- Scratch phải dọn khi kết thúc/hủy; chỉ giữ durable artifacts có quota và mục đích phục hồi rõ ràng.

## Thiết kế đề xuất

### A. Sửa hợp đồng OCR → STTN

Giữ validator dữ liệu thô nghiêm ngặt. Thêm validator cho timeline đã ổn định, xác minh đoạn gap đúng kết quả tái tạo từ các đoạn raw hợp lệ: ID, nguồn láng giềng, khung thời gian, text, box và confidence đều phải khớp. Không chấp nhận gap chỉ vì có prefix hợp lệ; không âm thầm bỏ gap để render tiếp.

OCR raw endpoint vẫn từ chối synthetic segments. STTN và cache-read của artifact đã ổn định dùng validator mới. Thay đổi fingerprint validator của visual cache, có migration chỉ cho dữ liệu chứng minh tái tạo được; dữ liệu nghi ngờ là cache miss. Engine protocol raw không cần đổi chỉ để sửa lỗi phía client.

### B. Giữ chứng cứ để tối ưu đúng

Giữ log sau quit, xoay vòng có quota, phân biệt `cancelled`, `timeout`, lỗi transport, lỗi server và lỗi nội dung. Thêm span cho separation, chờ lease, retime, SEO, export/copy; ghi effective provider, encoder được chọn và từng encoder attempt cùng diagnostic đã lọc. Session/job/item/attempt/request ID phải nối được với nhau.

Mặc định đề xuất: log tối đa 7 ngày/100 MiB cho profile; diagnostics budget hiện tại tiếp tục áp dụng riêng. Quota này là **lưu trữ**, không phải giới hạn thời gian hay số request dịch. Không xóa evidence của job còn active; khi không thể ghi thêm, đặt diagnosticsIncomplete và giảm chi tiết, không dừng media job.

### C. Batch có trạng thái bền vững

Main giữ journal dưới userData, UI hiển thị snapshot của Main. Journal ghi item ID, input/config fingerprint không chứa secrets, thứ tự, attempt, status, checkpoint reference và receipt thành phẩm. Ghi atomic và tuần tự, có recovery nếu lần ghi cuối bị đứt.

Khi renderer reconnect, hỏi Main trước: nếu job còn sống thì nối lại tiến độ; không reset các trạng thái đang chạy thành queued. Khi ứng dụng khởi động mới, item đang chạy trước crash thành interrupted. Nút **Tiếp tục phần chưa xong** chạy pending/interrupted, chỉ bỏ qua succeeded khi output receipt và file thực còn khớp. Không tự phát request AI ngay khi mở ứng dụng. Missing input/output hoặc fingerprint thay đổi phải hiển thị rõ và invalidation đúng phụ thuộc.

Một item lỗi không làm mất queue. Retry chỉ cho lỗi thực sự có thể phục hồi và giữ lịch sử; lỗi hợp đồng xác định không retry nguyên đầu vào. Với lỗi cấu hình/xác thực server ảnh hưởng toàn batch, dừng nhánh provider và báo cần xử lý, không đốt cả 90 item thành lỗi giống nhau. Giữ timeout/no-progress policy hiện có; không thêm quota tổng trá hình.

### D. Sửa voice dựa trên phép đo

Đối chiếu 5 overflow và lỗi 1.808x trên source/translated cue, grouping, PCM sau trim, slot/deadline và request/response thật. Các fixture không còn WAV phải tái thu bằng cấu hình cố định vào thư mục chẩn đoán riêng; không dựng số đo giả để gọi là runtime proof.

Repair thứ tự: kiểm tra mapping nghĩa → điều chỉnh ranh giới nhóm nguồn nếu sai → TTS thật/đo → rephrase đúng nhóm overflow → đo lại → calibration DSP → validate thời lượng/tempo. Một candidate rút ngắn nhưng mất số/phủ định/tên/nghĩa không được chấp nhận. Nếu không thể fit trong policy, ghi lỗi rõ và tiếp tục video khác; không đưa video thiếu lời vào succeeded.

### E. Tối ưu lịch tài nguyên và phần việc lặp

Tách thoại hiện nằm trước TTS nên chờ GPU có thể giữ cả nhánh TTS. Cho separation chạy thành nhánh độc lập và join khi mix instrumental; narration dùng cue nguồn nên không phụ thuộc stem nền. GPU/STTN/separation vẫn tuân thủ một lease và cancellation đợi process thật sự kết thúc.

Tích hợp cache STTN qua ArtifactCache đã có stage `sttn`, keyed bằng digest input, canonical timeline, geometry, engine/model revision và tham số xử lý. Quota mặc định không tăng ngầm; file quá quota được bỏ cache nhưng job vẫn thành công. Cache chỉ tiết kiệm retry/resume, không giảm inference lần đầu. Ưu tiên receipt final video nhỏ và checkpoint hợp lệ; không lưu vô hạn bản sao video/WAV.

Giữ FIFO cho request chia sẻ cùng tài nguyên. Thử admission cho request không giao tài nguyên chỉ khi telemetry xác nhận bị chặn bởi request phía trước; không thay FIFO toàn cục theo phỏng đoán. Thử prefetch 1 nhóm TTS và maxActiveItems=2 riêng rẽ; chỉ bật mặc định khi throughput thực tăng, không tạo request thừa quá mức, không OOM hoặc vi phạm lease.

### F. Render và STTN

NVENC test 3 frame trước đây thành công nhưng 16 output có libx264. Tái hiện encoder attempt trên filter graph thực với đúng geometry/ASS/audio/retime, giữ stderr đã lọc. Sửa nguyên nhân cụ thể như pixel format/graph/options/tài nguyên nếu đo được; CPU fallback còn cần thiết và phải được ghi rõ. Không tuyên bố codec là nguyên nhân gốc chỉ từ tag hoặc short probe.

STTN giữ cùng ROI/chất lượng; đo inference, frame decode/encode, tải model và truyền frame riêng. Chỉ chọn tối ưu nào chứng minh chi phí thực giảm: tái dùng worker nếu model startup đáng kể; bỏ công việc lặp/copy; cache cho lần thử lại. Thay temporal window/resolution/profile là thí nghiệm chất lượng riêng, không lẫn vào benchmark bảo toàn chất lượng.

## Nghiệm thu

1. 13 fixture gap qua STTN contract; synthetic giả/tampered vẫn bị từ chối.
2. 6 fixture voice không được mất lời hoặc vượt policy; trường hợp không đủ điều kiện phải trả lỗi chính xác và không làm dừng item kế tiếp.
3. Queue giả lập 1.000 item: mỗi item tối đa một receipt thành công, đúng thứ tự hiển thị, lỗi item không làm crash batch; cancel/resume không lặp output.
4. Batch thực 90 video: tất cả có trạng thái cuối hoặc trạng thái chờ xử lý rõ ràng; không treo vô hạn, không mất trạng thái, không có lỗi hợp đồng gap tái diễn. Mục tiêu **ít nhất 86/90 thành phẩm hợp lệ** trong điều kiện provider khỏe và input hợp lệ; chưa đạt thì chưa đánh dấu đủ chất lượng phát hành, không đổi cách đếm để đạt tỷ lệ.
5. Soak tối thiểu 12 giờ và chạy hết 90 item nếu lâu hơn; thêm thử đóng/mở tiếp tục riêng. Không có orphan engine hoặc scratch không thuộc job/retention đã khai báo; tài nguyên không tăng không giới hạn.
6. Mục tiêu hiệu năng đề xuất: giảm ít nhất 25% wall time trên **cùng 15 video baseline**, cùng cold/warm cache và chất lượng. Mục tiêu này là gate thử nghiệm, không phải lời hứa sẽ đạt. Báo thêm valid outputs/hour, source-minutes/hour, median/P95, request/retry count, peak RAM/VRAM, fallback và disk bytes.
7. Source tests/build không thay thế nghiệm thu installed WinLocal; gói cuối phải verify hash/runtime rồi qua smoke trên chính bản cài.

## Triển khai và rollback

Chia release theo nhóm: fix gap/log → batch/resume + voice → tối ưu được benchmark chấp nhận. Mỗi nhóm có commit riêng và regression độc lập. Feature flag cho concurrency/prefetch/cache mới; migration journal có version và giữ bản trước. Cài bản mới chỉ sau kiểm chứng, không tự đóng phiên đang chạy. Rollback bằng installer trước và journal reader tương thích; không xóa thành phẩm để rollback.
