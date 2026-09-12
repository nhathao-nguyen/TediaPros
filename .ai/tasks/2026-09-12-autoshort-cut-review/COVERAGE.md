# FILE_INVENTORY / COVERAGE

Baseline: `0d7fa21b911f1eb540140999f5c51dead6141c78`, so với parent. 20/20 tệp trong commit đã được review diff/code hoặc nội dung tài liệu. Không có nghĩa đã thực thi mọi nhánh của từng tệp. Các path trong bảng là định danh repository tại baseline, không phải hyperlink đến checkout đang thay đổi.

| Tệp trong commit | Phạm vi kiểm | Kết quả/liên hệ REVIEW.md |
|---|---|---|
| `.ai/tasks/TASK-20260912-autoshort-temporal-cut-implementation.md` | Đối chiếu claims, checks và evidence | Thu hẹp Core; sync/resume/lossless/disk claims quá rộng |
| `.ai/tasks/TASK-20260912-autoshort-temporal-cut-planning.md` | Scope và hướng dẫn bàn giao plan | T01–T11 là Core, frame/preview/undo không phải extension |
| `docs/architecture.md` | Hunk cắt media và diagram | Disk/“lossless” cần điều chỉnh sau sửa |
| `docs/superpowers/plans/2026-09-12-autoshort-temporal-cut.md` | T01–T14, gate Core và matrix | Thiếu nhiều gate T03–T11 |
| `docs/superpowers/specs/2026-09-12-autoshort-temporal-cut-design.md` | R01–R19, invariants và phased scope | Trạng thái Core MVP không tương đương Core đạt |
| `scripts/run-local-runtime-tests.mjs` | Đăng ký hai suite, cách chạy scoped | Đã đăng ký; 5 suite được chạy lại lúc review |
| `src/main/autoShortCutMedia.ts` | Toàn bộ executor, filter và lifecycle call | F01/F08/F09; real FFmpeg fixtures |
| `src/main/autoShortItemCoordinator.ts` | Mọi hunk thay source path/meta/digest; call sites, cache, cleanup | F01/F05/F06/F07; không gọi provider thật |
| `src/main/autoshort.ts` | Journal/digest/fingerprint/resume; scope/admission | F02/F03/F05; legacy digest probe |
| `src/renderer/src/components/AutoShort.tsx` | State, load journal, start/resume payload, panel placement, preview | F03/F04/F12; không chạy full Electron |
| `src/renderer/src/components/AutoShortCutPanel.tsx` | Component, validation, restore | F10/F11; browser tương tác nhập/xóa/khôi phục |
| `src/renderer/src/styles/autoshort.css` | Hunk cut panel và parent grid liên quan | F04; ảnh người dùng + harness đo layout |
| `src/shared/autoShortBatchJournal.ts` | Validator/schema optional edit | F02/F03; unit journal recovery |
| `src/shared/autoShortContract.ts` | Validate temporal edit tại Start | Có normalize Main; frame/duration validation nằm sau probe |
| `src/shared/autoShortTemporalEdit.ts` | Toàn bộ normalize/compile/map | F01/F08/F11; pure probes và unit tests |
| `src/shared/types.ts` | Queue input + task edit typing | Typed extension dùng lại Start API |
| `tests/autoshort-batch-resume.test.ts` | Tất cả thay đổi test | PASS; không chứng minh migration/resume production |
| `tests/autoshort-cut-media.test.ts` | Toàn bộ 2 tests | PASS; chỉ string assertions, chưa có frame/audio oracle |
| `tests/autoshort-stage-cache.test.ts` | Hunk edit fingerprint | PASS; không kiểm legacy identity hoặc repeated preparation |
| `tests/autoshort-temporal-edit-contract.test.ts` | Toàn bộ 3 tests | PASS; thiếu ID/history/subframe/real timestamp cases |

Các tệp ngoài commit được đọc có mục tiêu: root/shared/renderer AGENTS, architecture/domain, `editor.css`, `autoShortDiskBudget.ts`, `autoShortStageKeys.ts`, FFmpeg narrated-audio/process wrapper và các đường preview/resource/retime liên quan. Đây là kiểm tra call path cần cho findings, không phải review toàn bộ engine/provider/security của repository.

## Bằng chứng UI

| Tệp | Nguồn | Đã xem | Điều chứng minh |
|---|---|---|---|
| `01-user-closed.png` | Ảnh người dùng cung cấp, sao chép nguyên bản | Có | UI có video khi đóng panel |
| `02-user-open.png` | Ảnh người dùng cung cấp, sao chép nguyên bản | Có | UI thực tế mất phần lớn vùng video |
| `03-harness-closed.png` | Browser harness commit cố định | Có | Stage ban đầu trong shell đo layout |
| `04-harness-open.png` | Browser harness commit cố định | Có | Cut panel nhận hàng co giãn |
| `05-harness-empty-start.png` | Browser harness, actual component | Có | Blank-start đã áp dụng `[0,3)` |
| `06-harness-overlap.png` | Browser harness, actual component | Có, lúc capture | Hai thao tác thành một union `[1,4)` |
| `ui-empty-start.txt`, `ui-overlap.txt`, `ui-restored.txt` | Accessibility state sau thao tác | Có | Edit payload trong shell; restore về null |

Không thêm screenshot mockup thiết kế mới. Không chỉnh sửa nội dung ảnh nguồn hoặc dùng ảnh harness như ảnh Electron thật.
