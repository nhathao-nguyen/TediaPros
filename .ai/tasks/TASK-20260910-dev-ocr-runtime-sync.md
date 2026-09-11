# TASK-20260910-DEV-OCR-RUNTIME-SYNC: Đồng bộ runtime OCR GPU cho profile Dev

- **Trạng thái:** Đã kiểm chứng cục bộ
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-10

## 1. Mục Tiêu (Goal)

Đồng bộ runtime OCR trong `%APPDATA%\\tedia-pros-dev` với mã nguồn OCR GPU
1.2.1 hiện tại. Trước khi sửa, executable dev vẫn là bản cũ nhưng receipt đã
ghi nhầm version 1.2.1.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Cây runtime OCR dev được thay bằng bản đã xác minh, đủ 551 file.
- [x] Executable dev có SHA-256 `fc91f85653d6bd84819338d420dcd08aa646d5fe1867d2dfcddde658a98eb4da`.
- [x] `--version` báo OCR `1.2.1` và fingerprint `99020e272c77c9b90f46e587eb3b6d5891ebfa24e3d954cff6f66bb1cae34808`.
- [x] `--probe` báo `ready=true`, GPU DirectML cho `det`, `cls`, `rec`.
- [x] Runtime cũ được giữ làm backup; không có staging/failed directory còn sót.
- [x] Receipt chỉ cập nhật entry `ocr-engine` và trỏ tới path trong profile dev.
- [x] Typecheck và các suite liên quan pass.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** runtime local trong profile `%APPDATA%\\tedia-pros-dev` và
  receipt tương ứng.
- **Nằm ngoài phạm vi:** thay đổi provider, scheduler, TTS/translation, remote
  release/CI, hoặc xóa profile production.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Dùng toàn bộ cây OCR production đã probe GPU thành công làm nguồn local đã
  xác minh; không chỉ chép riêng `.exe` vì bản 1.2.1 có thể thay đổi `_internal`
  và model đi kèm.
- Chép vào staging, đối chiếu manifest hash toàn cây, đổi tên cùng volume để
  kích hoạt, giữ backup runtime cũ và cập nhật receipt sau swap.
- Không dùng receipt làm bằng chứng duy nhất: executable và capability probe là
  nguồn xác minh cuối.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[LOCAL INSTALLED]` `%APPDATA%\\tedia-pros-dev\\bin\\ocr-engine` — runtime GPU 1.2.1.
- `[LOCAL BACKUP]` `%APPDATA%\\tedia-pros-dev\\bin\\ocr-engine.cpu-old-backup-20260910` — runtime cũ.
- `[LOCAL MODIFY]` `%APPDATA%\\tedia-pros-dev\\runtime-state\\installed-runtime.json` — entry `ocr-engine`.
- `[LOCAL BACKUP]` `%APPDATA%\\tedia-pros-dev\\runtime-state\\installed-runtime.before-ocr-gpu-dev-20260910.json`.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
& %APPDATA%\\tedia-pros-dev\\bin\\ocr-engine\\ocr-engine.exe --version
& %APPDATA%\\tedia-pros-dev\\bin\\ocr-engine\\ocr-engine.exe --probe
cmd.exe /d /c "npm.cmd run typecheck"
node scripts/run-local-runtime-tests.mjs app-profile.test autoshort-ocr-runtime.test autoshort-ocr-pipeline.test local-runtime.test
git diff --check
```

### Kết quả thực tế

- Runtime dev active: 13,683,236 bytes, SHA-256 khớp bản qualified 1.2.1.
- Probe: `ocr-local/1`, `ready=true`, `DmlExecutionProvider` cho cả ba nhánh.
- Runtime cũ: 10,530,864 bytes, SHA-256 `21320e074adf96fd6eee6cf9fb49db0251719e12933da08780f17dc631b22099`, còn trong backup.
- Typecheck: PASS.
- Local runtime: PASS, 157/157 tests.
- `git diff --check`: PASS; các cảnh báo CRLF/LF hiện hữu không phải lỗi nội dung.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Remote `runtime-v5` vẫn cần được publish/sửa manifest riêng; việc này không
  thuộc sửa local profile.
- Chưa chạy lại toàn bộ batch AutoShort thật sau khi đồng bộ runtime.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Lượt OCR tiếp theo của app Dev sẽ resolve canonical path trong
`%APPDATA%\\tedia-pros-dev\\bin\\ocr-engine` và dùng runtime 1.2.1 GPU. Không
xóa backup cho tới khi hoàn thành một lượt media thật ổn định.
