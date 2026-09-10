# Rà soát độc lập kết quả OCR GPU lab

- Ngày: 2026-09-10 (Asia/Saigon).
- Reviewer: subagent Kepler, `01a0873c-deef-7f93-8062-1c9ef77c8179`.
- Chỉ đọc report, protocol, harness/provider code và JSON bằng chứng; không
  sửa file, chạy lại benchmark hoặc tác động runtime/ứng dụng.
- Kết luận: sẵn sàng bàn giao dưới dạng **lab assessment**, không có blocker;
  không phải phê duyệt tích hợp GPU production.

## Góp ý và xử lý

1. **P3 — Đỉnh tài nguyên lấy mẫu ở cửa sổ giữa OCR.** `compare.mjs` lọc theo
   thời gian tương đối monitor và bỏ 5 giây ở hai biên, không đồng bộ chính xác
   mốc stage start. Main agent đã kiểm tra code và sửa nhãn bảng/chú thích trong
   README; không trình bày như đỉnh RAM/VRAM bao gồm startup/teardown.
2. **P3 — Timer gồm instrumentation.** `runner.ts` lưu/copy timeline/SRT trong
   OCR timer và copy mask trong mask timer. Main agent đã kiểm tra code và ghi
   rõ trong README/PROTOCOL. Hai nhánh dùng cùng cơ chế, số đo không thay đổi.

Reviewer xác nhận báo cáo phân biệt same-runtime/provider A/B, canary GPU
thật, CPU shape ops, hủy/lỗi provider/rerun process mới và queue fixture.
Không tìm thấy thao tác activation không an toàn trong harness đã đọc.
Order-balanced repeats, đánh giá ground truth rộng hơn, UI/queue/OOM/driver
thật vẫn là qualification tiếp theo, không phải kết quả đã có của spike này.
