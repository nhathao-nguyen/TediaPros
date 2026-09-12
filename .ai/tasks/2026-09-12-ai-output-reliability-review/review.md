# Review spec/plan AI Output Reliability — revision 2

Ngày 2026-09-12, baseline code `cd7d865`. Review bởi Codex, không subagent. **Kết luận:** bản đầu có 14 khoảng trống thiết kế cần xử lý (10 P1, 4 P2). Đã sửa nội dung spec/plan và thêm 60 scenarios. Đây là kết quả review tài liệu, không phải 14 lỗi production đã tái hiện hoặc đã sửa runtime.

Tài liệu đích: [spec revision 2](../../../docs/superpowers/specs/2026-09-12-ai-output-reliability-design.md), [plan revision 2](../../../docs/superpowers/plans/2026-09-12-ai-output-reliability.md), [60 scenarios](../../../docs/superpowers/specs/2026-09-12-ai-output-reliability-adversarial-cases.md).

Snapshot trước sửa: [spec-before-review.md](spec-before-review.md), [plan-before-review.md](plan-before-review.md). Line numbers dưới đây trỏ snapshot này để bằng chứng không đổi sau khi chỉnh tài liệu. Các P0–P6 là tên giai đoạn plan; `[P1]`/`[P2]` trong review là mức độ ưu tiên finding.

## Findings theo mức ưu tiên

| ID | Mức | Khoảng trống trước review | Tình huống gây hại | Bổ sung vào revision 2 |
|---|---|---|---|---|
| R01 | P1 | Spec cũ 139–151 chỉ có inputDigest/cancel trước ghi, chưa có generation/attempt owner | Response A đến sau retry B hoặc hai video cùng source có thể ghi vào state/output sai | Spec 4.8: operation/generation/attempt fencing và single writer; plan P2–P4; C31, C34–C36 |
| R02 | P1 | AC08 cũ 164 yêu cầu dừng và trả lease, chưa phân biệt UI settle với request/server dừng | Promise.race trả nhanh nhưng request cũ giữ local GPU; release sớm gây chạy chồng, giữ vô hạn gây UI treo | Spec 4.10: logical completion/server liveness riêng, endpoint unavailable khi unknown; C32–C33, C40 |
| R03 | P1 | Spec cũ 151 dùng exclusive create; plan P3 yêu cầu cancel bỏ sidecar mới mà chưa có commit point | Crash giữa write để lại final dở dang; cancel đến sau commit xóa file tốt; writer khác bị ghi đè | Spec 4.9: temp/flush/atomic no-replace/receipt, cancel linearization và ownership cleanup; C37–C44, C59 |
| R04 | P1 | Spec cũ 97 cho accept unknown completion, chưa ràng buộc transport đã hoàn chỉnh | JSON đã đủ nhưng socket/SSE terminal hỏng bị hạ thành unknown và publish | Spec 4.3/4.10: transport complete bắt buộc, unknown chỉ dành finish evidence model; C11–C14, C16 |
| R05 | P1 | Envelope cũ 84–92 chỉ rawText, chưa định nghĩa candidate/part extraction | Ghép thoughts/tool calls hoặc chọn trong nhiều candidates tạo đáp án không có nguồn gốc rõ | Spec 4.10: adapter final-text allowlist, no ambiguous candidate selection; C15–C16 |
| R06 | P1 | Spec cũ 139–141 giới hạn repair/fingerprint nhưng chưa chứng minh tổng wire attempts hoặc recovery rank | Credential/model wrappers nhân retry; text đổi nhẹ/reset generation khiến no-progress bị vượt | Spec 4.11: scheduler ownership, finite failover inventory, rank, persisted charge; C18, C24, C27, C47 |
| R07 | P1 | Spec cũ 147 chỉ nói checkpoint assessment/version, chưa bắt nested validation/serialized writers | Checkpoint đúng outer shape nhưng batches/counters hỏng được resume; hai writer làm mất cập nhật | Spec 4.8/4.14: nested bounded validation/CAS/in-flight unknown; C34, C45–C47 |
| R08 | P1 | Spec cũ 149 yêu cầu version, plan phần tổng quan đặt migration chủ yếu sau P4 ở P5 | Parser/caller mới bật trước key/version mới sẽ tái dùng dữ liệu cũ không qua gate mới | Version migration cùng commit tại P1–P4, P5 chỉ tăng tiếp version thay đổi; C48 |
| R12 | P1 | Spec cũ 73 nói model evidence nhưng không quy định unknown revision/cache lifetime hoặc resolved alias trong digest | Alias llm-default/gateway/model thay dưới cache cũ, prepared metadata từ source/output khác được dùng lại | Spec 4.8/4.14: resolved identity, scoped evidence, unknown durable reuse restrictions; C19–C20, C35, C49–C50 |
| R14 | P1 | Spec cũ 75 nói lỗi schema xác định nhưng chưa phân biệt unsupported với invalid config | Bất kỳ 400/422 được coi unsupported rồi downgrade, che schema code bug và chạy sai contract | Spec 4.11/4.14: explicit error classification, api-json-mode khác prompt-only, no global poisoning; C17–C20 |
| R09 | P2 | Spec cũ 95/104 chỉ nói bounded, chưa có số và Unicode/input preflight rules | Depth/arrays/decompressed bytes gây tải lớn; surrogate/ZWJ/ID normalization phá nội dung hoặc map sai | Spec 4.12: concrete limits, preflight, raw-before-normalize/Unicode-safe policy; C01–C10, C28–C29 |
| R10 | P2 | Spec cũ 118–122 yêu cầu contamination/semantic correctness nhưng còn khó định nghĩa oracle | Reject video dạy JSON, fragment/source=target hoặc accept repair đổi nghĩa vì text khác | Spec 4.13: error/warning/unknown disposition, positive controls và evidence-bound improvement; C10, C51–C56 |
| R11 | P2 | Spec cũ 139 coi mỗi summary part là operation nhưng chưa có round/chunk identity và contraction rank | Part index lặp giữa rounds reuse sai; summary schema-valid nhưng không giảm gây loop hoặc bỏ part lỗi | Spec 4.11: round/part/chunk digest, coverage/rank/insufficient-source; C25, C30 |
| R13 | P2 | Spec cũ 153 giới hạn capture nhưng chưa định nghĩa logging failure và shared disk budget | Debug capture ENOSPC/redaction exception làm hỏng video tốt hoặc recursive retry/log; key bị echo vào error | Spec 4.15: nonfatal diagnostics/redaction/bounded reservation, counters độc lập debug; C57–C58 |

**Disposition cho cả R01–R14:** DOCUMENTATION_ADDRESSED. Implementation/test/live gates vẫn PLANNED/UNKNOWN theo phạm vi; không dùng từ FIXED cho runtime.

## Đối chiếu code giúp định mức rủi ro

- CODE_CONFIRMED: `src/main/autoShortResourceManager.ts:109` giữ lease tới khi action settle. Đây là guard cần giữ, chưa đủ chứng minh server đã idle khi wrapper action dùng Promise.race. Không kết luận server thật đang chạy chồng từ đọc code này.
- CODE_CONFIRMED: `src/main/videoTitle.ts:453` và `:474` ghi trực tiếp final bằng wx và cleanup trong catch. Catch không chạy khi process bị kill; vì vậy spec cần crash-commit protocol và platform gate, không chỉ test happy path write.
- CODE_CONFIRMED: `src/main/translation/checkpoint.ts:87` kiểm tra outer types/disposition; `:108` JSON.parse toàn file; `:113` temp+rename. Nested validation/bounded reading/concurrent ownership cần được kiểm chứng trong P4.
- CODE_CONFIRMED: `src/main/videoTitle.ts:292` SEO digest dùng model alias llm-default và timestamps làm tròn 3 chữ số thập phân. Spec yêu cầu audit resolved model/precision, không khẳng định rounding đã gây một collision thực tế.
- CODE_CONFIRMED: `src/main/translation/budget.ts` có transportRetries/repairSets và charge counters. Review giữ policy tổng quota đang tắt, bổ sung proof termination và audit nested request count; không thay quota bằng một giới hạn tổng mới.

## Những lựa chọn được giữ sau review

1. AI chỉ trả nội dung và ID tối giản; code quản lý metadata bất biến, không positional splitting.
2. Strict schema ở API khi có evidence hỗ trợ, luôn validate ở code. Metadata compatibility không được tự biến thành free text.
3. Không lấy inner JSON từ outer malformed như ảnh; safe wrapper được normalize có audit.
4. Metadata failure không làm mất video; legacy state thiếu hashtags vẫn có migration riêng.
5. Semantic checks có giới hạn: không hứa bảo đảm mọi bản dịch đúng nghĩa bằng schema/regex/một lượt verifier.

## Gate còn mở có chủ đích

- **Platform atomic/no-replace:** P3 phải chọn primitive và thử trên filesystem mục tiêu; profile unsupported trả metadata-save-unsupported và giữ video. Chưa có implementation/platform proof.
- **Local server cancellation:** cần API/status hoặc recovery proof; nếu chưa có thì endpoint unavailable khi state unknown, không giả định abort đã dừng compute. Chưa gọi gateway thật.
- **Semantic quality:** corpus và positive controls được đặc tả; không có universal semantic oracle. Cases heuristic/unknown giữ disposition minh bạch.
- **Capability qualification:** mock pass và một live sample không chứng minh mọi provider/model/schema support. Báo số mẫu và model revision khi implement.

Các gate này không làm thiếu quyết định fail-safe trong spec; chúng giới hạn profile nào được enable và mức claim khi implementation hoàn thành.

## Kiểm chứng review

- Đã lưu hai snapshot trước sửa và chỉ sửa bộ tài liệu được yêu cầu.
- Spec có AC01–AC20, plan giữ P0–P6 với exit criteria cập nhật, scenario matrix có C01–C60 duy nhất, findings có R01–R14.
- [Verifier tài liệu](verify-review-docs.mjs) kiểm tra link, whitespace, ID coverage và owner phase; [log](document-verification.log) ghi kết quả thực tế.
- [Typecheck lần review](typecheck.log) là baseline hiện tại, không chứng minh implementation mới.
- 100/100 tests của 11 suite ở [log phiên lập plan](../2026-09-12-ai-output-reliability/baseline-focused-tests.log) không chạy lại trong review vì không sửa code/tests. Không gán số đó cho 60 scenarios mới.
