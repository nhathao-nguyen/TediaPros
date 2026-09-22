# TASK-20260918: Lỗi JSON và thông báo tạm thời của Gemini

- **Trạng thái:** Đã kiểm chứng sửa code; live generation vẫn lỗi provider
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-18

## 1. Mục tiêu

Điều tra ảnh lỗi mới ở video đầu sau khi đã chuyển gateway đúng worktree.
Sửa mất nguyên nhân JSON và hiển thị error body thô; kiểm chứng bằng 33 cue thật.

## 2. Tiêu chuẩn nghiệm thu

- [x] Phân biệt gateway bị khóa trước đó với lỗi review mới.
- [x] Giữ nguyên normalization cause/code sau các attempt transient trước đó.
- [x] Thông báo TediaPros không chứa raw JSON với lỗi structured/transient đã biết.
- [x] Regression tests, typecheck và build pass.
- [x] Nạp binary gateway và khởi động lại TediaPros worktree với code mới.
- [ ] Generation thật với toàn bộ 33 cue thành công: hiện còn lỗi upstream.

## 3. Phạm vi

- Gateway: `internal/modules/openai/openai_service.go`, regression tests và docs.
- TediaPros: `src/main/geminiGateway.ts`, contract tests, `docs/domain.md`, task này.
- Giữ nguyên thay đổi có sẵn ở coordinator và bản sửa launcher/lifecycle lượt trước.
- Không đổi model, parser acceptance, cue IDs/timestamp, giới hạn attempts hay cookie.

## 4. Bằng chứng và quyết định

- Log `tblao-session-69fcc392-862b-4ac9-b50b-2e97f6fb926e.log`:
  08:22:37 UTC draft 33 cue thành công sau 2 attempts; 08:23:18 UTC review thất bại
  với `invalid-json`, `upstream_attempts=3`, hai retry reasons là
  `gemini-transient-message`; error chứa `one valid JSON object: <nil>`.
- Code gateway khai báo lại `normErr`, rồi gọi `errors.As(err, ...)` trên biến lỗi
  provider đã nil, che khuất lỗi normalization thật. Sửa dùng đúng `normErr`, biến
  typed khác tên và `%w` để bảo toàn error chain.
- TediaPros chỉ xử lý tên lỗi cũ `invalid-structured-json`, nên `invalid-json` và
  `gemini-transient-message` rơi xuống raw error body. Bổ sung mapping tiếng Việt,
  số attempts nguyên trong khoảng 1–3, giữ error code cho phân loại và audit.
- Log mới `tblao-session-c468e6b5-5693-47ff-8ffa-2a7c2fa61f2c.log` cho thấy người dùng
  đã chạy lượt khác: fingerprint đổi, checkpoint cũ bị loại; 08:26:55 UTC draft
  thất bại `gemini-transient-message` sau 3 attempts. Draft từ lượt trước không còn
  trên đĩa, nên live probe dùng lại đủ source cue trong thư mục tạm riêng.

## 5. Kiểm chứng

```powershell
# Gateway worktree
go test ./internal/modules/openai
go test ./...
go build -buildvcs=false -o server-worktree-next.exe ./cmd/server

# TediaPros worktree
npm.cmd run typecheck
npm.cmd run test:local-runtime -- gemini-gateway-contract.test gemini-gateway-draft-resume.test gemini-gateway-prompts.test
npm.cmd run build
```

- Go: toàn bộ suites pass. Regression tái tạo 2 lỗi transient rồi response thứ ba
  malformed/duplicate/ambiguous/over-limit; bảo toàn cause, code, 3 attempts và history.
- TediaPros: typecheck node/web pass; 17 contract + 3 draft-resume + 6 prompt =
  26 tests pass; build pass (còn các warning dynamic import vốn có).
- Runtime gateway PID 25940 trên 4982, binary worktree SHA-256
  `B30267D7759470D3A2A7FB2306649F902471E124BCC726F4E72E079050DC7F9E`.
- TediaPros đóng bằng `CloseMainWindow`, dev supervisor cũ dừng đúng PID, rồi
  khởi động lại từ worktree. Window PID 13460, Vite PID 23484 tại localhost:5173;
  `out/main/index.js` đã chứa mapping lỗi mới.
- Live probe riêng tại `%TEMP%\tedia-gateway-33cue-KsAHAA`: 33 cue nguồn của item
  `f0859642-c46e-48e6-83c7-7ea71fa971f1`, locale `vi-VN`, dubbing, một batch,
  dùng adapter/prompt/planner hiện tại. Request đầu thất bại với
  `gemini-transient-message`, 3 upstream attempts, logical request ID
  `eec0385f-f625-439b-8425-ba8b9258bcf4`. Không có review hoặc output được chấp nhận.
- Probe lưu request, response và audit riêng; không ghi đè production checkpoint.
- Probe đối chứng dùng cùng 33 cue nhưng prompt ngắn và bỏ `response_format`
  (để gateway chỉ gọi đúng 1 attempt) cũng nhận HTTP 500 với thông báo
  `Gemini returned a transient failure message`, không có bản dịch. Đây là lỗi
  provider trước bước kiểm tra JSON, không chỉ lỗi schema/prompt dài. Lưu tại
  `minimal-request.json` và `minimal-response.json` trong cùng thư mục probe.

## 6. Giới hạn

Không còn raw payload của phản hồi JSON sai từ lượt 08:23:18, nên không khẳng định
nó sai cú pháp cụ thể gì. Bản sửa làm lỗi mới báo đúng nguyên nhân; không bảo đảm
Google sinh thành công. Không coi local test/build hoặc provider-ready là bằng chứng
47 video đã chạy được. Các nhãn lỗi persisted chỉ đổi khi item được xử lý lại.

## 7. Bàn giao

Gateway và ứng dụng hiện chạy code mới. Không tự chạy lại batch 47 video.
Giữ phân biệt lỗi upstream tạm thời với lỗi JSON; không tăng retry cap hoặc nhận
partial để vượt qua lỗi này.
