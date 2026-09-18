# TASK-20260915-GATEWAY-COMPLETION: Sửa xác minh Pro báo completion unknown

- Trạng thái: Đã sửa và xác minh live endpoint; chưa chạy batch dịch/render.
- Người thực hiện: Codex.
- Ngày: 2026-09-15.

## 1. Mục tiêu

Xử lý ảnh UI báo `upstream-incomplete: response completion state is unknown` khi bấm kiểm tra gateway/model.

## 2. Tiêu chuẩn nghiệm thu

- [x] Tái hiện lỗi bằng fixture lấy từ response Pro thật, đã loại thông tin riêng tư.
- [x] Marker `[2]` được nhận complete; `[1]` incomplete; nil/missing/scalar0/scalar2/unknown không thành complete.
- [x] Không dùng marker hoàn tất cũ khi có candidate text frame mới thiếu marker, streaming hoặc rỗng.
- [x] Go suites liên quan, typecheck TP và build gateway qua.
- [x] Endpoint production xác minh Pro thật; lần kiểm tra tiếp dùng cache với zero generation.

## 3. Phạm vi

Sửa parser và fixtures trong CreateMediaTool. Giữ cửa sổ/hàng đợi TediaPros; không chạy batch92 video từ ảnh. Không nới JSON/schema/model verification gate.

## 4. Nguyên nhân

Parser `gemini_response_evidence.go` của commit bd697f3 giả định candidate[8] bằng0 hoặc nil là hoàn tất. Các fixture tự dựng pro_complete/sparse_complete/flash_complete cũng đặt0, nên tests cũ xác nhận cùng giả định sai.

Capture Pro thật ngày14/09 có chuỗi marker `[1] → [1] → [2]`. Do marker là array, code cũ đưa `[2]` vào nhánh unknown và verifyResponseRoute chặn request. Code cũng có chiều sai nguy hiểm: missing/null marker bị coi complete.

## 5. Thay đổi

- CMT `internal/modules/providers/gemini_response_evidence.go`: classify đúng marker đã quan sát, unknown fail-closed; cập nhật cả empty text snapshot để không giữ terminal cũ.
- CMT `internal/modules/providers/gemini_response_evidence_test.go`: regression live fixture, marker cases và latest-frame cases.
- CMT `internal/modules/providers/testdata/response/pro_live_terminal.json`: chỉ text/marker/model từ capture thực; identifiers được thay bằng fixture IDs.
- Ba fixture pro_complete/flash_complete/sparse_complete sửa scalar0 thành observed `[2]`. Tên sparse_complete là fixture có nhiều slot null hiện có, không chứng minh hỗ trợ sparse-map protocol.
- CMT `docs/gemini-gateway-v2.md`: ghi profile completion hiện được kiểm chứng.

## 6. Kiểm chứng

Trước sửa: `go test ./internal/modules/providers -run 'Test(LiveProTerminal|CompletionRequires|LaterFrame)' -count=1` FAIL: live marker unknown; missing/null/0 được nhận complete.

Sau sửa: `go test ./internal/modules/providers ./internal/modules/openai/... ./internal/commons/utils -count=1` PASS. `npm.cmd run typecheck` TP PASS node/web. `go build -o .artifacts/gateway-v2/server.completion-fix.exe ./cmd/server` PASS. `git diff --check` PASS.

Binary đã thay sau khi dừng đúng process server.exe, không có kết nối established. Lần copy đầu gặp file còn bị khóa; đã xác minh và dừng process khởi động lại, copy thành công và so SHA trước chạy binary mới.

- Server PID mới:23448, port4982 (một listener).
- SHA256 server.exe: `3D498A97E472E2161687A9C2D52449451A6102793A21D7B819861FDE0FFCBF1D`.
- POST `/openai/v1/gateway/verify-model`, force=true: state=verified, observed_model=3.1 Pro, ID=e6fa609c3fa255c0, verification_generation_requests=1.
- Thời điểm verified:2026-09-15T03:02:29Z (10:02:29 Việt Nam); expires03:17:29Z.
- POST cùng model force=false: verified, verification_generation_requests=0.
- Bằng chứng local: CMT `.artifacts/gateway-v2/completion-fix-live-verification.json`.

## 7. Bàn giao

UI đang giữ thông báo cũ cho tới khi bấm Kiểm tra gateway và model lại. Gateway production đã được nạp bản sửa; không cần restart TediaPros cho thay đổi parser này.

Live này chỉ xác nhận lỗi verify trong ảnh đã hết. Không suy ra batch92 video/dịch hai lượt/render đã thành công. Protocol biến thể mới không có marker đã biết vẫn bị chặn để điều tra, không được đoán là complete.
