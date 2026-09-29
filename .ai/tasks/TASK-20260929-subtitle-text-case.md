# [TASK-20260929-SUBTITLE-TEXT-CASE]: Thêm Tùy Chọn Định Dạng Chữ Phụ Đề (Chữ Hoa / Chữ Thường / Tiêu Đề)

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Antigravity Agent
- **Thời gian:** 2026-09-29

---

## 1. Mục Tiêu (Goal)

Cho phép người dùng tùy chọn định dạng viết hoa hoặc viết thường cho phụ đề xuất ra trên video ngắn/phụ đề tự động (AutoShort & VideoEditor), bao gồm:
- **Mặc định (Giữ nguyên)**: Giữ nguyên cách viết hoa/thường từ ASR / SRT gốc.
- **IN HOA TOÀN BỘ (UPPERCASE)**: Toàn bộ chữ phụ đề chuyển thành chữ in hoa (phù hợp video short/reel phong cách viral, hiện đại).
- **Chữ thường (lowercase)**: Toàn bộ chữ phụ đề chuyển thành chữ thường.
- **Viết hoa chữ đầu mỗi từ (Title Case)**: Tự động viết hoa chữ cái đầu tiên của từng từ theo chuẩn Unicode tiếng Việt & tiếng Anh.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Có dropdown "Định dạng chữ" trong bảng cấu hình phụ đề của cả tab AutoShort và VideoEditor ngay dưới "Độ đậm chữ".
- [x] Xem trước trực tiếp trên sân khấu video (RegionBox) cập nhật tức thì theo tùy chọn định dạng chữ đã chọn.
- [x] Hỗ trợ đầy đủ tiếng Việt có dấu (Unicode) không bị lỗi font hay mất dấu.
- [x] Phụ đề xuất ra file ASS / video burn qua FFmpeg áp dụng chính xác chữ in hoa / chữ thường.
- [x] Tính toán xuống dòng và kích thước chữ (planSubtitleLayout) được thực hiện TRÊN văn bản đã chuyển đổi chữ hoa/thường, đảm bảo không bị tràn khung hiển thị.
- [x] Tích hợp lưu/khôi phục theo Channel Preset của AutoShort.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Bộ test unit tự động cho tính năng (`subtitle-text-case.test.ts`) pass 100%.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Tạo module chia sẻ `src/shared/subtitleTextCase.ts` xử lý logic biến đổi văn bản và danh sách các tùy chọn.
  - Mở rộng hợp đồng kiểu dữ liệu IPC (`src/shared/types.ts`, `src/shared/autoShortContract.ts`, `src/shared/channelPreset.ts`).
  - Cập nhật backend `burn.ts`, `autoShortItemCoordinator.ts`, `src/main/index.ts` (API layout).
  - Cập nhật giao diện `AutoShort.tsx`, `VideoEditor.tsx` và component xem trước `RegionBox.tsx`.
  - Bộ kiểm thử `tests/subtitle-text-case.test.ts`.

- **Nằm ngoài phạm vi (Out of Scope):**
  - Không thay đổi cách ngắt câu của whisper hay bản dịch nguồn.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Áp dụng biến đổi trước bố cục layout (pre-layout text case transformation):* Do chữ in hoa (uppercase) có độ rộng pixel lớn hơn chữ thường, nếu chuyển đổi chữ in hoa sau khi đã ngắt dòng thì các dòng sẽ bị tràn ra khỏi khung hình video. Việc biến đổi cues trước khi đưa vào hàm `planSubtitleLayout` và `createTextMeasurer` đảm bảo độ rộng canvas và việc bẻ dòng chuẩn xác 100%.
- *Hỗ trợ Unicode tiếng Việt cho Title Case:* Sử dụng regex Unicode Property Escapes `/(^|[^\p{L}\p{N}])(\p{L})/gu` để nhận diện biên từ chính xác với các ký tự có dấu như `Đ, Ơ, Ư, Ắ...`.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` [src/shared/subtitleTextCase.ts](file:///f:/Son/tool/TediaPros/src/shared/subtitleTextCase.ts): Hàm biến đổi chuỗi `applySubtitleTextCase`, `applyTextCaseToCues`, hàm kiểm tra hợp lệ `isValidSubtitleTextCase`.
- `[NEW]` [tests/subtitle-text-case.test.ts](file:///f:/Son/tool/TediaPros/tests/subtitle-text-case.test.ts): Bộ kiểm thử kiểm tra chuyển đổi ký tự tiếng Việt, danh sách cues và render ASS.
- `[MODIFY]` [src/shared/types.ts](file:///f:/Son/tool/TediaPros/src/shared/types.ts): Bổ sung kiểu `SubtitleTextCase`, thêm trường vào `BurnReq`, `AutoShortConfig`, `SubtitleLayoutRequest`.
- `[MODIFY]` [src/shared/channelPreset.ts](file:///f:/Son/tool/TediaPros/src/shared/channelPreset.ts): Thêm `subtitleTextCase` vào `AutoShortChannelPreset`.
- `[MODIFY]` [src/shared/autoShortContract.ts](file:///f:/Son/tool/TediaPros/src/shared/autoShortContract.ts): Kiểm tra tính hợp lệ của `subtitleTextCase` tại ranh giới IPC.
- `[MODIFY]` [src/main/burn.ts](file:///f:/Son/tool/TediaPros/src/main/burn.ts): Tiếp nhận `subtitleTextCase`, biến đổi cues trước khi đo đạc layout và ghi sự kiện Dialogue ASS.
- `[MODIFY]` [src/main/autoShortItemCoordinator.ts](file:///f:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts): Truyền `subtitleTextCase` từ `config` sang `deps.burn`.
- `[MODIFY]` [src/main/index.ts](file:///f:/Son/tool/TediaPros/src/main/index.ts): Hỗ trợ `subtitleTextCase` trong `subtitle:layout` IPC handler.
- `[MODIFY]` [src/renderer/src/components/RegionBox.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/RegionBox.tsx): Cập nhật bản xem trước live chữ mẫu và dynamic cues timeline theo text case đã chọn.
- `[MODIFY]` [src/renderer/src/components/AutoShort.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/AutoShort.tsx): Thêm dropdown "Định dạng chữ", lưu persisted state, tích hợp preset.
- `[MODIFY]` [src/renderer/src/components/VideoEditor.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/VideoEditor.tsx): Thêm dropdown "Định dạng chữ", tính lại layout và truyền vào lệnh xuất video.
- `[MODIFY]` [scripts/run-local-runtime-tests.mjs](file:///f:/Son/tool/TediaPros/scripts/run-local-runtime-tests.mjs): Đăng ký `subtitle-text-case.test` vào danh sách kiểm thử cục bộ.

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:
```powershell
cmd.exe /c "npm run typecheck"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs subtitle-text-case.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs subtitle-layout.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-channel-preset-and-tone.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-ocr-contract.test"
cmd.exe /c "npm run test:subtitles"
```

### Kết quả thực tế:
- `Typecheck`: PASS (0 errors trên cả `typecheck:node` và `typecheck:web`)
- `subtitle-text-case.test`: PASS 5/5 tests (191ms)
- `subtitle-layout.test`: PASS 14/14 tests (545ms)
- `autoshort-channel-preset-and-tone.test`: PASS 6/6 tests (87ms)
- `autoshort-ocr-contract.test`: PASS 16/16 tests (90ms)
- `npm run test:subtitles`: PASS

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Thiết lập mặc định là `'original'` để giữ nguyên hành vi quen thuộc cho các dự án cũ.
- Khi người dùng chọn `'uppercase'`, video preview sẽ hiển thị chữ IN HOA ngay lập tức ("MẪU CHỮ XUẤT RA"), và video render sẽ có chữ in hoa đồng bộ như các video Short/Reel.
