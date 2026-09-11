# GLOSSARY.md — Từ Điển Thuật Ngữ Kỹ Thuật & Nghiệp Vụ TediaPros

Tài liệu này chuẩn hóa các định nghĩa, thuật ngữ và hằng số vật lý được sử dụng thống nhất trong toàn bộ hệ thống mã nguồn và tài liệu của **TediaPros**.

---

## 1. Khái Niệm Phân Hệ Lồng Tiếng (Dubbing & TTS)

- **Cue (Phát ngôn / Dòng phụ đề):** Đơn vị thời gian nhỏ nhất của lời thoại hoặc phụ đề, có mốc thời gian bắt đầu (`start`), kết thúc (`end`) tính bằng giây và nội dung văn bản (`text`).
- **Dubbing Unit:** Cấu trúc dữ liệu đại diện cho một phân đoạn phát âm được lên lịch trong quá trình lồng tiếng, chứa thông tin cửa sổ âm thanh và hệ số nhịp độ (`tempo`).
- **Semantic Group (`semanticGrouping.ts`):** Nhóm các cues có sự liền mạch về mặt ngữ nghĩa và cú pháp câu văn. Thay vì tổng hợp TTS ngắt quãng theo từng từ rời rạc, hệ thống gom thành semantic group để phát âm tự nhiên, sau đó mới chia lại timestamp cho từng cue.
- **Source-Anchored Dubbing:** Chính sách cố định mốc bắt đầu (`start`) của câu nói lồng tiếng bám chặt theo thời điểm nhân vật trong video gốc bắt đầu cất lời, ngăn ngừa hiện tượng tích lũy sai số trôi timeline (cumulative start drift).
- **Tempo Ceiling (Trần nhịp độ):**
  - **Preferred Max:** `1.10x` (Mức tối ưu để giữ chất giọng ấm và tự nhiên).
  - **Normal Max:** `1.25x` (Mức chấp nhận được đối với các video có tiết tấu nhanh).
  - **Hard Max:** `1.45x` (Trần vật lý tối đa tuyệt đối, cấm vượt qua để tránh biến dạng giọng nói).
- **Protected Gap (`DUBBING_PROTECTED_GAP_SECONDS = 0.50s`):** Khoảng lặng bảo vệ tối thiểu cần giữ lại giữa câu nói trước và câu nói kế tiếp, tránh hiện tượng nói dồn dập, thở dốc.
- **Speech Trim Thresholds:**
  - Ngưỡng phát hiện bắt đầu/kết thúc phát âm: `-50 dB`.
  - Độ trễ liên tục onset: `0.03s` (30ms).
  - Độ trễ liên tục offset: `0.10s` (100ms).

---

## 2. Khái Niệm Phân Hệ Nhận Diện Chữ & Thị Giác (OCR & Vision)

- **Bounding Box (Hộp bao):** Tọa độ hình chữ nhật bao quanh chữ xuất hiện trên màn hình video, biểu diễn theo tọa độ chuẩn hóa $[0.0, 1.0]$ hoặc tọa độ pixel nguyên.
- **Visual Timeline (`OcrVisualTimeline`):** Kịch bản diễn hoạt của các hộp chữ theo trục thời gian, lấy mẫu cố định ở tần số **8 FPS** (`OCR_SAMPLE_FPS = 8`).
- **IoU (Intersection over Union):** Chỉ số đo độ trùng khớp không gian giữa hai bounding box trên hai khung hình kế tiếp, dùng để ghép chuỗi ký tự qua thời gian và lọc nhiễu nhấp nháy (flicker).
- **Planar RGB (`gbrp`):** Định dạng lưu trữ khung hình mà ba kênh màu Red, Green, Blue được tách thành ba mặt phẳng độc lập (thay vì xen kẽ hay nén sắc độ YUV 4:2:0). Đây là điều kiện bắt buộc khi dùng filter `maskedmerge` của FFmpeg để triệt tiêu hiện tượng lem màu viền (chroma bleed / color fringe).
- **STTN (Spatio-Temporal Transformer Network):** Mạng nơ-ron học sâu dùng cơ chế Transformer không-thời gian để phục hồi và điền đầy khung hình video tại vùng phụ đề cũ đã bị xóa (Inpainting).

---

## 3. Khái Niệm Phân Hệ Tách Thoại (Vocal Separation)

- **Stem:** Một luồng âm thanh thành phần sau khi tách từ một bản nhạc đa kênh:
  - **Vocals (Vocal Stem):** Chỉ chứa giọng nói hoặc tiếng hát của con người.
  - **Instrumental (Backing Stem):** Chứa toàn bộ phần âm thanh còn lại (nhạc nền BGM, tiếng động môi trường, hiệu ứng SFX).
- **MDX-Net:** Kiến trúc mạng nơ-ron học sâu xử lý phổ âm thanh (Spectrogram) chuyên dụng cho bài toán Music Source Separation.
- **DirectML:** Giao diện lập trình tăng tốc máy học của Microsoft chạy trên nền DirectX 12, cho phép tận dụng GPU của nhiều hãng (NVIDIA, AMD Radeon, Intel Iris/Arc) trên Windows.
- **CPU Fallback:** Cơ chế an toàn tự động phát hiện khi DirectML gặp sự cố (hết VRAM, crash driver) và kích hoạt chế độ xử lý trên CPU mà không làm sập tiến trình ứng dụng.

---

## 4. Khái Niệm Phân Hệ Phụ Đề (Subtitle & ASS Burning)

- **ASS (Advanced SubStation Alpha):** Định dạng tệp phụ đề nâng cao cho phép định nghĩa tọa độ pixel chính xác, font chữ, màu sắc viền, bóng đổ và hiệu ứng karaoke theo từng từ.
- **Word-Reveal Style:** Hiệu ứng chữ xuất hiện tuần tự theo từng từ khi giọng đọc cất lên.
- **Word-Highlight Style:** Cả câu hiển thị sẵn trên màn hình, từng từ đổi sang màu nhấn (highlight) đồng bộ theo âm thanh.
- **Font Measurement (`opentype.js`):** Quá trình phân tích file nhị phân TTF để đo đạc chính xác kích thước glyph hộp bao (bounding box) trước khi render, đảm bảo phụ đề không tràn mép màn hình điện thoại.

---

## 5. Khái Niệm Quản Lý Tài Nguyên & Đĩa (Resource & Disk Budget)

- **Item Scope (`autoShortItemScope.ts`):** Phạm vi vòng đời cô lập của từng video trong hàng đợi xử lý, quản lý thư mục tạm riêng và hủy bỏ tập trung cây tiến trình con.
- **Disk Reservation Ledger (`autoShortDiskBudget.ts`):** Sổ cái dự trù dung lượng đĩa trước khi cấp quyền xử lý video, bảo đảm ổ đĩa không bị tràn (ENOSPC).
- **Headroom Reserve (`STTN_ROLLING_RESERVE_BYTES`):** Dung lượng an toàn tối thiểu được giữ lại (khoảng **685 MB**) để hệ điều hành và các tiến trình tạm thời không bị đình trệ.
- **Safe Contained Path (`safeContainedPath.ts`):** Cơ chế an toàn bắt buộc mọi đường dẫn thao tác tệp phải nằm gọn bên trong thư mục gốc được cấp phép, ngăn chặn tấn công Directory Traversal (`..` attack).
