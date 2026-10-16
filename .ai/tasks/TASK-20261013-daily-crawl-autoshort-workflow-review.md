# Review workflow cào bài, chapter và AutoShort theo ngày

- Trạng thái: Đã review; triển khai chưa đủ điều kiện Verified & Ready.
- Người thực hiện: Codex
- Ngày: 2026-10-13
- Phạm vi: Đối chiếu planning/task với working tree hiện tại; không sửa mã triển khai.

> Đây là snapshot review trước khi sửa. Theo yêu cầu tiếp theo của người dùng, Codex đã triển khai sửa lỗi và bổ sung regression/UI/native FFmpeg proof. Trạng thái hiện tại, thay đổi và giới hạn live nằm trong [task bàn giao](TASK-20261013-daily-crawl-autoshort-workflow.md). Số dòng của findings bên dưới thuộc snapshot cũ.

## Kết luận

Đã có module snapshot, IPC, UI toggle, thư mục ngày, xuất TXT/chapter/Excel và cầu nối AutoShort. Tuy nhiên, các tiêu chí kế thừa cấu hình tức thời, cào toàn bộ chapter, xử lý hết video và báo kết quả chính xác chưa đạt. Working tree có nhiều thay đổi khác; review giới hạn các file liên quan workflow.

## Findings

1. **P1 — Báo hoàn tất AutoShort sai khi batch lỗi.** `facebookReelsMonitorRuntime.ts:75` resolve mọi `batch-done`, bỏ qua errorCount/cancelledCount/results. `facebookReelsMonitor.ts:275` ghi toàn bộ số đầu vào là đã xử lý. Core vẫn phát batch-done khi preflight hoặc tất cả video lỗi (`autoshort.ts:3740`). Cần trả kết quả từng video, ghi đúng completed/failed/cancelled và đường dẫn output.
2. **P1 — Hủy monitor không hủy AutoShort.** `facebookReelsMonitorRuntime.ts:53` nhận signal nhưng không sử dụng; core có controller riêng. Tắt theo dõi hoặc cancelAndWait vẫn phải đợi render tiếp tục. Cần gắn abort với cancelAutoShort đúng jobId và dọn listener khi kết thúc.
3. **P1 — Cấu hình không đồng bộ khi chỉnh toggle.** `AutoShort.tsx:1856` chỉ lưu snapshot trong thao tác start/resume. Người dùng tắt TTS/dịch/xóa chữ rồi chuyển tab mà không chạy sẽ dùng snapshot cũ, hoặc mặc định bật TTS/dịch. Cần một builder cấu hình chung, lưu khi thay đổi/lưu preset, debounce có thứ tự và xác nhận lưu trước khi chạy tự động.
4. **P1 — Mất khả năng retry các stage sau download.** `facebookReelsMonitor.ts:177` ghi download history trước article/Excel/AutoShort; lượt sau lọc ID đã tải ở dòng 111 và 165. Khi article lỗi, app crash hoặc AutoShort đang bận, video không được workflow chọn lại. Cần ledger trạng thái từng stage và hàng đợi pending, dùng download history chỉ để tránh tải lại MP4.
5. **P1 — Chỉ chuyển tối đa 100 video sang AutoShort.** `facebookReelsMonitor.ts:179` giới hạn notice.videos 100 rồi dòng 266 dùng chính danh sách thông báo làm đầu vào. Các video thứ 101 trở đi đã tải nhưng không xử lý và bị history bỏ qua. Cần danh sách công việc độc lập với giới hạn hiển thị.
6. **P1 — Có thể nối chapter khác truyện.** `facebookArticle.ts:393` coi cùng chuyên mục hoặc nằm trong container navigation/TOC là cùng truyện; dòng 405 giữ URL đầu tiên theo số chapter. Link đề xuất truyện khác trong cùng category có thể thành chapter tiếp theo. Cần xác minh story identity và chỉ dùng next/TOC của truyện đang đọc.
7. **P1 — Chưa chứng minh hoặc biểu diễn tính đầy đủ chapter.** `facebookArticle.ts:617` trả về sớm với trang không có pattern chapter-1 và chỉ một sibling; link Next có thể không được theo. Vòng lặp giới hạn 25 chapter/60 giây; 404, lỗi mạng, timeout đều dừng và có thể vẫn trả success. Trang bắt đầu ở chapter khác 1 bị gán index 1. Cần completion/stopReason, giữ số chương thật, phân biệt hết truyện với lỗi và yêu cầu review khi chỉ thu được một phần.
8. **P2 — Lỗi xuất bài/Excel bị nuốt và Excel cùng ngày bị ghi đè.** `facebookReelsMonitor.ts:214,234,261` không đưa lỗi stage vào kết quả notice; download thành công vẫn có thể báo success dù thiếu artifact. Mỗi lượt tạo workbook mới rồi ghi cùng `excel/reels_content.xlsx`, nên check thêm trong ngày xóa các dòng của lượt trước. Cần manifest bền vững, merge theo Reel ID và xuất Excel nguyên tử từ dữ liệu cả ngày.
9. **P2 — Snapshot chưa validate và lưu không đáng tin cậy.** `index.ts:1518` chỉ kiểm tra object; `autoShortWorkflowConfig.ts:69` cast JSON sang config. Save đặt cache trước writeFile, nuốt lỗi và IPC vẫn trả ok. Nhiều save không serialize, ghi trực tiếp có thể để lại JSON dở khi crash. Cần runtime validation/migration, ghi temp + rename và trả lỗi lưu thật.

## Sai khác với planning cần chốt

- autoRunAutoShort mặc định false (`facebookReelsMonitorRuntime.ts:104`, UI), trong khi planning ghi true.
- Khi tắt article nhưng bật AutoShort, caption và Excel không được xuất: chúng nằm trong nhánh autoExportArticle.
- Khi cả hai cờ tắt, video trở lại thư mục kênh; planning mô tả luôn có thư mục ngày.
- Ngày tự động dùng ngày lịch đến hạn (reelsDueDay), có thể là hôm trước khi chạy bù trước 09:00, không luôn là ngày cào thực tế.
- reservedOutputDir gửi trong runtime không thuộc start item contract và bị validator loại bỏ (`autoShortContract.ts:439`). Core tạo thư mục riêng cho mỗi item dưới config.outputDir (`autoshort.ts:3663`); layout MP4 phẳng như planning chưa đạt.
- autoShortPresetId được lưu nhưng chưa được dùng để chọn preset.
- TypeSafe/Jev và cơ chế offscreen/article thay đổi ngoài danh sách scope của task, cần mô tả dependency và kiểm chứng riêng.

## Kiểm chứng thực tế

Đã chạy từ repository root:

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs facebook-reels-monitor.test facebook-reels-export.test autoshort-ocr-pipeline.test
```

- Typecheck node/web: PASS, exit 0.
- Monitor: 16 pass, 0 fail.
- Reels export: 11 pass, 0 fail.
- AutoShort OCR pipeline: 11 pass, 0 fail, 1 skip (Managed FFmpeg fixture unavailable).
- Tổng: 38 pass, 1 skip. Không chạy toàn bộ suite.
- Monitor fixture không inject runAutoShort/fetchArticle; download mock bỏ qua targetDir/stem. Các suite trên không chứng minh luồng workflow mới, đồng bộ config, hủy AutoShort hoặc crawling nhiều chapter.
- Chưa thực hiện Facebook/provider/live chapter crawl hoặc render MP4 end-to-end trong review này.

## Kế hoạch bổ sung và bàn giao

1. Đổi trạng thái task gốc thành triển khai một phần/chờ sửa và nghiệm thu; bỏ tuyên bố kế thừa 100% và toàn bộ chapter cho đến khi có bằng chứng.
2. Chốt ngày folder, default toggle, layout output và các artifact luôn phải xuất.
3. Thiết kế ledger mỗi Reel theo stage: discovered/downloaded/article complete-or-partial/autoshort pending-running-done-error-cancelled; lưu jobId, config revision và output receipt. Khôi phục pending sau restart mà không tải lại.
4. Sửa kết quả batch, cancellation, giới hạn 100, snapshot và bảo toàn Excel.
5. Kiểm thử mới: hơn 100 Reel; batch lỗi/hủy/bận; thay toggle không chạy tay; save lỗi/restart; check hai lần một ngày; article lỗi sau download và retry; chapter khác truyện, Next-only, bắt đầu chapter 3, hơn 25 chương và lỗi giữa chừng.
6. Nghiệm thu thật một kênh + truyện biết tổng chương + MP4 AutoShort, kiểm tra output bằng FFprobe/decode và so sánh cấu hình. Xác nhận cancel và restart/resume.

Mã triển khai và task gốc được giữ nguyên để người dùng đối chiếu.
