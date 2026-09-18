# VI-DUB-FIX-20260916: Khắc phục các finding trọng yếu sau review dịch/lồng tiếng

- **Trạng thái:** Đã kiểm chứng cục bộ.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-16.

## 1. Mục tiêu

Sửa các lỗi nối luồng và safety gate quan trọng được xác nhận trong review `VI-DUB-REVIEW-20260916`: mapping cue nội bộ của Gateway, phản hồi bị cắt, journal retry TTS, lệch partition budget/TTS, false-reject semantic và checkpoint vượt giới hạn reader.

## 2. Tiêu chuẩn nghiệm thu

- [x] Draft/review Gateway nhận source slice chính xác cho mọi ID cue chia nội bộ.
- [x] Draft/review bị `finish_reason=length` quay lại scheduler để strict-split, không nhận partial hoặc checkpoint draft.
- [x] Cùng job/item giữ lại candidate TTS đã chọn và audio app-owned qua retry; không dispatch lại TTS trong regression.
- [x] Source-repair chặn thay đổi số liệu rõ ràng trước TTS; không nâng tempo để che lỗi nghĩa.
- [x] Speech budget Gateway và TTS dùng cùng partition source cố định.
- [x] Guard lượng–đơn vị dùng multiset, chấp nhận đổi thứ tự inventory nhưng vẫn bắt object/quantity thay đổi.
- [x] Writer checkpoint từ chối payload vượt đúng 2 MiB reader cap trước khi thay file cũ.
- [x] `npm.cmd run typecheck` pass (node/web, 0 lỗi).
- [x] 11 suite runtime liên quan: 182 pass, 0 fail sau khi cập nhật contract prompt v10.

## 3. Phạm vi và giới hạn

**Trong phạm vi:** Gateway text workflow, AutoShort coordinator/dubbing recovery, semantic guard có bằng chứng xác định, source grouping, checkpoint helper và tài liệu hợp đồng.

**Ngoài phạm vi:** Gemini tạo giọng, gọi Gateway/TTS thật, render video thật, package/install Windows, token counter được Gateway chứng nhận, human evaluation tiếng Việt và sharded checkpoint/resume cho payload >2 MiB.

## 4. Quyết định

- Full source ledger vẫn read-only context. Chỉ internal split IDs nhận source slice lặp lại để giữ prompt short thông thường trong budget.
- Truncation là tín hiệu scheduler chứ không phải lỗi protocol chung: không tự đóng JSON hỏng và không nhận bất kỳ item nào từ lượt bị cắt.
- Journal chỉ tồn tại trong process/job; metadata không vào checkpoint/IPC/log. Khi coordinator đang chạy, trim WAV của candidate accepted được copy sang thư mục audit app-owned trước khi scratch bị xóa.
- Không giả định validator đa ngôn ngữ có thể chứng minh mọi noun/relation. Gate mới chỉ hard-reject sự thay đổi số lượng có thể xác minh; candidate không có bằng chứng vẫn được telemetry gắn `source-repair-unverified`.
- Thay vì thêm một lượt model chỉ để đề xuất boundary, TTS quay về partition deterministic theo source giống Gateway budget. Kiến trúc frozen revision/proposal đầy đủ vẫn là work tiếp theo nếu cần boundary động.
- Checkpoint lớn được fail rõ ràng trước publication; chưa thay bằng format shard nên không tuyên bố resume payload lớn được hỗ trợ.

## 5. Tệp thay đổi

- `[MODIFY]` `src/main/geminiGatewayPrompts.ts`, `src/main/geminiGateway.ts`.
- `[MODIFY]` `src/main/dubbing/synthesis.ts`, `src/main/dubbing/plan.ts`, `src/main/autoshort.ts`, `src/main/autoShortItemCoordinator.ts`.
- `[MODIFY]` `src/main/autoShortContentQuality.ts`, `src/main/translation/checkpoint.ts`.
- `[MODIFY]` `tests/dubbing-plan.test.ts`, `tests/autoshort-item-scope.test.ts`, `tests/autoshort-content-quality.test.ts`, `tests/speech-unit-planner.test.ts`, `tests/gemini-gateway-prompts.test.ts`, `tests/gemini-gateway-long-context.test.ts`, `tests/gemini-gateway-contract.test.ts`, `tests/translation-resume.test.ts`.
- `[MODIFY]` `docs/architecture.md`, `docs/domain.md`.

## 6. Kiểm chứng

```powershell
cmd.exe /c "npm.cmd run typecheck"
node scripts/run-local-runtime-tests.mjs dubbing-plan.test autoshort-item-scope.test autoshort-content-quality.test speech-unit-planner.test dubbing-grouping.test gemini-gateway-prompts.test gemini-gateway-long-context.test gemini-gateway-contract.test gemini-gateway-draft-resume.test translation-orchestrator.test translation-resume.test
node scripts/run-local-runtime-tests.mjs gemini-gateway-contract.test
```

Kết quả: typecheck node/web PASS. Các suite liên quan đều PASS sau khi contract v10 được cập nhật; tổng 182 test pass, 0 fail. Fixtures dùng mock fetch/audio/checkpoint local, không gọi provider, TTS hoặc render thực.

## 7. Bàn giao

- Không reset/clean/commit worktree: repository có nhiều thay đổi bẩn không thuộc task.
- Cần live qualification riêng nếu muốn khẳng định chất lượng tiếng Việt, voice, RAM/token sát 1M hoặc bản cài Windows.
- Ưu tiên tiếp theo nếu mở rộng: verifier semantic đa ngôn ngữ độc lập cho source-repair, frozen boundary revision có proposal/validation, checkpoint sharding và benchmark audit memory cho full-ledger nhiều batch.
