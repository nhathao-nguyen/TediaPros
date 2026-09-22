# TASK-20260918: Sửa kết nối nhầm gateway ngoài worktree

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-18

## 1. Mục tiêu

Sửa lỗi “Gemini Gateway đang tạm khóa” trong TediaPros worktree
`F:\Son\tool\TediaPros\.worktrees\pre-gateway-scheduling`, dùng gateway tại
`F:\Son\tool\CreateMediaTool\.worktrees\pre-gateway-scheduling`.

## 2. Tiêu chuẩn nghiệm thu

- [x] Xác minh nguyên nhân từ log và PID thực tế.
- [x] Gateway chạy từ đúng worktree trên cổng 4982.
- [x] Launcher build đúng checkout và từ chối cổng đã bị chiếm.
- [x] Server trả lỗi startup ngay khi bind thất bại; có regression test.
- [x] `npm.cmd run typecheck` pass.
- [x] Test gateway TediaPros và toàn bộ test Go pass.
- [x] Một yêu cầu dịch trực tiếp qua contract v2 trả kết quả hoàn tất.

## 3. Phạm vi

- Sửa launcher, lifecycle startup và tài liệu trong gateway worktree.
- TediaPros chỉ thêm bản ghi bàn giao này; giữ nguyên thay đổi có sẵn tại
  `src/main/autoShortItemCoordinator.ts` và `run-tedia-dev.bat`.
- Không ACK, reset, xóa state governor hoặc tự chạy lại batch bị lỗi.

## 4. Nguyên nhân và quyết định

- **RUNTIME_CONFIRMED:** TediaPros renderer chạy từ worktree nhưng listener
  4982 thuộc PID 19316, executable `F:\Son\tool\CreateMediaTool\server.exe`.
  `/openai/v1/gateway/scheduler` trả `state=blocked`, `reason=outcome-unknown`,
  `active_permits=0`, `queued_requests=0`. Capability vẫn báo provider ready.
- **LOG_CONFIRMED:** Log dev `tblao-session-69fcc392-862b-4ac9-b50b-2e97f6fb926e.log`
  từ 08:09 UTC ghi `upstream governor is blocked: outcome-unknown` ở bước dịch.
- **CODE_CONFIRMED:** `run-gateway.bat` có lệnh chuyển thư mục sai
  (`cd /d \%~dp0\`). Server cũ gọi `app.Listen` trong goroutine rồi chỉ log lỗi,
  khiến startup vẫn được báo thành công khi cổng đang bị chiếm.
- Launcher mới cố định working directory theo script, build `server-worktree.exe`
  mỗi lần và kiểm tra port trước khi build. Server bind IPv4 đồng bộ trong
  `OnStart` để xử lý cả trường hợp cổng bị chiếm sau bước kiểm tra launcher.
- **EVIDENCE_CORRECTION:** Không thể kết luận `server.exe` có sẵn trong worktree
  thuộc nhánh scheduler chỉ từ `go version -m`: `go build -x` chứng minh Go lấy
  VCS stamp từ checkout cha dù biên dịch source trong worktree. Binary cũ trong
  worktree không chứa marker governor/scheduler mà binary ở root có. Launcher
  dùng `-buildvcs=false` để tránh ghi thông tin commit sai.
- Người dùng xác nhận đã bấm “Dừng xử lý”. Log ghi hủy lúc 08:14:52 UTC.
  Khi chuyển gateway, PID 19316 đã thoát và cổng 4982 đã trống.

## 5. Tệp thay đổi

Trong gateway worktree:

- `internal/server/server.go`: bind đồng bộ trước khi startup thành công.
- `internal/server/server_test.go`: kiểm tra conflict cổng thực, server cũ còn đáp ứng.
- `run-gateway.bat`: gọi script bằng đường dẫn tuyệt đối của chính launcher.
- `run-gateway.ps1`: build, kiểm tra port, chạy đúng binary và phục hồi môi trường shell.
- `docs/gemini-gateway-v2.md`: hướng dẫn worktree, port và ranh giới VCS metadata.

Trong TediaPros worktree: bản ghi task này.

## 6. Kiểm chứng

TediaPros worktree:

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime -- gemini-gateway-contract.test gemini-gateway-draft-resume.test gemini-gateway-prompts.test
```

Kết quả: typecheck node/web pass; contract 15/15, draft-resume 3/3,
prompts 6/6, tổng 24 test pass, không skip.

Gateway worktree:

```powershell
go test ./...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run-gateway.ps1
git diff --check
```

- Toàn bộ test Go pass, gồm regression startup conflict. Test dùng wildcard IPv4
  giống Fiber; Windows có thể cho listener loopback và wildcard cùng port tồn tại.
- Khi PID 19316 còn giữ cổng, launcher trả exit 1 và chỉ rõ PID; không chạy binary khác.
- Sau khi cổng trống, launcher mới build thành công và chạy PID 22200:
  `F:\Son\tool\CreateMediaTool\.worktrees\pre-gateway-scheduling\server-worktree.exe`.
- Binary SHA-256:
  `63B2AEDB95AF65E5F8AE153AA340F7EA52A17E21FFBD4ABA4FA247256D55C716`.
- `/health`: `ok`; capabilities: `provider_ready=true`, contract v2,
  `request_status=false`, không có scheduler contract (đúng nhánh trước scheduling).
- Live smoke: POST `/openai/v1/chat/completions`, `model=gemini-advanced`,
  `require_verified_model=true`, `require_complete_response=true`, JSON schema strict.
  Input synthetic `你好。`; output `{"translations":{"probe-1":"Xin chào."}}`.
  HTTP 200, `finish_reason=stop`, `model_verification=matched`, observed model
  `3.1 Pro`, ID `e6fa609c3fa255c0`, `completion_state=complete`,
  evidence `observed-terminal-frame-v1`, `upstream_attempts=1`.
  Logical request ID: `7cd20a94-2de0-4635-8ead-101e4f708e7f`.

Giới hạn: live smoke chỉ xác minh một generation nhỏ, chưa chứng minh toàn bộ
47 video, pipeline TTS hoặc render hoàn tất. Không sửa hay đọc nội dung cookie.

## 7. Bàn giao

- Gateway hiện chạy nền, endpoint giữ nguyên `http://127.0.0.1:4982/openai/v1`.
- Lần sau dùng `run-gateway.bat` trong gateway worktree; không mở server ở root
  trên cùng cổng. Muốn dùng cổng khác: `run-gateway.bat -Port 4983`, rồi đổi URL client.
- Hàng đợi hiện vẫn dừng. Các nhãn lỗi cũ là kết quả đã lưu; người dùng chọn
  “Thử lại dịch” để chạy lại item sau khi đã sửa gateway.
