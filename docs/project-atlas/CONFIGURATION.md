# CONFIGURATION.md — Cấu Hình Hệ Thống & Biến Môi Trường

Tài liệu này tổng hợp toàn bộ các thông số cấu hình của TediaPros, giá trị mặc định, cơ chế di trú cấu hình cũ và các biến môi trường hỗ trợ lập trình viên.

---

## 1. Cấu Hình AutoShort (`AutoShortConfig`)

Được định nghĩa tại [src/shared/types.ts#L847-L903](file:///f:/Son/tool/TediaPros/src/shared/types.ts#L847-L903):

| Trường Cấu Hình | Kiểu Dữ Liệu | Giá Trị Mặc Định | Ý Nghĩa Kỹ Thuật |
| :--- | :--- | :--- | :--- |
| `subtitleMethod` | `'whisper' \| 'ocr' \| 'whisper-ocr'` | `'whisper'` | Phương thức trích xuất phụ đề nguồn (từ giọng nói, chữ màn hình, hoặc kết hợp). |
| `whisperModel` | `'base' \| 'small' \| 'medium'` | `'base'` | Mô hình Faster-Whisper dùng để bóc băng giọng nói. |
| `whisperDevice` | `'cuda' \| 'cpu'` | `'cuda'` (nếu có GPU) | Thiết bị phần cứng chạy Whisper. |
| `blurMode` | `'manual' \| 'ocr-auto' \| 'sttn'` | `'manual'` | Chế độ làm mờ/xóa chữ cũ: khoanh vùng thủ công, OCR tự động, hoặc AI STTN Inpainting. |
| `ocrBlurProfile` | `'accurate' \| 'fast'` | `'accurate'` | Mức độ quét OCR: 'accurate' (chính xác cao) hoặc 'fast' (nhanh). |
| `lamMo` | `boolean` | `true` | Bật/tắt tính năng làm mờ chữ cũ. |
| `ttsEnabled` | `boolean` | `true` | Bật/tắt tính năng lồng tiếng AI. |
| `audioMode` | `'replace' \| 'mix' \| 'separate-vocals'` | `'separate-vocals'` | Chế độ âm thanh: thay thế hoàn toàn, trộn với âm thanh gốc, hoặc tách thoại MDX giữ nhạc nền. |
| `separationPreset` | `'fast' \| 'balanced' \| 'quality'` | `'balanced'` | Chất lượng tách nhạc nền MDX-Net. |
| `translateTarget` | `string` | `'vi'` (tiếng Việt) | Ngôn ngữ dịch đích ('vi', 'en', 'none' để không dịch). |
| `translateProvider`| `'gemini' \| 'openai' \| 'local'` | `'gemini'` | Nhà cung cấp dịch thuật AI. |
| `paceMode` | `'source-adaptive' \| 'fixed'` | `'source-adaptive'` | Chế độ nhịp đọc TTS: tự thích ứng theo video gốc hoặc tốc độ cố định. |
| `subtitleDisplayStyle`| `'standard' \| 'word-reveal' \| 'word-highlight'` | `'standard'` | Kiểu hiển thị phụ đề ASS: tĩnh, hiện từng từ, hoặc highlight karaoke. |
| `outputDir` | `string` | Thư mục Downloads | Đường dẫn thư mục xuất thành phẩm. |

---

## 2. Cơ Chế Di Trú Cấu Hình Cũ (`migrateLegacyConfig`)

Tại [src/shared/autoShortContract.ts#L99-L130](file:///f:/Son/tool/TediaPros/src/shared/autoShortContract.ts#L99-L130):
Khi người dùng mở ứng dụng với cấu hình cũ đã lưu từ các phiên bản trước:
- `fast-whisper` $\rightarrow$ tự động chuyển thành `'whisper'`.
- `tiny` $\rightarrow$ tự động nâng lên `'base'`.
- `large-v3` $\rightarrow$ tự động chuyển thành `'medium'`.
- Nếu cấu hình thiếu `blurMode`, gán mặc định là `'manual'`.
- Nếu cấu hình thiếu `ocrBlurProfile`, gán mặc định là `'accurate'`.
- Nếu `audioMode === 'separate-vocals'` mà thiếu preset, gán mặc định là `'balanced'`.

---

## 3. Biến Môi Trường Dành Cho Nhà Phát Triển (Environment Variables)

- `ELECTRON_RUN_AS_NODE`: Cần xóa bỏ biến này nếu khởi động Electron gặp lỗi `Cannot read properties of undefined (reading whenReady)`.
- `DEBUG`: Bật log chi tiết cho các engine Python hoặc FFmpeg.
- `TEDIA_DEV_RUNTIME`: Chỉ định thư mục runtime cục bộ trong quá trình phát triển thay vì tải từ remote server.
