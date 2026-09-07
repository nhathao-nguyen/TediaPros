# Review flow dịch và guards đa ngôn ngữ

Ngày: 2026-09-07. Code được rà soát: `3d49b84`, branch `codex/autoshort-optimization`.
Phạm vi: AutoShort coordinator, Local/Gemini/OpenAI translation, prompt/parser,
grouping, content QA, checkpoint/cache, retry và khả năng chọn ngôn ngữ.
Đây là báo cáo kiểm tra, chưa sửa hành vi runtime hoặc gọi lại dịch/TTS có phí.

## Kết luận

Chưa đủ điều kiện cam kết mọi video/mọi ngôn ngữ. Có cả false rejection lẫn
nguy cơ mất nội dung hoặc dùng bản dịch cũ. Mục tiêu có thể nghiệm thu là:
mọi item kết thúc hữu hạn với trạng thái rõ ràng; không chặn bởi heuristic chưa
đủ chắc chắn; không báo thành công khi mất cue; chất lượng chỉ được xác nhận
cho những tổ hợp nguồn/ngôn ngữ/model đã qua đánh giá.

## Flow code hiện tại

1. Whisper/OCR tạo source cues; cấu hình ngôn ngữ nguồn ưu tiên hơn ngôn ngữ
   Whisper phát hiện. Coordinator lưu checkpoint nguồn.
2. Nếu có bản dịch checkpoint cùng số cue thì dùng lại. Nếu không, thử artifact
   cache rồi mới gọi provider. Có kiểm tra kiểu, số lượng và timing cho cache.
3. AutoShort luôn yêu cầu `mode=dubbing`, kể cả khi không bật TTS.
4. Local chia khoảng 24 cue/2.000 ký tự theo nhóm, gửi prompt chung và ID/timing/
   context. Output yêu cầu dạng `[id] text`, parser cũng nhận JSON có ID.
5. Gemini/OpenAI chia theo mặc định 20.000 ký tự, không có trần cue tương tự;
   yêu cầu JSON schema, xử lý model fallback riêng.
6. Provider map lại bằng ID; AutoShort kiểm tra hệ chữ và ghi SRT theo timing nguồn.
7. Bản dịch được lưu cache/checkpoint; content QA chạy sau đó, trước TTS/render.
8. Item lỗi được ghi terminal và queue tiếp tục. Lần bấm chạy lại có thể đọc cùng
   checkpoint và bị chặn lại bởi cùng validator.

## Findings theo mức ưu tiên

### P1 — Content QA áp đặt biểu diễn ngôn ngữ thay vì kiểm chứng ý nghĩa

`src/main/autoShortContentQuality.ts:17,44,59,107`.
Negation chỉ có Việt/Anh; số dùng `\d`, đơn vị chủ yếu Việt/Anh. Tất cả mismatch
đều là error. Repro trực tiếp bằng hàm hiện tại:

| Nguồn → đích | Kết quả hiện tại |
|---|---|
| `不要摸这只狗。` → `Do not touch this dog.` | Bị chặn `( -> neg)` |
| `Có 2 con chó.` → `There are two dogs.` | Bị chặn `(num:2 -> )` |
| `There are 12 dogs.` → `هناك ١٢ كلبًا.` | Bị chặn `(num:12 -> )` |
| `Có 1,5 lít.` → `There are 1.5 liters.` | Pass |

Incident thật đã có 101/101 cue, zh→en, 10 protected-token findings. Câu đầu
11,53–13,53s có phủ định tiếng Trung nhưng validator chỉ nhận `Don't` ở đích.
Điều này chứng minh nguyên nhân chặn, không chứng minh toàn bản dịch đúng nghĩa.

Đề xuất: tách structural errors khỏi semantic warnings; dùng locale và confidence
cho số/đơn vị/phủ định. Khi không hỗ trợ một ngôn ngữ, kết quả phải là unknown,
không được xem là mất thông tin. Không chỉ vá thêm từ tiếng Trung vào regex.
Các nghi vấn quan trọng phải hiển thị và lưu audit; cảnh báo không đồng nghĩa
với chứng nhận semantic quality.

### P1 — Parser có thể bỏ mất dòng dịch nhưng vẫn đủ cue ID

`src/main/translate-shared.ts:205-237` bỏ qua dòng không khớp `[id] text`.
Repro: `[c1] First part\nsecond part` trả về chỉ `{id:c1,text:First part}`.
Nếu c1 là ID duy nhất, kiểm tra cardinality vẫn có thể pass.

Đề xuất: ưu tiên structured response phù hợp capability provider; với line format,
phải có grammar rõ ràng cho continuation. Dòng dư mơ hồ là lỗi format cần sửa
một lần, không âm thầm bỏ. Không nối mọi dòng dư vì có thể đó là lời giải thích.

### P1 — Cache/checkpoint chưa đủ identity và trạng thái validation

`src/main/autoShortItemCoordinator.ts:773-849`.
Artifact key có hash video và số cue, thiếu digest nội dung/ID/timing source cues,
model thực tế và policy validation. Cùng video được ASR/OCR ra câu khác nhưng cùng
số cue/timing có thể dùng lại bản dịch của văn bản cũ. Kiểm tra hash artifact bảo vệ
byte integrity, không thay thế identity của input dịch.

Checkpoint được kiểm tra fingerprint cấu hình trước đó, nhưng nhánh reuse dịch
chỉ kiểm tra số cue và bỏ qua `translateStrict`/language-shift guard. Bản dịch
được lưu trước content QA, không có nhãn validated/warning/rejected và fingerprint
lỗi. Incident chứng minh việc tái sử dụng rồi chặn lại, chưa chứng minh đã xảy ra
cache collision trong video thật.

Đề xuất: key từ canonical source cues + source/target locale + model/version +
prompt/options; lưu validation version/state riêng. Cache hit chạy cùng validation
như fresh result. Kết quả cần sửa vẫn có thể giữ để review nhưng không được coi
là bản dịch đã duyệt. Repair/resume theo batch, giữ phần tốt khi batch sau lỗi.

### P1 — `translateStrict` có nhánh tự điền nguồn, map theo vị trí

`src/main/autoshort.ts:1094-1116`.
Nếu số cue khác, hàm ghép theo index và dùng `srcCue.text` khi thiếu. Các provider
hiện có ID guard nên đây là nhánh phòng thủ nguy hiểm, chưa có bằng chứng incident
đi qua nhánh này. Nếu bị kích hoạt, tên strict không còn đúng: có thể lẫn nguồn
vào bản dịch hoặc lệch ý theo timestamp.

Đề xuất: bỏ source fallback, giữ mapping ID xuyên suốt; cardinality sai phải repair
đúng cue hoặc trả trạng thái cần kiểm tra. Thêm regression tại boundary coordinator.

### P2 — Cloud payload có chỉ dẫn target không nhất quán

`src/main/gemini.ts:248`, `src/main/openai.ts:250` không truyền target vào tham số
thứ tư của `buildDubbingTranslationPayload` (`translate-shared.ts:97`).
Payload sinh `target_language=auto`, trong khi system prompt có target đã chọn.
Đây là mâu thuẫn code-confirmed, chưa phải bằng chứng mọi model sẽ dịch sai.

Đề xuất: target bắt buộc trong contract, dùng chung payload cho cả ba adapter.
Thêm test request body cho từng provider và từng translation mode.

### P2 — Retry hữu hạn nhưng chưa thống nhất chi phí/thời gian

`src/main/localTranslate.ts:54,174-176,311-329,483-484,552-681`.
Local có deadline 10 phút, 3 attempts cho lỗi mạng, tối đa 2 response attempts.
Partial recovery thực tế chỉ giữ missing cues, giảm kích thước bài toán;
split cũng giảm nhóm/cue. Không có bằng chứng vòng lặp vô hạn trong nhánh này.
Fixture 12 cue, output rỗng liên tục: 9 requests rồi fail. Đây là fixture,
không phải số retry của video thật. Trần request mặc định là Infinity, được
test hiện tại chủ ý bảo vệ. Không nên đưa lại một trần thấp cố định cho mọi video.

Cloud: timeout từng request 180s, fallback qua danh sách model, không có cùng
item budget như Local; parser/schema fail thường dừng ngay, không có repair tương
đương. Model-list fetch có timeout riêng 15s và không nhận signal của item.

Đề xuất: scheduler/budget chung cho mọi adapter; phân biệt request bình thường
và request phục hồi. Ngân sách phụ thuộc workload với trần retry overhead, deadline
và no-progress fingerprint. Chia batch không reset budget; cancel/deadline phải
dừng mọi request kế tiếp. Chọn danh sách model fallback hữu hạn đã khai báo.

### P2 — Guard hệ chữ không phải xác minh đúng ngôn ngữ

`src/main/localTranslate.ts:178-254`, `src/main/autoshort.ts:1024-1082`.
Cả hai bỏ qua khi source/target cùng script, nên không phát hiện en→fr/es mà vẫn
là tiếng Anh. Hai bảng script khác nhau: Local có Jpan/Kore nhưng không Thai;
outer guard có Thai/Hang nhưng không Jpan/Kore. Locale không hỗ trợ được bỏ qua.
Heuristic cũng không đủ để quyết định về tên riêng, đoạn trộn ngôn ngữ hoặc
văn bản phiên âm.

Đề xuất: một module assessment chung trả confidence/reasons; đánh giá theo đoạn
đủ dài và trên nội dung thực tế, hỗ trợ mixed/unknown. Script là tín hiệu phụ.
Model capability/quality cần đánh giá riêng, không suy từ ký tự.

### P2 — Batching và prompt chưa thích nghi với mọi ngôn ngữ/video

`src/main/translate-shared.ts:7,55-85,97-172`, `localTranslate.ts:570`,
`semanticGrouping.ts:102-124`, `autoshort.ts:1006`.
Local max_tokens theo số cue, tối đa 2.048, không dựa vào độ dài cue hay ngân sách
context/output thực tế. Một cue rất dài có thể vượt giới hạn group và liên tục bị
truncation. Nhóm dùng ký tự thô; gợi ý 13 ký tự/giây chung cho mọi ngôn ngữ chỉ là
heuristic. AutoShort luôn bật prompt dubbing cả khi chỉ cần phụ đề.

Repro tiếng Hàn: `나는` + `학생입니다` → `나는학생입니다` do Hangul được ghép
không khoảng trắng như Han. Ảnh hưởng trực tiếp full-group context, không chứng
minh toàn bộ subtitle output bị mất khoảng trắng.

Đề xuất: budget theo input/output tokens + overhead prompt + provider capability;
cue dài chia thành đơn vị dịch nội bộ có mapping gốc. Chọn mode theo TTS, tách
bản dịch đầy đủ khỏi adaptation để lồng tiếng. Dùng quy tắc nối/segment theo locale;
giữ số liệu/tên/phủ định trong adaptation, đo TTS thực tế trước quyết định tempo.

### P2 — Chưa có ma trận hỗ trợ xuyên pipeline

`src/shared/types.ts:530` liệt kê 16 ngôn ngữ trong dropdown; contract nhận chuỗi
ngôn ngữ chưa phải certification. `localTranslate.ts:406-430` health-check bỏ qua
source/target parameters, chỉ xác nhận server trả content. UI TTS tại
`AutoShort.tsx:350-351` cho qua model có danh sách languages rỗng: unknown được
xem như có thể chọn, không phải bằng chứng hỗ trợ.

Đề xuất: khả năng hoàn tất là giao của nhận dạng nguồn, dịch, TTS khi bật, font/
render theo locale và runtime đang cài. Dùng supported/unsupported/unknown/
qualified thay cho boolean suy đoán. Preflight xác nhận capability; unknown cần
qualification. Video không thoại, âm thanh chồng lấn, ASR lỗi và nhiều ngôn ngữ
cần chính sách riêng; không hứa dịch tốt khi transcript nguồn chưa đáng tin.

## Các cơ chế nên giữ

- Provider identity validation, nguồn timing giữ local, partial recovery chỉ
  missing cues và loại bỏ duplicate mơ hồ.
- Không chấp nhận response Local bị finish_reason=length dù đủ ID.
- Local tôn trọng Retry-After/deadline/cancel; lỗi quyền không retry.
- Item scope và queue cô lập lỗi; tempo hard ceiling và no silent audio drop.
- Predictor TTS đã có Intl.Segmenter và profile theo ngôn ngữ/model/voice.

## Thứ tự cải thiện

1. Sửa P1: false semantic block, parser loss, cache identity/state, source fallback.
2. Đồng nhất contract/prompt/validation giữa ba provider, sửa target=auto ở cloud.
3. Budget recovery chung và batch checkpoint; no-progress/cancel regression.
4. Locale-aware grouping, token budget, source-language assessment và capability matrix.
5. Corpus qualification và UI completed-with-warnings/needs-review với lý do đầy đủ.

## Kiểm chứng trong lượt review

- `npm.cmd run typecheck`: PASS.
- `node scripts/run-local-runtime-tests.mjs local-translation.test autoshort-content-quality.test autoshort-stage-cache.test`: PASS 23 tests (16+4+3).
- Pure probes bundle các module thực tế bằng esbuild, chạy trực tiếp trong Node:
  negation, số viết chữ, chữ số Ả Rập, dấu thập phân, parser multiline, ghép Hangul,
  cloud payload default. Kết quả như các bảng ở trên.
- Chưa sửa runtime; chưa gọi live provider/TTS trong review; chưa chứng minh
  chất lượng dịch hoặc E2E cho tất cả ngôn ngữ.

## Ma trận nghiệm thu đề xuất

Kiểm thử contract cho cả ba adapter; corpus bắt đầu từ 16 locale trong UI.
Bao gồm Latin cùng hệ chữ, zh-Hans/zh-Hant, Nhật, Hàn, Thái, Ả Rập/RTL, Hindi,
code-switching, đoạn chỉ tên riêng, nguồn=đích và ngôn ngữ không xác định.
Mỗi nhóm cần số có dấu/dấu phân cách/số viết chữ/chữ số bản địa, câu phủ định,
đơn vị, tên riêng, speaker labels, multiline, cue dài, câu rất ngắn và ASR nhiễu.

Fault injection: 429/5xx/401/403, timeout, body treo, JSON lỗi, duplicate/missing/
unknown ID, truncation dù đủ ID, output lặp, cancel, cache cũ và resume. Yêu cầu:
không mất cue/nội dung âm thầm; mọi retry kết thúc trong budget; queue tiếp tục;
không dùng cache sai input; cảnh báo hiển thị; semantic/media quality được review
riêng trên corpus thật. Pass unit tests không thay thế nghiệm thu đó.
