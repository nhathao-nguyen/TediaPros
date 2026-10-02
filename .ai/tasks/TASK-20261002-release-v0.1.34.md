# TASK-20261002-release-v0.1.34: Phát hành Facebook Reels

- **Trạng thái:** CI thất bại; không xuất bản v0.1.34, tiếp tục v0.1.35
- **Người thực hiện:** Codex
- **Thời gian:** 2026-10-02

## 1. Mục Tiêu

Người dùng yêu cầu push code, nâng phiên bản và release. Phát hành v0.1.34 trên nhánh SonVersion, đưa các tính năng Reels hiện tại vào bộ cài Windows.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] package/lock/release notes đồng bộ 0.1.34, verify-release v0.1.34 pass.
- [x] Typecheck node/web pass.
- [x] Full local runtime suite pass: 1164 lượt pass, 0 fail, 35 skipped (fixture/runtime chuyên biệt chưa cấu hình).
- [x] Subtitle smoke pass và FFmpeg render thực tế 2/10/24 frames.
- [x] Push SonVersion và tag v0.1.34.
- [ ] CI build/package/publish hoàn tất và release có EXE, blockmap, latest.yml.

## 3. Phạm Vi

Tính năng Reels: scoped scan, caption, export TXT/article/XLSX/video, library/folder/dedup, daily monitor 09:00 Việt Nam và notifications/read/delete. Bao gồm UI thư viện hiện tại. Không sửa runtime channel, không merge các worktree khác, không cài đặt lên máy người dùng.

## 4. Quyết Định

Remote SonVersion và main đều là ancestor của HEAD trước commit; SonVersion là nhánh hiện tại và v0.1.33 đã phát hành từ nhánh này. Push nhánh SonVersion và tag mới; giữ main/worktree khác nguyên trạng. CI release-app.yml build Windows, kiểm chứng fonts/package/assets rồi xuất bản release theo tag. Không tạo release trước CI để tránh lỗi trùng release như run v0.1.33.

## 5. Tệp Thay Đổi

Nâng version package.json/package-lock.json và RELEASE_NOTES.md. Commit source/test/docs/task Reels đang có trong checkout; giữ QA local và kế hoạch docs/superpowers ngoài commit phát hành.

## 6. Kiểm Chứng

```powershell
npm.cmd run typecheck
node scripts/verify-release.mjs v0.1.34
npm.cmd run test:subtitles
npm.cmd run test:local-runtime
```

Local logs: `.ai/qa/release-v0.1.34-tests.txt`. Đã fetch remote/tags và xác minh v0.1.34 chưa tồn tại. GitHub CLI có quyền repo. Không có lỗi local; 35 skipped không được coi là bằng chứng media acceptance.

## 7. Bàn Giao

Cần xác minh CI và exact asset list sau push. Local tests/packaging không thay thế acceptance Facebook thật hay kiểm chứng bản đã cài.

CI run `36992774710` trên Windows thất bại ở đúng 3 assertion của `facebook-reels-library.test.ts`: fixture dùng TEMP dạng `C:\Users\RUNNER~1\...`, còn containment trả canonical `C:\Users\runneradmin\...`. Typecheck/subtitle/metadata/font đều pass; chưa đóng gói/xuất bản release. Sửa bằng realpath root fixture, giữ tag v0.1.34 nguyên trạng và phát hành tag mới v0.1.35.
