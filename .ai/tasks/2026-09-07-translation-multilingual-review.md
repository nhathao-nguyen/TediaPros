# TEDIA-TRANSLATION-REVIEW-20260907: Rà soát flow dịch đa ngôn ngữ

- Trạng thái: Hoàn thành review source/offline; chưa triển khai sửa runtime
- Người thực hiện: Codex
- Thời gian: 2026-09-07

## 1. Mục tiêu

Kiểm tra flow dịch, phương thức và guards sau incident zh→en để xác định
khả năng hỗ trợ nhiều video/ngôn ngữ và tránh chặn nhầm/retry quá sâu.

## 2. Nghiệm thu

- [x] Đọc coordinator, ba adapter, prompt/parser, grouping, cache và retry.
- [x] Phân biệt findings tái hiện được với rủi ro source-confirmed.
- [x] Typecheck PASS; 23 test liên quan PASS.
- [x] Báo cáo findings, thứ tự cải thiện và ma trận qualification.
- [ ] Live corpus/provider/TTS qualification không nằm trong evidence lượt này.

## 3. Phạm vi

Review và tài liệu. Không sửa cấu hình/model, restart app, xóa checkpoint/cache,
hoặc gửi nội dung video đến dịch vụ trong lượt này.

## 4. Quyết định

Không hứa mọi video/ngôn ngữ thành công. Đề xuất kết thúc hữu hạn, không mất nội
dung âm thầm và certification theo tổ hợp capability thực tế. Kiểm tra Local
partial recovery cho thấy tập missing cues giảm, không kết luận infinite loop.

## 5. Tệp thay đổi

- docs/reviews/2026-09-07-translation-multilingual-audit.md
- .ai/tasks/2026-09-07-translation-multilingual-review.md

## 6. Kiểm chứng

`npm.cmd run typecheck`: exit 0.
`node scripts/run-local-runtime-tests.mjs local-translation.test autoshort-content-quality.test autoshort-stage-cache.test`: exit 0, 23 pass.
Pure probes tái hiện semantic false positives, parser mất continuation, Hangul
join mất khoảng trắng và cloud payload target=auto. Giới hạn: chưa live benchmark
hay semantic/media qualification.

## 7. Bàn giao

Ưu tiên bốn findings P1 trước khi mở rộng locale. Runtime ở commit 3d49b84 còn
nguyên, nên incident chặn zh→en vẫn cần bản sửa tiếp theo.
