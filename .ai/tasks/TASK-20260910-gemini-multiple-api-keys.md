# TASK-20260910: Nhiều API key Gemini và tự chuyển khi hết quota

- **Trạng thái:** Đã kiểm chứng tại checkout bằng mock/offline
- **Người thực hiện:** Codex; reviewer `review_gemini_keys`
- **Thời gian:** 2026-09-10

## 1. Mục Tiêu (Goal)

Cho phép người dùng thêm nhiều key trong phần Gemini, chuyển sang key khác khi một key gặp hạn mức và dùng chung danh sách cho các chức năng Gemini hiện có.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Thêm/xóa, dán nhiều dòng, tối đa 20 key duy nhất; nhận key cũ.
- [x] Đổi key trên HTTP 429, giữ model dự phòng, có cooldown và hủy tác vụ.
- [x] Không đưa key đã lưu về renderer, vào URL hoặc preset.
- [x] Sửa được danh sách không đọc được bằng thao tác thay thế rõ ràng.
- [x] `npm.cmd run typecheck` pass; 97 kiểm thử liên quan pass.
- [x] Smoke giao diện bằng component thật + IPC giả; có tài liệu và log bằng chứng.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

Quản lý key, Gemini transport, typed IPC, các nơi nhập key của Phụ đề/OCR, AutoShort và tạo tiêu đề. Giữ các thay đổi chia câu/SEO đang có trong checkout. Không tạo key, đổi billing/quota, gọi API trả phí, đóng gói hoặc khởi động lại ứng dụng.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

Pool dùng chung theo app profile, ưu tiên key thành công và theo dõi cooldown từng model để giữ model fallback. Danh sách ghi tuần tự qua tệp tạm; giữ cơ chế safeStorage cũ và API save thay toàn bộ để tương thích. Chuyển key mỗi lượt hữu hạn; retry vận chuyển vẫn thuộc scheduler hiện có. Google áp dụng quota theo project/model nên nhiều key cùng project không tăng quota.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/main/geminiKeys.ts`, `src/renderer/src/components/GeminiKeys.tsx`, `tests/gemini-keys.test.ts`.
- `[MODIFY]` `src/main/gemini.ts`, dòng tạo adapter Gemini trong `src/main/autoshort.ts`, các handler quản lý Gemini trong `src/main/index.ts`.
- `[MODIFY]` `src/preload/index.ts`, các kiểu Gemini trong `src/shared/types.ts`.
- `[MODIFY]` tích hợp `GeminiKeys` trong `GeminiKey.tsx`, `AutoShort.tsx`, `VideoTitleSettings.tsx`.
- `[MODIFY]` `scripts/run-local-runtime-tests.mjs`, `tests/video-title.test.ts`, `tests/ipc-origin-validation.test.ts`.
- `[NEW]` `docs/gemini-api-keys.md`, `docs/reviews/2026-09-10-gemini-api-keys/` và bản ghi này.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs gemini-keys.test translation-provider-contract.test translation-orchestrator.test translation-transport.test video-title.test video-seo.test autoshort-ui-contract.test ipc-origin-validation.test
node docs/reviews/2026-09-10-gemini-api-keys/ui-harness.mjs
git diff --check
```

Typecheck PASS; 97/97 runtime tests PASS; UI offline PASS. Chi tiết, giới hạn bằng chứng và reviewer: [verification.md](../../docs/reviews/2026-09-10-gemini-api-keys/verification.md).

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Chạy lại bản dev/build từ checkout để sử dụng tính năng. Chưa đóng gói hoặc cài bản mới. Khi nghiệm thu live, người dùng nhập key của mình trong app; kiểm tra chuyển key với quota/provider thật. Danh sách dùng chung, key cùng Google project chia sẻ quota. Không coi mock fetch và browser harness là bằng chứng live provider/Electron.
