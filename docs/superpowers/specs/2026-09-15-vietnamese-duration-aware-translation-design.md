# Đặc tả: dịch tiếng Việt theo thời lượng, ngữ cảnh toàn video và Gateway 1M

- Ngày: 2026-09-15. Mã: `VI-DUB-20260915`. Trạng thái: **SPEC PROPOSED — chưa triển khai**.
- Phạm vi được yêu cầu: specs và planning; không thay đổi code production, gọi dịch/TTS, cập nhật Gateway hoặc cài WinLocal trong lượt lập tài liệu.
- Quyết định trực tiếp của người dùng: **không dùng Gemini tạo giọng**; **Gemini Gateway hỗ trợ đầy đủ context 1M và phải đưa vào triển khai chính**.
- Baseline: HEAD `d73db0378aabbca81969e0098cebac7ed70d2dfc` cùng các thay đổi local đang có. HEAD một mình không đại diện cho source đã kiểm tra.
- Đọc tiếp: [kế hoạch](../plans/2026-09-15-vietnamese-duration-aware-translation.md), [nghiệm thu](../../benchmarks/2026-09-15-vietnamese-duration-aware-translation-evaluation.md), [review tiền đề](../../../.ai/tasks/2026-09-15-vietnamese-translation-design-review/REVIEW.md).
- Chi tiết interface/test seed: [hợp đồng thực thi](2026-09-15-vietnamese-duration-aware-translation-contracts.md).

## 1. Mục tiêu, phạm vi và thứ tự ưu tiên

Tạo lời dịch cho người Việt: đúng và đủ ý, văn nói tự nhiên, nhất quán, gọn trong thời gian cho phép, ít phải tăng tốc hoặc kéo dài hình. Không tối ưu riêng độ ngắn và không hứa mọi đầu vào đều vừa.

Thứ tự quyết định: toàn vẹn nguồn/protocol → không chấp nhận lỗi nghĩa đã xác định → tự nhiên và rõ ý → vừa thời gian → chi phí/độ trễ. Điểm văn phong cao không bù được một cảnh báo sai nghĩa nghiêm trọng đã xác minh.

Trong phạm vi: phân nhóm thoại, budget, hai lượt dịch/review, văn phong Việt, kiểm tra ngữ nghĩa, predictor theo giọng, measured recovery, context 1M, output planning, cache/resume, telemetry, đánh giá và rollout Windows.

Ngoài phạm vi: Gemini TTS/Live audio; đổi provider tạo giọng; tự động clone thêm giọng; lip-sync chỉnh mặt; tự huấn luyện mô hình speech-to-speech; tự xuất bản Facebook/YouTube; thêm microservice/vector database; sửa OCR/STTN/Douyin/font không liên quan. Giữ `local-tts` và `edge-tts`, voice/model/options người dùng đã chọn. Không gửi chỉ dẫn văn phong vào trường text mà TTS sẽ đọc thành lời.

### 1.1. Bao phủ các trao đổi trong session

| Chủ đề | Quyết định đặc tả |
|---|---|
| Vì sao dịch đôi lúc dài | Đo và phân loại nguyên nhân: nghĩa, nhóm, budget, phát âm, TTS bất thường; không quy mọi lỗi cho prompt |
| Tính budget thế nào | Tách context token, output token, thời lượng thoại, accounting request/time và disk |
| Có ép được không | Code ép toàn vẹn cấu trúc và giới hạn audio; độ ngắn là mục tiêu có kiểm tra nghĩa, không hard word cap |
| Văn phong cho người Việt | Profile `vi-VN/narrative-neutral`, glossary, ví dụ đã duyệt và kiểm tra theo lĩnh vực |
| Thuật toán/system design | Tái dùng DP, ridge, feedback đo thật; thêm constrained selection và evidence-based review |
| Facebook/YouTube | Học nguyên tắc phối hợp nội dung–thời gian và quality gate; không khẳng định đã sao chép backend của họ |
| Gemini context 1M | Requirement chính, do người dùng xác nhận; triển khai client sử dụng và kiểm chứng đúng giới hạn này |
| Không Gemini tạo giọng | Ràng buộc cứng toàn roadmap; Gemini chỉ phục vụ dịch/review văn bản, tùy chọn hiểu nguồn sau này |
| WinLocal | Chỉ đóng gói/cài sau kiểm thử và yêu cầu triển khai/release riêng; không coi build pass là chất lượng dịch pass |

### 1.2. Nhãn bằng chứng

`CODE_CONFIRMED`: đọc source hiện tại. `TEST_CONFIRMED`: test/probe cục bộ. `USER_CONFIRMED`: người dùng cung cấp capability. `DOCUMENTED_ONLY`: tài liệu hãng/nghiên cứu. `PROPOSED`: thiết kế chưa chạy. `UNKNOWN`: chưa có bằng chứng tương ứng.

Gateway 1M là `USER_CONFIRMED`, không còn là một giả thuyết chặn thiết kế. Hiệu quả tại biên 1M của client mới vẫn cần test và live qualification trước khi ghi `TEST_CONFIRMED`/live passed. Không phủ nhận capability chỉ vì client cũ đang ghi `null`.

## 2. Baseline và các khoảng trống

Ba phương án đã cân nhắc: (A) chỉ sửa prompt/cap từ — ít thay đổi nhưng không giải quyết mismatch nhóm và thời lượng; (B) shared plan + long-context + feedback đo thật — lựa chọn của spec vì tái dùng được kiến trúc hiện tại; (C) đổi sang speech-to-speech/Gemini voice — ngoài yêu cầu và bị loại theo chỉ dẫn người dùng. Đây là một pipeline liên kết, không phải dự án xây lại toàn ứng dụng. Core và optimization có gate triển khai riêng.

| ID | Bằng chứng hiện tại | Cải tiến cần làm |
|---|---|---|
| B01 | `geminiGatewayPrompts.ts:18` chỉ gửi id/group_id/text; probe xác nhận hai lượt thiếu duration | Budget tại speech unit cho cả draft/review |
| B02 | Probe 6 mảnh × 1 giây: tổng cửa sổ riêng 3 giây, cửa sổ nhóm 5,5 giây | Một phân hoạch và một cách tính cửa sổ dùng chung |
| B03 | Gateway dùng reviewed target boundaries; nhánh thường có source DP | Giữ khả năng phục hồi boundary, chốt plan trước review cuối, không regroup ngầm ở TTS |
| B04 | Guard hiện vẫn nhận “muối → đường” và đảo thứ tự rút điện/vệ sinh | Phân biệt cấu trúc, semantic evidence, mức bất định |
| B05 | Ridge predictor đã có; `confidence=0`, `calibration=uncalibrated` | Calibration theo đúng voice/backend; không tự biến residual train thành confidence |
| B06 | Fit phân loại tại trần 1,80x; measured overflow mới vào rephrase | Đưa mục tiêu 1,10x/1,25x vào dịch; nâng chất lượng có chọn lọc, không thêm vòng vô hạn |
| B07 | Gateway `wholeDocument=true`, `contextTokens=null`, `outputTokens=16384` | Capability 1M hữu hạn; token accounting theo payload thật và output-aware planning |
| B08 | Planner đếm builder chuẩn, Gateway dùng builder riêng; chưa đếm draft trong review | Stage-specific render/count; kiểm tra lại trước mọi dispatch |
| B09 | Model wire `gemini-advanced`, chấp nhận model text thực tế Google phục vụ | Giữ chính sách này, ghi observed route; không tái áp đặt bắt buộc 3.1 Pro |
| B10 | Measured TTS/cache/retime/checkpoint đã tồn tại | Mở rộng có version, bảo vệ accepted state và downstream retry |

Probe baseline chạy lại trong lượt lập spec: 0 gọi dịch, 0 gọi TTS; 74 test liên quan pass. Hai negative controls là lỗi cố ý để chứng minh giới hạn validator, không phải ví dụ lỗi được model production sinh ra. Timestamp Volvo 44 cue là fixture tổng hợp, không dùng tính hiệu quả thời lượng thật. Nguồn 113 cue cũng chưa có WAV mới trong lượt này.

## 3. Ràng buộc bắt buộc

- **R01 — Source ledger:** ID, thứ tự, text nguồn, timestamp và source-time identity không bị model sửa. Source sau temporal cut vẫn có lineage về media gốc; không vượt cut seam đã chặn.
- **R02 — Không mất lời:** Không drop cue, cắt WAV đang nói hoặc pad để che tempo vi phạm. Source quá dày có thể kết thúc bằng lỗi có bằng chứng.
- **R03 — Policy vật lý:** Giữ trần 1,80x, mục tiêu preferred 1,10x/normal 1,25x; đây là target chất lượng chứ không tự ghi đè setting pace hiện có. Không đổi silence trim -50 dB/30 ms/100 ms, EOF guard 0,12 giây hoặc gap policy.
- **R04 — Gap/retime:** Gap chọn theo nguồn, có quy tắc rút gọn cho cue rất ngắn; không ép 0,50 giây cho mọi mảnh. Giữ gap đã quyết định khi retime. Extension tối đa 60% từng đoạn, phần slowdown tối đa 20% theo policy hiện hành; không cộng extension vào budget draft.
- **R05 — TTS bất biến:** Không tích hợp Gemini voice; giữ transport, scheduler/lease, cache audio, catalog/preflight, lựa chọn voice và provider hiện tại.
- **R06 — Accounting:** Không bật lại quota tổng request/recovery/thời gian dịch. Giữ counters, timeout, cancel, retry ownership và no-progress. Hữu hạn theo candidate/revision/error state không đồng nghĩa áp quota tổng mới.
- **R07 — An toàn:** Giữ license, typed IPC, isomorphic shared types, safeContainedPath, child-process tracking, scratch/disk budget, Planar RGB và media đã render hợp lệ.
- **R08 — Phân biệt mode:** `subtitle` không chịu budget phát âm của `dubbing`. Không khiến các ngôn ngữ khác tự dùng profile tiếng Việt.
- **R09 — Untrusted input:** Transcript, OCR, glossary, ví dụ, source analysis và output reviewer là data; không thực thi instruction nằm trong chúng.

## 4. Hợp đồng nhóm thoại và vòng đời

### 4.1. Ba loại đơn vị không được đánh đồng

`SourceCue`: phần tử nguồn bất biến. `SpeechUnit`: nhóm cue liên tiếp được đọc liền. `GenerationBatch`: tập ID cần model trả trong một request. Batch bị chia vì output token không làm SpeechUnit tự bị chia.

Hợp đồng nội bộ đề xuất, chưa phải wire schema đang chạy:

```ts
interface SpeechUnitPlan {
  schemaVersion: 'speech-unit-plan-v1'
  sourceDigest: string
  temporalEditDigest: string | null
  revision: number
  planDigest: string
  boundaryPolicyVersion: string
  status: 'provisional' | 'frozen'
  units: SpeechUnit[]
}
interface SpeechUnit {
  id: string
  memberCueIds: string[]
  sourceStart: number
  sourceEnd: number
  boundaryReasons: string[]
  window: {
    scheduledStart: number
    deadline: number
    effectiveGapAfter: number
    availableSeconds: number
    coordinateSpace: 'source'
    policyVersion: string
  }
}
```

Invariants: coverage đúng 1 lần; mỗi nhóm liên tiếp, không rỗng; không đổi speaker/cut seam hoặc vượt biên nguồn bắt buộc; số đều hữu hạn. Nội bộ hash do Main tính, không để shared import crypto. Plan source và time map output là hai object riêng.

### 4.2. Phân hoạch và chốt boundary

1. Lập provisional plan từ source DP có sẵn.
2. Draft đọc toàn ledger, nhận budget provisional có nhãn rõ. V1 lấy dấu câu draft làm boundary proposal, giữ nguyên output keyed; chưa đòi thêm LLM call hoặc trường output mới.
3. Code kiểm tra các cue edge, chạy phân hoạch có ràng buộc, chốt plan và materialize budget chính xác trước independent review.
4. Reviewer trả text theo plan chốt. Dấu câu phù hợp với plan không làm TTS tự đổi nhóm. Boundary conflict trả finding có ID; sửa đúng nhóm trong recovery hiện có, không dựng lại toàn bài ngầm.
5. Khi thực sự cần đổi plan: revision mới chỉ cho phạm vi chưa finalize, xác minh mapping và tính lại mọi budget liên quan trước review/TTS. Một vòng phản hồi boundary bổ sung là giới hạn khởi đầu đề xuất; proposal lặp hash/no-progress dừng với lý do rõ. Đây không phải quota tổng dịch.

Tái dùng DP: `cost[j] = min(cost[i] + groupCost(i,j))` trên các edge hợp lệ. Hard constraints đứng ngoài hàm cost. Penalty mềm gồm fragment lẻ, cắt mệnh đề/phủ định/điều kiện, nhóm quá dày và xa sentence boundary. Metadata ngữ nghĩa do model đề xuất chỉ là soft evidence nếu chưa xác minh.

Độ phức tạp mục tiêu `O(n*k)` với k số edge ứng viên bị chặn; không dùng tìm kiếm toàn cục không giới hạn. Giữ profile baseline source 6 cue/15 giây/300 ký tự và reviewed Gateway 10 cue/18 giây nơi đang áp dụng; không ép profile 6 cue vào câu 7 cue đã có regression. Mọi thay đổi các giới hạn phải qua ablation, không tự tăng vì context 1M.

### 4.3. Alignment và phụ đề

V1 vẫn trả `translations[cueId]`; mỗi cue đúng một lần. Tự nhiên hóa ở mức nhóm nhưng không chuyển sự kiện qua ID để làm dòng ngắn hơn. Nếu cần tái cấu trúc rộng khiến không thể giữ alignment hiện có, đánh dấu ca đó, không chia script bằng vị trí câu.

TTS dùng group text có lineage; phụ đề dựng bằng code từ mapping hợp lệ. Đầu ra phụ đề sau retime có timeline output riêng, không sửa timestamp ledger. Rephrase nhóm phải cập nhật final spoken text và mapping phụ đề cùng transaction; không được audio nói một bản, caption giữ bản khác.

## 5. Budget thời lượng và budget token

### 5.1. Thời lượng

Cho nhóm g đã freeze:

```text
Wg      = deadline(g) - scheduledStart(g)
Dtarget = Wg * targetTempo
Dhard   = Wg * hardTempo
Rneeded = measuredNaturalSeconds / measuredAvailableSeconds
```

`Wg` lấy từ hàm policy hiện hữu, không lấy tổng budget cue con và không trừ gap lần nữa. Early start chỉ được tính khi planner xác minh khoảng lặng và audio mode cho phép. Budget prompt trước đo không hứa có headroom đó. Nếu Wg không dương, lỗi planning; không clamp lên một budget giả để tiếp tục.

Ví dụ fixture 6 mảnh: W=5,5 giây; target 1,10 cho Dtarget=6,05; trần 1,80 cho Dhard=9,9. Dhard là trần audio tự nhiên trước DSP, không phải chỉ tiêu để model tận dụng. Câu nằm dưới Dhard vẫn có thể bị đánh giá dài/vòng vo.

Input prompt nhóm: unit_id, member_ids, available_seconds, target_natural_seconds, hard_max_natural_seconds, target_tempo, budget_revision, uncertainty. Gửi nhóm một lần và tham chiếu từ cue; không lặp toàn bảng ở mọi dòng.

Số từ/ký tự/spokenUnits chỉ advisory. `max_tokens` bảo vệ response, không dùng cắt nghĩa. Mọi con số target do code tính, không nhận số model tự báo làm bằng chứng fit.

### 5.2. Context 1M — yêu cầu triển khai chính

**R10:** client phải khai báo và sử dụng context 1M của Gateway, thay `null`. Dùng `1_000_000` token làm mức 1M bảo thủ theo xác nhận của người dùng; nếu contract trả chính xác `1_048_576` thì dùng số đó có provenance. Không tự đồng nhất 1M context với 1M output.

Capability snapshot cần: contextWindowTokens/inputTokenLimit, limitKind (`combined` hoặc `input-only`), outputTokenLimit, tokenCounterIdentity, request/response byte limits, route policy/fingerprint, provenance và thời điểm snapshot. Nếu contract chưa nêu input-only hay combined, kế toán theo combined bảo thủ; không đổi về unknown hoặc cap legacy 24 cue/20.000 ký tự. Sai khác capability từ server phải thành lỗi cấu hình rõ, không downgrade âm thầm.

Đếm **representation thực sự vào model của từng stage**, gồm system/style/glossary/examples, source, plan/budget, findings và candidate draft ở lượt review. Không dùng builder chuẩn để ước lượng một Gateway prompt khác. Tái kiểm tra sau serialize trước dispatch; review phải được preflight lại khi draft đã có.

Nếu Gateway thêm role wrapper/system prefix/schema sau client serialization, counter phía Gateway phải tính cả phần này hoặc công bố overhead được qualified trong capability snapshot. Client đếm JSON bytes/message text một mình không được gắn nhãn exact upstream token count. Đây là yêu cầu integration counter, không thay đổi capability 1M đã chốt.

```text
Istage = tokens(actual rendered stage input)
Ostage = reserved output for requested IDs + schema/findings overhead
combined:   Istage + Ostage + safetyReserve <= contextWindowTokens
input-only: Istage + safetyReserve <= inputTokenLimit
always:     Ostage <= outputTokenLimit; requestBytes <= requestByteLimit
```

Safety reserve có version, giải thích được; không áp 20–30% cố định làm vô hiệu hóa lợi ích 1M. Ưu tiên bộ đếm token chính xác của Gateway/cùng tokenizer đã qualified. Nếu chưa có, dùng estimate được đo sai số trên Việt/Trung/JSON; ghi rõ estimate, không gọi byte count là token count chính xác. Near-limit cần counter chính xác hoặc trả trạng thái count-unqualified, không gửi payload có nguy cơ vượt giới hạn và giả định sẽ tự cắt.

`outputTokenLimit` hiện client đặt 16.384; giữ mức này cho đến khi có contract riêng xác nhận lớn hơn. Không tự đổi thành 65.536 chỉ vì một model API công bố vậy. Bỏ/đổi các cap client cũ chỉ trong Gateway path và đồng bộ bounded parser/audit; không nới vô hạn reader của mọi provider.

### 5.3. Hiểu toàn bộ, sinh đầu ra có kiểm soát

Video ngắn vừa cả input/output: toàn ledger, hai lượt draft/review. Không chia máy móc theo cue khi context và output đủ.

Video dài còn vừa input 1M nhưng output quá lớn: giữ full source làm read-only context, phân `requestedIds` thành nhóm output vừa trần. Mỗi request trả đúng IDs được giao; cả lượt review chỉ xuất IDs đó. Context-only IDs có role rõ, parser không cho chúng lọt vào output. Giữ full source trong review nếu fit; thêm draft phần cần review và bản dịch lân cận cần thiết, không nhất thiết nhét toàn bộ translated document vào từng request.

Output forecast dựa trên phân bố token đích theo locale + số ID/schema; không chỉ lấy độ dài nguồn. Nếu response vẫn truncated: không nhận JSON tự đóng; chia tập output chưa accepted ở boundary hợp lệ, giảm kích thước nghiêm ngặt, không dịch lại phần đã accepted. Cần hỗ trợ trường hợp một source cue bị chia nội bộ và tái dựng bằng offset mapping hiện có.

Nếu tổng nội dung thật vượt 1M: chia theo cảnh/nhóm có local context nguyên văn, glossary/entity ledger và evidence references toàn cục. Synopsis không thay cho nguồn của IDs đang dịch. Không âm thầm drop đầu/cuối video để fit. Đây là xử lý quá giới hạn thật, không phải lý do bỏ sử dụng 1M.

Context cache của provider là tối ưu riêng: chỉ triển khai khi endpoint hỗ trợ, tách theo account/route/source/version/TTL; hết hạn phải rehydrate, không suy ra cache hit từ việc request thành công. Local checkpoint/cache không thay thế server context cache. Không tự chuyển sang API trả phí khác chỉ để dùng cache.

## 6. Văn phong Việt và toàn vẹn ý

### 6.1. Profile `vi-VN/narrative-neutral-v1`

- Dùng trật tự câu trực tiếp, động từ rõ, thuật ngữ Việt đúng lĩnh vực; rút lặp và cấu trúc vòng vo.
- Giữ chủ thể/đối tượng khi có thể nhầm, số–đơn vị, phủ định, điều kiện, thứ tự hành động, quan hệ nhân quả, mức độ chắc chắn, câu hỏi và sắc thái nguồn.
- Không tự thêm quảng cáo/CTA/hook/cảm thán, địa phương hóa quá mức hoặc tạo đơn vị tiền từ một số trần. CTA đã có ở nguồn vẫn phải dịch.
- Không cấm toàn bộ Hán Việt, không thay máy móc “có thể”, “chỉ”, “không”, “nếu”, “trước khi”. Các từ này có thể mang ý bắt buộc.
- Quy tắc xưng hô và thuật ngữ nhất quán toàn video; không đổi vì một batch khác được sinh sau.

Tạo 20–30 ví dụ nguồn → bản Việt do người Việt duyệt cho đồ bếp/ô-tô/khoa học/hội thoại. Chọn 2–3 ví dụ liên quan bằng tag cho MVP. Bộ lớn hơn chỉ đưa vào ablation long-context, không mặc định nhồi ví dụ đầy 1M. Source và ví dụ tách rõ, không copy facts từ ví dụ.

Ví dụ biên tập minh họa, chưa phải gold đã nghiệm thu audio: “Chỉ cần xoay ba núm vặn là có thể chuyển đổi các hình dạng và độ dày khác nhau” → “Chỉ cần xoay ba núm để đổi hình dạng và độ dày”. Không áp bằng replace toàn cục.

### 6.2. Semantic evidence và verdict

Event sketch gồm subject/action/object/quantity/unit/polarity/condition/order/cause/modality, kèm sourceCueIds và exact source spans. Code xác minh span tồn tại; điều này không tự chứng minh diễn giải đúng. Source sketch do LLM sinh có thể bỏ ý, nên reviewer vẫn đọc nguồn gốc.

Phân biệt `protocolValid`, `semanticStatus: reviewed|suspect|failed`, và `timingStatus: predicted|measured-fit|overflow`. Không dùng một boolean `ok` để ngụ ý cả ba đã đạt.

| Loại finding | Hành vi |
|---|---|
| Missing/duplicate/unknown ID, incomplete envelope, empty text, invalid bounds | Hard fail cấu trúc; không vào accepted state |
| Sai số/đơn vị theo mapping ngôn ngữ đã qualified hoặc contradiction được xác minh | Reject candidate; repair đúng nhóm |
| Reviewer nghi đảo quan hệ/mất chủ thể/ASR mơ hồ | Candidate pending; đối chiếu source, giữ bản tốt trước đó; không tự gán chắc chắn chỉ từ LLM score |
| Word heuristic, locale/pronunciation chưa qualified, nghi ngờ không tái lập | Advisory; không chặn chỉ vì warning |
| Văn phong dài nhưng đủ ý và measured-fit | Giữ được nếu sửa gây rủi ro; quality optimization có gate riêng |

MVP bổ sung negative controls “muối/đường”, “BEFORE(unplug, clean)”, actor swap, không → có, nếu → luôn, số trần → tiền, khả năng → khẳng định. Cần cả positive paraphrases để tránh một validator chỉ biết từ chối. Cross-language verifier và same-language rephrase guard là hai contract khác nhau; không đưa source Trung vào bộ chỉ hiểu so sánh Việt–Việt rồi coi kết quả tương đương.

Reviewer trả finding có loại lỗi/span/lý do ngắn, không yêu cầu chain-of-thought. Dùng đánh giá kiểu MQM, không điểm embedding hoặc back-translation đơn lẻ để quyết định đủ ý. Mở rộng wire findings/candidates là version mới chỉ khi cả adapter, parser và Gateway hỗ trợ; V1 giữ keyed output hiện tại, findings nội bộ từ validator, không thêm field lén.

## 7. Predictor, lựa chọn candidate và measured feedback

### 7.1. Predictor theo giọng, không thay TTS

Tái dùng ridge và profile store hiện có. Baseline words/graphemes vẫn giữ nghĩa version cũ. Version feature mới bổ sung spokenUnits ước lượng, độ dài cách đọc số, đơn vị/viết tắt, tên ngoại và dấu ngắt.

Chuẩn hóa cách đọc là bản biểu diễn để dự báo; không âm thầm đổi chữ gửi TTS. Trường hợp `1.250 kg` mơ hồ lưu phương án đọc/uncertainty. Chỉ sửa text phát âm sau kiểm tra ý và đúng capability backend.

Key gồm provider, model/revision, voice, reference audio digest (nếu đã dùng), locale, options, speed, trim/feature versions. Mẫu train chỉ lấy WAV hợp lệ trước DSP với final spoken text tương ứng; loại lỗi decode/hallucinated repetition và không tính cache hit trùng như mẫu độc lập mới. Tách dữ liệu theo video/người nói, không cho candidate cùng nguồn lọt qua train/test.

Cold start: advisory, không tự rewrite trước TTS do predictor báo quá dài. Fit residual không phải confidence. Sau held-out qualification mới sử dụng cận dự báo để ưu tiên candidate; vẫn đo WAV. Drift model/voice/trim làm calibration hết hiệu lực. Robust/quantile regression và split conformal là bước thử nghiệm sau ridge, không dependency MVP; coverage không bảo đảm từng câu.

### 7.2. Candidate selection

Mặc định hai lượt dịch/review; không yêu cầu ba phương án cho mọi câu. Nhóm có rủi ro được cân nhắc tối đa ba candidate theo contract recovery hiện có hoặc wire mới đã versioned. Giữ candidate đầy đủ làm fallback.

Chọn có ràng buộc: loại structural error/semantic failure đã xác minh → ưu tiên nghĩa/naturalness → dùng duration estimate như tie-breaker có uncertainty → đo candidate ưu tiên → chốt khi measured-fit. Pareto pruning chỉ loại phương án bị dominated trên tiêu chí có bằng chứng; không loại câu duy nhất đủ ý vì predictor chưa hiệu chuẩn.

Không cộng tất cả thành một weighted score cho phép “ngắn hơn” bù sai nghĩa. Deterministic ordering khi bằng điểm; audit ghi vì sao chọn/loại và evidence type.

### 7.3. Feedback và dừng

Giữ measured-first: synthesize bằng TTS đã chọn → decode/trim/measure → phân loại → batch rephrase overflow → đo rescue → retime/reflow/split theo policy hiện tại → đo final audio trước publication. Không đổi thứ tự structural split một cách tổng quát; extension-enabled và extension-disabled phải giữ test riêng.

Trạng thái feedback mang source text, current/final text, group IDs, plan/budget revision, WAV duration, available seconds, tempo cần, semantic findings và candidate hash. Không gửi lại cue đã đạt chỉ vì một cue khác lỗi. Không kéo dài hình trước để né việc sửa bản dịch dài.

Quality repair sau đo cho câu fit ở >1,25x nhưng văn phong còn dài là **giai đoạn opt-in**, không bật mặc định MVP. Nếu chạy, dùng cùng candidate queue và no-progress state, giữ bản measured-fit trước đó; không repair chỉ vì vượt word hint. Không lặp candidate text/WAV hash đã thử hoặc mở thêm vòng mới sau mỗi rename state.

Lỗi TTS/provider/audio bất thường phải đi recovery provider hiện hữu; không buộc dịch ngắn hơn để che WAV sai. Lần retry item cuối batch hiện có dùng journal chung để không khởi động lại vô hạn toàn bộ optimization.

## 8. Identity, cache/resume, audit và UI

**R11 — Identity:** accepted translation key gồm source/cut digest, locale, provider endpoint+route policy, prompt/parser/style/glossary versions, frozen plan digest và budget snapshot. Dữ liệu predictor cập nhật sau mỗi WAV không invalidate request đang chạy; snapshot theo job. Observed model của response lưu provenance; model fallback hợp lệ vẫn được chấp nhận theo chính sách hiện hành.

**R12 — Transaction:** candidate response chỉ thay accepted revision khi qua gates tương ứng. Crash/cancel trong review không mất draft, accepted text hoặc audio trước đó. Response đến muộn bị bỏ nếu job/revision đã đổi. Plan revision chỉ invalidate downstream trong closure bị ảnh hưởng, không xóa source/checkpoint toàn video.

**R13 — Resume:** checkpoint cũ không có plan mới vẫn đọc theo đường legacy; không giả migrated-quality. Bật đường mới thì tạo revision/namespace mới và revalidate, không chạy lại dịch khi chỉ TTS/render lỗi mà accepted identity còn đúng. Cache WAV vẫn theo text/voice/options; thay subtitle layout không làm regenerate voice vô ích.

**R14 — Log:** từng stage ghi job/unit/request IDs, versions, requested+observed route, exact/estimated input count, output reserve/actual/truncation, context-only/requested ID counts, counters logical generation/upstream attempt/cache/repair, timings, predicted/actual duration, tempo/extension, findings và stop reason. Unknown token/cost là null kèm reason, không ghi 0.

Audit raw payload opt-in, bounded, redacted; không log cookie/token/private reference URL. Input 1M không được nhân bản nguyên văn vào mỗi event/IPC; hash + file sidecar scoped + references. Serialize/hash/count không block renderer, không O(n²) dựng lại toàn source cho mọi cue; memoize immutable prefix/token ledger khi counter cho phép, rồi exact preflight cuối. Cache số token keyed theo stage representation+counter version, không trộn tokenizer model khác.

**R15 — UI:** mặc định không thêm màn hình cấu hình rối. Hiển thị tiến độ hai lượt dịch, nhóm cần sửa, kiểm tra thời lượng; chi tiết tùy chọn “đủ ý/chưa chắc”, predicted vs measured, tempo và nguyên nhân. Không hiển thị “chuẩn 100%”. Hủy qua IPC hiện hữu; resume có hành động rõ ràng. Cấu hình cũ giữ hành vi tương thích.

## 9. Roadmap phạm vi mở rộng

Core release: Gateway 1M + budget/group thống nhất + profile Việt + semantic guard + versioned resume + measurement/benchmark. Không cần đổi provider TTS.

Sau core: calibration theo voice, candidate optimization và quality repair opt-in; provider context caching nếu hỗ trợ. Hiểu nguồn đa phương thức bằng Gemini chỉ là opt-in khi cần sửa ASR/OCR mơ hồ: giữ source evidence, sự cho phép upload, capability/media byte limits và chi phí rõ. Đây không phải sinh giọng; không tự gửi toàn video ở chế độ mặc định text-only.

Chưa triển khai: fine-tuning duration-aware translation/SSPO, forced alignment mới hoặc đổi phonemizer nặng trước khi benchmark chứng minh cần. Có thể nghiên cứu sau với giấy phép/dữ liệu/phần cứng riêng; không kéo những việc này vào đường găng core.

## 10. Tài liệu tham chiếu và giới hạn suy luận

- [Gemini long context](https://ai.google.dev/gemini-api/docs/long-context): context lớn hữu ích cho thông tin toàn cục; không phải cam kết tuân thủ mọi chi tiết hoặc thời lượng. Caching là tối ưu chi phí riêng.
- [Gemini Models API](https://ai.google.dev/api/models): input/output limits có trường riêng. Metadata API không thay cho capability của Gateway; trong spec này 1M đến từ xác nhận người dùng.
- [Duration-based Translation, EMNLP 2025](https://aclanthology.org/2025.emnlp-demos.37/): tham khảo việc tối ưu dịch theo thời lượng; kết quả nghiên cứu không chứng minh chất lượng Việt của project.
- [GEMBA-MQM](https://aclanthology.org/2023.wmt-1.64/): tham khảo lỗi có span thay vì một điểm tổng quát; không đưa model TTS mới vào hệ thống.
- [Conformal prediction](https://arxiv.org/abs/2107.07511): tham khảo uncertainty/calibration; cần dữ liệu độc lập và giả định phân phối phù hợp.

Toàn bộ thuật toán tích hợp, schema và gate trên là đề xuất của project. Không tuyên bố Facebook/YouTube dùng cùng công thức hoặc TediaPros đã đạt chất lượng tương đương. Điều kiện chấp nhận nằm trong tài liệu nghiệm thu; chưa có số liệu cải thiện live.
