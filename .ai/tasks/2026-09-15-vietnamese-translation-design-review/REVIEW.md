# Review session: dịch ngắn, tự nhiên, đủ ý cho người Việt

- Ngày: 2026-09-15.
- Phạm vi: toàn bộ trao đổi trong task này về cập nhật WinLocal, nguyên nhân câu dịch dài, cách tính budget và cách ép độ dài; đối chiếu source hiện tại cùng artifact dịch đã lưu.
- Checkout: main, HEAD d73db0378aabbca81969e0098cebac7ed70d2dfc, có thay đổi local. Hash của các module được probe nằm trong [probe-results.json](probe-results.json).
- Kết quả: review và thiết kế đề xuất. Không triển khai thay đổi thuật toán/prompt production trong task này.

## 1. Kết luận

Hướng phù hợp nhất là tối ưu bản dịch theo nhóm thoại, dùng budget thời lượng theo giọng đọc, rồi chọn cách diễn đạt tự nhiên nhất trong các phương án giữ đủ ý và có khả năng vừa thời gian. Chỉ ép số từ từng dòng sẽ tạo áp lực sai lên câu ngắn, không chặn được lỗi mất nghĩa và chưa phản ánh cách TTS đọc tiếng Việt.

TediaPros đã có hai lượt dịch/review, quy hoạch động chia nhóm, predictor hồi quy, cache và vòng đo TTS/rephrase. Có thể nâng cấp các thành phần này theo từng bước; chưa cần thêm microservice, vector database hay nhiều lượt agent cho mọi video.

## 2. Những kết luận trong session cần điều chỉnh

| Trao đổi trước | Kết luận sau kiểm tra |
|---|---|
| Gateway thiếu duration budget | Đúng trong source hiện tại; cả draft và review đều thiếu. Chưa đủ để xác định nguyên nhân của mọi cue dài ở một job mới. |
| Budget provider chuẩn đã tính đúng | Hàm cửa sổ là hợp lệ cho cue được đưa vào, nhưng budget ban đầu tính theo từng mảnh; TTS sau đó ghép thành nhóm khác. Vì vậy đơn vị tính chưa thống nhất. |
| Tiếng Việt 4,6 từ/giây là giới hạn để ép | Đây là hằng số heuristic của code, không phải số đo giọng đọc hay chuẩn ngôn ngữ. Intl.Segmenter trong probe đếm “học sinh” thành 2 đơn vị. Không được gọi mọi đơn vị này là từ hoặc âm tiết phát âm chính xác. |
| Vượt max_words thì chặn publish và bắt dịch lại | Nên là tín hiệu ưu tiên kiểm tra/chỉnh văn phong. Hard gate bằng heuristic có thể loại câu đúng, làm rút gọn quá mức và tăng request vô ích. |
| Câu dài nhưng được kéo dài hình sẽ không rephrase | Cần phân biệt: fit được trong cửa sổ ở tối đa 1,80x thì không vào overflow rephrase; nếu vượt cửa sổ thật, code chạy rephrase trước khi lập time map kéo dài hình. |
| Validator giữ được ý | Validator hiện kiểm tra một số dấu hiệu; không chứng minh quan hệ chủ thể–hành động–đối tượng. Hai negative controls tiếng Việt bên dưới vẫn pass. |
| Build/test/cài đặt đạt nghĩa là dịch tốt | Các gate đó chứng minh phần mềm và artifact; không đo độ tự nhiên, đủ ý hoặc thời lượng TTS của video mới. |

“Budget độ dài lời nói”, “budget output token API” và “budget số request/thời gian recovery” là ba cơ chế khác nhau. Không dùng max_tokens để ép lời nói ngắn. Quota dịch tổng hiện có override tắt; thiết kế này không tự bật lại quota đó.

## 3. Finding và bằng chứng

### F1 — Thiếu ngân sách ở Gateway: CODE_CONFIRMED + OFFLINE_PROBE

[geminiGatewayPrompts.ts](../../../src/main/geminiGatewayPrompts.ts:18) chỉ đưa id, group_id và text vào SOURCE_PAYLOAD. Probe gọi trực tiếp hai prompt builder xác nhận thiếu speaking_duration_seconds, target_natural_seconds, hard_max_natural_seconds và suggested_max_words. Builder chuẩn có đủ bốn trường. Prompt Gateway có chỉ dẫn nói tự nhiên/concise, nhưng không có mục tiêu thời gian định lượng.

Đây là thiếu sót cần xử lý, nhưng không nên sao chép nguyên budget từng cue sang Gateway trước khi xử lý F2.

### F2 — Budget cue khác budget nhóm thoại: OFFLINE_PROBE

[autoshort.ts](../../../src/main/autoshort.ts:1327) tính speakingDuration trên toàn danh sách cue trước dịch. Sau đó [plan.ts](../../../src/main/dubbing/plan.ts:214) ghép các cue rồi tính lại cửa sổ cho cả nhóm. Riêng Gateway bật reviewedTargetBoundaries ở [autoshort.ts](../../../src/main/autoshort.ts:2662), nên dấu câu bản dịch đã review có thể quyết định nhóm TTS.

Probe tổng hợp sáu mảnh liên tiếp, mỗi mảnh 1 giây, thuộc một câu, có câu kế tiếp tại giây 6:

- Budget riêng: 6 × (1 − 0,5) = 3 giây.
- Budget nhóm TTS: 6 − 0,5 = 5,5 giây.
- Chênh 2,5 giây do giữ gap nhiều lần giữa các mảnh của cùng một câu.

Đây là ví dụ tái hiện sự khác biệt đơn vị, không phải số đo một video người dùng. Ép cứng theo tổng budget riêng có thể buộc bỏ gần một nửa khả năng phát lời thực tế của nhóm.

### F3 — Semantic guard bỏ lọt đổi đối tượng và thứ tự: OFFLINE_PROBE

Gọi trực tiếp [validateRephraseSemanticPreservation](../../../src/main/autoShortContentQuality.ts:134):

| Câu ban đầu | Candidate sai nghĩa | Kết quả hiện tại |
|---|---|---|
| Cho 2 thìa muối vào nước. | Cho 2 thìa đường vào nước. | ok=true |
| Rút phích cắm trước khi vệ sinh máy. | Vệ sinh máy trước khi rút phích cắm. | ok=true |

Code bảo vệ số/phủ định, một số tên và sự hiện diện của từ quan hệ. Nó không kiểm tra đầy đủ đối tượng và hướng của quan hệ. Object anchor có mẫu tiếng Anh “the …”; tham số locale của guard chưa được sử dụng. Không nên lấy guard này làm bằng chứng rằng mọi candidate ngắn đều an toàn về nghĩa.

Ở lượt recovery thứ hai, synthesis còn có thể đưa sourceText khác ngôn ngữ vào guard vốn mô tả là same-language. Đây là ranh giới thiết kế cần tách riêng khi triển khai semantic verifier; review này chưa tái hiện một lỗi production do nhánh đó.

### F4 — Predictor đã có nhưng chưa được hiệu chuẩn: CODE_CONFIRMED

[durationPredictor.ts](../../../src/main/dubbing/durationPredictor.ts:119) đã dùng ridge regression với intercept, graphemes, words, numerals, abbreviations và pauses. Key phân biệt giọng/model/reference và phiên bản feature. Phần estimate chủ động trả confidence=0, calibration=uncalibrated; residualP90 là sai số trên mẫu đã dùng fit, không phải khoảng dự báo đã kiểm chứng.

Probe cho “1.250 kg” và cách đọc “một nghìn hai trăm năm mươi ki lô gam” có số đơn vị rất khác nhau. Cách đọc chỉ là một minh họa; dấu phân cách và phát âm thực tế còn tùy nguồn, locale và backend. Vì vậy không được quy đổi số/ký hiệu mơ hồ rồi mặc định đó là lời TTS chắc chắn sẽ phát.

### F5 — Chính sách hiện ưu tiên vượt qua trần vật lý: CODE_CONFIRMED

[synthesis.ts](../../../src/main/dubbing/synthesis.ts:171) phân loại fit theo hard ceiling 1,80x. Candidate cần 1,50x vẫn có thể được giữ mà không có lượt rút gọn vì văn phong. Khi overflow, pipeline đo TTS trước, rephrase theo batch, thử tối đa ba candidate rồi mới xét kéo dài hình. Trần extension hiện tại trong timeMap.ts là 60% mỗi đoạn, không còn 40% như các ghi chú lịch sử.

Giữ measured-first cho recovery. Để tăng chất lượng, đưa mục tiêu văn phong/nhịp dễ nghe vào hai lượt dịch sẵn có; không đổi predictor chưa hiệu chuẩn thành bộ tự động rewrite trước mọi lần TTS.

### F6 — Bằng chứng hiện có chưa phải benchmark tiếng Việt: ARTIFACT_REVIEW

Hai artifact v8 được đọc lại: Volvo 44 cue và nguồn thực tế 113 cue. Theo logic nhóm hiện tại, chúng cho 13 và 78 nhóm thoại. Volvo dùng timestamp fixture đều 1,5 giây, không dùng để kết luận tốc độ nói thật. Review này không gọi provider hay TTS.

Ví dụ đã lưu ở nguồn 113 cue:

- Nguồn: 转动三个旋钮就可以切换不同的形状和厚度
- Bản dịch: “Chỉ cần xoay ba núm vặn là có thể chuyển đổi các hình dạng và độ dày khác nhau.”
- Đề xuất biên tập minh họa: “Chỉ cần xoay ba núm để đổi hình dạng và độ dày.”

Đề xuất giữ thao tác xoay, số ba, đối tượng núm và hai thuộc tính điều chỉnh. Đây là ví dụ rút gọn có đối chiếu nguồn; chưa được đọc TTS hoặc chấm mù bởi người Việt. Không áp dụng bằng chuỗi replace chung lên mọi video.

## 4. Thiết kế đề xuất

### 4.1. Một kế hoạch nhóm thoại dùng chung

Tạo SpeechUnitPlan dùng chung cho budget dịch, review, TTS và audit. Source ledger giữ nguyên cue ID, thứ tự, text và timestamps. Mỗi speech unit ghi memberCueIds, source interval, deadline, effectiveGap, windowSeconds, lý do chọn boundary và planVersion.

Tận dụng quy hoạch động có sẵn trong sourceSpeechGrouping.ts. Hiện thuật toán đã cân bằng nhóm với chi phí theo mật độ ký tự, khoảng ngắn, giới hạn 6 cue/15 giây/300 ký tự; không cần viết lại thuật toán từ đầu. Bổ sung điểm ngắt mệnh đề, liên kết phủ định/điều kiện và mật độ thông tin. Ranh giới speaker, pause bắt buộc và cut seam vẫn do code kiểm tra.

Với Gateway đang cần phục hồi dấu câu nguồn: draft có thể đề xuất boundary ở các cue edge được phép. Code kiểm tra đề xuất, giải phân hoạch, chốt plan và tính lại budget trước review. Reviewer chỉnh văn bản theo plan này; punctuation sau review không tự đổi nhóm lúc TTS. Nếu cần đổi nhóm, đó phải là một revision có kiểm tra và tính lại budget. Không tự quay lại source-only grouping khiến những hồi quy đã sửa bị tái phát.

Đầu ra vẫn gắn từng cue ID. Ngữ cảnh cả câu giúp chọn từ và cú pháp, nhưng không cho phép mang một sự kiện thuộc nhóm sau về nhóm trước. Nếu muốn hỗ trợ đảo trật tự rộng bên trong một nhóm trong tương lai, cần contract alignment riêng; không tách toàn bài theo vị trí câu.

### 4.2. Budget thời lượng theo giọng đọc

Với nhóm g đã được chốt:

    Wg = deadline(g) − scheduledStart(g)
    Dtarget = Wg × targetTempo
    Dhard = Wg × 1,80

Khi chuẩn bị prompt ban đầu, scheduledStart dùng anchor nguồn; headroom bắt đầu sớm chỉ được thêm khi planner xác nhận khả dụng. Dùng hàm cửa sổ hiện hữu để xử lý gap ngắn/EOF, không trừ 0,50 giây thêm lần nữa. TargetTempo có thể khởi đầu bằng policy preferred 1,10; 1,80 là trần phục hồi, không phải mục tiêu văn phong. Không cộng sẵn extension 60% vào budget để model mặc sức viết dài.

Mô hình dự báo đề xuất cho vi-VN:

    Dhat = b0 + bs × spokenUnits + bp × pauses + bn × numberFeatures
           + ba × abbreviations + bf × foreignNameFeatures

SpokenUnits cần adapter chuẩn hóa theo cách backend phát âm số, đơn vị, viết tắt và tên riêng. Chưa biết cách đọc thì lưu các khả năng/độ bất định. Có thể dùng đơn vị gần âm tiết làm feature bổ sung của tiếng Việt; tuyệt đối không đổi nghĩa feature words v2 mà giữ nguyên cache/version.

Tái dùng ridge hiện có; so sánh với baseline đơn giản và hồi quy robust/quantile trên dữ liệu giọng thật. Bổ sung sai số dự báo trên tập calibration độc lập để tính cận trên Dupper. Split conformal là lựa chọn về sau khi có đủ dữ liệu phù hợp: bảo đảm coverage phụ thuộc exchangeability, không phải bảo đảm cho từng câu hay khi model/voice đổi. Khi drift, hạ về advisory và hiệu chuẩn lại. [Nguồn conformal prediction](https://arxiv.org/abs/2107.07511).

Số từ/ký tự/đơn vị nói đưa vào prompt chỉ là trợ giúp cho model. Code dùng dự báo để xếp hạng và phát hiện rủi ro; WAV thực tế quyết định có vừa hay không. Nghiên cứu Duration-based Translation dùng ngân sách dựa trên âm vị/thời lượng, nhưng kết quả trên Anh–Tây Ban Nha–Hàn không tự chứng minh hiệu quả cho tiếng Việt. [EMNLP 2025](https://aclanthology.org/2025.emnlp-demos.37/).

### 4.3. Kiểm tra ý theo cấu trúc sự kiện

Mỗi nhóm cần biểu diễn được: ai/cái gì, làm gì, với đối tượng nào, số lượng/đơn vị, phủ định, điều kiện, thứ tự, nguyên nhân, mức độ chắc chắn và sắc thái cần giữ. Ví dụ trên chứa relation BEFORE(unplug, clean), không chỉ sự xuất hiện của chữ “trước khi”.

Các mệnh đề trích xuất bằng LLM cũng là dữ liệu chưa đáng tin. Mỗi mệnh đề phải có sourceCueIds và sourceSpan làm bằng chứng; reviewer đọc nguồn gốc và kiểm tra cả những ý bị bộ trích xuất bỏ sót. Source ASR/OCR mơ hồ phải ghi uncertain, không tự suy diễn đơn vị tiền, nhãn hiệu hay vật liệu.

Phân lớp kiểm tra:

- Code: ID/count/schema/completion, dấu hiệu số–đơn vị có chuẩn hóa rõ ràng, source bounds.
- Reviewer: quan hệ hành động, thiếu/thêm ý, thuật ngữ, văn phong Việt; trả span lỗi và lý do cụ thể.
- Khi chưa chắc: giữ candidate đầy đủ hơn hoặc đánh dấu cần review. Không cho một điểm fluency cao bù một lỗi sai nghĩa đã xác định.

Có thể dùng cách gắn loại lỗi và span của MQM/GEMBA-MQM thay cho một điểm “dịch tốt” tổng quát; metric/LLM judge vẫn phải được hiệu chuẩn bằng người Việt. [GEMBA-MQM](https://aclanthology.org/2023.wmt-1.64/). Embedding cosine hoặc back-translation chỉ nên là tín hiệu phụ: hai câu đảo thứ tự hành động có thể dùng gần như cùng từ.

### 4.4. Hai lượt dịch/review và sửa có chọn lọc

Lượt 1: đọc toàn ledger có giới hạn context, dịch tự nhiên và giữ nguồn; cung cấp budget nhóm sơ bộ cùng style profile. Lượt 2: nhận source, draft, plan đã chốt, budget chính xác và các nhóm bị local checks đánh dấu; kiểm tra đủ ý trước khi rút gọn diễn đạt. Giữ nguyên câu đã đạt, tránh rewrite toàn bài chỉ để làm khác.

Với nhóm khó, tạo tối đa 2–3 candidate khác cấu trúc diễn đạt. Có thể tạo ngay trong lượt review cho nhóm bị đánh dấu, không phải cho toàn video. Chọn theo thứ tự:

1. Loại lỗi chắc chắn về cấu trúc/nghĩa.
2. Ưu tiên candidate được đánh giá đủ ý và tự nhiên.
3. Trong chất lượng tương đương, ưu tiên nhịp nói gần target và ít thao tác retime.
4. Nếu vẫn tương đương, chọn gọn hơn/ít phải tổng hợp lại hơn.

Pareto pruning có thể giảm số candidate phải TTS: loại phương án dài hơn mà không cải thiện chất lượng theo các đánh giá hiện có. Không loại một câu chỉ dựa trên predictor chưa hiệu chuẩn. Thử TTS phương án tốt nhất trước, tái dùng cache, rồi đo/trim. Overflow thật quay về rephrase với measured seconds và lỗi nghĩa cụ thể; giữ vòng phục hồi hữu hạn hiện có, hủy và no-progress. Không tự thêm quota tổng mới.

Lượt reviewer mới không đồng nghĩa độc lập thống kê khi vẫn dùng cùng model. Lưu candidate trước/sau và kiểm tra rằng sửa lỗi không tạo lỗi mới. Model khác hoặc review người dùng dành cho benchmark/ca khó sau khi có dữ liệu chứng minh lợi ích.

### 4.5. Hồ sơ văn phong dành cho Việt Nam

Định nghĩa vi-VN narrative-neutral có phiên bản và rubric:

- Trật tự câu trực tiếp, động từ cụ thể, thuật ngữ quen dùng đúng lĩnh vực.
- Rút cấu trúc vòng vo, danh từ hóa và lặp lời; giữ thông tin, quan hệ, mức độ nhấn mạnh có trong nguồn.
- Giữ chủ thể rõ khi có thể nhầm; cho phép lược thành phần lặp chỉ khi ngữ cảnh đơn nghĩa và reviewer xác nhận.
- Dùng Hán Việt khi tự nhiên/đúng chuyên môn, không cấm hàng loạt. Không tự thêm giọng địa phương, quảng cáo, hook hay CTA.
- Đồ bếp, ô-tô, khoa học, hội thoại có profile con; mức trang trọng và cách xưng hô phải nhất quán trong video.

Khởi đầu bằng 20–30 cặp nguồn → bản dịch tốt đã được duyệt, có nhãn lĩnh vực/cấu trúc câu; mỗi request chỉ chọn 2–3 ví dụ liên quan. Đây là quy mô thử nghiệm đề xuất. Một bảng tra theo tag đủ cho MVP; chưa cần vector database. Ví dụ là cách diễn đạt, không phải nguồn sự kiện để copy vào video.

Tiếng Việt cần phân biệt đơn vị cách trắng, từ ghép và phát âm. RDRSegmenter/VnCoreNLP có thể hỗ trợ phân tích từ nhưng không tự đo thời lượng giọng đọc. [RDRSegmenter, LREC 2018](https://aclanthology.org/L18-1410/).

## 5. Kiến trúc tích hợp và dữ liệu

Các module đề xuất đều ở Main/shared hiện có:

| Thành phần | Trách nhiệm |
|---|---|
| speechUnitPlan | Chốt phân hoạch, mapping cue, deadline và revision |
| speechBudget | Wg, target, hard maximum, đơn vị phát âm và uncertainty |
| viStyleProfile | Rubric, glossary, ví dụ có phiên bản |
| translationQuality | Code findings, reviewer findings, candidate evidence |
| translation orchestrator | Hai pass, selected repair, giữ accepted version |
| dubbing predictor/synthesis | Học từ WAV thật, xếp hạng, measured rescue |

Giữ wire translations keyed để reconstruction bằng code. Nếu thêm speech_units, candidates hoặc findings vào phản hồi, phải tăng schema/parser/prompt version và cập nhật gateway contract, không nhét trường lạ vào schema hiện tại.

Identity của accepted translation cần source digest, locale, glossary/style/prompt/schema versions, endpoint/model route policy và speechUnitPlan digest. Budget được materialize tại lúc tạo request; retry dùng lại snapshot này. Không để predictor vừa học thêm làm invalidate toàn bộ checkpoint đang chạy. Model/giọng đã đổi thì kiểm tra lại khả năng fit; TTS cache tiếp tục key theo final text, voice/model/reference/options.

Audit ghi source/draft/reviewed/final text, group mapping, budget estimate/measurement, candidate reason và các stage versions. Candidate chưa kiểm chứng không được ghi đè accepted checkpoint. Stage API lỗi và lỗi nội dung có owner recovery riêng để tránh retry lồng.

## 6. Thí nghiệm và thứ tự triển khai

### P0 — Chuẩn hóa hợp đồng và bộ đo

1. Thêm hai negative controls của review vào test hồi quy đúng/sai nghĩa khi xây semantic verifier.
2. Chốt SpeechUnitPlan dùng chung và regression cho source-only lẫn reviewed-boundary path.
3. Gửi group budget + vi style tới cả draft và review; giữ ngân sách là advisory khi chưa hiệu chuẩn.
4. Version identities, thu thập telemetry; giữ hành vi measured-first.

### P1 — Hiệu chuẩn tiếng Việt và lựa chọn candidate

1. Thu WAV theo từng voice/model; chuẩn hóa phát âm với provenance.
2. So sánh predictor hiện có, baseline đơn giản và robust/quantile; đánh giá held-out theo video.
3. Thêm kiểm tra mệnh đề/quan hệ và candidate ranking cho nhóm khó.
4. Phát hiện một sửa đổi làm giảm đủ ý; giữ candidate tốt trước đó.

### P2 — Chỉ làm khi số liệu cần

Tối ưu chi phí phân hoạch DP, chọn tổ hợp candidate bằng shortest path nếu quyết định nhóm lân cận tương tác mạnh; retrieval ví dụ bằng embedding khi kho lớn; fine-tune/DPO/SSPO khi có corpus tiếng Việt được duyệt và quyền vận hành model. SSPO có nghiên cứu cho duration alignment, nhưng không chuyển nguyên thành một prompt cho Gateway và không có bằng chứng vi-VN ở task này. [ACL 2025](https://aclanthology.org/2025.acl-long.227/).

### Thiết kế benchmark đề xuất

- Pilot 20–30 video, khoảng 300–500 nhóm thoại; phân tầng cue ngắn, câu nhiều ý, số/đơn vị, tên riêng, phủ định, điều kiện, hội thoại, thuật ngữ và nguồn OCR/ASR nhiễu. Đây là kích thước khởi đầu, không đủ bảo đảm tỷ lệ lỗi cực thấp.
- So sánh A: current; B: shared group budget + style; C: B + verifier/candidate selection; D: C + predictor calibrated. Cùng input/voice/option, ghi model thực tế và chia train/calibration/test theo video để tránh leakage.
- Hai người Việt chấm mù một tập held-out, phân xử bất đồng; phải nghe audio và xem video ở bước nghiệm thu, không chỉ đọc text.
- Chỉ số: omission/addition/wrong-relation trên mỗi nhóm, native fluency/style, first-pass fit ở 1,10 và 1,25, tempo P50/P95/max, extension/replay, TTS seconds gọi thực, số repair, latency/token/cost, false-reject và tỷ lệ cần sửa tay.
- Chỉ nhận thiết kế mới khi giảm lỗi thời lượng/chi phí mà đủ ý và độ tự nhiên không kém baseline. Báo paired difference và khoảng bất định; không cam kết giảm X% trước thử nghiệm.

Nghiên cứu human dubbing nhấn mạnh vai trò chất lượng dịch và độ tự nhiên, cho thấy khớp số ký tự không phải đại diện đầy đủ cho chất lượng lồng tiếng. Đây là lý do đặt quality constraints trước mục tiêu ngắn nhất. [TACL 2023](https://aclanthology.org/2023.tacl-1.25/). IsoChronoMeter là nguồn tham khảo đánh giá thời lượng dịch; benchmark của dự án vẫn cần WAV giọng thực tế. [WMT 2024](https://aclanthology.org/2024.wmt-1.29/).

## 7. Kiểm chứng trong review này

- npm.cmd run typecheck: PASS, exit 0.
- 5 suite translation-prompts, dubbing-grouping, dubbing-duration-profile, autoshort-content-quality, gemini-gateway-prompts: 74 test PASS, 0 fail, 0 skip.
- [probe.mjs](probe.mjs): exit 0; [kết quả JSON](probe-results.json) tái hiện thiếu trường Gateway, lệch cửa sổ cue/nhóm, hai semantic false negative và predictor chưa hiệu chuẩn. Assertion ở negative control xác nhận giới hạn hiện tại, không phải yêu cầu hành vi production đúng.
- Không generation provider, không TTS/render mới; không có số liệu cải thiện production. Lỗi provider, chất lượng audio và symptom của job mới chưa được xác định từ một request/response/WAV cùng job.

Ưu tiên thực hiện: kế hoạch nhóm và budget thống nhất → profile văn phong Việt + review đúng nghĩa → benchmark → predictor/candidate optimization. Hard word cap không phải lựa chọn mặc định.
