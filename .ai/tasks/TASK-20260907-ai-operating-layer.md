# TASK-20260907-01: Thiết Lập Hệ Điều Hành Kiến Trúc AI Cho TediaPros

- **Trạng thái:** ✅ **Hoàn thành & Đã kiểm chứng**
- **Người thực hiện:** Antigravity AI Agent
- **Thời gian:** 2026-09-07

---

## 1. Mục Tiêu (Goal)

Xây dựng toàn bộ hệ thống tài liệu kiến trúc, bản đồ định tuyến ngữ cảnh, quy trình làm việc chuẩn hóa và hướng dẫn cục bộ cho các module trong dự án TediaPros nhằm giúp các AI coding agent nắm vững codebase, tuân thủ các quy tắc an toàn và kiểm chứng công việc đáng tin cậy.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Tạo đầy đủ điểm khởi đầu `AGENTS.md` với bảng context routing và các lệnh đã xác minh.
- [x] Thiết lập `docs/architecture.md` và `docs/domain.md` mô tả toàn diện hệ thống và các hằng số vật lý.
- [x] Tạo 7 Architecture Decision Records (ADR 001 đến 007) giải thích các quyết định nền tảng.
- [x] Chuẩn hóa 4 quy trình `.ai/workflows/` (feature, bugfix, refactor, review).
- [x] Thiết lập chính sách phân quyền `.ai/policies/permissions.md` và mẫu task `.ai/tasks/TASK_TEMPLATE.md`.
- [x] Tạo hướng dẫn chuyên sâu cho toàn bộ 6 module lớn: `src/main`, `src/main/dubbing`, `src/main/separation`, `src/main/inpainting`, `src/renderer`, `src/shared`, `engines` và `engines/douyin-engine`.
- [x] `npm run typecheck` vượt qua 100% không có lỗi kiểu nào.
- [x] Bộ kiểm thử local runtime hoạt động tốt.

---

## 3. Danh Sách Tệp Đã Tạo & Cập Nhật

- `[NEW]` [AGENTS.md](file:///f:/Son/tool/TediaPros/AGENTS.md)
- `[NEW]` [docs/architecture.md](file:///f:/Son/tool/TediaPros/docs/architecture.md)
- `[NEW]` [docs/domain.md](file:///f:/Son/tool/TediaPros/docs/domain.md)
- `[NEW]` [docs/adr/001-hybrid-electron-python-engines.md](file:///f:/Son/tool/TediaPros/docs/adr/001-hybrid-electron-python-engines.md)
- `[NEW]` [docs/adr/002-typed-ipc-contracts.md](file:///f:/Son/tool/TediaPros/docs/adr/002-typed-ipc-contracts.md)
- `[NEW]` [docs/adr/003-on-demand-runtime-with-sha256-verification.md](file:///f:/Son/tool/TediaPros/docs/adr/003-on-demand-runtime-with-sha256-verification.md)
- `[NEW]` [docs/adr/004-planar-rgb-for-ocr-blurring.md](file:///f:/Son/tool/TediaPros/docs/adr/004-planar-rgb-for-ocr-blurring.md)
- `[NEW]` [docs/adr/005-source-anchored-dubbing-tempo-policy.md](file:///f:/Son/tool/TediaPros/docs/adr/005-source-anchored-dubbing-tempo-policy.md)
- `[NEW]` [docs/adr/006-sttn-inpainting-vs-masked-blur.md](file:///f:/Son/tool/TediaPros/docs/adr/006-sttn-inpainting-vs-masked-blur.md)
- `[NEW]` [docs/adr/007-deterministic-ass-subtitle-geometry.md](file:///f:/Son/tool/TediaPros/docs/adr/007-deterministic-ass-subtitle-geometry.md)
- `[NEW]` [.ai/workflows/feature.md](file:///f:/Son/tool/TediaPros/.ai/workflows/feature.md)
- `[NEW]` [.ai/workflows/bugfix.md](file:///f:/Son/tool/TediaPros/.ai/workflows/bugfix.md)
- `[NEW]` [.ai/workflows/refactor.md](file:///f:/Son/tool/TediaPros/.ai/workflows/refactor.md)
- `[NEW]` [.ai/workflows/review.md](file:///f:/Son/tool/TediaPros/.ai/workflows/review.md)
- `[NEW]` [.ai/policies/permissions.md](file:///f:/Son/tool/TediaPros/.ai/policies/permissions.md)
- `[NEW]` [.ai/tasks/TASK_TEMPLATE.md](file:///f:/Son/tool/TediaPros/.ai/tasks/TASK_TEMPLATE.md)
- `[NEW]` [.ai/tasks/INDEX.md](file:///f:/Son/tool/TediaPros/.ai/tasks/INDEX.md)
- `[NEW]` [src/main/AGENTS.md](file:///f:/Son/tool/TediaPros/src/main/AGENTS.md)
- `[NEW]` [src/main/dubbing/AGENTS.md](file:///f:/Son/tool/TediaPros/src/main/dubbing/AGENTS.md)
- `[NEW]` [src/main/separation/AGENTS.md](file:///f:/Son/tool/TediaPros/src/main/separation/AGENTS.md)
- `[NEW]` [src/main/inpainting/AGENTS.md](file:///f:/Son/tool/TediaPros/src/main/inpainting/AGENTS.md)
- `[NEW]` [src/renderer/AGENTS.md](file:///f:/Son/tool/TediaPros/src/renderer/AGENTS.md)
- `[NEW]` [src/shared/AGENTS.md](file:///f:/Son/tool/TediaPros/src/shared/AGENTS.md)
- `[NEW]` [engines/AGENTS.md](file:///f:/Son/tool/TediaPros/engines/AGENTS.md)
- `[NEW]` [engines/douyin-engine/AGENTS.md](file:///f:/Son/tool/TediaPros/engines/douyin-engine/AGENTS.md)

---

## 4. Kiểm Chứng (Verification)

1. `cmd.exe /c "npm run typecheck"`:
   - Node: PASS (0 errors)
   - Web: PASS (0 errors)
2. `cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-disk-budget.test"`:
   - 6/6 tests PASS.
