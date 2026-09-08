# Review phần gom mảnh ASR thành đơn vị thoại

Ngày: 2026-09-08. Worktree: `codex-autoshort-optimization`, nền `7d86614572c6941861ee130e89e4d93e9ae2cc64`, thay đổi chưa commit.

Review độc lập, chỉ đọc, tập trung `plan.ts`, `subtitles.ts`, điểm nối `synthesis.ts`/`autoshort.ts`, test grouping và ADR 008. Không review lại các thay đổi dịch/rephrase có sẵn ngoài phạm vi.

## Phát hiện và xử lý

1. Khoảng nghỉ `1.7 - 1.1` bị biểu diễn nhỏ hơn 0.6, dẫn đến gom qua mốc nghỉ 600ms. Đã tái hiện RED, sửa epsilon số học 1e-9 giây, GREEN xác nhận 600ms tách và 599ms ghép.
2. Dấu hỏi Arabic U+061F không nằm trong regex câu hỏi. Đã tái hiện RED với intro/question/answer bằng tiếng Arabic, thêm dấu vào regex, GREEN giữ ba đoạn riêng.
3. `sourceIndex` dùng vị trí ledger thay vì chỉ số SRT ban đầu sau khi bỏ cue lỗi/sắp xếp timestamp. Đã tái hiện RED qua parser SRT thật; ledger giữ chỉ số tùy chọn, AutoShort truyền nó và synthesis ưu tiên nó, fallback vị trí khi không có. GREEN xác nhận chỉ số 2 của cue đầu được giữ dù vị trí mảng là 0.

Reviewer chạy độc lập esbuild trong bộ nhớ, 11/11 test grouping pass sau cả ba sửa. Không còn phát hiện Critical/Important/Minor chưa xử lý trong phạm vi review.

## Bổ sung sau live

Câu hỏi bò cửa sổ 0.9s vẫn lỗi 1.499x vì LLM chỉ trả câu cũ và phương án không đủ ngắn. Review độc lập `compactEnglishDubbingQuestion`/pool rescue xác nhận: giữ demonstrative, từ nội dung, số, phủ định và dấu hỏi; chỉ locale en, chỉ khi audio vượt hard ceiling; một LLM và tổng ba audio rescue ngay cả khi pool có bốn phương án. Không thấy lỗi cụ thể. Regression được ghi vào `translation-rephrase.test.ts`; test pool đã chỉ ra predictor hòa điểm có thể bỏ qua fallback, nên các phương án rút gọn đứng trước khi điểm bằng nhau, vẫn giữ `.slice(0, 3)`.

## Giới hạn

CJK không có khoảng trắng có thể giữ caption dài một token, đã được ADR nêu rõ. Review không chứng minh chất lượng ngữ nghĩa, căn từng từ hoặc render toàn pipeline. Kết quả TTS/FFmpeg thật, full test và activation app nằm tại `2026-09-08-dubbing-grouping-recovery.md`.
