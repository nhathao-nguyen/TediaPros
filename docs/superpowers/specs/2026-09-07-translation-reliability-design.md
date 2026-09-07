# Thiết kế cải thiện dịch, prompt và độ tin cậy đa ngôn ngữ

**Trạng thái:** thiết kế cho kế hoạch được yêu cầu; chưa triển khai runtime.
**Baseline:** `3d49b84`, branch `codex/autoshort-optimization`.
**Inputs:** [Prompt review](../../reviews/2026-09-07-translation-prompt-review.md),
[Multilingual audit](../../reviews/2026-09-07-translation-multilingual-audit.md).

## 1. Mục tiêu và lựa chọn kiến trúc

Mỗi item kết thúc hữu hạn: thành công, thành công có cảnh báo, cần kiểm tra,
lỗi kỹ thuật hoặc bị hủy. Không mất nội dung âm thầm, không tự điền source vào
bản dịch thiếu, không đánh giá heuristic là bằng chứng chắc chắn về sai nghĩa.
Không cam kết mọi video/ngôn ngữ đều đạt chất lượng hoặc vừa timeline.

Ba cách đã cân nhắc:

- Vá regex/prompt tại từng provider: ít thay đổi nhưng giữ ba cơ chế repair và
  validation khác nhau; không giải quyết cache và resume. Không chọn.
- Contract và orchestrator chung, giữ adapter hiện có: sửa theo từng đợt, cùng
  guards/budget/cache cho ba provider. **Chọn cách này.**
- Thêm một LLM reviewer cho mọi cue: thêm latency, chi phí và nguồn sai số,
  không bảo đảm đúng nghĩa. Không đưa vào critical path mặc định.

Các module chính đặt trong `src/main/translation/`, chỉ tách phần trực tiếp
phục vụ task. Không rewrite toàn bộ autoshort.ts hoặc thay thư viện dịch.

## 2. Global constraints

- Không sửa LICENSE, NOTICE hoặc làm yếu PolyForm Noncommercial.
- Không silent source fallback, không drop cue/audio hoặc cắt ý để đạt timing.
- Tempo TTS không vượt 1.45x; giữ nguyên chính sách khoảng lặng và planar RGB OCR.
- Shared contracts không import Node, Electron, React hoặc browser globals.
- Đường dẫn mới qua safeContainedPath; cache/checkpoint atomic, scoped và có quota.
- Cancellation giữ lease đến khi provider/process kết thúc; không gọi request mới sau abort.
- Không tự đổi provider, tải model/dependency, hoặc gọi dịch vụ có phí trong test mặc định.
- Config cũ vẫn đọc được; unknown capability không được ghi thành supported/qualified.
- Không tự xóa checkpoint/cache/output người dùng; migration chỉ bỏ qua phần không tương thích.
- Mọi phase thay runtime phải pass typecheck và test liên quan trước khi chuyển phase.

## 3. Contract và module map

`src/shared/translation.ts` (new): kiểu isomorphic; không lưu credential hay raw
response trong IPC. Giữ status AutoShort cũ (`done/error/cancelled`) để tương thích;
thêm optional assessment và disposition. `needs-review` dùng event item-error
và không có final video, UI đổi nhãn từ mã disposition. Done+warnings vẫn có video.

```ts
export type TranslationMode = 'subtitle' | 'dubbing'
export type TranslationFormat = 'json-items' | 'id-lines'
export type TranslationDisposition = 'validated' | 'with-warnings' | 'needs-review'
export type TranslationSeverity = 'error' | 'warning'
export interface TranslationIssue {
  code: string
  severity: TranslationSeverity
  cueIds: string[]
  confidence: 'certain' | 'heuristic' | 'unknown'
  message: string
}
export interface TranslationAssessment {
  version: 'translation-assessment-v2'
  disposition: TranslationDisposition
  issues: TranslationIssue[]
  languageEvidence: 'matched' | 'suspect' | 'unknown'
}
export interface TranslationCue {
  id: string
  sourceIndex: number
  start: number
  end: number
  text: string
  groupId: string
}
export interface TranslationInput {
  sourceLanguage: string
  targetLocale: string
  mode: TranslationMode
  cues: TranslationCue[]
  contextBefore: TranslationCue[]
  contextAfter: TranslationCue[]
  glossary: Array<{ source: string; target: string }>
}
export interface TranslationItem { id: string; text: string }
export interface TranslationBatchResult {
  items: TranslationItem[]
  assessment: TranslationAssessment
  modelIdentity: string
}
```

`TranslationIssue.code` phải dùng union/table mã lỗi có kiểu khi triển khai:
`invalid-source`, `missing-id`, `duplicate-id`, `unknown-id`, `empty-text`,
`unparsed-content`, `truncated-output`, `protected-token-suspect`, `language-suspect`,
`unsupported-capability`, `budget-exhausted`, `no-progress`, `provider-auth`,
`provider-transient`, `provider-protocol`, `cancelled`. Không dùng regex của
message để phân loại lỗi mới. Khi unknown error đi qua adapter: provider-protocol,
không tự retry; giữ cause nội bộ đã redact để debug.

Files new và trách nhiệm:

| File | API chịu trách nhiệm |
|---|---|
| `src/main/translation/prompts.ts` | `buildTranslationMessages(input, format)`, `buildRephraseMessages(input)`; version tập trung |
| `src/main/translation/response.ts` | `parseTranslationResponse(raw, format, expectedIds, truncated)`, `mapTranslationsStrict(source, items)` |
| `src/main/translation/budget.ts` | `createTranslationBudget(plannedRequests, now, restored?)`, `classifyTranslationError(error)` |
| `src/main/translation/planner.ts` | `planTranslation(input, capability)`; token/segment budget, mapping nội bộ |
| `src/main/translation/orchestrator.ts` | `translateWithAdapter(input, adapter, signal, onBatch?)`; bounded scheduler và validation chung |
| `src/main/translation/checkpoint.ts` | `buildTranslationIdentity(input, identity)`, `readTranslationCheckpoint`, `writeTranslationCheckpoint` |
| `src/main/translation/language.ts` | `normalizeTranslationLocale`, `assessTranslationLanguage`, `resolveTranslationReadiness` |

Sửa `autoShortContentQuality.ts`: structural checks chắc chắn + semantic warnings;
không thêm detector nặng. Sửa `localTranslate.ts`, `gemini.ts`, `openai.ts`: adapter
transport một lượt; giữ API wrapper hiện có cho các màn hình dùng translateSrt.
Sửa coordinator/autoshort.ts: source identity, orchestration, checkpoint và status.
Sửa semanticGrouping.ts để nhận locale khi nối câu; giữ timeline và group limits.

## 4. Prompt, parser và fidelity

- Ba nhiệm vụ riêng: translate, repair response, rephrase. System dịch không áp
  một-kết-quả-ID lên request rephrase ba phương án. Target locale bắt buộc,
  tuyệt đối không có default `auto` khi target chưa được xác định.
- Nội dung prompt lấy từ prompt review; giữ một bản source text/cue, groupId
  thay việc lặp full-group text. Context/glossary có budget, chỉ từ dữ liệu có thật.
- Subtitle mode khi TTS tắt; dubbing khi TTS bật. Bỏ hint 13/14 grapheme/giây
  chưa hiệu chuẩn. Duration là soft hint, measured TTS và policy mới là hard gate.
- Output contract đúng một format. Cloud dùng JSON items với schema cập nhật
  đồng bộ; Local giữ id-lines mặc định đã có, chỉ chọn JSON khi capability xác nhận.
- Line parser: một dòng nội dung cho một ID. Dòng không rỗng không parse được
  tạo `unparsed-content`, không bỏ hoặc nối bừa. Fence hoàn chỉnh có thể unwrap;
  fence hỏng, JSON cắt, finish_reason=length đều không được thành công.
- JSON string chứa newline hợp lệ phải giữ trọn nội dung. Known context IDs ngoài
  expected được loại có cảnh báo; ID lạ không phải context là lỗi cần repair.
- ID xuyên suốt adapter/orchestrator; chỉ serialize SRT ở boundary. Các wrapper
  cũ vẫn phải bảo toàn ID-to-timing trước khi serialize. Không suy ID bằng vị trí
  khi provider trả thiếu/thừa câu. Reordering được map lại bằng ID.
- Semantic checks: nghi vấn về số/đơn vị/phủ định là warning theo ngôn ngữ,
  không chặn. Numeric normalizer hỗ trợ Unicode decimal digits; separators mơ hồ
  và số viết chữ chưa được parser hỗ trợ trả unknown. Không xem absence là số 0.
- Đúng ID/format không có nghĩa đúng semantic. Không có tự động dịch vòng hoặc
  thêm LLM review mỗi cue. Nhận biết sai ngôn ngữ chưa đủ confidence là warning.

## 5. Adapter, batching và retry budget

```ts
export interface TranslationCapability {
  provider: 'local' | 'gemini' | 'openai'
  modelIdentity: string
  revisionKnown: boolean
  format: 'json-items' | 'id-lines'
  contextTokens: number | null
  outputTokens: number | null
countTokens?: (text: string) => number
}
export interface PlannedTranslationBatch {
  id: string
  input: TranslationInput
  maxOutputTokens: number
}
export interface TranslationAdapter {
  capability: TranslationCapability
  requestOnce(batch: PlannedTranslationBatch, signal: AbortSignal): Promise<{
    raw: string; truncated: boolean; modelIdentity: string
  }>
}
```

Capability lấy từ manifest/config đã được xác nhận. Khi không có tokenizer,
UTF-8 byte length là estimate bảo thủ cho token budgeting, không gọi nó là token
count đo được; overhead system/schema/context đều phải tính. Unknown limits
dùng profile legacy hữu hạn (Local 2.000 source chars/24 cues) với cảnh báo;
không suy đoán capability chỉ từ health-check trả lời được.

Cue vượt budget chia thành translation units tại sentence/word boundary bằng
Intl.Segmenter theo locale, có code-point boundary fallback. ID nội bộ
`original-id/part-N` chỉ ở provider boundary; lưu đủ thứ tự/text spans. Không
đổi original cue timing; chỉ merge khi đủ mọi part. Parts cho dịch không tự cho
phép cắt nhỏ timeline TTS. Context lân cận giữ để giảm mất liên kết khi chia.

**Defaults đề xuất để bắt đầu qualification, chưa phải KPI đo được:**

- Gọi `B` là số request dịch bình thường do planner lập trước retry.
- Recovery credits `R = max(4, ceil(B * 0.5))`; tổng tối đa `B + R` requests.
- Mỗi original batch dùng tối đa 4 recovery credits. Child requests, transport
  retries, format repair và model fallback đều trừ R; split không tạo B mới.
- Mạng/429/5xx: tối đa 2 retries/request, thêm jitter 0–250ms vào backoff
  800/1600ms; Retry-After là thời điểm sớm nhất, không được retry trước đó.
- Format repair tối đa 1 lần cho mỗi exact requested-ID set; split tối đa 2 cấp.
- Same input/output-error fingerprint lặp 2 lần liên tiếp mà không tăng valid
  cue set: không gọi lại same payload; thử split nếu còn depth/credits, nếu
  không thì `needs-review`. Partial recovery chỉ nhận tập missing nhỏ hơn.
- Mỗi request tối đa 180s và không vượt stage remaining time. Stage active time
  budget `max(600000, B * 90000 + R * 60000)` ms; tính cả queue lease wait/backoff.
- Normal/repair requests đi cùng resource lease. Abort/body timeout phải drain
  request; không release slot sớm hoặc bắt đầu sibling sau abort.
- 401/403, cấu hình sai, unsupported capability, explicit provider policy refusal:
  dừng item, không model-hop để retry cùng lỗi. Provider protocol bất định không
  tự coi là lỗi mạng. 429 quota cạn rõ ràng dừng; 429 tạm thời mới backoff.
- Chỉ fallback giữa tối đa 2 model đã cấu hình trước trong cùng provider;
  không đổi provider/account. Model discovery 15s nằm trong signal và deadline;
  discovery không phải inference credit nhưng thời gian vẫn tính.

Ví dụ B=1 → R=4 → tối đa 5 request; B=5 → tối đa 9; B=100 → tối đa 150,
không có trần 5/9 áp cho mọi video. Mục tiêu là khống chế recovery overhead.
Nếu một item không còn đủ credit để hoàn tất, checkpoint giữ phần tốt và item
chuyển cần kiểm tra; không tự dịch vòng từ đầu.

## 6. Cache/checkpoint và retry liên phiên

Identity hash canonical: ordered source cue IDs/text/start/end/sourceIndex,
source locale evidence, target locale, mode, glossary/context policy, prompt/
parser/planner revisions, effective provider/model revision và options. Không
lưu key hoặc URL chứa credential. Secret identity không được dùng làm cache key;
scope account dùng opaque local profile ID khi có.

Model alias không có revision: không reuse translation persistent qua job; vẫn
giữ checkpoint review nhưng yêu cầu identity mới hoặc explicit user resume có
cảnh báo model chưa xác minh để dùng lại. Không lấy model name suy thành revision.

Cache v2 chỉ publish batch có structural validation pass, kèm assessment. Warnings
được giữ và hiển thị sau cache hit; rejected response chỉ lưu trong scoped review
record nếu cần, không quảng bá là cache hợp lệ. Revalidate trên cả fresh/cache/resume.

Checkpoint v2 gồm identity, valid batches, assessment version, retry attempts/
credits, active elapsed time, last failure fingerprint và terminal disposition.
Atomic temp+rename sau mỗi valid batch và mỗi retry charge. Resume cùng identity
không reset credit, depth hay failure fingerprint; interrupted request đã charge
không được hoàn credit tự động. Sau crash thời gian request đang chạy tính bảo
thủ đến timeout, không tính toàn bộ thời gian app đóng vào active budget.

Legacy translation cache/checkpoint chưa có đủ identity: không promote. Preserve
source checkpoint khi source identity hợp lệ; bỏ qua translation legacy có thông
báo một lần, giữ file cũ để review. Không xóa toàn bộ autoshort-checkpoints.

Manual rerun: nút chạy thường không tự reset terminal no-progress. Đổi source,
model/prompt/config tạo identity mới. Thao tác explicit “Thử lại bước dịch” tạo
attempt generation mới, cảnh báo chi phí, giữ valid batches chỉ khi identity
khớp. Đây là action của người dùng, không trigger từ event hoặc auto resume.

## 7. Language/capability và UI

Locale normalization bằng Intl.Locale; giữ zh-Hans/zh-Hant/pt-BR/en-GB, không
gộp các biến thể khi key/prompt cần phân biệt. Config cũ không có region vẫn hợp lệ.
Source auto/mixed/unknown là evidence states, target auto không phải target hợp lệ.

Một language assessment module chung thay hai script guards. Script/copy ratio
là heuristic, không nhận en→fr thành matched chỉ vì Latin. Chưa có detector
offline đã qualified thì languageEvidence=unknown/suspect, hiện warning; không
cài thêm model để tự gán certainty. Một câu tên riêng/brand/số phải không bị
chặn do script. Actual source cues được dùng cùng configured/detected language;
mâu thuẫn là warning, không tự đổi lựa chọn user.

Capability mỗi stage gồm supported/unsupported/unknown và qualified độc lập.
TTS không bật thì không gate capability TTS; OCR không dùng thì không gate OCR.
Unknown có thể chạy với warning, unsupported stage bắt buộc thì báo trước job.
Font coverage/RTL render phải được kiểm tra riêng khi qualify, không suy từ LLM.
Không thoại với dịch/TTS được yêu cầu: báo “Không có lời thoại để dịch”, không tự
tạo transcript. Source mixed/ASR nhiễu được đánh dấu không-certify tự động.

UI: completed+warnings có số warning và chi tiết cue/time/code. Needs-review hiển
thị đầy đủ lý do, bước lỗi, credits đã dùng, nút xem SRT/các artifacts hợp lệ và
explicit retry-step. Không gửi raw secret/prompt qua IPC. Job summary counts giữ
completed/error/cancelled cũ; thêm warningCount/needsReviewCount (là subset error)
để không cộng trùng total. Terminal flush không bị progress coalescer bỏ.

## 8. Rollout và qualification

A: P1 + prompt contract, warning UI tối thiểu; B: bounded scheduler và checkpoint;
C: planner/locale/capability + corpus. Release chỉ khi mỗi đợt pass gates.
Cache namespaces/prompt revisions mới được pin theo từng đợt. Rollback về bản
trước trong series đã có P1 fixes; không quay lại false-block/source-fallback như
một cách rollback. Không publish package, merge hay gọi live benchmark trong planning.

Baseline review: typecheck và 23 tests pass ở lượt review trước; đó không phải
evidence của implementation tương lai. Nghiệm thu mới phải rerun sau source edits.

Corpus offline: fixtures bao phủ 16 language codes UI, variants, mixed, same-script,
Unicode digits, names, negation, multiline, long cue, ASR noise. Với every directed
pair trong 16 locales có thể chạy transport/contract mocks (240 cặp); kết quả chỉ
chứng minh contract, không chất lượng semantic.

Live qualification opt-in: zh→en, zh→vi, en→fr, en→ar, en→hi, en→th, ko→en,
ja→en. Mỗi cặp 3 clip: sạch, câu dài/nhịp nhanh, nhiễu/mixed; reviewer biết nguồn
và đích. A/B prompt cũ/mới cùng model/config; mỗi case lặp 3 lần. Lập manifest
và estimate request/cost trước khi chạy. Bắt đầu một cặp/ít clip, chỉ mở rộng sau
khi pilot ổn; không mặc định gọi 144 runs live.

Gate: 0 lost/duplicate cues; 0 silent fallback/continuation loss; mọi injected
failure kết thúc trong budget; 0 severe semantic error trong accepted corpus;
naturalness median >=4/5 và không thấp hơn baseline; latency p95 <=1.10x baseline
ở cùng workload, repair requests không tăng. Đây là ngưỡng mục tiêu để nghiệm thu,
không số đã đo; nêu sample size/variance, không suy rộng từ 3 runs sang mọi video.
Thiếu corpus/reviewer/server/font thì giữ trạng thái unqualified, không đánh dấu
task qualification đã complete. ASR/TTS/render E2E được đánh giá riêng với artifact.
