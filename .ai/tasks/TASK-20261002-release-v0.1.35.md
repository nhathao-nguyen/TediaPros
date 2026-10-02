# TASK-20261002-release-v0.1.35: Phát hành Facebook Reels sau sửa CI

- **Trạng thái:** Đã kiểm chứng local; chờ CI release
- **Người thực hiện:** Codex
- **Thời gian:** 2026-10-02

## 1. Mục Tiêu

Hoàn tất yêu cầu push/version/release cho toàn bộ tính năng Facebook Reels. Tag v0.1.34 giữ nguyên sau CI thất bại, chưa có GitHub Release; phiên bản phát hành tiếp theo là v0.1.35.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] Sửa nguyên nhân 3 assertion CI do TEMP Windows 8.3: canonicalize fixture root bằng realpath.
- [x] 26 test library/monitor pass; thêm lượt library 10/10 pass với TEMP thật dạng `F:\Son\tool\TEDIAP~1\AI466E~1\qa`.
- [x] Typecheck node/web và metadata/tag gate v0.1.35 pass.
- [ ] Push SonVersion và tag v0.1.35.
- [ ] CI build/package/publish pass; exact asset list được xác minh.

## 3. Phạm Vi

Không thay đổi hành vi ứng dụng từ commit 9387612; chỉ sửa fixture test, nâng version và ghi chú phát hành. Giữ worktree khác và QA local/kế hoạch ngoài commit.

## 4. Quyết Định

Giữ tag thất bại bất biến, không force-push/di chuyển v0.1.34. Nguyên nhân được xác nhận từ log run 36992774710: trả đường dẫn dài đúng cùng file nhưng test kỳ vọng chuỗi alias. Chuẩn hóa fixture thay vì làm yếu containment hoặc bỏ assertion/test.

## 5. Tệp Thay Đổi

`tests/facebook-reels-library.test.ts`, `package.json`, `package-lock.json`, `RELEASE_NOTES.md`, và bàn giao release 0.1.34/0.1.35.

## 6. Kiểm Chứng

```powershell
node scripts/run-local-runtime-tests.mjs facebook-reels-library.test facebook-reels-monitor.test
# TEMP/TMP = actual NTFS short alias under local QA for a second library run
node scripts/run-local-runtime-tests.mjs facebook-reels-library.test
npm.cmd run typecheck
node scripts/verify-release.mjs v0.1.35
```

Full suite trước sửa fixture: 1164 pass, 0 fail, 35 skipped; subtitle smoke có FFmpeg thật. CI sẽ kiểm tra lại toàn bộ suite trên clean Windows runner trước đóng gói. Không claim acceptance Facebook thật hoặc cập nhật bản đã cài.

## 7. Bàn Giao

Theo dõi CI release; chỉ công bố hoàn tất sau khi GitHub có installer EXE, blockmap và latest.yml cho v0.1.35.
