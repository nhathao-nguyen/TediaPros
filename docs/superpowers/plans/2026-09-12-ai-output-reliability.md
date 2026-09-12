# Plan: Sửa độ tin cậy đầu ra AI

- Ngày: 2026-09-12.
- Trạng thái: **CLIENT_IMPLEMENTED / OFFLINE_VERIFIED**. Checklist bên dưới được giữ làm dấu vết thiết kế; bằng chứng thực thi hiện tại nằm trong [implementation handoff](../../../.ai/tasks/2026-09-12-ai-output-reliability/implementation.md). Live provider/gateway qualification và ma trận filesystem khác Windows hiện tại vẫn chưa được xác nhận.
- [Spec và acceptance criteria](../specs/2026-09-12-ai-output-reliability-design.md).
- [Baseline và bàn giao](../../../.ai/tasks/TASK-20260912-ai-output-reliability-planning.md).
- [60 test scenarios có owner/expected outcome](../specs/2026-09-12-ai-output-reliability-adversarial-cases.md).
- [Review và danh sách 14 khoảng trống đã sửa trong tài liệu](../../../.ai/tasks/2026-09-12-ai-output-reliability-review/review.md).
- Thực hiện tuần tự theo dependency. Không cần subagent để thực hiện kế hoạch.

## 1. Trình tự, phạm vi và điểm kết thúc

| Task | Ưu tiên | Phụ thuộc | Kết quả review được |
|---|---|---|---|
| P0 | Cao | Không | Fixture và test đỏ tái hiện lỗi, baseline và call-site map |
| P1 | Cao | P0 | Parser bounded, strict schemas, legacy normalization tách biệt |
| P2 | Cao | P1 | Provider envelope và task-specific structured completion |
| P3 | Cao | P1, P2 | Metadata/title/summary repair, sidecar và cancellation an toàn |
| P4 | Cao | P1, P2 | Translation identity/accepted state/checkpoint không nhận dữ liệu lỗi |
| P5 | Trung bình | P4 | Prompt gọn, quality assessment có bằng chứng, version migration |
| P6 | Cao | P3, P4, P5 | Integration tests, diagnostics, docs, review và qualification |

Làm P0–P4 trước để ngăn lỗi lọt vào output. P5 giảm dư thừa và bổ sung chất lượng nhưng không thay thế các guard P0–P4. Không đánh dấu toàn bộ spec hoàn tất khi chỉ metadata đã được sửa. **Version/identity/fencing/diagnostics tối thiểu là gate ngay tại task thay đổi hành vi**, không chờ P5/P6. P3 phải có publication spike ở Windows/filesystem thực, P4 phải có nested checkpoint validation trước bật resume.

## 2. Ràng buộc thực hiện

- Đọc AGENTS.md tại root, src/main, src/shared; đọc renderer/dubbing AGENTS nếu chạm các vùng đó.
- Kiểm tra git status/HEAD trước sửa; bảo toàn các file planning và công việc khác đang untracked/dirty. Nếu cần cô lập dùng branch/worktree `codex/ai-output-reliability`, kiểm tra tên tồn tại trước tạo.
- Không đổi tempo, video extension, TTS semantics, OCR/engine hay tổng quota dịch. Giữ request timeout, hủy và no-progress.
- Không viết lại toàn bộ pipeline. Thêm pure parser/contract primitives; reuse scheduler/lease/digest/publisher đang có.
- Không tự gọi provider trả phí hoặc triển khai gateway trong đợt lập plan. Khi implementation được yêu cầu, dùng cấu hình/ủy quyền hiện có và báo rõ phần live chưa chạy nếu chưa có endpoint hợp lệ.
- Không dùng skill/plugin không có trong session làm điều kiện bắt buộc để thực hiện plan.

## 3. P0 — Đóng băng bằng chứng và tạo regression

Files: tests/video-seo.test.ts, tests/video-title.test.ts, tests/translation-response.test.ts, tests/translation-orchestrator.test.ts; thêm `tests/fixtures/ai-output/` và manifest khi implement.

- [ ] Ghi HEAD, dirty paths, prompt/parser versions và baseline test logs.
- [ ] Map mọi caller completion/rephrase/parse/checkpoint: dịch file, AutoShort strict translation, legacy local path, SEO/title/summary và rephrase TTS.
- [ ] Tạo fixture **synthetic-from-screenshot** gồm outer title chưa đóng + fence + inner metadata. Không chép phần ảnh bị che thành raw response giả.
- [ ] Thêm biến thể JSON hợp lệ nhưng title chứa nguyên escaped JSON/fence; test cần chứng minh không publish.
- [ ] Thêm truncation envelope với JSON đủ field; duplicate properties/ID; numeric ID reorder; multiple objects; unknown finish; metadata thiếu hashtags mới.
- [ ] Chạy từng regression trên baseline, ghi expected/actual và test đỏ thật. Nếu baseline đã chặn một case thì ghi regression bảo vệ hiện có, không sửa thêm vô ích.
- [ ] Inventory mọi vòng retry/discovery/credential failover/model hop và leases; ghi wire attempts thực tế, không chỉ wrapper calls.
- [ ] Đánh dấu C01–C60 trong scenario matrix là planned; gán test basename/case title và không đánh dấu test pass khi mới viết fixture.
- [ ] Reproduce cancellation với deferred provider/body reader, hai operation cùng source/different video và writer crash windows bằng fake clock/fault injection, không dùng sleep dài.

Exit: nguyên nhân code-confirmed được phân biệt với gap cần test; ít nhất các case envelope mất truncation, strict metadata và positional mapping có probe quyết định hành vi trước khi sửa.

## 4. P1 — Contract registry, parser và validator

Files mới dự kiến: `src/shared/aiOutput.ts` (types/schema/pure validation primitives), `tests/ai-output.test.ts`; files sửa: `src/shared/videoSeo.ts`, `src/main/translation/response.ts`, runner đăng ký test. Tên module có thể điều chỉnh theo convention hiện tại, trách nhiệm giữ nguyên.

- [ ] Định nghĩa task contracts/version và structured issue codes; không import Node/Electron/browser vào shared.
- [ ] Implement scanner có giới hạn byte/depth/candidate, quote/escape-aware; detect duplicate property sau giải mã key. Dùng parser phù hợp nếu repo đã có dependency; không viết regex thay JSON grammar.
- [ ] Strict root/schema validation, reject coercion/extra/missing/conflicting fields. Preserve string text; canonical object dựng từ field whitelist.
- [ ] Compatibility unwrap/extraction theo spec 4.4; lỗi outer object chưa đóng như ảnh phải reject.
- [ ] Tách strict AI metadata validator khỏi normalizer persisted legacy; giữ tags-to-hashtags migration cho state cũ.
- [ ] Thêm contamination checks có test true/false positive; giữ nội dung nói về JSON hoặc chứa ngoặc hợp lệ.
- [ ] Chuẩn hóa issue outcome đủ phân biệt clean/unwrapped/extracted/rejected và structural/quality confidence.
- [ ] Áp dụng concrete limits tại spec 4.12 trước parse/clone; source preflight, Unicode scalar validation và exact ID comparison. Reject prototype keys qua schema, không deep-merge raw objects.
- [ ] Contract versions + input/output identity updates đi cùng parser thay đổi; strict AI caller không được dùng legacy normalizer như fallback.

Exit: AC01, AC04, phần parser của AC07/AC09/AC18/AC20; C01–C10 có cả positive controls, pure tests qua runner, typecheck cả web/node.

## 5. P2 — Giữ envelope và bật schema đúng task

Files: `src/main/gemini.ts`, `src/main/openai.ts`, `src/main/localTranslate.ts`, `src/main/videoTitle.ts`, `src/shared/translation.ts`; bổ sung `tests/ai-output-provider-contract.test.ts` nếu không phù hợp suite hiện có.

- [ ] Introduce internal AiCompletionEnvelope và classifier finish reason/refusal/filter/unknown.
- [ ] Add structured completion API trả envelope; migrate SEO/title/summary sang API này. Giữ wrapper rephrase string/null cho caller cũ hoặc migrate có test riêng, không đổi âm thanh.
- [ ] Schema-specific request cho translation, SEO, summary và title; verify serialized wire payload bằng mock.
- [ ] Giữ HTTP/auth/rate-limit/network/timeout errors có loại; không nuốt hết thành null trước scheduler.
- [ ] Capability theo endpoint/model/task/schema revision; unknown không tự thành supported. Metadata compatibility vẫn yêu cầu JSON; translation compatibility giữ id-lines.
- [ ] Schema unsupported chỉ downgrade một lần với lỗi xác định; malformed JSON/refusal/429 không kích hoạt downgrade.
- [ ] Kiểm tra AbortSignal xuyên request/body-read/backoff; body limits áp dụng trước allocation lớn; giữ resource leases đúng vòng đời.
- [ ] Nếu cần gateway support: tạo work item ngoài repo với contract request schema, completion/refusal mapping và transport integration test. Không claim đã thực hiện từ client test.
- [ ] Tách incomplete transport khỏi unknown model finish; đúng candidate/final text part, không concatenate thoughts/tool/refusal/candidates. Giữ non-stream mặc định; unexpected SSE là protocol error.
- [ ] Client-generated operation/generation/attempt/source digest fence trước callback/merge; pin resolved model và capability evidence cho operation.
- [ ] Không trả local resource cho request tiếp theo khi server-stop unknown. Implement endpoint unavailable state và cancellation/status integration hẹp; không sửa global scheduler concurrency nếu không cần.
- [ ] Fault test Promise.race settles nhưng underlying provider/reader không settle; assert local active count không tăng, late callback bị bỏ và endpoint khác vẫn hoạt động.
- [ ] Phân biệt invalid schema config với unsupported feature; Retry-After hữu hạn, backoff abortable và không giữ lease khi đợi retry. Không tự thêm retry ẩn vào wrappers.

Exit: AC02, AC03, AC08, AC13/AC14/AC16/AC17 phần transport; C11–C20 và C31–C36 qua. Ghi bound wire attempts và hạn chế server cancellation khi không có status API.

## 6. P3 — Metadata/title/summary recovery và publication

Files: `src/main/videoTitle.ts`, `src/shared/videoSeo.ts`; tests video-title/video-seo/burn-video-title/autoshort-title-overlap/autoshort-video-title. Chỉ sửa burn/coordinator nếu test chứng minh gate cần bổ sung.

- [ ] Một operation function: completion → envelope gate → parse/schema → quality → một repair → terminal result.
- [ ] Repair toàn bộ metadata từ source và issue codes; không nối title từ attempt A với description attempt B.
- [ ] Summary part chỉ thay thế khi đã valid; kiểm tra phần cuối nguồn còn được đưa vào summary chain, không mất context do repair.
- [ ] Giữ title-only 120 và SEO title 100 code points; quá dài phải repair, không slice text.
- [ ] Fingerprint/count bảo đảm không-progress hoặc repair lần hai dừng. Downgrade/transport retry không reset content repair count.
- [ ] Cancel trước commit bỏ temp do owner tạo; cancel sau commit giữ final hợp lệ. Timeout có lỗi riêng; test cả provider phớt lờ AbortSignal, callback đến sau generation mới.
- [ ] Preserve title/titlePath/titleError/seoMetadata; sidecar đúng Description/Tags/Hashtags; no-overwrite và digest-match không suy yếu.
- [ ] Tăng SEO/title policy digest versions và gồm schema/parser identity. Không reuse prepared metadata cũ dưới policy mới.
- [ ] P3 spike: chọn primitive atomic + no-replace đã test ở filesystem mục tiêu; thêm `tests/ai-output-publication.test.ts` (đăng ký runner). Không dùng rename nếu chưa chứng minh no-replace; không direct-final-write fallback khi unsupported.
- [ ] Publisher nhận generation/cancel fence; temp→flush/close→validate→commit→receipt; serialize writer trên target. Crash recovery reconcile bằng manifest/hash, không xóa file không chứng minh ownership.
- [ ] Test short write, ENOSPC, EPERM/EACCES, target xuất hiện giữa chừng, parent junction đổi, video/digest đổi, crash trước/sau commit. Phân biệt process crash và power-loss qualification.
- [ ] Summary operations key theo round/part/chunk digest; coverage và rank phải giảm sau mỗi vòng. Repair không bỏ part; insufficient source có terminal outcome riêng.

Exit: AC01, AC08–AC11, AC13/AC15/AC17 phần metadata; C21–C25, C30, C37–C44 qua hoặc unsupported-filesystem outcome được chứng minh. Không bật publisher mới nếu spike chưa có primitive an toàn; giữ video + metadata error.

## 7. P4 — Translation identity và accepted/checkpoint state

Files: `src/main/translation/response.ts`, `orchestrator.ts`, `checkpoint.ts`, `fileRunner.ts`, `src/main/localTranslate.ts`, `src/shared/translation.ts`; tests response/orchestrator/identity/resume/local-translation/provider-contract.

- [ ] Strict path bỏ mapping theo itemIndex; request-defined alias mapping chỉ cho compatibility profile có version và bijection được kiểm tra.
- [ ] Numeric ID/reorder, duplicate JSON properties, duplicate cue IDs và t/text conflict không được sửa bằng đoán thứ tự.
- [ ] Move accepted-state mutation sau validation decision: chỉ full clean response hoặc missing-only subset không có lỗi khác. Không commit trước khi biết response có hard error.
- [ ] Unparsed/truncated/protocol-contaminated response không đóng góp accepted items; giữ tốt các guard đã có.
- [ ] Missing-only repair chứa đúng tập ID thiếu, giữ source-group/context; không hồi sinh context IDs thành output cues.
- [ ] Checkpoint lưu assessment rõ ràng; resume không nâng partial/untrusted thành complete. Invalid cache miss/revalidate, không xóa file cũ.
- [ ] Kiểm tra cả public wrappers và legacy local path còn dùng; không chỉ sửa orchestrator trong khi một caller bypass còn nhận lỗi.
- [ ] Preserve no-progress/split/format-repair và counters khi quota tổng tắt; singleton luôn có terminal path.
- [ ] Validate nested checkpoint plan/batches/mapping/counters/assessment với file-size bounds; corrupt JSON/deep/duplicate/future schema là recovery reason, I/O error không giả làm cache miss.
- [ ] Single writer + compare-and-swap/fencing theo item/generation cho callback và checkpoint; charge-before-dispatch, in-flight unknown sau crash, không reset counters ngầm.
- [ ] Recovery rank chứng minh missing subset nhỏ hơn, split rời nhau/không rỗng, một repair slot và quality repair không recursion. Reordered IDs hoặc changed text không reset rank.
- [ ] Version/schema/capability/model identity migration trong cùng commit thay đổi resume/acceptance; durable cache với unknown model revision không tự reuse qua phiên.

Exit: AC05, AC06, AC08/AC10, AC13/AC17/AC20; C22–C29, C31, C45–C50. Mock crash/resume chứng minh không giữ cue cuối bị cắt/response stale và không đổi source timestamp.

## 8. P5 — Prompt gọn và đánh giá nội dung

Files: `src/main/translation/prompts.ts`, planner.ts (chỉ token packing nếu cần), language.ts, sourceGroups.ts, assessment call sites trong orchestrator; test prompts/planner/multilingual/rephrase/qualification.

- [ ] Giảm metadata lặp theo spec 4.1, giữ stable unit IDs, source-group context, glossary và dubbing hint cần thiết.
- [ ] Chốt đúng một output grammar cho mỗi request; repair dùng chung contract version, không nhúng các ví dụ mâu thuẫn.
- [ ] Fixture cùng source trước/sau: count chars/tokens cùng phương pháp; đủ mọi cue và context, không làm xấu chất lượng để giảm token.
- [ ] Thêm assessment fixtures: đúng ID nhưng chuyển nghĩa sang cue lân cận, câu cụt, số/tên/phủ định, false-positive với source fragments và nội dung kỹ thuật.
- [ ] Ghi rõ check nào certain/heuristic/unknown. Chỉ dùng semantic verifier bổ sung nếu có metric/evidence; không biến schema pass thành semantic pass.
- [ ] Repair semantic một vòng có context; giữ warning policy hiện hành khi heuristic chưa giải quyết, không chặn tùy tiện mọi locale.
- [ ] Bump prompt/parser/assessment/planner version chỉ khi tương ứng thay đổi; cập nhật identity/digest và test cache invalidation cùng commit.
- [ ] Đo false positives/negatives trên positive controls: JSON tutorial, source fragments, Arabic/Indic/emoji, source=target locale, lặp từ có nghĩa, cách viết số tương đương. Không test toàn case lỗi.
- [ ] Chốt disposition bảng structural-error/quality-warning/quality-unknown; repair replacement không làm xấu deterministic protected checks. Không hứa semantic verifier phổ quát khi chưa có metric.
- [ ] Thử source/glossary/previous-output injection và ASR uncertainty; không đổi schema/path/ID/group policy theo nội dung.

Exit: AC05, AC07, AC10/AC19; C08–C10, C51–C56. Fixtures giữ ID/timestamp và source group; report semantic unknown nếu không có check, không giả vờ chứng minh chất lượng live.

## 9. P6 — Integration, diagnostics và qualification

- [ ] Diagnostics chỉ ghi field whitelist/hash/codes; debug raw capture opt-in, bounded 256 KiB/attempt và 4 MiB/item, containment/cleanup; test redaction và overflow marker.
- [ ] Integration từ provider mock đến output file/checkpoint: schema mode, compatibility, repair, cancel, crash/resume, metadata fail nhưng video còn nguyên.
- [ ] Update docs/domain.md mục metadata, docs/translation-budget-policy.md nếu có diễn giải recovery mới, docs/architecture.md nếu thêm module boundary. Thêm ADR có số chưa dùng cho contract/envelope/extraction policy khi implement.
- [ ] Review thay đổi bằng actual diff và AC traceability; không refactor module media ngoài scope.
- [ ] Chạy validation commands dưới đây; ghi tổng pass/fail, exit codes và giới hạn bằng chứng.
- [ ] Live qualification khi endpoint/model sẵn sàng: ít nhất một request thực mỗi task/profile được định claim support; ghi terminal reason/schema behavior và đối chiếu nội dung nguồn. Một success không đủ bảo đảm enforcement; cần bằng chứng capability và request path.
- [ ] Với local gateway, verify format forwarding và completion reason end-to-end; không dùng mock hoặc finish_reason=stop giả định làm proof.
- [ ] Ghi rõ client implementation done và gateway/live qualification pending nếu thực tế như vậy. Không package/install/deploy trong task viết spec/plan.
- [ ] Debug log/evidence failure không thay task outcome/trigger repair; redaction trước serialize; global reservation trong disk budget, metadata capture truncation tách model truncation.
- [ ] Rollback/capability drift: giữ namespace version đúng profile, không cache supported globally từ một error hoặc một sample đẹp. Record enforcement api-json-mode/prompt-only riêng.
- [ ] Qualification report gồm test count, seeds, edge corpus, success/repair/failure/unknown counts theo provider/task/model revision; một request chỉ là smoke test, không claim production error rate=0.
- [ ] Từng C01–C60 có link tới test case hoặc live/platform gate, command/log và trạng thái TEST_CONFIRMED/UNKNOWN. Scenario bị bỏ phải có lý do scope rõ ràng và AC vẫn có coverage khác.

Exit: AC01–AC20 có evidence tương ứng; C57–C60 và các compound cases qua ở phạm vi client; live/platform chưa có evidence ghi UNKNOWN và không enable claim tương ứng.

## 10. Ma trận regression bắt buộc

| Nhóm | Input/scenario | Expected | AC |
|---|---|---|---|
| JSON | Bare object đúng schema; escape quote/newline/Unicode | Accept, nội dung bảo toàn | 04 |
| Wrapper | Một fence hoàn chỉnh; một object trong prose theo compatibility | Unwrap/extract + full validate | 04 |
| Screenshot | Outer title chưa đóng, inner fence/JSON | Reject, regenerate; không publish raw title | 01 |
| Contamination | Escaped JSON nhét trong title dù root hợp lệ | Reject/repair có evidence | 07 |
| Ambiguity | Hai objects; một valid một wrong-schema; object + broken tail | Reject; không chọn “best candidate” | 04 |
| Parser | Duplicate keys kể cả Unicode-escaped key; deep/oversize body | Reject bounded; không hang hoặc silent overwrite | 04,12 |
| Schema | Missing hashtags mới, extra fields, null, string thay array | Repair; không coerce/legacy-fallback | 04,09 |
| Legacy | Persisted metadata thiếu hashtags hoặc malformed state | Migration/null recoverable; UI không crash | 09 |
| Content | Braces/JSON word trong video kỹ thuật hợp lệ | Không false reject chỉ do từ khóa/ngoặc | 07 |
| Completion | JSON valid + length/MAX_TOKENS; refusal/filter | Không accepted/publish/format-bypass | 03 |
| Completion | Missing/unknown finish, JSON đầy đủ | Profile policy; evidence unknown rõ ràng | 03 |
| Identity | IDs reordered, numeric unknown, duplicate, context echo | Map exact ID; lỗi không map vị trí; context không output | 05 |
| Partial | Chỉ thiếu ID so với response có duplicate/unparsed/truncated | Chỉ missing-only được persist subset | 06 |
| Resume | Crash sau partial, restart với parser/digest mới | Không nâng partial, không reuse sai version | 06,10 |
| Quality | Đúng JSON/ID nhưng lệch cue, câu cụt, sai số/phủ định | Assessment/repair; không claim semantic pass giả | 07 |
| Quality | Source fragment, cùng script, ngôn ngữ chưa hỗ trợ | Heuristic/unknown; không blanket hard reject | 07 |
| Recovery | Một repair thành công; lặp lỗi; singleton lỗi | Accepted hoặc terminal hữu hạn; counters đúng | 08 |
| Transport | 401/429/5xx/schema unsupported/cancel lúc read | Đúng class/retry/downgrade; không nhân vòng lặp | 02,08 |
| Output | Video valid + metadata fail/cancel/digest mismatch/existing sidecar | Video giữ nguyên; không ghi đè/ghi sai sidecar | 11 |
| Diagnostics | Secret trong request/error; raw vượt budget | Redact; bounded/omitted marker; cleanup | 12 |

## 11. Lệnh validation khi triển khai

Chạy ở root bằng PowerShell. Test mới phải đăng ký runner trước khi gọi; các basename dưới đây đã tồn tại tại baseline. Không chạy mọi suite media chỉ vì sửa parser; mở rộng khi diff hoặc test failure cho thấy cần.

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs video-seo.test video-title.test burn-video-title.test autoshort-title-overlap.test autoshort-video-title.test autoshort-ui-contract.test
node scripts/run-local-runtime-tests.mjs translation-response.test translation-prompts.test translation-provider-contract.test translation-transport.test translation-orchestrator.test translation-identity.test translation-resume.test local-translation.test
node scripts/run-local-runtime-tests.mjs translation-planner.test translation-language.test translation-multilingual.test translation-rephrase.test translation-budget.test translation-qualification.test
git diff --check
```

Khi thêm ai-output.test/ai-output-provider-contract.test, chạy hai suite này sau khi đăng ký runner. Build chỉ cần khi xác nhận tích hợp runtime cuối đợt implement; không claim deploy từ build. Ghi baseline failures riêng, giải quyết regression trong scope; không xóa/sửa test để che lỗi.

Suite mới dự kiến bổ sung sau review: `ai-output-publication.test`, `ai-output-lifecycle.test`, `ai-output-recovery.test`. Có thể gộp vào existing suite nếu cùng trách nhiệm; cập nhật matrix tên thực tế. Kiểm tra lifecycle/resource với `autoshort-resource-manager.test`, `autoshort-disk-budget.test`, `autoshort-item-scope.test` nếu sửa code tương ứng.

Property/model-based tests dùng seed cố định và in seed khi fail: reorder IDs, chunk boundaries, duplicate events, recovery state transitions và interrupt tại từng điểm persistence. Generator có positive valid corpus; không chỉ chứng minh parser từ chối random bytes. Fake-clock tests không thay platform tests của atomic commit hoặc live server stop.

## 12. Handoff và rollback

Mỗi task bàn giao: files/diff, AC được đáp ứng, lệnh/exit code/log, known failures và trạng thái live. Commit theo nhóm parser → transport → recovery → identity → prompts/quality để review dễ, không commit dirty work khác.

Nếu schema mode không tương thích, rollback profile về explicit compatibility đã qua validator; không rollback hard validation để nhận output lỗi. Nếu contract/version mới chưa ổn, dừng sử dụng artifact mới và giữ file cũ nguyên trạng; rollback code/version đồng bộ, không trộn parser cũ với cache identity mới.
