# Đặc tả bổ sung: dịch theo profile giọng và đầu ra có nhãn ID

- Mã: `VOICE-TEXT-20260916`; ngày 2026-09-16.
- Trạng thái: **PROPOSED — tài liệu thiết kế, chưa triển khai**.
- [Tổng hợp session](../../../.ai/tasks/2026-09-16-voice-aware-translation-planning/SESSION_SUMMARY.md) · [Prompt contract](2026-09-16-voice-aware-translation-prompts.md) · [Planning](../plans/2026-09-16-voice-aware-translation-and-output.md).
- Đây là delta của bộ `VI-DUB-20260915`, không thay toàn bộ kiến trúc/roadmap trước. Tên field/module mới bên dưới là hợp đồng đề xuất, không phải API hiện có.

## 1. Mục tiêu, ưu tiên và ngoài phạm vi

Mục tiêu: giảm lỗi định dạng của Gemini chat, tránh sửa nhầm bản dịch đúng, có dữ liệu giọng đáng tin cho dự tính thời lượng và cải thiện lời Việt tự nhiên nhưng đủ ý.

Thứ tự ưu tiên: toàn vẹn nguồn/protocol → bảo toàn nghĩa → tự nhiên/dễ nghe → fit thời gian → độ trễ/chi phí. Không đánh đổi mất ý lấy một chỉ số fit tốt hơn.

Trong phạm vi: quantity QA; labeled draft/review output; profile chung Voice/AutoShort; voice hint advisory; prompt gọn; cache identity; telemetry; test và đánh giá đối chứng.

Ngoài phạm vi: Gemini TTS hoặc provider giọng mới; đổi routing/model bắt buộc; speech-to-speech/lip-sync; tự upload reference audio/video; đại tu grouping; dịch theo unit rồi tự chia caption; tăng tempo/extension/retry; bật quota tổng; title/SEO/metadata parser; release/install tự động. Official Gemini Structured Outputs là lựa chọn thay transport về sau, không phải phần triển khai mặc định này.

## 2. Ràng buộc giữ nguyên

- `R01` Source ledger giữ nguyên ID, source text, timestamp, thứ tự và lineage. Restored interpretation là evidence riêng, không ghi đè nguồn.
- `R02` Code sở hữu ID mapping, source slices, thứ tự và dựng SRT/JSON; không map output theo vị trí.
- `R03` Giữ source speech partition cho budget và TTS. Internal `/part-N` IDs phải giữ mapping offsets/source slice, không nhầm với speech-unit ID.
- `R04` Giữ preferred 1,10x, normal 1,25x, hard 1,80x; extension tối đa 60% mỗi đoạn, slowdown tối đa 20% rồi source-local replay theo policy hiện có. Không đưa extension vào budget dịch trước đo.
- `R05` Giữ trim -50 dB/30 ms/100 ms, EOF guard và effective protected gap do policy hiện hữu tính. Không tính lại gap bằng một hằng số mới trong prompt/profile.
- `R06` WAV đã trim trước DSP là authority về duration. Không crop/drop lời hoặc pad để che tempo vi phạm. Không cam kết mọi đầu vào đều fit.
- `R07` Giữ cancel/timeout/no-progress và retry ownership; quota tổng request/recovery/thời gian vẫn tắt. Không tạo vòng retry mới chỉ vì đổi format.
- `R08` Giữ typed IPC, shared isomorphic, safeContainedPath, process tracking, disk/scratch scope, license và thành phẩm hợp lệ.
- `R09` Transcript/OCR/glossary/candidate là dữ liệu không tin cậy. Không cho chỉ dẫn nhúng trong dữ liệu thay contract.
- `R10` Subtitle-only không áp pressure phát âm; locale khác không dùng nhầm phép đếm proxy tiếng Việt.

## 3. Baseline xác nhận ở working tree

| Thành phần | Bằng chứng code | Delta cần làm |
|---|---|---|
| Draft/review | `geminiGatewayPrompts.ts`, `geminiGateway.ts`; prompt v10, structured JSON | Output mode có nhãn và prompt compact có version |
| Completion | `require_complete_response=true`, truncate quay về scheduler | Giữ nguyên gate cho text output, không đồng nhất đủ ID với hoàn tất |
| Canonicalization | `translation/response.ts`, `shared/aiOutput.ts` | Parser text riêng → canonical items; không nới JSON parser chung |
| Speech units | `speechUnitPlanner.ts`, `speechBudget.ts`, source-anchored TTS | Tái sử dụng plan/budget, không tạo thuật toán gom nhóm thứ hai |
| Profile | `durationPredictor.ts`, `profileStore.ts`, call sites `autoshort.ts` | Service/measurement store dùng chung, sample provenance và calibration |
| Voice UI | `Voice.tsx`; history text rút gọn, clone record là reference metadata | Thu thập full text tại Main, typed summary cho UI |
| Rephrase | `[cue-id:n]` trong `parseBatchRephraseResponse`; measured rescue | Giữ grammar riêng, sửa numeric gate và thêm regression |

Đường Local TTS hiện lấy duration từ header và có thể là 0; không dùng header thiếu làm rate 0. Edge có probe duration nhưng collection chung vẫn cần cùng semantics trim/speed. Predictor hiện `confidence: 0`, `calibration: 'uncalibrated'`; sample count lớn không thay thế held-out.

## 4. Quantity QA và semantic evidence

### 4.1. Cấu trúc dữ liệu đề xuất

Một `QuantityFact` gồm `sourceSpan`, raw token, canonical value hoặc range, unit/dimension, unit-system context, optional entity/role anchor, provenance, certainty và normalizer version. Canonical quantity là tuple có liên hệ, không chỉ multiset chữ số rời rạc.

Quy tắc:

1. Tokenize theo span; một occurrence không được xuất hiện đồng thời ở nhánh explicit digits và number words. Hai lần nhắc cùng giá trị ở hai span vẫn là hai occurrence, không `Set` làm mất số lượng.
2. Số Unicode/decimal locale/range/âm/ordinal có test riêng. `2-3` không mặc định là `2, -3`; `-3°C` không bị đổi thành range.
3. Đơn vị dùng boundary đúng; ưu tiên match đầy đủ. `3 giây` không là `3 g`, `3 món` không là `3 m`; hỗ trợ CJK không dựa hoàn toàn vào word boundary Latin.
4. So sánh giá trị đã đổi đơn vị chỉ khi unit system được xác định. `10斤 = 5 kg` là fixture có explicit PRC context; `斤` không rõ vùng phải `suspect`, không đoán hệ đo.
5. Không ép đổi đơn vị ở mọi bản dịch; cho phép giữ đơn vị nguồn rõ ràng. Alias “cân” cần diễn giải theo locale, không coi bằng nhau chỉ vì cùng chữ số.
6. Đồng tiền/denominator mới xuất hiện không có source evidence là nghi vấn factual addition; không suy `mg/100ml` chỉ từ `56毫克`.
7. Khác biệt chắc chắn về số/đơn vị → hard reject. Unknown extraction, bất định ASR hoặc đổi đối tượng chưa có evidence chắc chắn → review/suspect. `ok` cấu trúc/số không nghĩa là semantic verified.

### 4.2. Tích hợp và restoration

Tái dùng `semanticEvidence.ts`/`qualityDecision.ts`; nối vào consumer thực tế thay vì chỉ bổ sung helper/test không được gọi. Phân biệt deterministic verified evidence, model-reported suspicion và human-reviewed evidence. Reviewer tự nói “đúng” không được nâng thành deterministic verification.

V1 labeled output chỉ chứa bản dịch, không nhét findings JSON vào cùng grammar. Correction chắc chắn từ code hoặc người duyệt có thể lưu sidecar gồm cue/span, raw/restored text, reason và evidence. Nếu chỉ suy ra model có thể đã sửa ASR qua bản dịch, ghi là chưa có provenance; không bịa restoration ledger. Hợp đồng machine-readable findings từ Gemini là mở rộng riêng, chưa bắt buộc để bật labeled output.

## 5. Labeled output contract `cue-lines-v1`

### 5.1. Tách ba lớp

- HTTP response vẫn là OpenAI-compatible JSON envelope do Gateway tạo.
- `message.content` của model là text `[exact-id] lời dịch` thay vì object JSON do model viết.
- TediaPros parse nghiêm → canonical `{items:[{id,text}]}` bằng serializer của code → kiểm tra nghiệp vụ và phục hồi timestamp từ nguồn.

Đổi format chỉ giảm nhóm lỗi escape/quote/comma/braces của model. Nó không sửa JSON envelope transport hỏng, thiếu ID, sai nghĩa hoặc phản hồi bị cắt.

### 5.2. Grammar và parser

```text
[cue-0-1490] Máy khá nhỏ gọn,
[cue-1-2320] mang theo rất tiện.
[cue-2-4000/part-1] Thổi cách máy 2–3 cm,
```

Yêu cầu bắt buộc:

- Mỗi record là một dòng vật lý: `[ID]` + ít nhất một dấu cách + text không rỗng. Các dòng cuối trống/whitespace-only có thể bỏ; CRLF chuẩn hóa thành LF; optional một BOM ở đầu. Không sửa nội dung dịch để “repair”.
- ID so khớp chính xác với requested set sau quy trình canonicalize source hiện có; parser không tự trim/sửa/đoán ID model trả. Cho phép ID nội bộ có `/part-N`.
- V1 yêu cầu ID đầu vào không chứa `[`/`]` hoặc line/control characters. Nếu gặp ID không biểu diễn được, preflight chọn mode JSON trước generation và ghi lý do; không đổi source ID hay fallback sau lỗi. Không triển khai positional alias ngầm.
- Một requested ID đúng một lần. Unknown/context-only/duplicate/missing/empty ID làm cả response không được accepted. Thứ tự response có thể khác; code sắp lại theo mapping nguồn.
- Không multiline translation, bullets, prose, Markdown fence hoặc nhiều record ghép một dòng. V1 từ chối fence thay vì thêm repair regex.
- Quotes và backslash thông thường trong text được giữ nguyên. Nhãn record khác chèn vào phần text là lỗi. Cú pháp `[...]` trong lời dịch được dành riêng ở V1 và bị từ chối để tránh rò nhãn; prompt yêu cầu dùng ngoặc tròn cho chú thích thực sự có trong nguồn.
- Áp byte/line/text/count limits hữu hạn trước allocation/parse, fatal UTF-8 và Unicode validation theo boundary hiện hữu. Không nới global caps. Bounded output dài bị từ chối/chia batch theo policy, không âm thầm cắt.
- Không heuristic lấy “những dòng có vẻ đúng”, không salvage response draft/review lỗi. Diagnostic có thể liệt kê ID lỗi nhưng accepted items/checkpoint vẫn rỗng.

Parser mới khác parser rephrase: bản dịch cần đúng một bản/ID; rephrase có 1–3 candidates `[cue-id:n]` và policy recovery riêng. Không thay hành vi rephrase bằng parser mới.

### 5.3. Completion, retry và Gateway negotiation

Thứ tự gate: body/envelope bounds → metadata completion/route → text parse → exact IDs/source mapping → quality → accepted/checkpoint. `finish_reason=length`, terminal evidence thiếu hoặc completion unknown không được nhận dù đủ ID. Marker `[END]` do model sinh cũng không phải bằng chứng completion; không thêm marker này vào V1.

Đổi format không bỏ các kiểm tra ngôn ngữ, dấu câu và nội dung hiện có sau review. Refusal/filter/error envelope đi theo trạng thái lỗi riêng; không ép chúng thành những dòng dịch hoặc chỉ báo hàng loạt missing IDs che nguyên nhân thật.

Thiết kế capability additive đề xuất:

```json
{"text_output_contracts":["cue-lines-v1"]}
```

Khi negotiated, client thêm `gateway_requirements.text_output_contract="cue-lines-v1"`, giữ contract v2/core metadata/`require_complete_response=true` và bỏ `response_format` chỉ cho hai stage này. Gateway echo contract đã dùng vào audit metadata; unknown requested contract phải bị từ chối trước generation. Đây là field **PROPOSED**, chưa khẳng định server có.

Gateway chịu transport/session/routing/completion và raw content bounded pass-through; TediaPros chịu cue grammar, exact expected set và canonical serialization. Gateway không JSON-normalize phần content ở mode text. Capability phải chứng minh cả đường complete lẫn truncated/error, không chỉ bỏ một field ở client. Không yêu cầu Gateway hiểu source cue để xác nhận đúng nghĩa.

Fallback compatibility: auto mode gặp Gateway cũ không công bố capability → chọn JSON legacy trước dispatch và ghi mode. Explicit labeled mode nhưng thiếu capability → lỗi tương thích, 0 generation. Không retry cùng stage bằng format khác sau failure; tránh tăng call, đổi identity và che lỗi. Việc error format được retry/split thế nào đi qua owner/scheduler hiện hữu đã kiểm tra, không thêm retry local trong parser.

Giữ model routing hiện tại: chấp nhận model text thực tế theo policy, ghi requested/observed/route fingerprint; không tái áp yêu cầu Pro cố định. Triển khai phía Gateway cần task/cấp quyền repo đó riêng, không sửa chéo repo trong lượt tài liệu này.

## 6. Profile giọng dùng chung

### 6.1. Identity và storage

Tạo service Main dùng chung thay vì hai profile stores độc lập. Identity tách `provider`, endpoint identity đã loại auth/query secrets, model + revision nếu có, named voice hoặc clone reference content digest + transcript digest, locale, effective generation options/speed, feature/normalizer/trim versions.

- UUID/tên hiển thị clone không phải acoustic identity. Đổi nội dung file reference tại cùng path phải đổi key.
- Không gộp Edge voices, models hoặc reference khác nhau; không suy revision thiếu thành revision đã xác minh. Cho phép đánh dấu `revisionUnknown` và kiểm tra drift.
- Production/dev userData tiếp tục tách. Giữ file v2 cũ nguyên vẹn, đọc tương thích như legacy advisory nếu key/format hợp lệ; không backfill independent sample count/calibration khi thiếu provenance.
- Schema mới version riêng, atomic write, validation/bounds, lock/single-writer để Voice và AutoShort không mất cập nhật. Corrupt profile → cold start có lý do; không xóa cả thư mục.
- Có retention/cap cho sample store và tùy chọn xóa/reset theo đúng profile; cấu hình retention cụ thể chốt trong implementation trước bật collection. Không copy tất cả WAV vào profile store.

### 6.2. Measurement record

```ts
// DESIGN TYPE — không phải interface đang có.
interface VoiceMeasurementV1 {
  version: 1
  profileKey: string
  sampleId: string
  sourceItemKey?: string
  textHash: string
  normalizedTextHash: string
  textFeatures: Record<string, number>
  normalizerVersion: string
  featureVersion: string
  trimVersion: string
  durationNaturalMs: number
  measuredAtUtc: string
  durationSource: 'probed-trimmed-audio'
  serverSpeed: number
  audioFingerprint: string
  origin: 'voice-tab' | 'autoshort'
  cacheHit: boolean
}
```

Service nhận full synthesis text ngay tại Main; tính normalization/features trước khi UI rút gọn. Full text có thể giữ trong bounded diagnostic/sample artifact theo retention, không bắt buộc lưu vô hạn trong profile summary. Không lấy history 70 ký tự để học lại.

Audio hợp lệ phải đọc/probe được, duration hữu hạn >0, không silent/error/cancel, qua completeness gate hiện hữu và chưa DSP/retime. Dùng cùng trim policy; giữ internal pauses. Header duration chỉ là hint, không thay probe chuẩn. Speed khác 1.0 được lưu bucket riêng hoặc loại khỏi baseline; không lấy duration chia/nhân speed để giả một sample ở 1.0. Đổi normalize/features không được diễn giải weights cũ bằng nghĩa mới.

Cache hit cùng audio không tăng independent sample count. Track cả observation count, unique audio/text và source cluster; tái sinh cùng câu không được thổi phồng độ đa dạng. Bootstrap, rescue và Voice tab dùng cùng dedup service. Stage retry không nhân sample đã ghi; không thêm generation chỉ để thu profile.

### 6.3. Tốc độ và độ tin cậy

- `charactersPerSecond`/`wordsPerSecond` chỉ hiển thị đúng tên đơn vị.
- Tiếng Việt có thể cung cấp `estimatedSpokenUnitsPerSecond` bằng normalizer có version cho số/viết tắt; luôn gắn nhãn **âm tiết ước lượng**, không khẳng định đếm âm tiết âm học.
- Rate = normalized spoken-unit proxy / duration trước DSP đã trim, có cả pause giữa câu. Báo phân bố P10/median/P90 và số mẫu đủ điều kiện, không chỉ một số cố định.
- Unknown pronunciation/foreign names/mixed scripts làm tăng uncertainty; unsupported locale thì không xuất rate proxy kiểu Việt.
- Trạng thái `cold | advisory | qualified | stale`. Qualified chỉ sau held-out theo đúng identity, split theo video/source family; không gán confidence từ train residual hoặc số mẫu thô.
- Model/reference/trim drift làm invalidation calibration đúng scope; giữ observations để truy vết, không xóa hàng loạt.

### 6.4. UI và privacy

Typed IPC trả summary nhỏ: tên voice, trạng thái, eligible unique samples, rate có đơn vị/range, thời điểm cập nhật, lỗi/unknown. Không đưa file IO/Node vào Renderer. Hiển thị “chưa đủ dữ liệu” thay cho 0 âm tiết/giây.

Không gửi cho Gemini audio reference, reference transcript, local path, endpoint, API key hoặc hash định danh private. Hints gửi chỉ số tổng hợp tối thiểu; logs không chép full text/reference mặc định. Collection phải nằm trong app-owned scoped paths và tôn trọng disk budget.

## 7. Voice hints và prompt

`VoicePromptHintV1` đề xuất chỉ gồm locale, metric/normalizer version, trạng thái, independent sample count, rate median/range nếu hợp lệ, qualification reference nội bộ và các cờ pronunciation uncertainty. Loại weights, raw residual samples và thông tin định danh không phục vụ dịch.

- Cold/stale/unsupported: bỏ numeric rate khỏi prompt hoặc ghi unavailable, không dùng giá trị fallback giả như số đo thật.
- Advisory: có thể thử hint rate trong nhánh thí nghiệm riêng, không hard quota; qualified vẫn chỉ dự đoán, không thay WAV.
- Snapshot hint tại đầu job và giữ nguyên cho draft/review/retry tương thích; observations mới cập nhật profile tương lai, không làm request đang chạy đổi identity.
- Ban đầu chưa có target text nên không có duration estimate chính xác từng câu. Chỉ có budget và rate prior. Khi có candidate, predictor code có thể ước lượng kèm uncertainty; không yêu cầu Gemini chạy ridge weights.
- Tùy chọn gợi ý số spoken units lấy từ budget/rate nhưng phải ghi advisory; mặc định V1 chỉ gửi budget giây và summary rate để tránh biến thành hard word cap.

Budget lấy trực tiếp plan: `available`, `targetNatural=available×preferredTempo`, `hardMaxNatural=available×hardTempo`. Không cộng budget các fragment nếu chúng thuộc cùng unit; không xem hardMax là độ dài nên cố đạt. Giữ raw ledger toàn bài và chỉ output requested IDs, kể cả batch giới hạn output.

Prompt compact baseline vẫn draft + review. Reviewer nhận source, candidate và cùng plan/hint snapshot; giữ câu đã tốt, không rewrite để tạo khác biệt. Hướng đơn giản hóa không có nghĩa bỏ kiểm tra sự kiện/ngữ cảnh. Xem prompt mẫu riêng.

## 8. Cache, accepted state và recovery

Identity thêm output contract/parser version, prompt/style version và digest canonical của chính hint đã gửi, bên cạnh source/plan/budget/locale/glossary/capability/route identity hiện có. Không đưa observedAt vô nghĩa vào digest khiến cùng dữ liệu luôn cache miss.

- Draft hợp lệ về cấu trúc chưa phải bản dịch final; review lỗi không tự dùng draft cho TTS.
- Response cũ/stale không ghi vào job revision mới. Đổi output mode/prompt/hint làm cache miss đúng scope, không xóa ASR/media/accepted output của job khác.
- Resume review giữ draft và hint snapshot nếu identity còn khớp. Profile có thêm samples không tự hủy một job đã chốt snapshot.
- TTS/render retry tái dùng bản dịch đã accepted và WAV cache phù hợp, không dịch lại chỉ để cập nhật hint.
- Giữ cap checkpoint hiện hữu; payload mới vượt cap phải fail trước ghi. Sharding cho cực lớn vẫn là task roadmap trước, không tuyên bố được giải quyết bởi labeled format.
- Rephrase dựa trên audio đo: source/current/context, measured duration, target/hard budget, candidate journal. Đổi grammar dịch đầu không đổi grammar `[cue-id:n]` hoặc thêm candidate cho tất cả units.

## 9. Telemetry và nghiệm thu

Ghi theo job/stage: outputMode/parser/prompt/hint versions, completion status, lỗi grammar/ID, actual upstream attempts, requested/observed model, source/plan digest, profile state/sample eligibility, measured durations, tempo, rephrase, extension/replay và cancel/failure. Thời gian sinh TTS và thời lượng audio là hai metric khác nhau; unknown không hiện 0.

Giữ [evaluation 15/09](../../benchmarks/2026-09-15-vietnamese-duration-aware-translation-evaluation.md) cho content/audio/predictor. Bổ sung thí nghiệm từng biến:

| Nhánh | Thay đổi so với đối chứng | Điều cần đo |
|---|---|---|
| F0/F1 | JSON / cue-lines, cùng prompt nội dung và hai lượt | Format-failure rate, completion/ID failure, retry count, latency; không chỉ lỗi JSON |
| P0/P1 | Prompt hiện tại / compact, cùng output mode và hai lượt | Critical/major semantic, fluency, measured fit |
| V0/V1 | Không hints / có hints, cùng prompt/mode/voice | Sai số dự tính, first-pass fit, rephrase, extension; không tăng lỗi nghĩa |
| R0/R1 | Hai lượt / một lượt + risk review | Chỉ mở sau QA/evidence qualification; lỗi bỏ sót và mới tạo, request savings |

Không đổi cả bốn trục rồi quy kết thắng cho format. Chạy paired cùng source/voice/options; observed model khác phải stratify hoặc báo confound. Pilot nhỏ chỉ cho quyết định tiếp tục thử, không tự default-on.

Engineering gate bắt buộc: exact ID/Unicode/bounds/completion/cancel/no-progress/cache tests; regressions quantity positive + negative; voice dedup/identity/migration; source plan và physical policy không đổi. Content gate: không critical mới, không suy “pass tests” thành nghĩa đúng; dùng tiêu chí và CI đã đăng ký trước ở evaluation. Labeled mode chỉ default-on khi không giảm quality và giảm format failures hoặc có lợi ích latency/retry đáng đo; không hứa trước tỷ lệ giảm.

## 10. Rollout, rollback và quyết định mở

Rollout: giữ JSON legacy → local parser/service tests → Gateway capability và contract fixtures → opt-in labeled → compact/hints từng nhánh → benchmark → default cho job mới nếu đạt. Shadow chỉ tính/đo cục bộ; không gọi model/TTS thêm. Không đổi config của job đang chạy.

Rollback tắt feature cho job mới; giữ artifacts và namespace cũ. Không downgrade parser để nhận response sai, không xóa profile/cache toàn bộ, không làm mất media đã xuất. Dừng rollout khi drift ID/timestamp, critical semantic, cắt lời, over-tempo, gap regression, secret leak, accepted-state loss hoặc retry không tiến triển.

Còn cần chốt khi thực thi: repo/build Gateway được phép sửa; retention limits/sample storage policy; corpus được phép gửi; voice configs chính; người chấm hai ngôn ngữ; ngân sách live; tiêu chí promotion đã đăng ký và lịch release. Không yêu cầu người dùng cung cấp các lựa chọn này chỉ để hoàn thành specs/planning.
