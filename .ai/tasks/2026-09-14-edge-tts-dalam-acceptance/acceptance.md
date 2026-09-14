# DALAM-01 Edge-TTS acceptance — 2026-09-14

## Phạm vi

Nguồn: `F:\Son\doyuin\LauHaiSan\dalam\2025-04-08_大海退潮啦，海鲜就要现抓现吃_赶海_7490882160954461476.mp4`.

SHA-256 trước và sau: `50140CA1D518F4DBE80D564BBABCE727790F066E619D31AA3D45CBCD4042E1EE`. Harness dùng profile, cache, checkpoint và output riêng; không sửa file nguồn hoặc cache sinh hoạt của người dùng.

## Kết quả TTS-only

- Trạng thái: `done`; tổng thời gian harness 72.273 giây, pipeline audit 68.287 giây.
- ASR đã tạo 56 source cue và giữ đủ 56 source cue ID trong 32 speech unit.
- TTS tạo đủ 32/32 clip. Lượt hoàn tất dùng 3 cache hit từ lần chẩn đoán trước và 29 request Edge mới; 29 request đều thành công ở attempt đầu, không có typed transport failure.
- Timeline: 32 cue; tempo lớn nhất 1.0918x, trung bình 1.0083x; 0 overflow, 0 rephrase, 0 cut-off, 0 overlap và 0 timing warning. Trần dự án là 1.80x.
- Output: H.264 1080×1920 30 fps + AAC 44.1 kHz stereo, 131.000 giây, 168.793.360 byte; SHA-256 `9B620D279AF1465C9A2836D7BB6297C7D99FD5D386BA4C803E5D9A9B7491FF0E`. Full decode tất cả stream pass; audio mean −23.7 dB, peak −5.0 dB.
- Đã kiểm tra hình tại 10, 65 và 120 giây. Video decode được, bố cục dọc đúng và phụ đề mới xuất hiện theo timeline ở các đoạn có lời. Ở khung 10 giây còn thấy chữ gốc cùng phụ đề mới vì harness cô lập TTS đã đặt `lamMo=false`; đây chưa phải nghiệm thu chất lượng visual/OCR blur.

Output nằm ngoài Git tại:

`F:\Son\doyuin\LauHaiSan\dalam-edge-tts-acceptance\outputs\2025-04-08_大海退潮啦，海鲜就要现抓现吃_赶海_7490882160954461476 (2)\2025-04-08_大海退潮啦，海鲜就要现抓现吃_赶海_7490882160954461476-phude.mp4`

Các bằng chứng trong thư mục này gồm report/config/readiness đã loại secret và ba frame kiểm tra. Audit đầy đủ nằm cạnh output trong thư mục `.autoshort-audit-*`.

## Lỗi tìm thấy và sửa

Validator chất lượng audio trước đây tách từ chủ yếu theo khoảng trắng. Một cụm tiếng Trung 39 ký tự bị tính là một từ nên audio Edge hợp lệ dài 7.924 giây bị báo lặp. `tokenizeWords` đã chuyển sang `Intl.Segmenter` với fallback Unicode; regression mới chứng minh cụm CJK được chấp nhận, trong khi case Latin một từ kéo dài bất thường vẫn bị từ chối.

Harness giữ khóa dịch trong Main/Electron và chỉ ghi bản sao mã hóa vào profile cô lập khi cần translation. Cleanup khóa hiện bao trọn cả readiness/preflight và job; kiểm tra sau lượt lỗi xác nhận không còn `lk.bin` trong cây benchmark. URL local translator là tham số `--translate-server-url`, mặc định loopback, không ghim địa chỉ LAN của máy thử trong code.

## Giới hạn bằng chứng

Đây là phép thử Chinese ASR → Chinese Edge voice → render, tắt blur, để cô lập đường TTS. Nó chứng minh TTS/timeline/render kỹ thuật của DALAM-01, không chứng minh bản dịch tiếng Việt, chất lượng nghe do người duyệt, hoặc nghiệm thu visual cuối. Lượt target `vi` dừng an toàn ở preflight vì local translation endpoint `http://192.168.1.16:8000/v1/chat/completions` không phản hồi trong timeout 30 giây; server vẫn mở TCP và yêu cầu xác thực ở các endpoint khác. Không có media đầu ra được gắn nhãn sai là bản dịch tiếng Việt.
