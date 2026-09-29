# TASK-20260929-dynamic-font-weights: Hiển Thị Động Danh Sách Font Weight Theo Từng Font

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** AI Assistant
- **Thời gian:** 2026-09-29

---

## 1. Mục Tiêu (Goal)

Dropdown "Độ đậm chữ" (Font Weight) chỉ hiển thị các mức font weight mà font chữ đang chọn thực sự hỗ trợ:
- Với các font hỗ trợ dải rộng như **Inter**, **Roboto**, **Montserrat**, **Lexend**, **Noto Sans**: hiển thị đầy đủ từ **100 đến 900**.
- Với các font có dải hẹp hơn như **Oswald**: hiển thị từ **200 đến 700**.
- Với các font như **JetBrains Mono**: hiển thị từ **100 đến 800**.
- Với các font như **Space Grotesk**: hiển thị từ **300 đến 700**.
- Với các font single-weight tĩnh như **Anton**, **Lobster**, **Pacifico**: hiển thị **400**.
- Khi chuyển đổi qua lại giữa các font, tự động kẹp (clamp) mức weight hiện tại về mức hợp lệ gần nhất trong dải của font mới, không gây lỗi tag ASS hay lệch trạng thái UI.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] `BurnFontEntry` và manifest chứa metadata `minWeight` và `maxWeight` được trích xuất từ metadata font TTF (`wght` variation axis hoặc `os2.usWeightClass`).
- [x] Helper `getSupportedFontWeights` và `clampFontWeight` được tái sử dụng đồng nhất tại `src/shared/fontWeights.ts`.
- [x] UI AutoShort (`AutoShort.tsx`) và VideoEditor (`VideoEditor.tsx`) render dropdown độ đậm chữ động theo font đang chọn.
- [x] Trạng thái `fontWeight` được auto-clamp khi người dùng đổi font.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Unit test `tests/font-weights.test.ts` pass 100% (7/7 tests passed).

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Trích xuất và truyền `minWeight` / `maxWeight` từ manifest và font files sang `BurnFontEntry`.
  - Module logic dùng chung `src/shared/fontWeights.ts`.
  - Cập nhật cả 2 giao diện người dùng: `src/renderer/src/components/AutoShort.tsx` và `src/renderer/src/components/VideoEditor.tsx`.
  - Unit tests bao phủ các font tiêu biểu: Oswald, Inter, Anton, JetBrains Mono và kịch bản fallback/auto.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Không sửa đổi mã nguồn nhị phân sidecar C++/Python.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Trích xuất trực tiếp từ TTF*: Script quản lý font pack `scripts/font-pack-utils.mjs` đọc trục biến thiên `fvar` (`wght` min/max) qua thư viện `opentype.js`, bảo đảm độ chính xác 100% khớp với tệp font thực tế.
- *Nearest-Neighbor Clamping*: Khi đổi từ Inter (đang chọn 900) sang Oswald (hỗ trợ tối đa 700), `clampFontWeight` tự động gán về 700 thay vì reset về 400, giữ nguyên tối đa ý định của người dùng về độ đậm.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` [src/shared/fontWeights.ts](file:///f:/Son/tool/TediaPros/src/shared/fontWeights.ts)
- `[NEW]` [tests/font-weights.test.ts](file:///f:/Son/tool/TediaPros/tests/font-weights.test.ts)
- `[MODIFY]` [src/shared/types.ts](file:///f:/Son/tool/TediaPros/src/shared/types.ts)
- `[MODIFY]` [src/main/fonts.ts](file:///f:/Son/tool/TediaPros/src/main/fonts.ts)
- `[MODIFY]` [scripts/font-pack-utils.mjs](file:///f:/Son/tool/TediaPros/scripts/font-pack-utils.mjs)
- `[MODIFY]` [resources/fonts/manifest.json](file:///f:/Son/tool/TediaPros/resources/fonts/manifest.json)
- `[MODIFY]` [resources/fonts/catalog.json](file:///f:/Son/tool/TediaPros/resources/fonts/catalog.json)
- `[MODIFY]` [src/renderer/src/components/AutoShort.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/AutoShort.tsx)
- `[MODIFY]` [src/renderer/src/components/VideoEditor.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/VideoEditor.tsx)
- `[MODIFY]` [scripts/run-local-runtime-tests.mjs](file:///f:/Son/tool/TediaPros/scripts/run-local-runtime-tests.mjs)

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:
```powershell
cmd.exe /c "npm run fonts:verify"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs font-weights.test"
cmd.exe /c "npm run typecheck"
```

### Kết quả thực tế:
- `fonts:verify`: `[font-pack] verified 24 bundled fonts (18.27 MiB), pack 2026.09.29.1` (PASS)
- `font-weights.test`: 7/7 tests pass (127ms)
  - `listBurnFonts includes minWeight and maxWeight metadata`: PASS
  - `getSupportedFontWeights returns weights supported by Oswald (200 - 700)`: PASS
  - `getSupportedFontWeights returns full weights for Inter (100 - 900)`: PASS
  - `getSupportedFontWeights returns single weight 400 for Anton`: PASS
  - `getSupportedFontWeights returns 100 - 800 for JetBrains Mono`: PASS
  - `getSupportedFontWeights falls back to all options when font is null or unconstrained`: PASS
  - `clampFontWeight correctly clamps weights outside supported range`: PASS
- `Typecheck`: PASS (0 errors trên cả `typecheck:node` và `typecheck:web`)

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Cả 2 tab `AutoShort` và `VideoEditor` đều đã được đồng bộ với logic dynamic font weights này.
- Khi thêm font mới vào bộ cài trong tương lai qua `scripts/font-pack-utils.mjs`, hệ thống sẽ tự động trích xuất `minWeight`/`maxWeight` vào catalog và manifest mà không cần cấu hình thủ công.
