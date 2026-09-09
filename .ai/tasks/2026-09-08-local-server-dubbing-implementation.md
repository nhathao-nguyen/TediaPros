# TASK-20260908-LOCAL-SERVER-DUBBING: Cải thiện dịch và dubbing local server

- **Trạng thái:** Đã kiểm chứng phần client; LIVE_PENDING server/media
- **Người thực hiện:** Codex + subagents transport/context/duration
- **Thời gian:** 2026-09-08

---

## 1. Mục Tiêu (Goal)

Giữ local server hiện tại, tăng độ bền request và chất lượng ngữ cảnh dịch, giảm các lượt rephrase không cần thiết trong khi giữ nguyên hard tempo 1.80x và extension từng đoạn tối đa 40%.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Lease inference bao phủ toàn bộ response body; retry hữu hạn, hủy được, Retry-After có trần.
- [x] Context nguồn, synopsis và glossary đi qua AutoShort và strict file runner.
- [x] Profile duration không dùng nhầm model revision/reference/feature contract.
- [x] Candidate rescue có gate cho số, phủ định, quan hệ, tên và object có bằng chứng; cue phụ thuộc predecessor giữ câu gốc để reflow trước.
- [x] Typecheck và build production qua.
- [x] Full local-runtime test sau thay đổi cuối.
- [ ] Qualification với local server và video thật.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** Electron client, translation planner/orchestrator/prompts, AutoShort UI/config, duration profile và measured dubbing rescue.
- **Nằm ngoài phạm vi:** sửa/deploy server chưa được cung cấp, đổi model, lip-sync, G2P sidecar, distributed queue.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Local server tiếp tục là provider; client fail closed khi payload vượt context đã biết.
- Predictor chỉ cung cấp uncertainty; WAV đo thật quyết định fit.
- Semantic gate là kiểm tra vi phạm xác định được, không phải chứng nhận tương đương nghĩa hoàn chỉnh.
- Extension 40% tiếp tục là fallback sau measured rephrase/reflow.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/main/translation/context.ts`, `tests/translation-transport.test.ts`, `tests/dubbing-duration-profile.test.ts`.
- `[MODIFY]` translation shared contract, planner, prompts, orchestrator, checkpoint, file runners và local adapter.
- `[MODIFY]` AutoShort main/coordinator/renderer, duration predictor/profile store, dubbing synthesis và content quality tests.

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
cmd.exe /c "npm run typecheck"
cmd.exe /c "npm run test:local-runtime"
cmd.exe /c "npx electron-vite build --outDir out-codex-local-server-improvements"
git diff --check
```

### Kết quả thực tế:

- `Typecheck`: PASS.
- `Full local-runtime`: PASS (exit code 0).
- `Targeted regression`: PASS cho transport/orchestrator/context/prompts/identity, content QA, rephrase và dubbing plan.
- `Build`: PASS vào `out-codex-local-server-improvements/`.
- `npm run build` mặc định: ACL cũ của `out/renderer` (owner `CodexSandboxOffline`) chặn xóa; cùng cấu hình build ở output sạch PASS.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Local server tại `127.0.0.1:8000` không chạy khi probe; chưa xác nhận model/revision/tokenizer/schema/usage metadata.
- Chưa có đường dẫn video mẫu nên chưa đo mức giảm extension hay p95 thời gian job.
- Semantic gate bảo thủ và chỉ bắt các dấu hiệu xác định; review nghĩa thật vẫn cần dữ liệu/human evaluation.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Cung cấp repo/config local server và thư mục video mẫu để hoàn tất P0/P3/P6 qualification.
- Không dùng số liệu offline để tuyên bố đã giảm extension trên production.
