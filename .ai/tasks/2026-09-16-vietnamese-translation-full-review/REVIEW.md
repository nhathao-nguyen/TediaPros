# Review toàn bộ cải tiến dịch/lồng tiếng trong session

Ngày 2026-09-16 · Windows local · review working tree tại `F:\Son\tool\TediaPros`.

## Kết luận

**Chưa đủ điều kiện nghiệm thu trọn bộ cải tiến hoặc khẳng định bản dịch ngắn, tự nhiên và đủ ý trên video thật.** Nền tảng đã có nhiều phần hữu ích, nhưng các consumer chưa dùng chung đầy đủ hợp đồng mới. Tăng context lên 1M và tăng chất lượng prompt không tự khắc phục những lỗi nối luồng này.

Phạm vi “toàn bộ” ở đây là toàn bộ cải tiến dịch/lồng tiếng được bàn trong session: thiết kế T00–T13, phần đã triển khai T01–T07, evaluator, đường AutoShort, recovery và resume. Không phải audit mọi tính năng khác của repository. Xem `FILE_INVENTORY.md` và `COVERAGE.md` để biết độ sâu từng phần.

- **TEST_CONFIRMED:** typecheck node/web PASS; 21 suites / **210 tests PASS**, 0 fail, 0 skip trong lượt này.
- **TEST_CONFIRMED:** **8 diagnostic probes** tái hiện hành vi lỗi/khoảng hở, hoàn toàn offline. PASS của các probe này có nghĩa “đã tái hiện được lỗi”, không phải “hệ thống đã đúng”.
- **CODE_CONFIRMED:** 6 findings có đường chạy production liên quan; F02 chỉ bộc lộ khi thực sự truyền shared journal, F08 thuộc checkpoint helper chưa có production consumer.
- **UNKNOWN:** chất lượng tiếng Việt/audio thực tế, hành vi Gateway ở sát 1M, bản đang cài trên Windows. Không gọi generation/TTS thật, không render video, không package/install.

## Findings theo mức ưu tiên

### F03 — P1: Source-repair có thể xuất lời thoại sai số và đối tượng

**Điểm code:** `src/main/dubbing/synthesis.ts:759`, `:784`; đường nhận candidate `src/main/autoshort.ts:1823`; QA trước TTS tại `src/main/autoShortItemCoordinator.ts:1349`.

Khi `recoveryAttempt === 2` và có source text, candidate đi thẳng qua nhánh `source-repair-unverified`, sau đó tất cả candidate được gắn `quality: 'eligible'`. Việc gắn nhãn “unverified” chỉ đi vào log; không có semantic acceptance gate tương ứng. Parser rephrase kiểm tra cấu trúc, không xác minh số/đối tượng. QA dịch của coordinator chạy trước bước TTS đổi câu; kiểm tra sau TTS chủ yếu về timeline và caption khớp lời đã chọn.

**Probe:** nguồn `加入2勺盐，然后搅拌。` (2 thìa muối), bản đang có `Cho 2 thìa muối vào nồi rồi khuấy đều.`, candidate `Cho 20 thìa đường.`. Mock WAV candidate dài 0,6 giây được nhận vào cả final spoken text và phụ đề. Same-language guard hiện có vốn phát hiện `protected-token` và `quantified-object`, nhưng nhánh này bỏ qua nó. Đây là chứng minh thiếu gate, không phải khẳng định model thật chắc chắn sinh câu sai đó.

**Hướng sửa:** source-repair vẫn phải đối chiếu nguồn bằng validator phù hợp ngôn ngữ; các mâu thuẫn đã xác minh phải reject trước commit. Không dùng bộ so sánh Việt–Việt với nguồn Trung như một verifier đa ngôn ngữ. Candidate chưa đủ bằng chứng cần pending/review hoặc giữ bản accepted trước đó; thời lượng ngắn không được bù lỗi nghĩa. Revalidate nội dung sau khi thay final spoken text.

### F04 — P1: Prompt mất mapping nguồn khi chia nội bộ một cue dài

**Điểm code:** `src/main/geminiGatewayPrompts.ts:41`, `:112`; `src/main/translation/planner.ts:121`; `src/main/geminiGateway.ts:642`.

Planner tạo `long/part-1`, `long/part-2` và offset đúng trong code. Gateway nhận full source ledger chỉ có ID `long` với toàn text, trong khi requested IDs là các `/part-*`. Prompt không truyền text tương ứng, offset hay mapping từng part. Model phải tự đoán cách chia; parser chỉ kiểm tra ID không thể phát hiện phần bị lặp hoặc mất ý.

**Probe:** một cue dài tạo 5 internal IDs nhưng ledger chỉ có `long`. Mapping tồn tại trong `batch.mapping`, không có trong draft prompt. Review dùng cùng builder ledger nên cùng thiếu dữ liệu này.

**Hướng sửa:** giữ full ledger read-only, thêm requested-unit data do code tạo: `unit_id`, `original_id`, `startOffset`, `endOffset`, exact source slice. Draft và review dùng cùng mapping; test qua adapter thật có mock transport, kiểm tra span coverage và phục hồi source ID. Không chia lại target bằng vị trí câu.

### F01 — P2: Journal chống gọi TTS lặp không đến được đường AutoShort thực tế

**Điểm code:** `src/main/autoShortItemCoordinator.ts:1468`; `src/main/autoshort.ts:3066`, `:2840`, `:3460`.

Job tạo journal; `synthesizeVoice()` đọc `job.feedbackJournal`. Nhưng `processItem()` không truyền journal vào `AutoShortItemContext`, và coordinator tạo `jobAdapter: any` chỉ có id/controller/emit/capabilities/resourceManager. Synthesis vì vậy nhận `undefined`; `feedbackAttempts()` trả `null`.

**Probe:** đọc AST xác nhận object adapter không có field; hai lần synthesis tương đương đường không-journal đều dispatch lại cùng candidate. Chưa chạy full coordinator với media/FFmpeg; bằng chứng nối call-site là static, còn hành vi synthesis là test-confirmed. TTS cache có thể tránh request mạng ở một số trường hợp, nhưng không thay thế replay guard.

**Hướng sửa:** dùng context/adapter có kiểu rõ, truyền cùng instance xuyên job → item context → synthesizeVoice → synthesis. Thêm integration assertion tại đúng coordinator seam và retry cùng item. **Phải sửa F02 cùng lúc**, không chỉ nối field.

**Đính chính bàn giao trước:** phát biểu “đã wiring T07 theo job/item” vượt quá bằng chứng. Test trước chỉ chứng minh lời gọi trực tiếp có journal; đường AutoShort hiện chưa thỏa điều đó.

### F02 — P2, latent: Journal nhớ “đã thử” nhưng làm mất phương án đã thành công

**Điểm code:** `src/main/dubbing/synthesis.ts:787`; `tests/dubbing-plan.test.ts:12`.

Journal chỉ giữ hash và `dispatching|completed|failed`. Mọi hash đều bị đưa vào `tried`, trong khi lần gọi tiếp theo đo lại bản dài ban đầu, không restore candidate/audio đã accepted. Candidate tốt bị chặn cùng với candidate thất bại. Retry do một cue khác hoặc bước downstream lỗi có thể mất phương án vừa tìm được; recursive split cũng cần kiểm tra bảo toàn accepted state.

**Probe:** lần đầu dùng câu ngắn 0,6 giây thành công; lần hai cùng journal bỏ qua câu ngắn, dùng câu cũ 5 giây và báo cần extension 126,1%, vượt 60%. Regression hiện có còn kỳ vọng lần hai trở lại câu dài; dữ liệu 3 giây trong test cũ che việc có thể thất bại.

**Phạm vi:** latent với shared-journal consumer; F01 đang khiến đường AutoShort không sử dụng journal này. Không khẳng định đây là lỗi retry production đang xảy ra vì journal.

**Hướng sửa:** tách attempt journal khỏi accepted candidate/result store. Khôi phục text, measured WAV/provenance và trạng thái accepted trước khi quyết định dispatch mới. Trạng thái failed/uncertain không được đồng nhất với kết quả completed có thể tái sử dụng. Quyền sống của file WAV phải theo item scope/cache, không giữ đường dẫn scratch đã bị xóa.

### F06 — P2: Budget prompt và nhóm TTS vẫn là hai phân hoạch khác nhau

**Điểm code:** `src/main/translation/speechUnitPlanner.ts:59`; `src/main/geminiGateway.ts:542`; `src/main/autoshort.ts:2662`.

Prompt nhận grouping theo nguồn; sau review, Gateway TTS lại nhóm bằng dấu câu target. Không có bước freeze plan từ draft rồi buộc review và TTS dùng cùng revision như mục 4.2 của spec. Budget advisory vì thế có thể đúng với nhóm cũ nhưng không còn đúng với nhóm đọc thật.

**Probe:** 6 mảnh nguồn liên tiếp thành 1 nhóm, available budget **5,88 giây**. Khi target có 6 câu kết thúc, TTS tạo 6 nhóm và tổng available chỉ **3,38 giây**, giảm **42,5%** do gap. Đây là số liệu fixture, không phải tỷ lệ lỗi trên corpus thực tế. Gate đo WAV vẫn giữ trần tempo; rủi ro là overflow/rephrase không cần thiết và mục tiêu giọng tự nhiên không đạt.

**Hướng sửa:** provisional source plan → draft boundary proposals → constrained partition/frozen revision → budget chính xác → independent review → TTS cùng plan. Boundary conflict phải được xử lý có revision; không âm thầm đổi nhóm sau review. Đây là khoảng trống integration T03/T04 đã còn mở, không phải thuật toán DP đã hoàn thiện.

### F05 — P2: Draft bị cắt đầu ra không đi vào recovery chia nhỏ output

**Điểm code:** `src/main/geminiGateway.ts:711`; nhánh catch trong `src/main/translation/orchestrator.ts`.

Adapter nhận `finish_reason: length`, nhưng `parsedDraft.complete === false` được chuyển thành generic `provider-protocol`. Scheduler kết thúc work item thay vì nhận tín hiệu truncated để chia tập requested IDs chưa accepted. JSON thực sự bị cắt cú pháp có thể thất bại sớm hơn ở canonicalizer, cùng không đến logic split.

**Probe:** batch 4 cue, mock trả một cue và `finish_reason: length`: chỉ **1 dispatch**, không chia, kết quả `needs-review`, không có item accepted. Không xuất bản bản thiếu là đúng; thiếu ở khả năng phục hồi mà spec T02 đã yêu cầu.

**Hướng sửa:** phân biệt output truncation với protocol/auth/route failure; scheduler sở hữu strict shrinking partition trên phần chưa accepted. Giữ strict parser, không tự đóng JSON hỏng, không bật retry trùng vô hạn và không dịch lại phần accepted.

### F07 — P2: Quantified-object guard từ chối paraphrase đúng khi lặp số–đơn vị

**Điểm code:** `src/main/autoShortContentQuality.ts:155`, `:167`, `:215`.

`Map<quantity|unit, object>` ghi đè occurrence trước. Hai thành phần có cùng `2|thìa` khiến object cuối danh sách quyết định kết quả. Thứ tự thành phần trong một danh sách không tương đương với thứ tự hành động có nghĩa.

**Probe:** `Cho 2 thìa muối và 2 thìa đường.` → `Cho 2 thìa đường và 2 thìa muối.` bị reject `quantified-object`, dù giữ đủ thành phần và lượng. Đây là false rejection ở guard được gọi trực tiếp trong rephrase.

**Hướng sửa:** giữ multiset các tuple quantity–unit–object hoặc occurrence alignment thay vì một object cho mỗi key. Test positive: đảo danh sách, lặp unit, cách nói tương đương; negative: đổi lượng từng object, thay object, đảo thứ tự hành động thực sự. Chỉ hard reject khi bằng chứng đủ chắc.

### F08 — P2, latent: Checkpoint helper ghi được file mà chính reader từ chối

**Điểm code:** `src/main/translation/checkpoint.ts:249`, `:308`.

Writer không giới hạn serialized bytes; reader giữ cap 2 MiB. Long-context planner tạo plan hợp lệ lớn hơn cap: write thành công, read trả null. Không nên giải quyết bằng tăng cap vô hạn.

**Probe:** 720 cue synthetic, source JSON 2.386.206 bytes, 72 output batches; checkpoint ghi **2.953.983 bytes** rồi đọc lại `null`. Không hề gọi Gateway; các con số bytes không phải exact token count.

**Phạm vi đặc biệt quan trọng:** tìm call-site trong `src` cho thấy helper read/write này chưa được AutoShort sử dụng. AutoShort đang có checkpoint riêng trong coordinator. Vì vậy đây là lỗi round-trip của helper và rủi ro T08 trước integration, **không** phải bằng chứng AutoShort đang mất resume tại 2 MiB.

**Hướng sửa:** bounded manifest + immutable source sidecar/batch references hoặc shard checkpoint; writer/reader dùng cùng contract. Thêm round-trip tại kích thước thực tế, crash/cancel và partial resume; xác nhận consumer active trước claim production.

## Phần đã có và phần chưa đủ bằng chứng

| Hạng mục | Hiện trạng | Gate còn thiếu |
| --- | --- | --- |
| T01/T02 — Gateway 1M | Client khai báo 1.000.000 context, output riêng 16.384; actual request preflight có nhãn estimate | Counter qualified/near-limit policy, server advertisement vào adapter; F04/F05 |
| T03/T04 — nhóm/budget | Có source grouping và công thức theo window | Frozen reviewed plan dùng chung với TTS; F06 |
| T05 — văn phong Việt | Có profile concise/neutral và helper chọn ví dụ | Chưa có bộ ví dụ human-approved đang được prompt dùng; chưa A/B tiếng Việt |
| T06 — semantic | Có normalization/decision helper, hai negative controls mới | Helper chưa là acceptance consumer; span grounding và verified cross-language rules; F03/F07 |
| T07 — measured feedback | Đo WAV, finite rescue, trần tempo/extension được regression bảo vệ | F01/F02, semantic ranking, accepted-state transaction |
| T08 — resume/revision | Identity có source video duration; draft/checkpoint legacy tiếp tục tồn tại | Full plan/budget/style revision migration; F08 ở helper |
| T00/T09 — đánh giá | Có evaluator first-pass-fit và paired bootstrap theo video | Corpus, manifest thật, human ratings, quality/timing A/B, live 1M |
| T10 — Windows release | Không làm trong lượt review | Package/hash/install/smoke sau gate và yêu cầu riêng |
| T11/T12/T13 | Phần roadmap sau core | Calibration theo voice; opt-in quality repair; context cache/media consent |

Không có Gemini voice được thêm trong phần được review; vẫn dùng Local/Edge TTS. Các test giữ giới hạn 1,80x và extension 60%; không có cơ sở sửa các giới hạn này để che lỗi nghĩa/budget.

### Rủi ro 1M bổ sung, chưa gọi là incident đã đo

- `resolveGatewayCapacity()` trong adapter được gọi không có server advertisement; helper hỗ trợ advertised capacity chưa chứng minh route production sử dụng nó. 1M vẫn là floor **user-confirmed**, không phủ nhận xác nhận của người dùng.
- Counter hiện `ceil(JSON bytes / 3)`, safety 4.096. Ghi nhãn estimate là đúng, nhưng chưa có qualified error bound hoặc nhánh `count-unqualified` sát giới hạn. Không có bằng chứng estimate này an toàn cho mọi payload Việt/Trung/JSON.
- `runStage()` lưu toàn request vào `auditRecords`; `boundedAuditDocument()` chỉ cắt representation khi ghi disk sau khi stringify toàn history. Với full ledger lặp qua nhiều output batches, bộ nhớ tăng theo số stage × kích thước nguồn và số bytes serialize cộng dồn có thể bậc hai theo số stage. Đây là rủi ro **CODE_CONFIRMED về thiết kế**, chưa benchmark RAM/độ treo Electron. Nên lưu immutable source một lần, dùng hash/reference, bounded ring cho audit; raw payload phải opt-in.
- Các tài liệu baseline còn mô tả “đúng hai generation call mỗi video”, trong khi output partition có thể tạo hai call mỗi batch, cộng recovery. Cần ghi đúng success path ngắn và long-output path; không dùng trần sáu upstream attempts như bảo đảm cho mọi video dài.

## Thứ tự khắc phục đề xuất

1. **Chặn sai nghĩa:** F03 và F04; test từ adapter output đến final spoken text/caption. Giữ bản accepted; không cho duration fit hợp thức hóa semantic failure.
2. **Sửa retry như một transaction:** F01 + F02 cùng một thay đổi có integration test coordinator. Loại `any` tại adapter context; phân biệt attempts và accepted artifacts.
3. **Thống nhất nhóm/budget:** F06; một frozen plan có revision/hash đi qua review, recovery và TTS. Không cần gọi thêm LLM mặc định chỉ để đặt boundary.
4. **Hoàn thiện long-context:** F05, representation-aware token counter, audit bounded; F08 khi nối checkpoint helper. Test thiếu/truncated IDs, long cue, near-limit và resume phần accepted.
5. **Giảm false rejection:** F07 và positive paraphrase corpus. Sau đó mới nghiệm thu văn phong bằng paired A/B và native listening với chính voice/options đang dùng.

Không ưu tiên thêm model, thêm nhiều lượt AI, fine-tuning hoặc tăng tempo lúc này. Các lỗi nối luồng và thiếu acceptance gate phải được xử lý trước; vẫn giữ yêu cầu không dùng Gemini tạo giọng.

## Bằng chứng và cách chạy lại

```powershell
npm.cmd run typecheck
node .ai/tasks/2026-09-16-vietnamese-translation-full-review/run-regressions.mjs
node .ai/tasks/2026-09-16-vietnamese-translation-full-review/run-review-probes.mjs
```

`regression-results.txt` chứa stdout/stderr của 21 suites. `probe-results.txt` chứa số liệu từng finding; **diagnostic PASS là xác nhận defect hiện hữu**. Probes dùng mock fetch/audio, AST và filesystem scratch riêng; không đăng ký chúng thành acceptance tests. Khi sửa lỗi phải đảo assertion sang hành vi đúng và thêm vào regression suites sản phẩm phù hợp.

Các vòng dựng probe đầu có lỗi fixture (thiếu `groupId`, dùng field result không tồn tại, key checkpoint không phải SHA-256); đã sửa fixture trước kết quả cuối 8/8. Không tính những lỗi harness đó là findings của sản phẩm.

Lượt này chỉ thêm tài liệu, runner và evidence trong thư mục review. Không sửa production source, không xóa dữ liệu, không cài dependency, không commit/push. Toàn bộ dirty work có sẵn được giữ nguyên.
