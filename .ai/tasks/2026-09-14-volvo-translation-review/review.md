# Rà soát bản dịch video Volvo — 2026-09-14

- **Trạng thái:** Đã kiểm chứng bằng artifact, khung hình nguồn và replay offline.
- **Người thực hiện:** Codex.
- **Mục tiêu:** Tìm nguyên nhân bản dịch Trung → Việt kém chất lượng; không thay thế bản dịch, không render lại hoặc sửa product code trong lần rà soát này.
- **Video ID:** `7597656892206353679`.
- **Job/item:** `5ccfeb3d-8c40-48e4-a767-db873e24218a` / `151ff585-c611-4d0d-97fe-3f9363c119f1`.
- **Source SHA-256:** `6a4adf9ad638ee776ff7004b5756dae80e9808059243e160b868e019da9f034e`; đã tính lại trên video nguồn và khớp manifest.

## 1. Kết luận

Bản dịch hỏng qua ba lớp nối tiếp: ASR nhận sai từ quan trọng; quá trình dịch không giữ nhất quán chủ thể và dùng lối dịch sát chữ; bộ kiểm tra không bắt được các lỗi nghĩa này. Việc ghép đoạn đọc và chia lại phụ đề làm câu văn thiếu tự nhiên thêm. Lỗi `Volvo → Wooting` và `cành cây sồi → cành cây pixel` đã tồn tại trong `translated.srt`, trước TTS.

Model nhiều context không tự giải quyết được vấn đề: code hiện tại vẫn chia tối đa 24 cue mỗi batch và chỉ gửi hai cue lân cận mỗi phía. Replay từ đúng 44 cue của video cho thấy batch sau không chứa tên Volvo đúng ở đầu video.

## 2. Bằng chứng của bản chạy thật

- **ARTIFACT_CONFIRMED:** 44 cue nguồn, 44 cue dịch, 8 đoạn TTS, 26 cue phụ đề thành phẩm. ID và mốc thời gian nguồn/dịch trùng khớp hoàn toàn.
- **LOG_CONFIRMED:** Whisper `small`, `transcribe`, CUDA. ASR hoàn tất 03:58:32 UTC; dịch hoàn tất 03:59:17 UTC; OCR hình chạy sau dịch và TTS, bắt đầu 04:00:40 UTC. Lượt này không dùng kết quả OCR hình để sửa văn bản trước khi dịch.
- **ARTIFACT_CONFIRMED:** Cả 8 `finalSpokenText` bằng `translatedText`, `rephraseCount=0`, `overflowCount=0`, không có timing warning. Tempo trung bình `1.1441x`, cao nhất `1.2136x`.
- **LOG_CONFIRMED:** Persistent translation cache bị bỏ qua vì chưa xác nhận model revision. Không có bằng chứng lỗi do lấy bản dịch cũ từ persistent cache.
- **UNKNOWN:** Artifact không ghi lại toàn bộ request/response dịch, model thực sự được phục vụ, đường gateway, hoặc glossary/synopsis lịch sử. Không thể kết luận riêng Gemini 3.1 Pro hoặc gateway là nguyên nhân từ bản lưu này.

## 3. Những câu sai cụ thể

Mốc dưới đây theo `translated.srt` trước khi ghép lại phụ đề.

| Mốc | Bằng chứng nguồn | Bản dịch đang có | Nhận xét / cách hiểu đúng |
| --- | --- | --- | --- |
| 13.52–15.90 | Khung hình 15.3s ghi `要听上万次`; ASR thành `要听上弯字` | “nghe hàng ngàn lần” | Nguồn ghi hàng vạn lần. ASR làm hỏng đơn vị số; dịch tiếp tục đoán sai mức độ. |
| 15.90–17.52 | `不能刺耳 不能刻意` | “Không được chói tai, không cố ý” | `刻意` trong ngữ cảnh thiết kế âm thanh là gượng ép/thiếu tự nhiên. Có thể viết “Không chói tai, cũng không gượng ép”. |
| 19.30–20.96 | `哪怕堵在车水马龙里` | “kẹt trong dòng người tấp nập” | Ngữ cảnh là dòng xe/ùn tắc giao thông. |
| 24.60–26.52 | `扎进深山老林待了整整两天` | “Họ cắm trại sâu rừng hai ngày liền” | Nguồn nói vào rừng sâu và ở đó hai ngày; không xác lập chi tiết cắm trại. Diễn đạt tự nhiên: “Họ vào rừng sâu suốt hai ngày”. |
| 26.52–28.34 | `折断了三百多根不同的树枝` | “Gãy hơn ba trăm cành cây khác nhau” | Là hành động bẻ gãy hơn 300 cành cây của nhóm; bản dịch mất tác nhân và động từ chủ động. |
| 43.06–44.72 | Khung hình 43.7s ghi `橡树树枝轻轻弯折时`; ASR ghi `像素树枝轻轻弯折时` | “khi cành cây pixel khẽ cong” | `橡树` là cây sồi; `像素` là pixel. ASR sai từ đồng âm, dịch bê nguyên nghĩa sai. |
| 44.72–46.16 | Chữ trên hình 45s: `那声温柔的嘎吱声`; ASR: `嘎之声` | “tiếng ga dịu dàng ấy” | Nguồn dùng từ tượng thanh chỉ tiếng cành cây khi uốn. Phiên thành “ga” không diễn đạt tiếng động tự nhiên trong tiếng Việt. |
| 50.66–52.32 | Khung hình 51s ghi `沃尔沃方向键独有的点击声`; ASR ghi `窝耳窝...` | “âm thanh bấm phím độc quyền của Wooting” | Phải giữ Volvo; `独有` ở đây là đặc trưng/riêng có, không khẳng định bản quyền độc quyền. |
| 53.12–56.84 | Ngữ cảnh vẫn là Volvo và xe hơi | “bàn phím Wooting ... bàn phím thư giãn nhất trên mạng” | Dịch đã chuyển cả chủ thể lẫn loại đồ vật. Hình 12.5s và 14s cho thấy cần báo rẽ và đèn xi-nhan; “âm thanh xi-nhan” phù hợp ngữ cảnh hơn “bàn phím”. |

Đánh giá này đối chiếu nội dung video, không kiểm chứng tính xác thực ngoài đời của câu chuyện thiết kế âm thanh Volvo.

## 4. Nguyên nhân trong pipeline

### 4.1 ASR sai nhưng không có bước đối chiếu nguồn

`source.srt` chứa `像素`, `窝耳窝`, `弯字`, `数字画`, `调鞋`, `辅平`, `细节力`. Một số lỗi đã được dịch tự sửa, nhưng sửa không nhất quán. Các hình nguồn được lưu cùng báo cáo chứng minh trực tiếp sai khác cây sồi, Volvo và hàng vạn lần.

OCR hình vẫn đã chạy trong job để xử lý vùng chữ/STTN, nhưng nằm sau bước dịch; sự có mặt của OCR trong job không đồng nghĩa có kiểm chứng ASR bằng chữ gốc trước dịch.

### 4.2 Mất ngữ cảnh toàn video tại ranh giới batch

**CODE_CONFIRMED:** `src/main/translation/planner.ts:208` vẫn áp trần legacy 24 cue, kể cả khi context provider không biết hoặc rất lớn. `src/main/translation/context.ts:4` giới hạn hai cue mỗi phía. Glossary và synopsis chỉ lấy từ guidance được cấp, không tự tạo từ video/tên file (`autoShortItemCoordinator.ts:1110`).

**OFFLINE_TEST_CONFIRMED:** Với input của video, mặc định không có guidance và capability tương thích (`contextTokens=null`, `outputTokens=2048`):

- Batch 1: cue 1–24; có `沃尔沃` đúng ở cue 2 và 6.
- Batch 2: cue 25–44; context trước chỉ là cue 23–24 nói về âm thanh dễ chịu. Trong prompt batch này không có `沃尔沃`/`Volvo`, chỉ còn `窝耳窝`.
- Điểm bắt đầu bản dịch có “pixel” và sai chủ thể nằm trong batch 2.

Đây là cơ chế tái hiện từ code hiện tại, không phải bản chụp request lịch sử. Sự trùng khớp với lỗi quan sát là bằng chứng mạnh cho việc mất ngữ cảnh góp phần làm sai chủ thể; không đủ để suy ra suy nghĩ nội bộ của model hoặc loại trừ guidance từng được cấu hình.

### 4.3 Quality gate không kiểm chứng đúng nghĩa

**CODE_CONFIRMED:** `validateAutoShortContentQuality` kiểm tra ID, text rỗng, cue marker, số/đơn vị/phủ định. Hàm tự ghi rõ không đánh giá chất lượng dịch ngữ nghĩa (`autoShortContentQuality.ts:168`).

**OFFLINE_TEST_CONFIRMED:** Replay trả đúng văn bản đã lưu qua orchestrator hiện tại được kết quả `with-warnings`, đủ 44 item. Các câu chứa “Wooting” và “pixel” vẫn sống nguyên. Một lượt repair yêu cầu các cue 1, 2, 15, 21, 25 theo cảnh báo token; không yêu cầu những cue sai cây sồi/Volvo. Language check trả `unknown`, không có issue; không phải chứng nhận dịch đúng.

### 4.4 Câu không có dấu ngắt, rồi bị chia phụ đề theo độ dài

**ARTIFACT_CONFIRMED:** 0/44 cue nguồn và chỉ 1/44 cue dịch có dấu kết thúc câu. Khi ghép, có đoạn “Volvo Hoàn toàn ... Ngay cả ... Chỉ cần ... Nhưng ...” không có dấu câu phân tách.

**CODE_CONFIRMED:** `sourceSpeechGrouping.ts` chia các đoạn không dấu câu bằng nhóm hữu hạn tối đa sáu cue; đây không phải chứng minh ranh giới ngữ nghĩa. `semanticGrouping.ts:107` ghép text bằng khoảng trắng. `dubbing/subtitles.ts:41` chia theo từ vào khối tối đa 64 ký tự, phân bổ thời gian tỷ lệ độ dài text, không căn theo word timestamp thực.

**ARTIFACT_CONFIRMED:** `timed.srt` ngắt “nhà thiết / kế”, “ba / trăm”, “khẽ cong” bị tách khỏi chủ thể. Một nhóm kết thúc tại “Dù đang kẹt trong dòng người tấp nập”, rồi vế chính ở nhóm tiếp theo. Đây là vấn đề câu và trình bày, cộng thêm vào lỗi nghĩa.

## 5. Điểm cần kiểm tra thêm ở gateway

**CODE_CONFIRMED, CHƯA GẮN ĐƯỢC VỚI BẢN CHẠY:** TediaPros gửi system prompt qua `systemInstruction` trong adapter Gemini (`src/main/gemini.ts:110`). Trong checkout CreateMediaTool `dbe6c42`, DTO `GeminiGenerateRequest` không có trường này; service Gemini chỉ ghép `req.Contents`. Nếu request đi qua route Gemini này, system prompt sẽ không được đưa vào prompt tạo nội dung.

Đường OpenAI-compatible dùng `BuildPromptFromMessages`, là code khác. Do chưa có request live xác nhận route của lần chạy, không kết luận bản này bị mất system prompt. Cần ghi nhận payload đã redact trước/sau gateway để xác minh, thay vì chỉ kéo dài prompt ở client.

## 6. Thứ tự xử lý đề xuất

1. Khôi phục bản chép nguồn trước dịch: đối chiếu ASR với OCR/chữ trên video, tên video và ngữ cảnh toàn bài; giữ nguyên bản raw, chỉ sửa những chỗ có bằng chứng. Tên loài, thương hiệu, số và đơn vị chưa chắc phải được đánh dấu để rà soát.
2. Với short 68 giây/44 cue này, cung cấp toàn văn làm context hoặc sinh bản tóm tắt và bảng thực thể dùng chung mọi batch. Không để batch sau chỉ biết hai câu trước đó. Model vẫn trả kết quả theo cue ID cố định; code tiếp tục sở hữu timestamps.
3. Dịch thành lời kể tiếng Việt tự nhiên với dấu câu và nhất quán thực thể. Kiểm tra đối chiếu toàn bản sau dịch, bắt `Volvo → Wooting`, từ vô nghĩa như “cành cây pixel”, sai số và sai chủ thể trước khi gọi TTS.
4. Sửa ranh giới câu dựa trên nguồn đã phục hồi; chia subtitle theo cụm nghĩa và câu. Nếu cần đồng bộ theo từ, dùng dữ liệu alignment thay vì chia tỷ lệ số ký tự.
5. Xác nhận system prompt và model thực sự đến gateway, rồi dùng video này làm ca regression end-to-end. Không coi schema pass hoặc đủ 44 dòng là chất lượng nội dung pass.

Prompt metadata short triển khai trước đó chỉ sinh title/description/tags/hashtags; không thay thế prompt dịch SRT.

## 7. Kiểm chứng, tệp tạo và bàn giao

- [x] Đọc toàn bộ source/translated/timed SRT, final-spoken-text, manifest, timeline và diagnostics của job.
- [x] Đối chiếu các khung hình gốc tại 12.5s, 15.3s, 43.7s, 51s; tính lại hash nguồn khớp manifest.
- [x] Replay offline trên source hiện tại; mạng bị chặn trong probe; kết quả trong `probe-result.json`.
- [x] Không đổi SRT/video gốc, config người dùng hoặc product code.
- [x] `npm.cmd run typecheck`: PASS, node/web đều thành công, exit code 0.

Tệp tạo mới trong thư mục báo cáo: `review.md`, `probe.mjs`, `probe-result.json`, bốn `source-*.png` trích từ video. Không commit hoặc gộp vào nhánh metadata đang chờ quyết định.

Lệnh chạy lại từ gốc TediaPros:

```powershell
node .ai/tasks/2026-09-14-volvo-translation-review/probe.mjs '<thư mục .autoshort-audit của video>'
npm.cmd run typecheck
```

Chưa nghe/chấm toàn bộ chất giọng, chưa chạy dịch lại qua gateway, chưa đánh giá output của một model khác. Các kết luận về lỗi từ và dấu câu dựa trên văn bản lưu thật; các giới hạn planner/validator dựa trên code và replay hiện tại.
