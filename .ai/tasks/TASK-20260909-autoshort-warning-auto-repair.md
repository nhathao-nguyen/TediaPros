# TASK-20260909-AUTOSHORT-WARNING-AUTO-REPAIR: Tự xử lý cảnh báo bản dịch

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-09

---

## 1. Mục Tiêu (Goal)

Tự sửa các cue bị nghi ngờ về số, đơn vị, phủ định hoặc ngôn ngữ trước khi AutoShort tiếp tục; không yêu cầu người dùng thao tác với cảnh báo heuristic không chặn pipeline.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Cue có cảnh báo nội dung được repair đúng phạm vi một lần rồi đánh giá lại.
- [x] Repair không tiến triển dừng hữu hạn và giữ bằng chứng assessment.
- [x] Cảnh báo giới hạn token chưa biết không xuất hiện như cảnh báo cần thao tác.
- [x] Checkpoint/cache có cảnh báo được đưa qua scheduler thay vì tái sử dụng trực tiếp.
- [x] Hàng đợi chỉ hiện assessment cần người dùng xử lý (`needs-review`).
- [x] Các cảnh báo nhầm trong video Hải Nam về `十四`/`quatorze` và `无憾`/`sans regret` được loại bỏ.
- [x] Typecheck và các test liên quan pass.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** translation orchestrator, detector số/phủ định, checkpoint reuse, hiển thị hàng đợi và regression tests.
- **Nằm ngoài phạm vi:** thay đổi provider, thay đổi trần tempo dubbing, chạy media/provider thật hoặc đóng gói installer.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Chỉ repair các cue có bằng chứng `protected-token-suspect` hoặc `language-suspect`; giữ nguyên ID, timestamp và các cue đã sạch.
- Chỉ chạy một lượt repair tự động. Phản hồi không tiến triển vẫn được giữ để audit nhưng không làm hàng đợi lặp vô hạn.
- Lỗi cấu trúc vẫn là `needs-review`; cảnh báo heuristic không trở thành lỗi dừng pipeline.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/translation/orchestrator.ts`
- `[MODIFY]` `src/main/autoShortItemCoordinator.ts`
- `[MODIFY]` `src/main/contentQuality/numerals.ts`
- `[MODIFY]` `src/main/contentQuality/negation.ts`
- `[MODIFY]` `src/renderer/src/components/AutoShort.tsx`
- `[MODIFY]` `tests/autoshort-content-quality.test.ts`
- `[MODIFY]` `tests/translation-orchestrator.test.ts`
- `[MODIFY]` `tests/translation-provider-contract.test.ts`
- `[MODIFY]` `tests/translation-qualification.test.ts`
- `[MODIFY]` `docs/translation-budget-policy.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
cmd.exe /d /c "npm run typecheck"
cmd.exe /d /c "node scripts/run-local-runtime-tests.mjs autoshort-content-quality.test translation-orchestrator.test translation-provider-contract.test translation-qualification.test translation-language.test translation-prompts.test translation-planner.test translation-resume.test translation-identity.test translation-multilingual.test autoshort-ui-contract.test autoshort-ocr-pipeline.test"
cmd.exe /d /c "npm run test:local-runtime"
git diff --check
```

### Kết quả thực tế

- `typecheck`: PASS.
- 12 suite translation/content/UI/OCR liên quan: PASS, 111/111 test.
- `git diff --check`: PASS (chỉ có cảnh báo chuẩn hóa CRLF/LF).
- Full local runtime: còn 14 lỗi ngoài phạm vi ở `dubbing-plan.test` (12) và `translation-rephrase.test` (2); các tệp/module này không bị sửa trong task này.
- Runtime dev: PASS; `http://localhost:5173/` trả HTTP 200, Electron có renderer và cửa sổ `TediaPros` phản hồi.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Chưa chạy provider thật hoặc real-media AutoShort; lần mở Electron chỉ xác minh startup/UI shell.
- Chưa kiểm chứng bản đóng gói.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Bản development từ mã nguồn mới đang chạy; bản cài đặt cũ đã được đóng để tránh kiểm tra nhầm phiên bản.
- Cảnh báo heuristic còn lại nằm trong checkpoint/log để chẩn đoán, không hiện thành thao tác bắt buộc trong hàng đợi.
