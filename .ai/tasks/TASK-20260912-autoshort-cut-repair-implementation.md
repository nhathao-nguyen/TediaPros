# TASK-20260912-AUTOSHORT-CUT-REPAIR: Sửa toàn bộ Cắt đoạn AutoShort

- **Trạng thái:** Đang làm — P00 đã kiểm chứng, A01 đang triển khai.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-12.
- **Nhánh/worktree:** `codex/autoshort-cut-repair` tại `.worktrees/codex-autoshort-cut-repair`.

## 1. Mục Tiêu

Sửa 12 findings của review và hoàn thành R01–R18 Core theo spec/plan. Giữ cắt trong AutoShort, bảo vệ source/output, đồng bộ media và làm UI đủ để kiểm tra bản cắt trước chạy.

## 2. Tiêu Chuẩn Nghiệm Thu

- [ ] 12/12 findings có regression và evidence đóng.
- [ ] 18/18 Core requirements có outcome đạt.
- [x] P00: cut execution chưa verified bị Main chặn trước journal/model; no-cut vẫn được cho phép.
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
- Các task tiếp theo được bổ sung vào đây theo từng gate.

## 6. Kiểm Chứng

Baseline worktree: `npm.cmd install`; `npm.cmd run typecheck` PASS; 23 scoped tests PASS.

P00 red: `autoshort-cut-capability.test` không resolve module trước implementation. Green: 3 pass, 0 fail. `npm.cmd run typecheck` PASS Node/Web.

Các cảnh báo audit dependency của `npm install` là trạng thái dependency hiện tại, không tự chạy `npm audit fix` ngoài phạm vi.

## 7. Bàn Giao

Tiếp theo A01: sửa grid khiến preview 414→24px và parser đang hiểu input trống là 0. Guard chưa phải fix engine; feature execution vẫn cố ý đóng trong branch cho tới Z01.
