# ADR 008: Gom mảnh phụ đề thành đơn vị thoại trước TTS

- Trạng thái: áp dụng trong worktree `codex/autoshort-optimization`
- Ngày: 2026-09-08
- Phạm vi: AutoShort source-anchored, tiếp nối chính sách tempo của ADR 005

## Vấn đề

ASR chia một câu thành nhiều cue ngắn. Áp protected gap 0.50s sau từng mảnh khiến câu “这是豆鸡” từ 6.06 đến 6.70 chỉ có 0.14s để đọc, còn “這是紫地蟹” từ 5.53 đến 6.41 chỉ có 0.38s. Audio đã rút gọn 0.830s/1.384s vẫn cần 5.927x/3.642x. Tăng retry hoặc nén lời không giải quyết được cách chia sai đơn vị thoại.

## Quyết định

Sau khi map bản dịch theo ID, `groupDubbingPlanForSpeech` nối các mảnh liên tiếp thành đơn vị thoại. Mỗi đơn vị giữ ID của cue đầu, toàn bộ `sourceCueIds` theo thứ tự, mốc bắt đầu cue đầu và kết thúc cue cuối. `DubbingPlan.version=3` lưu thêm `sourceCues` làm danh sách nguồn để đối chiếu ID, text và mốc thời gian. Bản dịch/checkpoint nguồn vẫn giữ từng cue gốc.

Ranh giới câu hỏi, dấu kết câu nguồn, người nói và khoảng nghỉ >=0.60s tách các chuỗi độc lập. So sánh ngưỡng nghỉ có sai số số học 1e-9 giây để các timestamp thập phân như 1.7−1.1 vẫn được nhận diện là 600ms; 599ms vẫn dưới ngưỡng. Không gom qua câu hỏi chỉ vì cửa sổ nói ngắn. Với cùng chuỗi lời liên tục, chia đoạn bằng thuật toán hữu hạn xét tối đa 6 cue, 15s và 300 ký tự dịch; ưu tiên ít đoạn, tránh để lại mảnh cuối quá ngắn. Cue đơn vượt giới hạn kích thước vẫn được giữ nguyên, không bỏ nội dung.

Protected gap 0.50s áp dụng giữa các đơn vị thoại. Không chèn 0.50s vào giữa những mảnh đã nối của cùng đơn vị. Start của từng đơn vị neo vào nguồn, không dồn toàn timeline theo audio. Tempo tối đa 1.45x, trim -50dB/onset 30ms/offset 100ms và cơ chế báo lỗi khi không fit giữ nguyên.

Preflight cho plan có nhóm nhiều cue dùng batch tối đa 8 đơn vị vì mỗi đơn vị chứa nhiều text nguồn. Plan một cue/mỗi đơn vị vẫn dùng batch 24. Cơ chế repair phần thiếu và deadline 90s của mỗi batch giữ nguyên. Rescue vẫn tối đa một response LLM, ba candidate audio.

Phụ đề của nhóm được chia theo ranh giới từ (mục tiêu <=64 ký tự/chunk, không cắt token dài), phân bổ thời gian theo tỷ trọng text trong cửa sổ audio đã đo. Đây là timing cấp cue, không phải căn từng từ bằng ASR. Text nối lại phải bằng `finalSpokenText`; `sourceIndex` giữ chỉ số SRT gốc của cue đầu nhóm, kể cả khi parser bỏ cue lỗi hoặc sắp xếp lại theo timestamp. Ledger giữ chỉ số tùy chọn này; khi nguồn không có chỉ số thì fallback vị trí ledger.

## Đánh đổi và giới hạn

- Giọng đọc bên trong nhóm liền mạch; mốc phụ đề từng mảnh gốc không còn bị dùng như điểm dừng giọng bắt buộc. Tất cả mốc gốc vẫn có trong ledger.
- Phân nhóm là heuristic dựa trên text/timing, không phải bộ nhận diện cảnh/người nói. Không có dữ liệu speaker/scene thì không thể chứng minh nhận diện mọi chuyển cảnh.
- Bản dịch nguồn có thể có lỗi ASR, và LLM có thể rút gọn sai nghĩa. Giới hạn timing và validator ID không chứng minh chất lượng ngữ nghĩa. Không dùng các test timing làm chứng nhận dịch chuẩn.
- Câu hỏi/câu đơn thật sự quá dài vẫn có thể bị từ chối. Không hạ chuẩn bằng cách tăng tempo hoặc cắt lời.
- Không thay IPC, cache TTS (key theo text/voice), codec, model hoặc cài đặt giọng người dùng.

## Bằng chứng

`tests/dubbing-grouping.test.ts` tái hiện cửa sổ thực 0.14s/0.38s, bảo toàn ledger, câu cảnh báo ngắn cuối nhóm, phân đoạn 7 mảnh không để lại mảnh lẻ, các ranh giới câu hỏi/speaker/pause, batch 8 và subtitle sourceIndex. Bằng chứng live cùng giới hạn nghiệm thu ghi tại `.ai/tasks/2026-09-08-dubbing-grouping-recovery.md`.
