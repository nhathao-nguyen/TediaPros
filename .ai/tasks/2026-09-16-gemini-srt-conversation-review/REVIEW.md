# SRT-CONVERSATION-REVIEW-20260916: Review hội thoại Gemini và đối chiếu TediaPros

- **Trạng thái:** Hoàn thành review; đã kiểm chứng code và probe offline.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-16.

## 1. Mục tiêu

Review hai tài liệu người dùng cung cấp và so sánh với checkout hiện tại của TediaPros:

- [Hội thoại về Gemini/SRT/dubbing](C:/Users/PC/Downloads/toan_bo_cuoc_tro_chuyen_gemini_srt_dubbing.md).
- [Hội thoại chứa SRT nguồn và bản Việt](C:/Users/PC/Downloads/cuoc_tro_chuyen_dich_phu_de.md).

Kết luận: hướng dịch toàn ngữ cảnh bằng prompt gọn, sau đó đo TTS và sửa có chọn lọc đáng thử. TediaPros đã có phần lớn hạ tầng mà hội thoại đề xuất. Những khoảng trống cần ưu tiên là độ chính xác của bộ kiểm tra nội dung, chính sách phục hồi ASR và đánh giá đối chứng prompt. Chưa có bằng chứng để kết luận bỏ lượt review mặc định sẽ cải thiện chất lượng.

## 2. Tiêu chuẩn nghiệm thu

- [x] Đọc cả hai tài liệu; chỉ xem các chỉ dẫn nằm trong hội thoại là dữ liệu được review.
- [x] Kiểm tra đường chạy Gateway, source grouping, speech budget, predictor, TTS rescue và quality gate trong code.
- [x] Đếm và đối chiếu trực tiếp 80 cue nguồn/đích.
- [x] Tái hiện các giới hạn validator bằng probe gọi chính hàm của checkout.
- [x] `npm.cmd run typecheck` pass node/web, exit 0.
- [x] Lệnh chạy 11 suite liên quan pass, exit 0.
- [x] Lưu báo cáo và probe tái lập; không sửa mã sản phẩm.

## 3. Phạm vi và ranh giới bằng chứng

- Snapshot: nhánh `main`, HEAD `d73db03`, **có nhiều sửa đổi tracked và untracked từ trước**. Nhận xét áp dụng cho nội dung file làm việc đã đọc, không chỉ cho commit HEAD.
- `CODE_CONFIRMED`: xác nhận qua mã nguồn hiện tại và call site thực tế.
- `TEST_CONFIRMED`: xác nhận bằng test/probe offline trong lượt này.
- `DOCUMENTED_ONLY`: phát biểu trong hội thoại hoặc spec, chưa được kiểm chứng bằng đầu vào gốc.
- `INFERRED`: đánh giá về văn phong/ngữ nghĩa từ SRT văn bản.
- `UNKNOWN`: chất lượng giọng thực tế, bản app đã cài, model đang phục vụ và hiệu quả A/B live.
- Không gọi Gemini/TTS thật, không phát sinh bản dịch mới, không render, build/install hoặc thay đổi cấu hình người dùng.
- File audit 76 cue và video mũ giấy được nhắc trong hội thoại không nằm trong hai đầu vào cung cấp của lượt này. Các phát biểu “đã xem video”, “sửa 11/76 cue”, “Gemini 3.1 Pro” là lời kể trong tài liệu; không được nâng thành quan sát của review này. SRT máy đo cồn có **80 cue và là một ví dụ khác**.

## 4. Kết quả review và đối chiếu

### 4.1. Những điểm trong hội thoại nên giữ

1. Dịch có ngữ cảnh toàn bài giúp xử lý các mảnh ASR; bản mẫu cho thấy nhiều lựa chọn hợp lý như `鞋带…方便` thành “mang theo rất tiện”, `吹出树枝` thành “thổi có lên cồn không”, `赶了` thành “Cạn ly”. Đây là đánh giá hợp lý theo ngữ cảnh, chưa phải đối chiếu audio gốc.
2. Timestamp của SRT không cho biết chính xác voice sẽ đọc mất bao lâu. Đo WAV sau tổng hợp/trim là cơ sở quyết định fit.
3. Nhiều cue có thể tạo thành một đơn vị lời nói. Cần giữ quan hệ với nguồn, khoảng nghỉ và ranh giới người nói khi gom.
4. Profile theo voice/backend/model hữu ích hơn một hằng số âm tiết/giây dùng chung cho mọi voice.
5. Nén cách diễn đạt cần giữ sự kiện, số, đơn vị, phủ định và quan hệ; câu ngắn hơn chưa chắc đủ nghĩa.

### 4.2. Những kết luận cần sửa hoặc giới hạn

**Một ví dụ đẹp chưa chứng minh prompt ngắn thắng pipeline hiện tại.** Hai video khác nhau, thiếu đối chứng cùng source/model/voice và không có WAV mẫu. Không nên suy ra chất lượng hay số lỗi trung bình từ riêng ví dụ 80 cue. Diễn giải về “reasoning ngầm” của model là giả thuyết, không phải quan sát nội bộ.

**11/76 cue thay đổi không phải thước đo chất lượng reviewer.** Reviewer được yêu cầu giữ câu đã tốt. Cần đo lỗi sửa đúng, lỗi bỏ sót và lỗi mới tạo ra. Nhận draft làm reviewer có nguy cơ bị ảnh hưởng bởi draft, nhưng không tự nó chứng minh review vô ích. “Fresh request” và “đánh giá không nhìn candidate” là hai khái niệm khác nhau.

**Budget 6,38 / 7,018 / 11,484 giây phù hợp với policy hiện tại.** `7.018 = 6.38 × 1.10`; `11.484 = 6.38 × 1.80`. Hard maximum mô tả thời lượng audio ở tốc độ tự nhiên có thể ép vào khe ở trần tempo; không phải cho phép phát 11,484 giây lên hình dài 6,38 giây. Trần kỹ thuật không đồng nghĩa chất lượng nghe tốt; muốn giảm tempo thường dùng phải benchmark riêng. [speechBudget.ts:22](F:/Son/tool/TediaPros/src/main/translation/speechBudget.ts:22).

**Schema chưa khóa ID là nhận xét đúng về request, nhưng thiếu phần validator sau response.** Request hiện dùng `additionalProperties: { type: 'string' }` trong `translations`, không có danh sách required IDs. Tuy nhiên parser vẫn kiểm tra expected IDs, duplicate, unknown, missing và empty. Dynamic schema sẽ cải thiện phản hồi sớm; nó không thay được parser hoặc kiểm chứng ngữ nghĩa. [geminiGateway.ts:42](F:/Son/tool/TediaPros/src/main/geminiGateway.ts:42), [response.ts:73](F:/Son/tool/TediaPros/src/main/translation/response.ts:73).

**ASR sai không có nghĩa nên thay ledger gốc.** Giữ raw text, ID, timestamps bất biến là tốt cho truy vết. Phần cần phân biệt là raw transcription, restored interpretation và evidence cho việc sửa. Nếu có phục hồi, nên lưu correction có provenance; sửa được câu nguồn không đồng nghĩa được thay ID/timing nguồn.

**Không thể suy ra Gemini đã dùng hình/video trong đường dịch hiện tại.** Gateway đang nhận text ledger, glossary, synopsis, timing và candidate. OCR/Whisper có thể đóng góp text nguồn ở bước trước, nhưng prompt nhắc “visual text” không tạo ra kênh ảnh/video. Bằng chứng video được xem sau đó cũng không chứng minh model có video trong request dịch trước đó. [geminiGatewayPrompts.ts:73](F:/Son/tool/TediaPros/src/main/geminiGatewayPrompts.ts:73), [autoShortItemCoordinator.ts:1154](F:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts:1154).

**Predictor chưa đủ cơ sở để tự động rewrite trước lần TTS đầu.** Code trả `confidence: 0`, `calibration: 'uncalibrated'`; `residualP90` là sai số fit trong mẫu. Gợi ý “predicted vượt khe → gọi Gemini compress ngay” sẽ đổi policy measured-first hiện tại và có thể sửa không cần thiết. Có thể đưa ước lượng có uncertainty vào prompt như gợi ý sau khi kiểm chứng theo voice; WAV vẫn quyết định cuối. [durationPredictor.ts:270](F:/Son/tool/TediaPros/src/main/dubbing/durationPredictor.ts:270), [synthesis.ts:508](F:/Son/tool/TediaPros/src/main/dubbing/synthesis.ts:508).

**Các ngưỡng 1,05 / 1,10 / 1,30 và safeTempo 0,94–1,08 trong tài liệu là đề xuất.** Chúng chưa được benchmark cho voice của người dùng và khác policy hiện hành. Tương tự, “đo chính xác 100%” là phát biểu quá mức: Local TTS đọc header thời lượng và mặc định 0 khi thiếu; AutoShort còn có bước trim/probe riêng. Thời lượng file không chứng minh lời đọc đúng/đủ hoặc khớp môi. [tts.ts:393](F:/Son/tool/TediaPros/src/main/tts.ts:393).

### 4.3. Bảng so sánh hệ thống đang có

| Nội dung | Checkout hiện tại | Đánh giá |
|---|---|---|
| Ngữ cảnh toàn SRT | Gateway `wholeDocument: true`, giữ full source ledger; output có thể chia batch | Đã có; không nên đánh đồng với dịch độc lập từng dòng |
| Một lượt dịch mặc định | Gateway chạy `restore-translate` rồi `independent-review` | Chưa có chế độ một lượt + review theo rủi ro làm mặc định |
| Speech units | Chốt từ source trước dịch, cùng thuật toán cho budget/TTS | Đã tích hợp; heuristic tối đa 6 cue/15 giây/300 ký tự cho nhóm nhiều cue |
| Dịch nguyên speech unit | Prompt có unit budget nhưng output vẫn theo từng cue ID | Mới có một phần; chưa phải contract trả một đoạn dịch cho mỗi unit |
| Học tốc độ voice | Profile tách theo endpoint/model/revision/voice/language/options/reference | Đã có trong TTS |
| Đưa profile voice vào lần dịch đầu | Prompt có source timing, target natural, hard max; không có estimate theo profile voice | Chưa nối vào prompt draft/review |
| Fit loop theo audio thật | Synthesize 1.0x, trim/đo, chỉ rephrase overflow, đo candidate lại | Đã có; rescue batch tối đa 8 cue |
| Semantic QA | Structural gate, heuristic số/đơn vị/phủ định, guard same-language và source-repair numeric | Có nhưng phạm vi hạn chế; không phải verifier đủ nghĩa tổng quát |
| Review theo rủi ro | Gateway vẫn review cả batch; auto-repair warnings bổ sung bị tắt cho Gateway | Chưa vận hành như kiến trúc “simple first” của tài liệu |
| Ảnh/audio làm evidence cho Gemini | Text được trích upstream; không gửi media trực tiếp trong adapter này | Cần thiết kế thêm nếu muốn multimodal verification |
| Badge âm tiết/giây | Voice UI có duration/generation time/voice; có đếm ký tự input | Chưa có badge riêng; không nên ưu tiên hơn lỗi validator |
| Giới hạn vật lý | Tempo tối đa 1,80x; kéo dài cục bộ tối đa 60%, phần làm chậm tối đa 20% rồi replay | Đã kiểm tra code; con số 40% trong lịch sử đã được thay thế |

Nguồn đối chiếu chính: [adapter hai lượt](F:/Son/tool/TediaPros/src/main/geminiGateway.ts:629), [prompt budget](F:/Son/tool/TediaPros/src/main/geminiGatewayPrompts.ts:88), [source grouping](F:/Son/tool/TediaPros/src/main/sourceSpeechGrouping.ts:18), [TTS dùng source partition](F:/Son/tool/TediaPros/src/main/autoshort.ts:2672), [profile](F:/Son/tool/TediaPros/src/main/autoshort.ts:2691), [rephrase payload](F:/Son/tool/TediaPros/src/main/translation/prompts.ts:242), [quality repair condition](F:/Son/tool/TediaPros/src/main/translation/orchestrator.ts:484), [extension](F:/Son/tool/TediaPros/src/main/dubbing/timeMap.ts:2).

`normalizeSemanticEvidence` và `decideQuality` có file/helper/test, nhưng tìm references trong `src/main` chỉ thấy định nghĩa của hai helper này. Không được xem chúng là một verifier ngữ nghĩa tổng quát đã được nối vào scheduler. Ngược lại, `nextFeedbackAction` thực sự được gọi trong synthesis để tránh thử lại candidate đã dispatch.

### 4.4. Kết quả trên đúng bản mẫu 80 cue

`TEST_CONFIRMED`: 80 cue nguồn, 80 cue đích; 80 ID duy nhất mỗi bên; **80/80 ID và chuỗi timestamp trùng khớp**, không có target rỗng. SRT kết thúc ở 191,15 giây. Khi đưa nguồn vào planner hiện tại với video duration giả định bằng SRT end + 0,12 giây, nó tạo **25 speech units**. Đây là probe grouping, không phải chứng nhận thời lượng video thật.

`INFERRED`: bản dịch nhìn chung dễ hiểu và có nhiều phục hồi ASR hợp lý, nhưng còn điểm cần xem lại:

| Cue | Quan sát | Ý nghĩa |
|---|---|---|
| 11–12 | “mức phạt nặng” / “có nồng độ cồn” | Có sự diễn giải hai nhãn nguồn nhiễu; chưa đủ evidence để xác nhận thuật ngữ chính xác |
| 19 | “Quảng cáo có bịp không, để mình dẫm hố thay anh em.” | 12 đơn vị cách trắng trong 1,40 giây; “dẫm hố” còn calque; chưa thể khẳng định fit trước TTS |
| 20 | `真的好用` → “Có thật sự tốt không?” | Chuyển dạng phát biểu thành câu hỏi dựa vào context; có thể hợp ngữ điệu, cần audio để xác nhận |
| 39 | `鞋带…方便` → “mang theo rất tiện” | Sửa lỗi ASR hợp lý theo ngữ cảnh vật nhỏ gọn |
| 54 | `赶了` → “Cạn ly!” | Phục hồi hợp lý theo diễn biến uống thử |
| 63 | `56毫克` → “56 mg” | Giữ dữ kiện đang có; không được tự thêm mẫu số hoặc suy luận ngưỡng |
| 68 | `不甜的` → “Đúng là đồ vô dụng!” | Nguồn lỗi/mơ hồ; bản dịch chọn sắc thái cụ thể, chưa đủ cơ sở xác nhận |

Cue 19–24 được planner gom cùng một unit. Vì vậy 12 đơn vị chữ trong 1,40 giây là chỉ báo áp lực nếu đọc riêng cue, không phải bằng chứng hệ thống chắc chắn overflow. Cũng không được gọi số token cách trắng là số âm tiết phát âm chính xác.

### 4.5. Findings từ probe code

**P1 — Quality gate chưa thể làm bộ lọc duy nhất để quyết định bỏ reviewer.** `validateAutoShortContentQuality` trả `ok: true` và không có findings cho:

- `它能承受10斤。` → `Nó chịu được 10 cân.`
- `加入2勺盐。` → `Thêm 2 thìa đường.` — đổi muối thành đường.
- `价格39.6。` → `Giá 39,6 tệ.` — thêm đơn vị tiền vào một con số nguồn không có đơn vị.

Đây là kết quả của **bộ kiểm tra deterministic ban đầu**, không phải kết quả gọi Gemini review hoặc chứng minh toàn pipeline chắc chắn chấp nhận ba câu ấy. Nó cho thấy “checker không flag” chưa đồng nghĩa low risk.

Theo cách dùng thị cân Trung Quốc đại lục, 1 斤 bằng 500 g, nên trường hợp đã xác định hệ đơn vị này cần giữ giá trị 10 斤 = 5 kg. [Nguồn chính quyền Tie Li ghi 500克为一斤](https://www.tls.gov.cn/newtlsrmzf/c104502/202608/7dcf17d8a17a49febb4f6235fb18e896.shtml). Quy đổi cần biết hệ đơn vị/nguồn, không thay chuỗi toàn cục chỉ vì ngôn ngữ là tiếng Trung.

**P1 — Nhánh `repair-source` loại nhầm câu giữ nguyên số.** Probe tái hiện:

| Source | Candidate | Numeric guard |
|---|---|---|
| `加入2勺盐。` | `Thêm 2 thìa muối.` | Reject |
| `加入2勺盐。` | `Thêm hai thìa muối.` | Accept |
| `加入 2 勺盐。` | `Thêm 2 thìa muối.` | Accept |

Nguyên nhân nằm ở [autoShortContentQuality.ts:156](F:/Son/tool/TediaPros/src/main/autoShortContentQuality.ts:156): hàm ghép số từ `protectedTokens` với mọi token được `canonicalQuantity` nhận, trong đó chữ số cũng được nhận lần hai. `wordTokens` giữ chuỗi chữ/số CJK liền nhau thành một token, còn tiếng Việt tách `2` thành token độc lập. Vì vậy chỉ khác spacing/cách viết đã thay multiset. Nhánh recovery lần hai gọi gate này và bỏ candidate trước TTS tại [synthesis.ts:823](F:/Son/tool/TediaPros/src/main/dubbing/synthesis.ts:823). Tác động là bỏ candidate đúng, tăng khả năng hết đường cứu overflow; không phải lỗi của mọi lần dịch ban đầu.

**P2 — Warning số/đơn vị còn nhiễu, cần giảm trước khi dùng làm risk score.** Bản mẫu có 26 warning trong checker, vẫn `ok: true`. Một số được giải thích trực tiếp bằng code:

- `头一天` / `第二天` bị bóc số 1/2 mặc dù target dùng “hôm trước/hôm sau”.
- `2-3` bị tách thành `2` và `-3`; dấu en dash trong target lại thành `2` và `3`.
- `3 giây` bị nhận đơn vị `g` vì nhánh regex `g` đứng trước `giây` và thiếu ranh giới; `3 món` bị nhận `m`.
- `56毫克 → 56 mg` bị cảnh báo do thiếu canonical unit tương ứng ở phía CJK.

Không coi cả 26 warning là 26 lỗi dịch. [protectedTokens:47](F:/Son/tool/TediaPros/src/main/autoShortContentQuality.ts:47). Nhận xét `2 thìa muối → 2 thìa đường` ở trên vẫn có giá trị ngay cả khi giảm được false positive: đối tượng và quan hệ cần lớp kiểm tra riêng.

**P2 — Prompt còn áp lực giữa ranh giới câu và cue.** Draft yêu cầu hoàn chỉnh clause ở cue edges và nói cue chỉ là fragment; review lại cấm chuyển nghĩa sang cue khác. Điều này có thể cản đảo trật tự tự nhiên bên trong một câu nhiều cue. Không phải mọi input đều mâu thuẫn, và cấm chuyển nghĩa liên cue đang bảo vệ sync. Nếu chuyển sang unit translation cần cho phép điều phối trong đúng member set đã khóa, rồi tái chia caption bằng code/alignment; không chia một đoạn dịch toàn bài theo số chữ hoặc vị trí.

## 5. Tệp tạo mới

- `REVIEW.md`: báo cáo này, theo cấu trúc task handoff.
- `probe.ts`: probe offline đọc tài liệu và gọi validator/planner hiện tại.
- `probe-results.json`: kết quả đầy đủ, bao gồm SHA-256 của tài liệu mẫu.

Không thay đổi source, tests hiện hữu, cấu hình, tài liệu sản phẩm hay các file đang sửa dở.

## 6. Kiểm chứng và bằng chứng

Các lệnh đã chạy từ root repository:

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs gemini-gateway-prompts.test gemini-gateway-contract.test speech-unit-planner.test speech-budget.test dubbing-duration-profile.test dubbing-plan.test translation-response.test autoshort-content-quality.test translation-rephrase.test translation-semantic-evidence.test dubbing-feedback-decision.test
node -e "const {buildSync}=require('esbuild'); const Module=require('module'); const p=require('path').resolve('.ai/tasks/2026-09-16-gemini-srt-conversation-review/probe.ts'); const r=buildSync({entryPoints:[p],bundle:true,platform:'node',format:'cjs',write:false}); const m=new Module(p); m.filename=p; m.paths=Module._nodeModulePaths(process.cwd()); m._compile(r.outputFiles[0].text,p);"
```

- Typecheck node/web: PASS, exit 0.
- Lệnh 11 suite: PASS, exit 0. Các Gateway/audio test dùng mock; không phải live qualification.
- Probe sample/cardinality/timing/grouping và validator: chạy thành công; lỗi logic và blind spots được ghi trong mục 4.5.
- Test suite đang pass không bao phủ mọi positive paraphrase; probe mới chứng minh numeric guard vẫn false-reject.
- Chưa xác nhận artifact cài đặt có các sửa đổi working tree, chưa so sánh A/B cùng nguồn, chưa nghe voice hoặc đối chiếu video mũ giấy.

## 7. Thứ tự cải tiến đề xuất

1. **Sửa quantity/numeric gate trước:** không đếm số hai lần; canonical hóa range, đơn vị và giá trị; giữ nguyên evidence vị trí và đối tượng; thêm cả positive và negative regression cho các ca mục 4.5. Kiểm tra riêng false positives lẫn false negatives.
2. **Làm rõ restoration contract:** raw ledger luôn nguyên vẹn; cho phép sửa ASR rõ ràng có evidence và lưu correction khi thay đổi thông tin quan trọng. Evidence thiếu thì đánh dấu uncertainty; không ép một phỏng đoán thành sự thật.
3. **Thử prompt gọn trong cùng hạ tầng:** giữ full context, keyed JSON, exact ID mapping, completion gate, checksum/checkpoint và measured-first TTS. So sánh tối thiểu ba nhánh trên cùng tập nguồn: hiện tại hai lượt; prompt gọn hai lượt; prompt gọn một lượt với review theo rủi ro. Dùng cùng observed model và voice/options khi có thể; ghi rõ sai khác route thực tế.
4. **Chấm kết quả bằng lỗi nghĩa và audio:** lỗi thêm/mất/đảo ý, số/đơn vị/phủ định, naturalness; fit@1.10/1.25/1.80, rephrase attempts, extension/replay, latency và số request. Tỷ lệ cue thay đổi hoặc render thành công không phải semantic score. Có thể mở rộng protocol hiện có ở `docs/benchmarks/2026-09-15-vietnamese-duration-aware-translation-evaluation.md`; protocol hiện vẫn là đề xuất.
5. **Kết nối voice hints có điều kiện:** chỉ dùng profile có identity đúng và đánh giá held-out; số đo thực tế sau TTS tiếp tục là quyết định cuối. Không mặc định thêm pre-TTS rewrite với predictor chưa calibration.
6. **Nếu còn vấn đề câu vụn:** thiết kế output theo speech-unit ID, mapping memberCueIds bất biến và caption alignment. Cân nhắc evidence OCR/audio chọn lọc cho ca ASR mơ hồ sau khi đo lợi ích của thay đổi nhỏ hơn.

Không đề xuất thay toàn bộ pipeline ngay. Phương án thử đầu tiên là prompt gọn trong bộ khung hiện hữu, sau khi sửa các lỗi checker có thể tái hiện; chỉ giảm lượt review mặc định khi đánh giá đối chứng cho thấy chất lượng đủ tốt.
