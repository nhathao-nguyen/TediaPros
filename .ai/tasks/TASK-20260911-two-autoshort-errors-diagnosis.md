# TASK-20260911: Chẩn đoán hai lỗi AutoShort trong ảnh

- **Trạng thái:** Hoàn thành chẩn đoán phía client; nguyên nhân nội bộ server audio probe chưa xác định.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

## 1. Mục tiêu

Đối chiếu hai ảnh với log, checkpoint và code app cài đặt. Chỉ điều tra; không sửa pipeline hoặc chạy lại provider.

## 2. Tiêu chuẩn nghiệm thu

- [x] Tìm log đúng tên video của cả hai ảnh.
- [x] Đối chiếu nguyên nhân overflow với bản dịch và phép tính runtime.
- [x] Xác định audio_probe_failed được trả từ server voice-clone, phân biệt giới hạn bằng chứng.
- [x] npm.cmd run typecheck: PASS, node và web, exit 0.
- [x] Probe offline gọi code thật tái hiện lỗi 89.0%: PASS.

## 3. Phạm vi

Chỉ thêm bản ghi này. Không thay mã nguồn, checkpoint, cấu hình, trần tempo hoặc trần kéo dài. Giữ nguyên toàn bộ thay đổi có sẵn trong workspace. Không có log nội bộ server TTS trong các tài liệu đã đọc.

## 4. Kết luận

### Ảnh 1: video 2026-05-30, tập 80, ID 7645630854618216177

**LOG_CONFIRMED:** Lỗi lúc 06:34:00 ngày 11/09/2026 giờ Việt Nam (2026-09-10T23:34:00.087Z): `Cue cue-0-0 vẫn không vừa ở 1.80x: cần kéo dài đoạn hình 89.0%, vượt giới hạn 40%; không cắt lời.`

Log gom 44 cue thành 8 nhóm. Nhóm đầu cue 0–5 có audio sau trim 19.080s; nhóm kế tiếp bắt đầu tại 5.88s. Hai nhóm đầu nhận 3 candidate rephrase mỗi nhóm nhưng đều có `outcome=invalid-candidate`; không có TTS rescue sau đó. Log không lưu nội dung candidate hoặc lý do loại cụ thể.

**CHECKPOINT_CONFIRMED / INFERRED từ đối chiếu ngữ nghĩa:** Bản dịch đã gán lệch nội dung giữa các ID. Sai lệch có sẵn trong `translationBatches.provider-batch-1-1789083023952.items` và tiếp tục xuất hiện trong `translatedCues`:

| Cue / thời điểm | Nội dung nguồn | Nội dung bản dịch được lưu |
| --- | --- | --- |
| cue-3-3020 / 3.02–3.72s | 材料好找: vật liệu dễ tìm | This is a manual round steel bender using bearings. |
| cue-5-4800 / 4.80–5.88s | 关键是还很实用: quan trọng là rất hữu dụng | Place the round steel in the slot. |
| cue-6-5880 / 5.88–7.60s | 这是自制的手动圆钢折弯器: đây là dụng cụ tự chế uốn thép tròn bằng tay | Secure it by turning the handle to bend the steel into a ring. |

Nhóm đầu chỉ là lời chào và giới thiệu chung trong nguồn, nhưng bản dịch đã kéo cả mô tả dụng cụ/cách dùng của các cue sau vào nhóm này. Kết quả là 49 từ tiếng Anh nằm trong đoạn 5.88s. Việc bảo toàn ID và timestamp chưa ngăn được dịch chuyển nghĩa. Chưa có raw request/response provider để xác định lỗi phát sinh chính xác trong model hay adapter trước khi lưu batch.

**CODE_CONFIRMED / OFFLINE_CONFIRMED:**

| Đại lượng | Giá trị |
| --- | --- |
| Đoạn nguồn đến nhóm tiếp theo | 5.880s |
| Khe đọc sau khoảng nghỉ 0.500s | 5.380s |
| TTS sau trim | 19.080s |
| Thời lượng tại trần 1.80x | 10.600s |
| Cần kéo dài, gồm guard DSP 0.015s | 5.235s |
| Tỷ lệ trên đoạn nguồn | 89.030612%, hiển thị 89.0% |
| Được kéo dài tối đa 40% | 2.352s |

Fallback structural split yêu cầu số câu dịch bằng số source cue. Nhóm đầu có 5 câu dịch nhưng 6 cue nguồn, nên không đủ điều kiện split theo code hiện tại và code app cài đặt. Không có structural split trong log lỗi này. Đây không phải trường hợp cue đơn lẻ bị ngắt bởi dấu hỏi như lỗi đã điều tra ngày 10/09.

### Ảnh 2: video 2026-05-19, tập 67, ID 764151176980187989

**LOG_CONFIRMED:** Lỗi lúc 05:10:59 ngày 11/09/2026 giờ Việt Nam (2026-09-10T22:10:59.639Z): `audio_probe_failed: Reference audio could not be inspected`.

Request gửi đến `/v1/audio/voice-clone` trên server TTS 192.168.1.16:8000, model `tts-multilingual`, mẫu `Voice-short-Anh-funny.mp3`. Năm đoạn trước đó đã tổng hợp và trim thành công với cùng tên mẫu; lần gọi kế tiếp lúc 22:10:58.490Z thất bại sau khoảng 1.15s. Video tiếp theo dùng cùng mẫu lại tạo audio thành công lúc 22:13:57.765Z.

**CODE_CONFIRMED:** `generateVoiceClone` lấy code/message từ HTTP response lỗi của server. Stack bản cài đặt tại index.js:21640 là nơi adapter chuyển kết quả lỗi thành exception, không phải nơi probe audio. Buffer tham chiếu được đọc một lần khi bắt đầu synthesis rồi tái sử dụng cho các request trong video. Không có retry tại nhánh HTTP lỗi này, nên video dừng khi request đó thất bại.

**INFERRED:** Mẫu lỗi thành công–thất bại–thành công nghiêng về một sự cố nhất thời trong xử lý/kiểm tra audio tham chiếu phía server, hơn là mẫu MP3 hỏng cố định. **UNKNOWN:** HTTP status, stderr/exception probe, file upload tạm, timeout, tài nguyên hay lỗi tiến trình phía server. Không có bằng chứng để kết luận thiếu FFprobe, file hỏng, GPU lỗi hoặc hết RAM. Cần log server tại mốc trên để chốt nguyên nhân gốc.

## 5. Tệp thay đổi

- `[NEW]` Bản ghi chẩn đoán này.

## 6. Kiểm chứng và bằng chứng

- Log: `C:/Users/PC/AppData/Roaming/tedia-pros/logs/tblao.log:16577–16619` (tập 80), `:13701–13723` (tập 67), `:13728–13730` (request kế tiếp thành công).
- Checkpoint khớp thời gian, số cue và các mốc nhóm: `C:/Users/PC/AppData/Roaming/tedia-pros/autoshort-checkpoints/73df7101-7f43-41e7-b040-534637d3796f/checkpoint.json`; nguồn tại dòng 156, batch tại dòng 2342, bản dịch cuối tại dòng 2539. Checkpoint không chứa tên video; liên kết dựa trên thời điểm và các mốc cue khớp log.
- Checkpoint tập 67 khớp thời điểm/số cue: `C:/Users/PC/AppData/Roaming/tedia-pros/autoshort-checkpoints/a406de06-2bae-4dec-a6d6-f6907042f99a/checkpoint.json`.
- Code: `src/main/dubbing/timeMap.ts:23`, `src/main/dubbing/plan.ts:179`, `src/main/dubbing/synthesis.ts:235`, `:638`, `src/main/tts.ts:52`, `:390`, `src/main/autoshort.ts:2425`, `:2486`.
- Đọc app.asar bằng `@electron/asar`, entry `out\\main\\index.js`: stack dòng 13880, 14347, 21640 khớp log; xác nhận có source grouping, split guard và tái sử dụng referenceBuffer.
- `npm.cmd run typecheck`: PASS, exit 0.
- Node stdin + esbuild write:false gọi buildDubbingPlan/applyDubbingTranslations/groupDubbingPlanForSpeech/planDubbingTimeMap với checkpoint và số đo log: 8 nhóm, nhóm đầu 6 cue, 49 từ/5 câu; assert đúng lớp lỗi và chuỗi 89.0%: PASS. EOF 61s là giá trị giả định cho probe, không ảnh hưởng nhóm đầu có deadline từ cue kế tiếp 5.88s. Lượt probe đầu nhập nhầm module export; đã sửa import từ dubbing/translation và chạy lại thành công.
- Không chạy regression tổng thể vì không sửa triển khai; chưa nghe WAV, chưa chạy lại provider, chưa có raw rephrase candidates hoặc log nội bộ server.

## 7. Bàn giao

Ưu tiên sửa/kiểm tra việc giữ nghĩa đúng từng cue ở đường dịch trước khi tăng tempo hoặc kéo dài hình. Với lỗi audio, truy log server đúng request thất bại để sửa nguyên nhân probe; chưa có cơ sở chọn giải pháp cụ thể hoặc chỉ tăng retry.

## 8. Giải thích bổ sung: vì sao cần tới 89%

Đối chiếu lại checkpoint và log theo câu hỏi tiếp theo của người dùng:

- Sáu cue đầu trong nguồn (0–5.88s) chỉ là phần giới thiệu. Ba bản dịch đầu đã chứa trọn phần giới thiệu này, tổng cộng 25 từ theo cách đếm khoảng trắng.
- Ba bản dịch kế tiếp, vẫn nằm trong nhóm 0–5.88s, thêm 24 từ về dụng cụ uốn thép, linh kiện và cách đặt thanh thép vào rãnh. Những nội dung này tương ứng các cue nguồn 6–11, từ 5.88 đến 11.86s. Do vậy gần một nửa số từ trong nhóm đầu thuộc phần nguồn phía sau; đây là sai lệch nghĩa qua ranh giới nhóm, không chỉ một khác biệt độ dài ngôn ngữ.
- Nhóm đọc tổng cộng 49 từ; log đo audio sau trim 19.080s. Không thể quy trực tiếp 24 từ thêm thành một số giây chính xác vì còn nhịp đọc, phát âm và khoảng nghỉ trong câu. Chưa chạy TTS bản dịch đã sửa để biết duration sau sửa.
- Công thức code: `(19.080 / 1.80 - (5.880 - 0.500) + 0.015) / 5.880 * 100 = 89.030612%`.
- Đoạn hình cần dài tổng cộng 11.115s (5.880 + 5.235), trong khi trần 40% chỉ cho phép 8.232s. Đây là mức tăng riêng đoạn đầu, không phải yêu cầu tăng cả video 89%.
- Bỏ khoảng nghỉ bảo vệ 0.500s vẫn cần tăng 80.527211% với cùng audio và guard DSP. Khoảng nghỉ đóng góp khoảng 8.50 điểm phần trăm; không phải nguyên nhân chính.
- Node stdin kiểm tra đếm từ và các phép tính trên: PASS. Chỉ bổ sung tài liệu, không thay triển khai hoặc chạy lại TTS. Sai lệch có trong batch được lưu; chưa có raw response để kết luận chính xác model hay khâu chuẩn hóa trước checkpoint đã gán sai.
