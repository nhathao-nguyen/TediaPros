# Từ Điển Nghiệp Vụ & Quy Tắc Kỹ Thuật (Domain Knowledge)

Tài liệu này chuẩn hóa các khái niệm nghiệp vụ, định nghĩa dữ liệu và hằng số vật lý được áp dụng trong toàn bộ hệ thống **TediaPros**.

---

## 1. Khái Niệm Xử Lý Âm Thanh & Lồng Tiếng (Dubbing Domain)

### 1.1. Cues, Segments & Semantic Groups
- **Cue:** Một đơn vị phụ đề hoặc phát ngôn có mốc thời gian bắt đầu (`start`) và kết thúc (`end`) tính bằng giây.
- **Segment:** Phân đoạn âm thanh tương ứng với một hoặc nhiều cues.
- **Semantic Group (`semanticGrouping.ts`):** Nhóm các cues có liên kết chặt chẽ về ngữ nghĩa câu văn. Khi lồng tiếng, nhóm này được tổng hợp thành một chuỗi giọng đọc liền mạch thay vì ngắt vụn theo từng từ đơn lẻ.

### 1.2. Hằng Số Vật Lý & Ngưỡng Âm Thanh (`autoShortPolicy.ts`)
Tất cả các ngưỡng âm thanh đều được hiệu chuẩn vật lý, độc lập với ngôn ngữ:
- **Speech Onset Sensitivity (`-50 dB`):** Ngưỡng nhạy cảm phát hiện bắt đầu tiếng nói. Mức `-50 dB` đảm bảo các âm xát vô thanh ban đầu (như */s/*, */f/*, */h/*) hoặc âm mũi nhẹ (*/m/*, */n/*) không bị cắt gọt.
- **Onset Continuous Duration (`0.03s` / 30ms):** Thời gian liên tục vượt ngưỡng để xác nhận bắt đầu phát âm, lọc bỏ tiếng click chuột hoặc tạp âm cực ngắn.
- **Speech Offset Sensitivity (`-50 dB`):** Ngưỡng xác định kết thúc phát âm.
- **Offset Continuous Duration (`0.10s` / 100ms):** Đảm bảo âm đuôi của từ không bị cắt cụt đột ngột.
- **Protected Gap (`AUTO_SHORT_TTS_MIN_GAP_SECONDS = 0.50s`):** Khoảng lặng tự nhiên tối thiểu giữa câu kết thúc và câu tiếp theo. Giữ cho giọng đọc không bị dồn dập, thở dốc.

### 1.3. Chính Sách Điều Chỉnh Nhịp Độ (Dubbing Tempo Policy)
Khi dịch sang ngôn ngữ mới (vd: Tiếng Trung $\rightarrow$ Tiếng Việt), số lượng âm tiết thường dài hơn 15–35%:
- **Preferred Max Tempo:** `1.10x` (Tối ưu cho độ tự nhiên).
- **Normal Max Tempo:** `1.25x` (Chấp nhận được đối với video nhịp nhanh).
- **Hard Max Tempo:** `1.80x` (Trần tạm thời đã được chấp thuận).
- **Quy tắc không làm mất câu (No Silent Drop):** Nếu thời lượng câu sau khi tăng tốc đến `1.80x` vẫn không vừa khung thời gian có sẵn:
  - Nếu nhóm có từ 2 cues trở lên: Tự động tách tại ranh giới cue hợp lý (`shouldSplitAutoShortVoiceGroup`).
  - Đoạn hình được làm chậm thêm tối đa 20% (cộng guard DSP 15ms), rồi phát lại phần cuối trong đúng khoảng nguồn của nhóm; tổng phần thêm tối đa 60% mỗi đoạn.
  - Nếu vẫn không vừa, lưu lỗi và checkpoint, tiếp tục hàng đợi rồi tự thử lại video đúng một lần ở cuối batch.

---

## 2. Khái Niệm Xử Lý Hình Ảnh & OCR (Vision & Inpainting Domain)

### 2.1. Tọa Độ Vùng Chuẩn Hóa (Normalized Region)
- Mọi vùng chọn (ROI - Region of Interest, Blur Region) đều được biểu diễn dưới dạng tỷ lệ chuẩn hóa từ `0.0` đến `1.0`:
  - `x0, y0`: Tọa độ góc trên bên trái.
  - `x1, y1`: Tọa độ góc dưới bên phải.
  - Điều kiện hợp lệ: $0 \le x_0 < x_1 \le 1$ và $0 \le y_0 < y_1 \le 1$.

### 2.2. Visual Timeline & Text Box Tracking (`ocrVisualTimeline.ts`)
- Quét OCR không xử lý từng frame đơn lẻ độc lập mà gom nhóm các bounding box qua trục thời gian.
- **Visual Cue:** Chứa chuỗi văn bản, tọa độ hình chữ nhật, thời điểm xuất hiện và biến mất.
- Loại bỏ nhiễu nhấp nháy (flicker) bằng thuật toán so khớp IoU (Intersection over Union) giữa các frame liên tiếp.

### 2.3. Quy Tắc Planar RGB & Chống Lỗi Ám Màu (Chroma Bleed)
- Video nén thông thường sử dụng không gian màu **YUV 4:2:0** (thành phần màu Chroma bị giảm độ phân giải một nửa so với Luma).
- Khi dùng filter `maskedmerge` của FFmpeg trên YUV 4:2:0, viền của vùng làm mờ sẽ bị lem màu hoặc để lại bóng mờ chữ cũ (ghosting).
- **Quy chuẩn TediaPros:** Bắt buộc chuyển đổi video sang định dạng **Planar RGB** (`gbrp`), áp dụng mask làm mờ đa tầng với sigma tỷ lệ theo chiều cao khung hình, sau đó mới nén lại về định dạng xuất xưởng.

### 2.4. Tự đặt vị trí phụ đề theo OCR

- `subtitlePlacementMode = ocr-dominant` tái sử dụng visual OCR timeline đã tạo cho `ocr-auto` hoặc STTN; không gọi OCR lần hai.
- Phạm vi tìm kiếm luôn là `ocrRegion` normalized do người dùng khoanh. Thuật toán không tự đổi sang toàn khung, không mở rộng ROI và không dùng chữ nằm ngoài ROI.
- Mỗi video được đánh giá độc lập. Vùng hợp lệ phải đồng thời nằm trong nhóm xuất hiện thường xuyên nhất và nhóm có chiều cao chữ điển hình lớn nhất, với dung sai 10% cho nhiễu OCR.
- Chỉ track có độ phủ ít nhất 25%, confidence trung bình ít nhất 0,75 và tối thiểu hai trạng thái text khác nhau mới được xét. Điều này giảm khả năng chọn logo hoặc tiêu đề cố định.
- Khi hai tiêu chí xung đột, có nhiều vùng gần ngang nhau, dữ liệu yếu hoặc vùng không đủ chỗ, pipeline dùng `subRegion` do người dùng đặt làm dự phòng. Fallback không thay đổi ROI và không che giấu lỗi OCR/STTN.
- Vị trí được chọn giữ ổn định suốt video. Cỡ chữ OCR chỉ dùng để chọn vùng; font đầu ra vẫn theo cấu hình và bộ layout ASS hiện có.

---

## 3. Khái Niệm Tách Thoại (Vocal Separation Domain)

### 3.1. Stems
- **Vocals (Vocal Stem):** Giọng nói / tiếng hát gốc của nhân vật trong video.
- **Instrumental (Backing Stem):** Toàn bộ âm thanh còn lại bao gồm nhạc nền (BGM), hiệu ứng âm thanh (SFX), tiếng động môi trường.

### 3.2. DirectML & Chuẩn Tăng Tốc Phần Cứng
- Sử dụng backend **ONNX Runtime với DirectML (DirectX 12)** trên Windows.
- Tương thích rộng rãi với GPU NVIDIA, AMD Radeon và Intel Iris/Arc.
- Tự động fallback sang CPU nếu VRAM không đủ hoặc DirectML báo lỗi thiết bị.

---

## 4. Khái Niệm Phụ Đề & Kiểu Dáng (Subtitle Domain)

### 4.1. Hiệu Ứng Trình Diễn (Display Styles)
- **Standard:** Hiển thị trọn câu tĩnh theo từng dòng.
- **Word-Reveal:** Từng từ xuất hiện đồng bộ theo tiến trình đọc của audio.
- **Word-Highlight:** Cả câu hiển thị sẵn, từ đang phát âm được tô sáng bằng màu nhấn (highlight color).

### 4.2. An Toàn Font Chữ (Font Integrity)
- TediaPros sử dụng `opentype.js` để đo đạc chính xác kích thước glyph tại `fontMeasure.ts` trước khi sinh file ASS.
- Font tùy chỉnh của người dùng được kiểm tra và cô lập bằng `safeContainedPath`. Tránh crash FFmpeg Libass khi đường dẫn chứa ký tự đặc biệt hoặc Unicode phức tạp.

---

## 5. Quản Lý Ngân Sách Đĩa (Disk Budget Domain)

- **Item Scope:** Mỗi video trong hàng đợi xử lý sở hữu một thư mục tạm riêng (`.autoshort-item-<id>/`).
- **Disk Reservation:** Hệ thống ước tính dung lượng tạm cần dùng (thường gấp 3–5 lần dung lượng video gốc do chứa các file WAV uncompressed, frames tạm, masks).
- **Cleanup Guarantee:** Dù pipeline thành công hay thất bại giữa chừng, toàn bộ thư mục tạm của item đó phải được giải phóng hoàn toàn, chỉ giữ lại file video thành phẩm và tệp audit nếu được kích hoạt.

---

## 6. Metadata YouTube từ SRT

- **Nguồn:** Chỉ dùng các cue SRT nằm trong thời lượng video đầu ra đã được probe. SRT, tên kênh và brand voice là dữ liệu, không phải chỉ dẫn có quyền thay đổi schema hoặc chính sách an toàn.
- **Kết quả:** `VideoSeoMetadata` gồm đúng một `title`, một `description`, `tags` và `hashtags`. Hashtag luôn tách khỏi title/description; nếu provider cũ chưa trả trường hashtags, hệ thống chuẩn hóa tags để tạo fallback. `title` vẫn được giữ riêng trong kết quả IPC để tương thích với UI cũ.
- **Tệp xuất:** Mỗi video có tối đa một `tieude.txt` UTF-8 đặt cạnh video. Dòng đầu là title; sau đó là khối `Description:` một paragraph, `Tags:` một dòng phân cách bằng dấu phẩy và `Hashtags:` một dòng các hashtag cách nhau bằng khoảng trắng. Không tạo `description.txt`, `tags.txt` hoặc metadata JSON riêng.
- **Mặc định biên tập:** Description mức `short`, hướng tới 2–3 câu trong một paragraph. Đây là lựa chọn sản phẩm, không phải cam kết xếp hạng. Không cắt chuỗi làm mất số, phủ định, điều kiện hoặc ý cuối.
- **Giới hạn:** Title tối đa 100 ký tự Unicode; description tối đa 5.000 byte UTF-8; title/description không chứa `<` hoặc `>`; tổng tags tối đa 500 ký tự theo cách tính dấu phẩy và dấu nháy quy ước của YouTube.
- **Thị trường và locale:** Country định hướng thị trường, không đổi bối cảnh nội dung. Locale tường minh thắng; `auto` theo ngôn ngữ phụ đề đầu ra khi pipeline biết ngôn ngữ đó.
- **Bộ nhớ thị trường:** Preset local chỉ chứa provider/server/locale và tùy chọn SEO đã whitelist. Khóa API không nằm trong preset.
- **Publication gate:** Metadata có thể chuẩn bị song song với render, nhưng chỉ ghi sau khi video hợp lệ và digest của cue/config khớp. Lỗi hoặc hủy metadata không xóa video đã xuất; `tieude.txt` có sẵn được giữ nguyên bằng exclusive create.
- **Ranh giới phản hồi AI:** Chấp nhận JSON trần, code fence hoặc đúng một object JSON nằm trong lời dẫn của provider. Nếu phản hồi có nhiều object JSON, JSON hỏng hoặc object không đạt schema/giới hạn nội dung thì báo lỗi metadata và không ghi `tieude.txt`.
- **Ranh giới bằng chứng:** Không sinh điểm ranking, authority hoặc citation probability. TediaPros không khẳng định metadata tạo ra sẽ tăng hạng hoặc được hệ thống AI trích dẫn.
