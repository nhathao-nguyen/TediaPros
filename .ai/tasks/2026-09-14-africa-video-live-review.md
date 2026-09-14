# LIVE-REVIEW: Video hố nhà vệ sinh ở châu Phi

- Trạng thái: Hoàn thành review; chưa sửa pipeline hoặc chạy lại Gemini.
- Người thực hiện: Codex
- Thời gian: 2026-09-14

## 1. Mục tiêu

Đối chiếu lượt chạy người dùng vừa thực hiện với log, phụ đề nguồn/dịch, lời đọc cuối, timeline và video xuất.

## 2. Tiêu chuẩn nghiệm thu

- [x] Xác định đúng batch, input và output.
- [x] Đếm request dịch theo log; tách khỏi metadata và TTS.
- [x] Đọc toàn bộ 28 cue nguồn/dịch, 5 đoạn lời đọc, 14 cue phụ đề render.
- [x] Đối chiếu nguyên nhân chia câu với code và xem mẫu frame video.
- [x] Ghi rõ phần đã xác minh và phần chưa có bằng chứng.

## 3. Phạm vi và bằng chứng

- Batch: `e72490eb-5b7a-4a6d-a0ab-c0357854a295`.
- Item: `fd018d9a-a75e-43e5-8950-e2007ffa7661`.
- Log: `C:\Users\PC\AppData\Roaming\tedia-pros-dev\logs\tblao-session-57231895-500b-4dc0-bca0-dc815cef277b.log`.
- Snapshot: `C:\Users\PC\AppData\Roaming\tedia-pros-dev\autoshort-batches-v1\e72490eb-5b7a-4a6d-a0ab-c0357854a295\snapshot.json`.
- Input: `F:\Son\doyuin\KhoaHocCongNghe\New folder\2025-12-15_非洲旱厕，为什么要挖那么不可思议的深度？_涨知识_科普_7584020556043816207.mp4`.
- Output directory: `C:\Users\PC\Downloads\2025-12-15_非洲旱厕，为什么要挖那么不可思议的深度？_涨知识_科普_7584020556043816207`.
- Audit directory bên trong output: `.autoshort-audit-e72490eb-5b7a-4a6d-a0ab-c0357854a295-fd018d9a-a75e-43e5-8950-e2007ffa7661`.
- Đã đọc: `source.srt`, `translated.srt`, `timed.srt`, `final-spoken-text.json`, `tts-timeline.json`, các phần liên quan của `dubbing-plan.json`, `manifest.json`, `diagnostics/summary.json`, `diagnostics/events.jsonl`, `tieude.txt`.

## 4. Kết quả và nguyên nhân

### Chạy thành công về kỹ thuật

LOG/ARTIFACT_CONFIRMED: item succeeded; xử lý 14:20:32–14:25:11 giờ Việt Nam, 278,780 ms. ffprobe xác nhận output H.264 + AAC stereo 44.1 kHz, 1080×1920, 42.067007 giây, 53,566,431 byte. Snapshot ghi SHA-256 `9530b93a41b51af81b5cdcf320a47bc700177838fab3222d91ef733aef7ea823` (không tính lại hash trong review).

| Công đoạn | Thời gian |
| --- | ---: |
| ASR small/CUDA | 10.42 s |
| Khôi phục + dịch + review | 73.21 s |
| Tách giọng | 5.44 s |
| TTS và xử lý clip | 18.54 s |
| OCR làm mờ | 118.16 s |
| Render | 47.91 s |

OCR chiếm khoảng 42.4% tổng thời gian. Các dòng libass lỗi mở README/JSON/thư mục licenses không làm lượt xuất thất bại; log xác nhận chọn NotoSans-Regular và video hoàn tất.

### Số request

- Dịch: 2 HTTP request tới gateway `gemini-advanced`.
- Lượt 1: 14:20:43.708–14:21:46.351, 62.643 s; `upstreamAttempts=3`.
- Lượt 2: 14:21:46.353–14:21:56.872, 10.519 s; `upstreamAttempts=1`.
- Tổng phần dịch: 4 upstream attempts được gateway báo về; không có rephrase.
- Edge TTS: 5 request được ghi nhận, không thuộc số request Gemini.
- Có `tieude.txt`; metadata là đường gọi riêng trong `burn.ts`/`videoTitle.ts`, không được tính trong 2 request dịch. Bằng chứng hiện tại không cho biết chính xác provider và tổng retry metadata của lượt này.
- Chưa có log gateway chi tiết hoặc raw payload draft/review của lượt này. Hai file stdout/stderr gateway tìm được trong Temp đều 0 byte. Không kết luận nguyên nhân hai lần thử thêm: code cho phép cả lỗi generation lẫn JSON không hợp lệ kích hoạt retry.

### P1 — Đoạn TTS ngắt giữa câu, phụ đề cắt giữa cụm từ

ARTIFACT_CONFIRMED:

- Nhóm 1 kết thúc bằng “nhiều người nghĩ”, voice kết thúc 7.459569 s; nhóm 2 bắt đầu “anh đào để làm đám tang” lúc 8.84 s: khoảng trống 1.380431 s giữa hai vế.
- Nhóm 2 kết thúc bằng “hỏi thăm tù trưởng bên cạnh”, voice kết thúc 16.548458 s; nhóm 3 bắt đầu “mới vỡ lẽ ra bí mật” lúc 18.98 s: khoảng trống 2.431542 s trong câu.
- `timed.srt` chia “thiết / kế”, “độ / sâu”, “bất / trắc”. Ảnh video tại 21 s hiển thị “anh thiết”, xác nhận sự vụng về xuất hiện trong hình render.
- Tất cả 28 cue dịch không có dấu câu. `finalSpokenText` giữ nguyên bản dịch, không rephrase.

CODE_CONFIRMED:

- `src/main/sourceSpeechGrouping.ts`: nguồn không có dấu câu/ngắt nghỉ được phân nhóm bằng số cue, ký tự và thời lượng; giới hạn 6 cue. Comment trong code cũng ghi đây không phải bằng chứng ranh giới ngữ nghĩa.
- `src/main/dubbing/plan.ts`: ghép lời dịch theo nhóm nguồn đó.
- `src/main/dubbing/subtitles.ts:41`: cắt theo khoảng trắng, tối đa 64 ký tự rồi phân thời gian theo độ dài chuỗi; không dùng ranh giới cụm từ hay word alignment.
- `src/main/translation/prompts.ts:157`: thông báo group đã được chốt trước dịch và không cho dấu câu dịch định nghĩa lại speech boundaries. Prompt không có yêu cầu đủ cụ thể về phục hồi dấu câu để TTS đọc tự nhiên.
- `src/main/translation/response.ts`: normalize text chỉ trim trong nhánh đã kiểm tra, không xóa dấu câu. Không có raw draft/review để kết luận dấu câu bị thiếu từ lượt 1 hay lượt 2.

### P2 — Ý chính còn đủ nhưng tiếng Việt chưa đạt yêu cầu bản địa

EDITORIAL_REVIEW so với SRT nguồn, không phải xác minh sự thật ngoài video:

| Cue | Bản hiện tại | Đánh giá / đề xuất |
| --- | --- | --- |
| 1–2 | “đã sáng mắt ra / lại nghĩ đến chuyện đào giếng” | 开窍 là nghĩ ra/thông ra; “sáng mắt ra” lệch sắc thái. Có thể viết “Cứ ngỡ anh chàng châu Phi này cuối cùng cũng nghĩ ra / chuyện đào giếng.” |
| 7 | “anh đào để làm đám tang” | Theo ngữ cảnh hố, “đào huyệt” hoặc “đào để chôn cất” tự nhiên và rõ mục đích hơn. |
| 13 | “mới vỡ lẽ ra bí mật” | Kết hợp từ gượng; “mới biết được sự thật” hoặc “mới hiểu ra” hợp hơn tùy câu liền trước. |
| 14 | “nhà vệ sinh khô của nhà anh” | Hiểu đúng đối tượng nhưng dịch cứng; có thể dùng “hố xí của gia đình anh” trong văn nói này. |
| 15 | “thiết kế này ẩn chứa sự thông minh” | Cấu trúc dịch sát; “Cách thiết kế này cũng có cái khôn của nó.” |
| 17 | “sâu tới 25 mét đáng kinh ngạc” | Trật tự bổ ngữ gượng; “Có hố sâu tới tận 25 mét.” |
| 22 | “tương đối mà nói lại sạch sẽ hơn” | Dịch sát cấu trúc 相对来说; “Nhờ vậy cũng vệ sinh hơn.” |

Điểm tốt: giữ 25 mét, hơn chục người, ba đời, cảnh báo trơn trượt. Các ASR đồng âm “旱侧”, “一侧” được diễn giải thành đối tượng nhà vệ sinh/hố; “公正” trong mô tả bề mặt không bị dịch thành công bằng. Không thấy lạc sang một chủ đề khác trong 28 cue đã đọc.

### P2 — Bằng chứng kiểm định và metadata còn thiếu

- Lượt review độc lập đã chạy nhưng đầu ra vẫn có các vấn đề trên; việc gọi đủ 2 lượt không chứng minh chất lượng đã đạt.
- Chưa lưu raw draft/review, diff sửa và lý do retry nên không đo được reviewer đã sửa gì.
- Metadata mô tả bám chủ đề nhưng có “sáng tạo châu Phi”, “độc đáo”, “sâu vượt trội” mang tính tán dương. Tiêu đề viết hoa đầu mọi từ chưa tự nhiên cho tiếng Việt. Tính đúng ngoài thực tế của các khẳng định về vệ sinh/25 mét chưa được xác minh trong review này.
- `degraded=true` trong timeline không đồng nghĩa lỗi xuất hoặc mất thoại: overflow=0, rephrase=0, fitFirstPassRatio=1; tempo quan sát 1.0831–1.1321x, dưới trần 1.80x.

### Kiểm tra hình ảnh và giới hạn

Đã xem contact sheet nguồn/output và frame output tại 21 s. Các mẫu cho thấy chữ Việt và dải làm mờ chữ nguồn; khi không có phụ đề Việt, dải blur vẫn có thể hiện. Chưa xem liên tục toàn bộ video hoặc nghe đánh giá âm thanh. Khoảng nghỉ được tính từ clip timeline, không khẳng định là im lặng tuyệt đối vì còn nhạc nền.

## 5. Tệp thay đổi

Chỉ thêm báo cáo review này; không sửa code, cấu hình, phụ đề hoặc video. Ảnh kiểm tra tạm nằm tại `C:\Users\PC\AppData\Local\Temp\tediapros-review-e72490eb`.

## 6. Kiểm chứng

Đã dùng PowerShell đọc artifact/log, rg đối chiếu code, ffprobe kiểm tra streams/duration, ffmpeg trích frame và view_image xem ảnh. Không gọi thêm Gemini/TTS. Không chạy lại pipeline hoặc tạo test mới cho nhiệm vụ review.

`npm.cmd run typecheck`: PASS cả node và web trong lượt review; đây chỉ là kiểm tra kiểu dữ liệu, không chứng minh chất lượng dịch/âm thanh.

## 7. Thứ tự sửa đề xuất

1. Phục hồi dấu câu và ranh giới câu từ toàn bộ nguồn trong chính 2 lượt hiện có; giữ source cue ID/timestamp và kiểm tra group bao phủ đủ, liên tiếp, không trùng.
2. Chốt nhóm TTS theo câu/mệnh đề đã kiểm định; giới hạn 6 cue chỉ là giới hạn kỹ thuật, không tự coi là ranh giới ngữ nghĩa.
3. Chia phụ đề theo cụm nghĩa, tránh tách từ ghép; dùng word timing khi có, ghi rõ fallback khi không có.
4. Cụ thể hóa tiêu chí reviewer về thành ngữ, kết hợp từ, văn nói Việt Nam, dấu câu và tính liên tục. Không thêm request chỉ để kiểm tra hình thức có thể kiểm bằng code.
5. Lưu audit có giới hạn dung lượng cho từng lượt: request ID, model, candidate/final, số retry và lý do; tách counters translation/metadata/TTS.
6. Chạy lại cùng video sau sửa, so sánh các điểm ngắt và chất lượng lời đọc, rồi mới tối ưu bước OCR đang chiếm thời gian lớn nhất.
