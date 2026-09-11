# TASK-20260909-YOUTUBE-SEO: Tích hợp metadata YouTube SEO/GEO

- **Trạng thái:** Đã kiểm chứng trong phạm vi tính năng; suite toàn dự án còn lỗi nền ngoài phạm vi
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-09

---

## 1. Mục Tiêu (Goal)

Mở rộng hai luồng Video Editor và AutoShort để sinh metadata YouTube từ SRT, cho phép cấu hình locale/thị trường/giọng thương hiệu, rồi lưu đúng một file `tieude.txt` bên cạnh video. File gồm title, description ngắn gọn trong một paragraph và tags.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Một `tieude.txt` UTF-8 gồm title, một paragraph description và tags; không ghi đè file đã có.
- [x] Metadata được validate theo giới hạn YouTube trước khi ghi.
- [x] Cấu hình SEO/GEO có defaults, locale tường minh không bị AutoShort ghi đè, preset không chứa API key.
- [x] Cả Video Editor và AutoShort truyền cấu hình và hiển thị/copy/mở kết quả.
- [x] Lỗi hoặc hủy metadata không làm mất video render thành công.
- [x] Typecheck pass 100% không có lỗi (`npm.cmd run typecheck`).
- [x] 43 test liên quan pass, gồm fixture FFmpeg thực và loopback AI.
- [ ] Nghiệm thu thao tác UI thủ công và chất lượng output từ provider thật.
- [ ] Toàn bộ `test:local-runtime` xanh; hiện bị chặn bởi 12 lỗi `dubbing-plan.test` thuộc thay đổi dubbing/translation có sẵn trong working tree.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Shared contract/codec/preset cho metadata SEO.
  - Prompt nguồn-sát-SRT, digest và adapter metadata ở Electron main.
  - Ghi sidecar an toàn sau khi video đã được xác thực.
  - Cấu hình và kết quả trong Video Editor/AutoShort.
  - Unit, contract, integration và FFmpeg fixture liên quan.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Tự đăng video, nghiên cứu từ khóa trực tuyến, score xếp hạng hoặc cam kết citation/ranking.
  - Sửa các lỗi `dubbing-plan.test` và thay đổi translation/dubbing đang tồn tại trước task.
  - Gọi Gemini/OpenAI trả phí hoặc xác nhận chất lượng SEO ngoài production.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Mở rộng pipeline `videoTitle` hiện hữu và giữ các trường `title`, `titlePath`, `titleError`; bổ sung `seoMetadata` optional.
- *Lý do:* Giữ tương thích IPC/UI cũ và không tạo một subsystem AI thứ hai.
- *Lựa chọn:* Chuẩn bị metadata song song với render nhưng chỉ ghi sau probe và so digest.
- *Lý do:* Giữ hiệu năng hiện tại mà không ghi sidecar cho video hỏng hoặc tái dùng kết quả sai cấu hình/thời lượng.
- *Lựa chọn:* Dùng tên cố định `tieude.txt`, containment và exclusive create (`wx`).
- *Lý do:* Chặn path traversal và không ghi đè dữ liệu người dùng.
- *Lựa chọn:* Description mặc định `short`, luôn là một paragraph; schema chỉ có title/description/tags.
- *Lý do:* Đúng yêu cầu người dùng và tránh score/citation giả.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/shared/videoSeo.ts`
- `[NEW]` `src/renderer/src/components/VideoSeoResult.tsx`
- `[NEW]` `tests/video-seo.test.ts`
- `[MODIFY]` `src/shared/types.ts`, `src/shared/videoTitle.ts`
- `[MODIFY]` `src/main/videoTitle.ts`, `src/main/burn.ts`, `src/main/autoShortItemCoordinator.ts`
- `[MODIFY]` `src/renderer/src/components/VideoTitleSettings.tsx`, `AutoShort.tsx`, `VideoEditor.tsx`
- `[MODIFY]` `tests/video-title.test.ts`, `burn-video-title.test.ts`, `autoshort-title-overlap.test.ts`, `autoshort-ui-contract.test.ts`
- `[MODIFY]` `scripts/run-local-runtime-tests.mjs`, `docs/domain.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime -- video-seo.test video-title.test burn-video-title.test autoshort-title-overlap.test autoshort-video-title.test autoshort-ui-contract.test
npm.cmd run build
npm.cmd run test:local-runtime
npm.cmd run test:local-runtime -- dubbing-plan.test
git diff --check
```

### Kết quả thực tế

- `CODE_CONFIRMED`: contract, parser/formatter, prompt, digest, safe writer, IPC result, hai UI callsite và preset đã được nối trong code.
- `TEST_CONFIRMED`: typecheck PASS; build PASS; 43/43 test trong phạm vi PASS, gồm 6 codec, 18 generator, 9 burn/FFmpeg, 3 overlap, 3 request contract và 4 UI contract.
- `TEST_CONFIRMED`: `git diff --check` exit 0; có cảnh báo line-ending CRLF ở `tests/translation-orchestrator.test.ts`, không phải lỗi whitespace.
- `KNOWN_FAILURE_OUT_OF_SCOPE`: full `test:local-runtime` exit 1. Chạy riêng `dubbing-plan.test` xác nhận 29 PASS, 12 FAIL ở tempo/rephrase/rescue đang dở; các stack lỗi không đi qua module SEO.
- `UNKNOWN`: chưa thao tác trực tiếp UI save/load/reset/copy/open trong Electron.
- `UNKNOWN`: chưa gọi provider thật, chưa đánh giá chất lượng metadata bằng người và không có bằng chứng cải thiện ranking/citation.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Prompt và parser bảo vệ schema/ràng buộc nguồn nhưng không thể tự chứng minh mọi output LLM đều đúng sự thật; provider thật cần review mẫu.
- Working tree chứa nhiều thay đổi có trước task, trong đó có các file giao nhau. Không stage, commit, hoàn nguyên hoặc sửa lỗi dubbing ngoài phạm vi.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Nghiệm thu UI thực ở cả Video Editor và AutoShort: đổi locale, save/load/reset preset, chạy/hủy, copy từng trường/copy toàn bộ và mở `tieude.txt`.
- Nếu dùng provider thật, chạy một sample nhỏ theo provider do người dùng chọn, không ghi key vào log; đối chiếu title/description/tags với toàn bộ SRT.
- Chỉ đưa nhánh vào merge/PR sau khi chủ sở hữu xử lý hoặc chấp nhận riêng 12 lỗi nền `dubbing-plan.test`.
