# Microsoft Edge-TTS

TediaPros hỗ trợ `edge-tts` như một provider trực tuyến cho tab Voice và AutoShort. Local AI Server vẫn là provider mặc định để config cũ giữ nguyên hành vi. Edge-TTS không hỗ trợ voice clone và cần kết nối Internet tại thời điểm lấy catalog lẫn tổng hợp giọng.

## Contract và giới hạn

- Package được ghim đúng `msedge-tts@2.0.7`; identity cache là `edge-tts:msedge-tts:2.0.7`.
- Voice nhận tối đa 20.000 Unicode code points, speed hữu hạn trong `0.5x–2.0x`, pitch nguyên trong `-100Hz..+100Hz`.
- AutoShort gửi provider ở `1.0x`. Dubbing planner/FFmpeg hiện có mới áp dụng tempo vật lý, tối đa `1.80x`, và không bỏ cue.
- Transport có deadline do Main sở hữu là 60 giây và giới hạn audio 16 MiB. Abort hủy HTTP catalog khi không còn caller nào chờ, vô hiệu hóa handler WebSocket trước khi đóng socket/stream, và không làm gián đoạn caller khác đang dùng chung request catalog. Deadline bao trùm cả decode, probe và publish. Scratch cùng final vừa publish bị xóa nếu lỗi hoặc hủy.
- Text được escape tại boundary SSML. Renderer không thể truyền timeout, rate hoặc volume xuống transport.
- Toàn bộ IPC TTS kiểm tra origin của renderer trước khi gọi mạng, đọc file hoặc mở hộp thoại lưu.

## Catalog và trạng thái kết nối

`tts:getEdgeVoices` trả `EdgeVoiceCatalogResult` gồm `source: live | fallback`, thời điểm kiểm tra và lỗi đã rút gọn. Catalog fallback chỉ phục vụ lựa chọn trên UI; nó không được coi là bằng chứng mạng sẵn sàng. Preflight AutoShort yêu cầu catalog `live`, kiểm tra voice/locale, giữ toàn bộ language capability động và chạy một synthesis WebSocket probe trước khi bắt đầu OCR/dịch.

Voice lưu riêng lựa chọn tại `tblao.voice.edgeVoice`; AutoShort dùng `tblao.autoshort.edgeVoice`. Tab Voice hiển thị bộ chọn ngôn ngữ cho Edge và chọn lại một voice tương thích khi ngôn ngữ thay đổi. Nếu AutoShort đang nhận diện ngôn ngữ tự động, preflight dùng voice Edge đã chọn để kiểm tra kết nối; sau ASR, pipeline vẫn xác thực voice đó với ngôn ngữ thực tế trước khi tổng hợp.

## Scheduler, retry và chế độ tăng tốc

Main process dùng một scheduler Edge-TTS chung cho catalog, synthesis probe, Voice và AutoShort. Cấu hình cũ mặc định `Ổn định · 1 request cùng lúc`; AutoShort cho phép chọn `Nhanh thử nghiệm · tối đa 2 request`. Giá trị được kiểm tra tại IPC và Main clamp về `1 | 2`. Scheduler giãn thời điểm bắt đầu request 1,5 giây nên không tích lũy burst sau thời gian idle. Mốc này được chọn từ live qualification 100 request: nhịp 1 giây cần ba retry, còn nhịp 1,5 giây đạt 100/100 không retry ở cả hai preset. Preset 2 không giảm tổng thời gian trong workload đó vì peak active vẫn là 1, nên tiếp tục được coi là thử nghiệm.

Chỉ `rate_limited`, timeout mạng, lỗi kết nối tạm thời và HTTP 5xx được retry, tối đa ba attempt. Backoff khởi điểm 2/4 giây cộng jitter. HTTP 429 hạ concurrency về 1 và tôn trọng `Retry-After`; HTTP 401/403 dừng Edge cho tới khi người dùng bắt đầu hoặc tiếp tục batch sau khi xử lý kết nối. Circuit toàn tiến trình mở sau ba lỗi transport liên tiếp và giữ cooldown 30 giây. Trạng thái cooldown được lưu trong `edge-tts-state/recovery.json` dưới user data bằng ghi partial rồi rename.

Nếu một cue vẫn lỗi transient sau ba attempt, AutoShort đánh dấu item `provider-transient`, mở cooldown rồi cho item đúng một recovery pass. Audio cue đã commit tiếp tục là cache hit; pass thứ hai không tự lặp lại nếu dịch vụ vẫn lỗi.

Ở preset 2, dubbing chuẩn bị tối đa hai cue đồng thời và lookahead tối đa bốn cue. Audio có thể hoàn tất lệch thứ tự, nhưng predictor, overflow/rephrase, timeline và output chỉ consume theo thứ tự cue nguồn. Decode/probe FFmpeg vẫn qua lease `local-audio-dsp`; cancel hủy waiter đang chờ và drain work của item trước khi đóng scope. Progress AutoShort hiển thị số request đang chạy/chờ cùng lý do cooldown/circuit.

## Audio và cache

Voice preview nhận MP3, giải mã toàn bộ bằng managed FFmpeg, đo duration bằng managed FFprobe rồi mới publish. File lưu theo MIME của chính kết quả, kể cả khi người dùng đổi provider trước khi bấm lưu. Main kiểm tra header khớp MIME trước khi mở hộp thoại ghi file; nếu phần mở rộng phải đổi theo MIME, đường dẫn mới được ghi ở chế độ độc quyền để không ghi đè một file mà người dùng chưa xác nhận. History giữ MIME riêng cho từng mục; history cũ thiếu MIME được hiểu là WAV.

AutoShort vẫn đi qua dubbing planner, cache v2, trim/probe FFmpeg và batch journal hiện có. Endpoint versioned và voice ID nằm trong cache key, nên Edge không dùng chung cache với Local và đổi voice sẽ làm cache miss. MP3 provider phải giải mã thành PCM WAV mono 24 kHz và có duration dương trước khi cache được publish; cache không bao giờ chứa MP3 dưới tên `.wav`.

## Kiểm chứng

Unit tests không gọi mạng, gồm contract/provider, scheduler/recovery, corpus preparation 500 unit, completion lệch thứ tự, cancellation, locale chính xác, ngôn ngữ tự động ở preflight, XML escaping, abort/quiesce ở catalog/open/stream/decode/publish, timeout HTTP catalog, giới hạn response, header/MIME, chống ghi đè sau chuẩn hóa phần mở rộng, PCM cache publication/rollback/resume và origin gate IPC. Live adapter qualification ngày 2026-09-13 trên Windows 11 đã xác nhận catalog 322 voice, synthesis WebSocket và full decode + duration probe cho bốn mẫu `vi`, `en`, `es`, `ja`; bằng chứng nằm tại `.ai/tasks/2026-09-12-edge-tts-integration/live-smoke.json`. Kết quả tải mới và video thật phải được ghi riêng, không suy ra từ smoke cũ.

macOS ARM64 chưa được live-qualified trong task này; build/typecheck chỉ xác nhận tính tương thích mã nguồn.
