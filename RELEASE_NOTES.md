## TediaPros v0.1.35

### Facebook Reels: quét, xuất dữ liệu và quản lý kênh

- Quét Reels từ profile/fanpage, hiển thị tiến trình, kết quả một phần và trạng thái xác minh nguồn; cải thiện thu thập danh sách lớn và lấy caption theo đúng video ID.
- Chọn video để tải hoặc xuất caption, bài viết liên kết và bảng Excel; hiển thị đầy đủ nội dung cùng lỗi của từng bước.
- Thư viện kênh Reels lưu thư mục riêng, hỗ trợ mở/đổi thư mục, thêm kênh từ video đã tải và lấy video mới. Chống tải trùng theo ID, tái sử dụng video có sẵn.

### Tự theo dõi Reels và thông báo

- Bật theo dõi hằng ngày cho từng kênh; lịch mặc định 09:00 giờ Việt Nam, có thể đổi giờ. Nếu ứng dụng đóng hoặc máy ngủ qua lịch, chạy bù một lượt khi mở lại/thức dậy.
- Chỉ tự tải các ID đã xác minh thuộc kênh và chưa từng tải thành công. Video tải lỗi được xét lại ở lượt kế tiếp; lịch sử chống trùng vẫn giữ khi xóa file cũ.
- Chuông thông báo hiển thị số video đã tải/bỏ qua/lỗi, danh sách video và nút mở thư mục; hỗ trợ đã đọc, xóa từng thông báo và xóa tất cả thông báo đã kết thúc.
- Giữ tối đa 100 thông báo, có thanh cuộn khi nội dung dài. Xóa thông báo không xóa video, lịch sử tải hoặc lịch theo dõi; thông báo đang chạy được giữ lại.

Theo dõi tự động chạy khi ứng dụng mở, dùng phiên Facebook đã chọn và kết nối trực tiếp. Các kết quả chưa quét hết hoặc cần đăng nhập được báo rõ trong thông báo.

## TediaPros v0.1.33

### Khắc phục & Tăng cường độ ổn định Runtime (Multi-Channel Fallback)

- **Dự phòng Runtime đa kênh tự động**: Tự động fallback sang các kênh runtime trước đó (`runtime-v6`, `runtime-v5`) khi kênh mới (`runtime-v7`) chưa sẵn sàng hoặc gặp lỗi mạng (404/timeout), giải quyết triệt để lỗi không khởi tạo được FFmpeg/FFprobe trên máy tính mới cài đặt.
- **Tải model tách Vocal thông minh**: Áp dụng cơ chế fallback tương tự cho các manifest mô hình tách thoại offline.
- **Tối ưu hóa dung lượng & dọn dẹp workspace**: Loại bỏ các artifact và file tạm thừa, tinh gọn codebase.

## TediaPros v0.1.32

### Tách nền màu Chroma Key cho hiệu ứng CapCut

- **Nhận diện Chroma Key tự động**: Tự động phát hiện cấu hình `LumiChromaKey` trong các gói hiệu ứng CapCut (`LumiExportData.lua`) để trích xuất màu key (nền xanh lá, xanh dương), độ tương đồng (`similarity`) và độ hòa trộn mềm viền (`blend`).
- **Khử ám màu (Despill) & Giữ khói mượt**: Preview canvas RGBA thời gian thực áp dụng thuật toán khử ám màu dư (green/blue spill suppression) và giữ độ trong suốt tự nhiên của khói, tia lửa, hiệu ứng mờ viền.
- **FFmpeg Render Pipeline không trung gian**: Tích hợp trực tiếp bộ lọc `colorkey` và `despill` vào filter graph của AutoShort Burn Pipeline, không cần xuất tạm sang WebM hay re-encode trung gian.
- **Đồng bộ Vault & Khôi phục Metadata**: Lưu trữ thông số Chroma Key vào `metadata.json` của kho lưu trữ vĩnh viễn (Permanent Vault). Tự động tìm kiếm và khôi phục thông số key từ cache gốc vào kho lưu trữ khi sử dụng hoặc xem trước.
- **Giao diện trực quan**: Cập nhật nhãn Tách nền màu trên bảng điều khiển hiệu ứng video, hiển thị preview chính xác tương thích với kết quả xuất video thật.

## TediaPros v0.1.31

### CapCut Overlay Vault & Hiệu ứng video

- **CapCut Local Cache Scanner**: Tự động quét và phát hiện các hiệu ứng overlay video (`.mp4`) từ cache CapCut.
- **Tên hiệu ứng chuẩn xác**: Trích xuất tên hiển thị dễ hiểu từ `draft_content.json` (`materials.video_effects`), giải quyết triệt để lỗi hiển thị mã ID AE2Effect.
- **Permanent Vault (Kho lưu trữ vĩnh viễn)**: Lưu/ghim hiệu ứng vào kho cục bộ của TediaPros, không lo bị mất khi CapCut dọn dẹp cache.
- **Giao diện 3 tab**: Tích hợp tab Hiệu ứng mẫu / Đồng bộ CapCut / Kho đã lưu kèm hướng dẫn 4 bước tải và sử dụng hiệu ứng từ CapCut.
- **FFmpeg Render Pipeline**: Hỗ trợ render `custom_overlay` với cơ chế blend màu (screen blend) và alpha merge tối ưu.

### Điều khiển tốc độ Video (Video Speed)

- Tùy chỉnh tốc độ video linh hoạt (tăng tốc / làm chậm) qua chuỗi bộ lọc `atempo` của FFmpeg.
- Tùy chọn giữ nguyên cao độ giọng nói (pitch preservation) và đặt tên file tránh trùng lặp an toàn.

### Hiệu ứng mở đầu (Opening Hooks)

- Bổ sung hiệu ứng intro Flash và Zoom-in cho phần mở đầu video.
- Tự do cấu hình thời lượng và cường độ hiệu ứng.

### Cải tiến AutoShort Overlay

- Hỗ trợ làm mờ viền mềm (Feather/Soft Edge) cho overlay hình ảnh.
- Hỗ trợ xoay hình ảnh (Rotation) với bộ lọc rotate của FFmpeg.
- Bo góc (Corner radius) và đa dạng hóa kiểu mask (hình chữ nhật, ellipse, hình chữ nhật bo góc).

### Giao diện & Trải nghiệm người dùng

- Tinh chỉnh bảng màu sang tone nâu ấm / kem trang nhã cho toàn bộ bảng điều khiển hiệu ứng video.
- Thêm nhãn PRO và tỉ lệ khung hình 9:16 rõ ràng, xem trước hiệu ứng trực quan.

## TediaPros v0.1.30

### Whisper Engine & Trí tuệ nhân tạo (AI)

- **Whisper Daemon Mode:** Bổ sung cờ `--daemon` cho Faster-Whisper engine, duy trì tiến trình chạy nền và giữ model sẵn sàng trong bộ nhớ RAM/VRAM. Loại bỏ hoàn toàn độ trễ khởi động lại (cold-start) khi phiên âm hàng loạt video trong hàng đợi.
- **Mô hình Large-v3 & Large-v3 Turbo:** Mở rộng danh mục mô hình Whisper với `large-v3` (độ chính xác tối đa) và `large-v3-turbo` (tốc độ cao, tối ưu tài nguyên VRAM). Hỗ trợ chọn trực tiếp từ giao diện AutoShort và AudioText.
- **Tùy chỉnh độ nhạy VAD:** Cung cấp các tham số ngưỡng Silero VAD linh hoạt (`vad_threshold`, `vad_speech_pad_ms`, v.v.) với giá trị mặc định nhạy bén hơn, hạn chế tối đa việc bỏ sót câu thoại ngắn.

### OCR & Tăng tốc xử lý hình ảnh

- **Bộ nhớ đệm khung hình tĩnh OCR:** Thêm thuật toán kiểm tra độ lệch khung hình (`diff < 4.0`), tái sử dụng kết quả nhận diện cho các khung hình tĩnh liền kề trong video stream, giúp giảm tải suy luận OCR và tăng tốc độ xử lý tổng thể.
- **Bộ mã hóa (Burn Pipeline):** Ghi nhớ encoder phần cứng đã kiểm chứng thành công (`cachedWorkingEncoder`), tối ưu hóa preset ffmpeg và bổ sung hỗ trợ `h264_videotoolbox` cho macOS.

### Nâng cấp AutoShort & Phụ đề

- **Mở rộng hàng đợi:** Tăng trần số lượng video xử lý trong một phiên hàng đợi AutoShort từ 100 lên 500 video.
- **Kiểu chữ & Phụ đề linh hoạt:** Tích hợp bộ 24 font chữ tiếng Việt, hỗ trợ điều chỉnh dynamic font weights, chuyển đổi chữ hoa/thường (uppercase, lowercase), tối ưu ngắt dòng câu và thời gian hiển thị single-word.

## TediaPros v0.1.26

### Auto Short và xử lý video

- Lưu và khôi phục hàng đợi batch, cache kết quả STTN đã xác thực, giữ log chẩn đoán và thử lại có giới hạn khi một video lỗi.
- Thêm cắt đoạn theo biên khung hình đã kiểm chứng, preview STTN từ đúng video sau cắt và chặn cue nhận diện băng qua mối nối không rõ ràng.
- Thêm ảnh và chữ phủ cho đầu ra Auto Short, đồng thời giữ nguyên lịch sử thao tác và danh tính resume của workflow cũ không cắt.

### Microsoft Edge-TTS

- Bổ sung Edge-TTS trực tuyến cho tab Voice và AutoShort, có danh mục giọng đa ngôn ngữ, preflight tổng hợp thật và Local TTS vẫn là mặc định tương thích.
- Xác thực đầy đủ audio trước khi publish; AutoShort chuẩn hóa về PCM WAV trước cache và tiếp tục dùng dubbing planner trong trần tempo `1,80x`.
- Hủy tác vụ đóng request catalog, WebSocket và stream an toàn; cache single-flight không lộ file đang có thể rollback, và lưu audio không ghi đè đường dẫn đổi phần mở rộng khi chưa được xác nhận.

### Độ tin cậy AI và metadata

- Siết kiểm tra JSON/ID cho dịch, tiêu đề, mô tả và SEO; lỗi metadata không loại bỏ video đã render thành công.
- Giữ nội dung AI bám theo phụ đề nguồn, tách riêng hashtag và bảo toàn định dạng đầu ra cũ.

## TediaPros v0.1.25

### Phát hành Windows

- Sửa kiểm chứng đường dẫn title sidecar trên Windows CI: cùng một thư mục tạm có thể được Node trả về qua alias 8.3 hoặc đường dẫn dài. Test nay canonicalize hai đường dẫn trước khi so sánh, nên không còn chặn đóng gói do khác biểu diễn đường dẫn.

## TediaPros v0.1.24

### Auto Short theo vùng OCR

- Thêm chế độ tự đặt phụ đề riêng cho từng video từ OCR timeline hiện có. Vùng quét vẫn do người dùng chọn; hệ thống không quét toàn khung và không gọi OCR lần hai.
- Chỉ chọn vùng đạt đồng thời độ phủ thường xuyên và chiều cao chữ điển hình lớn, loại chữ/logo cố định; khi dữ liệu không rõ sẽ dùng khung phụ đề thủ công.
- Chuẩn hóa vùng phụ đề, OCR và blur theo tỷ lệ khung hình để batch 1080p/4K giữ cùng bố cục tương đối.

### Lồng tiếng và phục hồi render

- Giữ đủ lời trong trần tempo 1,80x, làm chậm hình có giới hạn và phát lại đoạn hình thuộc đúng cue khi cần thêm thời gian.
- Video lỗi được giữ kết quả chẩn đoán và thử lại một lần sau khi lượt đầu của hàng đợi hoàn tất; lượt phục hồi đo lại audio và bỏ cache TTS cũ.
- Parser metadata chấp nhận một object JSON hợp lệ được Gemini bọc bằng code fence hoặc lời dẫn mà vẫn giữ validation schema hiện có.

### Runtime tải theo nhu cầu

- Phát hành `runtime-v5` với FFmpeg, Faster-Whisper, CUDA runtime cho Whisper, RapidOCR DirectML, Video2X, Douyin, Separator và STTN CPU portable. STTN CUDA tiếp tục dùng build cục bộ cho máy chuyên dụng vì gói CUDA vượt giới hạn kích thước asset GitHub.
- Sửa OCR 1.2.1 nhận đúng model đã kiểm SHA-256 khi Windows AppContainer canonicalize đường dẫn qua `LocalCache`.
- Các engine vẫn được tải riêng, kiểm SHA-256 và capability trước khi kích hoạt; model STTN và Separator tiếp tục tải từ nguồn đã ghim riêng.

## TediaPros v0.1.23

### Độ tin cậy dịch và lồng tiếng AutoShort

- Bổ sung bộ điều phối dịch có ngân sách, checkpoint, kiểm tra ID/cấu trúc phản hồi và đánh giá ngôn ngữ để khôi phục phần cue còn thiếu mà không ghi đè phần đã hợp lệ.
- Gom các mảnh ASR liên tiếp thành đơn vị thoại trước TTS, giữ ledger cue nguồn và chỉ đặt khoảng bảo vệ 0,50 giây giữa các đơn vị thoại. Điều này loại bỏ các cửa sổ đọc 0,14–0,38 giây phát sinh khi một câu bị tách thành nhiều mảnh.
- Thêm preflight rút gọn có giới hạn và một lượt recovery TTS khi audio vượt cửa sổ. Mọi phương án vẫn phải giữ nội dung cần thiết; nếu không fit sẽ yêu cầu xem lại.
- Giữ nguyên trần tempo vật lý 1,45x; ứng dụng không tăng tốc quá trần hoặc cắt lời để ép khớp timeline.
- Phụ đề của đơn vị thoại được chia theo từ và gắn lại `sourceIndex` gốc để giữ đồng bộ với SRT sau khi gom cue.

## TediaPros v0.1.22

### Sửa runtime phụ đề và Douyin

- Chấp nhận metadata file 0 byte hợp lệ trong archive Faster-Whisper, đồng thời vẫn bắt buộc entrypoint có dữ liệu.
- Bổ sung package `storage` bị thiếu trong engine Douyin và khóa kiểm tra hidden import khi build native.
- Native capability probe trên Windows giờ dừng workflow ngay khi bất kỳ engine nào trả mã lỗi.
- Chuyển kênh runtime bất biến sang `runtime-v3` để bản cài mới nhận đúng asset đã sửa.

## TediaPros v0.1.21

### Production Windows Auto Short

- Đóng gói runtime Windows `runtime-v2` từ các input đã pin và verify SHA-256.
- Sửa build engine để không phụ thuộc thư mục chạy PyInstaller; tăng cường kiểm tra archive trước khi giải nén.
- Giữ độc lập timeline nguồn/đích, không cắt speech khi căn TTS, và dọn child process Auto Short khi thoát ứng dụng.
- Release lần này tập trung vào bộ cài Windows; macOS không nằm trong phạm vi phát hành.

### Đổi thương hiệu

- Đổi tên hiển thị và bộ nhận diện ứng dụng thành TediaPros.
- Giữ nguyên App ID, protocol `tblao://`, storage namespace và kết nối TTS Server để không mất dữ liệu hoặc thay đổi luồng xử lý.
- Tự động di chuyển dữ liệu người dùng cũ sang profile mới khi cần.

### Sửa lỗi khởi động

- Khắc phục lỗi TediaPros nhận nhầm FFmpeg đã cài là đang bị thiếu trên Windows.
- Ứng dụng không còn tải và cài lại FFmpeg ở mỗi lần mở.
- Việc kiểm tra dùng đúng tham số phiên bản của FFmpeg và vẫn ưu tiên bản công cụ do TediaPros quản lý.

### Điều chỉnh giao diện

- Tiêu đề trong tab **Hệ sinh thái Neeyu** được trình bày thành hai dòng: “Một hành trình” và “nhiều công cụ sáng tạo.”
- Bỏ dấu phẩy giữa hai vế để nhịp đọc và bố cục tiêu đề rõ ràng hơn.

### Cập nhật

- Windows sẽ tự nhận, tải và cài đặt v0.1.21 khi kết nối được với GitHub.
- macOS không nằm trong phạm vi phát hành của v0.1.21; hướng dẫn DMG macOS sẽ được cập nhật cùng một release macOS riêng.
