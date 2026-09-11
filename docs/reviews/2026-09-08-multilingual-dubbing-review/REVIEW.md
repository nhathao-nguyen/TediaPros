# Review planning và implementation: AutoShort multilingual dubbing

Ngày: 2026-09-08. Kết luận: **chưa nên nghiệm thu tuyên bố “đã xử lý triệt để, không còn regression”**. Kiến trúc tách pha đã được nối vào đường chạy thật; có một regression chặn job và bốn vấn đề cần sửa về resource lease, QA và cache. Bước clamp timeline cũng chưa thực hiện đúng cam kết cứu lỗi.

## Phạm vi và nguồn đối chiếu

- Checkout: `F:\Son\tool\TediaPros`, branch `codex/measured-dubbing-first`, HEAD `863f55c38822e28046b0f0592c206ca9303aeeb5`.
- So sánh implementation với `481ae06`, commit ngay trước thay đổi code. Các module plan, grouping và speaking-duration dùng trong reproduction structural split không đổi trong khoảng này.
- Đã đọc toàn bộ [implementation_plan.md](/C:/Users/PC/.gemini/antigravity/brain/5b368140-d2f7-402f-8038-d087e1ba07d4/implementation_plan.md), [walkthrough.md](/C:/Users/PC/.gemini/antigravity/brain/5b368140-d2f7-402f-8038-d087e1ba07d4/walkthrough.md) và [spec multilingual](/F:/Son/tool/TediaPros/docs/superpowers/specs/2026-09-08-autoshort-reliable-multilingual-dubbing-pipeline.md). File planning thực tế là `implementation_plan.md`; dấu escape trong đường dẫn người dùng đã được giải quyết bằng kiểm tra file tồn tại.
- Đối chiếu thêm [design decoupled](/F:/Son/tool/TediaPros/docs/superpowers/specs/2026-09-08-autoshort-decoupled-dubbing-design.md), [plan decoupled](/F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-08-autoshort-decoupled-dubbing.md), [ADR 005](/F:/Son/tool/TediaPros/docs/adr/005-source-anchored-dubbing-tempo-policy.md), [bản bàn giao implementation](/F:/Son/tool/TediaPros/.ai/tasks/2026-09-08-autoshort-decoupled-dubbing.md), root AGENTS và AGENTS của dubbing.
- Đây là review theo phạm vi thay đổi, không phải audit toàn bộ repository. Không sửa production code, không đổi branch/HEAD, không commit. Các file untracked có trước được giữ nguyên.

`CODE_CONFIRMED` = đọc đường chạy thật; `TEST_CONFIRMED` = kiểm thử/probe trong lần review này; `DOCUMENTED_ONLY` = chỉ có lời khẳng định trong tài liệu; `UNKNOWN` = chưa kiểm chứng bằng môi trường thực.

## Findings cần sửa

### F1 — [P1] Structural split dùng lịch tạm trước rescue, làm hỏng job vốn có thể fit

Vị trí: [synthesis.ts:493](/F:/Son/tool/TediaPros/src/main/dubbing/synthesis.ts:493), quyết định split tại dòng 495–502 và cập nhật `measuredPreviousVoiceEnd` tại dòng 526.

Phase 1 chưa biết audio của cue trước sẽ ngắn đi bao nhiêu sau rescue. Tuy nhiên code dùng đuôi tạm của cue trước để quyết định nhóm sau có overflow hay không, rồi thực hiện structural split ngay. Khi rescue cue trước có thể giải phóng khoảng lặng dẫn, quyết định split này trở thành sai và không được xem xét lại.

**TEST_CONFIRMED, so sánh base/head:** video 3.5 s; cue A tại 0–1.4 s; B1 tại 2–2.3 s và B2 tại 2.4–2.8 s được grouping thật thành một speech group. WAV A dài 3 s, candidate A dài 0.5 s; WAV nhóm B dài 1.8 s; cho phép early start 0.35 s như active path của `replace`/`separate-vocals`.

- Base: rescue A trước, A kết thúc 0.5 s; nhóm B bắt đầu 1.75862 s, kết thúc 3 s, tempo 1.45x. `validateDubbingPlan` pass, giữ đủ source IDs.
- HEAD: đo A, đo nhóm B, split B trước LLM; sau split, cửa sổ của B1 không còn thời lượng dương khi áp protected gap. Job ném `Cue b1 có audio không hợp lệ.` trước mọi batch rephrase.

Hướng sửa: phân biệt overflow chắc chắn với overflow phụ thuộc lịch của cue trước; không split không thể hoàn tác dựa trên predecessor còn chờ rescue. Kiểm tra khả năng cấp slot cho các child trước khi chọn split, rồi tính lại lịch sau rescue. Bổ sung regression với nhiều cue, early lead và grouped overflow; không nới tempo hoặc giảm protected gap để làm test pass.

Bằng chứng: [script](/F:/Son/tool/TediaPros/docs/reviews/2026-09-08-multilingual-dubbing-review/evidence/reproduce-premature-structural-split.mjs), [kết quả base/head](/F:/Son/tool/TediaPros/docs/reviews/2026-09-08-multilingual-dubbing-review/evidence/premature-structural-split.json). TTS/trim/DSP là adapter fixture; plan/grouping/synthesis/validator là module thật. HEAD dùng `rephraseBatch`, đúng contract active.

### F2 — [P2] Adapter batch nhả server-inference khi response body còn đang đọc

Vị trí: [autoshort.ts:1577](/F:/Son/tool/TediaPros/src/main/autoshort.ts:1577), `res.json()` nằm ngoài lease tại dòng 1584.

Đường active mới chuyển từ `rephraseDubbingCue` sang `rephraseDubbingCues`. Callback của lease batch chỉ chờ `fetch` trả response, trong khi adapter single trước đây giữ lease qua lúc đọc JSON. Khi response trả header trước body và có consumer khác chờ `server-inference`, TTS khác có thể vào khi response LLM chưa hoàn tất. Ngoài ra, lease được lấy theo request, không bao toàn bộ vòng batch và repair như design yêu cầu.

**TEST_CONFIRMED:** dùng adapter/resource manager thật và `Response` có body trì hoãn; mock fetch, không gọi server ngoài. Adapter single cho thứ tự `llm-body-start → llm-body-complete → competing-tts-enters`; batch cho `llm-body-start → competing-tts-enters → llm-body-complete`.

Hướng sửa: giữ lease đến khi body được đọc/đóng và toàn bộ thao tác inference đã kết thúc; thiết kế ownership cho toàn phase/batch nếu muốn bảo đảm các job không xen model. Test thêm consumer cạnh tranh và cancellation. Probe xác nhận ranh giới lease sai; **không chứng minh server thật đã OOM hoặc treo**.

Bằng chứng: [script](/F:/Son/tool/TediaPros/docs/reviews/2026-09-08-multilingual-dubbing-review/evidence/reproduce-rephrase-lease.mjs), [trace](/F:/Son/tool/TediaPros/docs/reviews/2026-09-08-multilingual-dubbing-review/evidence/rephrase-lease.json).

### F3 — [P2] Miễn trừ câu hỏi làm mất cảnh báo phủ định thật

Vị trí: [autoShortContentQuality.ts:173](/F:/Son/tool/TediaPros/src/main/autoShortContentQuality.ts:173), đặc biệt `onlyNegDiffers && isQuestionContext` và `continue` ở dòng 178–181; nhận diện câu hỏi tại dòng 55–60.

Code bỏ qua chênh lệch `neg` theo cả hai chiều, chỉ cần nguồn hoặc đích có dấu hỏi. Không kiểm tra điều kiện walkthrough nêu là “câu gốc không chứa từ phủ định thực sự”. Regex còn coi từ cuối `sao` là bằng chứng câu hỏi dù đó là danh từ “vì sao”.

**TEST_CONFIRMED:** `你为什么不去学校？` → `Tại sao bạn đi học?` bị mất nghĩa “không” nhưng assessment vẫn `validated`, issues rỗng. `不要看星星。` → `Hãy nhìn các vì sao.` đảo câu cấm thành mệnh lệnh khẳng định cũng được `validated`. Trường hợp đúng `你吃饭了吗？` → `Bạn đã ăn cơm chưa?` vẫn pass làm control.

Hướng sửa: chỉ miễn trừ trợ từ nghi vấn đã nhận diện trong cấu trúc cụ thể, bảo toàn phủ định mệnh đề; không dùng dấu hỏi hoặc một từ cuối câu để miễn trừ toàn câu. Thêm negative tests cho phủ định thật, câu ghép và từ đồng hình.

### F4 — [P2] Quy đổi chữ Hán theo từng ký tự sinh thêm cảnh báo giả và bỏ sót số

Vị trí: [autoShortContentQuality.ts:37](/F:/Son/tool/TediaPros/src/main/autoShortContentQuality.ts:37) và [dòng 68](/F:/Son/tool/TediaPros/src/main/autoShortContentQuality.ts:68).

`CJK_DIGIT_MAP` chỉ có chữ số 0–9; không có bộ phân tích `十/百/千/万`. Mọi chữ `一` đều bị đổi thành 1, kể cả trong từ vựng. Việc xóa mẫu `第...` khỏi nội dung thật để fixture `第一句` không cảnh báo cũng loại bỏ số thứ tự có ý nghĩa; không thể coi mọi ordinal trong source text là metadata cue.

**TEST_CONFIRMED:** `我有十二个苹果。` → `Tôi có 12 quả táo.` cảnh báo `num:2 -> num:12`; `我们一起走吧。` → `Chúng ta cùng đi nhé.` cảnh báo `num:1 ->`. `这是第三次。` → `Đây là lần thứ tư.` không có cảnh báo. Ví dụ ordinal chỉ chứng minh lỗ hổng còn tồn tại trong giải pháp mới, không quy kết mọi phần là regression so với base vốn chưa parse số Hán. Eastern Arabic `١٢ kg` → `12 kg` pass, và phần quy đổi này đã có ở base.

Hướng sửa: nhận diện cụm số trong ngữ cảnh rồi parse giá trị, phân biệt số lượng, thứ tự và từ thông thường. Giữ kiểm tra số thứ tự trong nội dung; sửa fixture bằng nội dung đúng thay vì xóa thông tin nguồn để fixture pass.

### F5 — [P2] Đổi prompt nhưng giữ translation-v5, resume có thể bỏ qua budget mới

Vị trí thay đổi: [prompts.ts:111](/F:/Son/tool/TediaPros/src/main/translation/prompts.ts:111); version vẫn ở [dòng 9](/F:/Son/tool/TediaPros/src/main/translation/prompts.ts:9). Đường reuse: [autoShortItemCoordinator.ts:934](/F:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts:934), dòng 947–953 và 985–991; key builder tại [checkpoint.ts:54](/F:/Son/tool/TediaPros/src/main/translation/checkpoint.ts:54).

Payload mới có `suggested_max_words/chars`, nhưng version định danh prompt không đổi. Translation key chứa version, không hash toàn prompt hoặc bảng rate. Vì vậy resume cùng source/config/model vẫn có thể dùng lại bản dịch trước thay đổi; người dùng chạy lại video lỗi không nhất thiết đi qua cơ chế budget mới.

**TEST_CONFIRMED:** bundle prompt base và HEAD với cùng input; prompt khác nhau nhưng version đều `translation-v5`, translation key giống hệt nhau. Đường coordinator khôi phục checkpoint theo chính key này là `CODE_CONFIRMED`.

Hướng sửa: tăng prompt version khi đổi hành vi/payload hoặc đưa revision của policy rate vào identity; bổ sung test invalidation qua thay đổi prompt. Không cần xóa toàn bộ cache người dùng.

### F6 — [P2, lỗi trong khối clamp; chưa tái hiện bằng media] Sửa finalDuration làm sai quan hệ tempo

Vị trí: [autoShortItemCoordinator.ts:1273](/F:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts:1273), đối chiếu validator [autoShortPolicy.ts:923](/F:/Son/tool/TediaPros/src/main/autoShortPolicy.ts:923).

Clamp ghi đè `plannedEnd/finalDuration`, không đo hoặc xử lý lại WAV và không cập nhật `tempo`. Validator ngay sau đó kiểm tra `tempo == naturalDuration/finalDuration` với tolerance 0.001, nên “chữa sai số” này có thể tự tạo lỗi validation mới.

**TEST_CONFIRMED ở cấp khối code:** trích đúng block production, transpile và chạy với validator thật. Unit có `naturalDuration=1.2`, `finalDuration=1.003`, `plannedStart=9`, `plannedEnd=10.003`, tempo đã tính từ duration thực, video 10 s: trước clamp `ok=true`; sau clamp `ok=false`, lỗi `số đo audio/tempo không khớp timeline`. Probe 10 ms cũng cho kết quả này; audio path không đổi.

**Giới hạn:** đây là fixture đầu vào cho block, không phải một video thật chạy qua toàn pipeline. Active synthesizer đã giữ hard deadline/protected gap và gọi `validateDubbingPlan` trước khi coordinator nhận kết quả, nên không được suy rộng thành khẳng định lỗi tail này thường xuyên xảy ra. Tuy nhiên block không chứng minh được lời hứa cứu lệch đuôi; không có test hành vi mới cho nó trong commit.

Hướng sửa: giữ duration đo thực làm dữ liệu gốc; nếu cần fit lại phải xử lý PCM và đo lại, sau đó đồng bộ tempo, subtitle, diagnostics. Nếu chỉ là tolerance số học, xử lý trong quy tắc validation có giới hạn rõ ràng; không đổi số đo audio để vượt validation. Không đơn thuần tính lại tempo từ duration giả hoặc trim tiếng ở cuối video.

Các probe F3–F6: [script](/F:/Son/tool/TediaPros/docs/reviews/2026-09-08-multilingual-dubbing-review/evidence/reproduce-review.cjs), [kết quả](/F:/Son/tool/TediaPros/docs/reviews/2026-09-08-multilingual-dubbing-review/evidence/reproduction-results.jsonl).

## Đánh giá planning

1. **Chưa có một bộ yêu cầu thống nhất.** Spec multilingual cho phép 1.45–1.55x, thậm chí mục “tuân thủ” ghi fallback 1.50x; implementation plan giữ 1.45x; root/dubbing AGENTS và ADR coi 1.45x là trần. Tương tự, Elastic Gap 0.25 s trái với yêu cầu protected gap 0.50 s của dubbing AGENTS. Không triển khai hai thay đổi này là phù hợp với ràng buộc hiện tại, nhưng phải ghi rõ chúng đã bị loại khỏi planning thay vì báo hoàn tất toàn bộ.
2. **Cam kết hiệu quả thiếu tiêu chí đo.** “Giảm 90% overflow”, “xóa 100% cảnh báo rác”, “triệt tiêu hoàn toàn quá tải” không kèm corpus, voice/model, dữ liệu trước/sau, baseline false positive/false negative, số lần model swap hay giới hạn concurrency. Tài liệu nói đã đối soát Netflix/nguồn mở nhưng không dẫn nguồn hoặc kết quả hiệu chuẩn. Review này không xác nhận các rate là tiêu chuẩn quốc tế.
3. **Thiếu hợp đồng xử lý phụ thuộc giữa cue.** Đưa structural split trước rescue là lựa chọn hợp lý khi overflow chắc chắn, nhưng chưa giải quyết ảnh hưởng của rescue cue trước đến early lead cue sau; F1 là hậu quả trực tiếp.
4. **“Luôn xuất thành phẩm” xung đột với no-silent-drop.** Khi không có candidate giữ nghĩa và vừa 1.45x, báo lỗi hoặc yêu cầu review vẫn là hành vi đúng. Planning cần đặt tiêu chí “hoàn tất an toàn hoặc chẩn đoán rõ ràng”, không yêu cầu thành công bằng mọi giá.
5. **“Ngắn nhất vừa” chưa đúng với thuật toán.** Code xếp candidate bằng predictor rồi dừng ở candidate đo thật fit đầu tiên (`synthesis.ts:630–639`). Đây là hành vi đã có ở base, nên là khoảng cách giữa plan và implementation, không phải regression mới. Nếu ưu tiên số lần TTS ít, nên đổi acceptance thành “candidate đầu tiên fit theo thứ tự ưu tiên”; nếu thật sự cần ngắn nhất, phải đo các candidate còn lại trong ngân sách.

## Ma trận đối chiếu cam kết và code

| Cam kết | Trạng thái thực tế | Bằng chứng/giới hạn |
|---|---|---|
| Tách measure → LLM → rescue | Đã làm trong một lần synthesis | `synthesis.ts:463,547,589`; tests thứ tự phase pass |
| Active AutoShort dùng batch adapter | Đã nối | `autoshort.ts` active `synthesizeDubbingPlan({ rephraseBatch: ... })`; source contract test pass |
| Batch tối đa 8 cue | Đã làm | Synthesis chia `[8,2]`; adapter Local có chunk/repair; 33 dubbing + 18 rephrase tests pass |
| Một API call duy nhất cho mọi overflow | Không đúng theo nghĩa đen | `ceil(N/8)` adapter calls, có thể thêm repair requests; provider ngoài Local vẫn tuần tự từng cue |
| Giữ một lease cho cả batch phase | Chưa làm | Lease ở mỗi `requestBatch`, còn nhả trước JSON; F2 |
| Structural split trước LLM | Đã làm nhưng có regression | F1, base pass/head fail |
| Tempo policy tối đa 1.45x, không chủ động drop cue | Có guard trong synthesis | `synthesis.ts:440`; overflow không cứu được vẫn báo lỗi; không triển khai soft ceiling 1.55x |
| Elastic Gap tối thiểu 0.25 s | Không triển khai | Không có `DUBBING_MIN_SAFE_GAP_SECONDS`; protected-gap policy vẫn 0.5; borrowing đã có từ trước |
| Speaking budget truyền vào prompt dubbing | Đã làm dạng gợi ý | `autoshort.ts:1127`, `prompts.ts:111–116`; subtitle mode không chịu budget |
| 14+ profile/toàn bộ ngôn ngữ | Mô tả quá mức | Bảng thật có 12 keys; `pt` dùng fallback. Rate/unit còn khác giữa spec và walkthrough; `safeRate` không được dùng để tính budget |
| CJK numerals và câu hỏi chính xác | Chỉ xử lý một phần | Control pass nhưng có false negative/false positive; F3–F4 |
| Clamp cứu lỗi export nhẹ | Chưa được chứng minh | Block metadata có lỗi F6; chưa có media acceptance |
| Metrics overflow/batch/rescue | Đã nối vào return/manifest | `autoShortItemCoordinator.ts:1336–1341`; `phaseWaitMs` đo toàn thời gian adapter phase, không riêng thời gian chờ lease; `batchCount` không phải toàn bộ HTTP requests kể cả repair |
| Hết swap/timeout và xuất MP4 lỗi cũ thành công | UNKNOWN | Bản handoff hiện có ghi `media acceptance pending`; walkthrough chưa cung cấp log/media để kết luận |

## Kiểm chứng trong lần review này

- `npm.cmd run typecheck`: **PASS**, Node và Web, exit 0.
- Chạy chín suite qua `node scripts/run-local-runtime-tests.mjs`: **269 tests, 0 failures**. Tám suite walkthrough nêu có 260 tests ở checkout hiện tại; thêm `autoshort-ocr-pipeline.test` có 9 tests.
- Chạy ba script reproduction nêu trên: **đều exit 0**, xác nhận các quan sát và assertions regression. Exit 0 ở các script này nghĩa là tái hiện thành công lỗi đang review, không phải đã sửa lỗi.
- `git diff --check`: pass; tracked production files không có thay đổi do review.
- Không chạy lại full 53-suite local runtime/build; không gọi TTS/LLM thật; không thực hiện acceptance với video lỗi ban đầu. Suite OCR có render fixture FFmpeg nhưng không phải bằng chứng TTS đa ngôn ngữ end-to-end.

[Tóm tắt máy đọc được](/F:/Son/tool/TediaPros/docs/reviews/2026-09-08-multilingual-dubbing-review/evidence/verification-summary.json) · [log các suite](/F:/Son/tool/TediaPros/docs/reviews/2026-09-08-multilingual-dubbing-review/evidence/related-tests.log).

## Thứ tự xử lý đề xuất

1. Sửa F1 và thêm regression base/head thành test trong suite chính.
2. Sửa F2, F3, F4, F5; quyết định lại thiết kế clamp ở F6 và thêm test hành vi.
3. Đồng bộ ba tài liệu theo design được chấp nhận: giữ 1.45x/0.50 s, mô tả budget là heuristic, bỏ cam kết tuyệt đối chưa có evidence.
4. Sau khi kiểm thử local pass, chạy lại video lỗi với Local AI Server thật. Thu log thứ tự phase, số request/repair, model load/unload, peak memory, cue còn overflow; đối chiếu toàn bộ cue ID/text, nghe các cue rescue và kiểm tra MP4. Chỉ đóng acceptance khi có bằng chứng này.
