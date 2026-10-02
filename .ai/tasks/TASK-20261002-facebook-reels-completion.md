# TASK-20261002-facebook-reels-completion: Xác nhận trang cuối Reels khi phản hồi vượt inspector cache

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex; code review độc lập đọc code
- **Thời gian:** 2026-10-02

## 1. Mục Tiêu (Goal)

Sửa trường hợp profile `61593283816056` đã tìm thấy 20 Reel nhưng luôn báo chưa xác nhận hết danh sách, do thiếu phản hồi phân trang cuối.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Xác định từ checkpoint và phản hồi thật; không lấy số thẻ/DOM đứng yên làm chứng cứ hết danh sách.
- [x] Phản hồi NDJSON gần 7 MB được xử lý từng bản ghi, giữ tín hiệu page_info và membership đúng nguồn.
- [x] Giữ giới hạn bộ nhớ, fallback Chromium cũ, UTF-8, timeout/hủy/dọn CDP.
- [x] Typecheck pass 100% (`npm.cmd run typecheck`).
- [x] Test liên quan và build pass, review không còn Critical/Important.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** network observer, kiểm thử lifecycle, tài liệu và bằng chứng.
- **Ngoài phạm vi:** thay tiêu chí complete, replay GraphQL, ghi lại cookie/token, sửa checkpoint cũ, installer hoặc khởi động lại app có job đang chạy.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

Thu `streamResourceContent` ở responseReceived thay vì đợi getResponseBody bị evict. Xử lý JSON/NDJSON theo dòng, giữ phần JSON chưa hoàn chỉnh để hỗ trợ pretty JSON; ghép byte trước decode để không cắt Unicode. Giới hạn 4 MiB/bản ghi, 24 MiB tổng request và active buffer, 24 MiB retained metadata. Prefix phải đứng trước các event đến sớm. Timeout/dispose hủy chờ CDP bằng cancellation promise, kể cả khi command không trả. Bộ điều khiển chỉ complete khi mọi điều kiện nguồn/phân trang/DOM/warnings vốn có đều thỏa.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/facebookReelsNetwork.ts`
- `[MODIFY]` `tests/facebook-reels-lifecycle.test.ts`
- `[MODIFY]` `docs/adr/012-facebook-reels-scoped-discovery.md`
- `[MODIFY]` `docs/facebook-reels-export.md`
- `[NEW]` `.ai/qa/facebook-reels-completion/proof.json`
- `[NEW]` Bản bàn giao này.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Đã tái hiện

Checkpoint cũ có 20 caption nhưng 10 membership; partial/stalled với lỗi đọc mạng. Chrome CDP báo `Request content was evicted from inspector cache`. Phản hồi cuối 6.965.837 byte, 71 bản ghi JSON; collection có 10 edge đúng owner, `has_next_page=false`.

### Kiểm chứng module với dữ liệu thật

Bundle pure observer/controller hiện tại, không mở native Electron. Dữ liệu bootstrap và response quan sát trong Chrome được đưa vào module trong bộ nhớ, không lưu raw/cookie/token. Kết quả 20/20 membership, pending 0, warnings [], complete/end-of-list sau khi DOM cuối trang ổn định. Lần đọc bootstrap đầu qua công cụ bị cắt string 200.000 ký tự; đã đọc lại từng phần và đối chiếu valid JSON trước kiểm chứng cuối. Không sửa parser để bỏ cảnh báo.

### Các lệnh đã chạy

```powershell
node scripts/run-local-runtime-tests.mjs facebook-reels-lifecycle.test
node scripts/run-local-runtime-tests.mjs facebook-reels-crawler.test facebook-reels-parser.test facebook-reels-lifecycle.test facebook-reels-jobs.test facebook-reels-selection.test facebook-reel-details.test facebook-reels-export.test
npm.cmd run typecheck
npm.cmd run build
```

Các regression mới fail trước sửa: mất terminal evidence/command streaming chưa gọi; phản hồi nhiều bản ghi >4 MiB bị bỏ; flush treo khi dispose. Lifecycle sau sửa: 17 pass, 0 fail.

Kết quả cuối: 69 test liên quan pass (crawler 10, parser 7, lifecycle 17, jobs 9, selection 9, details 6, export 11), 0 fail/skip. Typecheck node/web exit 0. Build exit 0, `out/main/index.js` 1.594,65 kB, renderer `index-BWSVUs5C.js`. Review lần đầu phát hiện command CDP không trả làm flush treo; đã thêm cancellation/deadline và regression. Review lại xác nhận không còn Critical/Important và độc lập chạy 17 lifecycle pass. Tiêu chí complete trong controller không thay đổi.

### Những phần chưa kiểm tra / Rủi ro còn lại

Chưa chạy lại một lượt trong native Electron đang mở. Build cần nạp lại main; lượt cũ không tự trở thành complete. Schema lạ, response quá giới hạn, lỗi mạng thật vẫn partial. Không chứng minh mọi profile/fanpage Facebook đều đủ bằng một profile.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Các tiến trình Electron hiện chạy từ checkout này; chưa chủ động đóng app. Sau khi các tác vụ đang chạy kết thúc, mở lại app để nạp main mới và quét lại profile. Giữ checkpoint và file đã xuất. Không tạo installer/commit trong task này.
