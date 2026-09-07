# Đánh giá toàn bộ chức năng làm mờ — 2026-09-05

## Kết luận

Luồng làm mờ có nền tảng xử lý hình học, mặt nạ và xuất video khá chặt chẽ. Tuy nhiên, chưa đủ bằng chứng để bảo đảm tự động che hết chữ trên mọi video, đặc biệt ở chế độ Nhanh. Những điểm cần ưu tiên là khả năng bỏ sót chữ, kiểm thử chất lượng ảnh sau render, và số liệu thời gian blur đang sai nghĩa.

Đây là kiểm tra mã hiện tại và thử nghiệm cục bộ; không phải chứng nhận chất lượng cho mọi output. Không sửa mã sản phẩm, khởi động lại app hoặc render đè video trong lượt đánh giá này. Workspace có nhiều thay đổi chưa commit; HEAD f782e008d8c154aec3fe53b35ebba8584a4c7404 không đại diện đầy đủ cho mã đã kiểm tra.

## 1. Các chế độ thực sự hoạt động thế nào

| Phần | Vị trí | Vùng làm mờ | Thời gian |
| --- | --- | --- | --- |
| Thủ công | Video Editor và Auto Short | Các hình chữ nhật người dùng chọn; crop, Gaussian blur rồi overlay | Liên tục suốt video khi bật; không có mốc bắt đầu/kết thúc cho từng vùng |
| OCR Chính xác | Auto Short | Các hộp chữ OCR nhận diện trong vùng quét | Theo timeline OCR lấy mẫu 8 lần/giây, có nới biên thời gian |
| OCR Nhanh | Auto Short | Hộp chữ nhận diện trên khung đại diện của một khoảng hình được coi là ổn định | Dùng chung kết quả nhận diện cho khoảng đó; cũng giải mã mẫu ở 8 lần/giây |

Nguồn: `src/main/burn.ts:745–805`, `src/renderer/src/components/VideoEditor.tsx:813`, `engines/ocr-engine/visual_timeline.py:376`, `src/shared/ocrVisualTimeline.ts:462`.

Blur OCR dựa trên vị trí và thời gian chữ nhìn thấy, không dựa trực tiếp vào SRT ASR hoặc SRT dịch. Mọi chữ hợp lệ trong vùng quét đều có thể bị làm mờ, kể cả watermark/chữ trang trí; chưa có phân loại để chỉ giữ lại phụ đề. Phụ đề dịch được ghép sau blur nên chữ mới vẫn sắc nét.

Mặt nạ được nới trước/sau một mẫu, tương đương khoảng 125 ms mỗi phía. Các hộp cũng được nới 8–24 pixel theo chiều cao chữ, nhưng giới hạn trong vùng quét. Vì vậy blur có thể xuất hiện hơi trước chữ hoặc còn lại hơi sau chữ. Điều này khác với làm mờ đúng tuyệt đối từng frame gốc.

## 2. Các phát hiện theo mức ưu tiên

### P1 — Chế độ Nhanh có thể bỏ sót chữ khi nền ít thay đổi

**Đã tái hiện bằng kiểm thử thuật toán với detector giả lập.** Thuật toán dùng độ khác nhau của mặt nạ chữ toàn vùng, ngưỡng Jaccard 0,45, rồi OCR khung đại diện. Mặt nạ màu có thể coi gần như cả nền sáng là vùng ứng viên chữ. Khi chữ mới chỉ làm thay đổi một phần nhỏ của vùng, thuật toán không chia khoảng mới.

Thử hai ảnh 320×120: ảnh đầu nền xám sáng 235, ảnh sau cùng nền có chữ đen `NEW SUBTITLE`. Độ thay đổi đo được chỉ 0,00028646. Nhanh gọi detector cho ảnh đầu và tạo 0 segment; Chính xác gọi cả hai và tạo 1 segment. Đây là bằng chứng về quyết định bỏ qua khung của thuật toán, không phải phép đo độ chính xác của mô hình OCR thật.

Tác động: có thể không che chữ mới, hoặc giữ hộp cũ khi chữ thay đổi vị trí mà ngưỡng chưa vượt. Vấn đề không chỉ là phụ đề quá ngắn.

Nguồn: `engines/ocr-engine/visual_timeline.py:8`, `:16`, `:107`, `:376–409`.

Hướng sửa: bắt buộc OCR định kỳ trong khoảng ổn định; xét thay đổi cục bộ; xác nhận biên xuất hiện/biến mất. Cần đo mức tăng thời gian xử lý trước khi đặt mặc định.

### P1 — Kiểm thử thành công chưa chứng minh hình ảnh blur đúng

**Xác nhận qua mã và log chạy test.** `scripts/verify-ocr-blur-media.mjs` có các hàm kiểm tra gradient, sai khác ảnh và mask, nhưng luồng render hiện không gọi các hàm này. Nó đọc timeline rồi chủ yếu kiểm tra render hoàn tất và thời lượng gần 6 giây. Một video có vùng trắng hoặc chữ còn đọc được vẫn có thể vượt qua nhánh kiểm tra này.

Nguồn: `scripts/verify-ocr-blur-media.mjs:37`, `:65`, `:115`, `:240–258`. Các kiểm tra framemd5 của mask trong runtime là có thật, nhưng mask đúng không đồng nghĩa ảnh ghép cuối cùng đẹp hoặc che chữ đủ mạnh.

Hướng sửa: thêm kiểm tra màu đồng nhất không đổi sau blur; ảnh có chữ tương phản cao; vùng ngoài mask không thay đổi vượt sai số encode; biên thời gian; nền sáng/tối, chuyển cảnh và nhiều độ phân giải. Gắn kết quả acceptance với đúng phiên bản mã và FFmpeg.

### P2 — Chỉ số thời gian làm mờ thực tế đang lấy nhầm thời lượng video

**Xác nhận qua mã.** `autoShortItemCoordinator.ts:733` lấy `timedMask.durationSeconds` để ghi `maskedDurationSeconds`; `ocrMask.ts:430` gán trường đó bằng thời lượng toàn video, không tính hợp các khoảng có pixel mask khác 0.

Vì vậy `ocrMaskedDurationSeconds = 71,130127` trong output video mèo không chứng minh blur hoạt động suốt 71,13 giây. Câu trả lời trước đã dùng chỉ số này để kết luận thời gian blur là không chính xác. Audit cũ của file này không giữ mask/timeline hình học để xác nhận lại chính xác từng vùng sau khi thư mục làm việc được dọn.

Hướng sửa: tính tổng thời gian các mẫu mask có vùng hoạt động, cắt theo thời lượng video; phân biệt thời lượng nguồn, thời lượng mask và tổng thời gian blur thực sự bật.

### P2 — Preview và nhãn giao diện chưa phản ánh đúng output

- Video Editor xem trước bằng CSS `backdrop-filter: blur(6px)`, còn xuất file dùng Gaussian theo kích thước video. Không thể coi preview là phép xem trước đúng độ mờ cuối cùng.
- Auto Short chỉ đưa vùng thủ công vào RegionBox; chưa có preview mask OCR theo thời gian, sửa hộp sai hoặc loại trừ watermark trước render.
- Nhãn Chính xác nói “từng khung hình”, nhưng thực tế là 8 mẫu/giây; chưa quét tất cả frame của video 30/60 fps.
- Nhãn Nhanh nói giảm tần suất lấy mẫu, nhưng thực tế vẫn trích ảnh 8 fps và giảm số lần chạy OCR.
- Auto Short khởi tạo blur bật, trong khi mode/profile được lưu riêng. Trạng thái bật/tắt chưa có mức lưu giữ tương ứng trong phần state được kiểm tra.

Nguồn: `src/renderer/src/components/AutoShort.tsx:216`, `:238`, `:1770`, `:1783`; `src/renderer/src/components/RegionBox.tsx:405`; `src/renderer/src/styles/screentext.css`.

Hướng sửa: sửa mô tả; thêm preview đoạn ngắn bằng đúng bộ lọc render, kèm vùng OCR và nút loại trừ/chỉnh sửa.

### P2 — Có điểm nghẽn khi xử lý video dài hoặc độ phân giải lớn

**Đánh giá từ cấu trúc mã; chưa benchmark toàn bộ video dài.**

- OCR trích toàn bộ mẫu thành PNG trước khi nhận diện. Nhanh vẫn trả chi phí lấy mẫu/lưu ảnh này.
- Engine OCR nhận ảnh toàn khung rồi lọc kết quả theo vùng quét; chọn vùng quét nhỏ chưa đồng nghĩa giảm chi phí inference tương ứng.
- `boxesForMaskFrame` duyệt toàn bộ segment ở từng mẫu; việc ghi và xác minh mask gọi lại phép duyệt này. Với timeline dày, chi phí so khoảng tăng gần bậc hai theo số mẫu.
- Ví dụ 30 phút ở 8 fps có 14.400 mẫu; nếu mỗi mẫu là một segment thì một lượt xét mọi segment cho mọi mẫu xấp xỉ 207 triệu phép kiểm tra khoảng. Đây là đếm thao tác, không phải dự đoán thời gian chạy.
- Blur tự động làm mờ toàn khung trước khi mask chọn vùng. Frame không có chữ vẫn chịu chi phí bộ lọc. GPU encoder không có nghĩa bộ lọc Gaussian này chạy trên GPU.

Nguồn: `engines/ocr-engine/engine.py:151`, `:193`, `:210`; `src/shared/ocrVisualTimeline.ts:511`; `src/main/ocrMask.ts:74`, `:407`; `src/main/burn.ts:857–865`.

Hướng sửa: duyệt danh sách segment đang hoạt động theo thời gian; tái sử dụng mask giống nhau; xử lý ảnh theo lô/luồng thay vì giữ toàn bộ PNG; benchmark RAM, dung lượng tạm và thời gian trên video thực tế trước khi thay đổi kiến trúc.

## 3. Lỗi mảng trắng: điều đã xác minh và điều cần đính chính

Đã dùng FFmpeg đang được app quản lý: `n9.0.1-11-ge47273f4d9-20260829`, tại `C:\Users\PC\AppData\Roaming\tedia-pros\bin\ffmpeg\ffmpeg.exe`.

Thử ảnh màu nâu đồng nhất 1080×1920, chuỗi `format=gbrp,gblur=sigma=N:steps=S`, xuất một frame RGB24:

| steps | sigma | RGB trung bình đầu ra |
| --- | --- | --- |
| 3 | 16, 43, 64, 86, 130, 230 | 127, 95, 63 — giữ màu |
| 6 | 16, 43, 64, 86 | 127, 95, 63 — giữ màu |
| 6 | 130, 230 | 255, 255, 255 — trắng toàn ảnh |

Ảnh đồng nhất không có nền sáng bên cạnh để blur trộn vào. Do đó lý giải trước rằng mảng trắng chỉ do “blur lấy trung bình nền sáng” là không đủ và không khớp thử nghiệm này. Đã thu hẹp lỗi về hành vi bộ lọc ở sigma lớn với 6 bước trên bản FFmpeg hiện tại; chưa truy nguyên chi tiết thuật toán bên trong FFmpeg và không kết luận mọi phiên bản đều mắc lỗi.

Mã hiện tại giới hạn OCR sigma trong 16–64; 1080×1920 dùng 64. Thử nghiệm trên xác nhận các giá trị hiện dùng giữ màu ở ảnh đồng nhất. Manual vẫn dùng công thức cũ và 3 bước; sigma 230/3 không trắng trong phép thử này.

Đánh đổi của giới hạn sigma: mờ nhẹ hơn, giữ chi tiết nền hơn nhưng chưa có bằng chứng bảo đảm mọi cỡ chữ đều không đọc được. Comment hiện tại trong `burnInputPlanner.ts:54–59` vừa giải thích nguyên nhân chưa chính xác, vừa khẳng định chữ không đọc được vượt quá bằng chứng kiểm thử.

Cũng chưa có bằng chứng đủ để quy riêng mảng trắng phía sau chữ tiếng Anh trong ảnh người dùng cho tùy chọn nền phụ đề. Nó có thể trùng vùng OCR đã bị trắng. Cần đối chiếu cấu hình ASS và cùng frame nguồn/output để tách hai hiệu ứng.

Các ảnh thử blur từ lượt trước sử dụng mask dựng gần đúng, không phải mask OCR gốc. Chưa render lại toàn bộ video người dùng với OCR thật trong lượt audit này.

## 4. Hạn chế chất lượng còn lại

- 8 fps có khoảng lấy mẫu 125 ms; chữ xuất hiện giữa hai mẫu có thể bị bỏ sót ngay cả ở Chính xác.
- Ngưỡng confidence và lọc chữ rỗng có thể loại bỏ vùng chữ OCR không chắc chắn. Có giới hạn số hộp; không nên hiểu là nhận diện không giới hạn mọi chữ trong khung.
- Mask hiện là hình chữ nhật 0/255, chưa làm mềm mép. Trên nền có chi tiết có thể thấy ranh giới hình hộp.
- Nới hộp, gộp hình chữ nhật và bù một mẫu mất nhận diện giúp giảm hở chữ nhưng có thể che nhiều nền hơn hoặc lưu vùng mờ qua một chuyển cảnh ngắn.
- Blur thủ công không bám chuyển động và không có thời gian riêng cho mỗi vùng. Phù hợp với dải phụ đề cố định, dễ che thừa khi vùng đó không có chữ.
- Chưa có phép đo chất lượng che chữ trên bộ video đa dạng để xác định sigma tốt theo cỡ chữ, độ phân giải và tương phản.

Đây là các đánh đổi/hạn chế thiết kế, không phải khẳng định mọi video đang lỗi.

## 5. Những phần đang làm tốt

- Phân biệt rõ mode thủ công và OCR; có kiểm tra đầu vào, không cho trộn mask tự động với danh sách vùng thủ công mâu thuẫn.
- Có chuẩn hóa tọa độ hiển thị, kiểm tra hình học, kích thước, phiên bản timeline và các thuộc tính video liên quan trước khi render.
- Mask FFV1 lossless, có xác minh frame/hash và frame đen kết thúc để tránh kéo dài vùng làm mờ ngoài đoạn cần thiết.
- Có điều tiết luồng ghi mask, theo dõi tiến trình con và dọn tài nguyên; OCR có thể được dùng chung giữa tạo phụ đề và tạo mask trong cùng item.
- Ghép phụ đề mới sau blur; xử lý input video/audio/mask riêng.
- Luồng Auto Short kiểm tra media trước khi công bố file cuối; xuất H.264 yuv420p và có fallback encoder.

Các cơ chế này giúp tránh file hỏng và mask sai cấu trúc. Chúng không thay thế kiểm tra hình ảnh cuối cùng.

## 6. Kiểm chứng trong lượt đánh giá này

1. `npm run test:local-runtime -- autoshort-ocr-burn.test ocr-visual-timeline.test ocr-mask.test autoshort-ocr-pipeline.test autoshort-ocr-contract.test`: 43 test được runner báo pass, không fail. Một kiểm tra mask native báo fixture FFmpeg không có và return sớm, nên vẫn được đếm pass thay vì skip; không được coi cả 43 là 43 xác nhận thực thi đầy đủ. Bộ pipeline riêng có chạy media integration thật.
2. `npm run test:ocr-engine`: 16 test Python OK.
3. 12 tổ hợp sigma/steps trên FFmpeg thật với ảnh màu đồng nhất: kết quả ở bảng trên.
4. Tình huống nền sáng thêm chữ: tái hiện bỏ sót ở thuật toán Nhanh với detector giả lập.

Log: `C:\Users\PC\AppData\Local\Temp\tedia-blur-audit-tests.log` và `C:\Users\PC\AppData\Local\Temp\tedia-blur-audit-python.log`.

Không chạy lại toàn bộ build/typecheck hoặc toàn bộ suite trong lượt audit chỉ đọc mã này; các kết quả ở lượt trước không được tính là kiểm chứng mới. Chưa kiểm chứng end-to-end với OCR thật và render lại toàn bộ video mèo sau giới hạn sigma; chưa benchmark video dài/4K; chưa đánh giá thủ công trên tập video đa dạng.

## 7. Thứ tự xử lý đề xuất

1. Đưa kiểm thử ảnh thật vào luồng acceptance; giữ regression ảnh màu đồng nhất và thêm mẫu chữ/nền/chuyển cảnh. Sửa test return sớm để báo skip đúng.
2. Sửa sai nghĩa của thời gian blur và mô tả hai profile; lưu bằng chứng timeline/mask cần thiết cho chẩn đoán.
3. Cải thiện quyết định lấy khung OCR của chế độ Nhanh, đo chất lượng lẫn tốc độ so với Chính xác.
4. Thêm preview mask và vùng loại trừ; thử làm mềm biên nhưng vẫn giữ vùng lõi che hết nét chữ.
5. Tối ưu việc duyệt timeline và lưu ảnh tạm sau khi có benchmark làm mốc.

Trong lúc chưa xử lý các điểm trên, Chính xác là lựa chọn phù hợp hơn nếu ưu tiên hạn chế bỏ sót chữ, nhưng vẫn cần xem output. Thủ công phù hợp với vùng cố định cần che xuyên suốt. Nhanh cần được hiểu là chế độ có đánh đổi độ bao phủ nhận diện.
