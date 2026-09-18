# TASK-20260915-VI-TRANSLATION-REVIEW: Review session và thiết kế tối ưu dịch tiếng Việt

- **Trạng thái:** Hoàn thành review; thiết kế chưa triển khai.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-15.

## 1. Mục tiêu

Review các đề xuất trong session, kiểm chứng bằng source và probe, tìm thuật toán/system design phù hợp để bản dịch gọn, tự nhiên và đủ ý cho người Việt.

## 2. Tiêu chuẩn nghiệm thu

- [x] Đối chiếu lời tư vấn trước với code hiện tại, nêu rõ các điểm cần sửa.
- [x] Có bằng chứng tái hiện cùng giới hạn của bằng chứng.
- [x] Có nghiên cứu nguồn gốc, kiến trúc đề xuất và thứ tự thử nghiệm.
- [x] Typecheck PASS; 74 test trong 5 suite liên quan PASS.
- [x] Không nhầm nghiên cứu/probe/test với nghiệm thu chất lượng dịch/TTS production.

## 3. Phạm vi

- In scope: đọc source, tài liệu, artifact text đã lưu; nghiên cứu tài liệu công khai; probe offline và báo cáo.
- Out of scope: sửa production, đổi tempo/extension/quota, gọi dịch/TTS live, cài lại WinLocal, commit/push.

## 4. Quyết định

- Dùng budget theo speech unit chung; word count là heuristic để hướng dẫn, không là hard semantic gate.
- Tái dùng DP grouping, ridge predictor, hai lượt Gateway và measured-first recovery.
- Ưu tiên bảo toàn sự kiện/quan hệ và văn phong Việt; ứng viên ngắn nhất không mặc nhiên tốt nhất.
- Mọi thành phần mới trong REVIEW là đề xuất; cần benchmark trước khi khẳng định cải thiện.

## 5. Tệp thay đổi

- [NEW] REVIEW.md — kết luận, finding, thiết kế, nghiên cứu và benchmark.
- [NEW] probe.mjs — probe không gọi provider/TTS, bundle module nguồn trong bộ nhớ.
- [NEW] probe-results.json — kết quả và SHA-256 các module liên quan.
- [NEW] TASK.md — biên bản review này.

## 6. Kiểm chứng

Lệnh đã chạy từ root:

    npm.cmd run typecheck
    node scripts/run-local-runtime-tests.mjs translation-prompts.test dubbing-grouping.test dubbing-duration-profile.test autoshort-content-quality.test gemini-gateway-prompts.test
    node .ai/tasks/2026-09-15-vietnamese-translation-design-review/probe.mjs

Kết quả: exit 0 cho cả ba lệnh. Suite lần lượt 11 + 20 + 8 + 31 + 4 = 74 pass, không skip/fail. Probe xác nhận giới hạn của source hiện tại; hai câu sai nghĩa được guard chấp nhận là finding, không là tiêu chí hành vi mong muốn.

Chưa chạy: provider/TTS/render mới, đánh giá mù với người Việt, benchmark thiết kế đề xuất. Build đang cài không được xác minh lại trong review này.

## 7. Bàn giao

Đọc [REVIEW.md](REVIEW.md). P0 là thống nhất plan/budget và bổ sung profile văn phong/review trong hai pass hiện có; P1 hiệu chuẩn giọng và tối ưu lựa chọn candidate; P2 chỉ bổ sung mô hình/phân hoạch nâng cao khi số liệu chứng minh cần thiết. Worktree có các sửa đổi sẵn của người dùng, không được dùng git add/reset/clean toàn bộ khi triển khai tiếp.
