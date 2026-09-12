# TASK-20260911-AUTOSHORT-AUDIO-DURATION-REPROBE-FIX: Loại Bỏ Probe Lặp Trước Tempo

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

---

## 1. Mục Tiêu (Goal)

Sửa lỗi item Auto Short dừng với `Không thể đọc thời lượng audio` ngay sau khi toàn bộ WAV TTS đã được trim và đo thành công.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Xác định video nguồn có metadata hợp lệ và FFprobe đọc được.
- [x] Xác nhận 45 artifact TTS cache của item đều đọc được bằng FFprobe.
- [x] Planner truyền thời lượng trim đã đo sang bước tempo.
- [x] Bước tempo không probe lặp lại WAV đầu vào khi đã có số đo hợp lệ.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Test liên quan pass và video lỗi chạy lại qua bước tempo.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):** Hợp đồng audio adapter của dubbing, Auto Short tempo adapter và regression test.
- **Nằm ngoài phạm vi (Out of Scope):** Không thay đổi trần tempo `1.80x`, trim calibration, nội dung dịch, TTS cache hoặc video nguồn.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Thêm `measuredInputDuration` tùy chọn vào `applyTempo` và truyền `naturalDuration` đã xác thực từ planner.
- *Lý do:* Measured pass là nguồn dữ liệu có thẩm quyền. Probe lại cùng file trước DSP là dư thừa và đã tạo điểm lỗi sau khi 45 lần trim/probe trước đó đều thành công.
- *Giữ tương thích:* Tham số mới ở cuối và tùy chọn; adapter cũ vẫn hợp lệ. Auto Short chỉ fallback về probe khi caller không cung cấp số đo.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/dubbing/synthesis.ts`
- `[MODIFY]` `src/main/autoshort.ts`
- `[MODIFY]` `tests/dubbing-plan.test.ts`
- `[MODIFY]` `docs/adr/005-source-anchored-dubbing-tempo-policy.md`
- `[NEW]` `.ai/tasks/TASK-20260911-autoshort-audio-duration-reprobe-fix.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
node scripts/run-local-runtime-tests.mjs dubbing-plan.test
node scripts/run-local-runtime-tests.mjs autoshort-tts-pipeline.test
npm.cmd run typecheck
```

### Kết quả thực tế:

- RED: regression test fail `undefined !== 2.7`, xác nhận planner chưa truyền số đo trim.
- GREEN: `dubbing-plan.test` PASS 44/44.
- `autoshort-tts-pipeline.test` PASS 5/5.
- `npm.cmd run typecheck` PASS cả node và web, 0 lỗi.
- Video nguồn `7490083913512045863`: FFprobe PASS, video 211.567s, container 211.603s.
- 45/45 artifact TTS cache vừa tạo: FFprobe PASS.
- Chạy lại video thật: stage TTS PASS 45 cues/clips và stage audio PASS 45 clips; không còn lỗi `Không thể đọc thời lượng audio`. Lượt này đi tiếp đến render và lộ ra lỗi trạng thái hủy độc lập, được xử lý trong `TASK-20260911-autoshort-render-cancel-reset-fix.md`.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Không còn rủi ro đã biết trong phạm vi probe thời lượng trước tempo.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Giữ checkpoint/cache của item để các lần chạy sau tái dùng bằng chứng ASR/TTS hợp lệ.
