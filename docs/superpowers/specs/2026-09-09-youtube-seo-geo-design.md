# TediaPros — Kiểm chứng SEO/GEO/AEO và thiết kế metadata YouTube

Ngày kiểm chứng: **2026-09-09**. Trạng thái: **đã nghiên cứu, chưa triển khai tính năng**.

Tài liệu này bổ sung kế hoạch tích hợp Linhakaka SEO Localizer theo yêu cầu: **“Kiểm chứng sau đó bổ sung”**. Đầu ra đã chốt với người dùng vẫn là một `tieude.txt`, gồm một tiêu đề được chọn, description ngắn trong một đoạn và tags. Không chuyển yêu cầu này thành dự án xây công cụ nghiên cứu thị trường hay hệ thống chấm điểm AI.

## 1. Kết quả kiểm chứng tài liệu được cung cấp

Các kết luận dưới đây dựa trên trang chính thức đã mở, không dựa vào đoạn trích kết quả tìm kiếm. “Chưa có bằng chứng” chỉ giới hạn trong các nguồn đã kiểm tra, không khẳng định một kỹ thuật không bao giờ hữu ích.

| Nhận định | Kết luận và giới hạn |
| --- | --- |
| SEO vẫn là nền tảng khi tối ưu cho tìm kiếm AI; có query fan-out | **Đúng với Google Search.** Không suy rộng thành cơ chế của mọi AI. [Hướng dẫn Google](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide). |
| `llms.txt` không giúp khả năng xuất hiện | **Đúng trong phạm vi Google:** Google bỏ qua file này. Không đủ căn cứ kết luận cho mọi dịch vụ. [Hướng dẫn Google](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide). |
| Q&A, cấu trúc dễ đọc, thông tin có nguồn giúp nội dung tốt hơn | **Khuyến nghị biên tập có cơ sở**, không phải công thức bảo đảm citation. Bing khuyến nghị nội dung rõ ràng, chính xác, có ví dụ và nguồn hỗ trợ. [Bing AI Performance](https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview). |
| AEO/GEO cần đoạn nhỏ, độ dài cố định hoặc schema riêng | **Không phải điều kiện Google đặt ra.** Không ép mọi video thành FAQ. [Hướng dẫn Google](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide). |
| Nội dung nguyên bản và đa phương thức đáng đầu tư | **Có cơ sở định hướng.** Tuy nhiên SRT không đủ để đánh giá hình ảnh, thumbnail hoặc tính nguyên bản toàn bộ video. [Thông báo hướng dẫn Google](https://developers.google.com/search/blog/2026/05/a-new-resource-for-optimizing). |
| Google rollout báo cáo AI Search tới mọi website ngày 31/8/2026 | **Đã xác nhận.** Bài công bố ngày 3/6 có cập nhật mốc 31/8. Đây là thông tin rollout, không bảo đảm property cụ thể có dữ liệu. [Thông báo Google](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports). |
| Có thể đo hiệu quả xuất hiện trong tìm kiếm AI | **Có, nhưng phải phân biệt chỉ số.** Báo cáo Google Search mô tả impressions trong AI Overviews/AI Mode; không phải “xác suất được AI trích dẫn”. [Tài liệu báo cáo](https://support.google.com/webmasters/answer/16984139). |
| Bing cung cấp citation và grounding queries | **Đã xác nhận công bố public preview ngày 10/2/2026.** Citation counts không thể hiện thứ hạng, uy tín hay vị trí trong câu trả lời. Grounding queries là mẫu dữ liệu; phạm vi không phải mọi công cụ AI. [Thông báo Bing](https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview). |
| “8 lớp” và bộ 10 điểm 0–100 là chuẩn cần triển khai | **Là khung đề xuất của tác giả**, chưa có công thức, nhãn chuẩn, dữ liệu hiệu chuẩn hay kiểm định trong tài liệu. Không trình bày như chuẩn của Google/Bing. `BAO` cũng được tác giả tự đặt tên. |

Lưu ý khi đọc nguồn: trang trợ giúp Google đã ghi rollout 31/8 nhưng vẫn giữ đoạn hướng dẫn chung về rollout từng property và ngưỡng impressions. Vì vậy không suy ra rằng đã kiểm tra được báo cáo trong tài khoản của người dùng.

Một cập nhật liên quan YouTube: Google công bố **platform properties** khả dụng toàn cầu ngày 29/7/2026, gồm YouTube, Instagram, TikTok và X. Do đó không nên nói Search Console chỉ theo dõi website tự sở hữu. Tuy nhiên thông tin này không tự chứng minh API, quyền tài khoản hay báo cáo AI cụ thể đã sẵn sàng cho TediaPros. [Công bố platform properties](https://developers.google.com/search/blog/2026/07/platform-properties-social-video-guide).

## 2. Điều chỉnh quan trọng khi áp dụng cho YouTube

YouTube mô tả tìm kiếm theo relevance, engagement và quality; metadata chỉ là một phần. Tags chủ yếu hữu ích với cách viết thường bị sai, còn title, thumbnail và description quan trọng hơn cho discovery. Vì thế không đặt số lượng tags hoặc “mật độ từ khóa” làm mục tiêu chính. [YouTube Search](https://support.google.com/youtube/answer/16090438?hl=en), [YouTube tags](https://support.google.com/youtube/answer/146402?hl=en).

**Quyết định sản phẩm của TediaPros:** áp dụng cách viết rõ chủ đề, sát nguồn và dễ hiểu; không hứa tăng hạng hay được AI trích dẫn. SEO website như sitemap/canonical, entity graph toàn website, backlink, content gap đối thủ và SXO/CRO không được thêm vào luồng xuất metadata từ SRT.

### Các điểm số trong bài nên được hiểu thế nào?

| Nhóm điểm được đề xuất | TediaPros v1 có thể khẳng định gì? |
| --- | --- |
| SEO Score | Đo được giới hạn ký tự/byte, cấu trúc file và tags trùng; không suy ra điểm ranking. |
| GEO Citation Score / Citation Probability | Không có mô hình đã hiệu chuẩn hoặc dữ liệu citation của nội dung đã đăng. Không xuất điểm. |
| Answerability / Entity Coverage | Có thể hướng dẫn biên tập và so với SRT; không coi nhận xét của LLM là phép đo khách quan. |
| Topical Authority / Originality | Cần tập nội dung và dữ liệu ngoài một SRT. Không suy diễn “uy tín” hay “độc quyền”. |
| Evidence Score | SRT là nguồn nội dung, không tự chứng minh sự thật ngoài đời hoặc độ tin cậy của phát biểu. |
| Multimodal Score | Luồng này không phân tích khung hình/thumbnail nên không có cơ sở chấm. |
| Platform Distribution / Conversion Potential | Cần dữ liệu xuất bản, analytics và mục tiêu chuyển đổi. Ngoài phạm vi hiện tại. |

Không thêm dashboard 10 đồng hồ điểm. Các kiểm tra định dạng có tên và lỗi cụ thể; đánh giá chất lượng ngôn ngữ cần mẫu nghiệm thu, không gắn nhãn “100% bản địa hóa”.

## 3. Phạm vi đã kiểm tra ở app tham chiếu và TediaPros

### CODE_CONFIRMED — app tham chiếu

Đã truy cập đúng phiên Chrome của người dùng và đọc code tại [Linhakaka SEO Localizer](https://aistudio.google.com/apps/48a04219-ec23-4bb3-b636-6944f71abc07?showPreview=true&showAssistant=true).

- React/Vite; logic chính nằm trong `App.tsx`, gọi `@google/genai` với `gemini-3-flash-preview` và yêu cầu JSON schema.
- App sinh nhiều ứng viên tiêu đề, bản dịch tiếng Việt, description, keywords, tags, hashtags và ghi chú. TediaPros chỉ cần **một kết quả tốt nhất và bốn trường người dùng yêu cầu**.
- Có cấu hình quốc gia/ngôn ngữ, kiểu tiêu đề, tên kênh, giọng thương hiệu, độ dài/phong cách mô tả, SEO tone, density và disclaimer.
- “Bộ nhớ thị trường” là lưu/nạp/reset cấu hình qua `localStorage`; không phải dữ liệu thị trường trực tiếp.
- Code đã đọc không cho thấy REST API SEO riêng, nghiên cứu từ khóa trực tiếp, citation tracking hay tự đăng YouTube. Không kết luận rằng nền tảng AI Studio nói chung không thể cung cấp API.
- Chưa chạy một lần sinh nội dung có tính phí; chất lượng output thực tế và cách triển khai khóa của bản deploy chưa được kiểm chứng. Không sao chép cơ chế gọi AI từ renderer vào TediaPros.

### CODE_CONFIRMED — TediaPros hiện tại

- `src/main/videoTitle.ts`: làm sạch SRT, tóm tắt tuần tự khi dài, gọi provider có sẵn, kiểm tra JSON title, chuẩn bị trong lúc render, ghi UTF-8 bằng exclusive create. Hiện tại giới hạn title là **120**, chưa phải giới hạn YouTube 100.
- `src/main/burn.ts`: kiểm tra video đã render, cắt cửa sổ SRT theo thời lượng thực, so digest rồi mới ghi file; lỗi tạo tiêu đề không bỏ video thành công.
- `src/main/autoShortItemCoordinator.ts`: đang gán lại `videoTitle.language` theo `translateTarget`; cần sửa để lựa chọn locale tường minh được giữ nguyên.
- `src/shared/types.ts` / `src/shared/videoTitle.ts`: cấu hình hiện có gồm provider, language, serverUrl; kết quả gồm title/titlePath/titleError, chưa có description/tags/hashtags.
- `VideoTitleSettings.tsx`, `VideoEditor.tsx`, `AutoShort.tsx`: đã có vị trí tích hợp phù hợp; không cần tạo một app web nhúng độc lập.

### TEST_CONFIRMED — hiện trạng, không phải tính năng mới

Ngày 9/9: `npm.cmd run typecheck` PASS; bốn suite title/burn/overlap/AutoShort có **30 pass, 0 fail, 0 skip**. Có fixture FFmpeg 2 giây với AI loopback. Không coi đây là kiểm chứng chất lượng Gemini/OpenAI live hoặc hiệu quả SEO.

## 4. Đặc tả đầu ra bắt buộc

Mỗi video chỉ xuất **một file metadata người dùng** tên `tieude.txt`, UTF-8 không BOM, xuống dòng LF và có newline cuối file:

```text
Rễ cây hút nước như thế nào?

Description:
Video giải thích cách rễ cây hút nước từ đất. Nội dung tập trung vào vai trò của rễ trong quá trình này.

Tags:
rễ cây, hút nước, thực vật

Hashtags:
#recay #hutmoc #thucvat
```

Ví dụ chỉ minh họa định dạng, không phải output AI đã chạy.

- Dòng đầu là đúng một tiêu đề, không thêm nhãn `Title:`/`Tiêu đề:` trước nó.
- Description mặc định `short`, hướng tới 2–3 câu, **một paragraph**. Đây là lựa chọn biên tập của người dùng, không phải quy tắc xếp hạng. Không áp số từ tiếng Anh cứng cho Việt/Trung/Nhật/Thái.
- Medium/long nằm trong phần nâng cao và vẫn là một paragraph. Không cắt chuỗi để làm ngắn vì có thể mất phủ định, điều kiện hoặc kết luận.
- Tags phân cách bằng `, `; trim, chuẩn hóa NFC, bỏ trùng không phân biệt hoa thường; không dùng dấu phẩy bên trong một tag. Cho phép `[]` khi không có tag hữu ích, không bịa để đạt chỉ tiêu số lượng.
- Không xuất thêm `description.txt`, `tags.txt`, metadata JSON, FAQ, citation hay danh sách tiêu đề. Hashtags là phần riêng trong cùng `tieude.txt`, không chèn vào title/description. Audit kỹ thuật hiện hữu vẫn hoạt động; không nhân bản thêm payload SEO riêng cho người dùng.
- `title` tiếp tục là string đơn và `titlePath` vẫn chỉ tới `tieude.txt`.

Giới hạn công bố: title tối đa 100 ký tự; description tối đa 5.000 byte UTF-8; cả hai không chứa `<`/`>`; tags tổng tối đa 500 ký tự, tính dấu phẩy và cặp dấu nháy quy ước với tag chứa khoảng trắng. Đây là giới hạn, không phải độ dài nên nhắm tới. [YouTube videos resource](https://developers.google.com/youtube/v3/docs/videos).

## 5. Bổ sung SEO/GEO/AEO vào nội dung sinh ra

Các quy tắc sau là **thiết kế biên tập đề xuất**, không phải thuật toán ranking được xác nhận:

1. Đọc toàn bộ SRT thuộc video đầu ra; xác định chủ đề, loại nội dung, chủ thể, sự kiện và mức độ chắc chắn trước khi viết.
2. Với video giải thích/hướng dẫn có câu trả lời trong nguồn: câu đầu description nêu ý trả lời chính. Với hài, truyện hoặc tình huống: tóm tắt điểm hấp dẫn có thật; không ép Q&A, không biến lời nhân vật thành sự kiện đã được xác thực.
3. Giữ đúng tên riêng, con số, đơn vị, phủ định, quan hệ và điều kiện. Tên thực thể có bản địa hóa thông dụng được dùng nhất quán. Chọn quốc gia không đồng nghĩa chuyển bối cảnh câu chuyện sang quốc gia đó.
4. Từ khóa xuất hiện tự nhiên khi sát nội dung. Không chèn xu hướng, thương hiệu, tên người nổi tiếng hoặc số liệu không có trong nguồn để tăng chú ý.
5. Không tự tạo citation, URL, “theo chuyên gia”, danh tính tác giả, kinh nghiệm thực tế, tài trợ hay benchmark. Thông tin chưa chắc chắn trong nguồn phải giữ mức độ chưa chắc chắn; một prompt không thay thế kiểm chứng thực tế.
6. Mặc định không CTA và không hashtag trong title/description; hashtags được xuất thành trường riêng, sát nội dung nguồn. Style `conversion` chỉ cho phép lời mời tương tác liên quan, không tự dựng ưu đãi, link mua hoặc lời hứa kết quả.
7. Disclaimer nếu phù hợp là một câu ngắn cuối cùng của cùng paragraph. `auto` mặc định không thêm cho nội dung thông thường; chế độ `affiliate` không được khẳng định có tài trợ/hoa hồng nếu nguồn không cho biết. Disclaimer không “hợp thức hóa” phát biểu sai.
8. SRT, tên kênh và brand voice được gửi dưới dạng dữ liệu; câu lệnh nằm trong đó không được thay đổi ràng buộc nguồn, định dạng hay bảo mật.

Không thêm một vòng LLM chấm điểm hoặc truy vấn web cho từng video trong v1. Cải thiện prompt hiện hữu và kiểm tra đầu ra; không âm thầm tăng chi phí để dựng entity graph/citation engine.

## 6. Cấu hình và tương thích

Giữ các nhóm cài đặt của app tham chiếu, gắn vào vị trí `VideoTitleSettings` hiện có ở cả AutoShort và Video Editor:

| Cài đặt | Mặc định và quy tắc |
| --- | --- |
| Provider/server/key | Giữ lựa chọn Gemini/OpenAI/Local hiện có; key tiếp tục qua API main, không vào preset. |
| Country / language | Country `auto`; suy từ region của locale nếu có. Locale tường minh thắng; `auto` theo ngôn ngữ đầu ra đã biết, nếu chưa biết theo SRT. Không tự đoán US cho mọi tiếng Anh. |
| Title style | `auto`; tùy chọn `title-case`, `sentence-case`, `native`. Không coi Title Case là chuẩn SEO bắt buộc. |
| Channel / brand voice | Rỗng; chỉ định giọng văn, không cung cấp sự kiện/uy tín giả. |
| Description length / style | `short` / `balanced`; có `medium`, `long`, `seo`, `storytelling`, `conversion`, `educational`. |
| SEO tone / density | `natural` / `normal`; có tone `aggressive`, `educational`, `entertainment`, density `light`, `strong`. Mọi mức vẫn cấm nhồi từ và bịa nội dung. |
| Disclaimer | `auto`; các chế độ còn lại `none`, `medical`, `finance`, `legal`, `affiliate`, `safety`, `informational`. |
| Bộ nhớ thị trường | Lưu/nạp/reset một preset local, giống phạm vi app gốc; không đồng bộ cloud và không lưu key. |

Country đổi không ghi đè locale tường minh. UI có danh sách lựa chọn và cho nhập BCP-47 hợp lệ để không mất locale của cấu hình cũ. `en-US`/`en-GB`/`pt-BR`/`pt-PT` không bị rút về mã ngôn ngữ chung.

Cấu hình cũ không có `videoTitle` vẫn tắt tính năng. Cấu hình có `videoTitle` nhưng thiếu SEO giữ provider/language/serverUrl, thêm default ở lúc resolve. JSON preset hỏng không làm crash; bỏ preset hỏng, báo ngắn và cho reset. Cấu hình IPC sai enum/type phải bị từ chối thay vì âm thầm đổi ý người dùng.

## 7. Ranh giới thực thi và an toàn

- Provider chạy trong main qua hạ tầng hiện có; không cần nhúng URL AI Studio hay thêm SDK chỉ để gọi cùng API.
- Giữ lease `server-inference` cho Local, `external-title` cho provider ngoài; giữ timeout 60 giây/request, hủy và giới hạn response. Không thay chính sách dịch/TTS của task khác.
- Prompt version mới `video-seo-v2`; digest chứa mọi cấu hình SEO đã resolve và cửa sổ cues/thời gian. Không tái dùng kết quả chuẩn bị khi country, locale, style, hashtag policy hay nội dung thay đổi.
- Chuẩn bị song song render nếu đã biết SRT đầu ra, nhưng chỉ ghi sau khi probe video hợp lệ và đối chiếu digest. Hủy render phải hủy và thu hồi tác vụ chuẩn bị như hiện tại.
- Kiểm tra JSON runtime, kiểu dữ liệu, giới hạn, control characters và bố cục. Chỉ gộp xuống dòng prose thành khoảng trắng; không gộp mù một danh sách/FAQ thành “paragraph”. Response sai phải báo lỗi metadata, không ghi file rỗng hoặc giả thành công.
- Kiểm tra containment của video/thư mục/file qua `safeContainedPath.ts`. Tên file cố định, không lấy title làm đường dẫn. Exclusive create bảo vệ file có sẵn; chỉ xóa partial do chính lần ghi đó tạo.
- Lỗi SEO giữ video hợp lệ và báo qua `titleError`. Chỉ thêm trường optional `seoMetadata` cho kết quả IPC; không phá trường title cũ, không tạo raw IPC.
- Không log key, URL chứa credential, toàn văn SRT hay provider response. Không khẳng định mọi key hiện tại luôn mã hóa: code có nhánh fallback nếu `safeStorage` không khả dụng.

## 8. Ngoài phạm vi v1 và điều kiện để mở rộng

- Theo dõi Google/Bing/YouTube: cần người dùng kết nối tài khoản, xác minh property/kênh, chọn nội dung đã đăng, kiểm tra API thực tế và định nghĩa riêng từng metric. Không gộp impressions với citations, không biến thiếu dữ liệu thành 0.
- Content gap, topical authority, entity graph: cần corpus và phạm vi đối thủ/website được chọn; không suy từ một SRT.
- Multimodal: cần luồng nhận khung hình/thumbnail riêng và quyền gửi dữ liệu; không gắn nhãn đang phân tích video khi chỉ đọc phụ đề.
- Conversion: cần mục tiêu, event và dữ liệu analytics. So sánh trước/sau không tự chứng minh nhân quả.

Các mục này không phải điều kiện hoàn thành tích hợp metadata. Kế hoạch triển khai tương ứng nằm tại [Implementation plan](../plans/2026-09-09-youtube-seo-geo-integration.md).
