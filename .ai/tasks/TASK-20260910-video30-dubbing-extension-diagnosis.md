# TASK-20260910: Chẩn đoán DubbingVideoExtensionLimitError video ngày 2026-05-03

- **Trạng thái:** Đã kiểm chứng chẩn đoán; chưa sửa pipeline
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-10

## 1. Mục tiêu

Xác định lỗi trong ảnh `DubbingVideoExtension...` bằng log hiện tại, checkpoint và mã nguồn. Video có ID `7635582620131374579`, tên bắt đầu `2026-05-03_第三十集`.

## 2. Tiêu chuẩn nghiệm thu

- [x] Tìm log khớp tên video trong ảnh.
- [x] Xác định cue, giới hạn và số đo gây lỗi.
- [x] Đối chiếu nội dung nguồn/dịch và tái hiện phép tính bằng hàm hiện tại.
- [x] `npm.cmd run typecheck`: PASS, exit 0.
- [x] Probe offline kiểm tra đúng lớp lỗi và thông báo 65.4%: PASS, exit 0.

## 3. Phạm vi

Chỉ chẩn đoán và ghi bàn giao. Không thay source, checkpoint, cấu hình, trần tempo hoặc giới hạn kéo dài. Không gọi provider, không chạy lại video.

## 4. Kết luận và lý do

**LOG_CONFIRMED:** App cài đặt 0.1.23 dừng ở bước TTS/retiming lúc `2026-09-10T05:06:13.502Z` (12:06:13 giờ Việt Nam). Lỗi: `Cue cue-45-58680 vẫn không vừa ở 1.80x: cần kéo dài đoạn hình 65.4%, vượt giới hạn 40%; không cắt lời.` Stack thuộc app.asar của bản cài đặt, không phải bằng chứng đã chạy checkout hiện tại.

**CHECKPOINT_CONFIRMED:** Cue 45 có khoảng nguồn 58.68–59.92s; text nguồn `遇到墙脚转折尺寸`; bản Pháp `Que faire aux angles et dimensions près des murs ?`. Cue 46 tiếp nối ngay tại 59.92s, nguồn `总对不上怎么办`, bản Pháp `S'ils ne correspondent jamais.`.

**CODE_CONFIRMED / OFFLINE_CONFIRMED:** `groupDubbingPlanForSpeech` trong `src/main/dubbing/plan.ts:182-189` dùng dấu hỏi trong nguồn hoặc bản dịch để tạo ranh giới cả trước và sau cue. Probe với các cue 44–48 từ checkpoint cho ra cue 45 đứng riêng. Dùng EOF giả định 70s cho probe cục bộ; EOF này không ảnh hưởng cửa sổ cue 45 có cue kế tiếp tại 59.92s. Đây là phép thử mã nguồn hiện tại, không phải chạy lại app cài đặt.

**INFERRED (đọc ngữ nghĩa):** Câu hỏi tiếng Trung nối qua cue 45–46; bản Pháp chuyển phần hỏi sang cue 45, khiến quy tắc dấu câu tạo một đơn vị thoại riêng quá ngắn. Cần xử lý ranh giới câu và phân bổ nghĩa nguồn/dịch trước khi cân nhắc thay chính sách thời lượng.

| Đại lượng | Giá trị |
| --- | --- |
| Độ dài đoạn đến cue kế tiếp | 1.240s |
| Khoảng nghỉ bảo vệ | 0.500s |
| Cửa sổ đọc | 0.740s |
| Audio TTS ban đầu sau trim (log) | 2.765s |
| Hai candidate được TTS/trim lại (log) | 2.882s và 3.152s |
| Audio tối thiểu tính tại 1.80x | 1.536111s |
| Cần thêm, gồm DSP guard 0.015s | 0.811111s |
| Tỷ lệ kéo dài riêng đoạn | 65.412186%, hiển thị 65.4% |
| Trần kéo dài riêng đoạn 40% | 0.496s |

Hai candidate đã đo đều `no-improvement`, nên synthesis giữ audio ban đầu. 65.4% tính trên đoạn của cue, không phải phần trăm kéo dài toàn video. Lỗi là chặn theo chính sách bảo toàn lời ở `src/main/dubbing/timeMap.ts:16-45`.

## 5. Tệp thay đổi

- `[NEW]` Chính bản ghi bàn giao này.

## 6. Kiểm chứng và bằng chứng

- Log: `C:/Users/PC/AppData/Roaming/tedia-pros/logs/tblao.log:41-78` (audio ban đầu, rescue và lỗi); dòng 79–88 là stack bản cài đặt.
- Checkpoint: `C:/Users/PC/AppData/Roaming/tedia-pros/autoshort-checkpoints/a468c133-2c3a-446d-8d3a-ffe6f46deabf/checkpoint.json:2694` (nguồn), dòng 3871 (bản dịch cuối).
- Code: `src/main/dubbing/plan.ts:93` (cửa sổ), `:179` (gom thoại); `src/main/dubbing/synthesis.ts:638-726` (rescue, chọn audio tốt nhất và lập time map); `src/main/dubbing/timeMap.ts:23` (trần từng đoạn).
- Lệnh: `cmd.exe /d /c "npm.cmd run typecheck"` → PASS, cả node/web.
- Probe một lần qua Node stdin + esbuild `write:false`, import trực tiếp `buildDubbingPlan`, `groupDubbingPlanForSpeech`, `deriveDubbingWindow`, `planDubbingTimeMap`; kiểm tra lớp lỗi và in đúng thông báo 65.4%. Không tạo file test, không sửa input.
- Không chạy bộ regression tổng thể vì không sửa triển khai. Chưa nghe WAV, chưa có raw request/response rephrase, chưa đánh giá đầy đủ bản dịch, chưa thử giải pháp trên provider thật.

## 7. Ghi chú bàn giao

Nếu tiếp tục sửa: ưu tiên xem lại phân bổ nội dung câu hỏi qua cue 45–46 và quy tắc gom thoại dựa vào dấu câu dịch, giữ ledger nguồn bất biến. Thêm regression bằng cặp cue này và đo lại TTS trước khi khẳng định giải quyết được video. Không suy từ phép thử offline rằng video đã được sửa hoặc xuất thành công.
