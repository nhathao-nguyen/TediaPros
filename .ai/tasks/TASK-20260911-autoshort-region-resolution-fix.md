# TASK-20260911-autoshort-region-resolution-fix: Ổn định khung Auto Short giữa các độ phân giải

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

---

## 1. Mục Tiêu (Goal)

Sửa lỗi khung phụ đề, vùng OCR, vùng blur và cỡ chữ thay đổi vị trí/kích thước khi chuyển giữa video 1080×1920 và 2160×3840 trong cùng batch Auto Short.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Ba loại vùng giữ cùng vị trí và kích thước tương đối khi đổi độ phân giải.
- [x] Font thủ công và viền giữ tỷ lệ ổn định, có migration một lần cho giá trị pixel cũ.
- [x] Payload batch không phụ thuộc video đang chọn; STTN dùng snapshot đúng file và vùng OCR.
- [x] Metadata cũ không được dùng để chỉnh vùng của nguồn mới; thao tác kéo bị hủy khi đổi nguồn.
- [x] Typecheck, test liên quan, build và diff check đều pass.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** state hình học trong AutoShort renderer, helper normalized/pixel, migration font/viền, payload batch/STTN, regression và tài liệu.
- **Nằm ngoài phạm vi:** thuật toán OCR/STTN/FFmpeg, bố cục riêng cho từng item, batch live 42 video và provider trả phí.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- State renderer dùng `AutoShortNormalizedRegion` / `AutoShortBlurRegion` làm nguồn dữ liệu chính. Pixel chỉ tồn tại ở biên `RegionBox`.
- Backend giữ nguyên vì đã chiếu normalized region theo display geometry của từng item.
- Font và viền dùng chiều cao tham chiếu 1920; trường scale là dữ liệu có hiệu lực, trường pixel legacy vẫn được gửi trong giới hạn hợp đồng.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/renderer/src/components/AutoShort.tsx`
- `[NEW]` `src/shared/autoShortRegionGeometry.ts`
- `[NEW]` `tests/autoshort-region-geometry.test.ts`
- `[NEW]` `scripts/test-autoshort-region-resolution.mjs`
- `[MODIFY]` `scripts/run-local-runtime-tests.mjs`
- `[MODIFY]` `docs/project-atlas/modules/autoshort.md`
- `[MODIFY]` `docs/plans/2026-09-11-autoshort-region-resolution-fix.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Acceptance Electron tổng hợp và media thật lưu tại:

- `docs/reviews/2026-09-11-region-resolution/`
- `docs/reviews/2026-09-11-region-resolution-real-media/`

Hai file media thật chỉ được đọc trong profile test; không xuất batch và không ghi đè nguồn.

Các lệnh đã chạy từ repo root:

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-region-geometry.test autoshort-ui-contract.test autoshort-ocr-contract.test canonical-display-geometry.test video-adjustments.test portrait-blur.test autoshort-ocr-pipeline.test sttn-contract.test sttn-pipeline.test
$env:PATH = (Join-Path $env:APPDATA 'tedia-pros\bin\ffmpeg') + ';' + $env:PATH
npm.cmd run test:subtitles
npm.cmd run build
node scripts/test-autoshort-region-resolution.mjs docs/reviews/2026-09-11-region-resolution
node scripts/test-autoshort-region-resolution.mjs docs/reviews/2026-09-11-region-resolution-real-media <video-1080x1920> <video-2160x3840>
git diff --check
```

Kết quả thực tế:

- `typecheck`: PASS, node và web đều 0 lỗi.
- 9 suite liên quan: PASS, gồm geometry, UI contract, OCR contract/pipeline, portrait, video adjustments và STTN.
- `test:subtitles`: PASS; FFmpeg thực thi thật với số frame standard/reveal/highlight lần lượt 2/10/24.
- `build`: PASS; main, preload và renderer đều build thành công. Các cảnh báo chunk import đã tồn tại và không làm build thất bại.
- Acceptance Electron tổng hợp: PASS cho A → B → A, migration font/viền và hai payload batch giống nhau.
- Acceptance bằng hai video thật 1080×1920 / 2160×3840: PASS; sai số tọa độ quan sát dưới 0,1%, payload normalized giống nhau.
- `git diff --check`: PASS.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Nếu cần bố cục khác nhau theo nội dung của từng clip, cần thiết kế cấu hình per-item riêng; bản sửa này giữ đúng một bố cục chung cho cả batch.
