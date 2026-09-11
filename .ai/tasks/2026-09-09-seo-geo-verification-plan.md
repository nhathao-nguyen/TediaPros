# TASK-20260909-SEO-GEO-PLAN: Kiểm chứng và bổ sung kế hoạch metadata YouTube

- **Trạng thái:** Đã kiểm chứng nghiên cứu và hiện trạng; tính năng mới chưa triển khai.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-09.

## 1. Mục Tiêu (Goal)

Kiểm chứng bài SEO/GEO/AEO người dùng cung cấp rồi bổ sung kế hoạch tích hợp app Linhakaka SEO Localizer vào TediaPros. Giữ lựa chọn người dùng: một tiêu đề tốt nhất, description ngắn một paragraph và tags trong một `tieude.txt`; cấu hình theo nhóm của app gốc.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Đối chiếu các nhận định quan trọng bằng nguồn Google/Bing/YouTube chính thức, ghi phạm vi và ngày.
- [x] Phân biệt thông tin đã xác nhận, đề xuất điểm số và hiệu quả chưa được đo.
- [x] Bổ sung đặc tả/kế hoạch khu trú vào metadata của TediaPros, không mở thành discovery engine.
- [x] `npm.cmd run typecheck` PASS cho hiện trạng.
- [x] Bốn suite title liên quan PASS, ghi rõ chưa phải kiểm thử tính năng mới.
- [x] Không sửa source/test/config đang có; chỉ thêm tài liệu.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **In Scope:** đọc app tham chiếu và source liên quan; kiểm chứng bài đính kèm; viết spec/plan; chạy baseline checks.
- **Out of Scope:** triển khai code SEO; gọi provider trả phí; thay đổi/publish app AI Studio; đăng YouTube; kết nối analytics; chấm điểm ranking/citation; chỉnh TTS/dịch/OCR.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Mở rộng luồng `videoTitle` hiện hữu và các provider ở main, không nhúng URL app AI Studio.
- Xuất một file ba trường; short description là mặc định biên tập, không phải “chuẩn SEO” bắt buộc.
- AEO áp dụng như cách viết ý chính/đáp án khi phù hợp; không xuất FAQ hoặc citation bịa từ SRT.
- Không đưa 10 scores 0–100 vào v1 vì thiếu định nghĩa và dữ liệu hiệu chuẩn; metrics thực phải có nguồn và phạm vi riêng.
- Giữ bảo toàn video, exclusive file write, cancellation và kiểm tra digest; sửa override locale được ghi thành task triển khai, chưa sửa trong lần này.
- Dùng `writing-plans` để tách contract/generator/publish/UI/nghiệm thu và `verification-before-completion` để phân biệt baseline đã chạy với plan chưa làm.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` [Spec và kiểm chứng](../../docs/superpowers/specs/2026-09-09-youtube-seo-geo-design.md).
- `[NEW]` [Kế hoạch triển khai](../../docs/superpowers/plans/2026-09-09-youtube-seo-geo-integration.md).
- `[NEW]` Bản ghi task này.

Không sửa hoặc xóa tài liệu/source/test đã có, không commit/push. Hai file giao với tính năng tương lai (`autoShortItemCoordinator.ts`, `AutoShort.tsx`) đang có thay đổi người dùng; người triển khai phải kiểm tra diff mới trước khi sửa.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Lệnh baseline đã chạy

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime -- video-title.test burn-video-title.test autoshort-title-overlap.test autoshort-video-title.test
```

### Kết quả thực tế

- Typecheck Node + Web: **PASS**, exit 0.
- `video-title.test`: **15 pass**.
- `burn-video-title.test`: **9 pass**.
- `autoshort-title-overlap.test`: **3 pass**.
- `autoshort-video-title.test`: **3 pass**.
- Tổng **30 pass, 0 fail, 0 skip**, exit 0.
- Fixture render FFmpeg 2 giây + provider loopback chạy thành công; có kiểm tra hủy mà giữ MP4. Có log FFmpeg thử đọc file catalog/license như font, nhưng suite không fail; không sửa font ngoài scope.
- Nguồn web, kết luận và giới hạn được dẫn ngay tại từng nhận định trong spec, không sao chép cả bài nguồn.
- QA ba file Markdown: PASS cho liên kết nội bộ, code fences, newline/whitespace, không còn placeholder và không đánh dấu task triển khai là đã làm. `git diff --check`: exit 0; cảnh báo CRLF ở test dịch có sẵn không phải lỗi của tài liệu mới.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Chưa sinh metadata mới: chưa có code mới để nghiệm thu.
- Chưa kiểm tra UI mới, Gemini/OpenAI live, ranking hoặc citation của nội dung đã đăng.
- Các báo cáo Google/Bing được kiểm chứng ở tài liệu công bố, không phải tài khoản người dùng. API và quyền truy cập analytics chưa được xác minh.
- Không chuyển baseline local thành production/provider acceptance.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Thực hiện Tasks 1–5 trong plan khi người dùng yêu cầu triển khai. Giữ định dạng một file và kiểm tra code hiện tại một lần nữa do worktree đang có công việc song song. Không tự triển khai các mục analytics/entity graph/content gap ngoài phạm vi v1.
