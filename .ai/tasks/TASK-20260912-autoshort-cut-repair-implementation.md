# TASK-20260912-AUTOSHORT-CUT-REPAIR: Sửa toàn bộ Cắt đoạn AutoShort

- **Trạng thái:** Đã kiểm chứng trên Windows local — 12 findings của đường cắt thủ công đã có biện pháp chặn/sửa và regression; các extension editor nâng cao trong planning vẫn được ghi riêng, không được tính là production/macOS.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-12.
- **Nhánh/worktree:** `codex/autoshort-cut-repair` tại `.worktrees/codex-autoshort-cut-repair`.

## 1. Mục Tiêu

Sửa 12 findings của review trên đường cắt thủ công AutoShort. Giữ cắt trong AutoShort, bảo vệ source/output, đồng bộ media, chặn mối nối mơ hồ và giữ video đủ lớn khi mở công cụ.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] 12/12 findings có regression hoặc fail-closed guard và evidence local.
- [ ] R01–R18 của spec mở rộng chưa được tuyên bố đạt toàn bộ: frame-step/waveform, preset batch, edit-store CAS riêng, review fragment tương tác và installed/macOS matrix còn ngoài implementation đã kiểm chứng này.
- [x] P00: cut execution chưa verified bị Main chặn trước journal/model; no-cut vẫn được cho phép.
- [x] Z gate: cờ Main chỉ được mở sau actual-media validator và coordinator integration pass.
- [x] A01–A03, B01–B04, seam guard C01, STTN cut preview C04 và validator/publication audit C05 đạt trong đường chạy hiện hành.
- [x] Typecheck, full local-runtime, build, browser UI harness và actual Electron dev startup đạt trên Windows local.

## 3. Phạm Vi

- Trong phạm vi: Core cắt ripple-delete trong AutoShort, migration, UI/preview, media/pipeline/publication.
- Ngoài phạm vi: hold-frame và suggestions Extension A/B, cài WinLocal, push remote.
- Dirty work ở checkout `main` không được mang vào hoặc sửa đè.

## 4. Quyết Định

- Dùng worktree riêng từ `0d7fa21`; plans/review được sao chép theo allowlist và đối chiếu SHA-256.
- P00 thêm authoritative Main guard với readiness state. Chỉ Z01 được bật execution sau đủ gates.
- Mỗi task dùng TDD và commit theo path allowlist; không dùng test chuỗi đơn thuần để chứng minh media/UI.

## 5. Tệp Thay Đổi

- P00 `[NEW]` `src/main/autoShortCutCapability.ts`, `tests/autoshort-cut-capability.test.ts`.
- P00 `[MODIFY]` `src/main/autoshort.ts`, `src/shared/types.ts`, `scripts/run-local-runtime-tests.mjs`.
- A01 `[NEW]` `src/shared/autoShortCutEditor.ts`, `tests/autoshort-cut-editor.test.ts`.
- A01 `[MODIFY]` `AutoShortCutPanel.tsx`, `AutoShort.tsx`, `autoshort.css`, test runner.
- A02 `[NEW]` `src/shared/autoShortCutContract.ts`, `tests/autoshort-cut-v2-contract.test.ts`.
- A02 `[MODIFY]` editor helpers, v1 keep IDs, queue union/validation và executor narrowing.
- A03 `[NEW]` `src/main/autoShortCutIdentity.ts`, `tests/autoshort-cut-legacy-resume.test.ts`.
- A03 `[MODIFY]` resume item digest và checkpoint fingerprint lookup no-cut.
- B01–B04 `[NEW]` `src/main/autoShortFrameIndex.ts`, `src/shared/autoShortCutPlan.ts`, `src/main/autoShortCutPreparation.ts` và bốn test frame/plan/resource/cache.
- B01–B04 `[MODIFY]` frame-aware cut executor, coordinator, cut contract, semantic identity và test runner.
- Các task tiếp theo được bổ sung vào đây theo từng gate.

## 6. Kiểm Chứng

Baseline worktree: `npm.cmd install`; `npm.cmd run typecheck` PASS; 23 scoped tests PASS.

P00 red: `autoshort-cut-capability.test` không resolve module trước implementation. Green: 3 pass, 0 fail. `npm.cmd run typecheck` PASS Node/Web.

A01 red: parser chưa tồn tại. Green: 2 pass, 0 fail; `npm.cmd run typecheck` PASS. Browser harness ở panel 696×596 xác nhận stage cao 277px khi mở cut (trước review: 24px), panel nằm dưới transport; nhập trống hiện lỗi và không tạo edit. Sửa cut khi đang có resume snapshot chuyển về draft/run mới bằng cách xóa snapshot cũ.

A02 red: v2 contract chưa tồn tại. Green: 11 editor/v2/v1 contract tests PASS; mở rộng cùng capability/batch suites thành 19 tests PASS. `npm.cmd run typecheck` PASS. Schema v2 kiểm strict/2 MiB/1.000 raw ranges/ID trùng; history cap 200 và giữ raw operations; v1 keep segment IDs ổn định theo boundaries.

A03 red: compatibility module chưa tồn tại. Green: 11 legacy-resume/batch/stage/store tests PASS; `npm.cmd run typecheck` PASS. Resume no-cut chỉ chấp nhận hai digest đã biết; cut job vẫn chỉ nhận exact digest. Checkpoint no-cut thử đúng current + legacy fingerprint; cut checkpoint không được nới.

B01–B04 red: thiếu frame-index/compiler/cache helpers; managed FFmpeg 9 bác option `filter_complex_script`; executor frame-plan chưa tồn tại. Green: rational boundary/compiler, semantic identity, multi-volume ownership và actual FFmpeg media tests PASS. Fixture 64×64 25fps/6s, `yuv420p10le`, PCM 48kHz có audio epoch +0,5s; xóa frame [50,100) tạo đúng 100 frame, đúng 4 giây/192.000 sample và giữ khoảng im lặng 0,5s đầu. Fixture 100fps/260 frame với 130 keep segments chạy qua 3 chunk giới hạn 64; regression đã bắt lỗi FFmpeg làm rơi còn 6 frame và xác nhận sửa `fps_mode=passthrough` cho đủ 130 frame. Validator độc lập full-decode video/audio, so số frame/sample, source hash trước/sau và artifact SHA-256 trước downstream. PCM policy giữ u8/s16/s24/s32/float32/float64 theo probe nguồn. Disk admission áp dụng cả maxActiveItems=1 và 2, giữ composite ownership cho scratch/output/cache theo physical volume và rollback nếu reserve sau thất bại. `npm.cmd run typecheck` PASS.

A05 UI pass bổ sung: ở harness 696×596, header giảm từ 132px xuống 77px, stage 227px, tools 242px và không overflow khi chưa có range. Timeline kept/removed + playhead, clocks nguồn/còn lại, undo/redo, restore từng đoạn/tất cả và tùy chọn bỏ qua vùng cắt khi xem đã nối. Thêm range 5.250–8.750 cập nhật còn 31.500s; undo khôi phục null và bật redo trong browser smoke.

Pipeline/gate: integration dùng source FFV1+PCM thật 6s, bỏ [2,4), coordinator gửi đúng prepared media 100 frame cho cả ASR stub và renderer stub; `cut-validation.json` được publish trong audit. Journal chấp nhận và phục hồi edit exact-frame v2 qua atomic store. Capability mặc định Main đã chuyển sang execution=true sau 4 capability tests, pipeline test, batch/store/resume, disk/queue và typecheck đều PASS.

F06 fail-closed: cue ASR 1.800–2.200 giây đi qua hard join 2.000 giây trả `CUT_SEAM_REVIEW_REQUIRED` trước translation/TTS/render. Integration xác nhận renderer không được gọi. Boundary đúng tại 2.000 được chấp nhận.

F12 preview: checkbox trong video player được ghi là xem nhanh; UI nói rõ export sẽ snap theo frame. STTN preview nhận `temporalEdit`, dùng chính frame planner/executor/validator production rồi mới cắt preview/OCR/STTN. Fixture media thật 6s/150 frame bỏ [2,4) xác nhận input preview là master 4s/100 frame.

Final verification trên commit `7eb9575` và thay đổi docs sau commit:

- `npm.cmd run typecheck`: PASS, Node và Web không lỗi.
- `npm.cmd run test:local-runtime` với managed FFmpeg 9.0.1: exit 0; toàn runner PASS, test real FFmpeg dubbing-map vốn được đánh dấu skip vẫn giữ nguyên.
- Scoped media/preview: `sttn-pipeline.test` 11/11 PASS; `autoshort-cut-pipeline.test` 2/2 PASS; `autoshort-cut-cues.test` 2/2 PASS.
- `npm.cmd run build`: PASS; cảnh báo Vite dynamic import hiện hữu không làm build fail.
- `npm.cmd run dev`: Electron dev mở URL `http://localhost:5173/`, process/window `TediaPros`, FFmpeg và GPU probe sẵn sàng; session đã dừng sau smoke. Chromium có một log `Unsupported pixel format: -1`, chưa thấy làm app dừng.
- Browser harness 696×596 kiểm layout và interactions; đây không phải ảnh Electron native. Live provider, real OCR/STTN output quality, installed build, macOS, HDR/VFR rộng và DPI matrix chưa được kiểm chứng.

Các cảnh báo audit dependency của `npm install` là trạng thái dependency hiện tại, không tự chạy `npm audit fix` ngoài phạm vi.

## 7. Bàn Giao

Branch sẵn sàng để review/merge phạm vi đã kiểm chứng. Không gọi đây là full R01–R18 hoặc production acceptance; các mục editor nâng cao còn lại nằm trong planning đã lưu và cần một đợt sản phẩm riêng nếu vẫn muốn giữ đúng spec mở rộng ban đầu.
