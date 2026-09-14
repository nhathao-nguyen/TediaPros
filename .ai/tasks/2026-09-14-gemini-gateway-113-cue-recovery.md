# TASK-20260914-GEMINI-113-RECOVERY: Phục hồi lỗi dịch video 113 cue

- **Trạng thái:** Dịch Gemini live đã qua; đã sửa lỗi timing TTS tiếp theo; chờ rerun render hoàn chỉnh
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-14

---

## 1. Mục Tiêu (Goal)

Điều tra item `41aec852-983e-4563-8d81-a2aba29c7e39` dừng ở bước dịch, giảm xác suất output JSON hỏng trên video nhiều cue và làm thao tác thử lại rõ ràng.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Xác định lỗi thực tế từ log gateway và checkpoint.
- [x] Contract giữ đủ 113 cue trong hai lượt, với output gọn hơn.
- [x] Prompt gateway không còn chỉ dẫn ranh giới thoại mâu thuẫn.
- [x] Một lần bấm thử lại chỉ chạy đúng item đã chuẩn bị.
- [x] Typecheck và test liên quan pass.
- [x] Chạy lại video 113 cue qua Gemini thật và xác nhận đủ 113 cue.
- [x] Sửa regression timing tại cue `cue-91-175050` mà không tăng trần 1.80x hoặc cắt lời.
- [ ] Rerun toàn pipeline và xác nhận video render hoàn chỉnh.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** Gemini Gateway wire contract, canonical reconstruction, prompt grouping instruction, checkpoint retry UX và cửa sổ timing TTS của cue ngắn liền nhau.
- **Giới hạn:** Không tự động chia whole-document thành nhiều request; vẫn giữ đúng hai logical generation call ở luồng thành công. Không chạy lại toàn pipeline video dài trong lượt sửa code.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Dùng `translations{cue-id:text}` trên wire để bỏ khóa `id`/`text` lặp lại. Adapter dựng lại contract `items[{id,text}]` trước parser nên validation và timestamp không đổi.
- `group_id` chỉ là context hint trong prompt gateway. Reviewer đặt dấu câu tại cue edge; code mới quyết định group TTS sau validation.
- Nút `Thử lại dịch` gọi IPC chuẩn bị generation rồi khởi chạy đúng item ngay, tránh người dùng bấm nút chạy chung khi checkpoint vẫn bị khóa.
- Quyết định giữ full protected gap dựa trên khoảng lặng thật hoặc span còn ít nhất 0,10 giây sau khi trừ 0,50 giây. Cue 560 ms liền cue sau dùng gap giảm 84 ms, có 476 ms để nói thay vì chỉ còn 60 ms.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/geminiGateway.ts`
- `[MODIFY]` `src/main/autoShortItemCoordinator.ts`
- `[MODIFY]` `src/renderer/src/components/AutoShort.tsx`
- `[MODIFY]` `src/main/dubbing/plan.ts`, `src/main/autoShortPolicy.ts`
- `[MODIFY]` `src/main/autoShortItemCoordinator.ts`
- `[MODIFY]` `tests/gemini-gateway-contract.test.ts`
- `[MODIFY]` `tests/autoshort-ui-contract.test.ts`
- `[MODIFY]` `tests/dubbing-plan.test.ts`
- `[MODIFY]` `tests/translation-resume.test.ts`
- `[MODIFY]` `docs/domain.md`, `docs/architecture.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Lỗi live đã quan sát

- Item 113 cue gọi `restore-translate` lúc `07:53:18Z`.
- Gateway log xác nhận attempt 1 và 2 nhận `Gemini returned a transient failure message`.
- Request kết thúc sau attempt 3 với `Gemini did not return one valid JSON object`; checkpoint lưu `needs-review`, không có cue dịch được chấp nhận.
- Lần chạy thường tiếp theo bị chặn đúng tại retry generation gate; ảnh giao diện chỉ hiện thông báo rút gọn.

### Các lệnh đã chạy

```powershell
node scripts/run-local-runtime-tests.mjs gemini-gateway-contract.test autoshort-ui-contract.test dubbing-grouping.test dubbing-plan.test translation-rephrase.test translation-provider-contract.test
node scripts/run-local-runtime-tests.mjs dubbing-plan.test dubbing-grouping.test autoshort-tts-pipeline.test local-runtime.test
npm.cmd run typecheck
npm.cmd run build
```

### Kết quả

- Test chọn lọc: PASS 113/113 trước thay đổi chỉ dẫn cuối; test tập trung sau thay đổi cuối PASS 31/31.
- Regression timing và pipeline liên quan: PASS 235/235 (52 dubbing plan, 20 grouping, 6 TTS pipeline, 157 local runtime/E2E).
- Checkpoint/retry/provider suites bổ sung: PASS 20/20; xác nhận `with-warnings` cùng identity được tái sử dụng còn `needs-review` và identity sai bị từ chối.
- Typecheck: PASS node và web.
- Build: PASS main, preload và renderer.

### Lần chạy live tiếp theo

- Gemini hoàn tất đủ hai logical request cho 113 cue. Request 1 cần 2 upstream attempt; request 2 cần 3 upstream attempt do hai phản hồi JSON lỗi trước khi thành công.
- Sau đó pipeline dừng tại `cue-91-175050` (`175.05–175.61`): audio tự nhiên 0,679 giây nhưng cửa sổ cũ chỉ còn khoảng 0,06 giây vì span 0,56 giây bị trừ trọn protected gap 0,50 giây.
- Regression mới xác nhận cả dubbing planner và AutoShort policy cấp cửa sổ 0,476 giây cho trường hợp này. Nhịp cần thiết xấp xỉ 1,43x, dưới trần 1,80x.

### Chưa kiểm tra

- `LIVE_RENDER_PENDING`: chưa rerun toàn pipeline sau bản sửa timing cue 91.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Trong UI mới, bấm `Thử lại dịch` một lần. App tăng retry generation và tự chạy duy nhất item lỗi.
- Nếu Gemini tiếp tục trả transient failure, giữ audit/log và phân biệt lỗi upstream với lỗi contract; không tăng vô hạn số request.
