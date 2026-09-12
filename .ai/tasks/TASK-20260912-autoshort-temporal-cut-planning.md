# TASK-20260912-AUTOSHORT-TEMPORAL-CUT-PLANNING: Đặc tả và kế hoạch Cắt đoạn trong AutoShort

- **Trạng thái:** Hoàn thành tài liệu; chức năng chưa triển khai.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-12.
- **Source baseline:** `2d4a8822c05a99bd1101f758811044631b4f88d0`, package `0.1.26`.

## 1. Mục Tiêu (Goal)

Chuyển thảo luận về cắt đoạn/cắt từng frame theo thời gian thành đặc tả có thể triển khai trong AutoShort. Xét từng nhóm tình huống theo thứ tự tệ nhất → có thể phục hồi → thuận lợi, bảo vệ nguồn và giữ đồng bộ hình, tiếng, phụ đề, OCR/STTN và lồng tiếng.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Spec ghi rõ bảng Cắt đoạn nằm trong AutoShort, không phải crop và không thêm tab cấp cao riêng.
- [x] Bao phủ đủ R01–R19, có quy tắc xử lý và phạm vi Core/extension.
- [x] Plan có T01–T14, dependencies, file đích, kiểm thử, output và gate cho từng task.
- [x] Có ma trận R01–R19 → F01–F19 → task và loại bằng chứng.
- [x] Đặc tả ba miền source/edited/output, cue provenance, per-item edit, snapshot, migration và cache invalidation.
- [x] Phân biệt CODE_CONFIRMED với PROPOSED/DOCUMENTED_ONLY/UNKNOWN; không đánh dấu implementation đã xong.
- [x] `npm.cmd run typecheck` PASS cho Node và Web, exit 0.
- [x] Kiểm tra link nội bộ, coverage, whitespace và bảo toàn dữ liệu cũ; không chạy media/runtime tests cho thay đổi chỉ có tài liệu.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Trong phạm vi:** đọc code và hướng dẫn liên quan; viết spec, plan, task record; kiểm tra tài liệu và typecheck baseline.
- **Ngoài phạm vi:** sửa source/runtime, thêm test chức năng thật, chạy TTS/provider tính phí, tạo bản build/cài WinLocal, commit/push hoặc dọn các file chưa commit khác.
- Core được lập kế hoạch trong T01–T11; thay hình giữ tiếng ở T12; gợi ý tự động/chọn transcript ở T13; nghiệm thu extension ở T14. Đây là trình tự giao, không loại bỏ các tình huống đã thảo luận.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Giữ thao tác cắt trong AutoShort để không cần xuất/nhập video trung gian bằng tay; chuẩn bị media là module nội bộ.
- Nguồn và cue ledger bất biến; edit theo item; timeline có ánh xạ source → edited → output với deleted points không có kết quả và replay có nhiều spans.
- Giữ retained segment/join provenance tới OCR/ASR/STTN/TTS, tránh ghép câu/mask hoặc lấy lại hình từ phần đã bỏ.
- Freeze toàn bộ non-secret run snapshot, lưu edit đầy đủ; hash không thay thế dữ liệu cần phục hồi. Migration/receipt của no-cut legacy được kiểm riêng.
- Giữ policy xác minh từ code: tempo 1.80x, protected gap 0.50s theo quy tắc EOF, extension 60%, slowdown 20%; feature không thay các giới hạn này.
- Codec/intermediate, VFR mapping, STTN short segment, ngưỡng review và performance cần media evidence trong implementation. Không coi ý tưởng là khả năng đã chạy.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` [Spec](../../docs/superpowers/specs/2026-09-12-autoshort-temporal-cut-design.md).
- `[NEW]` [Implementation plan](../../docs/superpowers/plans/2026-09-12-autoshort-temporal-cut.md).
- `[NEW]` Task record này.

Chỉ ba tệp Markdown mới của task; để untracked, không commit. Các tài liệu runtime hiện tại chưa sửa vì behavior mới chưa triển khai.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
npm.cmd run typecheck
git status --short --branch
git diff --check
git diff --numstat
git diff --cached --numstat
```

Ngoài ra đã chạy kiểm tra PowerShell tại repo root:

- Đối chiếu R01–R19 trong bảng spec với F01–F19 của bảng plan; kiểm tra đủ section T01–T14.
- Resolve các link Markdown nội bộ bằng đường dẫn tuyệt đối và `Test-Path`.
- Kiểm tra file source/test đã có và phân biệt các đường dẫn Create được đề xuất.
- Kiểm tra whitespace và code fence của ba tài liệu mới; không dựa vào `git diff --check` để kiểm file untracked.
- Snapshot SHA-256 của 99 file untracked có sẵn trước khi viết; đối chiếu sau khi hoàn tất.

### Kết quả thực tế

- **Typecheck:** PASS, Node và Web, exit 0. Đây là kiểm tra source baseline, không phải proof tính năng cắt.
- **Coverage tài liệu:** 19/19 requirement và fixture groups; 14/14 task sections. Mọi checkbox implementation trong plan vẫn chưa đánh dấu.
- **Liên kết:** các liên kết nội bộ giữa spec/plan/task record hợp lệ.
- **Bảo toàn:** 99/99 file untracked có sẵn giữ nguyên SHA-256; tracked source và index không thay đổi.
- **Whitespace/fences:** kiểm tra riêng các tệp mới; không có trailing whitespace hoặc code fence không đóng.
- **Runtime/media/GUI tests:** không chạy trong task này; test names/file paths mới trong plan chưa phải test đã tồn tại hoặc đã pass.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Chưa có implementation cắt frame, preview, review cue, migration hay stage integration.
- Chưa đo managed FFmpeg/VFR/intermediate codec/STTN short segment, chất lượng mối nối, live TTS hoặc latency trên Windows/macOS cho tính năng mới.
- Chi tiết đề xuất chưa qua implementation review; các quyết định cần số đo được đặt thành gate trong plan.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Khi có yêu cầu triển khai, bắt đầu T01 → T02 → T03 theo dependencies. Không bắt đầu bằng UI cắt rồi bỏ qua map/cue/cache. Không dùng test trim PCM hiện tại làm proof cắt video.

Các file performance audit và batch reliability đã có trước task được giữ nguyên. Không tạo branch, commit, push hoặc thay bản cài trong lần viết tài liệu này.
