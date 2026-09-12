# TASK-20260911: Triển khai tự đặt phụ đề Auto Short theo OCR

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

---

## 1. Mục Tiêu (Goal)

Tái sử dụng visual OCR timeline của từng video để đặt phụ đề đầu ra vào vùng chữ xuất hiện thường xuyên và có kích thước điển hình lớn, trong đúng ROI OCR do người dùng chọn. Khi bằng chứng OCR không đủ rõ, giữ vị trí phụ đề thủ công làm dự phòng.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Không quét toàn khung, không mở rộng ROI và không gọi OCR lần hai cho placement.
- [x] Quyết định riêng cho từng item; vùng thắng phải đồng thời gần cực đại về độ phủ và chiều cao chữ.
- [x] Loại chữ cố định bằng yêu cầu có ít nhất hai trạng thái text; có fallback rõ cho dữ liệu yếu, xung đột và mơ hồ.
- [x] Toggle chỉ có trong Auto Short; cấu hình cũ mặc định `manual`.
- [x] Blur/STTN hoàn tất trước khi burn ASS; audit không ghi nội dung OCR.
- [x] Typecheck, build, full local-runtime suite và các test OCR/phụ đề liên quan đều pass.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** Auto Short, typed config, heuristic placement thuần TypeScript, coordinator, audit, UI, test và tài liệu.
- **Nằm ngoài phạm vi:** Video Editor, OCR toàn khung tự động, model/dịch vụ mới, thay cỡ font theo OCR, thay cue/timestamp, đánh giá chất lượng trên 100 video thật.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Dùng `visualResultForAudit.timeline` đã có sau visual branch để tránh thêm lượt OCR.
- Khóa không gian tìm kiếm bằng `timeline.scanRegion`; box ngoài ROI bị cắt bỏ hoặc loại.
- Mỗi track cần coverage >= 0,25, confidence >= 0,75 và hai trạng thái text tồn tại ít nhất 0,5 giây.
- Một vùng chỉ thắng khi đạt ít nhất 90% cả coverage lớn nhất và chiều cao điển hình lớn nhất. Không có đúng một vùng thắng thì dùng `subRegion` dự phòng.
- Region đầu ra dùng envelope phân vị 5/95, padding 0,5 chiều cao dòng, giữ kích thước fallback khi ROI cho phép và không bao giờ vượt ROI.
- Text chuẩn hóa phục vụ so sánh được giới hạn 256 ký tự và tối đa 32 trạng thái mỗi track để chặn chi phí edit-distance không giới hạn.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/shared/autoShortSubtitlePlacement.ts`
- `[MODIFY]` `src/shared/types.ts`
- `[MODIFY]` `src/shared/autoShortContract.ts`
- `[MODIFY]` `src/main/autoShortItemCoordinator.ts`
- `[MODIFY]` `src/main/autoShortAudit.ts`
- `[MODIFY]` `src/renderer/src/components/AutoShort.tsx`
- `[NEW]` `tests/autoshort-subtitle-placement.test.ts`
- `[MODIFY]` `tests/autoshort-ocr-contract.test.ts`
- `[MODIFY]` `tests/autoshort-ocr-pipeline.test.ts`
- `[MODIFY]` `scripts/run-local-runtime-tests.mjs`
- `[NEW]` `scripts/test-autoshort-ocr-placement.mjs`
- `[MODIFY]` `docs/domain.md`
- `[MODIFY]` `docs/project-atlas/modules/autoshort.md`

Các tệp có dấu `MODIFY` đang chứa một số thay đổi chưa commit từ công việc khác. Implementation chỉ thêm các hunk placement và không reset hoặc ghi đè phần việc đó.

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:local-runtime
node scripts/run-local-runtime-tests.mjs autoshort-subtitle-placement.test autoshort-ocr-contract.test autoshort-ocr-pipeline.test autoshort-ocr-burn.test ocr-visual-timeline.test autoshort-region-geometry.test
node scripts/test-autoshort-ocr-placement.mjs
npm.cmd run test:subtitles
git diff --check
```

- `typecheck:node` và `typecheck:web`: PASS, exit 0.
- Build Electron/Vite: PASS, exit 0; chỉ có warning import động/tĩnh đã tồn tại.
- Full `test:local-runtime`: PASS, exit 0.
- Placement/contract/pipeline/burn/timeline/geometry: lần lượt 7/7, 14/14, 12/12, 10/10, 10/10 và 4/4; 0 fail.
- UI harness trên component thật: PASS; request chuyển `ocr-dominant` sang `manual` khi rời OCR-auto/STTN, ROI giữ nguyên và lựa chọn auto vẫn được lưu.
- `test:subtitles`: logic PASS; smoke render bị skip vì FFmpeg không có trong `PATH`. Pipeline OCR integration đã dùng FFmpeg nhúng và render thực tế thành công.
- `git diff --check`: PASS; có warning line ending ở `src/main/dubbing/synthesis.ts`, thuộc thay đổi khác.

### Bằng chứng giới hạn

- TEST_CONFIRMED: logic AND, lọc logo cố định, fallback, ROI, tương thích manual, 100 quyết định item synthetic, request UI, coordinator và thứ tự render.
- UNKNOWN: độ chính xác placement trên 100 video thật có OCR nhiễu và bố cục đa dạng. Cần lấy mẫu 6–10 clip thực tế trước khi điều chỉnh ngưỡng.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Nhánh `codex/autoshort-duration-recovery` là normal worktree và đang có nhiều thay đổi chưa commit ngoài phạm vi task. Chưa commit, merge hoặc push. Khi tích hợp, chỉ stage các hunk/tệp thuộc placement hoặc tách chúng khỏi các thay đổi đang chồng trong cùng file.
