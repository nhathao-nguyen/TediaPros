# [TASK-20261002-facebook-reels-implementation]: Cải tiến quét danh sách và metadata Facebook Reels

- Trạng thái: Hoàn thành triển khai và kiểm chứng local; chưa xác minh E2E live.
- Người thực hiện: Codex.
- Thời gian: 2026-10-02.
- Plan: `docs/superpowers/plans/2026-10-02-facebook-reels.md`.
- Spec: `docs/facebook-reels-improvement-plan.md`.
- Base: `5cdc777`, branch `SonVersion`.

## 1. Mục tiêu

Triển khai phương án người dùng đã duyệt, tập trung discovery/metadata đúng ID và kết quả đầy đủ/một phần trung thực.

## 2. Tiêu chuẩn nghiệm thu

- [x] Normalize URL và cô lập cookie/proxy theo job.
- [x] Metadata đúng ID, caption đầy đủ; không nhận caption recommendation.
- [x] Tiến trình, dừng, partial reason và checkpoint/continue.
- [x] IPC typed, origin/owner checks và lifecycle cleanup.
- [x] Typecheck và test liên quan pass; full suite được kiểm tra và mọi lỗi được ghi.
- [x] Tài liệu/bản ghi bàn giao được cập nhật.

## 3. Scope

Crawler Facebook Reels và luồng chọn playlist của Downloader; không đổi engine tải, AutoShort hoặc các công cụ của fb-reels.

## 4. Decisions and execution ledger

- Ruling: Thực hiện tại checkout hiện tại vì người dùng đã yêu cầu triển khai tại dự án này, tracked source sạch, chỉ có hai tài liệu nghiên cứu do phiên này tạo. Không tạo worktree/approval bổ sung; bảo toàn chúng và không đổi nhánh hoặc tự commit.
- Ruling: “Triển khai” duyệt phương án đã trình bày; plan kỹ thuật là phân rã phương án đó, không mở lại vòng xin duyệt.
- Pre-flight: Task 1 contract -> Tasks 2/3/4: thống nhất nguồn canonical, ID, summary và metadata status. Task 2 signal -> Task 3 metadata process: cancellation phải xuyên suốt. Task 3 checkpoint -> Task 4 continue: main cấp key; renderer không chỉ định đường dẫn.
- Baseline: full local-runtime suite exit 0: 1107 tests, 1072 pass, 35 skip, 0 fail; log trong TEMP/tediapros-facebook-baseline.log.
- Task 1: complete — URL/schema/contract; RED → GREEN cho URL giả mạo và parser còn thiếu.
- Task 2: complete — observer/controller/fresh session. Regression >250 ID, slow loading, retention budget, cancel cuối lượt, membership scope và proxy/guest cleanup.
- Task 3: complete — checkpoint/owner/metadata/IPC. Account digest đối chiếu session thực và cookie mutex của provider; regression sai context, sai ID, đổi account, concurrent enrich và owner release.
- Task 4: complete — Downloader tiến trình/dừng/tiếp tục, số lượng quét, caption status/tooltip, bổ sung metadata đã chọn; giữ checked khi merge và không render undefined row khi partial rỗng.
- Review: reviewer độc lập `reels_review` xác nhận không còn Important/Critical sau khi sửa findings; repro source trả complete/count=1 và loại recommendation khác owner. Đây là review/repro offline.
- Task 5: complete — full typecheck/build exit 0; full runtime 1136 tests, 1101 pass, 35 skip, 0 fail. Review, ADR/architecture/domain và handoff đã cập nhật. Live limitation được ghi rõ, không tuyên bố đã quét đủ profile.

## 5. Changes

- `[NEW]` `src/shared/facebookReels.ts`: source canonical, typed job/progress/summary/metadata và merge theo ID.
- `[NEW]` `src/main/facebookReels{Account,Parser,Network,Controller,Store,Jobs}.ts`: account binding, scoped data extraction, network lifecycle, partial results, checkpoint và ownership.
- `[MODIFY]` `src/main/facebookReels.ts`: bỏ loop 40/250, dùng session sạch và controller.
- `[MODIFY]` `src/main/ytdlp.ts`: trả description; metadata signal, account verification và process-tree cleanup.
- `[MODIFY]` `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`: typed IPC/progress/guard/shutdown.
- `[MODIFY]` Downloader; `[NEW]` `src/renderer/src/styles/facebookReels.css` và `src/renderer/src/lib/facebookReels.ts`: selection merge/window.
- `[NEW/MODIFY]` 5 Facebook suites và test runner; `[NEW]` ADR 012, cập nhật architecture/domain.

## 6. Verification

Các lệnh đã chạy:

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs facebook-reels-crawler.test facebook-reels-parser.test facebook-reels-lifecycle.test facebook-reels-jobs.test facebook-reels-selection.test
npm.cmd run test:local-runtime
npm.cmd run build
```

- Focused Facebook: 32 test pass (8 crawler, 7 parser, 9 lifecycle, 5 jobs, 3 selection).
- Lượt cuối sau review fixes: typecheck exit 0; build exit 0; full suite exit 0, 1136 tests / 1101 pass / 35 skip / 0 fail. 35 test skip do thiếu managed FFmpeg/runtime, giống baseline; không có failure mới. Log TEMP/tediapros-facebook-{typecheck,build,final}.log.
- Chrome thực đã mở profile `https://www.facebook.com/profile.php?id=61593895532705&sk=reels_tab` (Sandee Viar). Thu được bootstrap và pagination `ProfileCometAppCollectionReelsRendererPaginationQuery` với collection opaque, 10 edge/batch, `profile_reel_node.node.video.id/owner.id`, `message.text`, `page_info.has_next_page`. Schema fixture được tối giản và dùng ID/caption giả; không lưu raw body/cookie/token.
- Người dùng xác nhận đã kết nối Facebook trong TediaPros bằng ảnh; file cookie dev tồn tại (chỉ kiểm tra tên/timestamp, không in nội dung). Tiến trình đang mở là Electron từ repository; chưa xác nhận nó đã nạp build mới.
- Script Electron live phụ bị automatic approval review chặn với thông báo `blocked by policy`; không chạy script đó. Chưa kiểm chứng E2E live bản mới, tổng Reel thực tế, hoặc metadata của toàn bộ profile.
- Giới hạn: quét 120 giây/lượt, 10.000 ID; hết giới hạn trả partial. Tiếp tục mở lại profile và deduplicate, không resume/replay cursor. Không caption thật thì giữ missing/error; enrichment 60 giây/lượt và chỉ các ID đã chọn.

## 7. Handoff

Khởi động lại bản source/build mới, giữ bật “Dùng tài khoản này” của Facebook và dán profile đã cung cấp. Để trống số Reel để quét đến hết trong giới hạn; xem lý do partial và dùng “Quét tiếp” nếu còn checkpoint. Không đổi nhánh/commit, không package/install, LICENSE/NOTICE không thay đổi. Bản đang mở trước sửa không phải bằng chứng của mã mới.
