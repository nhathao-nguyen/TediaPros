# Phân Hệ Hợp Đồng Dùng Chung (Shared Contract)

- **Thư mục mã nguồn:** `src/shared/`
- **Tài liệu hướng dẫn vận hành:** [src/shared/AGENTS.md](file:///f:/Son/tool/TediaPros/src/shared/AGENTS.md)
- **Quy tắc bất biến:** **Tính Isomorphic tuyệt đối**. Tuyệt đối không import thư viện riêng của Node (`fs`, `path`, `electron`) và không import API DOM/Browser (`window`, `document`, React hooks).

---

## 1. Trách Nhiệm Cốt Lõi
- Đóng vai trò **Nguồn Sự Thật Duy Nhất (Single Source of Truth)** cho toàn bộ kiểu dữ liệu trong TediaPros.
- Định nghĩa các interface IPC giữa Main và Renderer ([types.ts](file:///f:/Son/tool/TediaPros/src/shared/types.ts)).
- Chứa các hàm tiền kiểm và hợp đồng dữ liệu chuẩn hóa ([autoShortContract.ts](file:///f:/Son/tool/TediaPros/src/shared/autoShortContract.ts)).
- Cung cấp các thuật toán tính toán thuần túy (pure functions) dùng chung cho cả 2 bên: gom nhóm visual timeline ([ocrVisualTimeline.ts](file:///f:/Son/tool/TediaPros/src/shared/ocrVisualTimeline.ts)), canh dòng phụ đề ([subtitleLayout.ts](file:///f:/Son/tool/TediaPros/src/shared/subtitleLayout.ts)).

---

## 2. Các Tệp & Ký Hiệu Chính
1. **`src/shared/types.ts`:**
   - `AutoShortConfig`: Toàn bộ cấu hình AutoShort (phương thức subtitle, whisper model/device, blurMode, audioMode, separationPreset, BGM, translateTarget, tts options).
   - `AutoShortEvent`: Sự kiện tiến trình thời gian thực (`item-progress`, `item-done`, `item-error`, `item-cancelled`, `batch-done`).
   - `AutoShortItemStatus`: Tập trạng thái (`idle`, `queued`, `extracting_sub`, `removing_subtitles`, `translating`, `separating_audio`, `generating_tts`, `stitching_audio`, `rendering_video`, `done`, `error`, `cancelled`).
   - `TblaoApi`: Định nghĩa TypeScript gõ chặt cho toàn bộ các hàm được expose qua `window.api`.
2. **`src/shared/autoShortContract.ts`:**
   - `validateAutoShortStartRequest(raw)`: Tiền kiểm hàng đợi từ 1 đến 100 video, kiểm tra trùng ID/đường dẫn, validate cấu hình.
   - `migrateLegacyConfig(raw)`: Tự động di trú cấu hình cũ (`fast-whisper` -> `whisper`, `tiny` -> `base`, `large-v3` -> `medium`).
3. **`src/shared/ocrVisualTimeline.ts`:**
   - `OCR_SAMPLE_FPS = 8`: Tần số quét cố định 8 khung hình/giây.
   - `computeIoU(a, b)`: Tính chỉ số Intersection over Union giữa 2 bounding box.
   - `planOcrMaskFrames(timeline, duration)`: Lập kế hoạch sinh mặt nạ nhị phân cho từng khung hình.
4. **`src/shared/autoShortSeparation.ts`:**
   - `separationPresetConfig(preset)`: Định nghĩa overlap và batch-size cho các cấu hình tách thoại (`fast`, `balanced`, `quality`).
5. **`src/shared/subtitles.ts` & `subtitleEffects.ts`:**
   - Parser và serializer định dạng `.srt`, chuyển đổi SRT sang ASS subtitle script với hiệu ứng Karaoke.

---

## 3. Đầu Vào, Đầu Ra & Tác Dụng Phụ
- **Input:** Dữ liệu thô từ người dùng hoặc từ API/IPC (JSON không định kiểu).
- **Output:** Dữ liệu có cấu trúc đã qua xác thực kiểu hoặc thông báo lỗi tường minh bằng tiếng Việt.
- **Side effects:** Hoàn toàn không có (pure functions).

---

## 4. Kiểm Thử Liên Quan
```powershell
cmd.exe /c "npm run typecheck"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-ocr-contract.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs separator-contract.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs sttn-contract.test"
```
