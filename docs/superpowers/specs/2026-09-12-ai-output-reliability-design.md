# Spec: Đầu ra AI có cấu trúc và phục hồi phản hồi lỗi

- Ngày: 2026-09-12.
- Trạng thái: **SPEC_READY, revision 2 sau adversarial review — chưa sửa runtime**.
- Baseline khảo sát: HEAD `cd7d865`. Kiểm tra lại HEAD và dirty files khi bắt đầu implement.
- Phạm vi yêu cầu: các vấn đề đã bàn trong session — JSON hỏng/lồng Markdown, strict output, code dựng kết quả, mapping bản dịch, kiểm tra nội dung và recovery.
- [Kế hoạch triển khai](../plans/2026-09-12-ai-output-reliability.md).
- [Bàn giao và kết quả baseline](../../../.ai/tasks/TASK-20260912-ai-output-reliability-planning.md).
- [60 tình huống kiểm chứng mở rộng](2026-09-12-ai-output-reliability-adversarial-cases.md).
- [Review findings và cách xử lý](../../../.ai/tasks/2026-09-12-ai-output-reliability-review/review.md).

## 1. Kết quả cần đạt

AI chỉ sinh dữ liệu cần suy luận. Code sở hữu ID/timestamp/thứ tự/schema, kiểm tra phản hồi và dựng artifact cuối cùng. Yêu cầu JSON trong prompt vẫn cần nhưng không thay thế ràng buộc API hoặc validator ở client.

Một phản hồi parse được không mặc nhiên đủ điều kiện lưu, đưa vào TTS hoặc xuất sidecar. Tách ba lớp: **cú pháp**, **hợp đồng dữ liệu**, **chất lượng nội dung**. Không khẳng định code hoặc một lượt AI review bảo đảm dịch đúng nghĩa tuyệt đối.

Metadata lỗi phải tạo lỗi có thể phục hồi; video đã render hợp lệ vẫn được giữ. Bản dịch thiếu/sai định danh hoặc có lỗi protocol chắc chắn không được xuất như bản dịch hoàn chỉnh.

## 2. Bằng chứng và những điều chưa biết

| ID | Mức bằng chứng | Hiện trạng tại baseline | Hệ quả cho thiết kế |
|---|---|---|---|
| E01 | USER_IMAGE | [Ảnh người dùng](../../../.ai/tasks/2026-09-12-ai-output-reliability/user-json-example.png) có title mở đầu bằng `Why...` rồi xuất hiện Markdown/khối metadata mới; không thấy đầy đủ đuôi phản hồi | Tạo fixture tổng hợp mô phỏng cấu trúc; không gọi đó là raw provider response |
| E02 | CODE_CONFIRMED | `src/main/videoTitle.ts:140` localCompletion chỉ trả content; body dùng max_tokens 2048, không gửi response_format và không giữ finish_reason | Metadata cần envelope và capability riêng |
| E03 | CODE_CONFIRMED | `src/main/videoTitle.ts:190` gọi rephraseGeminiCue/rephraseOpenaiCue; các wrapper tại `gemini.ts:380`, `openai.ts:375` không bật schema, chỉ trả string/null | Schema của luồng dịch không có nghĩa metadata đang dùng schema |
| E04 | CODE_CONFIRMED | `src/main/openai.ts:105` có schema dịch strict; `gemini.ts:99` hỗ trợ responseSchema; adapter dịch trả raw/truncated/modelIdentity | Tận dụng transport, không nhân đôi tầng retry |
| E05 | CODE_CONFIRMED | `src/shared/videoSeo.ts:247` parse JSON rồi fallback đúng một object cân bằng; normalizeMetadata dùng chung cho AI và dữ liệu cũ | Cần tách strict AI validation khỏi migration dữ liệu cũ |
| E06 | CODE_CONFIRMED | normalizeMetadata yêu cầu title/description/tags; thiếu hashtags được chuẩn hóa từ tags; chưa reject mọi extra field; JSON.parse không tự báo duplicate property | Schema runtime mới cần chặt hơn, giữ migration cũ riêng |
| E07 | CODE_CONFIRMED | `translation/response.ts:140` kiểm tra truncation, fence, ID, empty và continuation; `:47` còn alias legacy, có nhánh numeric ID ánh xạ theo itemIndex | Giữ guard hiện có, loại bỏ đoán theo vị trí ở contract mới |
| E08 | CODE_CONFIRMED | `translation/orchestrator.ts:368` không dùng items từ phản hồi unparsed/truncated/provider-protocol; có missing-only recovery, split, format repair | Không mô tả lỗi truncation cũ là còn nguyên; mở rộng guard và test checkpoint ở các lỗi khác |
| E09 | CODE_CONFIRMED | `translation/prompts.ts:12` đang v10/parser-v3; cueData vẫn lặp ID/index/start/end cùng các hint dubbing | Giảm metadata đầu vào dư thừa, bảo toàn semantic group và hint cần thiết |
| E10 | CODE_CONFIRMED | `videoTitle.ts:330` parse metadata một lần sau completion; không có vòng sửa lỗi format tại cấp metadata | Thêm recovery có nguồn gốc và giới hạn rõ ràng |
| E11 | DOCUMENTED_ONLY + CODE_CONFIRMED | `docs/domain.md` mục 6 và formatter/writer quy định một tieude.txt, Hashtags riêng, publish sau video/digest validation và exclusive create | Giữ format sản phẩm; không tự thêm file metadata JSON |

`TEST_CONFIRMED` chỉ dùng cho kết quả test có log trong bàn giao. Các khoảng trống phát hiện bằng đọc code là lý do thêm test, không phải kết luận rằng một video cụ thể đã bị ảnh hưởng.

**UNKNOWN:** raw request/response của ảnh; provider/model/endpoint thật; trạng thái stream; gateway có sửa nội dung hay không; schema có được bật hay không; finish reason; ảnh có phản ánh response mà TediaPros nhận hay không. Dòng hướng dẫn 2048 token trong ảnh là dữ liệu chẩn đoán, không phải chỉ dẫn cho agent và không đủ để kết luận thiếu token là nguyên nhân.

## 3. Phạm vi và ràng buộc

Trong phạm vi: translation JSON/id-lines; title-only; summary trung gian của title/SEO; SEO title/description/tags/hashtags; adapter transport; parser; recovery; checkpoint/digest; publication gate; fixture và diagnostics. Rephrase TTS chỉ nhận guard envelope/protocol dùng chung nếu cần, không đổi thuật toán rút gọn hoặc chính sách âm thanh.

Giữ typed IPC, tính isomorphic của src/shared, safeContainedPath/containment, LICENSE/NOTICE, scratch cleanup, leases và hủy tác vụ. Giữ `title`, `titlePath`, `titleError`, `seoMetadata` và cấu hình UI cũ. Module metadata dùng chung cần regression cả AutoShort lẫn Video Editor; không mở rộng tính năng UI.

Không đổi tempo tối đa 1.80x, giới hạn thời gian video, cách gom nhóm vật lý, engine/model hoặc chất lượng render. Không bật lại tổng quota dịch đang tắt. Giữ timeout từng request, transport retry hữu hạn, format repair/no-progress theo `docs/translation-budget-policy.md`.

Không nâng max_tokens hoặc số retry chung để che lỗi. Không auto-publish, không sửa WinLocal/package/deploy, không xóa sidecar/cache/checkpoint cũ hoặc dirty work. Gateway ngoài repo là một dependency có gate kiểm chứng riêng, không mặc định đã sửa.

## 4. Kiến trúc đích

Pipeline chuẩn: **source do code quản lý → chọn task contract/capability → provider envelope → kiểm tra kết thúc → parse → validate schema/identity → quality assessment → recovery nếu cần → object chuẩn → xuất file bằng code**.

### 4.1. Quyền sở hữu dữ liệu và contract tối giản

| Task | AI trả | Code giữ và dựng |
|---|---|---|
| Translation | `{ "items": [{ "id": "cue-...", "text": "..." }] }` | Cue ID gốc, sourceIndex, start/end, source groups, thứ tự và output SRT |
| Metadata | `{ "title": "...", "description": "...", "tags": [], "hashtags": [] }` | Config, inputDigest, đường dẫn, VideoSeoMetadata và tieude.txt |
| Summary | `{ "summary": "..." }` | Part index, tổng part, phạm vi nguồn và nối summary theo thứ tự |
| Title-only | `{ "title": "..." }` | Digest/đường dẫn và title sidecar |

Contract mới reject extra keys, sai kiểu, missing fields, duplicate JSON properties và dữ liệu mâu thuẫn. Không ép number/object/null thành string. Không dùng `t` và `text` như hai đáp án tùy ý. Alias cũ chỉ qua compatibility adapter có version; nếu cả hai hiện diện và mâu thuẫn thì reject.

ID gửi AI là định danh ổn định của đơn vị dịch do planner tạo. Không yêu cầu AI viết lại timestamp; không map bằng array index, dòng thứ N hoặc nội dung gần giống. Nếu sau này cần short ID, mapping phải do code tạo và lưu theo request trước dispatch, có kiểm tra bijection; đây không phải yêu cầu của đợt sửa này.

Đơn giản hóa input dịch: mỗi đơn vị có id, text, group_id khi cần; giữ context nguồn và glossary/synopsis. Với dubbing, giữ hint thời lượng/budget tối thiểu phục vụ cách viết, nhưng không lặp start/end/source_index và ID ở nhiều chỗ. Không loại context chỉ để giảm token. Token comparison trên cùng fixtures là bằng chứng phụ; completeness và alignment là gate chính.

Giữ JSON cho title-only và summary trong đợt này để tránh đổi parser ngầm. Plain text chỉ là lựa chọn hợp lệ cho một task một trường khi có contract riêng được chọn **trước request**; không fallback sang plain text chỉ vì JSON parse lỗi. Metadata nhiều trường luôn JSON; translation compatibility dùng đúng id-lines đã khai báo.

### 4.2. Structured output và capability

Thêm internal contract registry với task/schema/version. Tận dụng transport hiện tại để gửi schema tương ứng cho provider đã hỗ trợ; không truyền schema dịch cho task SEO. Ưu tiên hàm structured completion riêng; giữ các rephrase wrapper cũ cho caller chưa migrate.

Capability phân biệt `schema-constrained`, `json-only`, `id-lines`, cùng evidence `verified/configured/unknown` theo provider + endpoint + model/revision + task + schema version. HTTP 200 hoặc một phản hồi JSON đẹp không chứng minh constrained decoding. Thiếu thông tin dùng profile compatibility hiện hữu và ghi unknown.

Nếu provider từ chối tính năng schema bằng lỗi xác định: nhiều nhất một lần chọn profile compatibility cho operation, ghi downgrade rồi xử lý theo contract đó. Không downgrade trên timeout, 429, auth failure, refusal hoặc JSON malformed. Giữ số request thực tế trong accounting.

Local/gateway: phải kiểm chứng đường đi request option và finish reason end-to-end trước khi ghi verified. Mock client chỉ chứng minh client gửi/đọc field. Nếu gateway chưa hỗ trợ, metadata dùng prompt JSON + strict client validator, translation giữ id-lines; không gọi đó là strict API.

### 4.3. Envelope trước nội dung

Đề xuất internal `AiCompletionEnvelope`:

```ts
interface AiCompletionEnvelope {
  rawText: string
  provider: string
  modelIdentity: string
  operationId: string
  generation: number
  attemptId: string
  inputDigest: string
  contractVersion: string
  formatMode: 'schema-constrained' | 'json-only' | 'id-lines'
  completion: 'complete' | 'truncated' | 'refused' | 'filtered' | 'unknown'
  transport: 'complete' | 'incomplete'
  finishReason?: string
  requestId?: string
}
```

Giới hạn body/byte/depth thực hiện khi đọc/parse, không sau khi đã nạp vô hạn. Giữ status HTTP và phân loại timeout/cancel/transport/protocol riêng. Nếu có streaming, chỉ validate nội dung sau terminal event; chunk chưa hoàn tất không được publish/checkpoint accepted.

`truncated/refused/filtered` không được accept dù rawText tình cờ là JSON hợp lệ. `unknown` chỉ dành cho **thiếu bằng chứng kết thúc model sau transport hoàn chỉnh**, không bao gồm đứt kết nối/thiếu terminal stream/invalid envelope. Profile tương thích có thể accept cấu trúc đầy đủ với completion evidence unknown, nhưng nội dung đáng ngờ phải đi recovery/assessment. Không suy ra trọn ý chỉ từ finish_reason=stop. Mọi field identity trong envelope do client gắn từ operation đang chạy, không tin identity do model echo.

### 4.4. Parse có giới hạn và quy tắc extraction

1. Trim whitespace/BOM ở biên; không sửa bên trong text.
2. Parse đúng một JSON root theo contract; có thể unwrap một fence hoàn chỉnh theo profile compatibility đã chọn.
3. Metadata compatibility cho phép một object hoàn chỉnh trong lời dẫn, nếu scanner xác nhận ranh giới không mơ hồ và không có object ứng viên thứ hai hoặc phần JSON hỏng ở ngoài. Tất cả object ứng viên đều được đếm, kể cả object không đúng schema; không chọn object “có vẻ hay nhất”.
4. Scanner phải hiểu quote, escape, nesting và fence. Không lấy `{...}` bằng regex tham lam; không đếm ngoặc nằm trong chuỗi như cấu trúc. Duplicate property được phát hiện trước bước JSON.parse làm mất thông tin, kể cả tên key dùng Unicode escape tương đương.
5. Không extraction từ một chuỗi JSON hoặc outer object đang hỏng/chưa đóng như hình. Trường hợp đó chuyển `invalid-json`/`protocol-contamination` để regenerate. Việc nhìn thấy object bên trong không chứng minh đủ ranh giới an toàn.
6. Không tự thêm dấu nháy/ngoặc, xóa phần lỗi, đổi dấu nháy đơn, chạy eval hoặc “repair” bằng nối chuỗi. Không nhận partial JSON như object đầy đủ.

Nhãn parse outcome nội bộ: `clean`, `unwrapped`, `extracted`, `rejected`; lưu issue codes và span/byte counts để audit. Outcome extracted vẫn phải qua schema/content validation. Dùng cùng pure parser primitive nếu hữu ích, nhưng policy translation/SEO riêng; không nới translation để nhận prose bằng metadata fallback.

### 4.5. Validate nội dung và tương thích cũ

**Translation:** đủ đúng tập ID, không trùng, unknown/context IDs không xuất thành cue; không text rỗng, mất continuation, delimiter cue tràn vào lời thoại. Context echo có thể loại với warning như hiện tại nếu mọi phần cần dịch vẫn rõ ràng. Strict path không đoán numeric IDs; alias cũ chỉ chấp nhận mapping request-local được khai báo rõ ràng, bijective.

**SEO:** mọi response mới cần đúng bốn trường. Giữ giới hạn hiện hành: title 100 Unicode code points; description một paragraph, tối đa 5000 byte UTF-8; tag accounting và hashtag giới hạn hiện tại; không hashtag trong title/description. Title-only tiếp tục 120 code points theo contract riêng. Không cắt đuôi nội dung để ép độ dài: lỗi độ dài cần regenerate/rephrase có giữ nghĩa.

Tách `validateAiVideoSeoMetadata` (strict input mới) khỏi `normalizeVideoSeoMetadata` (migration persisted state cũ). Dữ liệu cũ thiếu hashtags tiếp tục derive từ tags; dữ liệu AI mới thiếu trường phải repair. Dedupe/chuẩn hóa hashtag chỉ dùng quy tắc xác định, không sinh thêm chủ đề.

**Protocol contamination:** title/summary/description/text không được chứa envelope/fence/output-schema bị chèn nhầm. Detector dùng cấu trúc và context, không reject mọi dấu `{`, `}` hoặc từ JSON trong nội dung hợp lệ. Test phải có video nói về JSON/code và câu chứa ngoặc, trích dẫn để tránh false positives.

**Semantic assessment:** giữ language/protected-token checks; thêm fixture source-target lệch cue, câu bị cắt nhưng vẫn JSON hợp lệ, số/tên/phủ định sai, metadata bịa sự kiện. Với bất thường heuristic, repair đúng cue/group kèm nguồn và đánh giá lại. Không dùng dấu chấm cuối câu như bằng chứng chắc chắn vì source cue có thể là fragment.

Phân loại `certain/heuristic/unknown` độc lập structural validity. Lỗi chắc chắn chặn publish; warning heuristic còn lại giữ policy hiện hành của translation (không tự đổi sang chặn mọi ngôn ngữ). Semantic verification không hỗ trợ phải ghi unknown. Với SEO, bằng chứng chắc chắn không được nguồn hỗ trợ thì reject/repair; không khẳng định tag relevance hoặc nghĩa đúng chỉ bằng regex.

### 4.6. Recovery và accepted state

| Lỗi | Hành vi |
|---|---|
| Fence hoàn chỉnh hoặc metadata prose wrapper an toàn | Normalize/extract một lần, validate đầy đủ, không gọi lại AI |
| JSON lồng trong title/outer malformed như ảnh | Reject; regenerate từ source + contract + issue codes |
| Nhiều object, duplicate property, schema sai | Không chọn đáp án; repair đúng task |
| Translation chỉ thiếu ID; phần còn lại không có lỗi khác | Giữ subset đủ điều kiện; yêu cầu missing IDs với source group/context |
| Truncated, unparsed continuation, protocol contamination | Không giữ bất kỳ item nào của response đó là accepted; retry/split scope bị ảnh hưởng |
| Duplicate/unknown hard error/ID mơ hồ | Quarantine response; không commit vào accepted/checkpoint trước khi quyết định validation |
| Semantic suspect | Repair một lượt tập cue/group bị ảnh hưởng; giữ evidence và đánh giá lại |
| Metadata sai format/schema/độ dài | Một lần regenerate trọn bốn trường; không vá từng trường từ nhiều đáp án |
| Auth/refusal/filter/cancel | Dừng đúng loại lỗi; không format repair/refusal bypass |
| 429/5xx/network | Theo transport policy hiện hữu, không nhân retry trong parser |

Metadata/title/summary: tối đa một content/format repair cho mỗi operation inputDigest + task (mỗi summary part là một operation có round/part identity riêng theo mục 4.11). Không đệ quy recovery. Response invalid lặp lại cùng fingerprint hoặc không cải thiện dừng ngay. Capability downgrade tối đa một lần riêng, không reset repair count. Timeout từng request và AbortSignal vẫn áp dụng trong backoff, đọc body, repair. Cancel/write race phải tuân theo commit point tại mục 4.9, không xóa file chỉ vì cancel đến sau commit.

Translation giữ quota tổng đang tắt; cây split hữu hạn theo số cue, singleton dừng khi không tiến triển, tối đa một format repair cho cùng bộ ID theo policy hiện hữu. Fingerprint phải ổn định theo tập ID, issue codes và nội dung chuẩn hóa, không bị timestamp/requestId đánh lừa. Không reset counters qua wrapper hoặc khi restart.

Repair nhận nguồn gốc + output contract + danh sách lỗi do code tạo; raw output nếu cần là dữ liệu không tin cậy, không là system instruction. Không gửi credentials/headers. Với response dài, giữ source cần thiết và excerpt bounded có nhãn incomplete, không cắt source âm thầm.

### 4.7. Checkpoint, version, xuất file và diagnostics

Chỉ commit accepted subset sau gate validation tương ứng; parse candidates không đồng nghĩa accepted. Partial checkpoint phải giữ assessment/issue/completion evidence; crash/resume không nâng partial thành complete. Cache cũ không đủ parser/schema identity trở thành cache miss hoặc phải revalidate, không tự xóa dữ liệu.

Tăng prompt/parser/schema/assessment versions khi đổi hành vi và đưa vào translation identity, SEO/title digest. Baseline v10/parser-v3/video-seo-v2/video-title-v2; chọn version tiếp theo sau khi đối chiếu các thay đổi đồng thời. Không reuse prepared metadata từ policy cũ chỉ vì SRT giống nhau.

Version/digest migration là phần bắt buộc **cùng thay đổi hành vi tại P1–P4 trước khi bật caller mới**; P5 chỉ tăng tiếp những version thực sự đổi. Không trì hoãn việc này đến giai đoạn tối ưu prompt.

Code dựng object canonical, serialize JSON nội bộ bằng JSON.stringify; SRT dùng builder hiện có; output người dùng vẫn **một tieude.txt** với title, Description, Tags, Hashtags. Giữ video-valid + digest-match + containment + exclusive-create gate. Không ghi output từ raw model hoặc rawText dùng làm tên file/path. Lỗi metadata không rerender/xóa video hay ghi đè sidecar có sẵn.

Diagnostics thông thường: task, provider/model, schema/parser versions, capability evidence, finish reason, response length/hash, issue codes, repair count, outcome và duration; không ghi key/cookie/auth header/full prompt vào log thông thường. Khi bật chế độ chẩn đoán, lưu request/response đã bỏ secret trong item-scoped evidence có containment và disk budget; đề xuất giới hạn 256 KiB/attempt, 4 MiB/item, đánh dấu omitted/truncated khi vượt. Đây là giới hạn lưu evidence, không phải quota request dịch. Raw capture phải được gắn source digest và policy version; cleanup theo scope hiện hữu, export thủ công mới thành durable artifact.

### 4.8. Generation, late response và quyền sở hữu công việc

Client tạo immutable operation snapshot: job/item ID, task, source digest, output artifact identity, requested IDs/mapping, config/contract versions, resolved provider/model và generation. Thay config/source hoặc manual retry tạo generation mới; operationId khác với content hash để hai video giống SRT không chia sẻ quyền ghi file.

Mọi callback, repair, checkpoint merge và publish so sánh operationId + generation + active attemptId với owner hiện tại. Response từ attempt đã timeout/hủy/thay thế không được ghi state, xóa file, sửa progress hoặc làm complete item mới; chỉ ghi `stale-response-discarded` không kèm raw content. Duplicate callback idempotent; `attemptId` không tái sử dụng.

Một owner cho mỗi item/generation và một writer cho mỗi checkpoint/output target. Hai cửa sổ/process/manual retries cùng lúc phải qua claim/lock hoặc compare-and-swap có fencing token. Hash giống nhau không chứng minh cùng owner. Lock recovery sau crash chỉ reclaim khi xác minh owner cũ đã dừng; không dựa riêng vào elapsed TTL.

Prepared metadata được chia sẻ nội dung chỉ khi policy cho phép và identity đầy đủ khớp; publication luôn bind lại video hiện tại. Input timestamp dùng canonical representation đúng độ chính xác contract; nếu dùng rounding, phải chứng minh không làm hai output semantics khác nhau trùng identity. Provider/model đã resolve không được thay bằng alias `llm-default` trong evidence. Revision chưa biết chỉ cho cache phiên/generation theo profile, không tái dùng durable cache giữa phiên như đã qualified.

### 4.9. Sidecar commit, crash và lỗi đĩa

`open(..., 'wx')` chỉ là điều kiện không ghi đè; không đủ chứng minh file luôn hoàn chỉnh khi process chết. Publisher phải nhận cancellation/generation fence từ caller và có các trạng thái `prepared → committing → committed` hoặc `failed/cancelled`.

Viết vào temp duy nhất trong thư mục đích đã kiểm tra, flush/close và validate nội dung/hash; trước commit kiểm lại containment, video identity/digest và owner. Commit final theo primitive **atomic và no-replace được kiểm chứng trên filesystem mục tiêu**. Không mặc định rename có tính no-replace; không fallback sang ghi trực tiếp final khi atomic primitive không được hỗ trợ. Primitive cụ thể là P3 implementation spike có test trên Windows và macOS mục tiêu; nếu filesystem/share không đáp ứng, giữ video và báo metadata-save-unsupported.

Writer kiểm lại canonical artifact theo output contract/version tại biên publication, không tin TypeScript type hoặc object mutable do caller chuyển vào. Legacy normalizer chỉ đọc/display/migrate dữ liệu cũ; không là đường bypass strict AI validation khi ghi output mới. Nội dung/hash chuẩn bị để commit là snapshot bất biến.

Commit point là thời điểm final được công bố thành công. Cancel thắng trước commit: không có final mới, dọn temp thuộc owner. Commit thắng trước cancel: giữ final hợp lệ, trả committed outcome; không xóa file đã commit. Không thể bảo đảm rollback mọi I/O chỉ vì AbortSignal được set.

Receipt nội bộ có operation/generation, final hash, video digest và trạng thái commit; không thêm file metadata JSON cho người dùng. Crash sau commit trước receipt: reconcile bằng manifest prepared + hash + identity; receipt thiếu không đồng nghĩa được phép ghi đè. File có sẵn không khớp identity/hash trở thành conflict, giữ nguyên. Chỉ dọn temp/file dở dang khi chứng minh ownership; file không rõ nguồn gốc không xóa.

Fault injection: ENOSPC/EACCES/EPERM, mất ổ/network share, short write, crash mỗi bước, final xuất hiện giữa check và commit, junction/symlink đổi parent, video bị thay hoặc xóa. Revalidate path sát thao tác và dùng filesystem primitive/handles phù hợp; không claim chống mọi adversarial path race nếu platform chưa có bằng chứng. Process-crash integrity và power-loss durability là hai mức khác nhau; không claim power-loss trên mọi filesystem từ unit tests.

### 4.10. Envelope, HTTP và stream không mơ hồ

Mặc định giữ non-stream request hiện hữu, không tự thêm streaming tính năng mới. Nếu endpoint trả SSE cho non-stream hoặc HTML/error object trong HTTP 200: protocol error, không parse đó như model JSON. Transport hoàn chỉnh cần body đọc hết bình thường và envelope hợp lệ; EOF do socket error/length mismatch/abort là incomplete kể cả phần nhận được parse được.

Không gộp nhiều choices/candidates hay chọn “JSON đầu tiên parse được”. Request chọn một candidate; unexpected nhiều candidate không phân biệt được theo contract phải reject. Provider adapter chỉ lấy final answer text parts theo schema envelope đã biết; không nối reasoning/thought/tool-call/refusal vào rawText. Tool-call không được yêu cầu là protocol error; refusal/filter có ưu tiên so với content tưởng hợp lệ. Empty/null content được phân loại riêng, không coerce.

Streaming nếu đã được profile hỗ trợ cần state machine: chọn đúng choice, giữ thứ tự chunk, validate terminal và UTF-8 qua ranh giới chunk; missing/duplicate/conflicting terminal event hoặc tool-call delta bất ngờ bị chặn. SSE comment/keepalive không tính là tiến triển nội dung. Stream ghép nhiều lần không làm nhân đôi text.

Cancel/timeout tác vụ logic phải trả kết quả hữu hạn, nhưng không được trả lease rồi cho request mới vào cùng local server khi request cũ còn chiếm tài nguyên. Phân biệt `client-settled`, `transport-settled`, `server-stop-confirmed/unknown`. Với local server chưa xác nhận dừng, endpoint chuyển unavailable cho dispatch mới cho tới khi API cancel/status, reconnect/probe có bằng chứng idle, hoặc reset do người dùng yêu cầu xác nhận an toàn. Không giữ UI chờ vô hạn, không block các endpoint/task không liên quan, không tự restart shared server.

Nếu không có API kiểm chứng server idle, ghi rõ hạn chế; không dùng sleep rồi tự coi server đã dừng. Với cloud service, abort chỉ bảo đảm client bỏ response, không hứa dừng tính phí hay tính toán từ xa. Leases phía client và server liveness phải được báo cáo riêng. Test phải assert số request đang active, không chỉ đo Promise.race trả nhanh.

### 4.11. Chứng minh termination và phân loại retry

Một scheduler sở hữu recovery; inventory số wire requests bao gồm credential failover, discovery, model selection và nested wrappers. Pin model cho operation, không model-hop khi nội dung sai. Credential failover nếu đã có policy được đếm với danh sách snapshot hữu hạn, không quay vòng vô hạn các key bị quota. Auth/refusal không được biến thành content repair.

Metadata có tối đa ba content dispatch slots: initial, optional schema downgrade, optional repair. Transport retry mỗi slot theo policy hữu hạn hiện hữu; schema downgrade không cấp thêm repair. P2 phải ghi bound wire attempts sau khi tính failover thực tế, không chỉ chứng minh ba lời gọi wrapper. Không thêm tổng quota dịch để thay chứng minh termination.

Với translation, mỗi nhánh recovery phải làm một trong ba việc: tiêu hao repair slot chưa dùng; accept thêm ID và giảm nghiêm ngặt tập còn thiếu; split thành các tập con không rỗng, rời nhau, nhỏ hơn tập cha. Singleton hết slot phải terminal. Thứ tự response/issue hoặc thay vài ký tự không reset rank/counters. Source planner không được phát sinh unit mới vô hạn khi recovery; grouping/semantic repair không được nối ngược các batch đã split để lặp lại cây cũ.

Một lượt quality repair có cây riêng và autoRepairContentWarnings=false trong tất cả hậu duệ. Fingerprint chỉ là detector bổ trợ, không là bằng chứng duy nhất về termination. Persist charge trước dispatch; restart sau dispatch trước response ghi in-flight unknown, không làm lại vô hạn bằng counters mới. Manual retry rõ ràng là generation mới; không giả định provider có exactly-once execution sau crash.

Retry-After/date/status/timeout cần parser bounded: reject NaN/negative/overflow; chỉ retry class được phép; chờ dài không vượt request/backoff policy hiện hữu, có AbortSignal và tiếp tục được sau pause mà không giữ lease. Dùng monotonic clock cho elapsed, không lấy thay đổi đồng hồ hệ thống làm tiến triển. 400 invalid schema khác unsupported feature; cấu hình sai cần lỗi rõ ràng, không downgrade mọi 400/422.

Summary chain: operation key gồm parent digest + round + part index + exact chunk digest. Mỗi vòng phải giữ đủ coverage chunk và giảm nghiêm ngặt độ dài context hoặc số part theo rank được định nghĩa; output đủ schema nhưng không thu nhỏ chuyển no-progress. Summary bị lỗi không được bỏ part để tiếp tục. Không thể chứng minh bảo toàn toàn bộ ngữ nghĩa qua tóm tắt bằng coverage ký tự; ghi riêng semantic uncertainty.

### 4.12. Giới hạn cụ thể, Unicode và source preflight

Trước request: kiểm tra source IDs duy nhất, text string, timestamp hữu hạn/thứ tự hợp lệ theo contract hiện hữu, config/schema/task hợp lệ, requested/context mapping không xung đột. Source rỗng không gọi AI; task title không xác định được chủ đề có lỗi `insufficient-source`, không tự bịa title cho đủ schema.

Đề xuất limits phiên bản đầu (implementation phải test boundary, không tự nâng khi lỗi):

| Boundary | Giới hạn |
|---|---|
| Metadata/title/summary HTTP body sau giải nén | 256 KiB; content text UTF-8 tối đa 64 KiB và giới hạn field hiện hành |
| Translation HTTP body sau giải nén | 2 MiB; content text UTF-8 tối đa 1 MiB; planner phải split trước nếu ước lượng vượt |
| JSON depth / candidate roots | Depth 16; dừng reject khi thấy candidate thứ hai, không tiếp tục scan tìm đáp án |
| Collection lengths | Translation tối đa expected IDs + known context IDs; metadata tags và hashtags mỗi list tối đa 100 trước dedupe, giữ tổng 500 ký tự hiện hành |
| Scalar strings | Bound riêng task; summary giữ 2000 UTF-16 code units hiện có, SEO title 100 và title-only 120 Unicode code points |

Đếm bytes sau giải nén, không tin Content-Length; body limit áp dụng cho provider envelope trước JSON.parse và content limit sau extraction. UTF-8 lỗi/incomplete và escaped lone surrogate bị reject, không tự thay U+FFFD rồi accept. Byte cap + depth + array/member caps phải giới hạn cả các bước scan/validation, không stringify/clone raw object vô hạn. Nonfinite numeric source/config không serialize thành null rồi gửi AI.

Duplicate keys so sánh sau JSON escape decoding, không NFKC/case-fold để gộp ID khác nhau. Reject `__proto__`/`constructor`/unknown keys theo schema; dùng Map hoặc object không prototype cho mapping, không deep-merge raw object vào config. Text được chuẩn hóa NFC/whitespace chỉ theo task đã định nghĩa, kiểm tra raw trước normalize nếu normalize có thể che control/newline/schema contamination.

Giữ ZWJ/ZWNJ và ký tự script có nghĩa (Arabic/Indic/emoji); không xóa toàn bộ Unicode format characters bằng blacklist rộng. ID so sánh chính xác, không dùng hình thức nhìn giống nhau để alias. id-lines có đúng một physical line cho mỗi ID; continuation không parse được phải lỗi, không drop. JSON text có escaped newline hợp lệ được giữ theo subtitle contract; không ép mọi cue thành một dòng.

### 4.13. Mức đảm bảo nội dung và tính đúng của repair

Response có thể sao chép ví dụ schema/giả vờ trả lời refusal bên trong string, chuyển toàn bộ nội dung sang một cue, hoặc sửa số/phủ định mà vẫn vượt schema. Automated checks cần phân biệt lỗi protocol chắc chắn với semantic suspicion. Metadata của video hướng dẫn JSON có thể hợp lệ khi title nhắc JSON; không có lexical detector tổng quát chứng minh mọi trường hợp screenshot-like bị loại mà không false positive.

Ba đường kết quả: `structural-error` chặn; `quality-warning` theo policy hiện hành và một lượt repair có nguồn; `quality-unknown` hiển thị trong evidence, không gọi semantic validated. Đáp án của AI verifier cũng là dữ liệu untrusted có contract/version; không thêm verifier bắt buộc cho mọi request nếu chưa có corpus đo false positive/negative và chi phí. Với nội dung chưa có verifier, bảo đảm ở mức cấu trúc/định danh, không hứa sửa mọi bản dịch sai nghĩa.

Repair chỉ thay candidate khi vượt toàn bộ structural gate và không làm xấu các protected checks xác định; nếu không có cách chứng minh improvement, giữ warning/error phù hợp, không đánh dấu sửa xong chỉ vì text khác. Không xuất candidate trước đó vốn có hard error. Câu nguồn lặp, cùng source/target locale, tên/số có cách viết tương đương và source fragment là positive controls bắt buộc. Summary/SEO không bị yêu cầu lặp mọi con số trong toàn bộ transcript; chỉ kiểm tra claim mà chúng thực sự đưa ra.

Input ASR sai/ngắt sai vẫn là nguồn không chắc chắn; recovery JSON không tự sửa facts/ASR, đổi grouping vật lý hoặc bỏ cue. Source text, glossary, brand voice và previous output đều là data: test prompt injection qua marker/newline/JSON escape và yêu cầu ghi path; code chỉ ghi whitelist fields/path do ứng dụng quyết định.

### 4.14. Checkpoint sâu, capability drift và rollout

Checkpoint phải validate nested plan/mapping/batches/counters/assessment/generation và bound file size trước read/parse. Reject duplicate properties, arrays thay records, key conflict, nonfinite counters, future schema và missing identity; filesystem I/O error khác cache miss. Corrupt checkpoint không làm crash app hoặc bị coi valid chỉ vì có SHA-shaped key. Giữ bản cũ, tạo recovery state riêng có reason; không downgrade counter của lần dispatch chưa biết kết quả.

`json-only` phải ghi thêm enforcement `api-json-mode` hoặc `prompt-only`, không gộp hai mức đảm bảo. Capability key gồm endpoint canonical không secrets + resolved model + server/profile revision + task/schema; đổi một thành phần invalidates evidence. Không log URL userinfo/query token. Unsupported-schema downgrade là per-operation, không đầu độc global capability từ auth/transient/server error.

Bật mới theo provider/task profile sau tests; diagnostic operation luôn biết grammar/version đang dùng. Rollback vẫn dùng namespace/cache version tương ứng và validate dữ liệu persisted; không âm thầm bật normalizer legacy cho AI response mới. Live qualification cần clean case, wrapper/compatibility case, refusal/truncation evidence nếu provider cho tái hiện, repeated runs và edge corpus; một request chỉ là smoke test. Ghi số mẫu/thất bại/repair/unknown, không suy ra tỷ lệ lỗi production bằng 0 từ mẫu nhỏ.

### 4.15. Diagnostics không trở thành nguyên nhân thất bại

Logging/evidence failure (disk full, locked file, redaction exception) không được biến video hợp lệ thành failed hoặc làm parser retry. Trả bounded issue nội bộ; tránh recursive log-on-log-failure. Content/key có thể bị provider echo vào error: redact secret trước serialize và giới hạn output; default không lưu raw, opt-in debug vẫn chứa nội dung riêng tư và phải nằm trong item scope.

Hash raw và hash normalized có nhãn khác nhau; hash không được dùng làm bằng chứng nội dung đúng. Evidence omitted/truncated là trạng thái của capture, không sửa completion state của model. Reservation evidence phải nằm trong disk budget tổng; nhiều item cùng chạy không mỗi item tự coi còn đủ đĩa. Recovery counters/receipt tối thiểu không phụ thuộc debug capture; tắt debug không làm mất fencing hoặc termination.

## 5. Acceptance criteria

- AC01: Fixture mô phỏng ảnh không thể lọt thành title hoặc sidecar; recovery hợp lệ tạo đúng bốn trường.
- AC02: Schema-aware request được chứng minh bằng transport mock cho từng provider/task; unsupported profile có downgrade rõ ràng, không ngụy nhận verified.
- AC03: Truncated/refused/filtered bị chặn dù JSON hợp lệ; unknown không bị gọi là provider-complete.
- AC04: Strict parser reject duplicate properties, nhiều root, missing/extra/wrong-type fields, fence hỏng; giữ escape/Unicode/nội dung hợp lệ.
- AC05: Translation mapping theo ID không phụ thuộc response order; không fallback vị trí, không đổi timestamp hay source group mapping.
- AC06: Missing-only recovery giữ đúng subset; corrupted response không được persist/resume như accepted.
- AC07: Phản hồi đúng JSON nhưng protocol contamination bị chặn; semantic quality có evidence/certainty tách biệt.
- AC08: Metadata repair tối đa một vòng; retry/split dịch có rank hữu hạn theo policy; cancel/timeout kết thúc task logic và xử lý lease theo server liveness tại mục 4.10.
- AC09: Persisted metadata cũ vẫn render được, thiếu hashtags có migration; AI mới thiếu hashtags bị repair.
- AC10: Version/digest mới ngăn dùng lại artifact chưa được validate theo contract mới; không xóa dữ liệu cũ.
- AC11: Metadata lỗi/hủy không làm mất video; sidecar đúng format, containment, digest, exclusive create.
- AC12: Log không lộ credentials; evidence bounded; tests/typecheck và live qualification được báo cáo riêng.
- AC13: Late/duplicate response, concurrent retry và config change không thể mutate generation hoặc publish target khác.
- AC14: Cancel/timeout khi provider không hợp tác không làm UI treo hoặc dispatch chồng local request khi server state unknown.
- AC15: Sidecar commit atomic/no-replace trên filesystem qualified; crash/cancel race có outcome xác định, không xóa file không thuộc owner.
- AC16: Incomplete transport, ambiguous candidates, tool/thought/refusal payload không thể masquerade thành complete/unknown hợp lệ.
- AC17: Wire-attempt inventory, recovery rank, summary progress và restart counters có test; không reset quota ẩn hoặc tạo vòng lặp vô hạn.
- AC18: Byte/depth/member/Unicode/preflight bounds cụ thể được test cả biên hợp lệ và vượt biên; không làm sai script/ID.
- AC19: Content tests có positive/negative controls; structural/quality warning/unknown tách biệt; repair không được claim improvement chỉ từ text đổi.
- AC20: Nested checkpoint validation, version/capability drift và rollback được kiểm chứng trước bật caller mới.

## 6. Gate phát hành và giới hạn chứng minh

Unit/fixture tests chứng minh parser, state transitions và contracts cục bộ. Mock provider không chứng minh gateway/model thật tôn trọng schema hoặc chất lượng dịch. Live qualification trên endpoint/model người dùng chọn phải ghi config không có secrets, raw evidence khi bật, finish reason, số repair và kết quả đối chiếu nguồn. Chỉ claim profile đã verified trong phạm vi bằng chứng đó; không claim mọi model luôn trả đúng.

Đợt lập tài liệu này kết thúc ở spec/plan và baseline. Không yêu cầu quyền deploy để viết tài liệu, không tự sửa backend ngoài repo. Khi triển khai, có thể hoàn tất client compatibility và offline tests độc lập; phần strict gateway chỉ đóng khi có evidence end-to-end.
