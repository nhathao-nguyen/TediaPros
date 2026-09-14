# 2026-09-14-SHORT-METADATA: Metadata tối ưu cho video ngắn

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-14

---

## 1. Mục Tiêu (Goal)

Tối ưu prompt và ràng buộc đầu ra metadata từ SRT cho một bộ nội dung dùng chung YouTube Shorts, TikTok và Reels, giữ nguyên gateway CreateMediaTool và hợp đồng xuất `tieude.txt`.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Prompt đọc toàn bộ context được cung cấp, bảo toàn tên, số, phủ định, điều kiện và không làm theo chỉ dẫn nằm trong SRT.
- [x] Metadata mới có description theo độ dài short/medium/long, tối đa 8 tags và 3 hashtags; hashtags rỗng có chủ ý được giữ nguyên.
- [x] UI mô tả đúng 1–2 câu ở mức short và có nút sao chép caption cho TikTok/Reels.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Test cases liên quan pass kèm bằng chứng log.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):** prompt metadata short, validator sau parser, schema danh sách, migration hashtag, nhãn UI, caption clipboard, fixture đánh giá và tài liệu domain.
- **Nằm ngoài phạm vi (Out of Scope):** model selection, context limit, timeout, provider transport, source CreateMediaTool, đăng tự động và ba object metadata riêng theo nền tảng.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Prompt được tách sang `src/main/videoSeoPrompt.ts` để phần chính sách biên tập không trộn với transport và publication.
- Validator short nằm ở `src/shared/videoSeoPolicy.ts` để áp dụng hard limits sau normalization nhưng không làm hỏng persisted record cũ.
- Repair chỉ nhận mã lỗi hữu hạn; không nhận raw response bị từ chối.
- Caption là phép định dạng thuần từ description + hashtags; không đổi IPC hoặc định dạng `tieude.txt`.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/main/videoSeoPrompt.ts`
- `[NEW]` `src/shared/videoSeoPolicy.ts`
- `[MODIFY]` `src/main/videoTitle.ts`
- `[MODIFY]` `src/shared/videoSeo.ts`
- `[MODIFY]` `src/shared/aiOutput.ts`
- `[MODIFY]` `src/renderer/src/components/VideoTitleSettings.tsx`
- `[MODIFY]` `src/renderer/src/components/VideoSeoResult.tsx`
- `[MODIFY]` `tests/video-title.test.ts`
- `[MODIFY]` `tests/video-seo.test.ts`
- `[NEW]` `tests/fixtures/video-seo-short-eval.json`
- `[MODIFY]` `docs/domain.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs video-seo.test video-title.test ai-output.test burn-video-title.test autoshort-title-overlap.test autoshort-video-title.test autoshort-ui-contract.test
npm.cmd run fonts:prepare
npm.cmd run fonts:verify
npm.cmd run test:local-runtime
npm.cmd run build
git diff --check
```

### Kết quả thực tế

- Baseline trước thay đổi: 60 test liên quan pass, 0 fail.
- Vòng TDD prompt: test mới fail với prompt YouTube cũ; sau thay đổi `video-title.test` pass 26/26.
- Vòng TDD policy/repair/caption/schema: các test mới đã được quan sát fail trước implementation tương ứng.
- `npm.cmd run typecheck`: PASS, 0 lỗi TypeScript ở node và web.
- 7 suite trọng tâm: PASS, 66 test pass, 0 fail; gồm contract test đọc đủ 12 fixture đánh giá.
- `npm.cmd run test:local-runtime`: PASS, 914 test pass, 0 fail sau khi chuẩn bị font runtime đã ghim checksum cho worktree.
- `npm.cmd run build`: PASS. Vite vẫn báo các cảnh báo static/dynamic import đã có sẵn; không chặn build.
- `git diff --check`: PASS. Không có thay đổi tại `src/main/gemini.ts`, `src/main/openai.ts` hoặc CreateMediaTool.
- Review độc lập: không có lỗi Critical hoặc Important; hai góp ý Minor về fixture và task record đã được xử lý.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Chưa chạy live gateway qualification; fixture tổng hợp đã có contract test nhưng chưa chấm chất lượng đầu ra thật từ Gemini 3.1 Pro.
- Chưa xác minh GUI bằng mắt trên app dev/build.
- Metadata và test không chứng minh khả năng tăng lượt xem trên nền tảng thật.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Giữ nguyên tám MP4 untracked trong checkout chính; chúng không thuộc task này.
- Không stage bằng `git add .`; không sửa hoặc commit source CreateMediaTool.
