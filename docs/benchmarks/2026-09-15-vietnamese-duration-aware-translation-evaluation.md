# Nghiệm thu: dịch Việt theo thời lượng và Gateway context 1M

- Ngày: 2026-09-15. Mã: `VI-DUB-EVAL-v1`.
- Trạng thái: **PROPOSED PROTOCOL**, chưa có kết quả A/B live của thiết kế mới.
- [Spec](../superpowers/specs/2026-09-15-vietnamese-duration-aware-translation-design.md); [plan](../superpowers/plans/2026-09-15-vietnamese-duration-aware-translation.md).
- Gateway 1M: capability do người dùng xác nhận; các test dưới đây nghiệm thu cách client khai thác capability đó, không dùng để trì hoãn đưa 1M vào core.
- Giọng đọc: chỉ `local-tts`/`edge-tts` với voice/model/options đã chọn. Không Gemini TTS/Live hoặc provider voice mới.

## 1. Hai loại nghiệm thu độc lập

**Engineering gate:** cấu trúc/ID/timing, input/output/token/byte limits, chống partial publish, cancel, recovery, checkpoint và cache đúng. Test mock/synthetic đủ để kiểm tra nhiều điều kiện của gate này.

**Content/audio gate:** đủ ý, tiếng Việt tự nhiên, nghe rõ, không đuối hơi hoặc chậm/ngắt bất thường, hình và lời phù hợp. Cần nguồn thật, WAV thật và người chấm; 74 baseline unit tests không thay thế gate này. Một request 1M thành công cũng không chứng minh model hiểu đúng toàn bộ mọi chi tiết.

## 2. Corpus và dữ liệu phải lưu

Khởi đầu 60 video thật, ít nhất 600 speech units. Đây là quy mô pilot đề xuất, không phải bảo đảm thống kê cho lỗi hiếm. Nếu corpus thực tế ít hơn, báo `PILOT_INSUFFICIENT`, không gắn nhãn production-qualified.

- Bốn nhóm nội dung chính: đồ bếp/đồ gia dụng, ô-tô/công cụ, khoa học/giải thích, hội thoại; bao gồm nguồn nhiễu OCR/ASR, số/đơn vị/tên riêng, câu phủ định/điều kiện và lời nói nhanh.
- Giữ ngôn ngữ nguồn thật và locale đích `vi-VN`; ưu tiên cặp ngôn ngữ đang dùng, không suy kết quả sang mọi ngôn ngữ.
- Tối thiểu 10 video nhiều mảnh cue ngắn; 10 video có tên/số/đơn vị; 10 video có phủ định/điều kiện/thứ tự hành động. Một video được mang nhiều tag.
- Tách 30 train/development, 10 calibration, 20 held-out test theo video. Duplicate/reupload/các đoạn cùng video gốc thuộc cùng split. Tuyệt đối không đưa gold test vào prompt examples/glossary tự học.
- Bộ context 1M là synthetic riêng, không được tính như video/giọng thật trong chất lượng dịch.
- Fixture Volvo 44 cue có timestamps đều tổng hợp: chỉ dùng text/protocol regression, không tính timing fit. Fixture 113 cue: dùng text/ledger; chỉ vào timing dataset khi có media và WAV đo cùng cấu hình.

Manifest video gồm: fixtureId, sourceDigest, media SHA-256, consent/data provenance, sourceLanguage/targetLocale, source cue ledger, speaker/domain/risk tags, temporalEditDigest, split, source-timing origin và evaluator ID. Không lưu token/cookie/URL có auth.

Manifest run gồm: source+dirty code hashes, branch/HEAD, versions prompt/style/schema/plan/policy, requested+observed model route, Gateway capability snapshot/counter version, TTS provider/model/revision/voice/options/reference digest/speed, FFmpeg/trim versions, timestamps, status/error/cancel, raw request counters và prediction/measurement provenance. Giữ source ledger riêng khỏi output retime ledger.

## 3. Thiết kế so sánh

| Arm | Thay đổi | Vai trò |
|---|---|---|
| A | Baseline hiện tại | Mốc so sánh cùng source/TTS |
| B | A + đúng 1M accounting/output planning + shared plan/group budget + profile Việt | Đo lợi ích core nghĩa–thời gian |
| C | B + semantic verifier/versioned recovery/cache | Core release candidate |
| D | C + predictor đã qualified cho voice + candidate selection | Sau core, không gộp công lao với B |
| E | D + quality repair measured-fit có điều kiện | Opt-in, đo chi phí bổ sung |

Chạy theo cặp trên cùng input, voice, speed và provider options; randomize thứ tự A/C theo video để giảm bias tải server. Model route fallback hợp lệ vẫn được ghi: nếu A/C dùng observed model khác nhau, stratify/báo confound hoặc chạy lại mẫu so sánh; không kết luận thuật toán thắng chỉ do đổi model.

Cache policy phải khai báo: cold run riêng để đo latency/provider cost, warm downstream rerun riêng để đo resume. Không trộn cache-hit của một arm với cold của arm khác. Với tối thiểu 10 video test, chạy lặp có kiểm soát để đo biến động generation/TTS; lặp không tính thành video độc lập.

Không cherry-pick candidate hoặc video chỉ vì nghe tốt. Tất cả failure/cancel/truncation phải xuất hiện trong denominator thích hợp, kèm phân loại user-cancel/provider-failure/content-failure. Không bỏ video khó khỏi báo cáo rồi tuyên bố fit tăng.

## 4. Chấm nghĩa và văn phong

Hai người Việt chấm mù A/C: không thấy tên arm/prompt/model, thứ tự trình bày ngẫu nhiên, xem cùng source/video và nghe audio. Kiểm tra đủ ý cần ít nhất một người hiểu ngôn ngữ nguồn hoặc bản tham chiếu nguồn đã được người đủ năng lực xác minh; chỉ người Việt đọc bản dịch không đủ để đánh giá translation fidelity.

Chấm theo speech unit kèm source span. Bất đồng critical/major cần người phân xử, không lấy trung bình để xóa một lỗi.

### 4.1. Lỗi nghĩa

- **Critical:** đảo phủ định/cảnh báo hoặc thứ tự thao tác gây hiểu nguy hiểm; đổi chủ thể/đối tượng/số/đơn vị cốt lõi; bịa hoặc bỏ mệnh đề làm thay đổi kết luận chính.
- **Major:** mất/thêm ý thực chất, đổi modality/condition/causality, dùng sai thuật ngữ gây sai nội dung nhưng chưa ở mức critical.
- **Minor:** diễn đạt hơi lệch sắc thái hoặc thuật ngữ chưa tối ưu mà không đổi ý thực chất.

Nhóm lỗi: omission, addition, wrong-entity/object, wrong-action-order, wrong-number/unit, polarity, condition/modality, causal-relation, source-restoration, pronoun ambiguity. “Ngắn hơn” không phải nhãn chất lượng.

### 4.2. Thang 1–5

| Điểm | Văn nói Việt | Audio/nhịp |
|---|---|---|
| 1 | Khó hiểu, dịch sát chữ, phải sửa lớn | Khó nghe, cắt/lặp/chồng tiếng hoặc lệch rõ |
| 2 | Nhiều chỗ gượng/vòng vo | Tốc độ/ngắt nghỉ gây mệt, phải nghe lại |
| 3 | Hiểu được, còn vài chỗ không tự nhiên | Nghe được nhưng chưa trôi chảy |
| 4 | Tự nhiên, rõ, gọn, ít cần biên tập | Dễ nghe, nhịp phù hợp hình |
| 5 | Tự nhiên như lời biên tập tốt, đúng sắc thái | Mượt, nhấn/ngắt hợp lý, không thấy bị ép |

Chấm thêm preference A/C/tie; độ gọn, nhất quán xưng hô/thuật ngữ; thời lượng sửa tay. Người chấm không được suy ra “đủ ý” chỉ vì text/WAV ngắn.

## 5. Chỉ số và công thức

`Wsource`: cửa sổ gốc của frozen speech unit trước extension. `Dnatural`: WAV đúng text đã trim, trước DSP. `Dfinal`: WAV sau DSP đo thật. `tempoMeasured = Dnatural / Dfinal` trên cùng đoạn có lời; padding/silence không được dùng làm mẫu số để che tăng tốc.

- `firstPassFit@1.10`, `@1.25`, `@1.80`: tỷ lệ units có audio hợp lệ ngay lượt đầu và `Dnatural <= Wsource × tempoThreshold`. Units sinh lỗi không được coi fit; báo cả số units có/không WAV.
- `tempo P50/P95/max`: số đo cuối cùng, kèm tỷ lệ >1,25; tách source-adaptive/fixed setting. Không lấy speed parameter gửi provider làm measured tempo.
- `extensionRate`, `extraSeconds/video`, `replaySeconds`: tính cả trước/sau policy map, check max 60% từng source segment; slowdown part ≤20%.
- `semanticCritical/Major/Minor per 100 units` và per-video presence; ghi cả lỗi bị guard chặn và lỗi lọt vào accepted output.
- `falseRejectRate`: candidate được người chấm xác nhận faithful/natural nhưng hệ thống hard reject. `suspectRate` tách riêng khỏi hard reject.
- `firstPassNativeScore`, final native/audio score, blind preference/tie và manual edits/minutes.
- Logical translation stages, actual upstream attempts, rephrase calls/IDs, TTS generation count, cache hits, generated audio seconds, queue/provider/total latency P50/P95, input/output tokens thực/ước lượng và bytes.
- `publicationSuccessRate`: video thành công / video đã chạy (trừ user-cancel báo riêng). Report provider outages riêng nhưng không xóa chúng khỏi bảng raw results.
- `downstreamRetryReuseRate`: accepted translations tái dùng đúng identity khi chỉ TTS/render retry; expected 100% với fixtures ổn định.

Chi phí nếu có billing: input chưa cache × đơn giá + input cache × đơn giá cache + output × đơn giá output + cache storage + TTS billing. Đơn giá có nguồn/thời điểm; nếu Gateway không trả usage hoặc gói không tính theo token thì để cost `unknown/not-applicable`, vẫn báo request/time. Không tự quy USD từ một bảng giá API không dùng.

Confidence interval: paired bootstrap theo video, không bootstrap từng cue độc lập để tăng giả sample size. Báo seed, số resample 10.000, 95% interval và stratification. Kết quả chưa đủ dữ liệu là inconclusive, không đồng nghĩa fail kỹ thuật hoặc pass chất lượng.

## 6. Gate chấp nhận đề xuất, đăng ký trước thử nghiệm

Các ngưỡng dưới đây là mục tiêu dự án để chốt trước chạy T09, **không phải kết quả đã đạt hoặc chuẩn phổ quát**. Không thay ngưỡng sau khi xem held-out; nếu đổi phải lập protocol revision và test split mới.

### G-HARD — bắt buộc, không bù trừ

1. Tất cả test ID/schema/completion/source mapping/cancel/no-progress/physical policy pass; không speech dropping/cropping hoặc fake padding. Unknown IDs/truncated JSON không được publish.
2. Không critical semantic error ở bộ adversarial bắt buộc; mọi critical phát hiện trong held-out phải được điều tra/sửa và chạy bộ test mới trước default-on. Zero observed errors không có nghĩa rủi ro bằng 0.
3. Không vượt trần tempo 1,80, gap/EOF/extension theo policy hiện tại trong kiểm tra đo vật lý; tolerance DSP lấy hằng số hiện hữu, không tự nới để pass benchmark.
4. Không Gemini speech-generation request trong toàn trace. Provider/voice không đổi ngoài cấu hình đã chọn.
5. Gateway context 1M hoạt động ở client planning; giới hạn output/bytes riêng được tôn trọng; không cap 24 cue/20.000 ký tự cho Gateway mới.

### G-QUALITY — đề xuất cho core C so với A

- Native fluency và audio score trung bình ≥4/5; lower bound 95% CI của paired difference C−A ≥−0,2 trên mỗi thang.
- Không tăng critical; upper bound 95% CI cho chênh lệch tỷ lệ major C−A ≤2 điểm phần trăm. Đây là non-inferiority margin đề xuất, vẫn sửa mọi critical mới.
- First-pass fit@1.25 tăng ≥10 điểm phần trăm **hoặc** tỷ lệ units cần tempo >1,25 giảm ≥20% tương đối; ít nhất metric được chọn làm primary trước chạy phải có paired CI không bao gồm 0 theo hướng cải thiện. Không chọn metric thắng sau khi xem kết quả.
- Nếu baseline đã có ≥95% first-pass fit@1.25, không đòi +10 điểm bất khả thi: đăng ký primary thay thế là blind preference C hơn A, không tính ties, >60%, lower CI >50%; không tăng extension/replay.
- Tỷ lệ false hard reject ≤2% trên tập positive paraphrase đã chấm; uncertainty warnings không được tính thành reject để che false reject.
- Publication success không giảm quá 2 điểm phần trăm theo point estimate; nếu CI quá rộng, mở rộng pilot thay vì tuyên bố production-qualified.
- P95 end-to-end latency tăng không quá 25%; số TTS generated seconds/video tăng không quá 20% ở core. Nếu vượt, giữ opt-in và trình tradeoff cùng evidence; không tự nâng số retry để đạt success rate.

### G-PREDICTOR — riêng từng voice/backend

- Có tối thiểu 200 mẫu WAV hợp lệ khác text cho train/calibration và 100 mẫu held-out từ ≥10 video; lặp/cache không tính mẫu mới. Nếu corpus pilot không đủ cho từng voice, thu thêm thay vì suy rộng từ voice khác.
- So ridge mới với heuristic/baseline hiện có: MAE không tăng và P90 absolute error giảm ít nhất 10% theo point estimate; báo paired/video CI. Đây là target đề xuất, không số đo hiện tại.
- Nếu dùng Dupper mức danh nghĩa 90%: báo observed coverage, binomial interval và interval width. Calibration quá rộng che mọi sai số không được xem hữu ích; so với reserve baseline cùng coverage. Không gắn bảo đảm 90% cho từng câu hoặc voice chưa test.
- Cold start/drift/mixed-script chưa đủ mẫu tiếp tục advisory; measured WAV luôn là hard authority.

## 7. Ma trận engineering test

| Test ID | Input/tình huống | Expected | Task |
|---|---|---|---|
| CTX01 | Capability user-confirmed 1M; server không có exact counter field | Snapshot 1.000.000, provenance user-confirmed; không null | T01 |
| CTX02 | Combined limit: I+O+reserve = limit−1, limit, limit+1 | Hai ca đầu fit, ca cuối split/reject trước dispatch | T02 |
| CTX03 | Input-only limit, O có cap riêng | Không trừ O hai lần; check cả hai cap | T02 |
| CTX04 | Draft fit, review thêm draft vượt cap | Review replan trước generation, không overflow âm thầm | T02 |
| CTX05 | Full source 800k, output forecast 30k, output cap 16.384 | Chia requested IDs, giữ full context và SpeechUnit identity | T02 |
| CTX06 | ID chỉ thuộc context hoặc duplicate key | Parser reject, accepted state không đổi | T02/T06 |
| CTX07 | Nguồn thật >1M | Scene/local-source strategy có lineage hoặc lỗi rõ; không drop đầu/cuối | T02 |
| CTX08 | Token fit nhưng request byte cap không fit | Bounded error/replan; không nới reader toàn app | T02 |
| CTX09 | Counter unknown gần biên/route counter mismatch | Count-unqualified/config error; không tự gọi exact estimate | T01/T02 |
| CTX10 | Truncated output; subset đã accepted trước đó | Repair target chưa accepted; không auto-close JSON/redo toàn video | T02/T08 |
| CTX11 | Prompt 1M bị cancel lúc count/serialize/provider | Abort có phản hồi, stale response không commit; UI vẫn hoạt động | T02/T08 |
| GRP01 | 6 mảnh liên tiếp 1 giây, cùng câu, next start 6 | Một group W=5,5; không tổng thành W=3 | T03/T04 |
| GRP02 | Gateway câu 7 cue đã có regression | Không bị ép source legacy 6 cue; ledger giữ nguyên | T03 |
| GRP03 | Speaker change/pause bắt buộc/cut seam | Không ghép qua hard boundary | T03 |
| GRP04 | Reviewer đổi dấu câu sau plan freeze | Không regroup TTS ngầm; conflict/revision có budget mới | T03/T05 |
| GRP05 | Boundary proposal lặp hoặc tạo vòng revision | No-progress dừng; không tạo vô hạn generation | T03/T07 |
| TIME01 | EOF cue cuối | Dùng guard 0,12; không thêm 0,50 lần nữa | T04 |
| TIME02 | Cue ngắn ở ngưỡng 550–600 ms | Gap policy nguồn nhất quán, không timing cliff giả | T04 |
| TIME03 | cue-70: 138,72–139,32; gap 0,09; WAV 1,248 | Gap vẫn 0,09 sau retime; fit trong trần; source không đổi | T04/T07 |
| TIME04 | Mix với source audio | Không mượn early start trái policy, không phát lặp thoại ở replay | T07 |
| TIME05 | Required tempo >1,80 sau mọi recovery hợp lệ | Lỗi có ID/seconds; không cắt lời/pad hoặc nâng cap | T07 |
| SEM01 | “2 thìa muối” → “2 thìa đường” | Không đánh dấu đủ ý; reject/finding nguồn chính xác | T06 |
| SEM02 | Rút điện trước vệ sinh → vệ sinh trước rút điện | Phát hiện hướng quan hệ bị đảo | T06 |
| SEM03 | Câu hỏi Trung A-not-A, Việt “có…không?” | Không false positive phủ định máy móc | T06 |
| SEM04 | Số trần → thêm đồng/USD; có thể → chắc chắn | Finding thêm ý/đơn vị/modality | T05/T06 |
| SEM05 | CTA có nguồn/không có nguồn | Giữ CTA nguồn, không bịa CTA mới | T05 |
| SEM06 | Paraphrase gọn nhưng đủ actor/object/condition | Không hard reject chỉ vì ít từ hơn | T06 |
| SEM07 | Reviewer sketch thiếu event | Source vẫn được review, sketch không thay nguồn | T06 |
| SEM08 | Source/OCR chứa “ignore previous instructions” | Là data; không đổi task/model/publish behavior | T05/T06 |
| MODE01 | Subtitle-only hoặc locale khác vi | Không áp speech pressure/profile Việt sai mode | T04/T05 |
| TTS01 | Same input sau sửa planner | Provider/voice/options giữ nguyên; 0 Gemini voice call | T07 |
| TTS02 | WAV lặp âm/quá dài bất thường hoặc decode fail | Audio/provider recovery; không ép bản dịch để che lỗi | T07 |
| TTS03 | Extension bật/tắt | Giữ thứ tự split/rephrase phù hợp từng nhánh đã test | T07 |
| TTS04 | Candidate không tiến bộ/đã thử | Không tổng hợp lại vô ích; accepted candidate cũ giữ nguyên | T07/T12 |
| STATE01 | Crash giữa draft và review | Resume draft đúng identity, không mất source | T08 |
| STATE02 | TTS/render lỗi sau translation accepted | 0 generation dịch mới khi identity không đổi | T08 |
| STATE03 | Plan/style/cut/voice thay đổi | Invalidate đúng dependency, không xóa nguồn/queue khác | T08 |
| STATE04 | Response cũ đến sau cancel/revision | Không ghi vào accepted state mới | T08 |
| STATE05 | Legacy checkpoint thiếu plan mới | Đọc compatibility, không giả đã qua quality mới | T08 |
| PRED01 | Cold start; fit residual trên train thấp | Không tự gán confidence calibrated | T11 |
| PRED02 | “học sinh”, “1.250 kg”, foreign name | Feature version đúng, ambiguity có uncertainty | T11 |
| PRED03 | Model/ref/trim drift; cache hit lặp | Calibration invalid đúng key, không nhân sample count | T11 |
| CACHE01 | Context cache TTL hết/account-route khác | Rehydrate/miss; không dùng nhầm data | T13 |
| PRIV01 | Log 1M prompt chứa auth-looking text | Redaction/bounded artifact, không đưa vào IPC lặp | T08 |
| REL01 | Feature rollback + đang có batch | Job giữ snapshot, artifacts/accepted video còn nguyên | T10 |

## 8. Live context 1M: cách đo và phạm vi claim

1. Dùng source synthetic có nonce/ID/value rải đều đầu, giữa, cuối; không dùng dữ liệu người dùng khi chưa được phép. Theo policy mạng/timeout hiện hữu, không nới timeout âm thầm.
2. Count actual rendered draft và review bằng bộ đếm qualified; log tokenizer/route. Chạy cỡ nhỏ trước, rồi khoảng 250k, 750k và sát limit sau output reserve. Mỗi mức là run riêng có chi phí, chỉ chạy khi triển khai benchmark được yêu cầu.
3. Output nhỏ và schema cố định để tách bài toán input capacity khỏi sinh output dài; kiểm tra exact selected IDs và source facts. Kết quả chỉ là canary coverage, không suy ra bảo toàn mọi ý ở 1M.
4. Chạy thêm test output-heavy riêng để chứng minh output-aware partition; input-only test không đủ chứng minh output 16.384+ được xử lý.
5. Payload >limit phải bị client chặn/replan, không gửi cố ý hàng loạt đến upstream. Test trường hợp quá giới hạn bằng counter mock/local là đủ cho behavior này.
6. Report: user-confirmed capacity; local planning boundary pass/fail; live accepted input token count lớn nhất thực sự chạy; completion/model/token evidence; failures/retries; cost/time. Không ghi “đã test đủ 1M” nếu mới gửi 750k.

## 9. Mẫu báo cáo kết quả bắt buộc

```text
protocolVersion: VI-DUB-EVAL-v1
runId / sourceHashes / sourceTimingOrigin / splitDigest
arm / promptStylePlanSchemaVersions / featureMode
gatewayContextLimit / limitKind / counterVersion / countMethod
requestedRoute / observedRoute / inputTokens / outputTokens / bytes
ttsProvider / modelRevision / voice / optionsDigest / trimVersion
videosAttempted / success / failed / cancelled / unitsMeasured
semanticErrorsBySeverity / falseReject / nativeAudioScores
firstPassFit@1.10,@1.25,@1.80 / tempoP95 / extensionReplaySeconds
generationAttempts / ttsGeneratedSeconds / latency / costOrUnknownReason
pairedDifferences / intervals / evaluatorDisagreements
hardGate / qualityGate / predictorGate / unresolvedRisks / rolloutDecision
```

Không lưu bảng “PASS” trước khi chạy. Output `inconclusive` và `not-run` là hợp lệ khi bằng chứng thiếu. Nếu có lỗi, lưu case tái lập và checkpoint đúng scope; không xóa video/audio thành công. Lượt lập tài liệu này chỉ xác nhận baseline code/test, chưa chấm người thật hoặc sinh audio mới.

## 10. Traceability yêu cầu → task → gate

| Spec requirement | Tasks | Tests/gate |
|---|---|---|
| R01 Source ledger | T03/T04/T08 | GRP01–05, STATE03 |
| R02 Không mất lời | T06/T07 | SEM01–08, TIME05, G-HARD |
| R03 Policy vật lý | T04/T07/T09 | TIME01–05, G-HARD |
| R04 Gap/retime | T03/T04/T07 | TIME01–04, TTS03 |
| R05 TTS bất biến | T07/T09/T13 | TTS01, G-HARD, trace zero Gemini voice |
| R06 Accounting/cancel/progress | T02/T07/T08 | CTX10–11, GRP05, TTS04, STATE04 |
| R07 An toàn toàn hệ thống | T08/T10 | PRIV01, REL01, full runtime/release gates |
| R08 Mode/locale | T04/T05 | MODE01 |
| R09 Untrusted input | T05/T06/T08/T13 | SEM08, PRIV01, source upload consent |
| R10 Gateway 1M | T01/T02/T09 | CTX01–11 + live context qualification |
| R11 Identity | T01/T03/T04/T08/T11 | STATE01–05, PRED03 |
| R12 Transaction | T07/T08 | STATE01/04, TTS04 |
| R13 Resume | T08/T10 | STATE01–05, REL01 |
| R14 Log/evidence | T02/T08/T09 | CTX09/11, PRIV01, report schema |
| R15 UI/compatibility | T08/T10 | CTX11, STATE05, REL01, Windows smoke |

T00 khóa corpus/protocol cho tất cả gates; T11/T12 dùng G-PREDICTOR và arm D/E; T13 dùng CACHE01/consent/source-evidence benchmark riêng. Không có task bắt buộc nào thêm Gemini TTS.
