# TASK-20260919: Mở Khóa Phụ Đề 'Hiện Lần Lượt Từng Từ' (Word-Reveal) Cho Lồng Tiếng AI (TTS) & Dịch

- **Trạng thái:** Đã kiểm chứng (Verified)
- **Người thực hiện:** Antigravity AI Agent
- **Thời gian:** 2026-09-19

---

## 1. Mục Tiêu (Goal)
Mở khóa hiệu ứng phụ đề **"Hiện lần lượt từng từ" (Word-Reveal / Karaoke)** và **"Làm nổi bật từ đang đọc" (Word-Highlight)** khi người dùng bật **Lồng tiếng AI (TTS)** hoặc **Dịch phụ đề**, thay vì bị vô hiệu hóa (disabled) như trước đây.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)
- [x] Tùy chọn `word-reveal` và `word-highlight` không còn bị mờ / vô hiệu hóa khi bật Lồng tiếng AI hoặc Dịch.
- [x] Giao diện hiển thị chú thích rõ ràng: "Tự động căn nhịp từ theo câu nói".
- [x] Cấu hình `subtitleDisplayStyle` được truyền chính xác tới backend runner.
- [x] `autoShortItemCoordinator.ts` không tự động hạ cấp `renderDisplayStyle` về `standard` khi TTS thiếu word timestamps; giữ nguyên và kích hoạt bộ nội suy nhịp từ ước tính của ASS.
- [x] Đồng bộ đầy đủ sang cả nhánh chính và worktree `pre-gateway-scheduling`.
- [x] `npm run typecheck` pass 100% (0 errors).
- [x] Toàn bộ test suite liên quan (`test:subtitles`, `autoshort-thumbnail.test`, `autoshort-item-scope.test`, `autoshort-ocr-pipeline.test`) đều pass.

---

## 3. Danh Sách Tệp Thay Đổi (Changes Made)
- `[MODIFY]` [src/renderer/src/components/AutoShort.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/AutoShort.tsx)
- `[MODIFY]` [src/main/autoShortItemCoordinator.ts](file:///f:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts)
- `[MODIFY]` [.worktrees/pre-gateway-scheduling/src/renderer/src/components/AutoShort.tsx](file:///f:/Son/tool/TediaPros/.worktrees/pre-gateway-scheduling/src/renderer/src/components/AutoShort.tsx)
- `[MODIFY]` [.worktrees/pre-gateway-scheduling/src/main/autoShortItemCoordinator.ts](file:///f:/Son/tool/TediaPros/.worktrees/pre-gateway-scheduling/src/main/autoShortItemCoordinator.ts)

---

## 4. Bằng Chứng Kiểm Thử (Verification)
```powershell
cmd.exe /c "npm run typecheck" # Pass cả main workspace và worktree pre
cmd.exe /c "npm run test:subtitles" # Pass
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-thumbnail.test autoshort-item-scope.test autoshort-ocr-pipeline.test" # 23/23 tests pass
```
