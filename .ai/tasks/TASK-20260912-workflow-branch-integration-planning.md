# TASK-20260912-workflow-branch-integration-planning: Đối chiếu branch và lập kế hoạch Edge-TTS

- **Trạng thái:** Hoàn thành khảo sát và kế hoạch; chưa triển khai tích hợp.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-12.

## 1. Mục Tiêu (Goal)

Đọc branch `fix/workflow-capcut-youtube`, so với project hiện tại và lập kế hoạch cho phần còn thiếu, bảo toàn working tree đang có các công việc khác.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Fetch remote, khóa SHA, xác định merge base và incoming commits.
- [x] Phân loại đủ 11 file incoming; đối chiếu contract, adapter, UI, cache/resume hiện tại.
- [x] Có findings, phương án tích hợp, file map, tests, rollout và rollback trong plan.
- [x] Typecheck node/web PASS trên working tree hiện tại.
- [x] Baseline 74 tests / 6 suites PASS, có log.
- [x] Giữ nguyên nội dung 27 dirty tracked files đã chụp hash; giữ HEAD/main và không có unmerged path.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **In Scope:** Khảo sát Git/code, mô phỏng merge không thay index/checkout, baseline tests, báo cáo/spec, kế hoạch và bằng chứng.
- **Out of Scope:** Sửa source, cài dependency vào project, merge/cherry-pick/commit/push, gọi Edge synthesis, build/release mới, chứng minh Windows/macOS live.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- HEAD `cd7d86552fb40ce10656346e52cdea914a39bac0`; incoming `1d61ef744384208382de3903b73b2953d45553ab`; common `079387a507f9fe15b62c51cf719003110bcadd6b`.
- 90 commit riêng phía main và 1 phía incoming. Merge cũ `645a9ea` là ancestor của HEAD, đã kiểm tra lại bằng Git.
- Chỉ thiếu Edge-TTS. Helper batch 4–8 workers có định nghĩa nhưng không có caller; không coi đó là feature batch đã hoạt động.
- Khuyến nghị port có chọn lọc, Local default, giữ cache v2/timing/resume và UI mới. Mô phỏng merge committed heads báo 5 content conflicts.
- Không ghi đè tài liệu architecture/domain đang dirty; đặt kết quả trong các file mới riêng.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `docs/superpowers/specs/2026-09-12-workflow-branch-integration-review.md`.
- `[NEW]` `docs/superpowers/plans/2026-09-12-workflow-edge-tts-integration.md`.
- `[NEW]` Task handoff này.
- `[NEW]` `.ai/tasks/2026-09-12-workflow-branch-integration/`: incoming patch/inventory, divergence, merge simulation, initial status, dirty tracked hashes, baseline test log, final state và verification record.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Các lệnh chính đã chạy:

```powershell
git fetch --no-tags origin fix/workflow-capcut-youtube
git ls-remote origin refs/heads/fix/workflow-capcut-youtube
git rev-list --left-right --count HEAD...1d61ef7
git merge-base HEAD 1d61ef7
git merge-base --is-ancestor 645a9ea HEAD
git diff --stat 079387a 1d61ef7
git merge-tree --write-tree --name-only HEAD 1d61ef7
git grep -n generateEdgeTTSBatch 1d61ef7 -- src
npm.cmd view msedge-tts@2.0.7 version repository license engines dependencies --json
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs dubbing-plan.test dubbing-duration-profile.test autoshort-tts-cache.test autoshort-tts-pipeline.test autoshort-batch-resume.test autoshort-ui-contract.test
git diff --check
```

Kết quả:

- Typecheck PASS (exit 0), gồm node + web. Console output được đọc trong phiên; verification record lưu lại kết quả quan sát, không giả làm raw log.
- Tests 49 + 8 + 4 + 6 + 3 + 4 = **74 PASS**, fail 0, command exit 0. Raw log tại `2026-09-12-workflow-branch-integration/baseline-tests.log`.
- merge-tree exit **1 do conflict dự kiến**, không phải merge đã thực hiện. 5 file: autoshort.ts, tts.ts, AutoShort.tsx, Voice.tsx, autoShortContract.ts. Raw output tại `merge-tree.txt`.
- `git diff --check` PASS; dirty tracked SHA-256 unchanged tại `final-state.json`.
- Seed catalog đã đếm lại từ source incoming: 35 voices, 14 language codes, 17 locales.

Giới hạn: baseline PASS là checkout hiện tại gồm dirty changes, không phải incoming branch hay bản Edge port. Chưa chạy full runtime suite, build, Edge network synthesis, UI hoặc packaged platforms. Trang GitHub branch không đọc được qua web; Git fetch/ls-remote thành công là nguồn xác minh branch. README MsEdgeTTS và npm metadata chỉ dùng xác định yêu cầu thư viện, không chứng minh dịch vụ live.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Nếu người dùng yêu cầu triển khai, thực hiện plan T0–T5 trong worktree riêng và chốt base có công việc AI-output mới trước integration cuối. Những giới hạn transport và chiến lược port trong spec là đề xuất được trình để review, không phải đã thực thi. Không cần merge lại toàn bộ workflow cũ.
