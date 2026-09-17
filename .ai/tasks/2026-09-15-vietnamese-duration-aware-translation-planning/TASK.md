# VI-DUB-20260915-PLANNING: Specs và kế hoạch cải tiến dịch Việt

- **Trạng thái:** Hoàn thành tài liệu; implementation và live qualification chưa thực hiện.
- **Người thực hiện:** Codex, task hiện tại; không tạo subagent.
- **Thời gian:** 2026-09-15.

## 1. Mục tiêu

Tổng hợp session về độ dài bản dịch, budget, cách ép, chất lượng tiếng Việt, thuật toán/system design, so sánh platform dubbing và Gemini context thành specs/planning có thể giao triển khai. Người dùng xác nhận Gateway hỗ trợ đầy đủ 1M context và yêu cầu đưa vào core; không dùng Gemini tạo giọng.

## 2. Tiêu chuẩn nghiệm thu tài liệu

- [x] Spec phân biệt baseline bằng chứng và thiết kế proposed; không tuyên bố chất lượng live đã đạt.
- [x] Gateway 1M là yêu cầu chính T01/T02/T09, không bị giữ ở optional feasibility.
- [x] Không Gemini voice trong core/optimization/fallback; giữ Local/Edge TTS.
- [x] Có 14 task T00–T13, 15 yêu cầu R01–R15, interfaces, test seeds, dependency, rollback và release gate.
- [x] Có protocol chấm nghĩa/văn phong/audio, dữ liệu train/calibration/held-out và token/output boundary tests.
- [x] Kiểm tra docs: 4 file, 13 local links, 27 code blocks hợp lệ về cú pháp; không coi đây là integration typecheck của code proposed.
- [x] `npm.cmd run typecheck` baseline exit 0; 74 tests liên quan pass, 0 fail/skip; probe baseline exit 0.
- [x] Không sửa code production/cấu hình runtime, không gọi Gemini/TTS, không cài Windows, không commit/push.

## 3. Phạm vi

**In scope:** bốn tài liệu mới, script kiểm tra tài liệu, bản ghi bằng chứng và handoff. Đã dùng skill writing-plans để bổ sung header/constraints, interface/test cards, red-green gates và self-review; verification-before-completion để kiểm tra tươi trước bàn giao.

**Out of scope:** triển khai runtime, thay đổi CreateMediaTool, provider generation/audio, corpus upload, release hoặc sửa dirty work cũ. Các file source hiện vẫn có thay đổi local từ task khác/trước đó; không được đánh đồng chúng với việc tạo specs này.

## 4. Quyết định kiến trúc và lý do

- Một SpeechUnitPlan freeze dùng chung giúp tránh budget từng fragment khác với nhóm TTS.
- Context Gateway 1M giúp giữ full source; output limit/byte limit/counter và payload review vẫn được quản lý riêng. Model fallback policy hiện tại không bị đổi thành strict 3.1 Pro.
- Không hard word cap; semantic evidence và measured WAV quyết định khả năng nhận candidate.
- Giữ trần tempo 1,80x, extension 60%/slowdown part 20%, gap source-aware và quota tổng tạm tắt. Không phục hồi hằng số 40% hoặc 1,45x từ ghi chú lịch sử.
- Core hoàn chỉnh trước; predictor calibration/candidate optimization/cache/media context có gate riêng. Gemini TTS và lip-sync vẫn bị loại.

## 5. Tệp mới

- [Spec](../../../docs/superpowers/specs/2026-09-15-vietnamese-duration-aware-translation-design.md).
- [Hợp đồng thực thi và test seed](../../../docs/superpowers/specs/2026-09-15-vietnamese-duration-aware-translation-contracts.md).
- [Kế hoạch T00–T13](../../../docs/superpowers/plans/2026-09-15-vietnamese-duration-aware-translation.md).
- [Protocol nghiệm thu](../../../docs/benchmarks/2026-09-15-vietnamese-duration-aware-translation-evaluation.md).
- [Script kiểm tra docs](verify-docs.mjs), [bằng chứng tổng hợp](verification.json), bản handoff này.

## 6. Kiểm chứng và bằng chứng

Các lệnh thực sự đã chạy:

```powershell
node .ai/tasks/2026-09-15-vietnamese-duration-aware-translation-planning/verify-docs.mjs
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs translation-prompts.test dubbing-grouping.test dubbing-duration-profile.test autoshort-content-quality.test gemini-gateway-prompts.test
node .ai/tasks/2026-09-15-vietnamese-translation-design-review/probe.mjs
```

Kết quả: docs checker PASS; typecheck exit 0; tests 11+20+8+31+4 = 74 PASS; probe exit 0 và xác nhận source hashes sáu module còn cùng baseline được review. Negative controls trong probe tái hiện giới hạn code cũ, không phải assertion yêu cầu code mới tiếp tục sai.

Chưa thực hiện: compile/tích hợp helper proposed; request live gần 1M; chấm mù người Việt/người hiểu nguồn; đo audio/video mới; Windows package/install. Các ngưỡng hiệu quả trong EVAL là mục tiêu đề xuất cần đăng ký trước benchmark, không số liệu đạt được.

## 7. Bước tiếp theo

Người dùng review bốn tài liệu và chọn cách thực thi (trực tiếp trong task hoặc subagent theo từng task). Bắt đầu T00/T01, tiếp T02/T03–T04 theo dependency, giữ mỗi deliverable có regression gate. Không diễn giải “tiếp tục hoàn thiện specs” thành cho phép sửa/cài runtime.

Khi triển khai đọc lại AGENTS/source dirty mới nhất. Mọi threshold/feature policy có phiên bản và rollback; không nâng retry/tempo để che lỗi. Live benchmark cần corpus/voice/cost rõ; release cần queue rảnh và yêu cầu cài đặt riêng.
