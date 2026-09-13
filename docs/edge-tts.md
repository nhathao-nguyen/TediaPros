# Microsoft Edge-TTS

TediaPros hỗ trợ `edge-tts` như một provider trực tuyến cho tab Voice và AutoShort. Local AI Server vẫn là provider mặc định để config cũ giữ nguyên hành vi. Edge-TTS không hỗ trợ voice clone và cần kết nối Internet tại thời điểm lấy catalog lẫn tổng hợp giọng.

## Contract và giới hạn

- Package được ghim đúng `msedge-tts@2.0.7`; identity cache là `edge-tts:msedge-tts:2.0.7`.
- Voice nhận tối đa 20.000 Unicode code points, speed hữu hạn trong `0.5x–2.0x`, pitch nguyên trong `-100Hz..+100Hz`.
- AutoShort gửi provider ở `1.0x`. Dubbing planner/FFmpeg hiện có mới áp dụng tempo vật lý, tối đa `1.80x`, và không bỏ cue.
- Transport có deadline do Main sở hữu là 60 giây và giới hạn audio 16 MiB. Abort hủy HTTP catalog, đóng stream, metadata stream và WebSocket; deadline bao trùm cả decode, probe và publish. Scratch cùng final vừa publish bị xóa nếu lỗi hoặc hủy.
- Text được escape tại boundary SSML. Renderer không thể truyền timeout, rate hoặc volume xuống transport.
- Toàn bộ IPC TTS kiểm tra origin của renderer trước khi gọi mạng, đọc file hoặc mở hộp thoại lưu.

## Catalog và trạng thái kết nối

`tts:getEdgeVoices` trả `EdgeVoiceCatalogResult` gồm `source: live | fallback`, thời điểm kiểm tra và lỗi đã rút gọn. Catalog fallback chỉ phục vụ lựa chọn trên UI; nó không được coi là bằng chứng mạng sẵn sàng. Preflight AutoShort yêu cầu catalog `live`, kiểm tra voice/locale, giữ toàn bộ language capability động và chạy một synthesis WebSocket probe trước khi bắt đầu OCR/dịch.

Voice lưu riêng lựa chọn tại `tblao.voice.edgeVoice`; AutoShort dùng `tblao.autoshort.edgeVoice`. Thay đổi ngôn ngữ sẽ chọn lại một voice tương thích nếu voice hiện tại không còn hợp lệ.

## Audio và cache

Voice preview nhận MP3, giải mã toàn bộ bằng managed FFmpeg, đo duration bằng managed FFprobe rồi mới publish. File lưu theo MIME của chính kết quả, kể cả khi người dùng đổi provider trước khi bấm lưu. Main kiểm tra header khớp MIME trước khi mở hộp thoại ghi file. History giữ MIME riêng cho từng mục; history cũ thiếu MIME được hiểu là WAV.

AutoShort vẫn đi qua dubbing planner, cache v2, trim/probe FFmpeg và batch journal hiện có. Endpoint versioned và voice ID nằm trong cache key, nên Edge không dùng chung cache với Local và đổi voice sẽ làm cache miss. MP3 provider phải giải mã thành PCM WAV mono 24 kHz và có duration dương trước khi cache được publish; cache không bao giờ chứa MP3 dưới tên `.wav`.

## Kiểm chứng

Unit tests không gọi mạng, gồm contract/provider, locale chính xác, XML escaping, abort ở open/stream/decode/publish, timeout HTTP catalog, giới hạn response, header/MIME, PCM cache publication/resume và origin gate IPC. Live adapter qualification trên Windows 11 đã xác nhận catalog 322 voice, synthesis WebSocket và full decode + duration probe cho bốn mẫu `vi`, `en`, `es`, `ja`; bằng chứng nằm tại `.ai/tasks/2026-09-12-edge-tts-integration/live-smoke.json`. Windows NSIS packaging, packaged fonts và forbidden-runtime scan cũng đã pass. Nghiệm thu tương tác Voice UI và ma trận AutoShort live bằng video thật chưa được thực hiện trong task này.

macOS ARM64 chưa được live-qualified trong task này; build/typecheck chỉ xác nhận tính tương thích mã nguồn.
