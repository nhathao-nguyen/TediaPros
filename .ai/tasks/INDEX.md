# Sổ Cái Nhiệm Vụ & Quy Chuẩn Bàn Giao (Task Ledger)

Tài liệu này dùng để lưu vết toàn bộ các nhiệm vụ đã, đang và chuẩn bị thực hiện trong **TediaPros**. Khi AI agent bắt đầu một phiên làm việc mới, hãy đọc file này để nắm bắt ngữ cảnh hiện tại của dự án.

---

## 1. Quy Ước Định Danh & Lưu Vết Task

Mỗi nhiệm vụ có phạm vi thay đổi từ 2 file trở lên hoặc kéo dài qua nhiều lượt trao đổi nên được tạo một tệp ghi nhận độc lập trong thư mục `.ai/tasks/`:
- **Định dạng tên tệp:** `TASK-YYYYMMDD-<tên-ngắn-viet-thuong-gach-noi>.md` (ví dụ: `TASK-20260907-ai-operating-layer.md`).
- **Mẫu nội dung:** Sử dụng mẫu tại [TASK_TEMPLATE.md](file:///f:/Son/tool/TediaPros/.ai/tasks/TASK_TEMPLATE.md).

---

## 2. Quy Chuẩn Git Commit (Conventional Commits)

Khi commit mã nguồn, AI coding agent bắt buộc phải tuân theo cấu trúc chuẩn:

```
<loại>(<phạm-vi>): <mô tả ngắn gọn bằng tiếng Anh hoặc tiếng Việt>

[Tùy chọn: mô tả chi tiết lý do và sự thay đổi]
```

### Các loại commit hợp lệ:
- `feat`: Tính năng mới (ví dụ: `feat(separation): support directml cpu fallback threshold`).
- `fix`: Sửa lỗi (ví dụ: `fix(dubbing): prevent silent drop on single cue overflow`).
- `refactor`: Tái cấu trúc không thay đổi hành vi logic (ví dụ: `refactor(ocr): clean up bounding box iou logic`).
- `docs`: Cập nhật tài liệu, ADR, hướng dẫn AI (ví dụ: `docs: add adr-006 for inpainting strategy`).
- `test`: Thêm mới hoặc cập nhật bộ kiểm thử (ví dụ: `test(budget): add test case for enospc reservation`).
- `chore`: Thay đổi tooling, build script hoặc dependencies (ví dụ: `chore(fonts): update pinned font hashes`).

---

## 3. Nhật Ký Tiến Độ Nhiệm Vụ (Task Progress Registry)

| Mã Task | Tiêu Đề | Trạng Thái | Ngày | Tệp Chi Tiết |
| :--- | :--- | :--- | :--- | :--- |
| **TASK-20260911-MERGE-LOCAL-CLEANUP** | Hợp nhất và dọn local branch | ✅ **Hoàn thành local** | 2026-09-11 | [TASK-20260911-merge-and-local-branch-cleanup.md](TASK-20260911-merge-and-local-branch-cleanup.md) |
| **TASK-20260911-PORTRAIT-BLUR-REVIEW** | Review và sửa chức năng 9:16 nền mờ | ✅ **Đã kiểm chứng local** | 2026-09-11 | [TASK-20260911-portrait-blur-review.md](TASK-20260911-portrait-blur-review.md) |
| **TASK-20260911-PORTRAIT-BLUR** | Khung 9:16 nền mờ cho preview và xuất video | ✅ **Đã kiểm chứng local** | 2026-09-11 | [TASK-20260911-portrait-blur.md](TASK-20260911-portrait-blur.md) |
| **TASK-20260907-01** | Thiết lập Hệ Điều Hành Kiến Trúc AI (AI Operating Layer) | ✅ **Hoàn thành** | 2026-09-07 | [.ai/tasks/TASK-20260907-ai-operating-layer.md](file:///f:/Son/tool/TediaPros/.ai/tasks/TASK-20260907-ai-operating-layer.md) |
| **TASK-20260910-DEV-OCR-RUNTIME-SYNC** | Đồng bộ runtime OCR GPU cho profile Dev | ✅ **Đã kiểm chứng** | 2026-09-10 | [.ai/tasks/TASK-20260910-dev-ocr-runtime-sync.md](file:///f:/Son/tool/TediaPros/.ai/tasks/TASK-20260910-dev-ocr-runtime-sync.md) |
