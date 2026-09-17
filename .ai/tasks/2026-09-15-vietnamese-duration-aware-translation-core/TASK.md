# VI-DUB-20260915-CORE: Core dịch Việt theo thời lượng và Gateway 1M

- **Trạng thái:** Đã kiểm chứng một phần core offline; rollout/live qualification chưa hoàn thành.
- **Người thực hiện:** Codex, triển khai trực tiếp trong checkout hiện tại.
- **Thời gian:** 2026-09-15.

---

## 1. Mục Tiêu (Goal)

Triển khai slice core từ roadmap `VI-DUB-20260915`: bản dịch Việt ngắn, tự nhiên nhưng không bỏ ý; Gateway được phép giữ full source ledger trong context 1M đã người dùng xác nhận; output vẫn có budget độc lập. Dubbing tiếp tục dùng Local/Edge TTS, không thêm Gemini TTS/Live.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Gateway capability nội bộ có floor context `1_000_000`, output cap tách riêng và provenance rõ là `user-confirmed` khi server chưa nêu contract exact.
- [x] Planner chỉ chia tập ID đầu ra khi cần; full immutable source ledger, cue identity/timing và source speech plan vẫn được truyền cho draft/review.
- [x] Speech budget tái sử dụng window nguồn/policy hiện hữu, giữ trần tempo 1.80x và không trừ gap nhiều lần.
- [x] Prompt Việt v1 yêu cầu gọn, tự nhiên, trung tính, đủ ý; không có hard word cap hoặc ví dụ tự bịa.
- [x] Có regression cho object có số lượng/đơn vị và đảo thứ tự hành động trong same-language rephrase guard.
- [x] Có seam evidence/decision thuần: raw provider semantic claim không thể tự nâng thành `verified`; structural và semantic verified luôn thắng `suspect` trong quyết định.
- [x] Source-repair không còn lấy một bản rút gọn từ `currentText` không đáng tin làm candidate; audit ghi rõ evidence cross-language là `source-repair-unverified`.
- [x] Slice T07 có journal trong bộ nhớ theo job/item: candidate hash đã dispatch không được TTS lại ở queue retry cùng job, kể cả sau lỗi TTS; không thêm raw text vào checkpoint/IPC/log.
- [x] Có evaluator offline first-pass fit và paired bootstrap theo video; WAV lỗi vẫn ở mẫu số, không có provider/TTS call.
- [x] `npm run typecheck` pass 100% (0 errors).
- [x] Focused regression và full local runtime gate pass (xem mục 6).

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Capability/request budgeting, source-ledger prompt, source speech plan/budget, checkpoint identity và Gateway audit snapshot.
  - Output-aware planning giữ immutable source identity; profile văn phong Việt, semantic negative controls hẹp, evidence/decision helper, recovery source-repair và slice replay-guard T07 trong bộ nhớ.
  - Evaluator offline cho first-pass fit/paired bootstrap theo video; test thuần bằng mock Gateway, không dispatch provider thật.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Gemini voice, Gemini Live, thay Local/Edge TTS, đổi tempo/extension policy.
  - Token counter Gateway exact/qualified, probe live gần 1M, corpus/human Vietnamese evaluation, calibration, media context cache, UI/release/package Windows.
  - Sửa các thay đổi dirty không liên quan tại `src/main/autoShortThumbnail.ts` và `src/main/index.ts`.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Ghi 1M là `user-confirmed`, dùng default combined limit và output cap 16,384 tách biệt.
- *Lý do:* Không đánh đồng context window với output capacity hoặc với một bộ đếm token exact khi Gateway chưa công bố counter contract.

- *Lựa chọn:* Full source ledger nằm ngoài requested output IDs; adapter nhận ledger đầy đủ ở dispatch thay vì copy nó vào từng batch/checkpoint.
- *Lý do:* Giữ liên kết ngữ cảnh xuyên batch đồng thời tránh nhân bản payload 1M vào state có giới hạn kích thước.

- *Lựa chọn:* SpeechUnitPlan/budget nguồn chỉ là advisory trong prompt; WAV đo thực tế và gate tempo hiện có vẫn là authoritative.
- *Lý do:* Không có phép tính chữ/từ nào được quyền che một audio overflow thật.

- *Lựa chọn:* Same-language guard chỉ thêm phát hiện deterministic có high confidence; không gọi đó là cross-language semantic verifier.
- *Lý do:* Tránh false confidence với cặp nguồn/đích khác ngôn ngữ.

- *Lựa chọn:* Ở `recoveryAttempt=2`, chỉ candidate do adapter trả về từ source mới được rescue; không compact `currentText` vốn được prompt đánh dấu là không authoritative.
- *Lý do:* Một target cũ sai nghĩa có thể tạo ra bản ngắn hơn nhưng vẫn sai. Candidate source-repair được audit là `source-repair-unverified`; measured WAV chỉ chứng minh fit vật lý, không chứng minh nghĩa.

- *Lựa chọn:* Hash candidate rescue theo source speech-unit ID, text, model, voice và options; journal chỉ sống trong `AutoShortJob` và claim trước TTS.
- *Lý do:* Queue retry trong cùng job không tiêu tốn lại một TTS request cho cùng candidate, nhưng không làm raw translation text xuất hiện trong checkpoint, IPC hay log.

- *Lựa chọn:* Paired bootstrap tái lấy mẫu theo video với seed cố định, không theo cue.
- *Lý do:* Cues cùng một video tương quan; bootstrap từng cue sẽ làm CI quá lạc quan.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/main/translation/capabilitySnapshot.ts`, `requestBudget.ts`, `speechBudget.ts`, `speechUnitPlanner.ts`, `viStyleProfile.ts`.
- `[NEW]` `src/shared/speechUnitPlan.ts`.
- `[MODIFY]` `src/main/geminiGateway.ts`, `geminiGatewayPrompts.ts`, `geminiGatewayDraftCheckpoint.ts`, `autoshort.ts`, `autoShortItemCoordinator.ts`.
- `[MODIFY]` `src/main/translation/planner.ts`, `orchestrator.ts`, `checkpoint.ts`; `src/shared/translation.ts`; `src/main/autoShortContentQuality.ts`.
- `[MODIFY]` `src/main/dubbing/synthesis.ts`, `src/main/autoshort.ts`; `scripts/run-local-runtime-tests.mjs`.
- `[NEW]` `src/main/dubbing/feedbackDecision.ts`, `tests/dubbing-feedback-decision.test.ts`; `[MODIFY]` `tests/dubbing-plan.test.ts` cho replay/failed-outcome regression.
- `[NEW]` `scripts/evaluate-vietnamese-dubbing.mjs`, `tests/vietnamese-evaluation.test.ts`.
- `[NEW]` `src/main/translation/semanticEvidence.ts`, `qualityDecision.ts`, `tests/translation-semantic-evidence.test.ts`.
- `[NEW/MODIFY TEST]` capability/request/speech/style/long-context tests; Gateway, planner, content-quality, source-repair and runtime runner regressions.

Không xóa tệp, không cài dependency, không commit/push và không gọi provider/TTS thật.

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
node scripts/run-local-runtime-tests.mjs dubbing-plan.test autoshort-tts-pipeline.test translation-rephrase.test autoshort-content-quality.test vietnamese-evaluation.test translation-capability-snapshot.test translation-request-budget.test speech-unit-plan.test speech-unit-planner.test speech-budget.test vietnamese-style-profile.test translation-planner.test translation-resume.test translation-identity.test gemini-gateway-long-context.test gemini-gateway-prompts.test gemini-gateway-contract.test gemini-gateway-draft-resume.test translation-orchestrator.test
npm.cmd run typecheck
npm.cmd run test:local-runtime
```

### Kết quả thực tế

- `TEST_CONFIRMED`: focused gate gốc gồm 19 suites, **200 passed**, 0 failed. Gate mới nhất gồm 5 suites, **119 passed**, 0 failed: evidence/decision precedence, content/rephrase, source-repair và TTS pipeline.
- `TEST_CONFIRMED`: gate T07 mới nhất gồm `dubbing-feedback-decision` (2), `dubbing-plan` (56), `autoshort-tts-pipeline` (6) và `translation-rephrase` (21): **85 passed**, 0 failed. Regression chứng minh candidate lặp bị dừng trước TTS ở retry cùng journal và hash chuyển `failed` khi fixture TTS lỗi.
- `TEST_CONFIRMED`: `npm.cmd run typecheck` PASS: cả `typecheck:node` và `typecheck:web` hoàn thành với 0 lỗi.
- `TEST_CONFIRMED`: `npm.cmd run test:local-runtime` chạy lại sau production wiring T07 và exit 0. Một số fixture media được skip có chủ đích khi `TEDIAPROS_TEST_FFMPEG` không được đặt; không có failed test.

### Những phần chưa kiểm tra / Rủi ro còn lại

- `UNKNOWN`: Gateway có thực thi context 1M trên môi trường live và giới hạn exact bao nhiêu; client hiện chỉ dùng floor do người dùng xác nhận.
- `INFERRED`: token estimate từ JSON UTF-8 bytes chỉ là preflight bảo thủ có nhãn, không phải tokenization được Gateway công nhận.
- `UNKNOWN`: bản dịch tự nhiên/đủ ý hơn trên video thật; cần corpus đã duyệt, chấm mù tiếng Việt và đo WAV theo protocol EVAL.
- Same-language rephrase guard đã mạnh hơn, nhưng không thay thế semantic verifier đa ngôn ngữ hoặc human review.
- Evidence/decision helper chưa được persistence/IPC/orchestrator consumer dùng để thay đổi disposition; làm vậy cần schema migration và source-span provenance riêng, không được suy diễn từ helper này.
- Evaluator mới chỉ là công cụ đo offline; chưa có manifest corpus, report thật, benchmark live hoặc quality gate đạt.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Trước live qualification, chốt schema Gateway cho advertised capacity/token counting hoặc giữ rõ trạng thái `user-confirmed`/estimate như hiện tại.
- Cấp manifest corpus/rubric để chạy `node scripts/evaluate-vietnamese-dubbing.mjs --input <manifest.json>` trước khi claim chất lượng; slice replay-guard T07 đã có nhưng semantic ranking/quality-repair đầy đủ, T11--T13 và Windows package/release vẫn cần gate riêng.
- Không đóng toàn bộ T01--T06 chỉ từ slice này; xem cập nhật trong plan/contracts để biết phần còn lại.
