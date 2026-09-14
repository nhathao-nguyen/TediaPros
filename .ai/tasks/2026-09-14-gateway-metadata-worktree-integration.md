# TASK-20260914-INTEGRATION: Hợp nhất gateway, metadata short và worktree

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-14

---

## 1. Mục Tiêu (Goal)

Hợp nhất phần dịch hai lượt qua Gemini gateway và phần tối ưu metadata video short vào `main`, đồng thời thu hồi các nhánh/worktree đã hoàn tất mà không làm mất bằng chứng hay thay đổi cục bộ.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Thay đổi gateway dịch và metadata short có mặt trên `main`.
- [x] Các nhánh đã hợp nhất và worktree sạch được thu hồi.
- [x] Bằng chứng chưa được theo dõi trong worktree detached được đối chiếu theo nội dung trước khi thu hồi.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Test runtime liên quan pass kèm bằng chứng lệnh.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Hợp nhất `codex/short-metadata-prompt` vào `main` bằng merge commit.
  - Ghi nhận phần tích hợp Gemini gateway và quy trình dịch/kiểm tra hai lượt.
  - Đối chiếu 101 tệp chưa được theo dõi trong worktree detached bằng SHA-256.
  - Giữ lại ba script/báo cáo OCR-STTN chưa có trên `main`.
  - Thu hồi các worktree và nhánh đã được hợp nhất.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Push lên remote hoặc phát hành bản cài đặt.
  - Xóa cache, video thử nghiệm, ảnh nguồn, hoặc stash hiện có trong checkout chính.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Dùng merge commit cho nhánh metadata short.
- *Lý do:* Giữ nguyên ranh giới và lịch sử của tính năng để dễ truy vết.
- *Lựa chọn:* So sánh SHA-256 từng tệp trước khi dọn worktree detached.
- *Lý do:* Chứng minh 98 tệp đã có bản trùng khớp trên `main` và chỉ chuyển ba tệp còn thiếu, tránh mất bằng chứng.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `.ai/tasks/2026-09-12-winlocal-performance/extract-gap-fixtures.cjs`
- `[NEW]` `.ai/tasks/2026-09-12-winlocal-performance/gap-fix-verification.json`
- `[NEW]` `.ai/tasks/2026-09-12-winlocal-performance/verify-gap-fix.cjs`
- `[NEW]` `.ai/tasks/2026-09-14-gateway-metadata-worktree-integration.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:local-runtime
node --check .ai/tasks/2026-09-12-winlocal-performance/extract-gap-fixtures.cjs
node --check .ai/tasks/2026-09-12-winlocal-performance/verify-gap-fix.cjs
```

### Kết quả thực tế:

- `Typecheck`: PASS (0 errors).
- `Build`: PASS; Vite chỉ báo các cảnh báo import động/tĩnh đã tồn tại.
- `test:local-runtime`: PASS (exit code 0); các ca media thật cần `TEDIAPROS_TEST_FFMPEG` được skip theo cấu hình.
- `node --check`: PASS cho hai script bằng chứng.
- Đối chiếu worktree: 98 tệp trùng byte với checkout `main` sạch; ba tệp còn thiếu đã được chuyển sang `main`.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Chưa push hai repository lên remote.
- Không chạy lại bài kiểm tra phụ thuộc cache người dùng trong `verify-gap-fix.cjs`; báo cáo được giữ nguyên cho biết 13 ca đã PASS tại thời điểm thu thập.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Checkout chính vẫn giữ nguyên các video/ảnh thử nghiệm, cache Vite và hai stash để người dùng quyết định vòng đời riêng.
- CreateMediaTool có commit gateway độc lập và đã pass `go test ./...` sau `gofmt`.
