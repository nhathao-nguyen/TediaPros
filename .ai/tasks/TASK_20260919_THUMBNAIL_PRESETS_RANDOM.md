# TASK-20260919: AutoShort Thumbnail Presets Mở Rộng, Random Batch & Chuẩn Hóa Tên File

- **Trạng thái:** Đã kiểm chứng (Verified)
- **Người thực hiện:** Antigravity AI Agent
- **Thời gian:** 2026-09-19

---

## 1. Mục Tiêu (Goal)

Người dùng yêu cầu nâng cấp hệ thống Thumbnail tự động của AutoShort:
1. Mở rộng kho preset ảnh bìa đa dạng, đẹp mắt, thẩm mỹ cao hơn 4 kiểu cơ bản hiện có.
2. Hỗ trợ chế độ chọn **Ngẫu nhiên (Random)** để mỗi video trong hàng đợi batch tự động chọn một preset khác nhau, tránh lặp lại nhàm chán.
3. Rút gọn tên tệp ảnh bìa xuất ra thành `Thumbnail.jpg` thay vì chuỗi tên dài lê thê chứa ngày tháng và video ID (`2026-09-09_没有任何刀头，却专门贯穿各种岩层_7683460713322482978_thumb`).

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Kho preset phong phú (12 presets độc đáo với palette màu, font shadow, viền, viền kép, độ tương phản cao).
- [x] Tùy chọn `🎲 NGẪU NHIÊN` có mặt trên UI cấu hình và player stage live preview.
- [x] Khi chạy hàng đợi batch nhiều video với chế độ `random`, mỗi video tự động chọn một preset luân phiên/ngẫu nhiên độc lập (`resolveThumbnailStyle(style, index)`).
- [x] Tên file thumbnail luôn ưu tiên xuất ra là `Thumbnail.jpg` cạnh video hoàn thành (và fallback an toàn `Thumbnail (2).jpg` nếu có tệp trùng).
- [x] `npm run typecheck` pass 100% không có lỗi (`typecheck:node` + `typecheck:web`).
- [x] Bộ test unit `autoshort-thumbnail.test.ts` pass toàn bộ (11/11 tests).
- [x] Pipeline liên quan (`autoshort-item-scope.test`, `autoshort-ocr-pipeline.test`) pass không hồi quy.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Hợp đồng kiểu dữ liệu IPC (`src/shared/types.ts`): Thêm 8 preset mới vào `AutoShortThumbnailStyle` (tổng cộng 12), thêm kiểu `AutoShortThumbnailStyleOrRandom`, thêm trường `outputFilename` vào request.
  - Core xử lý thumbnail backend (`src/main/autoShortThumbnail.ts`): Bổ sung định nghĩa màu ASS/style cho 12 preset, hàm `resolveThumbnailStyle`, `resolveUniqueThumbnailFilename`, và ghi file an toàn `assertContainedParentDirectory`.
  - Bộ điều phối batch (`src/main/autoShortItemCoordinator.ts`): Áp dụng `resolveThumbnailStyle(config.thumbnailConfig.style, index)` cho từng video trong batch và truyền `outputFilename: 'Thumbnail.jpg'`.
  - Giao diện người dùng (`src/renderer/src/components/AutoShort.tsx` và `AutoShortThumbnailModal.tsx`): Lưới chọn 12 preset + 1 Random card, live preview thẻ mô phỏng CSS, huy hiệu thông báo chế độ Random, nhãn hiển thị tên file `Thumbnail.jpg`.
  - Bộ kiểm thử tự động (`tests/autoshort-thumbnail.test.ts`).
- **Nằm ngoài phạm vi (Out of Scope):**
  - Không can thiệp vào logic OCR blur, TTS dubbing tempo, STTN inpainting.
  - Không thay đổi các hợp đồng IPC khác ngoài thumbnail.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

1. **Thứ tự byte màu ASS Substation Alpha (`&HAABBGGRR`):**
   - *Lựa chọn:* Chuyển đổi mã màu CSS sang thứ tự ASS: Blue và Red hoán đổi nhau, Alpha ở đầu (00 = đặc hoàn toàn).
   - *Lý do:* Đảm bảo phụ đề render chính xác màu sắc trên video canvas thay vì bị đảo sắc tố (ví dụ: vàng thành xanh lơ).
2. **Luân phiên không trùng lặp lân cận khi chọn Random:**
   - *Lựa chọn:* Sử dụng công thức hash kết hợp chỉ số hàng đợi `(itemIndex * 7 + randomSeed) % styles.length` trong `resolveThumbnailStyle`.
   - *Lý do:* Giúp các video liên tiếp trong cùng một mẻ render luôn nhận các preset khác nhau rõ rệt, không bị trùng lặp style liền kề.
3. **Chống ghi đè & Path Traversal với `safeContainedPath.ts`:**
   - *Lựa chọn:* Gọi `assertContainedParentDirectory(outputThumbnailPath, root, label)` như một assertion, kết hợp `resolveUniqueThumbnailFilename` để sinh tên `Thumbnail (N).jpg` nếu đã tồn tại file.
   - *Lý do:* Tuân thủ nghiêm ngặt Quy tắc Bất Khả Xâm Phạm số 2 (An toàn đường dẫn tuyệt đối) và ngăn ngừa mất dữ liệu người dùng.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` [src/shared/types.ts](file:///f:/Son/tool/TediaPros/src/shared/types.ts)
- `[MODIFY]` [src/main/autoShortThumbnail.ts](file:///f:/Son/tool/TediaPros/src/main/autoShortThumbnail.ts)
- `[MODIFY]` [src/main/autoShortItemCoordinator.ts](file:///f:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts)
- `[MODIFY]` [src/renderer/src/components/AutoShort.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/AutoShort.tsx)
- `[MODIFY]` [src/renderer/src/components/AutoShortThumbnailModal.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/AutoShortThumbnailModal.tsx)
- `[MODIFY]` [tests/autoshort-thumbnail.test.ts](file:///f:/Son/tool/TediaPros/tests/autoshort-thumbnail.test.ts)

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:
```powershell
cmd.exe /c "npm run typecheck"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-thumbnail.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-item-scope.test autoshort-ocr-pipeline.test"
```

### Kết quả thực tế:
- `Typecheck`: PASS (0 errors trên cả `typecheck:node` và `typecheck:web`).
- `autoshort-thumbnail.test.ts`: PASS (11/11 tests pass, 0 fail).
- `autoshort-item-scope.test.ts` & `autoshort-ocr-pipeline.test.ts`: PASS (12/12 tests pass).
- Các trường hợp kiểm thử mới:
  - `resolveThumbnailStyle`: Đảm bảo style hợp lệ được giữ nguyên, `random` sinh ra preset hợp lệ và phân bổ luân phiên giữa các index.
  - `resolveUniqueThumbnailFilename`: Đảm bảo tên file `Thumbnail.jpg` ban đầu và tự động chuyển sang `Thumbnail (2).jpg` khi tệp đã tồn tại.
  - ASS generation: Kiểm tra đầy đủ 12 preset styles sinh mã màu chính xác.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Khi mở rộng thêm preset trong tương lai, chỉ cần khai báo thêm vào `AutoShortThumbnailStyle` trong `src/shared/types.ts` và bổ sung định nghĩa style tương ứng trong `THUMBNAIL_STYLES` (`src/main/autoShortThumbnail.ts`), UI sẽ tự động đồng bộ.
- File kết quả thumbnail luôn nằm cùng cấp với file video MP4 hoàn thiện với tên chuẩn `Thumbnail.jpg`.
