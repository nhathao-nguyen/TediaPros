# TASK-20261002-facebook-reels-library: Thư viện kênh Reels và chống tải trùng

- **Trạng thái:** Đã kiểm chứng cục bộ
- **Người thực hiện:** Codex; reviewer review_reels_library
- **Thời gian:** 2026-10-02

## 1. Mục Tiêu (Goal)

Thêm quản lý thư mục, hiển thị kênh đã tải, lấy video mới và chống tải trùng theo mẫu Douyin vào vùng Tải xuống của Reels.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Thư viện kênh lưu lâu dài, tự ghi nhận sau video thành công, có số video/ngày/thư mục.
- [x] Mở/đổi thư mục, bỏ theo dõi không xóa video; nhập thư mục video cũ theo ID.
- [x] Lấy mới và quét tiếp lọc ID còn video trên đĩa; giữ trạng thái quét chưa đầy đủ.
- [x] Chống trùng ở main theo ID, khóa các yêu cầu đồng thời; lỗi không ghi nhận thành công; file mất cho tải lại.
- [x] Xuất tái sử dụng video, chuyển container khác sang MP4 cục bộ và ghi nhận bản sao; không đổi thư mục/tên kênh do người dùng chọn.
- [x] Typecheck node/web và build pass; 78 test liên quan pass.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

Thư viện Main/IPC/typed preload, Downloader, component thư viện, CSS, luồng tải yt-dlp và tái sử dụng video trong xuất Reels. Bảo toàn các dirty/untracked thay đổi Reels có trước nhiệm vụ. Không thay đổi engine Douyin, không đóng gói/cài installer hoặc tuyên bố tải Facebook thật đã pass.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

Thêm kho JSON ghi nguyên tử riêng trong userData; dùng URL profile chuẩn hóa làm khóa kênh và Reel ID làm khóa video. Lưu các đường dẫn bản sao, chỉ bỏ qua khi còn regular file không rỗng trong root đã ghi nhận. Ghi nhận tự động không ghi đè thư mục/tên kênh đã chọn. Các lượt chờ trùng có thể hủy ngay nhưng khóa vẫn tồn tại đến khi lượt gốc kết thúc, ngăn lượt thứ ba tải trùng. Kiểm tra đường dẫn qua safeContainedPath, không đọc/ghi theo symlink.

Reviewer phát hiện và đã sửa lỗi xuất làm đổi folder, hủy chờ không thoát ngay, giữ nhầm container khi xuất MP4, nhập ID nhầm ngày, và mất chống trùng khi bản gốc bị xóa dù bản xuất vẫn còn. Các lỗi này có regression tests.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- [NEW] src/main/facebookReelsLibrary.ts, facebookReelsLibraryRuntime.ts, facebookReelsReuse.ts.
- [NEW] src/renderer/src/components/FacebookReelsLibrary.tsx; tests/facebook-reels-library.test.ts.
- [MODIFY] src/main/ytdlp.ts, index.ts, facebookReelsExportPipeline.ts; src/preload/index.ts; src/shared/types.ts, facebookReels.ts.
- [MODIFY] Downloader.tsx, styles/facebookReels.css; tests/fixtures/facebook-reels-ui.tsx; scripts/run-local-runtime-tests.mjs.
- [MODIFY] docs/facebook-reels-export.md, docs/domain.md.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

```powershell
node scripts/run-local-runtime-tests.mjs facebook-reels-library.test facebook-reels-jobs.test facebook-reels-selection.test facebook-reels-export.test facebook-reels-lifecycle.test facebook-reels-crawler.test facebook-reels-parser.test facebook-reel-details.test
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

- 78/78 test, 0 fail/skip; suite thư viện 9 test. Quan sát regression folder/name, ID ngày và bản sao fail trước sửa, pass sau sửa.
- Typecheck node/web và build ra out/ pass. Log: `%TEMP%/tediapros-reels-library-tests.log`, `%TEMP%/tediapros-reels-library-build.log`.
- Browser với dữ liệu mẫu: 28 ID có 10 đã tải => 18 được chọn; thêm hàng đợi 18. Thư viện hiển thị tên/ngày/thư mục và đủ nút hành động, form nhập kênh bật nút khi URL có nội dung. Không gọi Facebook hoặc ghi video thật trong phép thử UI.
- Ảnh UI: `.ai/qa/facebook-reels-library/library.png`. Kiểm tra DOM cửa sổ 1000px: pageWidth=1000, không tràn ngang; ảnh ở kích thước nhỏ của IAB bị đen một phần, không dùng nó làm bằng chứng visual acceptance.
- Lệnh FFmpeg chuyển file VP9/WebM thử 160×90/12fps sang H.264/MP4 đã chạy exit 0; FFprobe xác nhận 160×90, duration=1.000000. SHA256 file nguồn không đổi. File thử: `.ai/qa/facebook-reels-library/reuse-source.webm`, `reuse-mp4.mp4`. Phép thử lệnh dùng FFmpeg sẵn trên PATH; không thay thế kiểm chứng chọn managed runtime của app hoặc tải Facebook thật.
- Bản cài đang chạy chưa được cập nhật; chưa kiểm chứng tải Facebook thật hoặc đóng gói installer trong nhiệm vụ này.
