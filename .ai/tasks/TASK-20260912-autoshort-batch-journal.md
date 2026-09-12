# AutoShort durable batch journal

## Phạm vi

- Lưu snapshot batch nguyên tử trong Main Process với checksum, revision và backup.
- Ghi trạng thái trước/sau engine; thành công chỉ có hiệu lực sau khi kiểm tra file, duration và SHA-256.
- Khôi phục `running` thành `interrupted`; UI hiển thị nút tiếp tục, không tự chạy AI khi mở lại.
- Resume chỉ nhận `pending/interrupted`, kiểm tra config digest và source digest; không chạy lại `succeeded`, `failed` hoặc `needs-review`.

## An toàn

- Schema dùng danh sách field đóng và từ chối credential lạ.
- Job ID là safe segment; store từ chối symlink/junction thoát root.
- Ghi tuần tự và optimistic revision ngăn hai worker ghi đè checkpoint của nhau.
- Receipt sai hoặc thiếu được chuyển `needs-review`, không ghi đè output.

## Kiểm chứng

- `node scripts/run-local-runtime-tests.mjs autoshort-batch-resume.test`
- `node scripts/run-local-runtime-tests.mjs autoshort-batch-store.test`
- `node scripts/run-local-runtime-tests.mjs autoshort-queue-throughput.test`
- `npm run typecheck`

Kết quả tại lúc bàn giao: các lệnh trên PASS. Suite 1.000 item xác nhận thứ tự và không lặp candidate; fault tests xác nhận stale revision, JSON bị cắt, backup checksum và junction containment.
