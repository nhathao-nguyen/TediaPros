# TASK-20260912-AUTOSHORT-CUT-REPAIR: Sửa toàn bộ Cắt đoạn AutoShort

- **Trạng thái:** Đang làm — editor/media/pipeline Core đã kiểm chứng và Main execution gate đã mở; còn full-suite/build/app smoke trước bàn giao.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-12.
- **Nhánh/worktree:** `codex/autoshort-cut-repair` tại `.worktrees/codex-autoshort-cut-repair`.

## 1. Mục Tiêu

Sửa 12 findings của review và hoàn thành R01–R18 Core theo spec/plan. Giữ cắt trong AutoShort, bảo vệ source/output, đồng bộ media và làm UI đủ để kiểm tra bản cắt trước chạy.

## 2. Tiêu Chuẩn Nghiệm Thu

- [ ] 12/12 findings có regression và evidence đóng.
- [ ] 18/18 Core requirements có outcome đạt.
- [x] P00: cut execution chưa verified bị Main chặn trước journal/model; no-cut vẫn được cho phép.
- [x] Z gate: cờ Main chỉ được mở sau actual-media validator và coordinator integration pass.
- [ ] A01–A05, B01–B04, C01–C05, Z01 hoàn tất theo plan.
- [ ] Typecheck/full relevant tests/build và actual Electron/media matrix đạt theo Z01.

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

Các cảnh báo audit dependency của `npm install` là trạng thái dependency hiện tại, không tự chạy `npm audit fix` ngoài phạm vi.

## 7. Bàn Giao

Tiếp theo: chạy toàn bộ local-runtime, build và actual Electron smoke bằng test profile. Live provider/real OCR/STTN vẫn phải được ghi đúng là chưa kiểm chứng nếu runtime không có trong môi trường smoke.
