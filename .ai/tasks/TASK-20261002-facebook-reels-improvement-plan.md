# [TASK-20261002-facebook-reels-improvement-plan]: Nghiên cứu fb-reels và đề xuất cải tiến crawler TediaPros

- **Trạng thái:** Hoàn thành nghiên cứu và phương án; chưa triển khai sản phẩm.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-10-02.

## 1. Mục Tiêu (Goal)

Đọc cách lấy Reels trong `F:\Son\tool\fb-reels`, đối chiếu với TediaPros và xây dựng phương án cải tiến. Người dùng xác nhận ưu tiên quét đủ Reels profile/fanpage và lấy tiêu đề chính xác.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Phân biệt hành vi code thực của fb-reels với README/kế hoạch cũ.
- [x] Đối chiếu luồng normalize, DOM discovery, metadata network/yt-dlp, session, stop/progress, IPC và queue của TediaPros.
- [x] Có phương án lựa chọn, các đợt triển khai, bản đồ tệp và bộ kiểm tra theo mục tiêu người dùng.
- [x] Typecheck Node/Web pass.
- [x] Test hiện có liên quan pass, phạm vi bằng chứng được ghi rõ.
- [x] Lưu tài liệu và bản ghi bàn giao theo mẫu repository.
- [x] Chỉ tạo tài liệu; giữ nguyên source của hai dự án.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** nghiên cứu mã nguồn, chạy test offline có sẵn, probe cô lập logic nguồn, lập phương án.
- **Ngoài phạm vi:** sửa crawler, cài runtime/dependencies, dùng account/cookie thật, crawl/tải Facebook thật, thay đổi AutoShort hoặc thêm article/Excel/CapCut workflow.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Đề xuất Electron + observer network có scope/ID + DOM dự phòng, tận dụng downloader và cookie manager hiện có.
- Không port nguyên Python/Playwright: thêm runtime/profile lifecycle trong khi parser tham khảo vẫn có rủi ro caption sai Reel.
- Bắt đầu từ nền URL/session/partial/cancel; sau đó metadata có định danh; cuối cùng xác nhận completeness bằng connection đúng nguồn.
- Không dùng số vòng cuộn, số entry vừa thấy hoặc đoạn caption dài nhất làm bằng chứng hoàn tất/chính xác.
- Đây là đề xuất chưa triển khai. Các kết luận về Facebook thật vẫn cần fixture và đối chứng live.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` [Phương án cải tiến](F:/Son/tool/TediaPros/docs/facebook-reels-improvement-plan.md).
- `[NEW]` [Bản ghi bàn giao](F:/Son/tool/TediaPros/.ai/tasks/TASK-20261002-facebook-reels-improvement-plan.md).

Không có thay đổi product code, test code hoặc dependencies.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

Tại `F:\Son\tool\TediaPros`:

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs facebook-reels-crawler.test
```

Tại `F:\Son\tool\fb-reels`:

```powershell
python -B -m pytest -p no:cacheprovider -q tests/test_graphql_parser.py tests/test_url_helper.py
```

### Kết quả thực tế

- Typecheck: PASS, exit code 0, cả Node và Web.
- TediaPros: PASS 3/3 test, 0 failed; chỉ kiểm tra URL.
- fb-reels: PASS 16/16 test, 0 failed; parser/URL helper offline.
- Probe TypeScript dùng source qua transpile và Electron mock: host/protocol sai vẫn nhận; `useCookies=false` vẫn nạp cookie 2/2 lần; direct job không set lại proxy; batch 260 trả 260 dù ngưỡng code là 250; plain profile không vào crawler.
- Probe Python dùng parser nguồn và payload tổng hợp: caption của recommendation dài hơn thay caption mục tiêu; JSON có prefix giả lập trả caption rỗng.
- Các probe không sửa mã nguồn và không truy cập Facebook.
- Electron cài tại workspace là 34.5.8; API debugger được đối chiếu types và tài liệu upstream cùng phiên bản.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Không kiểm tra Facebook live, phiên đăng nhập, checkpoint hay schema connection thực hiện tại.
- Không chạy toàn bộ test crawler Python do thiếu trafilatura/pandas/bs4; không bổ sung dependency.
- Không benchmark hoặc xác nhận các claim hiệu năng của README fb-reels.
- Parser connection danh sách là phần mới được đề xuất, không phải chức năng đã có trong fb-reels.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Khi người dùng yêu cầu triển khai, dùng phương án làm brief, kiểm tra lại trạng thái worktree và chốt phạm vi đợt đầu. Viết regression test cho URL/session/partial/cancel trước khi sửa product code; bổ sung fixture network có scope/ID trước khi cam kết quét đủ và tiêu đề đúng trên Facebook thật.
