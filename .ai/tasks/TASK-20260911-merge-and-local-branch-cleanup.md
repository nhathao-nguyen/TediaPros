# TASK-20260911-merge-and-local-branch-cleanup: Hợp nhất và dọn local branch

- **Trạng thái:** Đang làm
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

## 1. Mục Tiêu (Goal)

Đưa các thay đổi đã kiểm chứng trong working tree vào lịch sử Git, hợp nhất về `main`, và xóa các local feature branch/worktree đã được tích hợp mà không làm mất bằng chứng chẩn đoán hữu ích.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [ ] Toàn bộ mã, tests và tài liệu có chủ đích được commit và merge vào `main`.
- [ ] Giữ lại tập bằng chứng gọn có checksum; không giữ WAV/cache sinh lại được.
- [ ] Xóa worktree và local branch đã được hợp nhất.
- [ ] `main` sạch, không có unmerged path hoặc local branch thừa.
- [ ] `npm.cmd run typecheck`, `npm.cmd run test:local-runtime`, build và `git diff --check` pass.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- Giữ mã nguồn, tests, tài liệu, báo cáo review và 20 tệp bằng chứng dubbing đã chọn.
- Không xóa remote branch, không push, không xóa stash hiện có.
- Các thư mục build/runtime/backup cục bộ được ignore khỏi Git; không đưa binary hoặc cache vào commit.

## 4. Quyết Định & Lý Do

- Dùng production allowlist trong `electron-builder.yml`; cập nhật test để kiểm tra cấu hình YAML theo hành vi allowlist thay vì đòi denylist cũ.
- Giữ 20 tệp script/report/verified plan từ worktree cũ và ghi SHA-256 tại `2026-09-08-dubbing-evidence-retention-manifest.json`.
- Loại 804 WAV cùng raw cache/LLM response khỏi tập giữ lại vì đây là output có thể sinh lại.

## 5. Danh Sách Thay Đổi

- `[MODIFY]` `.gitignore`
- `[MODIFY]` `tests/release-tooling.test.ts`
- `[NEW]` `.ai/tasks/2026-09-08-dubbing-evidence-retention-manifest.json`
- `[NEW]` 20 tệp bằng chứng chọn lọc dưới `.ai/tasks/2026-09-08-*`
- `[NEW]` bản ghi task này

## 6. Kiểm Chứng & Bằng Chứng

Kết quả cuối sẽ được cập nhật sau khi merge.

## 7. Bàn Giao

Không push lên `origin`; người dùng chỉ yêu cầu hợp nhất và dọn local branch.
