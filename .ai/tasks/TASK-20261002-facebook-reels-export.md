# TASK-20261002-FACEBOOK-REELS-EXPORT: Xuất caption, bài viết website, Excel và MP4

- **Trạng thái:** Đã triển khai, đã kiểm chứng local và website thực; chưa nghiệm thu end-to-end toàn bộ Facebook trong app.
- **Người thực hiện:** Codex; review đọc độc lập `reels_export_review`.
- **Thời gian:** 2026-10-02.

## 1. Mục tiêu

Theo yêu cầu bổ sung, TediaPros xuất bộ file như fb-reels và thêm TXT chứa nội dung website được dẫn trong Reel. Giữ caption riêng, đúng Reel ID, dùng phiên đăng nhập Facebook sẵn có khi được bật. Cải thiện discovery đang dừng ở28 như screenshot mà không báo đủ sai.

## 2. Tiêu chuẩn nghiệm thu

- [x] Có root output, MP4 toggle, export selected/range, progress/cancel, counters và bảng mở file.
- [x] Link từ caption/ranges/bình luận creator đúng associated_video; không nhận foreign owner/recommendation kể cả response đến trước DOM.
- [x] Website HTML public được tách thành TXT; caption TXT, XLSX và video dùng cùng STT/ID trong thư mục lượt riêng.
- [x] HTTP/DNS/redirect/resource limits, containment và typed IPC owner/account guards; lỗi từng bước có status riêng.
- [x] `npm run typecheck` pass; test liên quan và build pass; docs/ADR cập nhật.
- [ ] Quét xác nhận hết profile61593895532705 và tải/xuất cả batch thật qua giao diện app.

## 3. Phạm vi

Quét và xuất Downloader/Facebook. Giữ hàng đợi tải thông thường. Không thay AutoShort/Dubbing, không sửa LICENSE/NOTICE, không commit/merge hay tạo installer. Giữ dirty workspace SonVersion/HEAD5cdc777 và toàn bộ phần triển khai Reels trước đó.

## 4. Quyết định

Electron session riêng theo lượt và owner/account digest của job. Reader website không dùng Facebook cookies, không chạy JS/resources; DNS pin và kiểm tra từng redirect. Chọn Readability0.6/jsdom26.1 tương thích runtime hiện tại; ExcelJS4.4 ghi XLSX. Full text giữ trong TXT, preview/Excel bị giới hạn ô32767ký tự. Download nhận signal và kiểm tra account trong cookie mutex; export dùng định dạng MP4 sẵn có.

Review đã sửa4nhóm vấn đề: mất owner numeric khi source là slug, bỏ dữ liệu khi navigation chậm, lookup failure bị ghi no-link, foreign recommendation vẫn tồn tại qua DOM/response race. Mỗi lỗi có kiểm thử RED→GREEN. Ruling và tiến trình ở `docs/superpowers/plans/2026-10-02-facebook-reels-export.md`.

## 5. Tệp thay đổi

- Mới: `src/shared/facebookArticleLinks.ts`; `src/main/facebookArticle.ts`, `facebookReelDetails.ts`, `facebookReelsExporter.ts`, `facebookReelsExportPipeline.ts`; `FacebookReelsExportResults.tsx`; tests export/details; script verify article; docs hướng dẫn.
- Sửa: shared Reels contract, parser/network/controller/store/jobs/browser; downloader native signal/account; index/preload IPC; Downloader/CSS; test runner và regression tests; package/lock.
- Docs: architecture/domain, ADR012, improvement plan và implementation plan.

## 6. Kiểm chứng và bằng chứng

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:local-runtime
node scripts/run-local-runtime-tests.mjs facebook-reels-lifecycle.test facebook-reels-parser.test
node scripts/verify-facebook-reels-article.mjs <URL bài viết thực> <root kết quả> 936934766124971
git diff --check
```

- Final typecheck/build exit0.
- Full suite:1153tests,1118pass,35skip,0fail. Các skip runtime/FFmpeg đã có từ baseline;49Facebooktests pass.
- Logs: `%TEMP%/tediapros-reels-export-{typecheck,build,suite}.log`, `%TEMP%/tediapros-reels-article-live.log`.
- Live Chrome: link tác giả trên Reel936934766124971 trỏ tới bài `votera.treeiq.biz/blog/the-grand-entrance-hall-of-the-moretti-townhouse-smelled-of-floor-wax-polished-mahogany-and-an-underlying-scent-that-i-recognized-all-too-well-from-hospital-corridors-stale-grief-btydgm`.
- Native article reader:6623characters/32paragraphs; TXT/XLSX/JSON viết thành công tại `%TEMP%/tediapros-reels-article-proof/facebook-reels_2026-10-02T03-36-27-433Z_fd3cfa6c/`. Caption là nhãn kiểm tra, MP4 tắt: đây chỉ là bằng chứng reader/writer, không phải Facebook pipeline end-to-end.
- npm audit: repository hiện có advisory nền; ExcelJS kéo uuid advisory moderate trong phần tạo workbook IDs, không dùng cho account/job authentication (job dùng node:crypto). Không chạy audit fix lan rộng.

## 7. Bàn giao

Mở lại TediaPros để nạp main/IPC mới từ `out/`, dán profile, chọn khoảng và nút export. Hướng dẫn `docs/facebook-reels-export.md`. Không tự đóng app đang chạy vì chưa biết có công việc khác trong UI.

Chưa kiểm chứng app live vì tool native UI không khả dụng và lần trước helper Electron thử nghiệm bị automatic approval review từ chối (`blocked by policy`); không lặp lại đường thực thi bị từ chối. Chỉ chạy kiểm tra website public không dùng cookie qua script developer đã lưu. Screenshot28không chứng minh đủ: bootstrap ban đầu còn has_next_page=true. Hai lỗi code có test đã sửa là chỉ đọc30bootstrap đầu và cuộn thẳng bottom/sai container; chưa khẳng định đã giải quyết mọi nguyên nhân body CDP không đọc được trên Facebook thật.
