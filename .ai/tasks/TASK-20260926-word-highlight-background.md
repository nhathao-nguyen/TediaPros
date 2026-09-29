# TASK-20260926-word-highlight-background: Tùy Chọn Nền Sau Từ Đang Đọc (Word Highlight Background)

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Antigravity Agent
- **Thời gian:** 2026-09-26

---

## 1. Mục Tiêu (Goal)

Người dùng yêu cầu bổ sung tùy chọn hiển thị màu nền hộp (background pill/box) phía sau từ đang đọc khi sử dụng kiểu hiển thị phụ đề "Làm nổi bật từ đang đọc" (`displayStyle === 'word-highlight'`), giúp từ đang được nhấn mạnh trở nên nổi bật và dễ đọc hơn trên video có nhiều chi tiết nền.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Giao diện người dùng (`AutoShort.tsx` và `VideoEditor.tsx`) cung cấp công tắc bật/tắt "Nền sau chữ đang đọc" (`highlightBgEnabled`) và bộ chọn màu "Màu nền chữ đang đọc" (`highlightBgColor`, mặc định `#000000`) khi chọn kiểu phụ đề nổi bật từ đang đọc.
- [x] Khung preview trực quan (`RegionBox.tsx`) hiển thị live khối nền bo góc xung quanh từ đang active theo màu sắc đã chọn.
- [x] Engine tạo phụ đề ASS (`burn.ts`, `subtitleEffects.ts`) định nghĩa style `WordBox` sử dụng `BorderStyle=3` (Opaque Box) với màu viền/hộp là màu nền người dùng chọn, định vị chính xác vị trí từ đang active mà không làm xô lệch vị trí text xung quanh.
- [x] Quản lý layer chuẩn trong ASS: hộp nền từ ở layer thấp hơn text nhưng cao hơn hộp nền toàn phụ đề (nếu có).
- [x] Schema và contract IPC (`types.ts`, `channelPreset.ts`, `autoShortContract.ts`, `autoShortItemCoordinator.ts`) được đồng bộ và kiểm tra hợp lệ.
- [x] `npm run typecheck` pass 100% không có lỗi.
- [x] `npm run test:subtitles` và `npm run test:local-runtime` pass 100%.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Thêm thuộc tính `highlightBgEnabled` và `highlightBgColor` vào kiểu `BurnReq`, `BurnEffectOptions`, `AutoShortTaskConfig`, `AutoShortChannelPreset`.
  - Hàm `renderAssWordBoxLineOverlay` và `renderAssWordBox` trong `subtitleEffects.ts`.
  - Sinh style `WordBox` và các event Dialogue layer nền trong `burn.ts`.
  - UI control và live preview trong `AutoShort.tsx`, `VideoEditor.tsx`, `RegionBox.tsx`.
  - Smoke test ASS trong `scripts/smoke-subtitles.ts`.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Không thay đổi hành vi của các kiểu phụ đề khác (`karaoke`, `phrase-pop`, `classic`).

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Kỹ thuật render nền trong ASS:*
  - Trong chuẩn ASS, `BorderStyle=3` biến Outline thành một bounding box hình chữ nhật bọc quanh văn bản với màu của `OutlineColour`.
  - Để vẽ hộp chỉ riêng cho từ đang đọc mà vẫn giữ 100% layout nguyên bản của toàn dòng phụ đề (kerning, dấu câu tiếng Việt, khoảng cách từ), ta dùng kỹ thuật overlay line: đặt `PrimaryColour` thành trong suốt (`&HFF000000&`), các từ không active được gán alpha trong suốt hoàn toàn (`{\1a&HFF&\3a&HFF&}`), và chỉ riêng từ đang active được mở viền hộp (`{\3a&H00&}`).
  - Thêm thẻ `\blur` để bo mềm các góc của khối viền hộp.
- *Phân tầng Layer:*
  - Layer 0 (hoặc thấp nhất): Hộp nền toàn bộ phụ đề nếu bật `bgOn`.
  - Layer `wordBoxLayer`: Hộp nền của từ đang đọc.
  - Layer `baseLayer`: Văn bản gốc phụ đề.
  - Layer cao nhất: Chữ nổi bật (pop/highlighted text).

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` [src/shared/types.ts](file:///f:/Son/tool/TediaPros/src/shared/types.ts) — Bổ sung `highlightBgEnabled` và `highlightBgColor` vào hợp đồng types.
- `[MODIFY]` [src/shared/channelPreset.ts](file:///f:/Son/tool/TediaPros/src/shared/channelPreset.ts) — Bổ sung cấu hình preset mặc định và validator cho channel preset.
- `[MODIFY]` [src/shared/autoShortContract.ts](file:///f:/Son/tool/TediaPros/src/shared/autoShortContract.ts) — Kiểm tra hợp lệ cấu hình khi submit task.
- `[MODIFY]` [src/main/autoShortItemCoordinator.ts](file:///f:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts) — Truyền cấu hình nền từ đang đọc vào burn request.
- `[MODIFY]` [src/shared/subtitleEffects.ts](file:///f:/Son/tool/TediaPros/src/shared/subtitleEffects.ts) — Thêm hàm `renderAssWordBoxLineOverlay` & `renderAssWordBox`.
- `[MODIFY]` [src/main/burn.ts](file:///f:/Son/tool/TediaPros/src/main/burn.ts) — Cấu hình Style `WordBox` và sinh Dialogue event hộp nền sau từ đang đọc.
- `[MODIFY]` [src/renderer/src/components/AutoShort.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/AutoShort.tsx) — UI công tắc và bộ chọn màu trong tab AutoShort.
- `[MODIFY]` [src/renderer/src/components/VideoEditor.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/VideoEditor.tsx) — UI công tắc và bộ chọn màu trong tab Trình chỉnh sửa video.
- `[MODIFY]` [src/renderer/src/components/RegionBox.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/RegionBox.tsx) — Hiển thị khối nền live preview của từ đang active.
- `[MODIFY]` [scripts/smoke-subtitles.ts](file:///f:/Son/tool/TediaPros/scripts/smoke-subtitles.ts) — Kiểm thử sinh Style: WordBox và event ASS tương ứng.
- `[MODIFY]` [tests/local-runtime.test.ts](file:///f:/Son/tool/TediaPros/tests/local-runtime.test.ts) — Cập nhật fixture test khớp biến outputAudioName.

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:
```powershell
cmd.exe /c "npm run typecheck"
cmd.exe /c "npm run test:subtitles"
cmd.exe /c "npm run test:local-runtime"
```

### Kết quả thực tế:
- `Typecheck`: PASS (0 errors trên cả Node và Web).
- `Smoke subtitles test`: PASS (Xác nhận sinh đúng Style: WordBox, BorderStyle=3, OutlineColour, và các dialogue event phủ nền).
- `Local runtime tests`: PASS 100% (158 passed, 1 skipped).
