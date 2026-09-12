# ADR 009: Đầu ra AI có schema, parser hữu hạn và publication nguyên tử

- Trạng thái: áp dụng
- Ngày: 2026-09-12
- Phạm vi: dịch phụ đề, title, summary và metadata SEO

## Vấn đề

Prompt yêu cầu JSON không bảo đảm provider sẽ trả đúng JSON. Phản hồi có thể bị cắt, có nhiều candidate, lẫn code fence/JSON vào trường title, dùng alias cũ, lặp key, trả sai ID hoặc chứa một object hợp lệ bên trong outer object chưa đóng. `JSON.parse` đơn thuần cũng nhận key cuối khi key bị lặp và chỉ chạy sau khi body đã được nạp vào bộ nhớ.

Nếu dữ liệu này được sửa theo vị trí hoặc ghi thẳng vào `tieude.txt`, ứng dụng có thể gắn nội dung vào sai cue, resume dữ liệu chưa đáng tin hoặc để lại sidecar bị ghi dở. Schema phía provider giúp giảm lỗi nhưng không thay thế validation trong ứng dụng.

## Quyết định

`src/shared/aiOutput.ts` là ranh giới isomorphic dùng chung. Parser giới hạn byte, depth, member và số candidate; dùng đúng JSON whitespace, kiểm tra escape Unicode, reject duplicate key sau khi giải mã và chỉ dựng object không có prototype. Caller tiếp tục kiểm tra exact keys, kiểu, giới hạn nội dung và protocol contamination theo task.

Title, summary và SEO gửi schema riêng cho Local, Gemini và OpenAI. Adapter giữ completion envelope gồm transport, finish reason, refusal/filter và số candidate. JSON đúng schema vẫn bị từ chối khi transport chưa hoàn tất, `finish_reason` cho biết bị cắt, provider lọc/từ chối hoặc response có tool/thought payload. Body được đọc theo byte trần với UTF-8 strict trước `JSON.parse`.

Đầu ra AI mới dùng contract canonical:

- title: `{"title":"..."}`;
- summary: `{"summary":"..."}`;
- SEO: đúng bốn trường `title`, `description`, `tags`, `hashtags`;
- translation JSON: `{"items":[{"id":"...","text":"..."}]}`.

Translation không map theo vị trí và không nhận alias `t`. Chỉ response sạch hoàn toàn hoặc response chỉ thiếu một tập ID được xác định mới được đưa vào accepted/checkpoint state. Context ID chỉ là warning tương thích và không bao giờ trở thành output cue. Prompt v11 bỏ `source_index`, `start`, `end` lặp khỏi wire payload; ID, source group và speaking-duration cần cho dubbing vẫn được giữ. Prompt/parser version tham gia translation identity.

Title, summary và SEO có tối đa một lượt tái tạo toàn object từ source khi validation nội dung thất bại. Không ghép trường từ hai attempt. Persisted metadata cũ được normalize riêng và có thể suy hashtags từ tags; response AI mới thiếu hashtags bị từ chối.

`tieude.txt` được ghi vào temp cùng thư mục, flush bằng `fsync`, rồi commit no-replace bằng hard link. Cancel trước commit xóa temp do operation sở hữu; cancel sau commit giữ final hoàn chỉnh. Filesystem không hỗ trợ primitive này trả lỗi và không fallback sang ghi trực tiếp. Translation checkpoint được parse có giới hạn, validate sâu và ghi temp + `fsync` + rename.

Khi local provider phớt lờ AbortSignal, operation UI được kết thúc bằng race nhưng lease `server-inference` vẫn thuộc request thật cho tới khi promise settle. Vì vậy request local mới không chạy chồng lên endpoint có trạng thái chưa biết.

## Đánh đổi và giới hạn

- JSON schema của provider là capability request, không phải bằng chứng model/gateway thực thi constrained decoding. Mỗi endpoint/model cần qualification live riêng.
- Finish reason không có được giữ là `unknown`; nội dung vẫn phải qua toàn bộ parser/schema/quality gate và không được ghi nhận là provider-confirmed complete.
- Hard-link commit đã được chạy trên filesystem Windows hiện tại. Network share/filesystem khác chưa được chứng nhận; lỗi ở đó giữ video và không tạo sidecar.
- Validation cấu trúc, ID, token được bảo vệ và heuristic ngôn ngữ không chứng minh bản dịch đúng nghĩa tuyệt đối.
- Checkpoint hỏng/future schema được coi là cache miss nhưng file bằng chứng không bị xóa. Lỗi I/O vẫn nổi lên để không giả làm cache miss.

## Bằng chứng

Các suite `ai-output.test`, `video-seo.test`, `video-title.test`, `translation-response.test`, `translation-orchestrator.test`, `translation-provider-contract.test`, `translation-transport.test`, `translation-resume.test`, `translation-prompts.test`, `translation-planner.test` và `translation-identity.test` kiểm tra các ranh giới trên. Mock provider chứng minh client contract; không thay thế live qualification.
