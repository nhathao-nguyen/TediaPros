# Kế hoạch cải thiện dịch và dubbing qua local server

Ngày: 2026-09-08. Trạng thái: PARTIALLY_IMPLEMENTED, phần client P1/P2/P4/P5 đã tích hợp; qualification server/media vẫn LIVE_PENDING. Cơ sở: [review chat và code](../../reviews/2026-09-08-gemini-dubbing-assessment.md).

## Mục tiêu và quyết định đã chốt

Giữ server dịch/TTS hiện tại. Tăng độ nhất quán và đầy đủ của bản dịch, giảm lỗi request, giảm số lần TTS cứu hộ và số đoạn cần kéo dài video. Người dùng chọn giữ khả năng kéo dài hiện tại, ưu tiên giảm nhu cầu dùng đến nó.

- Giữ hard tempo 1.80x, preferred 1.10x, normal 1.25x, protected gap 0.50s, trim calibration hiện hành.
- Giữ extension từng đoạn tối đa 40% và time map chung cho video/audio/mask/subtitle. Không đổi sang timeline cứng theo chat Gemini.
- Không bật lại tổng quota request/recovery/thời gian. Giữ timeout từng request, cancellation, retry hữu hạn cho cùng request và phát hiện không tiến triển; tham chiếu `docs/translation-budget-policy.md`.
- Bản dịch đủ nghĩa và đúng ID là điều kiện bắt buộc. Số từ/âm tiết chỉ hỗ trợ ước lượng; WAV thật quyết định fit. Không bổ sung từ đệm để đạt độ dài tối thiểu, không cắt lời để fit.
- Không thay ASR/separation/TTS model, không thêm lip-sync, G2P sidecar hoặc hệ thống queue phân tán trong đợt này.

## Luồng dự kiến

Source ledger → dựng batch cùng context/glossary → gợi ý thời lượng mềm → local server dịch → kiểm tra ID/nghĩa → TTS nguyên bản và đo → rephrase các cue overflow → kiểm tra candidate → đo candidate → DSP/reflow/time map hiện có → kiểm chứng publication.

Đường repair cấu trúc riêng với rephrase nghĩa/thời lượng. Predictor lạnh không được tự kích hoạt rewrite trước khi có WAV. Đầu ra LLM không sở hữu timestamps và không tự xác nhận `is_within_budget`.

## P0 — Baseline và hợp đồng capability (làm trước thay đổi hành vi)

- [ ] Ghi snapshot working tree và policy đang dùng; không reset các thay đổi có sẵn. Tái xác minh mỗi symbol trước khi sửa vì repo có công việc song song.
- [ ] Ghi contract thực của server hiện tại từ tài liệu/cấu hình hoặc probe nhỏ: engine, model/revision, context/output limit, tokenizer, response_format hỗ trợ, usage metadata, TTS normalization và speed semantics. Không đoán endpoint riêng; đường backend ngoài repo là dependency chưa xác định.
- [ ] Xây fixture manifest có source hash, cue IDs, locale, voice/model/revision/options, phiên bản prompt/profile, hardware. 30 cue cho mỗi cặp Trung→Việt, Trung→Anh, Trung→Tây Ban Nha, Trung→Đức; ít nhất 4 video đủ timeline, gồm lời nhanh, số/đơn vị, tên, phủ định, câu hỏi, đại từ qua ranh giới batch và câu ngắn. Chỉ dùng ngôn ngữ server thực sự hỗ trợ; ghi unsupported riêng.
- [ ] Đo baseline với code hiện tại; nếu thiếu media hoặc server thì để LIVE_PENDING, vẫn làm fixtures và cải tiến không phụ thuộc server.

File: `tests/fixtures/translation-multilingual/`, `tests/translation-qualification.test.ts`, thêm script benchmark và `docs/benchmarks/local-server-dubbing-improvements.md` khi implement. Không cần chạy cả video để chứng minh transport contract.

## P1 — Hoàn thiện vòng đời request và backoff

File: `src/main/localTranslate.ts`, `translation/budget.ts`, `translation/orchestrator.ts`, `tests/translation-provider-contract.test.ts`, `tests/translation-orchestrator.test.ts`.

- [ ] Giữ lease `server-inference` qua đọc/parse body thành công, đọc/cancel body lỗi và abort; giải phóng đúng một lần trong mọi nhánh.
- [ ] Parse Retry-After giây hoặc HTTP-date; truyền `retryAfterMs` vào structured error. Header sai dùng backoff cơ sở có jitter và trần từng lần chờ. Inject clock/sleep/random để test.
- [ ] Giữ giới hạn 2 transport retry cùng request và 1 format repair cùng ID như policy hiện tại; không thêm tổng quota. Retry 401/403/protocol không áp dụng. Backoff hủy được, không giữ lease khi chờ.
- [ ] Kiểm tra error HTTP có body chậm, socket reset, body JSON sai và cancel sau headers. Không sửa vòng retry cũ chỉ dựa vào tên file; test cả đường AutoShort adapter mới.

Nghiệm thu: request B không lấy lease khi A còn body; header Retry-After thực sự điều khiển lịch; hủy không dispatch tiếp; không tăng retry/no-progress budget và không chuyển model.

## P2 — Context/glossary thực sự tới từng batch

File: `src/shared/translation.ts`, `src/shared/autoShortContract.ts`, `translation/planner.ts`, `prompts.ts`, `orchestrator.ts`, `checkpoint.ts`, `fileRunner.ts`, `autoshort.ts`; UI nếu cần theo `src/renderer/AGENTS.md` và IPC theo `src/shared/AGENTS.md`.

- [ ] Dựng context nguồn mặc định 2 cue trước/2 cue sau từ ledger đầy đủ tại mỗi ranh giới batch; giới hạn token, không đưa context thành cue cần dịch. Với cue bị chia part, lấy context theo offset/ID gốc, không nhân đôi output.
- [ ] Thêm glossary theo job và mô tả nội dung tùy chọn, mặc định rỗng. Cùng dữ liệu đi qua AutoShort và file runner. Không tự phát sinh tên/thuật ngữ từ suy đoán LLM.
- [ ] History ban đầu tối đa 4 cặp source/translation đã qua kiểm tra, theo thứ tự nguồn. Không dùng cue lỗi/nghi ngờ hoặc candidate TTS chưa được duyệt làm context tin cậy. Nếu thiếu history thì vẫn chạy với source context.
- [ ] Đưa context vào repair và split/missing recovery. Chỉ output đúng ID requested; không ghi lại cue đã hợp lệ.
- [ ] Đặt instructions và glossary ổn định trước phần động; chỉ khai thác prefix cache nếu server hỗ trợ. Không kỳ vọng tốc độ từ việc đổi thứ tự prompt khi chưa đo.
- [ ] Lưu snapshot/digest history cho batch đã dispatch. Resume dùng đúng history cũ; batch mới dựng từ các cue đã chấp nhận. Đổi glossary/synopsis/context policy phải invalidate artifact tương ứng, không tái dùng sai ngữ cảnh.

Nghiệm thu: fixture “van an toàn” → “nó” qua batch, thống nhất tên, context echo bị loại, resume giữa video không đổi history của batch đã gửi, repair nhận đúng context và không dịch lại cue tốt.

## P3 — Capability-aware payload và structured output

Phụ thuộc P0; có thể triển khai typed capability với compatibility mode trước khi có server mới.

- [ ] Capability gồm format/schema support, model identity/revision, context/output limit, tokenizer identity và provenance của từng giá trị. Giữ alias `llm-default` nếu server yêu cầu; tách alias gửi đi với identity thật trả về.
- [ ] Giữ `id-lines` làm compatibility mode. Chỉ bật schema sau probe hỗ trợ; schema bắt buộc đúng các ID của batch và text string, không thêm field tự đếm âm tiết. Parser/semantic QA vẫn chạy độc lập.
- [ ] Nếu dùng `json-items`, bắt buộc ID enum, số item và kiểm tra unique ở client; không giả định JSON Schema tự loại duplicate. Nếu dùng object keyed by ID, bổ sung parser format/version riêng.
- [ ] Tính token trên payload thực gồm schema, repair, glossary, history và reserved output; tokenizer phải tính cả chat-template overhead hoặc reserve rõ ràng. Số token là giới hạn vật lý provider, không phải bật lại tổng quota dịch.
- [ ] Đổi format/capability profile phải đổi checkpoint identity. Không tự đổi format giữa một job đang resume. Server từ chối capability đã chọn thì báo cấu hình để chạy lại bằng compatibility mode.
- [ ] Adaptive batching chỉ tác động batch chưa gửi. Lưu plan revision và mapping trong checkpoint trước dispatch; không renumber original batch ID/bộ đếm đã dùng. Thu nhỏ khi output truncate; tăng lại thận trọng sau thành công, không chia theo ký tự vô điều kiện.

File: local adapter, shared translation capability, planner/response/checkpoint/orchestrator, provider contract và resume tests. Server work là task riêng sau khi xác định repo/config; không yêu cầu viết server giả trong Electron.

## P4 — Gợi ý thời lượng theo voice, không ép âm tiết

File: `dubbing/durationPredictor.ts`, `dubbing/profileStore.ts`, `translation/prompts.ts`, `autoshort.ts`; thêm `dubbing/spokenTextFeatures.ts` và tests nếu cần.

- [ ] Thống nhất thuật ngữ: words, graphemes, syllable estimate, phonemes không hoán đổi cho nhau. Bảng `GLOBAL_LANGUAGE_PROFILES` chỉ là heuristic có version/provenance, không coi là bảng SPS chuẩn.
- [ ] Chuẩn hóa bản sao dùng cho features với locale; giữ nguyên source text. Phân biệt số thập phân/ngày/đơn vị/từ viết tắt, ví dụ `3,5 kg`, `2026`, `AWS`. Nếu không biết cách voice đọc thì trả uncertainty; không tạo “âm tiết chính xác” giả.
- [ ] Ưu tiên feature/normalized text do chính TTS backend cung cấp nếu contract có; không thêm Pyphen/đếm nguyên âm IPA như chat.
- [ ] Mở rộng profile key theo model revision, reference content hash, normalizer/feature version và toàn bộ speed/style options. Đổi feature vector thì tăng profile schema; không đọc vector v2 thành v3.
- [ ] Đánh giá predictor trên held-out samples theo voice; residual trên dữ liệu fit không được gọi là confidence đã hiệu chuẩn. Cold start giữ heuristic mềm; profile cũ không đủ identity thì fallback hoặc tạo mới.
- [ ] Có profile tin cậy: dùng nó để tạo gợi ý độ dài cho lần dịch đầu, kèm duration target và uncertainty. Không dùng predictor để loại cue đủ nghĩa, không có lower-bound bắt thêm từ, không mở vòng rewrite trước đo WAV.
- [ ] Budget thời lượng lấy từ slot planner, không đơn thuần `end-start`; tránh trừ protected gap hai lần. Policy tempo lấy từ hằng số chung 1.80x, không hardcode 1.15/1.45 từ chat.

Nghiệm thu: cùng 15 đơn vị khoảng trắng nhưng số/abbreviation cho ước lượng khác; ngôn ngữ unsupported giữ uncertainty; đổi voice/revision/ref audio không dùng profile cũ; prompt không yêu cầu “cắt chính xác N âm tiết” hay thêm từ đệm.

## P5 — Chọn candidate đầy đủ nghĩa rồi mới xét thời lượng

File: `dubbing/synthesis.ts`, `autoshort.ts:rephraseDubbingCues`, `autoShortContentQuality.ts`, `contentQuality/*`, tests rephrase/dubbing/content-quality.

- [ ] Rà cả đường local response → candidate → TTS → final text để tìm semantic gate hiện có; đặt một gate chung cho mọi provider. Không tạo kiểm tra trùng hoặc chỉ kiểm tra bản dịch trước rephrase.
- [ ] Trước TTS, loại candidate mất tên/số/phủ định, chủ thể, đối tượng, hành động, điều kiện hoặc causal relation. Heuristic chỉ chứng minh lỗi nó bắt được; candidate mơ hồ không được mặc định là đã chứng minh tương đương nghĩa.
- [ ] Giữ baseline original và tối đa 3 candidate hiện có. Chọn candidate qua gate; ưu tiên đầy đủ/naturalness, sau đó nhu cầu extension và tempo. Không chỉ sort text ngắn nhất rồi chấp nhận như bằng chứng chất lượng.
- [ ] Cập nhật slot khi predecessor đã được finalize/reflow; re-evaluate original trước thử lại khi nguyên nhân overflow chỉ là phụ thuộc lịch. Quyết định fit dựa vào WAV đo được và slot cuối cùng.
- [ ] Dùng đo thật cho candidate; không dùng `is_within_budget` từ LLM. Giữ cây rescue hữu hạn, cancellation và no-progress. Nếu mọi candidate không tốt hơn thì dùng bản đầy đủ cùng fallback retime/split hiện có hoặc needs-review theo policy.
- [ ] Thêm regression: câu ngắn làm mất “trước khi dùng”; mất đối tượng; mất phủ định trong câu hỏi; số viết dạng khác nhưng cùng giá trị; candidate đủ âm tiết nhưng TTS dài; câu ngắn đã đủ ý không bị thêm lời.

## P6 — Nghiệm thu, telemetry và rollout

- [ ] Lưu metrics theo job: request normal/recovery, input/output tokens nếu provider có (không có thì null), latency, parse/repair, TTS attempts, predictor error, semantic rejects, required/measured tempo, extension từng đoạn và tổng video, no-progress/cancel outcome.
- [ ] A/B cùng source/voice/model/options: baseline; P1–P3; thêm P4–P5. Chấm mù tính đầy đủ và tự nhiên; không dùng số từ hoặc model tự chấm làm tiêu chuẩn duy nhất.
- [ ] Gate bắt buộc: đủ ID/source ledger, không cắt lời, không vượt 1.80x/40%, gap đúng, mọi track dùng cùng time map, EOF hợp lệ; cancel/resume/legacy format pass.
- [ ] Mục tiêu thử nghiệm (không phải kết quả đã đạt): giảm tương đối ít nhất 20% tỷ lệ cue cần extension trên tập baseline có extension, không tăng lỗi nghĩa nghiêm trọng; p95 thời gian job không tăng quá 15%. Báo numerator/denominator và kết quả từng cặp ngôn ngữ. Nếu baseline bằng 0 thì dùng số tuyệt đối, không tính % giả. Với tập nhỏ, cần thêm media trước kết luận tổng quát.
- [ ] Nếu không đạt, giữ feature mới ở opt-in; rollback profile/format/context policy bằng version, không xóa checkpoint/source để che thất bại. P1 transport có thể phát hành độc lập sau test.

Kiểm thử cần chạy khi implement:

```powershell
cmd.exe /c "npm run typecheck"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs translation-provider-contract.test translation-prompts.test translation-planner.test translation-response.test translation-budget.test translation-orchestrator.test translation-resume.test translation-identity.test translation-rephrase.test translation-multilingual.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs dubbing-plan.test dubbing-retime.test autoshort-content-quality.test autoshort-publication-timeline.test"
cmd.exe /c "npm run test:local-runtime"
cmd.exe /c "npm run build"
```

Các suite mới phải được đăng ký vào runner. Chạy full gate một lần sau tích hợp; không coi fixtures là bằng chứng server/media thực. Cập nhật ADR 005 nếu hành vi chọn candidate thay đổi, policy dịch nếu contract đổi, và handoff theo `.ai/tasks/TASK_TEMPLATE.md`.

## Thứ tự giao việc

P0 → P1 → P2 → P3 → P4 → P5 → P6. P3 nhánh server/schema chỉ mở sau capability evidence; phần client/context và semantic tests vẫn tiến hành được. Chưa chốt engine/model mới, chưa cài dependency, chưa thay đổi runtime hoặc deploy server trong task planning này.

## Trạng thái triển khai 2026-09-08

- `IMPLEMENTED_AND_TESTED`: vòng đời lease/body/cancel, Retry-After có trần 30 giây và jitter fallback; context nguồn 2 cue mỗi phía cho batch/recovery; synopsis/glossary qua IPC, AutoShort UI và strict file runners; prompt/plan identity v8/v3; profile duration tách theo model revision, reference hash và feature contract; measured-first, semantic rescue gate và predecessor reflow trước rewrite; extension 40% giữ nguyên.
- `OFFLINE_TESTED_ONLY`: fixture/parser/multilingual qualification, held-out predictor evaluator và build production vào thư mục output kiểm chứng riêng.
- `LIVE_PENDING`: contract/model/tokenizer thực của local server, hiệu chuẩn từng voice, 30 cue × 4 cặp ngôn ngữ, 4 video timeline, A/B và mục tiêu giảm 20% extension.
- `NOT_IMPLEMENTED`: negotiated JSON schema/capability discovery, history 4 cặp đã duyệt cùng snapshot durable, adaptive batch tăng/giảm và telemetry/A-B đầy đủ của P6.
