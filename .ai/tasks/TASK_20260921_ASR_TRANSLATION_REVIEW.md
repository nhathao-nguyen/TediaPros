# REVIEW-20260921: Review đề xuất ASR và dịch cho batch video hỗn hợp

- **Trạng thái:** Hoàn thành review; working tree chưa đạt gate test liên quan (2 test fail).
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-21
- **Mốc source:** HEAD `214083202aac5542785436841816e778712424a9` cộng các thay đổi chưa commit đang có tại lúc kiểm tra.

## 1. Mục Tiêu (Goal)

Review nội dung người dùng dán trong `Pasted text.txt`, đối chiếu với implementation hiện tại và đánh giá phương án tự động cho batch nhiều video khác chủ đề. Người dùng xác nhận cần xem cả Gemini Gateway, Gemini trực tiếp và Local/OpenAI. Đây là review và đề xuất; không triển khai thay đổi sản phẩm.

Kết luận: hướng bổ sung ngữ cảnh riêng từng video là hợp lý, nhưng bản tư vấn nhầm semantic group với API batch, bỏ sót nhánh audio restoration hiện có và đưa ra nhiều cam kết chất lượng/tốc độ không có benchmark. Chưa đủ bằng chứng xác định nguyên nhân lỗi trên các video thực tế.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Đọc toàn bộ nội dung dán, phân biệt đề xuất với hành vi trong code.
- [x] Đối chiếu cả ba nhóm provider mà người dùng sử dụng.
- [x] Kiểm tra upstream đúng phiên bản Faster-Whisper ghim trong repository.
- [x] Chạy typecheck: PASS.
- [x] Chạy các test liên quan và ghi kết quả thật: 39 pass / 2 fail.
- [ ] Working tree đạt toàn bộ test liên quan: chưa đạt; nguyên nhân cụ thể ở mục 4.1.
- [x] Ghi khuyến nghị, giới hạn bằng chứng và bàn giao.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Trong phạm vi:** source AutoShort coordinator, Whisper engine/adapter, translation planner/context/prompts, Gateway restoration, separation interface, resource scheduling và measured TTS policy.
- **Ngoài phạm vi:** sửa source, build/cài bản phát hành, gọi API trả phí, benchmark audio thật, xác minh model/runtime đã cài, sửa các thay đổi chưa commit của công việc khác.
- Chỉ tạo bản review này và log kiểm tra tại `.ai/tasks/2026-09-21-asr-translation-review/`.
- `CODE_CONFIRMED`: xác nhận qua working tree. `TEST_CONFIRMED`: kiểm tra local/fixture. `INFERRED`: rủi ro suy ra, cần mẫu thực tế. `UNKNOWN`: chưa có bằng chứng đủ để kết luận.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

### 4.1. P1 — Validator restoration hiện bỏ qua source edit không hợp lệ

**CODE_CONFIRMED + TEST_CONFIRMED:** thay đổi chưa commit tại `src/main/translation/sourceRestoration.ts:453` bắt lỗi `validateSourceEdit`, log warning và tiếp tục. Đoạn review replacement tại dòng 590 cũng làm tương tự. Hai test ở `tests/autoshort-source-restoration.test.ts:95` và `:204` thất bại vì validator không còn throw với evidence reference không tồn tại hoặc schema edit không được phép.

**Rủi ro INFERRED:** bản dịch `items` có thể được giữ lại sau khi edit giải thích nguồn của nó bị loại; pipeline mất mối liên hệ rõ ràng giữa source được phục hồi và target. Đây không phải bằng chứng một video cụ thể đã dịch sai, nhưng là regression so với contract/test đang có.

Khuyến nghị xử lý trước khi thêm auto-context: reject hoặc đưa candidate/group vào trạng thái cần review/repair khi edit không hợp lệ. Nếu muốn hỗ trợ partial salvage, phải định nghĩa rõ cách loại/kiểm tra lại target phụ thuộc edit đó và cập nhật contract, thay vì chỉ bỏ assert hoặc nuốt exception.

### 4.2. P1 — Bản tư vấn xác định sai cách chia request

| Nhánh hiện tại | CODE_CONFIRMED | Hệ quả với đề xuất |
| --- | --- | --- |
| Gemini API | Adapter khai báo `contextTokens: null`, `outputTokens: 2048`; không bật `wholeDocument` (`src/main/gemini.ts:236`). | Cần capability theo model thực và planner theo capacity nếu muốn tăng request size. |
| OpenAI API | Khai báo tương tự (`src/main/openai.ts:142`). | Không được suy context/output thực chỉ từ tên model. |
| Local | Context chưa biết, output khai báo 2048, format `id-lines` (`src/main/localTranslate.ts:172`). | Phải tôn trọng capacity server/model; không mặc định cả transcript đều vừa. |
| Gemini Gateway dạng text | Có `wholeDocument: true`, `outputAware: true` và source ledger đầy đủ (`src/main/geminiGateway.ts:1147`). | Whole-document không phải tính năng hoàn toàn chưa có. |
| Gemini Gateway trong AutoShort có audio | Coordinator chọn `runGatewayRestoration` (`src/main/autoShortItemCoordinator.ts:1211`); chia 8 cue/chunk, mỗi chunk chạy draft và review (`src/main/geminiGatewayRestoration.ts:38`, `:615`, `:630`). | Sửa riêng `planner.ts` hoặc `context.ts` sẽ không thay đổi nhánh này. |

`maxCuesPerGroup: 6` tại `translation/planner.ts:203` là giới hạn nhóm ngữ nghĩa cho nhánh subtitle. Planner tiếp tục gom nhiều nhóm vào một batch; compatibility path có ngưỡng 24 cue / 20.000 đơn vị chi phí source ước lượng tại dòng 263, kèm kiểm tra context/output khi capability có thông tin. Dubbing còn có source speech groups riêng. Vì vậy phát biểu “mỗi API request chỉ có 4–6 câu” không phản ánh đúng code.

`context.ts` thực sự lấy 2 cue mỗi phía. Tuy nhiên prompt thông thường còn có source group context, synopsis và glossary; không phải model chỉ thấy 2 câu trong toàn bộ request (`translation/prompts.ts:190`).

### 4.3. P1 — Gateway audio cần cải thiện tính liên tục giữa chunk

**CODE_CONFIRMED:** `partitionRestorationCues` dùng `slice` theo số lượng 8, không xét câu hoàn chỉnh hoặc điểm chuyển người nói. `evidenceForChunk` chỉ giữ cue/evidence tương ứng; vòng lặp không truyền một context profile đã thống nhất từ chunk trước sang chunk sau (`geminiGatewayRestoration.ts:268`, `:723`). Synopsis/glossary hiện lấy từ config, dùng lại cho item; chưa có bước tự tạo profile riêng từng video tại coordinator.

**Không được gọi đây là dịch mù:** mỗi draft/review vẫn được đính kèm cùng audio nguồn của item (`geminiGatewayRestoration.ts:410`, `:435`, `:733`). OCR chỉ được gắn ở chế độ `ocr` hoặc `whisper-ocr`; chế độ `whisper` cố ý không gắn OCR dù blur có thể đang quét hình (`autoShortItemCoordinator.ts:1398`).

**INFERRED:** chia cứng có thể đặt biên giữa câu hỏi/câu trả lời hoặc giữa các mảnh cùng câu; quyết định thuật ngữ/xưng hô giữa các chunk chưa được ràng buộc bằng profile chung. Cùng audio được gửi lặp theo số lượt cũng là chi phí cần đo. Test 9 cue xác nhận 4 generation operation với số ID yêu cầu `[8,8,1,1]`; đây là fixture, không phải benchmark latency.

Khuyến nghị: context riêng từng video + chia output theo capacity và biên source có nghĩa. Giữ full transcript làm context read-only khi vừa; khi không vừa, dùng profile chung và các đoạn nguồn liên quan. Output chỉ trả đúng tập ID được yêu cầu. Vẫn giữ giới hạn body/audio, completion validation, checkpoint và Operation API. Không đặt quy tắc “dưới 100 cue luôn một request”.

### 4.4. P1 — Không suy vai vế từ thể loại và không dùng ASR sai làm chân lý

Auto-profile chỉ từ ASR có thể biến lỗi đồng âm thành glossary sai rồi áp dụng xuyên suốt video. Chọn “anh–em” vì phim tình cảm hoặc “tao–mày” vì video hài không có đủ bằng chứng về quan hệ người nói. AutoShort hiện gọi Whisper với `diarize: false`, `speakers: 0` (`autoShortItemCoordinator.ts:1043`). Nhận diện speaker cũng không tự chứng minh được vai vế xã hội.

Khuyến nghị profile per-item có topic, entities/terms, evidence references, các điểm chưa chắc chắn và chính sách xưng hô theo locale đích. Giữ trạng thái unknown khi thiếu căn cứ; không bắt model phải đoán. Chỉ sửa ASR khi audio hoặc chữ nguồn có liên quan hỗ trợ; OCR quảng cáo, watermark và tên file không tự trở thành lời thoại. Profile và các lựa chọn ASR phải vào cache/checkpoint identity, tránh dùng context cũ sau khi đổi video, model, ngôn ngữ hoặc decode policy.

### 4.5. P2 — initial_prompt hữu ích nhưng các cam kết ASR bị phóng đại

**CODE_CONFIRMED:** engine gọi `WhisperModel.transcribe` với `vad_filter=True`, `word_timestamps=True`, chưa truyền `initial_prompt`, `condition_on_previous_text` hay `vad_parameters` (`engines/whisper-engine/engine.py:266`). Input là `processingPath`, có thể là bản đã cắt theo temporal edit, không phải luôn file gốc. Tách âm hiện ở bước sau dịch (`autoShortItemCoordinator.ts:1568`); separator có trả `vocalsPath` nên có nền tảng để làm fallback ASR.

Repository ghim `faster-whisper==1.2.1`. Theo [implementation upstream phiên bản này](https://github.com/SYSTRAN/faster-whisper/blob/v1.2.1/faster_whisper/transcribe.py), tắt conditioning giúp giảm khả năng mắc vòng lặp nhưng có thể giảm nhất quán giữa cửa sổ. `initial_prompt` là prompt cửa sổ đầu trong `WhisperModel.transcribe`, không phải system instruction đảm bảo viết đúng dấu câu hay cơ chế loại bỏ hallucination. Khi tắt conditioning, không được mặc định prompt đầu vẫn duy trì ở mọi cửa sổ tiếp theo.

Theo [VadOptions v1.2.1](https://github.com/SYSTRAN/faster-whisper/blob/v1.2.1/faster_whisper/vad.py), mặc định `min_silence_duration_ms=2000`, `speech_pad_ms=400`. Đề xuất `400/150` giảm cả ngưỡng tách theo khoảng im lặng lẫn phần đệm. Không có cơ sở nói nó mặc nhiên bảo vệ đầu/cuối từ tốt hơn; cần A/B trên nguồn thực tế.

Khuyến nghị: ghi metrics segment như avg_logprob, compression_ratio, no_speech_prob cùng nhận diện ngôn ngữ; engine hiện chưa xuất các metrics segment này. Thử hint ngắn, đúng ngôn ngữ nguồn và có căn cứ; loại tên file số/UUID, watermark và metadata không liên quan. Không dùng synopsis ngôn ngữ đích của cả batch làm prompt nguồn. Giữ ASR raw để so sánh. Với đoạn có dấu hiệu lỗi, thử decode policy khác hoặc vocals rồi đánh giá; không tách tất cả video mặc định khi chưa đo tỷ lệ cải thiện, độ méo và thời gian.

Các con số “loại 90% hallucination”, “triệt tiêu hoàn toàn”, “dấu câu cực kỳ chuẩn” và “đồng nhất 100%” đều **UNKNOWN**, chưa có benchmark trong tài liệu dán.

### 4.6. P2 — Số request, queue và tình huống không có speech cần tính đúng

- Auto-profile + một lần dịch tạo ít nhất 2 generation/video, trước independent review, repair, TTS rephrase và upstream retry. Ví dụ 50 video tạo ít nhất 100 generation trong thiết kế đó, không phải 50. Với nhánh restoration hiện tại, một lượt mới cần `2 * ceil(cueCount / 8)` generation thành công, trước retry/resume; polling/ACK là HTTP request khác, không được tính lẫn generation.
- “Profile 0,3 giây”, “nhanh 3–5 lần” và “không bao giờ 429” chưa được đo. Gemini API có nhiều chiều rate limit; quota theo project, không theo từng API key. Xoay key cùng project không tăng quota: [tài liệu Gemini API](https://ai.google.dev/gemini-api/docs/rate-limits). Quy tắc này không phải mô tả quota của Gemini Web Gateway.
- Resource manager đã có lease cho GPU/CPU/server, mặc định capacity 1 (`autoShortResourceManager.ts:36`). Queue có `maxActiveItems` 1 hoặc 2 (`autoShortQueueRunner.ts:15`). Tối ưu overlap cần giữ admission của provider và dung lượng scratch; “API không tốn GPU” không đúng nếu Local inference chạy trên cùng GPU.
- Whisper trả 0 cue hiện là invalid source (`autoShortItemCoordinator.ts:1054`). Zero cue không đủ chứng minh video không có lời: có thể sai language, VAD bỏ sót hoặc nhận dạng thất bại. Có thể bổ sung trạng thái “không phát hiện lời nói” sau đánh giá, nhưng không đánh dấu đã dịch/lồng tiếng thành công; video chỉ có chữ vẫn có thể cần OCR. Lỗi item và lỗi provider toàn cục cần cách xử lý khác nhau.
- Giữ cancel, checkpoint, tiến triển thực và phân biệt `waiting-provider` / `outcome-unknown`; không tự replay một operation đã dispatch mà chưa rõ kết quả chỉ để batch tiếp tục.

### 4.7. Phần đề xuất nên giữ và thứ tự thực hiện

1. **Ưu tiên trước:** giải quyết regression validation ở mục 4.1; đóng băng một baseline có bằng chứng, thu mẫu lỗi theo từng provider.
2. **Ngữ cảnh dùng chung cho cả ba nhóm provider:** tạo `VideoContext` riêng từng item; có source evidence và uncertainty, không ép quan hệ nhân vật. Tránh context lọt từ video trước sang video sau. Với video vừa một request, có thể tích hợp phân tích trong lượt dịch để giảm lượt gọi; profile riêng hữu ích hơn khi phải chia nhiều request và cần tái dùng quyết định.
3. **Capacity và biên câu:** Gemini/OpenAI/Local cần capability phù hợp model/server; Gateway audio cần chia theo semantic boundary và output/body capacity. Nhìn toàn văn và trả toàn bộ bản dịch trong một request là hai lựa chọn độc lập.
4. **ASR thích ứng:** bổ sung diagnostics, hint có căn cứ, fallback decode/vocals cho input nghi lỗi. Mọi thay đổi ASR phải cập nhật cache revision/identity và runtime đóng gói khi triển khai.
5. **TTS:** giữ dịch tự nhiên, đủ ý và gọn; giữ đo WAV thật rồi mới rephrase các cue tràn. Code đã có measured recovery (`dubbing/synthesis.ts:511`, `:679`) và prompt nói rõ meaning ưu tiên hơn word/time estimate (`translation/prompts.ts:178`). Không bỏ toàn bộ pacing guidance hoặc tăng tempo để che sai alignment; giữ trần 1.80x hiện hành.
6. **Đánh giá trước rollout:** tập mẫu phân tầng theo ngôn ngữ, hội thoại/thuyết minh, BGM mạnh, chỉ nhạc/chỉ chữ, tên riêng/số/phủ định và video dài. Chấm bằng transcript/audio được đối chiếu; đo lỗi nghĩa/xưng hô, WER/CER khi phù hợp, lỗi entity/số, cue/timing invariants, TTS overflow, generation/token/latency p50-p95, memory/scratch và phục hồi/cancel. Không suy chất lượng bản dịch từ số test pass hay giảm số request.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `.ai/tasks/TASK_20260921_ASR_TRANSLATION_REVIEW.md`
- `[NEW]` `.ai/tasks/2026-09-21-asr-translation-review/focused-tests.log`
- `[NEW]` `.ai/tasks/2026-09-21-asr-translation-review/typecheck.log`
- Không sửa source/test sản phẩm và không ghi đè các thay đổi chưa commit có trước.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Các lệnh thực tế, chạy từ repository root:

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs translation-planner.test translation-prompts.test gateway-restoration-pipeline.test autoshort-source-restoration.test autoshort-stage-scheduling.test
```

| Bộ kiểm tra | Kết quả |
| --- | --- |
| Typecheck node + web | PASS, exit 0 |
| translation-planner | 12/12 PASS |
| translation-prompts | 11/11 PASS |
| gateway-restoration-pipeline | 6/6 PASS |
| autoshort-source-restoration | 9/11 PASS; 2 FAIL |
| autoshort-stage-scheduling | 1/1 PASS |
| Tổng test đã chọn | 39 PASS / 2 FAIL, exit 1 |

Đã chạy lại nhóm test sau khi lần ra diff validator để lưu log đầy đủ; hai failure tái hiện. Typecheck được chạy lại và lưu log. Các test Gateway dùng fixture/mocked transport; không chứng minh dịch thực tế, khả năng ASR hoặc provider đang hoạt động. Không chạy end-to-end media thật, không gửi audio người dùng lên dịch vụ, không xác minh bản cài Windows có cùng source.

Kiểm tra bổ sung `git diff --check` báo whitespace trong thay đổi có trước ở `src/renderer/src/styles/douyin.css` và blank line cuối `tests/gateway-restoration-pipeline.test.ts`; không chỉnh các tệp này trong review.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Review hoàn tất; triển khai vẫn là đề xuất. Không xem kết quả này là phê duyệt deploy hoặc chứng minh pipeline hiện tại đã đạt quality gate.
- Nếu triển khai, bắt đầu từ validator đang fail, rồi context riêng từng item và capacity/boundary theo provider. Thêm initial_prompt và tăng context radius đơn thuần không xử lý được toàn bộ các nhánh.
- Cần mẫu input, source SRT, target SRT, cấu hình provider/model và audit tương ứng để kết luận nguyên nhân lỗi người dùng quan sát. Chỉ source/config và test local trong review này chưa trả lời được chất lượng bản dịch thực tế.
