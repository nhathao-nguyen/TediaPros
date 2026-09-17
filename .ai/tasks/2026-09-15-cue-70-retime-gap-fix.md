# TASK-20260915-CUE-70: Sửa lỗi cửa sổ dubbing sau retime và gom request Gemini overflow

- **Trạng thái:** Đã kiểm chứng bằng test; chờ retry media thật
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-15

---

## 1. Mục Tiêu (Goal)

Khắc phục lỗi thật `cue-70-138720 cần nhịp 4.024x` của video AutoShort và
loại bỏ kiểu gọi một Gemini Gateway request cho từng cue TTS overflow.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Tái tạo lỗi bằng timestamp và thời lượng WAV đo được của cue thật.
- [x] Sau retime, giữ nguyên quyết định khoảng nghỉ từ timeline nguồn.
- [x] Không vượt tempo `1.80x`, không cắt lời và không đổi source ledger.
- [x] Sáu cue overflow được gửi trong một Gemini Gateway batch.
- [x] `npm run typecheck`, full local runtime và build đều pass.
- [ ] Chạy lại item thật từ checkpoint và kiểm tra artifact cuối.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** `dubbing/synthesis.ts`, Gemini overflow batching trong
  `autoshort.ts`, regression tests và tài liệu kiến trúc liên quan.
- **Nằm ngoài phạm vi:** thay trần tempo `1.80x`, nới trần retime `60%`, đổi
  nội dung bản dịch đã checkpoint hoặc sửa Gateway server không liên quan.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Khoảng nghỉ được chọn một lần trên source timeline và giữ theo số giây tuyệt
  đối khi map sang output. Với cue thật, heuristic cũ đổi `0.09s` thành `0.50s`
  sau khi span kéo dài vượt `0.60s`, khiến cửa sổ giảm từ khoảng `0.51s` xuống
  khoảng `0.31s` dù vừa thêm thời gian.
- Gemini Gateway dùng chung batch contract với local provider, giới hạn 8 cue
  mỗi request. Repair chỉ gửi các cue chưa có candidate hợp lệ.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/dubbing/synthesis.ts`
- `[MODIFY]` `src/main/autoshort.ts`
- `[MODIFY]` `tests/dubbing-plan.test.ts`
- `[MODIFY]` `tests/translation-rephrase.test.ts`
- `[MODIFY]` `docs/adr/005-source-anchored-dubbing-tempo-policy.md`
- `[MODIFY]` `docs/architecture.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
node scripts/run-local-runtime-tests.mjs dubbing-plan.test
node scripts/run-local-runtime-tests.mjs translation-rephrase.test gemini-gateway-contract.test
npm.cmd run typecheck
```

### Kết quả thực tế hiện tại

- Focused dubbing: PASS, 53/53.
- Rephrase + Gateway contract: PASS, 38/38.
- Typecheck Node/Web: PASS.

### Kết quả mở rộng

- Full local runtime: PASS.
- Production build: PASS.
- Retry item media thật chưa chạy vì batch cũ đã ở trạng thái terminal `failed`
  và hàng đợi UI sau đó đã đổi sang video khác. Không sửa cưỡng bức journal.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Giữ checkpoint hiện có để retry downstream không gọi lại hai lượt dịch.
- Đối chiếu log mới: `cue-70-138720` phải qua finalize trong `1.80x`; sáu cue
  overflow tương đương phải xuất hiện trong một log request gateway ban đầu.
