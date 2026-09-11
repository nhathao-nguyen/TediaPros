# PRODUCT.md — Bản Đồ Sản Phẩm TediaPros

Tài liệu này cung cấp bức tranh toàn cảnh về sản phẩm **TediaPros**: mục đích ra đời, đối tượng người dùng, tính năng chi tiết trên 10 Tab giao diện, giới hạn kỹ thuật và kết quả cụ thể người dùng nhận được.

---

## 1. Tuyên Ngôn Sản Phẩm & Mục Tiêu

**TediaPros** là ứng dụng máy tính đa nền tảng (Desktop Shell Hybrid) chuyên biệt cho quy trình sáng tạo, tải và tự động hóa biên tập video ngắn (Reels, TikTok, Shorts).
Ứng dụng giải quyết triệt để 3 bài toán lớn nhất của các nhà sáng tạo nội dung:
1. **Rào cản ngôn ngữ & lồng tiếng:** Tự động nghe, bóc băng giọng nói, dịch thuật ngữ cảnh và lồng tiếng tự nhiên bằng AI với độ đồng bộ khớp từng giây, không bị trôi timeline.
2. **Loại bỏ phụ đề & chữ cũ:** Nhận diện và làm mờ hoặc xóa chữ triệt để bằng AI (STTN Inpainting), không để lại vệt nhòe hoặc lem màu.
3. **Khai thác dữ liệu video đa nguồn:** Tải video chất lượng cao từ hơn 1,000 trang web (qua yt-dlp) và crawler Douyin chuyên nghiệp không watermark.

---

## 2. Đối Tượng Người Dùng & Các Tình Huống Sử Dụng Chính (Use Cases)

- **Nhà sáng tạo nội dung Video ngắn (Shorts/TikTok/Reels Creators):**
  - Nhập video tiếng nước ngoài (tiếng Trung, tiếng Anh), tự động xóa chữ gốc, dịch sang tiếng Việt, lồng tiếng AI và gắn phụ đề tạo thành phẩm hoàn chỉnh chỉ sau một click.
- **Biên dịch viên & Subtitler:**
  - Tách phụ đề tự động từ âm thanh (Audio-to-Text) hoặc từ hình ảnh chữ chạy (OCR Screen-to-Text), chỉnh sửa kịch bản và xuất file `.srt`.
- **Người nghiên cứu & Người thu thập tư liệu:**
  - Tải toàn bộ kênh Douyin của một tác giả hoặc tải danh sách phát YouTube về máy với đầy đủ metadata và kiểm soát trùng lặp qua SQLite.

---

## 3. Danh Mục 10 Tab Chức Năng Trên Giao Diện

Giao diện ứng dụng được tổ chức thành 10 thẻ chức năng chính (xác nhận tại [src/renderer/src/App.tsx#L40-L115](file:///f:/Son/tool/TediaPros/src/renderer/src/App.tsx#L40-L115)):

| Tab ID | Tên Tab | Biểu Tượng | Vai Trò & Chức Năng Cốt Lõi |
| :--- | :--- | :---: | :--- |
| `download` | **Tải xuống** | ⬇ | Tải video, âm thanh từ YouTube, Facebook, TikTok... Hỗ trợ chọn độ phân giải (1080p, 4K), tách MP3, nhúng thumbnail/metadata, chuyển đổi định dạng H.264 tự động. |
| `douyin` | **Douyin** | 🎬 | Quét toàn bộ kênh tác giả hoặc danh sách phát Douyin; tải hàng loạt video/ảnh không watermark; quản lý phiên đăng nhập và Cookie session. |
| `audiotext` | **Tạo phụ đề** | 📝 | Bóc băng lời nói trong video thành phụ đề có timestamp chính xác bằng Faster-Whisper. Hỗ trợ chạy trên GPU NVIDIA CUDA hoặc CPU. |
| `screen` | **Đọc chữ video** | 🔍 | Quét chữ xuất hiện trên màn hình video bằng RapidOCR ONNX. Thích hợp cho video không có tiếng nói nhưng có chữ chạy trên hình. |
| `autoshort` | **Auto Short** | ⚡ | **Tính năng hạt nhân:** Pipeline sản xuất video ngắn tự động: Tách thoại MDX $\rightarrow$ Nhận diện Whisper/OCR $\rightarrow$ Dịch thuật ngữ cảnh $\rightarrow$ Lồng tiếng TTS (Edge/Local/Clone) $\rightarrow$ Làm mờ Planar RGB / STTN Inpaint $\rightarrow$ Render phụ đề ASS. |
| `editor` | **Biên tập video** | ✂ | Cắt ghép phân đoạn, xem trước video và phụ đề, thay đổi âm lượng, gộp nhiều đoạn clip. |
| `enhance` | **Nâng cấp video** | 🚀 | Nâng cấp độ nét và chất lượng khung hình video bằng engine AI Video2X (Real-ESRGAN / Rife). |
| `voice` | **Quản lý Giọng đọc** | 🎙 | Quản lý kho giọng TTS (Edge TTS, ElevenLabs, máy chủ TTS nội bộ), trích xuất giọng mẫu để clone giọng (Voice Clone). |
| `logs` | **Nhật ký** | 📜 | Xem log hoạt động thời gian thực của hệ thống, tạo báo cáo chẩn đoán ẩn danh (Support Report) gửi hỗ trợ kỹ thuật. |
| `license` | **Giấy phép** | ⚖ | Xem điều khoản bản quyền PolyForm Noncommercial 1.0.0 và ghi nhận bản quyền các thư viện mã nguồn mở bên thứ ba. |

---

## 4. Kết Quả Người Dùng Nhận Được Sau Mỗi Luồng Xử Lý

Tùy theo tác vụ, hệ thống tạo ra các tệp đầu ra cụ thể trong thư mục đích do người dùng lựa chọn:

1. **Thành phẩm AutoShort:**
   - `<ten-video>_autoshort.mp4`: Video hoàn thiện với âm thanh lồng tiếng đã căn chỉnh, phụ đề ASS sinh động (Word-Reveal / Word-Highlight), chữ cũ đã được xóa/làm mờ.
   - `tieude.txt`: Tiêu đề gợi ý và mô tả video được AI sinh tự động dựa trên nội dung kịch bản.
   - Thư mục kiểm toán `.autoshort-item-<id>/` (nếu bật chế độ audit): Lưu trữ `source.srt`, `translated.srt`, `timed.srt`, `tts-timeline.json`, `audit.json` giúp người dùng kiểm tra đối chiếu từng câu thoại.
2. **Thành phẩm Tải xuống & Douyin:**
   - Video MP4 (chuẩn H.264/AAC tương thích mọi thiết bị), tệp MP3 (320kbps), thumbnail JPG, và tệp nhật ký `download_manifest.jsonl`.
3. **Thành phẩm Phụ đề:**
   - Tệp phụ đề chuẩn `.srt` với timestamp đồng bộ đến từng mili-giây.

---

## 5. Giới Hạn Kỹ Thuật & Yêu Cầu Môi Trường

- **Hệ điều hành:** Windows 10/11 x64 (Khuyến nghị có GPU tương thích DirectX 12 cho DirectML và NVIDIA CUDA cho Whisper); macOS 12+ Apple Silicon ARM64.
- **Phần cứng tối thiểu:** 8 GB RAM, 5 GB dung lượng đĩa trống.
- **Phần cứng khuyến nghị cho STTN / DirectML Separation:** 16 GB RAM, GPU rời 4GB+ VRAM.
- **Giới hạn hàng đợi AutoShort:** Tối đa 100 video trong một phiên xử lý (`[src/shared/autoShortContract.ts#L294](file:///f:/Son/tool/TediaPros/src/shared/autoShortContract.ts#L294)`).
- **Giới hạn nhịp độ phát âm:** Từ 1.10x đến 1.45x; không bao giờ nén âm thanh vượt quá 1.45x để đảm bảo giọng đọc nghe rõ ràng (`[src/main/dubbing/policy.ts#L18-L26](file:///f:/Son/tool/TediaPros/src/main/dubbing/policy.ts#L18-L26)`).
