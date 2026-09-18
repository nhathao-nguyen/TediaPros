# Kế hoạch triển khai — VOICE-TEXT-20260916

- Ngày: 2026-09-16. Trạng thái: **PLANNING COMPLETE / BOUNDED IMPLEMENTATION VT01–VT06 VERIFIED LOCALLY**.
- [Tổng hợp session](../../../.ai/tasks/2026-09-16-voice-aware-translation-planning/SESSION_SUMMARY.md) · [Spec](../specs/2026-09-16-voice-aware-translation-and-output-design.md) · [Prompt/test seeds](../specs/2026-09-16-voice-aware-translation-prompts.md).
- Các module đã có trong dirty working tree được đối chiếu theo implementation handoff; thay đổi ngoài phạm vi vẫn là user work và không bị overwrite. Chưa coi live Gateway, provider thật, A/B hay release là hoàn thành.

> Implementation status: VT01–VT06 có bounded slice trong working tree (numeric gate, `cue-lines-v1` opt-in, shared voice measurements, AutoShort/Voice collection, bounded voice hints và typed UI summary). Xem [implementation handoff](../../../.ai/tasks/2026-09-16-voice-aware-translation-planning/IMPLEMENTATION_HANDOFF.md) để biết files và bằng chứng. VT07–VT10 vẫn mở.

## 1. Trình tự và các gate

| Giai đoạn | Công việc | Điều kiện kết thúc |
|---|---|---|
| G0: khóa baseline | VT00 | Snapshot/evidence và test tái hiện rõ ràng |
| G1: sửa lỗi chắc chắn | VT01 | Quantity positive/negative regressions pass; không tự gán semantic verified |
| G2: text output | VT02 → VT03 | Parser + hai phía Gateway/client + cache/completion contract pass, chỉ opt-in |
| G3: voice data | VT04 → VT05 | Hai luồng dùng cùng measurement service; identity/dedup/UI đúng |
| G4: dịch có hints | VT06 → VT07 | Prompt compact/hints có version/snapshot; measured-first và state safety giữ nguyên |
| G5: nghiệm thu | VT08 | A/B từng biến, content/audio và format gates đạt |
| G6: rollout | VT09 | Default-on/release chỉ khi đã được yêu cầu và nghiệm thu |
| G7: thử nghiệm sau | VT10 | Calibration sâu/selective review có gate riêng, không gộp vào MVP |

VT04 có thể bắt đầu sau VT00, độc lập với phần Gateway của VT03. Đây là quan hệ phụ thuộc công việc, không phải yêu cầu tự tạo subagent/task khác. Lượt hiện tại chỉ lập tài liệu.

### MVP và phần chưa đưa vào mặc định

MVP engineering: VT00–VT07. Điều này cho phép thử opt-in, **không đủ để công bố chất lượng tốt hơn**. Cần VT08 trước promotion. Không chờ predictor qualified mới sửa numeric bug hoặc parser; cold voice vẫn chạy được không numeric hints.

Giữ hai lượt dịch/review ở MVP. Một lượt + review theo rủi ro, unit-level output/caption alignment, multimodal evidence và provider Structured Outputs mới là các thay đổi riêng sau đánh giá.

## 2. Liên kết với roadmap cũ

| Roadmap `VI-DUB-20260915` | Trạng thái kế thừa | Phần plan này bổ sung |
|---|---|---|
| T01/T02 capability, 1M và output planning | Đã có core, exact counter/live qualification còn mở | VT03/VT06 tính payload đúng theo format mới, không làm lại capability 1M |
| T03/T04 source plan/budget | Đã có partition chung trong working tree | VT07 hồi quy, giữ source-only grouping hiện tại |
| T05 prompt/style | Builder v10 đang có | VT06 compact prompt và voice hint snapshot |
| T06 semantic evidence | Helper có, tích hợp/coverage còn hạn chế | VT01 quantity bug và consumer gates; không hứa verifier tổng quát |
| T07/T08 recovery/cache | Có measured rescue/journal/checkpoint; một số roadmap còn mở | VT03/VT07 version identity, acceptance và no-progress |
| T09/T10 benchmark/release | Chưa phải live/installed acceptance trong session này | VT08/VT09 tái dùng protocol và evidence levels |
| T11 predictor | Advisory, chưa calibration | VT04/VT05 dữ liệu sạch; VT10 qualification |
| T12/T13 candidates/media | Tùy chọn sau core | Giữ ngoài MVP, không tự thêm Gemini voice |

Không đánh dấu checkbox T00–T13 cũ hoàn thành chỉ vì một delta ở bảng trên đã xong. Source-anchored policy đang active ưu tiên hơn đề xuất boundary động chưa triển khai trong spec cũ.

## 3. Task cards

### VT00 — Chốt baseline và fixture tái lập

**Phụ thuộc:** không. **Ưu tiên:** P0.

**Files:** đọc source/tests hiện hữu; thêm evidence dưới task implementation mới, không sửa artifacts review cũ. Tái dùng `probe.ts`/`probe-results.json` của session.

- [ ] Kiểm tra AGENTS, nhánh/HEAD, dirty/untracked và hash các module đích; giữ mọi thay đổi không thuộc task.
- [ ] Chạy baseline typecheck và targeted suites; lưu stdout/tóm tắt kết quả có exit code.
- [ ] Tái hiện double-count, unit prefix/range, object/currency probes trước khi viết fix. Không gọi một assertion negative-control pass là bug đã sửa.
- [ ] Chuyển dữ liệu tối thiểu cần thiết thành fixtures trong repo; không để regression test phụ thuộc `C:/Users/PC/Downloads` hoặc profile cá nhân.
- [ ] Tách source thật, synthetic timeline, prompt-only example và audio thật; ghi nhãn đủ để tránh benchmark sai.

**Exit:** biết chính xác baseline fail/false-pass ở đâu; corpus regression portable; chưa gọi provider.

### VT01 — Quantity facts và numeric/source-repair QA

**Phụ thuộc:** VT00. **Ưu tiên:** P0.

**Files:** `src/main/autoShortContentQuality.ts`, `src/main/contentQuality/numerals.ts`; helper units mới chỉ nếu cần; consumers `translation/orchestrator.ts`, `dubbing/synthesis.ts`, `translation/semanticEvidence.ts`, `translation/qualityDecision.ts` theo phạm vi cần nối. Không đổi provider.

- [ ] Viết test đỏ cho `加入2勺盐。` → `Thêm 2 thìa muối.` và dạng `hai`, source có/không khoảng trắng.
- [ ] Sửa extraction theo span để không đếm cùng chữ số hai lần nhưng vẫn giữ hai occurrence thực sự.
- [ ] Thêm positive/negative unit boundaries: giây/g, món/m; range `2-3`/`2–3`; âm `-3`; decimal `39.6`/`39,6`; numeral/ordinal ngữ cảnh.
- [ ] Quantity equivalence có dimension/unit-system/evidence. Fixture PRC `10斤` ↔ `5 kg` hợp lệ; ambiguous `斤`/`cân` không tự hard-convert. `2`→`20` vẫn fail.
- [ ] Added currency/object swap/condition/order giữ evidence khác numeric match; unsupported analysis phải unverified/suspect, không “đã đúng nghĩa”.
- [ ] Nối verdict vào source-repair trước TTS; verified semantic error không được publish. Không tăng false hard reject bằng cách biến mọi warning thành error.
- [ ] Không thêm model call cho mọi cue; giữ review bình thường và recovery ownership.

**Tests existing:** `autoshort-content-quality.test`, `content-quality-numerals.test`, `translation-semantic-evidence.test`, `translation-rephrase.test`, `translation-orchestrator.test`, `dubbing-plan.test`.

**Exit:** ca đúng pass, ca chắc chắn sai fail, ambiguity đi review đúng scope; đánh giá confusion matrix trên positives/negatives; baseline audio/tempo không đổi. Universal semantic verifier vẫn ngoài claim.

### VT02 — Parser độc lập cho `cue-lines-v1`

**Phụ thuộc:** VT00. **Ưu tiên:** P0.

**Files đề xuất:** NEW `src/main/translation/labeledResponse.ts`, NEW `tests/translation-labeled-response.test.ts`; dùng types/validation canonical của `translation/response.ts`; đăng ký runner. Shared chỉ thêm pure types nếu IPC/consumer cần.

- [ ] Cài grammar đúng spec, errors typed, byte/text/count/Unicode bounds trước allocation lớn.
- [ ] Exact requested set, `/part-N` mapping; reject malformed whole response, không positional split/fuzzy ID/salvage.
- [ ] Chỉ normalize BOM/CRLF/envelope whitespace được cho phép. Text quotes/backslash giữ nguyên qua serializer.
- [ ] Preflight source ID không biểu diễn được; không lặng lẽ thay ID bằng số thứ tự.
- [ ] Không sửa `parseBatchRephraseResponse` hoặc nới JSON/title parser dùng chung.
- [ ] Viết unit/fuzz/property tests deterministic, exact coverage, canonical round-trip và limits.

**Test seed:** L01–L12 của prompt contract; additional empty expected set, duplicate source IDs, very long labels, malformed surrogate/control bytes.

**Exit:** parser thuần có result/error rõ, chưa đổi default adapter hoặc tạo network call. Hàm trả parsed text không đồng nghĩa completion đã pass; caller phải enforce.

### VT03 — Negotiate Gateway, nối adapter và version cache

**Phụ thuộc:** VT02; G1 trước bật thử pipeline mới. **Ưu tiên:** P0.

**TediaPros files:** `src/main/geminiGateway.ts`, `geminiGatewayPrompts.ts`, `geminiGatewayDraftCheckpoint.ts`, `translation/checkpoint.ts`, `translation/capabilitySnapshot.ts` nếu cần; `src/shared/translation.ts` theo contract hiện có.

**Gateway bên ngoài:** task riêng trong repo CreateMediaTool sau khi được phép. Các tài liệu cũ nhắc `internal/modules/openai/openai_service.go`, `openai_controller.go`, `structured_json.go`; **phải tìm và đọc file thực tế/AGENTS trước**, không coi đường dẫn lịch sử là code đã kiểm tra ở task này.

- [ ] Inventory capability/core-v2 reader để thêm field additive; client/server thống nhất unknown contract behavior và echoed contract.
- [ ] Gateway hỗ trợ text content bounded pass-through với metadata completion/route/attempts trung thực. Không áp JSON normalizer lên cue-lines.
- [ ] Client bỏ `response_format` chỉ khi selected mode là cue-lines đã negotiated; request body chuẩn vẫn JSON.
- [ ] Auto mode thiếu capability chọn JSON trước dispatch; explicit labeled thiếu capability fail 0 calls; không silent format retry.
- [ ] Bản dịch draft/review parse bằng output-specific adapter, sau đó cùng canonical/ID/quality pipeline hiện hữu.
- [ ] Bump output/parser/prompt/checkpoint identity; mode không khớp không reuse draft. Không xóa source/cache/accepted artifacts cũ.
- [ ] Giữ full source + internal source slices, observed model policy và truncated-to-scheduler. All IDs + missing terminal evidence vẫn reject.
- [ ] Xác nhận contract về retry owner, cancel/timeout, final item retry và errors; không thêm vòng retry ẩn ở client/Gateway.

**Tests existing:** `gemini-gateway-contract.test`, `gemini-gateway-draft-resume.test`, `gemini-gateway-long-context.test`, `gemini-gateway-prompts.test`, `translation-response.test`, `translation-resume.test`. **NEW:** fixtures text-output parity/capability trong suite tương ứng; Go tests theo repo Gateway thực tế.

**Exit:** offline happy path + failure matrix pass cả hai phía; opt-in-only. Chưa sửa được Gateway thì hoàn tất VT02/mock integration, giữ feature off và ghi dependency; không lách gate bằng xóa metadata checks.

### VT04 — Measurement service và profile provenance dùng chung

**Phụ thuộc:** VT00. **Ưu tiên:** P1; có thể làm độc lập Gateway.

**Files đề xuất:** existing `dubbing/durationPredictor.ts`, `profileStore.ts`; NEW Main service/store/types như `dubbing/voiceMeasurements.ts`; typed shared summary khi cần. Chốt tên sau inventory, không duplicate helper đang có.

- [ ] Chốt profile key theo provider/model/revision/voice/reference-content + transcript/options/locale/speed/feature/trim identity, loại secrets khỏi persisted endpoint identity.
- [ ] Version schema mới; read-only compatibility v2, không fake provenance/cold-to-qualified migration.
- [ ] Full synthesis text → versioned features; phonetic unknown/mixed-script có uncertainty. Không đổi nghĩa `words` v2 thành syllables.
- [ ] Audio probe/trim chuẩn trước DSP, valid duration >0 và completeness check. Header 0/missing không tạo training sample.
- [ ] Dedup cache/retry/bootstrap/rescue; tách observation count khỏi unique text/audio/source cluster.
- [ ] Atomic/concurrent-safe store, bounded retention, corruption recovery, cancellation; profile fail không làm mất audio hợp lệ đã tạo.
- [ ] Không copy WAV hàng loạt; không gửi reference/text samples ra ngoài để học profile. Thu dữ liệu từ lượt TTS người dùng đã yêu cầu, không synthesize calibration ngầm.

**Tests existing:** `dubbing-duration-profile.test`, `autoshort-tts-cache.test`. **NEW:** `voice-measurements.test` cho identity/dedup/migration/write races/invalid audio/retention; đăng ký runner.

**Exit:** service dùng sample hợp lệ, persistence được kiểm tra; lớn mẫu vẫn advisory nếu chưa held-out. Limits retention phải ghi vào contract và test trước bật collection.

### VT05 — Nối AutoShort/Voice và hiển thị summary

**Phụ thuộc:** VT04. **Ưu tiên:** P1.

**Files:** `src/main/autoshort.ts`, `tts.ts`, `edgeTts.ts`, IPC handlers ở `index.ts`, `src/shared/types.ts`, `src/preload/index.ts`, `src/renderer/src/components/Voice.tsx`; adapter audio hiện có dùng lại khi có thể.

- [ ] Hai entrypoint cùng ghi vào measurement service trong Main, không tạo training store riêng trong Renderer.
- [ ] Nhận full text trước display truncation; không backfill từ lịch sử 70 ký tự; clone display name đổi không tạo acoustic profile mới nếu identity không đổi.
- [ ] Với speed khác 1.0: bucket/loại khỏi baseline đúng spec; giữ setting người dùng, không tự đổi speed khi tạo giọng để thu số đo.
- [ ] Typed IPC summary: state, eligible sample count, rate đúng đơn vị/range, cập nhật gần nhất; thiếu dữ liệu hiện unavailable.
- [ ] Phân biệt duration audio và generation time. Lỗi ghi profile là warning có kiểm soát, không hủy audio thành công.
- [ ] UI listener cleanup, config compatibility, đường dẫn safe-contained; không rò reference path/key/raw samples vào telemetry mạng.

**Tests:** existing TTS/clone/Edge suites tìm bằng registry trước triển khai; `autoshort-tts-pipeline.test`, `autoshort-tts-cache.test`, `dubbing-duration-profile.test`; NEW IPC/service integration tests và UI test theo harness sẵn có.

**Exit:** một mock synthesis ở mỗi entrypoint tạo cùng loại sample; cache/retry không tăng eligible count; screenshots/manual UI chỉ chạy khi bước này thật sự triển khai. Chưa gọi provider thật nếu chưa thuộc scope được yêu cầu.

### VT06 — Compact prompt và voice hints có snapshot

**Phụ thuộc:** VT01, VT03; VT04 để có hint, cold path luôn hoạt động. **Ưu tiên:** P1.

**Files:** `geminiGatewayPrompts.ts`, `geminiGateway.ts`, `translation/prompts.ts` nếu shared rephrase metadata cần; `translation/requestBudget.ts`, `viStyleProfile.ts`, checkpoint identity consumers.

- [ ] Tách output mode khỏi content instructions để có đối chứng JSON/text cùng lời hướng dẫn.
- [ ] Xây builder từ prompt mẫu, giữ full ledger/source slices/requested IDs/plan budget, grounded ASR restoration và nghĩa vụ facts.
- [ ] Service xuất public hint tối thiểu; cold/stale/sai locale/NaN/0 bỏ numeric hint. Không gửi weights/reference/path/backend secrets.
- [ ] Freeze snapshot theo job; digest chỉ gồm dữ liệu ảnh hưởng prompt, không thay identity bởi timestamp quan sát không liên quan.
- [ ] Draft/review nhận cùng snapshot, review nhận cả candidate và kiểm tra lại output/context budget trên payload đã render thật.
- [ ] Hai lượt vẫn default; subtitle không dùng timing hints; không thêm pre-TTS compress call.
- [ ] Ghi versions và hints presence/state vào audit bounded. Không log lại full source mỗi UI event.

**Tests:** `gemini-gateway-prompts.test`, `gemini-gateway-long-context.test`, `gemini-gateway-draft-resume.test`, `speech-budget.test`, `dubbing-duration-profile.test`; NEW focused voice-hint snapshots nếu suite hiện tại không phù hợp.

**Exit:** prompt contract L13–L15 pass; byte/token accounting không bỏ candidate; giữ budgets ở source unit, không thêm word cap. Prompt tốt hơn chỉ được xác nhận ở VT08.

### VT07 — Hồi quy end-to-end state và measured-first

**Phụ thuộc:** VT01, VT03, VT05, VT06. **Ưu tiên:** P0 trước live/promotion.

**Files:** integration tests và thay đổi hẹp ở consumers nếu phát hiện lỗi; không refactor renderer/render ngoài scope.

- [ ] Gateway draft/review fail/length/unknown completion → 0 accepted partial/0 TTS cho bản dịch chưa final.
- [ ] Measured pass trước rephrase; candidate lặp/không cải thiện dừng; journal/cache reuse không nhân TTS hoặc profile samples.
- [ ] Identity thay đổi source/voice/ref/options/prompt/mode/hint/version invalidates đúng dependency; profile updates không làm job snapshot đang chạy bị đổi.
- [ ] Retry render/TTS dùng accepted translation; response stale/cancel không ghi đè revision mới.
- [ ] Budget/TTS partition, `/part-N` mapping, gap source khi retime, EOF, 1.80x/60%/20%, no-drop/no-crop giữ nguyên.
- [ ] Profile corrupted/store full không làm hỏng media đã có; checkpoint >cap không thay file cũ.
- [ ] Fault injection và full runtime/typecheck pass; liệt kê mọi skipped/platform-only test.

**Tests existing:** `dubbing-plan.test`, `dubbing-grouping.test`, `speech-unit-planner.test`, `dubbing-feedback-decision.test`, `autoshort-tts-pipeline.test`, `autoshort-tts-cache.test`, `autoshort-item-scope.test`, `translation-orchestrator.test`, `translation-resume.test`, Gateway suites. Chạy thêm time-map/media fixtures theo registry thực tế.

**Exit:** engineering-ready opt-in; không đồng nghĩa live quality/Windows installed-ready.

### VT08 — A/B format, prompt, hints và audio

**Phụ thuộc:** VT07 + corpus/voice/cost được phép. **Ưu tiên:** P1 trước default-on.

**Files:** mở rộng `scripts/evaluate-vietnamese-dubbing.mjs` và [evaluation hiện hữu](../../benchmarks/2026-09-15-vietnamese-duration-aware-translation-evaluation.md); evidence theo run ID; gold fixtures theo train/calibration/held-out split.

- [ ] Đăng ký protocol revision trước khi chạy; chốt primary metric, mẫu, stopping rule và non-inferiority gates. Không thay threshold sau nhìn held-out.
- [ ] F0/F1: format-only với cùng nội dung prompt và hai lượt. Đếm tất cả syntax/label/ID/completion failures, retries và latency, không chuyển lỗi JSON sang nhóm khác để báo giảm.
- [ ] P0/P1: compact prompt-only, hai lượt giữ nguyên; người đủ năng lực nguồn chấm omission/addition/actor/object/negation/number/unit/order.
- [ ] V0/V1: voice-hints-only; cold/advisory/qualified báo riêng, cùng model quan sát được/voice/options. Không dùng 120 mẫu giả định trong prompt làm voice thật.
- [ ] Nghe blind tiếng Việt; fit@1.10/1.25/1.80 trên audio thật, first-pass trước rescue, rephrase count, generated seconds, tempo distribution, extension/replay, latency/cost.
- [ ] Randomize thứ tự chạy; báo model-route confound, cancel/fail và sample exclusions. Không chỉ chọn video thành công.
- [ ] Gate không đạt hoặc CI quá rộng → giữ opt-in, chỉ ra task cần cải thiện; không tự tăng retry/cap/tempo.

**Exit:** báo cáo paired evidence đủ cho từng feature. Công bố chỉ phạm vi voice/corpus/route đã test. Không gọi “mọi voice đều có profile chính xác”.

### VT09 — Rollout/rollback và bàn giao

**Phụ thuộc:** VT08; release/install chỉ khi người dùng yêu cầu. **Ưu tiên:** P1.

- [ ] Feature config versioned cho job mới; snapshot công việc đang chạy giữ nguyên.
- [ ] Gateway deploy trước client khi cần capability; xác minh process/binary/port/version, không restart server/job ngoài scope.
- [ ] Cập nhật architecture/domain/ADR khi code thật thay đổi, không sửa tài liệu lịch sử thành như đã triển khai từ đầu.
- [ ] Typecheck/full tests và package verification đúng scripts hiện tại; nếu cài app thì xác minh packaged/installed hashes riêng.
- [ ] Rollback chỉ tắt feature/namespaces cho job mới, giữ accepted output/profile/source/checkpoints; không hạ safety gates.
- [ ] Handoff theo task template với CODE/LOCAL TEST/LIVE/PACKAGED/INSTALLED status, biết điều gì chưa kiểm tra.

**Exit:** release status trung thực và cách quay lui đã thử phù hợp scope; không tự commit/push/install vì plan có dòng này.

### VT10 — Sau MVP: calibration và selective review

**Phụ thuộc:** dữ liệu VT04/VT05 + kết quả VT08. **Ưu tiên:** P2.

- [ ] Held-out per voice/backend/reference; dedup theo text/source family; dùng `G-PREDICTOR` của evaluation (ngưỡng đề xuất, không tự đánh dấu đạt).
- [ ] So MAE/P90/coverage và interval width; sample count/residual train không nâng confidence.
- [ ] Selective review chỉ khi risk triggers/verifier đã qualified. Shadow risk routing không bỏ lượt review thật, không tạo thêm model call.
- [ ] Risk triggers gồm ASR ambiguity, quantity/unit/entity/negation/relations, uncertain evidence; lúc opt-in phải có đường xử lý unknown và sample audit unflagged cues.
- [ ] Benchmark R0/R1 cùng output/prompt/voice; đo reviewer missed/new errors, không dùng số cue sửa để chứng minh hữu ích/vô ích.
- [ ] Chỉ đề xuất thay default nếu non-inferiority nghĩa/audio và lợi ích request/latency đủ; fail thì giữ hai lượt.

Unit-level output/caption alignment, multimodal upload, official Gemini API Structured Outputs và context cache vẫn là đề xuất riêng cần spec/capability/authority tương ứng, không chen vào VT10 như mặc định.

## 4. Ma trận truy vết ngắn

| Requirement | Tasks | Gate/test chính |
|---|---|---|
| ID/timing immutable, full source và internal slices | VT02/03/06/07 | L01/L04/L08; Gateway/translation-resume/source-plan tests |
| Sửa numeric false reject, unit/range | VT01 | CJK spacing/double occurrence/negative values/equivalence matrix |
| Chống JSON model syntax lỗi mà giữ completion | VT02/03 | L02–L12; terminal evidence/truncation/retry fixtures |
| Profile riêng đúng acoustic identity | VT04/05 | Model/ref/options/speed/locale/version migration/dedup |
| Hints tối thiểu/advisory/frozen | VT06/07 | L14/L15; privacy/schema/cache tests |
| Measured-first và trần vật lý | VT07/08 | Mock order + media/audio measured tests, no crop/drop |
| Giữ quotas override/cancel/no-progress | VT03/07 | Budget/retry/journal/cancel regression |
| Không tuyên bố prompt/format tốt hơn trước benchmark | VT08 | Paired F/P/V experiment và CI |
| Không bỏ review sớm | VT06/10 | Default-two-pass test; R0/R1 gate riêng |
| Privacy/IPC/disk/rollback | VT04/05/07/09 | Bounded store, typed API, artifact preservation |

## 5. Các lệnh kiểm tra dự kiến

Chạy từ repo root. Danh sách dưới là hướng dẫn thực thi tương lai, **không phải bằng chứng rằng tính năng đề xuất đã pass**. Suite NEW phải đăng ký runner trước; kiểm tra lại suite names khi triển khai.

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-content-quality.test content-quality-numerals.test translation-semantic-evidence.test translation-rephrase.test
node scripts/run-local-runtime-tests.mjs gemini-gateway-prompts.test gemini-gateway-contract.test gemini-gateway-draft-resume.test gemini-gateway-long-context.test translation-response.test
node scripts/run-local-runtime-tests.mjs dubbing-duration-profile.test speech-unit-planner.test speech-budget.test dubbing-feedback-decision.test
node scripts/run-local-runtime-tests.mjs autoshort-tts-pipeline.test autoshort-tts-cache.test dubbing-plan.test dubbing-grouping.test translation-orchestrator.test translation-resume.test
npm.cmd run test:local-runtime
```

Vòng từng task: đọc instructions → baseline/failing regression → sửa seam nhỏ + consumer → targeted tests/typecheck → diff/self-review → cập nhật handoff. Không dùng tăng retries, xóa cache toàn bộ hay chạy video nhiều lần thay unit regression.

## 6. Những điểm phải dừng xin thêm lựa chọn

- Cần sửa/chạy Gateway repo hoặc service chưa nằm trong scope được giao.
- Cần gọi live benchmark có chi phí/đưa corpus/reference/media ra dịch vụ ngoài mà chưa được cho phép.
- Cần đổi provider, policy model, trần tempo/extension hoặc quota tổng.
- Cần cài/restart bản app đang xử lý công việc của người dùng.
- Cần publish/commit/push hoặc sửa dữ liệu người dùng ngoài artifacts task.

Không dùng các điểm này để trì hoãn test/parser/service offline đã nằm trong yêu cầu triển khai sau này. Ở lượt hiện tại, tất cả task implementation còn mở; sản phẩm bàn giao là bộ tài liệu.
