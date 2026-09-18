# Semantic review — Gemini Gateway two-pass v8 runs

- **Phạm vi:** hai lần chạy live hiện tại sau khi gateway xác minh route
  `3.1 Pro`: fixture Volvo 44 cue và nguồn 113 cue thực tế. Mỗi lần dùng đúng
  draft + independent review; không chạy TTS/render và không sửa queue/checkpoint
  của người dùng.
- **Nguồn bằng chứng:** `live-v8-volvo-20260915-1245`,
  `live-v8-actual-113-20260915-1250`, cùng ảnh review gốc
  `../2026-09-14-volvo-translation-review/source-43.7.png`.

## LIVE_CONFIRMED — route, cấu trúc và giới hạn request

Cả hai run trả đủ cue ID, không cue rỗng hay lỗi parser. Mỗi run có đúng hai
client generation, hai upstream attempts, hai response model-matched và complete,
với nhãn quan sát `3.1 Pro`; không có retry. Đây là bằng chứng cho hai bản dịch
đã ghi artifact, không phải số liệu độ ổn định thống kê hay chứng nhận TTS/render.

## SEMANTIC_REVIEW — Volvo 44 cue

- **Điều khiển xe:** cue 2 và 32 dùng `phím điều hướng`, không đổi điều khiển
  thành vô lăng/bàn phím máy tính và không dùng `độc quyền` cho tính mô tả.
- **Khôi phục ASR đúng:** ledger ASR ghi `像素树枝` (cành pixel), nhưng ảnh nguồn
  ở 43.7 giây hiển thị `橡树树枝轻轻弯折时` — cành sồi đang uốn cong. Vì vậy
  `cành sồi` trong v8 là khôi phục có bằng chứng hình ảnh, không phải thêm loài
  cây không căn cứ. Harness chỉ gửi ledger; ảnh được dùng ở đây để đối chiếu,
  không phải để tuyên bố mọi job hiện tại đều tự gửi frame lên Gemini.
- **Văn phong:** câu nối ở cue 27–32 giữ được mạch âm thanh cành cây, số hóa và
  tiếng nút điều hướng. Đây là review thủ công theo các cue nhạy cảm; không thay
  thế review con người cho toàn bộ video mới.

## SEMANTIC_REVIEW — nguồn 113 cue thực tế

- Cue nguồn `视频同款买了花了我169啊` được v8 trả `Tôi đã mua một chiếc y hệt
  trong video với giá 169.` Không thêm `tệ`, `đồng` hay đơn vị tiền khác.
- Các thuật ngữ thao tác/đồ bếp được giữ theo văn phong tiếng Việt trung tính;
  review này chỉ chứng nhận những cue được đối chiếu và không suy ra chất lượng
  hoàn hảo cho mọi chủ đề hay locale.

## Lịch sử lỗi và hàng rào hiện tại

- v5 từng thêm `tệ` cho số trần `169`; v8 bắt buộc giữ số trần khi nguồn không
  ghi đơn vị.
- v6 từng có cách gọi nhầm điều khiển xe và tính mô tả; v8 yêu cầu thuật ngữ ô-tô
  tự nhiên và cấm biến `独有/独特` thành claim pháp lý khi nguồn không nói vậy.
- v8 chỉ cho phép khôi phục homophone ASR/OCR rõ ràng khi ledger đầy đủ, OCR hoặc
  glossary làm bằng chứng. `Whisper plus OCR lets aligned Chinese visual text
  replace a semantically wrong ASR cue` đã pass trong full local-runtime suite;
  việc một video thực tế có OCR phù hợp vẫn phụ thuộc cấu hình job đó.

## NOT_RUN — TTS và render

Không chạy TTS/render từ fixture hay dùng output live này ghi đè checkpoint final
của người dùng. Khi chạy job thực từ UI, preflight vẫn cần verify route hiện hành;
warm route dùng 2 generation, route/cache cold thêm 1 probe bounded.
