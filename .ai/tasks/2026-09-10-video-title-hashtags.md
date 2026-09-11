# TASK-20260910-VIDEO-TITLE-HASHTAGS: Xuất hashtags trong tieude.txt

- **Trạng thái:** Đã sửa tương thích dữ liệu cũ và cập nhật bản Windows local
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-10

---

## 1. Mục Tiêu (Goal)

Sửa luồng metadata SEO để file `tieude.txt` cạnh video có thêm khối `Hashtags:`. Hashtags được AI trả riêng, không chèn vào title/description; response cũ thiếu trường này vẫn được fallback từ tags.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] `VideoSeoMetadata` có hashtags và formatter ghi `Hashtags:` vào `tieude.txt`.
- [x] Hashtag được chuẩn hóa có dấu `#`, không khoảng trắng, dedup và giới hạn 500 ký tự.
- [x] Provider response cũ thiếu hashtags vẫn tạo được hashtags từ tags.
- [x] UI hiển thị và cho copy hashtags.
- [x] Metadata SEO cũ trong localStorage không còn làm Renderer sập khi thiếu `hashtags`.
- [x] `npm.cmd run typecheck` pass.
- [x] Các suite SEO/title/burn/overlap/UI liên quan pass.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** shared metadata contract/formatter, SEO prompt/digest, result UI, tương thích state cũ, tests và domain/task documentation.
- **Nằm ngoài phạm vi:** không tự đăng YouTube, không nghiên cứu keyword trực tuyến, không thay đổi các pipeline dubbing/OCR/translation khác.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* yêu cầu trường `hashtags` trong prompt mới và tăng `SEO_PROMPT_VERSION` lên `video-seo-v2`.
- *Lý do:* invalidates prepared metadata theo schema cũ và bảo đảm provider mới sinh hashtag riêng.
- *Lựa chọn:* khi thiếu trường hoặc trường rỗng, chuyển tags thành hashtag bằng cách bỏ khoảng trắng/ký tự phân cách.
- *Lý do:* tương thích provider cũ và không làm mất file metadata chỉ vì response chưa có field mới.
- *Lựa chọn:* chuẩn hóa lại metadata tại biên UI bằng `normalizeVideoSeoMetadata`, trả về `null` nếu state cũ hỏng.
- *Lý do:* `localStorage` có thể chứa task từ phiên bản trước TypeScript contract; không được tin shape hiện tại khi render hoặc để một field thiếu làm sập toàn bộ giao diện.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/shared/types.ts`
- `[MODIFY]` `src/shared/videoSeo.ts`
- `[MODIFY]` `src/main/videoTitle.ts`
- `[MODIFY]` `src/renderer/src/components/VideoSeoResult.tsx`
- `[MODIFY]` `src/renderer/src/components/VideoTitleSettings.tsx`
- `[MODIFY]` các test `video-seo`, `video-title`, `burn-video-title`, `autoshort-title-overlap`, `autoshort-ui-contract`
- `[MODIFY]` `docs/domain.md` và tài liệu SEO/GEO liên quan

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
cmd.exe /d /c "npm.cmd run typecheck"
cmd.exe /d /c "npm.cmd run test:local-runtime -- video-seo.test autoshort-ui-contract.test video-title.test burn-video-title.test autoshort-title-overlap.test"
cmd.exe /d /c "npm.cmd run package:win"
git diff --check
```

### Kết quả thực tế

- `TEST_CONFIRMED`: typecheck node và web pass, 0 lỗi.
- `TEST_CONFIRMED`: 8 + 4 + 18 + 9 + 3 = 42 test pass, 0 fail; có regression cho metadata persisted thiếu hashtags, burn suite có fixture FFmpeg thực và kiểm tra nội dung `Hashtags:`.
- `TEST_CONFIRMED`: `npm.cmd run package:win` pass; font packaged verification và `package:verify` pass.
- `TEST_CONFIRMED`: bộ cài đã cập nhật local; SHA-256 `C:\Users\PC\AppData\Local\Programs\TediaPros\TediaPros.exe` khớp `dist\\win-unpacked\\TediaPros.exe`.
- `TEST_CONFIRMED`: app khởi động lại với cửa sổ `TediaPros`, tiến trình phản hồi; log khởi động mới không còn lỗi Renderer `.join`.
- `TEST_CONFIRMED`: `git diff --check` exit 0; chỉ có cảnh báo line ending CRLF/LF đã tồn tại ở file translation không thuộc task.
- `CODE_CONFIRMED`: title/description vẫn không nhận hashtag; hashtags nằm ở field và khối file riêng.
- `KNOWN_FAILURE_OUT_OF_SCOPE`: full `npm.cmd run test:local-runtime` exit 1 vì 2 test `translation-qualification` không resolve được đường dẫn repo từ sandbox/esbuild; không liên quan luồng SEO/title.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Chưa chạy provider Gemini/OpenAI thật; chất lượng ngôn ngữ và lựa chọn hashtag thực tế vẫn cần review mẫu.
- Ảnh lỗi ban đầu được đối chiếu với log local: `Cannot read properties of undefined (reading 'join')`; nguyên nhân là task SEO cũ thiếu `hashtags`, không phải lỗi provider hay dependency.
- Working tree có nhiều thay đổi sẵn có ngoài phạm vi; không stage/commit hoặc hoàn nguyên chúng.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Khi chạy lại một video đã xuất với `tieude.txt` cũ, exclusive create vẫn giữ file cũ; cần xuất vào thư mục video mới để thấy format Hashtags mới.
- Có thể kiểm tra một mẫu provider thật và đối chiếu hashtags với toàn bộ SRT trước khi xem là nghiệm thu chất lượng nội dung.
