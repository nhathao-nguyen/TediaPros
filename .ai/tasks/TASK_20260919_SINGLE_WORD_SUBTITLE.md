# Task: Thêm Chế Độ Phụ Đề '1 Chữ 1 Dòng Nhảy Liên Tục' (Single-Word)

- **Ngày thực hiện:** 2026-09-19
- **Người yêu cầu:** User
- **Trạng thái:** Completed

---

## 1. Mục Tiêu
Bổ sung kiểu hiển thị phụ đề `single-word` ("1 chữ 1 dòng nhảy liên tục"):
- Thay vì hiện lần lượt từng từ và giữ lại các từ trước cho đến khi hết câu (`word-reveal`), chế độ `single-word` chỉ hiển thị duy nhất 1 từ tại một thời điểm trên đúng 1 dòng ở giữa khung hình.
- Từ nhảy liên tục theo beat lời thoại / âm thanh gốc hoặc theo nhịp phân bổ tự động khi dùng lồng tiếng AI (TTS) / dịch thuật.
- Hỗ trợ pop scale effect (nảy nhẹ khi chuyển chữ).

---

## 2. Thay Đổi Mã Nguồn
1. **Types & Contracts:**
   - `src/shared/types.ts`: Thêm `'single-word'` vào `SubtitleDisplayStyle`.
   - `src/shared/autoShortContract.ts`: Cập nhật `DISPLAY_STYLES` Set chứa `'single-word'`.
   - `src/shared/subtitleEffects.ts`: Cập nhật `normalizeSubtitleDisplayStyle`, export `assPlainText`.
2. **Backend ASS Generation & Validation:**
   - `src/main/burn.ts`:
     - Nhánh `if (displayStyle === 'single-word')` tạo Dialogue riêng biệt cho từng beat với thời gian `beat.start -> nextStart`.
     - Cập nhật `validateBurnRequest` chấp nhận `'single-word'`.
3. **Frontend UI & Live Preview:**
   - `src/renderer/src/components/AutoShort.tsx`: Thêm tùy chọn `['single-word', '1 chữ nhảy liên tục', 'Chỉ 1 chữ hiển thị mỗi thời điểm, nhảy liên tục', supportsWordEffects]`.
   - `src/renderer/src/components/RegionBox.tsx`: Nhánh preview riêng cho `single-word` căn giữa 1 từ duy nhất với activeBeat pop scale.
   - `src/renderer/src/components/VideoEditor.tsx`: Thêm `single-word` vào danh sách radio options.
4. **Kiểm thử tự động:**
   - `scripts/smoke-subtitles.ts`: Thêm test case `singleWordAss`.

---

## 3. Kiểm Tra & Đồng Bộ
- `npm run typecheck`: Pass 100% trên cả Repo chính và Worktree `pre-gateway-scheduling`.
- `npm run test:subtitles`: Pass.
- Đồng bộ hoàn toàn sang `.worktrees/pre-gateway-scheduling`.
