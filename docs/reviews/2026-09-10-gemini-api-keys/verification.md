# Kiểm chứng nhiều API key Gemini — 2026-09-10

## Phạm vi bằng chứng

- **CODE_CONFIRMED:** danh sách dùng chung cho dịch subtitle, AutoShort strict, rephrase dubbing và tạo tiêu đề; IPC có kiểu, trả nhãn che key và chặn origin không tin cậy đối với các handler quản lý danh sách mới.
- **TEST_CONFIRMED:** 97 tests trong tám tệp đều pass; chi tiết ở [runtime-tests.log](evidence/runtime-tests.log). `npm.cmd run typecheck` pass; [typecheck.log](evidence/typecheck.log). `git diff --check` không có lỗi khoảng trắng.
- **TEST_CONFIRMED (UI offline):** component React thực tế và CSS của repo chạy với IPC giả qua [ui-harness.mjs](ui-harness.mjs); kết quả xem qua accessibility tree và screenshot bằng browser tool trong phiên làm việc.
- **UNKNOWN:** API/quota thật, mã hóa DPAPI/Keychain thật, bản đóng gói và trải nghiệm đầy đủ trong Electron. Không khởi động lại ứng dụng đang chạy, không sửa key thật của người dùng.

## Kiểm thử tự động

| Tệp test | Pass |
| --- | ---: |
| gemini-keys.test | 15 |
| translation-provider-contract.test | 8 |
| translation-orchestrator.test | 24 |
| translation-transport.test | 16 |
| video-title.test | 18 |
| video-seo.test | 8 |
| autoshort-ui-contract.test | 4 |
| ipc-origin-validation.test | 4 |
| Tổng | 97 |

Regression được quan sát fail trước khi sửa: quota của model A chặn model B trong ba luồng rephrase/check/adapter; `hasKey` ném lỗi khi tệp lưu bị hỏng. Các ca này đã pass sau sửa.

## Thao tác giao diện đã xác nhận

1. Hai bảng độc lập cùng render `GeminiKeys`, ban đầu có 0 key.
2. Dán hai key giả bằng hai dòng vào một ô: giao diện tạo hai ô mật khẩu; lưu xong cả hai bảng cùng hiển thị 2 key đã che và ô nhập được xóa trắng.
3. Xóa key ở bảng thứ hai: cả hai bảng cùng hiển thị 1 key.
4. Kiểm tra kết nối giả: hiện thông báo thành công.
5. Khởi tạo `?broken=1`: hiện lỗi lưu trữ, nút lưu thêm bị vô hiệu hóa, nút thay danh sách lỗi chỉ bật khi có key mới.
6. Nhập key giả rồi thay danh sách lỗi: cả hai bảng nhận 1 key, thông báo lỗi biến mất.
7. Screenshot xác nhận ô nhập dùng cùng kiểu `.gk-row` của ứng dụng; các nút và chữ nằm trong thẻ 420 px.

Harness chỉ dùng bộ nhớ, không kết nối IPC Electron hoặc Gemini. Tab và server kiểm thử đã đóng sau kiểm tra.

## Rà soát

Reviewer độc lập phát hiện hai lỗi nêu trên và assertion URL cũ trong `video-title.test`; cả ba đã sửa, kiểm chứng bằng regression tương ứng. Lượt re-review sau sửa không chạy được do giới hạn usage của agent; không coi lần gọi đó là bằng chứng duyệt độc lập. Đã tự rà soát bản sửa và chạy các kiểm thử nêu trên.
