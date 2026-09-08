# DUBBING-MEASURED-FIRST: Bỏ rephrase theo dự báo

- **Trạng thái:** Đã kiểm chứng cục bộ; chờ xác nhận với bản build mới trên media thật
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-08

---

## 1. Mục Tiêu (Goal)

Thay cơ chế rút gọn toàn bộ cue dựa trên duration predictor bằng quyết định dựa trên WAV đã trim, để câu dịch hợp lệ không bị thay đổi trước khi biết thời lượng giọng thật.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Đường chạy sản xuất đo và trim audio gốc trước khi gọi rephrase.
- [x] Chỉ cue vẫn vượt trần 1,45x sau khe thoại đo được mới recovery tối đa một lượt với candidate giới hạn.
- [x] `replace`/`separate-vocals` có thể mượn tối đa 0,35 giây leading silence đã kiểm chứng; `mix` không mượn khe này.
- [x] Giữ source ledger bất biến, protected gap 0,50 giây và cấm cắt lời.
- [x] Typecheck pass và test liên quan pass.
- [ ] Xác nhận một lượt media thật trên bản build mới không còn `phase=preflight`.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):** Dubbing plan/synthesis, AutoShort wiring, regression tests, ADR và release note liên quan đến timing recovery.
- **Nằm ngoài phạm vi (Out of Scope):** Tăng trần tempo; sửa ASR/OCR; thay provider TTS; xác nhận packaged app 0.1.23 cũ.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Predictor chỉ dùng chọn nhịp khởi đầu và xếp hạng candidate sau overflow; WAV đo thật quyết định fit.
- *Lý do:* Log cũ cho thấy predictor/preflight có thể rewrite câu hợp lệ thành candidate dài hơn, trong khi cue `cue-0-1490` chỉ thiếu khoảng 0,134 giây nếu dùng leading silence.
- *Lựa chọn:* Cho early start tối đa 0,35 giây ở `replace`/`separate-vocals`, ràng buộc bởi cue trước + 0,50 giây; tắt ở `mix` để không chồng thoại nguồn.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/dubbing/synthesis.ts` — measured-first synthesis và recovery giới hạn.
- `[MODIFY]` `src/main/dubbing/plan.ts` — validation early start/protected gap.
- `[MODIFY]` `src/main/autoshort.ts` — truyền policy theo audio mode và log timing.
- `[MODIFY]` `tests/dubbing-plan.test.ts` — regression cho measured-first, cancellation, candidate và leading silence.
- `[MODIFY]` `tests/dubbing-grouping.test.ts` — nhóm thoại được đo trước rewrite.
- `[MODIFY]` `tests/translation-rephrase.test.ts` — chỉ còn rescue inline sau đo thật.
- `[MODIFY]` `docs/adr/005-source-anchored-dubbing-tempo-policy.md` — policy khe thoại đo được.
- `[MODIFY]` `docs/releases/dubbing-timing-recovery.md` — release note measured-first.
- `[NEW]` `.ai/tasks/2026-09-08-measured-dubbing-first.md` — biên bản bàn giao.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
cmd.exe /d /c "npm.cmd run typecheck"
node scripts/run-local-runtime-tests.mjs dubbing-plan.test
node scripts/run-local-runtime-tests.mjs dubbing-grouping.test
node scripts/run-local-runtime-tests.mjs translation-rephrase.test
cmd.exe /d /c "npm.cmd run test:local-runtime"
git diff --check
```

### Kết quả thực tế:

- `Typecheck`: PASS (0 errors).
- `dubbing-plan.test`: 31 pass, 0 fail.
- `dubbing-grouping.test`: 11 pass, 0 fail.
- `translation-rephrase.test`: 17 pass, 0 fail.
- `test:local-runtime`: exit 0; toàn bộ suite báo pass.
- `git diff --check`: PASS.

Case hồi quy tương ứng log cũ (`cue-0-1490`, WAV tự nhiên khoảng 2,253 giây, khe anchored 1,42 giây) mượn khoảng 0,134 giây leading silence để kết thúc khoảng 2,910 giây với tempo 1,45x; không cần rephrase. Đây là kiểm chứng logic qua test, chưa phải xác nhận media thật trên packaged app.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Bản packaged 0.1.23 hiện tại vẫn chứa đường chạy cũ; cần build và khởi động bản mới.
- Cue tràn lớn hơn khả năng của khe thoại vẫn đi qua recovery/review theo trần 1,45x.
- Cần chạy lại kho video hoặc ít nhất các cue lỗi trên bản build mới để xác nhận log runtime.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Build bản mới, khởi động đúng source/build đó và chạy lại media thật. Không dùng log của app packaged 0.1.23 cũ làm bằng chứng cho measured-first.
