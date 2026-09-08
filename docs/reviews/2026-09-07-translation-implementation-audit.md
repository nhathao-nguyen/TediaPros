# Review triển khai kế hoạch translation reliability

Ngày: 2026-09-07. Commit được review: `7d86614572c6941861ee130e89e4d93e9ae2cc64`.
Worktree: `F:\Son\tool\TediaPros\.worktrees\codex-autoshort-optimization`.
Đối chiếu [kế hoạch tổng](../superpowers/plans/2026-09-07-translation-reliability-master.md) và ba kế hoạch A/B/C.

**Kết luận: chưa đáp ứng nghiệm thu 12 task.** Đã có các thay đổi hữu ích trong runtime, nhưng orchestrator, budget, token planner, checkpoint recovery và language assessment chung chưa được nối vào đường chạy Auto Short. Một số lỗi mà kế hoạch yêu cầu loại bỏ vẫn tái hiện được. Không nên dùng checklist hoàn tất trước review này để quyết định release hoặc khẳng định retry/resume đã an toàn.

Đây là review implementation so với yêu cầu; không khẳng định mọi lỗi dưới đây đều mới được đưa vào bởi commit trên. Lượt review chỉ thêm tài liệu và diagnostic offline, không sửa runtime.

## Bằng chứng và giới hạn

- **TEST_CONFIRMED:** `npm.cmd run typecheck` PASS; 67 test hiện có thuộc 14 file liên quan PASS.
- **TEST_CONFIRMED_OFFLINE_MOCKS:** thêm 15 phép thử nhắm vào các khoảng trống nghiệm thu; cả 15 đều tái hiện hành vi không đạt. Đây là các trường hợp được chọn để tìm lỗi, không phải tỷ lệ thất bại đại diện cho video thực tế.
- **CODE_CONFIRMED:** truy vết các call site từ coordinator đến Local/Gemini/OpenAI, checkpoint, rephrase, UI retry và qualification script. Các nhận xét chưa có probe được ghi rõ bên dưới.
- **UNKNOWN:** chất lượng dịch thật, latency/cost trên server thật, thao tác GUI sau restart, TTS/font/RTL/render và package. Không gọi provider bên ngoài, không sử dụng key thật, không render hoặc restart app.

Artifacts tái hiện:

- [Kết quả 15 diagnostic probes](2026-09-07-translation-implementation-probes.json).
- [Fixture và consumer probes](fixtures/translation-implementation-probes.ts).
- [Runner offline](../../scripts/review-translation-implementation.mjs).

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs translation-response.test translation-prompts.test translation-budget.test translation-orchestrator.test translation-identity.test translation-resume.test translation-planner.test translation-language.test translation-multilingual.test translation-qualification.test translation-rephrase.test local-translation.test autoshort-content-quality.test autoshort-ui-contract.test
node scripts/review-translation-implementation.mjs
git diff --check
```

Runner diagnostic trả exit **1** khi có tiêu chí nghiệm thu bị vi phạm; **2** nếu runner gặp lỗi hạ tầng. Không đưa các diagnostic vào danh sách test PASS. `fetch`, Electron và media engines đều được mock; key giả và checkpoint nằm trong thư mục tạm riêng. Hàm private `extractRephrasedTexts` chỉ được expose trong bundle tạm bằng esbuild, không thay source runtime.

## Đường chạy thực tế

`AutoShort → createAutoShortItemProcessor → translateStrict → requestTranslation → localTranslateSrt / gemini.translateSrt / openai.translateSrt → SRT → assessContentQuality → TTS/render`

`translateWithAdapter` hiện chỉ được gọi bởi test. `planTranslation`, `createTranslationBudget`, `assessTranslationLanguage` nằm trong nhánh module đó; `readTranslationCheckpoint`, `writeTranslationCheckpoint` và `buildRepairMessages` không có production caller. Coordinator dùng `buildTranslationIdentity` nhưng vẫn tự lưu một checkpoint khác, không chứa budget/plan/failure fingerprint theo T8.

## Findings ưu tiên

### R1 — P1: Local recovery vẫn có thể xuất bản dịch bị mất continuation

Vị trí: [localTranslate.ts](../../src/main/localTranslate.ts), dòng 641–643, 686–693 và 710–714.

`parseTranslationResponse` báo `unparsed-content`, nhưng `usable` chỉ loại trường hợp truncated/source echo. Nhánh partial recovery tiếp tục giữ các item đó rồi chỉ dịch ID thiếu. Probe trả 11/12 cue cộng một dòng continuation không có ID; request sau chỉ gửi `cue-11`. Kết quả `ok=true`, phần đầu từ response lỗi được giữ lại, continuation biến mất. Lỗi parser đã được phát hiện nhưng quyết định giữ partial đã bỏ qua nó.

**Cần sửa:** phân biệt response chỉ thiếu ID với response không xác nhận được toàn bộ nội dung. Không commit item từ response truncated/unparsed; chỉ giữ subset khi có đủ bằng chứng không mất nội dung. Kiểm tra này phải nằm trước cả callback lưu batch và merge cuối. Thêm regression ở public wrapper, không chỉ test parser.

### R2 — P1: Budget chung chưa chạy trong ba provider; cloud vượt trần đã chốt

Vị trí: [autoshort.ts](../../src/main/autoshort.ts), dòng 1075–1100; [localTranslate.ts](../../src/main/localTranslate.ts), dòng 487–492; [gemini.ts](../../src/main/gemini.ts) và [openai.ts](../../src/main/openai.ts), `goiCoLui` / `translateSrt`.

Local vẫn tạo `TranslationRequestBudget` riêng mỗi invocation, deadline cố định 10 phút. Gemini/OpenAI vẫn chia batch 20.000 ký tự và tự lặp tối đa hai model mỗi batch. Orchestrator/shared budget mới không điều khiển các request này.

**Probe:** B=10; mỗi batch model đầu trả 503, model thứ hai trả kết quả hợp lệ. Cả Gemini và OpenAI đều `ok=true` sau **20 inference request**, trong khi trần kế hoạch là **15**. Mỗi provider còn có một discovery call được ghi riêng, không tính lẫn vào con số 20. Điều này chứng minh vi phạm ngân sách, không chứng minh vòng lặp vô hạn.

**Cần sửa:** đưa cả ba wrapper qua adapter một request và một orchestrator; charge mọi fallback/transport/repair/split vào cùng budget, trước dispatch. Chạy lại probe tại entry point public của từng provider.

### R3 — P1: Batch tốt không trở thành tiến độ có thể resume vì ID không đồng nhất

Vị trí: [autoShortItemCoordinator.ts](../../src/main/autoShortItemCoordinator.ts), dòng 1005–1024; [subtitles.ts](../../src/shared/subtitles.ts), dòng 152; [translate-shared.ts](../../src/main/translate-shared.ts), dòng 337.

Coordinator dùng ID `cue-0-0`, `cue-1-2000`; callback provider trả `cue-0`, `cue-1`. Khi lookup bằng ID nguồn, không item nào khớp. Probe chạy coordinator thật với ASR giả 30 cue: batch đầu 10 cue tốt, batch sau lỗi 401; checkpoint có một `translationBatches` nhưng **`translatedCues=[]`**. `translationBatches` chưa được đọc để phục hồi.

Ngay cả sau khi thống nhất ID, callback hiện tạo map từ `reusablePartial` ban đầu + batch hiện tại, không tích lũy các batch mới đã nhận trước đó. Một nhánh khác còn serialize subset nguồn sang SRT rồi parse lại: probe làm `cue-1-2000` đổi thành `cue-0-2000`, khiến strict merge lỗi unknown ID.

**Cần sửa:** giữ typed canonical ID suốt pipeline hoặc có mapping unit↔source rõ ràng ở boundary SRT; tích lũy và đọc lại batch đã validated. Không dùng việc serialize/parse subset để khôi phục identity. Kiểm thử nhiều batch, failure giữa chừng và resume trong invocation mới.

### R4 — P1: `needs-review` chưa ngăn tự dispatch khi chạy lại; checkpoint không giữ retry state

Vị trí: [autoShortItemCoordinator.ts](../../src/main/autoShortItemCoordinator.ts), dòng 361–375, 939–953, 995–1002.

Checkpoint `needs-review` chỉ làm nhánh reuse bị bỏ qua; luồng sau đó xóa assessment trên checkpoint và gọi dịch mới. Probe gọi coordinator hai lần với cùng checkpoint, không tạo retry generation: số request tăng **2 → 3**, ASR vẫn chỉ chạy một lần. Tức source resume có hoạt động, terminal translation gate thì không.

Checkpoint production không lưu B, budget counters, active deadline, failure fingerprint hoặc in-flight charge. T8 module có schema riêng nhưng chưa nối vào coordinator/orchestrator. Resume hiện không thể thực hiện lời hứa “không reset ngân sách”.

**Cần sửa:** terminal gate phải được kiểm tra trước dispatch; khôi phục plan/budget/batches/failures từ checkpoint authoritative. Chỉ explicit retry generation mới được bắt đầu lượt recovery mới, theo policy đã chốt.

### R5 — P1: Orchestrator mới cũng đánh dấu `validated` cho response không hợp lệ

Vị trí: [orchestrator.ts](../../src/main/translation/orchestrator.ts), dòng 183–184, 218–223 và nhánh final assessment.

Module chưa chạy trong app, nhưng phải sửa trước khi tích hợp R2. Item được ghi vào `accepted` trước khi xét parser errors. Response có đủ ID dù truncated/unparsed làm recovery bị bỏ qua bởi `alreadyDone`; lỗi parser không được giữ vào `terminalIssues`.

**Hai probe:** đủ hai ID + `truncated=true`, và đủ hai ID + continuation ngoài grammar, đều trả **`validated`, issues rỗng, một request**.

**Cần sửa:** chỉ thêm accepted sau khi chứng minh item đủ điều kiện reuse; giữ blocking issue đến khi đúng tập cue được sửa thành công. Không coi “đủ ID” là “đủ nội dung”.

### R6 — P1: Rephrase consumer bỏ qua lỗi parser và dùng candidate mất phần sau

Vị trí: [autoshort.ts](../../src/main/autoshort.ts), dòng 1267–1282.

`extractRephrasedTexts` lấy `parsed.items` nhưng không kiểm tra `parsed.complete`/blocking issues. Probe `[a:1] Do touch the dog.` rồi một continuation không có ID: parser báo incomplete, consumer vẫn trả `Do touch the dog.`. Đây là đường có thể đưa candidate mất ý vào bước fit TTS. Chưa render audio trong review này.

**Cần sửa:** reject response rephrase không đúng grammar trước chọn candidate; giữ translated text đã xác thực khi repair thất bại. Truyền finish/truncation metadata vào cùng quyết định, thay vì chỉ trả string từ provider. Batch rephrase cần validate tập ID chung, không vô tình coi cue hợp lệ khác trong batch là unknown.

### R7 — P2: Prompt thực gửi lên cloud mâu thuẫn schema và bỏ phần user message mới

Vị trí: [prompts.ts](../../src/main/translation/prompts.ts), dòng 45–48; [gemini.ts](../../src/main/gemini.ts), dòng 214–220 và 299; [openai.ts](../../src/main/openai.ts), dòng 103–127 và 300.

System yêu cầu `{"items":[{"id":"...","text":"..."}]}`. Schema Gemini yêu cầu root ARRAY `{id,t}`; schema OpenAI yêu cầu `{items:[{id,t}]}` với `additionalProperties=false`. Đây là mâu thuẫn xác định được từ request body, không phụ thuộc đánh giá chất lượng model.

Cả hai chỉ lấy `buildTranslationMessages(...)[0]`, bỏ user message JSONL của builder và gửi payload legacy. Local cũng vẫn ghép system mới với user payload cũ. Vì vậy test snapshot builder chưa chứng minh contract trên wire thống nhất hoặc dữ liệu nguồn được serialize theo cách T3 yêu cầu.

**Cần sửa:** adapter dùng nguyên cặp messages và schema cùng một contract; kiểm tra body thật bằng fetch mock, bao gồm source có xuống dòng/dấu ngoặc/nội dung giống instruction. `buildRepairMessages` cũng cần được sử dụng cho format repair.

### R8 — P2: Token planner chưa tích hợp và capability boundary trong module bị đảo hành vi

Vị trí: [planner.ts](../../src/main/translation/planner.ts), dòng 134–136, 160–170; [orchestrator.ts](../../src/main/translation/orchestrator.ts), dòng 141 và 172; [localTranslate.ts](../../src/main/localTranslate.ts), dòng 601.

Production Local vẫn tính `max_tokens` từ số cue; cloud vẫn theo ký tự. Module planner dùng một JSON ước lượng riêng, không phải toàn bộ body/messages/schema mà adapter gửi. Ngưỡng output còn bị ép tối thiểu 128 ngay cả khi capability nhỏ hơn.

**Probe module:** context/output limit=1 đánh dấu `unsupported=true` nhưng vẫn dispatch hai request; limits unknown nhận response hợp lệ nhưng thành `needs-review` vì warning bị chuyển thành severity error. Hai tình huống ngược yêu cầu: unsupported cần fail trước network, unknown cần cảnh báo theo policy.

**Cần sửa:** tính chi phí trên request được serialize thực tế, giữ giới hạn capability, giải quyết oversize trước dispatch và phân loại đúng warning. Hoàn thành long-cue splitting/restoration trong đường chạy thật.

### R9 — P2: Sửa khoảng trắng tiếng Hàn chưa đến payload dubbing production

Vị trí: [localTranslate.ts](../../src/main/localTranslate.ts), dòng 480; [translate-shared.ts](../../src/main/translate-shared.ts), dòng 138 và 166; [semanticGrouping.ts](../../src/main/semanticGrouping.ts), dòng 123–128.

Helper chỉ thêm khoảng trắng giữa Hangul khi locale là `ko`. Source grouping dubbing lại dùng target locale; phần “Toàn văn nhóm” gọi `joinGroupText` không truyền locale.

**Probe Local ko→en, mode dubbing:** nguồn `나는` + `학생입니다`; user payload vẫn chứa **`나는학생입니다`**, không có `나는 학생입니다`. Translator vẫn trả thành công. Test helper với locale ko không bắt được lỗi wiring này.

**Cần sửa:** dùng source locale cho grouping/context nguồn; target locale cho ghép translation units đầu ra. Thêm probe request body cho Local và payload cloud dùng chung.

### R10 — P2: Language assessment/capability chung chưa bảo vệ flow thực tế

Vị trí: [autoshort.ts](../../src/main/autoshort.ts), dòng 603–642, 1128–1158; [autoShortItemCoordinator.ts](../../src/main/autoShortItemCoordinator.ts), dòng 928 và 1065; [language.ts](../../src/main/translation/language.ts).

**Probe public `translateStrict` + QA mà coordinator dùng:** model trả nguyên câu tiếng Anh khi yêu cầu tiếng Pháp; kết quả `validated`, issues rỗng, languageEvidence unknown. `assessTranslationLanguage` có logic cảnh báo nhưng chỉ được orchestrator chưa tích hợp gọi. Hai script guards cũ vẫn nằm ở Local và AutoShort, chưa hợp nhất theo T10.

**CODE_CONFIRMED:** readiness ASR/OCR dựa vào engine/model đã cài; translation/TTS báo unknown chung; chưa lấy allowed languages thực của model hay font/glyph capability. Kết quả `resolveTranslationReadiness(stageCapabilities)` bị bỏ qua. Đây là reporting một phần, chưa phải capability matrix có enforcement theo ngôn ngữ.

**Cần sửa:** một assessment chung cho fresh/cache/resume; warning phải đi đến checkpoint/UI. Lấy capability từ stage thực và dùng kết quả readiness khi quyết định admission. Unknown vẫn phải được phân biệt với qualified.

### R11 — P2: UI retry hiện vẫn dẫn đến chạy lại toàn hàng đợi, state không được phục hồi sau restart

Vị trí: [AutoShort.tsx](../../src/renderer/src/components/AutoShort.tsx), dòng 135, 880–900, 984–986 và 1004–1025; [autoshort.ts](../../src/main/autoshort.ts), dòng 170 và 2606–2638.

**CODE_CONFIRMED, chưa thao tác GUI:** nút retry chỉ chuẩn bị một item rồi yêu cầu bấm Start; Start reset mọi task và gửi `tasks.map(...)`, bao gồm các item done. T11 yêu cầu tiếp tục item được chọn. `tasks` là state trong RAM và retry registry là Map trong main process; chưa có đường hydrate trạng thái review khi restart. Khóa `inFlight` chống hai request đồng thời, nhưng identity/generation chưa tiêu thụ một lần, nên request cũ tuần tự vẫn có thể tạo generation mới.

**Cần sửa:** enqueue tập item được yêu cầu retry; persist/hydrate trạng thái và evidence cho UI; kiểm tra generation hoặc token đã tiêu thụ, bổ sung flow test stale/repeated/restart. Không dùng ba test `autoshort-ui-contract` hiện có (coalescing/cache clear) làm bằng chứng retry UX đã đạt.

### R12 — P2: Qualification script mới tạo report mẫu, chưa thực hiện A/B hoặc corpus nghiệm thu

Vị trí: [translation-qualification-main.mjs](../../scripts/translation-qualification-main.mjs), dòng 85–136; [translation-multilingual.test.ts](../../tests/translation-multilingual.test.ts).

**CODE_CONFIRMED:** `requests=0`, `recoveryRequests=0`, `elapsedMs=0`; `lostCueCount` được suy ra từ nhãn `entry.expected`, không từ response/parser. `baseline`/`candidate` chỉ đổi nhãn report. Offline harness không chạy adapter hoặc parser. Corpus có bốn case; test 16 target chỉ kiểm tra chuỗi prompt, chưa có 240 directed locale-pair mock passes như T12.

Việc giữ live adapter fail-closed và semantic review pending là đúng. Tuy nhiên các trường số trong report chưa phải phép đo, không dùng chúng để nghiệm thu loss/recovery/performance.

**Cần sửa:** chạy baseline/candidate qua pipeline mock thực, thu counters từ execution, đối chiếu accepted IDs/text với fixture; tách unknown/unmeasured khỏi số 0 đã đo. Sau khi offline đạt mới xét corpus thật và review ngôn ngữ theo scope được cho phép.

## Đối chiếu 12 task

| Task | Phần đã hiện hữu | Trạng thái nghiệm thu sau review |
|---|---|---|
| T1 | Typed assessment; số/phủ định heuristic thành warning; UI hiển thị issues | **Một phần**: core QA đã hoạt động; persist/hydrate warning/review còn thiếu ở T8/T11 |
| T2 | Parser báo continuation/duplicate/missing; `translateStrict` bỏ source fallback | **Chưa đạt**: consumer vẫn nhận prefix lỗi, canonical ID chưa xuyên suốt — R1/R3/R5 |
| T3 | Versioned builder, target locale/mode đã sửa, task repair có builder | **Chưa đạt**: body/schema thực không thống nhất, bỏ user message mới — R7 |
| T4 | Prompt rephrase riêng, có source/context và candidate grammar | **Chưa đạt**: consumer bỏ blocking parser issue/truncation boundary — R6 |
| T5 | Shared budget module và unit tests; Local có total request cap | **Chưa đạt runtime chung/cross-resume** — R2/R4 |
| T6 | Iterative orchestrator với fake adapter tests | **Chưa tích hợp**, còn lỗi nhận response invalid — R2/R5 |
| T7 | Key theo nội dung nguồn/prompt/options; cache envelope; revalidation; unknown revision bỏ cross-job persistent cache | **Một phần**: production model identity vẫn alias, chưa lấy actual selected model/revision từ adapter; incremental identity còn sai — R3 |
| T8 | Atomic checkpoint; giữ bản cũ; retry generation; callback batch | **Chưa đạt**: mất progress usable, không persist budget/failure, không terminal gate — R3/R4 |
| T9 | Planner/long-cue helpers; locale-aware join có test | **Chưa đạt production**: token planner chưa dùng; context ko vẫn sai — R8/R9 |
| T10 | BCP47 helpers; heuristic language module; stage reporting | **Chưa đạt integration/capability enforcement** — R10 |
| T11 | Typed IPC, path/identity validation, nút review/retry và counters | **Một phần**, chưa per-item resume/restart/repeated request acceptance — R11 |
| T12 | Bốn fixtures, report scaffold, live gates unqualified | **Scaffold**, chưa offline A/B execution, chưa 240 pair tests — R12 |

Không quy đổi “có file + unit pass” thành phần trăm hoàn tất. Cần kiểm thử ở các boundary thật trước đóng task.

## Thứ tự sửa để đóng lại các task đã mở

1. T2/T4: chặn mất nội dung ở Local, rephrase và orchestrator; giữ regression tái hiện R1/R5/R6.
2. T6/T8: thống nhất canonical ID, adapter một request, budget/checkpoint authoritative và terminal gate; chứng minh 10 batch không vượt 15 request, resume không tự reset và không mất batch tốt.
3. T3/T9/T10: thống nhất actual request body/schema; token planner, source-locale grouping và language/capability assessment đi qua production path.
4. T11/T12: per-item UI recovery, restart/stale-generation tests; offline A/B thực và matrix ngôn ngữ. Đo live/GUI/media theo gate riêng, không gán số tối ưu chưa đo.

Review không đề xuất tăng retry cap để che các lỗi trên. Giữ các cải thiện đã đạt: source checkpoint, timestamp nguồn, bỏ silent source fallback, semantic warning thay false hard block và unknown model revision không được xem như cache identity đã xác nhận.
