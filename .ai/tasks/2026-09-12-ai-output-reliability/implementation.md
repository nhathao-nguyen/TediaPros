# TASK-20260912-AI-OUTPUT-IMPLEMENTATION: Đầu ra AI có cấu trúc và fail-safe

- **Trạng thái:** Đã kiểm chứng ở client/offline.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-12.
- **Baseline:** triển khai trên working tree bắt đầu từ HEAD `cd7d865`; các thay đổi không liên quan có sẵn trong workspace được giữ nguyên.

---

## 1. Mục tiêu (Goal)

Ngăn title, summary, SEO metadata và bản dịch bị chấp nhận hoặc ghi file khi phản hồi AI sai JSON, bị cắt, bị từ chối/lọc, có nhiều candidate, lặp key, sai schema hoặc sai cue ID. Schema phía provider được dùng để giảm lỗi; parser và validation trong client vẫn là ranh giới quyết định cuối cùng.

## 2. Tiêu chuẩn nghiệm thu (Acceptance Criteria)

- [x] Parser JSON hữu hạn kiểm tra byte/depth/member/candidate, duplicate decoded key, UTF-8/Unicode và exact schema.
- [x] Title, summary và SEO dùng schema riêng, completion envelope và tối đa một lần repair toàn object từ source.
- [x] Translation chỉ nhận `{items:[{id,text}]}`, không alias `t`, không positional mapping và không đưa partial có hard error vào accepted/checkpoint state.
- [x] Response body được đọc theo byte trần và có cancellation; response nhiều candidate, refusal, filter, tool/thought hoặc truncated bị chặn.
- [x] `tieude.txt` dùng temp + `fsync` + no-replace commit; cancel trước commit không để lại final/temporary file do operation sở hữu.
- [x] Checkpoint được đọc bounded, validate sâu và coi dữ liệu hỏng/future schema là cache miss.
- [x] Prompt translation v11 giảm metadata lặp, vẫn giữ stable ID và dữ liệu thời lượng cần cho dubbing.
- [x] `npm run typecheck` pass cả node và web.
- [x] Toàn bộ `npm run test:local-runtime` pass: 856 pass, 0 fail, 7 skip.

## 3. Phạm vi triển khai (Scope & Boundaries)

- **Thuộc phạm vi:** parser/schema dùng chung; adapter Local/Gemini/OpenAI; translation response/orchestrator/checkpoint/prompt; title/summary/SEO validation, recovery, publication; regression và tài liệu kiến trúc.
- **Ngoài phạm vi đã kiểm chứng:** gọi provider/gateway thật có tính phí; chứng nhận constrained decoding theo từng endpoint/model; crash/power-loss; network share hoặc filesystem ngoài Windows hiện tại; bảo đảm ngữ nghĩa tuyệt đối của nội dung AI.
- Không thay đổi tempo 1.80x, quota translation đang tắt, OCR/engine, TTS semantics, LICENSE hoặc NOTICE.

## 4. Quyết định kiến trúc và lý do

- AI trả object nội dung tối giản; code quản lý cue identity, completion state và artifact cuối.
- Schema request không được dùng thay cho validation. Client luôn xác thực transport, candidate và exact keys trước khi nhận nội dung.
- Strict AI validation tách khỏi legacy persisted normalization để dữ liệu SEO cũ vẫn có thể bổ sung hashtags mà response AI mới không được thiếu trường.
- Không cứu inner JSON từ một outer object hỏng như ảnh tham chiếu. Recovery tạo lại một object hoàn chỉnh từ source và không ghép field giữa các attempt.
- Numeric string như `"0"` không được diễn giải thành vị trí hoặc alias của `cue-0`; chỉ stable ID exact hoặc prefix compatibility bijective mới được map.
- Publication sidecar dùng cùng thư mục, `fsync` và hard-link no-replace. Profile không hỗ trợ primitive phải báo lỗi metadata, không ghi trực tiếp vào final path.

## 5. Danh sách tệp thay đổi (Changes Made)

- `[NEW]` `src/shared/aiOutput.ts`, `src/main/aiResponseBody.ts`.
- `[MODIFY]` `src/shared/videoSeo.ts`.
- `[MODIFY]` `src/main/gemini.ts`, `src/main/geminiKeys.ts`, `src/main/openai.ts`, `src/main/localTranslate.ts`, `src/main/videoTitle.ts`.
- `[MODIFY]` `src/main/translation/checkpoint.ts`, `orchestrator.ts`, `prompts.ts`, `response.ts`.
- `[MODIFY]` `tests/ai-output.test.ts` và các suite video SEO/title, translation response/orchestrator/provider/transport/resume/prompt/planner/rephrase/identity/local/Gemini.
- `[MODIFY]` `scripts/run-local-runtime-tests.mjs` để đăng ký suite parser mới.
- `[NEW]` `docs/adr/009-bounded-structured-ai-output.md`.
- `[MODIFY]` `docs/architecture.md`, `docs/domain.md`, `docs/translation-budget-policy.md` và trạng thái spec/plan liên quan.

## 6. Kiểm chứng và bằng chứng (Verification & Evidence)

Các lệnh cuối chạy từ repository root:

```powershell
cmd.exe /d /s /c "npm run typecheck"
cmd.exe /d /s /c "npm run test:local-runtime"
git diff --check
```

- `Typecheck`: PASS, exit 0 cho `typecheck:node` và `typecheck:web`. Log: [final-typecheck.log](final-typecheck.log).
- `Local runtime`: PASS, exit 0; 856 pass, 0 fail, 7 skip trên 83 nhóm kết quả. Log đầy đủ: [final-full-runtime-tests.log](final-full-runtime-tests.log).
- Tổng hợp các gate cuối: [final-verification-summary.log](final-verification-summary.log).
- Regression tập trung cuối cho `translation-response.test`: 8/8 pass, gồm trường hợp `"0"` không map sang `cue-0`.
- Mock/offline tests chứng minh contract phía client. Chúng không chứng minh provider/gateway thật tuân thủ constrained decoding hoặc mọi model revision có cùng finish metadata.

## 7. Bước tiếp theo / Ghi chú bàn giao (Handoff Notes)

- Qualification live nên ghi endpoint, resolved model revision, schema revision, raw completion metadata đã redact và sample count; không tái sử dụng kết luận giữa model/endpoint khác nhau.
- Kiểm tra publication cần được lặp trên filesystem/profile phân phối thực tế. Network share và hành vi khi mất điện giữ trạng thái UNKNOWN.
- Bảy test skip được giữ đúng như runner báo và không được diễn giải thành pass.
- Chưa commit, push, build installer hoặc chạy live provider trong task này.
