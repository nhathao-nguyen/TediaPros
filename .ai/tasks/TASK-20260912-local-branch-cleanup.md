# TASK-20260912-LOCAL-BRANCH-CLEANUP: Hợp nhất và dọn nhánh local

- **Trạng thái:** Hoàn thành — cập nhật sau merge cut repair
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-12

## Cập nhật 2026-09-12 — Merge cut repair

- `main` đã merge `codex/autoshort-cut-repair` tại `f8f4c93`.
- Merge tự động, không conflict; `npm.cmd run typecheck`, `npm.cmd run test:local-runtime` và `npm.cmd run build` đều PASS trên merge commit.
- Stash `codex-preserve-pre-cut-merge-20260912` giữ 20 file untracked trùng đường dẫn với evidence của nhánh cắt trước khi merge. 19 file có checksum trùng; `ui-empty-start.txt` chỉ khác whitespace. Không xóa stash này trong lượt cleanup.
- Worktree `codex-autoshort-batch-reliability` vẫn detached tại `2d4a882` và chứa artifact untracked; được giữ nguyên để không mất dữ liệu.

## 1. Mục Tiêu (Goal)

Kiểm tra công việc trên các nhánh local, bảo đảm đã nằm trong main và dọn tên nhánh dư mà không mất dữ liệu chưa commit.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Không còn nhánh local có commit chưa hợp nhất vào main.
- [x] Xóa an toàn hai nhánh đã hợp nhất bằng git branch -d.
- [x] Giữ nguyên 98 file untracked của main, đối chiếu SHA-256 trước/sau.
- [x] npm.cmd run typecheck PASS cho Node và Web.
- [x] Kiểm tra ancestry, diff và worktree; không cần chạy lại runtime tests vì không thay đổi mã nguồn hoặc HEAD.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- Trong phạm vi: nhánh local, trạng thái worktree, kiểm chứng bảo toàn file.
- Ngoài phạm vi: push/fetch, xóa stash, xóa dữ liệu build/runtime, commit các tài liệu đang làm.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- main và codex/autoshort-batch-reliability cùng trỏ đến 2d4a8822c05a99bd1101f758811044631b4f88d0. codex/autoshort-duration-recovery tại bcd10ac cũng đã là tổ tiên của main. Không cần commit merge mới.
- Giữ worktree .worktrees/codex-autoshort-batch-reliability ở detached HEAD vì còn 101 file untracked và artifact ignored. Trong đó 98 file giống bản ở main; 3 file riêng là extract-gap-fixtures.cjs, gap-fix-verification.json, verify-gap-fix.cjs trong .ai/tasks/2026-09-12-winlocal-performance/.
- Giữ nguyên stash có tên preserve pre-v0.1.23 main doc collisions.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- [NEW] .ai/tasks/TASK-20260912-local-branch-cleanup.md — bản ghi bàn giao này, để untracked.
- Không sửa mã nguồn, không tạo commit mới.
- Đã xóa refs/heads/codex/autoshort-batch-reliability và refs/heads/codex/autoshort-duration-recovery.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Các lệnh thực tế:

```powershell
git branch --merged main
git rev-list --count main..codex/autoshort-batch-reliability
git rev-list --count main..codex/autoshort-duration-recovery
npm.cmd run typecheck
git -C F:/Son/tool/TediaPros/.worktrees/codex-autoshort-batch-reliability switch --detach 2d4a8822c05a99bd1101f758811044631b4f88d0
git branch -d codex/autoshort-batch-reliability codex/autoshort-duration-recovery
git branch -vv
git worktree list
git diff --check
git stash list
```

- Hai phép đếm commit riêng đều bằng 0 trước khi xóa nhánh.
- Typecheck PASS, git diff --check PASS.
- 98/98 file untracked có sẵn ở main giữ nguyên SHA-256.
- Sau thao tác chỉ còn nhánh local main tại 2d4a882; worktree phụ detached tại cùng commit.
- Không chạy runtime/build trong task này vì không thay đổi mã nguồn.
- origin/main là ref local chưa fetch: main ahead 7 theo snapshot này, chưa xác minh trạng thái server.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Dữ liệu chưa commit và bản build trong worktree phụ được giữ nguyên tại đường dẫn cũ.
- Chưa push lên remote. Không xóa remote branch hoặc stash.
