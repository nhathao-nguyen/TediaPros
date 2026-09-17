# Kế hoạch triển khai: dịch Việt theo thời lượng + Gemini Gateway context 1M

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Người dùng chọn cách thực thi; tài liệu này không tự khởi động agent hoặc triển khai.

**Goal:** Tăng chất lượng dịch và nhịp đọc tiếng Việt bằng context Gateway 1M, budget nhóm thoại và feedback WAV, giữ nguyên hệ TTS.

**Architecture:** Mở rộng pipeline Electron Main hiện hữu, một frozen SpeechUnitPlan dùng xuyên dịch/review/TTS. Gateway hiểu toàn nguồn nhưng có thể chia tập ID đầu ra; code kiểm tra ngữ nghĩa/cấu trúc, đo audio và giữ checkpoint theo revision.

**Tech Stack:** TypeScript, Electron/React, Node test/esbuild runner, FFmpeg/FFprobe, Gemini Gateway text, Local/Edge TTS hiện có; không thêm speech model/service mới.

**Spec:** [Đặc tả đã tổng hợp](../specs/2026-09-15-vietnamese-duration-aware-translation-design.md). Đọc cả [hợp đồng thực thi và test seed](../specs/2026-09-15-vietnamese-duration-aware-translation-contracts.md) trước từng task.

## Global Constraints

- Không Gemini TTS/Live; chỉ giữ `local-tts` và `edge-tts`, voice/model/options đã chọn.
- Gateway context 1M là requirement chính: floor `1_000_000`, số exact `1_048_576` chỉ khi contract nêu rõ; output limit tách riêng.
- Trần tempo `1.80x`, preferred `1.10x`, normal `1.25x`; extension `60%` mỗi đoạn, slowdown part `20%`; không nới cap.
- Source ledger immutable; gap policy theo nguồn và EOF guard `0.12s`; không drop/crop lời hoặc padding che vi phạm.
- Không bật lại quota dịch tổng; giữ cancellation, no-progress, finite recovery state và retry ownership.
- Windows 10/11 x64 là gate cài đặt; giữ typed IPC/isomorphic shared, safe paths, disk scope, license và dirty work ngoài task.

- Ngày: 2026-09-15. Mã: `VI-DUB-20260915`.
- Trạng thái: **PLANNED — các checkbox triển khai chưa hoàn thành**. Việc tạo tài liệu không phải phê duyệt chạy live, sửa repo khác, cài đặt hay phát hành.
- [Spec nguồn](../specs/2026-09-15-vietnamese-duration-aware-translation-design.md); [ma trận nghiệm thu](../../benchmarks/2026-09-15-vietnamese-duration-aware-translation-evaluation.md).
- Quyết định đã chốt: **không Gemini TTS**; **Gateway 1M nằm trong core**, không phải lựa chọn phụ thuộc một nghiên cứu khả thi mới.

### Cập nhật thực thi ngày 2026-09-15

Core slice đã được triển khai trực tiếp và có regression offline: phần capacity/output/full-source của T01--T02, source speech plan/budget của T03--T04, profile prompt Việt v1 của T05, negative controls và evidence/decision helper hẹp của T06, hardening source-repair cùng replay guard in-memory theo job/item của T07 và evaluator offline của T09. Chi tiết file, lệnh và ranh giới bằng chứng ở [VI-DUB-20260915-CORE](../../../.ai/tasks/2026-09-15-vietnamese-duration-aware-translation-core/TASK.md).

Các checkbox bên dưới vẫn là tracker cho **toàn bộ** task/gate, không được hiểu là tất cả T01--T09 đã đóng. Đặc biệt còn thiếu counter exact/qualified, producer/persistence cho semantic decision, corpus/report/human-live qualification, full feedback semantic ranking/quality repair, release và các phase còn lại T07--T13.

## 1. Nguyên tắc thực thi

Đọc AGENTS root/Main/dubbing/shared/renderer theo phạm vi từng task. Bảo vệ dirty/untracked hiện tại; không git add toàn repo, stash-all, reset/clean, tự merge/push hoặc dừng queue đang chạy. Các path dưới đây tương đối với `F:/Son/tool/TediaPros`, trừ khi nêu rõ khác. Path mang nhãn NEW là đề xuất, không khẳng định đã tồn tại.

Giữ Local/Edge TTS và cấu hình giọng; không tự sửa CreateMediaTool. Nếu cần mở rộng contract Gateway, viết change request có schema và acceptance fixture, chỉ sửa repo đó khi được đưa vào phạm vi triển khai. Không vì vậy trì hoãn client khai báo 1M đã được người dùng xác nhận.

Mỗi task: viết test đúng hành vi mong muốn → thay đổi khu trú → chạy test/typecheck → review diff → cập nhật docs/evidence. Không copy assertion baseline “semantic false negative phải pass” thành regression mới. Không yêu cầu skill chưa cài hoặc agent riêng để thực thi kế hoạch.

## 2. Giai đoạn, dependency và giá trị giao được

| Gate | Task | Kết quả | Điều kiện mở gate |
|---|---|---|---|
| G0 | T00 | Baseline tái lập, corpus/rubric/metrics đăng ký trước | Phân biệt code/offline/live; snapshot dirty source |
| G1 | T01–T02 | Gateway 1M, đúng token accounting, output-aware batches | Payload draft/review và ID coverage pass; không cap legacy |
| G2 | T03–T04 | Shared SpeechUnitPlan và budget nhóm thật | Không lệch grouping/budget/TTS, không regress gap/EOF |
| G3 | T05–T06 | Văn phong Việt, kiểm tra nghĩa, hai lượt tích hợp | Cả negative và positive controls pass; wire được version |
| G4 | T07–T08 | Recovery, accepted state, cache/resume và telemetry | Cancel/restart/rerun không mất nghĩa, lặp vô hạn hoặc regenerate thừa |
| G5 | T09 | Core qualified trên video thật cùng TTS hiện tại | Đạt rubric/metrics đã chốt, không chỉ test code |
| G6 | T10 | Build/WinLocal có rollback | G5 + người dùng yêu cầu release/cài đặt |
| G7 | T11–T12 | Predictor calibrated và candidate optimization | Voice-specific held-out evidence; opt-in trước khi default |
| G8 | T13 | Context caching/hiểu nguồn media tùy chọn | Capability, quyền gửi dữ liệu và benchmark riêng |

Đường găng core: G0 → G1/G2 → G3 → G4 → G5 → G6. T01–T02 và T03–T04 có thể làm độc lập sau contract skeleton T01, nhưng phải tích hợp trước prompt T05. Đây là dependency kỹ thuật, không phải chỉ thị tự tạo subagent.

G7/G8 có thể giao sau core; vẫn nằm trong roadmap cải tiến session, không làm phình lần release đầu. Không ước lượng ngày cố định trước G0 vì hiện có nhiều thay đổi local và live qualification phụ thuộc provider/người chấm. Sizing tương đối: T00/T01/T05/T10 = M; T02/T03/T04/T06/T07/T08/T09/T11/T12 = L; T13 = spike rồi estimate lại.

## 3. Backlog theo task

### T00 — Khóa baseline, fixture và tiêu chí

**Files:** `.ai/tasks/2026-09-15-vietnamese-translation-design-review/` (READ ONLY lịch sử); NEW `tests/fixtures/vietnamese-duration-aware/`; tài liệu nghiệm thu; artifact mới theo run ID.

- [ ] Snapshot HEAD, dirty relevant hashes, package/Node/FFmpeg versions, source/prompt/schema/policy versions; không đưa secrets vào snapshot.
- [ ] Thu corpus theo EVAL: phân biệt timestamps thật và synthetic; bảo toàn exact source ledger, audio/provider config.
- [ ] Tạo negative controls đúng nghĩa sai/đúng; thêm source-fragment, 7-cue Gateway sentence, EOF, cue-70 retime-gap và sparse resume.
- [ ] Đăng ký metric chính/threshold, split theo video, người chấm và script đo trước khi xem kết quả candidate.
- [ ] Chạy baseline text-only offline; chỉ generation/TTS thật sau yêu cầu thực thi benchmark.

**Exit:** baseline tái lập với scope bằng chứng, không dùng video/timestamps synthetic để chứng minh duration. Chưa thay thuật toán.

### T01 — Contract nội bộ và capability Gateway 1M

**Files:** MODIFY `src/shared/translation.ts`, `src/main/translation/planner.ts`, `src/main/geminiGateway.ts`; NEW `src/shared/speechUnitPlan.ts`, `src/main/translation/capabilitySnapshot.ts`; tests contract.

- [ ] Định nghĩa types SpeechUnitPlan/budget/verdict/requestedIds/read-only context và capability snapshot isomorphic.
- [ ] Gateway có `contextWindowTokens=1_000_000` làm floor đã được người dùng xác nhận; dùng số exact lớn hơn nếu server contract nêu rõ. Không `null`/Infinity hoặc fallback về cap legacy.
- [ ] Tách input-only/combined và output limit; mặc định kế toán combined bảo thủ khi semantics chưa được công bố, không suy ra output 1M.
- [ ] Giữ wire alias `gemini-advanced` và policy chấp nhận observed text model; không bật lại require-verified-3.1-Pro.
- [ ] Snapshot route/capability/counter theo request, kiểm tra finite positive bounds; capability mismatch phát lỗi cấu hình, không tự đổi model/provider.
- [ ] Thêm migration đọc config cũ; chưa có field mới vẫn đi legacy, không làm mất queue đã lưu.

**Tests:** extend `gemini-gateway-contract.test`, `translation-planner.test`; NEW `translation-capability-snapshot.test` (đăng ký runner).

**Exit:** test 1M là requirement thực thi, không chỉ một giá trị hiển thị UI. Không yêu cầu Gateway generation để đọc capability.

### T02 — Token accounting đúng stage và output-aware planning

**Files:** MODIFY `src/main/translation/planner.ts`, `src/main/translation/context.ts`, `src/main/geminiGateway.ts`, `src/main/geminiGatewayPrompts.ts`; NEW `src/main/translation/requestBudget.ts`; Gateway draft checkpoint tests.

- [ ] Adapter render/count contract dùng đúng representation dispatch; preflight lượt review chứa draft thật, plan, glossary/style và findings.
- [ ] Tách globalSourceContext khỏi requestedIds; batch chia output giữ source toàn video read-only nếu còn vừa input 1M.
- [ ] Dự báo output theo locale/schema/ID count; khi không vừa chỉ chia target set, không thay nhóm thoại.
- [ ] Token counter exact hoặc qualified estimate có version/provenance; loại cách coi UTF-8 bytes là số token chính xác. Near-limit chưa có counter qualified thì trạng thái rõ, không giả kiểm chứng.
- [ ] Dùng prefix memoization/index Maps để tránh O(n²) lookup/count/serialize toàn video; exact preflight cuối vẫn bắt buộc. Không block UI/cancel bằng khối tính toán dài.
- [ ] Kiểm tra request byte caps, parser limits và audit volume cùng token cap; không tăng mọi reader toàn hệ thống.
- [ ] Review bị quá input: giữ source, giảm candidate/context phụ theo role; chia requestedIds. Nguồn thật >1M chuyển scene/chapter planning có evidence, không drop nguồn.
- [ ] Truncated/partial/duplicate output không được accepted; repair/split chỉ phần chưa accepted theo policy progress hiện có.

**Tests:** NEW `gemini-gateway-long-context.test`, `translation-request-budget.test`; extend `translation-planner.test`, `gemini-gateway-draft-resume.test`, `gemini-gateway-prompts.test`.

**Exit:** boundary 1M−1/1M/1M+1 theo counter fixture; input 800k nhưng output 30k với cap 16.384 phải chia output đúng; không thêm generation khi chỉ count/cache metadata. Live near-limit là gate riêng trong T09.

### T03 — Shared SpeechUnitPlan và boundary revisions

**Files:** MODIFY `src/main/sourceSpeechGrouping.ts`, `src/main/translation/sourceGroups.ts`, `src/main/dubbing/plan.ts`; NEW `src/main/translation/speechUnitPlanner.ts`; shared type T01.

- [ ] Bao existing DP bằng contract có sourceDigest/planDigest, member IDs, boundary reasons và immutable source ledger.
- [ ] Provisional source plan → draft punctuation proposals → code-validated frozen plan. Giữ reviewed Gateway profile 7-cue hợp lệ và source-only regressions.
- [ ] Chặn speaker/pause/cut seams; thêm soft penalty fragment/mệnh đề, không dùng LLM proposal để vượt hard edge.
- [ ] TTS nhận frozen plan, không gọi lại regroup từ dấu câu đã đổi sau review.
- [ ] Boundary conflict/revision có monotonic ID, scope chưa finalize, cache invalidation closure; no-progress dựa trên hash và issue state.
- [ ] Giữ long-cue internal mapping, không đổi timestamp nguồn để hợp thức hóa grouping.

**Tests:** extend `dubbing-grouping.test`, `translation-planner.test`; NEW `speech-unit-plan.test` và property tests coverage/contiguity/determinism. Source-group assertions hiện nằm trong `translation-planner.test.ts`, không có suite đăng ký tên `translation-source-grouping.test`.

**Exit:** cùng một plan digest dùng ở review/budget/TTS; hai hệ boundary hiện tại được bảo tồn có kiểm soát, không quay lại chia mảnh nguồn một cách máy móc.

### T04 — Budget nhóm và policy thời gian

**Files:** MODIFY `src/main/translation/prompts.ts`, `src/main/dubbing/translation.ts`, `src/main/autoshort.ts`, `src/main/dubbing/timeMap.ts` chỉ khi cần adapter; NEW `src/main/translation/speechBudget.ts`.

- [ ] Budget dùng frozen group windows từ hàm policy hiện hữu; target 1,10, normal 1,25 và hard 1,80 lấy từ policy snapshot, không hardcode rải rác.
- [ ] Không tổng budget fragments; không trừ protected gap lặp; không cộng trước 60% extension.
- [ ] Giữ effective gap đã chọn trên source sau retime; early start chỉ khi verified silence và mode cho phép.
- [ ] Materialize budget một lần mỗi revision; predictor update không đổi request đang dispatch.
- [ ] Prompt `subtitle` không chứa speech budget. Word hint chỉ advisory có nhãn unit/uncertainty.

**Tests:** NEW `speech-budget.test`; extend `translation-prompts.test`, `dubbing-plan.test`, `dubbing-grouping.test`.

**Exit:** fixture 3 vs 5,5 giây được thống nhất theo nhóm; cue-70 giữ gap 0,09 giây sau retime; EOF không trừ 0,50 lần nữa; không tăng tempo/extension caps.

### T05 — Prompt hai lượt và hồ sơ văn phong Việt

**Files:** MODIFY `src/main/geminiGatewayPrompts.ts`, `src/main/translation/prompts.ts`; NEW `src/main/translation/viStyleProfile.ts`, `tests/fixtures/vietnamese-style/`; draft identity modules.

- [ ] Draft đọc global source, provisional budget và selected examples; review đọc frozen plan/budget, source và draft.
- [ ] Profile Việt neutral + domain tags + glossary thống nhất; 20–30 ví dụ nguồn/đích do người Việt duyệt, chọn 2–3 theo tag.
- [ ] Giữ từ mang ý điều kiện/phủ định/modality; không xóa CTA nguồn, không thêm hook/đơn vị tiền hoặc brand.
- [ ] Reviewer giữ câu đã tốt; kiểm tra đầu/cuối video và liên kết qua batch, không rewrite mọi câu để tạo khác biệt.
- [ ] Bump prompt/style/schema identity đúng phạm vi. V1 vẫn keyed translations, không nhét findings/candidates vào schema cũ.

**Tests:** extend `gemini-gateway-prompts.test`, `translation-prompts.test`; NEW `vietnamese-style-profile.test`.

**Exit:** unit tests chứng minh payload/contract; chỉ T09 chứng minh lời dịch tự nhiên hơn. Profile không chứa gold held-out leakage.

### T06 — Semantic verifier nhiều mức, không false confidence

**Files:** MODIFY `src/main/autoShortContentQuality.ts`, `src/main/translation/orchestrator.ts`; NEW `src/main/translation/semanticEvidence.ts`, `src/main/translation/qualityDecision.ts`; shared verdict types.

- [ ] Phân `protocolValid`, semantic reviewed/suspect/failed và measured timing.
- [ ] Tách same-language rephrase guard khỏi cross-language verification; anchors/relations kèm source span và evidence provenance.
- [ ] Negative controls và positive paraphrases trước khi nâng finding thành hard fail; heuristic chưa qualified chỉ warning.
- [ ] Xử lý object swap, action order, actor swap, condition/modality và số–đơn vị; reviewer vẫn kiểm tra ý mà event extractor bỏ sót.
- [ ] Preserve accepted candidate khi reviewer hỏng; không cho fluency score bù sai nghĩa. Unresolved suspect có decision path, không loop.
- [ ] Nếu cần structured findings từ provider: thêm schema version mới, contract/parser/test trước, capability negotiation; legacy còn hoạt động.

**Tests:** extend `autoshort-content-quality.test`, `translation-orchestrator.test`, `translation-rephrase.test`; NEW `translation-semantic-evidence.test`.

**Exit:** hai false negatives đã nêu không còn bị coi là “đã xác minh đủ ý”; các paraphrase tốt không bị hard reject hàng loạt; đo precision/false-reject trong EVAL.

### T07 — Nối measured feedback và phục hồi có chọn lọc

**Files:** MODIFY `src/main/dubbing/synthesis.ts`, `src/main/autoshort.ts`, `src/main/translation/orchestrator.ts`, `src/main/geminiGateway.ts`; NEW decision helpers nếu cần.

- [ ] Giữ TTS hiện tại ở đường generate/clone đã có; chỉ thay text đã được chấp nhận và metadata nội bộ, không gửi Gemini voice request.
- [ ] Overflow queue chứa source/current text, exact IDs, measured seconds, frozen budget và semantic findings; Gateway batch tối đa 8 cue hiện có.
- [ ] Candidate ưu tiên đúng nghĩa/naturalness, rồi duration; tối đa ba lựa chọn theo recovery contract, không generate ba bản cho mọi nhóm.
- [ ] Candidate lặp hash/không cải thiện/cancel có stop reason; giữ bản measured-fit trước đó khi quality attempt thất bại.
- [ ] Tách audio bất thường/provider outage khỏi lỗi bản dịch. Không sửa câu để che TTS lặp âm/hallucination.
- [ ] Regression riêng cho extension on/off, rephrase/split/reflow order và cuối batch retry; giữ final WAV gate, không cut/pad giả.

**Tests:** `autoshort-tts-pipeline.test`, `dubbing-plan.test`, `translation-rephrase.test`, `gemini-gateway-contract.test` và NEW `dubbing-feedback-decision.test`.

**Exit:** không có generation ngoài lý do được audit; total quota vẫn tắt; no-progress/recovery hữu hạn theo state; token accounting bao gồm rephrase context.

**Slice triển khai 2026-09-15:** candidate rescue hiện có hash canonical theo source speech-unit/text/model/voice/options, journal in-memory theo job/item và claim trước TTS. Test offline bao gồm retry cùng journal, cancel, key-order stability và failed outcome. Các checkbox toàn task vẫn mở vì semantic ranking/quality repair, durable state, provider/live qualification và các regression mở rộng chưa hoàn tất.

### T08 — Cache/resume, observability và UI tối thiểu

**Files:** MODIFY `src/main/geminiGatewayDraftCheckpoint.ts`, `src/main/translation/checkpoint.ts`, `src/main/translation/fileRunner.ts`, `src/main/dubbing/cache.ts`, `src/main/dubbing/profileStore.ts`, `src/main/autoShortItemCoordinator.ts`, `src/shared/types.ts`, `src/preload/index.ts`, `src/renderer/src/components/AutoShort.tsx`.

- [ ] Mở `src/main/translation/checkpoint.ts`; mở rộng identity chứa source/cut/style/prompt/plan/budget/capability policy snapshot, giữ reader schema cũ theo migration gate.
- [ ] Atomic accepted revision + draft checkpoint; stale response không ghi vào revision mới; cancel không publish partial.
- [ ] Retry TTS/render dùng translation đã accepted nếu identity còn khớp; không chạy lại hai lượt Gemini.
- [ ] Namespace/migration kế hoạch mới, không xóa checkpoint cũ; resume partial giữ global context cả các ID đã dịch.
- [ ] Telemetry theo spec R14; 1M input không nhân bản trong event/IPC. Byte/token/cost unknown không hiện 0; raw logs opt-in, redacted và có disk bound.
- [ ] UI chỉ thêm tiến độ và details theo typed IPC, listener cleanup; config cũ giữ compatibility. Không thêm lựa chọn Gemini voice.
- [ ] Feature rollout `legacy|shadow|enabled` có version; shadow không gọi model/TTS thêm hoặc sửa output.

**Tests:** checkpoint/resume/cache/IPC suites hiện có sau inventory; `gemini-gateway-draft-resume.test`, `autoshort-tts-cache.test`, `translation-orchestrator.test`; NEW `translation-policy-migration.test`.

**Exit:** crash/cancel/route change/cache TTL/source edit đều có expected state; rollback flag không phá dữ liệu; không ghi secret vào fixture.

### T09 — Đánh giá core và qualification Gateway 1M

**Files:** NEW scripts benchmark dưới `scripts/` sau khi được triển khai; fixture/evidence theo run ID, tài liệu EVAL.

- [ ] Chạy hết tests offline, typecheck và full local-runtime sau tích hợp; giữ kết quả baseline và mới riêng.
- [ ] Live long-context: dùng dữ liệu synthetic không nhạy cảm, actual token counter, khóa output nhỏ có coverage checks; near-limit và exceeds-limit theo contract. Không dùng 1M input thành công để suy ra model dịch đúng cả triệu token.
- [ ] Live media: dùng đúng Local/Edge voice/options đang chọn, nguồn và timeline thật; A/B paired, native blind listening và source-competent semantic review.
- [ ] Báo đúng mọi failure/cancel/truncation, không bỏ video khó để cải thiện metric. Tách style, budget, predictor trong ablation.
- [ ] Đạt gate mới đề xuất default-on; kết quả chưa đủ thống kê giữ opt-in/shadow, không đổi ngưỡng sau khi xem test.

**Exit:** báo cáo quality/timing/cost và CI; biết giới hạn/bucket chưa qualified. Không gọi live nếu mới chỉ được yêu cầu lập specs/planning.

### T10 — Release/WinLocal sau nghiệm thu

**Files:** docs architecture/domain/ADR 005/budget policy và handoff; release manifests chỉ khi thay đổi được yêu cầu.

- [ ] Update tài liệu hiện hành khi code thật được merge; không sửa lịch sử cũ thành “đã có” ở giai đoạn spec.
- [ ] Inventory queue đang chạy, git dirty, packaged/installed version, rollback artifact; không tắt job của người dùng.
- [ ] `npm.cmd run typecheck`, full runtime, relevant media smoke, `npm.cmd run package:win`, `npm.cmd run release:verify-assets` theo scripts tại thời điểm release.
- [ ] Sau yêu cầu cài: lưu rollback, cài scoped, đối chiếu app.asar SHA-256, khởi động và kiểm tra đường code active/provider/voice/feature version.
- [ ] Windows smoke cancel/resume, một video đã qualified và một lỗi có chủ đích; giữ thành phẩm cũ. Không push hoặc publish mạng ngoài yêu cầu.

**Exit:** phân biệt SOURCE/LOCAL TEST/LIVE/PACKAGED/INSTALLED; có rollback không xóa source hay artifacts người dùng.

### T11 — Predictor và calibration theo giọng (sau core)

**Files:** MODIFY `src/main/dubbing/durationPredictor.ts`, `src/main/dubbing/profileStore.ts`; NEW pronunciation feature adapter/evaluator; `dubbing-duration-profile.test`.

- [ ] Dữ liệu WAV hợp lệ trước DSP, text tương ứng, voice/model/trim versions; dedup cache/candidate cùng nguồn.
- [ ] Thêm feature version mới, giữ nguyên nghĩa words v2; number/abbreviation/foreign-name uncertainty, không đoán cách đọc mơ hồ thành chắc chắn.
- [ ] Split train/calibration/test theo video; ridge baseline trước robust/quantile/conformal experiment.
- [ ] Ghi actual held-out error/coverage và sample bucket; cold/drift chỉ advisory, không sửa trước TTS bằng predictor chưa qualified.
- [ ] Snapshot predictor theo job; model đổi/reference đổi/trim đổi invalidate calibration phù hợp, không invalidate cả batch đang chạy.

**Exit:** predictor qualified cho từng voice cụ thể theo EVAL, không tuyên bố mọi giọng Việt cùng chính xác.

### T12 — Candidate selection và quality repair có điều kiện

**Dependencies:** T07/T09/T11; wire schema mới nếu thêm candidates vào lượt review.

- [ ] Lexicographic/Pareto selection có uncertainty và evidence; không dùng score gộp để bù lỗi nghĩa.
- [ ] Chỉ tạo candidate bổ sung cho nhóm khó; re-use WAV và text hash, không nhân TTS load toàn video.
- [ ] Thử opt-in quality repair cho measured-fit nhưng tempo >1,25 và reviewer xác định diễn đạt dư; giữ original accepted fallback.
- [ ] Sử dụng chung no-progress/journal/recovery ownership, không làm mới số vòng sau mỗi boundary revision hay retry item.
- [ ] Đo lợi ích marginal so với core cùng độ trễ/chi phí; không default-on nếu chỉ giảm vài chữ mà nghe không tốt hơn.

**Exit:** A/B chứng minh lợi ích thực tế, không tăng omission/addition hoặc false reject; trần 1,80/60% không đổi.

### T13 — Context cache và hiểu nguồn audio/video (tùy chọn sau core)

- [ ] Context 1M đã có ở T01–T02; task này chỉ tối ưu reuse hoặc thêm modality, không phải nơi trì hoãn 1M.
- [ ] Provider context cache nếu Gateway có contract: TTL/account/route/source/version identity, expiry rehydrate; không giả hỗ trợ cache hoặc chuyển API có phí ngoài ý muốn.
- [ ] Chỉ gửi media khi người dùng bật/cho phép, dùng Files/media contract đã qualified; không đưa local absolute paths cho server rồi giả nó đã xem video.
- [ ] Source evidence trích audio/OCR/frame giữ timestamp/confidence; sửa ASR chỉ khi có bằng chứng; không cho model sửa ledger gốc.
- [ ] TTS vẫn Local/Edge; không dùng Gemini speech generation, Live API hoặc source voice cloning mới.
- [ ] Benchmark riêng so với text-only; nếu không tăng chất lượng đủ để bù chi phí, giữ tắt.

**Exit:** privacy/capability/quality gate riêng. Fine-tuning/speech-to-speech/lip-sync vẫn ngoài roadmap thực thi này.

## 4. Lệnh và quy tắc test

Các test NEW phải được thêm vào `scripts/run-local-runtime-tests.mjs` registry trước gọi. Resolve tên suite bằng `rg`, không dùng tên placeholder hoặc khẳng định lệnh dưới đây đã chạy trong tương lai.

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs translation-prompts.test dubbing-grouping.test dubbing-duration-profile.test autoshort-content-quality.test gemini-gateway-prompts.test
node scripts/run-local-runtime-tests.mjs dubbing-plan.test gemini-gateway-contract.test gemini-gateway-draft-resume.test translation-orchestrator.test translation-rephrase.test
npm.cmd run test:local-runtime
```

Chỉ dùng full suite như gate tích hợp, không thay benchmark audio. Test offline near-1M là planner/protocol test; generation gần 1M là live test có chi phí. Không tự gọi trong planning.

## 5. Rollout và rollback

1. `legacy`: đường hiện tại, không đọc checkpoint namespace mới như đã được qualified.
2. `shadow`: tính nhóm/budget/token/verifier cục bộ, log khác biệt; không thêm generation/TTS và không đổi output.
3. `enabled` opt-in: core mới sau G4; A/B G5.
4. Default-on cho job mới sau G5/G6. Job đang chạy giữ snapshot cũ; không migrate giữa request.
5. Rollback: tắt feature cho job mới, giữ artifacts/ledger/checkpoint và accepted output. Không downgrade parser để nhận response hỏng. Job cần resume bằng code tương thích hoặc người dùng chủ động re-run; không tự đổi semantics.

Dừng rollout khi: source IDs/timing drift, semantic critical mới, speech bị cắt, tempo vượt trần, gap retime regression, accepted checkpoint bị mất, infinite/no-progress loop, secrets leak hoặc quality gate không đạt. Lỗi cần evidence cụ thể, không xử lý bằng tăng retry/cap/tempo.

## 6. Những việc không cần hỏi lại và những việc cần chốt lúc thực thi

Đã chốt: không Gemini voice; giữ provider/voice hiện có; Gateway hỗ trợ 1M và phải được tận dụng; mặc định văn Việt neutral; không tự nâng tempo/extension hoặc bật quota tổng.

Cần chốt khi chạy benchmark/release: corpus được phép dùng/gửi, voice configs chính, người đủ năng lực ngôn ngữ nguồn để chấm, chi phí live thực tế và thời điểm cài khi queue rảnh. Các việc này không chặn viết code/test offline và không biến 1M thành capability chưa được người dùng xác nhận.

## 7. Vòng thực thi cho từng task và self-review

Mỗi task T01–T08/T11–T13 dùng interface và test seed có mã task tương ứng trong [hợp đồng thực thi](../specs/2026-09-15-vietnamese-duration-aware-translation-contracts.md). T00/T09/T10 dùng gate dữ liệu/benchmark/release, không tạo test đỏ giả cho thao tác tài liệu hoặc cài đặt.

- [ ] Chép test seed vào đúng `tests/<suite>.test.ts` theo bảng hợp đồng, bổ sung import được nêu trong card; đăng ký suite NEW ở runner.
- [ ] Chạy lệnh riêng ghi trong card; xác nhận FAIL do thiếu chức năng/assertion đích, không phải thiếu package/fixture hoặc typo đường dẫn.
- [ ] Triển khai seam tối thiểu theo code/contract card, rồi nối consumer được liệt kê trong task. Không chạy full video để thay cho unit test.
- [ ] Chạy lại đúng lệnh; xác nhận PASS, rồi chạy tests hồi quy liệt kê trong task và `npm.cmd run typecheck`.
- [ ] Đọc diff của đúng path task, chạy gate acceptance và cập nhật handoff. Commit một deliverable trong checkout triển khai đã được người dùng cho phép; không commit lẫn dirty work cũ hoặc push tự động.

Self-review tài liệu:

- [x] R01–R15 đều có task và test matrix tương ứng; có input 1M, output-aware partition và review payload accounting riêng.
- [x] Tách core (G0–G6) khỏi predictor/candidate/cache/media (G7–G8); tất cả vẫn giữ TTS hiện có.
- [x] Xác minh các suite baseline có thật; suite mới mang nhãn NEW và có bước đăng ký runner.
- [x] Bỏ ambiguity path checkpoint và không sử dụng source-group suite không tồn tại.
- [x] Specs chỉ proposed; gate/live/install chưa chạy không được ghi đã hoàn thành.

Checklist self-review này nói về tài liệu, không đánh dấu bất kỳ task implementation nào đã xong.
