# TASK-20260917-GATEWAY-BATCH-PLAN: Kế hoạch điều tiết gateway và batch tự phục hồi

- **Trạng thái:** Hoàn thành phần planning; implementation chưa bắt đầu.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-17.

## 1. Mục tiêu

Lập kế hoạch cụ thể cho batch nhiều video qua CreateMediaTool: shared upstream admission, pacing, cooldown, tự tiếp tục, checkpoint và đường tích hợp audio/OCR để sửa ASR tự động.

## 2. Tiêu chuẩn nghiệm thu

- [x] Đối chiếu working tree của cả TediaPros và CreateMediaTool, kể cả các sửa đổi throttling mới có.
- [x] Phân biệt limiter HTTP inbound với governor upstream; xác định retry ownership và đường bypass.
- [x] Chốt trạng thái cooldown/blocked/unknown, operation identity, cancellation, migration và rollback.
- [x] Giữ chính sách tổng ngân sách dịch đang tắt, cue ID/timing và model policy hiện hành.
- [x] Phân chặng thực hiện, tệp cần sửa và ma trận test có gate rõ ràng.
- [x] `npm.cmd run typecheck` PASS; test baseline liên quan PASS.
- [ ] Triển khai và nghiệm thu P1–P5: nằm ngoài kết quả của lượt planning này.

## 3. Phạm vi

- Trong phạm vi: đọc code, kiểm tra baseline và thêm tài liệu planning/handoff cho hai repo.
- Ngoài phạm vi lượt này: sửa runtime, restart gateway/app, chạy batch thật mới, deploy, commit/push, thay credentials hoặc tự bật API có phí.

## 4. Quyết định và lý do

- Gateway sở hữu quyền điều tiết dùng chung, vì spacing trong một client không bao phủ các ứng dụng và retry khác.
- Operation API opt-in tách cooldown dài khỏi deadline HTTP generation; registry ngăn gửi trùng khi client mất kết nối.
- TediaPros lưu trạng thái waiting-provider không terminal; nguồn/draft/translation được checkpoint trước khi nhả scratch/resource.
- Lỗi dịch vụ dùng chung chặn admission; lỗi nội dung một video không chặn mọi video.
- Auth/CAPTCHA và outcome-unknown không retry mù; không cam kết tránh mọi chặn Google.
- Media integration thực hiện sau governor/auto-resume; Gemini API chính thức là work package tùy chọn.

## 5. Tệp được thêm

- [NEW] [Kế hoạch thực hiện](../../docs/superpowers/plans/2026-09-17-gateway-batch-scheduling-and-auto-recovery.md).
- [NEW] [Thiết kế và traceability](../../docs/superpowers/specs/2026-09-17-gateway-batch-scheduling-design.md).
- [NEW] Task handoff này.
- [NEW] [Điểm vào kế hoạch bên CreateMediaTool](../../../CreateMediaTool/docs/gateway-batch-scheduling-plan.md).
- Không chỉnh mã nguồn ứng dụng. Giữ nguyên các dirty/untracked đã có.

## 6. Kiểm chứng và bằng chứng

Từ `F:\Son\tool\TediaPros`:

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-queue-throughput.test gemini-gateway-contract.test autoshort-batch-resume.test
```

- Typecheck: PASS node và web.
- Queue throughput: 7/7 PASS.
- Gemini gateway contract: 19/19 PASS.
- Batch resume: 3/3 PASS.

Từ `F:\Son\tool\CreateMediaTool`:

```powershell
go test ./internal/modules/openai/... ./internal/modules/providers/... -count=1
```

- PASS cả 3 packages.
- Probe audio/ảnh được kế hoạch dẫn lại từ lượt kiểm tra trước trong cùng phiên: sửa ASR đúng trên mẫu synthetic, 1 upstream attempt, observed 3.1 Pro. Không phát sinh probe Google mới trong lượt planning.
- Kiểm tra tài liệu: PASS 4 file, 10 local Markdown links, code fences cân bằng, không trailing whitespace hoặc placeholder marker; plan có 8 task và 41 bước chưa thực hiện. Đây là kiểm tra tài liệu, không chứng minh feature mới.
- Baseline HEAD: TediaPros `d73db03`, CreateMediaTool `f44b6ac`, cùng dirty working trees. Kết quả test không chứng nhận toàn bộ các thay đổi chưa commit hoặc production availability.

## 7. Bàn giao

Thực hiện P0 rồi P1, P2, P3, P4; P5 nối media sau khi đường batch mới được kiểm chứng. P6 chỉ triển khai khi chọn API chính thức và có cấu hình account/billing phù hợp.

Tệp cần chú ý trước khi sửa: `geminiGateway.ts`, `autoshort.ts`, `autoShortQueueRunner.ts`, `autoShortItemCoordinator.ts`, shared types/journal, gateway service/provider/config đều đang có thay đổi chưa commit. Không áp kế hoạch bằng cách thay nguyên file.
