# AutoShort: lỗi thiếu/thừa cue ở bước dịch

Ngày: 2026-09-07. Phạm vi: client local translation; không thay đổi backend hoặc tải thử inference server.

## Bằng chứng từ lần chạy thực tế

Log `C:/Users/PC/AppData/Roaming/tedia-pros/logs/tblao.log` ghi nhận:

- 08:15:11 bắt đầu dịch sang `en`.
- Batch 1–24 bị chia 12+12, sau đó 6+6.
- Batch 25–44 bị chia tiếp; nhánh 39–44 thu nhỏ tới một cue vẫn thất bại lúc 08:16:54.
- Các response đều ghi `truncated=false`; lỗi kết thúc là `Kết quả dịch không đạt yêu cầu: Kết quả dịch thiếu hoặc thừa cue.`
- Lần này dừng ở validation bản dịch, không phải hết dung lượng hoặc timeout.

Log không chứa response gốc, nên chưa xác định được response lần đó có Markdown, ID sai hay thật sự thiếu cue. Bản tổng hợp người dùng cung cấp cũng không có response gốc. Không xem kết quả fixture là bằng chứng server đã được sửa.

## Lỗi client đã tái hiện và sửa

1. `parseTranslationItems` trước đây đọc JSON thuần nhưng bỏ sót JSON hợp lệ trong một outer Markdown fence. Phản hồi đủ ID trở thành 0 cue; mọi lần retry/split có cùng định dạng đều thất bại. Giờ unwrap đúng một fence hoàn chỉnh rồi parse, giữ nguyên ID và text. Không trích JSON tùy ý từ prose hoặc sửa JSON bị cắt.
2. JSON object có `id` và `t`/`text` cho một cue trước đây không được đọc. Giờ chấp nhận explicit-ID object; không suy đoán vị trí, không đổi ID số thành cue ID.
3. Prompt local dubbing trước đây không chốt một output serialization cụ thể. Giờ yêu cầu `[id] bản dịch` ở system message, liệt kê đúng ID của batch và giữ ID kể cả khi chỉ còn một cue. Endpoint và các trường API giữ nguyên.
4. Recovery partial trước đây có thể giữ bản dịch đầu tiên của ID trùng. Giờ loại toàn bộ entry mơ hồ của ID đó và yêu cầu dịch lại cùng cue còn thiếu; giữ những cue duy nhất hợp lệ.
5. Log thêm số expected/parsed/missing/duplicate/unknown/empty, độ dài response và outer-fence flag. Không ghi response gốc, prompt, unknown ID strings hoặc credentials. Khi không đọc được cue nào, báo lỗi định dạng cụ thể.

Giữ các thay đổi có sẵn khi bắt đầu lượt này: recovery cue thiếu, giới hạn thời gian, tùy chọn maxRequests, model/config và output của người dùng. Không khôi phục request ceiling đã bị bỏ trong các lượt sửa khác.

## Kiểm chứng

- RED trước sửa: bốn regression mới thất bại đúng tại parse fenced JSON, single-object JSON, duplicate recovery và diagnostics.
- GREEN: suite `local-translation.test` đạt 16/16, gồm 117 cue, thứ tự/thời gian, partial recovery và 403/cancel.
- Negative cases: không chấp nhận ID sai/numeric ID, output thiếu nhãn, trùng ID, response `finish_reason=length` hoặc response vẫn chủ yếu là hệ chữ nguồn; giữ file đích cũ khi thất bại.
- Typecheck Node/Web: PASS.
- `npm.cmd run test:local-runtime`: PASS, exit 0; tổng các suite báo 416 pass, 0 fail. Có test native có điều kiện tự bỏ assertion khi fixture không sẵn sàng; đây không phải qualification runtime OCR/STTN hay server live.
- `git diff --check`: PASS; chỉ có cảnh báo CRLF hiện hữu ở file ngoài phạm vi sửa.
- `npm.cmd run build`: main/preload PASS, renderer gặp `EPERM` khi xóa thư mục assets hiện có.
- Build đầy đủ main/preload/renderer vào đúng `out` PASS với `node --input-type=module -e 'import { build } from "electron-vite"; await build({ build: { emptyOutDir: false } });'`. Tùy chọn chỉ áp dụng cho lần build, không sửa config dự án. Đây là incremental build, không phải clean-package validation.
- Đã kiểm tra `out/main/index.js` chứa parser, prompt và diagnostics mới; không dừng hoặc tự khởi động lại phiên app của người dùng.

## Áp dụng

Khởi động lại TediaPros sau build để main process nạp mã mới, rồi chạy lại video lỗi. Chưa có bằng chứng end-to-end với server thật trong lượt này. Nếu server thực sự bỏ ID hoặc trả bản dịch không hợp lệ sau retry, chương trình vẫn dừng để tránh xuất video sai nội dung; diagnostics mới giúp phân biệt nguyên nhân.
