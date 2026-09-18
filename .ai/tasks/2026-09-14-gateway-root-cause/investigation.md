# TASK-20260914-GATEWAY-ROOT-CAUSE: Tái tạo lỗi và kiểm chứng model thực tế

- Trạng thái: Đã tái tạo lỗi, xác nhận sai routing model và có đối chứng Pro dịch đủ 113 ID.
- Người thực hiện: Codex
- Thời gian: 2026-09-14

## 1. Mục tiêu

Tìm nguyên nhân bằng request/response gốc, thay vì suy luận từ lỗi JSON cuối cùng. Phạm vi gồm TediaPros và CreateMediaTool; không sửa logic production trong lần điều tra này.

## 2. Tiêu chuẩn nghiệm thu

- [x] Tái tạo lỗi với nguồn 113 cue của item `b107a30c-b580-4703-a10e-3e22179e5edd`.
- [x] Thu phản hồi HTTP gốc trước parser, phân tích frame mà không xuất cookie/header/token.
- [x] Đối chiếu model yêu cầu với model được Google ghi trong phản hồi.
- [x] Thử thay đúng một trường chọn model, giữ prompt và pipeline provider.
- [x] Typecheck TediaPros và các Go test liên quan thành công.
- [x] Hoàn tất đối chứng prompt đầy đủ trên Pro: timeout của harness, không được đánh dấu dịch thành công.

## 3. Phạm vi và công cụ

- TediaPros: `capture-request.mjs` dùng adapter/planner hiện tại và checkpoint thật để tái dựng request đầu tiên, chặn fetch trước khi có mạng. `request.json` và `prompt.txt` là request tái dựng, không phải bản chụp nguyên byte của lần lỗi lịch sử. Đặt locale `vi-VN`, source `zh`, mode `dubbing`, không glossary/synopsis.
- CreateMediaTool: `internal/modules/providers/diagnostic_repro_test.go` là test chẩn đoán opt-in. Mỗi lần chỉ gọi GenerateContent một lần, tắt background refresh của client thử nghiệm. HTTP transport bọc quanh provider thật, giữ nguyên parser. Chỉ lưu response body, không lưu request cookie, header hoặc URL xác thực.
- Raw response đặt trong `CreateMediaTool/.diagnostics/`, được loại khỏi Git bằng `.git/info/exclude`. Không thay binary server hay app đang chạy.
- `analyze-response.mjs` đọc các `wrb.fr` frame, candidate text, model ID ở payload[39], model label ở payload[42]. Đây là các trường quan sát được trong những mẫu live này.

## 4. Phát hiện có bằng chứng

### CODE_CONFIRMED: Header chọn model đang dùng ID ngẫu nhiên

`CreateMediaTool/internal/modules/providers/gemini_service.go:625` tạo UUID rút gọn làm `traceID`. Dòng 626 đưa giá trị này vào phần tử thứ 5 (index 4) của `x-goog-ext-525001261-jspb`.

Index 4 thực tế là mã model. Nguồn đối chiếu: [HanaokaYuzu/Gemini-API constants.py](https://github.com/HanaokaYuzu/Gemini-API/blob/master/src/gemini_webapi/constants.py) (`build_model_header`) và [availablemodel.py](https://github.com/HanaokaYuzu/Gemini-API/blob/master/src/gemini_webapi/types/availablemodel.py). Đây là implementation reverse-engineered, không phải hợp đồng API chính thức của Google; thử nghiệm live bên dưới xác nhận tác dụng của trường đó trên tài khoản hiện tại.

`inner[3] = model` không bảo đảm chọn Pro: phản hồi thực tế vẫn là Flash. `refreshModels()` chỉ regex tên từ HTML khởi tạo, không lấy ánh xạ model ID và quyền chọn model của tài khoản.

### CODE_CONFIRMED: resolved_model không phải bằng chứng upstream

`gemini_service.go:703` gán `resolved_model = config.Model`; dòng 704 tiếp tục đưa tên đó vào session metadata. Gateway trả tên đã yêu cầu, không kiểm tra payload model ID/label của Google. Vì vậy capability `model_selection: exact` và UI không chứng minh đã chạy Pro.

### LIVE_CONFIRMED: Cấu hình hiện tại thực sự trả Flash

1. Prompt 61 byte yêu cầu `{"ok":true}`, model yêu cầu `gemini-advanced`: HTTP 200, JSON đúng, 3.047 giây. Google trả ID `56fdd199312815e2`, label `3.8 Flash`.
2. Prompt 38.367 byte, 113 cue, token hint 16.384: HTTP 200, 12.131 giây, 315.178 byte response, 54 text frames, không frame nào là JSON hoàn chỉnh. Google vẫn trả `3.8 Flash`.
3. Ở frame gần cuối, bản dịch đã đến cue 56 rồi chèn lại đầu object `{"translations":{"cue-0-0"...` ngay bên trong một chuỗi chưa đóng. Hai frame cuối thay nội dung bằng thông báo generic lỗi của Gemini. Provider chuyển thông báo đó thành `Gemini returned a transient failure message`.

Đây là JSON đã hỏng ở raw upstream, không phải lỗi JSON do parser TediaPros tạo ra. Không có bằng chứng HTTP timeout, HTTP 429, HTTP 5xx hay context-limit trong mẫu này. Từ `transient` là cách gateway phân loại một câu trả lời generic, không phải mã lỗi có nguyên nhân cụ thể từ Google.

### LIVE_CONFIRMED: Đổi một trường header chọn được Pro

Giữ nguyên prompt nhỏ, model name, cookie/config, temporary mode, parser và mọi trường header khác; chỉ thay header[4] bằng `e6fa609c3fa255c0`. HTTP 200, JSON đúng, 25.193 giây. Google ghi ID `e6fa609c3fa255c0`, label `3.1 Pro`.

### LIVE_OBSERVED: Prompt đầy đủ trên đường header Pro chưa hoàn tất

Đối chứng nguyên prompt 38.367 byte hết deadline tổng 4 phút của harness (GenerateContent khoảng 239.328 ms), chưa nhận được HTTP response body. Vì không có response để xác nhận model ở request này, chỉ gọi đây là request với header Pro. Không suy ra lỗi JSON, lỗi context hay kết quả dịch từ mẫu timeout. Đây là deadline của công cụ điều tra, không phải mã lỗi do Google trả. Gateway production đặt HTTP timeout 5 phút.

Đối chứng tiếp theo giữ 113 ID và text nguồn nhưng giảm chỉ dẫn xuống 6.624 byte, không timing hints/token hint. Đây là một prompt thử nghiệm khác, không phải một bản dịch đã được duyệt để thay thế cấu hình chính thức.

### LIVE_CONFIRMED: 113 cue có thể trả đủ trên Pro với prompt gọn

Request prompt 6.624 byte, header model ID Pro: HTTP 200, 68.519 ms, 1.036.763 byte raw response. Có 88 text frames; ba frame cuối chứa JSON hoàn chỉnh. Google xác nhận `e6fa609c3fa255c0` / `3.1 Pro`. JSON cuối 6.343 byte, đúng 113 ID, không thiếu, không thừa, các giá trị đều là string.

Đây là bằng chứng khả năng hoàn thành 113 cue trong một request, không phải chứng nhận chất lượng bản dịch hoặc timing TTS. Chưa chạy lượt kiểm tra độc lập. Prompt gọn bỏ nhiều điều kiện đồng thời nên phép thử không xác định được chính xác chỉ dẫn nào làm prompt cũ chậm; cũng chưa có đủ mẫu để định lượng tỷ lệ thành công.

### LIVE_CONFIRMED: Prompt gọn vẫn lỗi nếu giữ routing cũ

Giữ nguyên prompt 6.624 byte, bỏ override header để chạy đúng code hiện tại: HTTP 200, 7.869 ms, Google ghi `3.8 Flash`. 13 text frames, không JSON hoàn chỉnh; có dấu hiệu chèn lại object từ cue 0 ngay khi mới tới cue 1 rồi kết thúc bằng generic error. Đối chứng này cho thấy chỉ rút prompt chưa đủ trong các mẫu đã chạy.

| Routing | Prompt nhỏ 61 byte | Prompt đầy đủ 38.367 byte / 113 cue | Prompt gọn 6.624 byte / 113 cue |
|---|---|---|---|
| Code hiện tại, model ID ngẫu nhiên | JSON đúng; Google ghi Flash | JSON hỏng rồi generic error, 12,1 s | JSON hỏng rồi generic error, 7,9 s |
| Chỉ đổi header[4] sang mã Pro | JSON đúng; Google ghi Pro | Chưa có response sau deadline 4 phút | Google ghi Pro; JSON đúng đủ 113 ID, 68,5 s |

Tổng cộng 6 generation request chẩn đoán, không retry generation ẩn. Các lần khởi tạo client có thêm request session/auth; không tính chúng là generation. Các request chạy tuần tự, mỗi request dùng client mới khởi tạo từ cùng cấu hình tài khoản; thời điểm và trạng thái dịch vụ có thể thay đổi. Đây không phải benchmark thống kê.

## 5. Tái tạo

Chạy từ TediaPros:

```powershell
node .ai/tasks/2026-09-14-gateway-root-cause/capture-request.mjs
node .ai/tasks/2026-09-14-gateway-root-cause/capture.cjs C:\Users\PC\AppData\Roaming\tedia-pros-dev\autoshort-checkpoints\b107a30c-b580-4703-a10e-3e22179e5edd\checkpoint.json F:\Son\tool\TediaPros\.ai\tasks\2026-09-14-gateway-root-cause
```

Chạy từ CreateMediaTool, dùng `.env` hiện có (không đưa giá trị cookie vào lệnh):

```powershell
$env:GEMINI_DIAGNOSTIC_ROOT='F:\Son\tool\CreateMediaTool'
$env:GEMINI_DIAGNOSTIC_OUT='F:\Son\tool\CreateMediaTool\.diagnostics\new-baseline'
$env:GEMINI_DIAGNOSTIC_PROMPT='F:\Son\tool\TediaPros\.ai\tasks\2026-09-14-gateway-root-cause\prompt.txt'
Remove-Item Env:\GEMINI_DIAGNOSTIC_MODEL_HASH -ErrorAction SilentlyContinue
go test ./internal/modules/providers -run '^TestDiagnosticLiveRepro$' -count=1 -v

# Đối chứng: đổi một trường header. Mỗi lệnh test thực hiện một generation.
$env:GEMINI_DIAGNOSTIC_OUT='F:\Son\tool\CreateMediaTool\.diagnostics\new-pro'
$env:GEMINI_DIAGNOSTIC_MODEL_HASH='e6fa609c3fa255c0'
go test ./internal/modules/providers -run '^TestDiagnosticLiveRepro$' -count=1 -v
```

Chỉ chạy lại khi cần thu mẫu mới. Test in PASS có nghĩa harness đã thu kết quả; phải đọc `summary.json` để biết generation thành công hay thất bại. Không tự tăng retry. Mã model trong phép thử được kiểm chứng ngày này, không nên coi là ánh xạ cố định lâu dài.

## 6. Kiểm chứng

- `npm.cmd run typecheck`: PASS node và web.
- `go test ./internal/modules/providers ./internal/modules/openai ./internal/commons/utils`: PASS; test live opt-in bị skip ở lần chạy suite thường.
- `node --check` cho hai script chẩn đoán: PASS.
- Offline dùng chính `src/shared/aiOutput.ts` để đọc output Pro gọn: PASS bounded parser (bao gồm duplicate-key rejection), exact root keys, đủ 113 ID tương ứng nguồn. Không suy ra chất lượng ngữ nghĩa từ kiểm tra cấu trúc.
- `git diff --check`: PASS.

## 7. Hướng sửa sau điều tra

1. Ánh xạ tên model bằng model ID thực tế từ danh sách tài khoản/RPC, tạo header đúng, bỏ giá trị ngẫu nhiên ở vị trí model ID.
2. Tách `requested_model` khỏi `observed_model`; kiểm tra model Google xác nhận, không tự chép request thành kết quả.
3. Capability/UI không báo chọn chính xác khi chưa có xác minh tương ứng.
4. Ghi chẩn đoán lỗi có giới hạn: model quan sát, trạng thái frame, số byte, loại JSON lỗi và dấu hiệu completion. Giữ kiểm tra đủ cue và không nhận JSON bị cắt dở.
5. Tối giản prompt có kiểm soát dựa trên mẫu thành công, đưa ràng buộc định danh/thời gian về code; giữ khôi phục nghĩa và locale, đưa kiểm tra ngữ nghĩa vào lượt review độc lập. Prompt gọn hiện tại chỉ là đối chứng, chưa đủ tiêu chuẩn thay thế prompt production.

Không thể suy ra toàn bộ nguyên nhân nội bộ Google gây lỗi generation từ một thông báo generic. Lỗi routing và việc báo model sai đã được xác nhận trực tiếp; độ ổn định và chất lượng ngữ nghĩa sau sửa cần kiểm chứng riêng.

---

## 8. Cập nhật triển khai (2026-09-14)

> **Review 2026-09-15:** Tuyên bố hoàn thành bên dưới là báo cáo triển khai
> ngày 14. Sai tên response version đã sửa; F2–F7 (retry ownership, resume
> route/parser identity, evidence defaults, exact model và JSON normalization)
> cũng đã được harden bằng code/test. Replay 19 cue qua hai stage là evidence
> live cũ; 113-cue/Volvo và render/TTS phải được xác nhận lại với binary mới.
> Xem [review](../2026-09-15-gateway-v2-review.md) và
> [hardening](../2026-09-15-gateway-v2-hardening.md).

Kế hoạch triển khai đã được hoàn thành đầy đủ trên cả hai repository theo kế hoạch `docs/superpowers/plans/2026-09-14-gemini-gateway-reliability.md`:
- Task 1: Model routing theo tài khoản RPC catalog (`3bc3852`).
- Task 2: Xác minh observed model/completion evidence (`bd697f3`).
- Task 3: Chuẩn hóa JSON giới hạn, parity 100% Go/TS (`8fad7a2`, `cc867da`).
- Task 4: Hợp đồng v2 và căn chỉnh retry một tầng duy nhất tại gateway (`aa9b6ac`, `4df2557`).
- Task 5: Compact two-pass prompts v4 với ngân sách kích thước <= 12 KiB (`33c4fab`).
- Task 6: Checkpoint draft và resume review an toàn (`da944bf`).
- Task 7: Endpoint xác minh model (`POST /gateway/verify-model`), cache RAM 15 phút, UI status và audit có giới hạn/redaction (`7337537`, `8df5f2c`).
- Task 8: Qualification gates, builds độc lập và báo cáo bàn giao.
Chi tiết xem tại `.ai/tasks/2026-09-14-gemini-gateway-v2-implementation.md`.

---

## 9. Cập nhật route hiện tại (2026-09-15)

### LIVE_OBSERVED — catalog refresh có thể đổi route thực

Historical two-stage v5 từng quan sát `3.1 Pro`, nhưng một verify sau refresh
catalog đã quan sát **Flash-Lite**. Đây là kết quả probe bị strict evidence gate
từ chối; nó không tạo bản dịch được TP chấp nhận.

### CODE_CONFIRMED — nguyên nhân route capacity generic

Catalog động hiện không luôn mang tier legacy. Route có nhãn exact 3.1 Pro khi
đó nhận capacity generic thay vì capacity Pro, và upstream trả Flash-Lite.
`capacityForModel` nay chỉ nâng fallback này khi label exact 3.1 Pro; label Pro
khác, `3.10` và image-Pro vẫn bị từ chối. Evidence response remains mandatory,
vì catalog hoặc header không tự chứng nhận model thực.

### TEST_CONFIRMED — hành vi sau sửa

TP preflight `verify-model` trước dispatch; CMT cache mismatch hai phút. Route
sai dừng trước draft/review, không lặp retry/generation. Warm verified route vẫn
dùng đúng hai generation; route/cache cold chỉ thêm một probe bounded.

### LIVE_CURRENT_CONFIRMED

Sau khi session Google Web được làm mới, một `verify-model` bounded đã quan sát
`3.1 Pro`. Prompt v8 sau đó hoàn thành Volvo 44 cue và nguồn thật 113 cue, mỗi
run đúng hai client generation / hai upstream attempts, với evidence model
matched và terminal complete; không có retry.

Đối chiếu semantic cho thấy cue số trần `169` không thêm đơn vị tiền. Volvo
`cành sồi` ban đầu trông như suy diễn vì ASR ghi `像素树枝`, nhưng ảnh nguồn OCR
ghi `橡树树枝轻轻弯折时`; đây là khôi phục homophone có bằng chứng. Không suy ra
độ ổn định tổng quát hoặc kết quả TTS/render từ hai run này.
