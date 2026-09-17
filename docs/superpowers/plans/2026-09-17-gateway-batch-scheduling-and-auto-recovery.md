# Gateway Batch Scheduling and Auto Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Thực hiện tuần tự trong phiên; không tự dispatch subagent.

**Goal:** Chạy batch video tự động qua gateway với điều tiết dùng chung, nghỉ đúng lúc và tiếp tục đúng checkpoint.

**Architecture:** CreateMediaTool quản lý admission và trạng thái operation bền vững; TediaPros quản lý video, cue, checkpoint và UI. Các response trì hoãn không làm hỏng video chưa chạy. Media restoration nối sau khi governor và auto-resume qua kiểm chứng.

**Tech Stack:** Go 1.25.1, Fiber v3.3.0, Electron 34, React 19, TypeScript 5.7, Node.js, FFmpeg; ưu tiên thư viện chuẩn và dependency hiện hữu.

**Spec:** [Thiết kế và tiêu chí bắt buộc](../specs/2026-09-17-gateway-batch-scheduling-design.md).

## Global Constraints

- Windows 10/11 x64 và macOS Apple Silicon M1+; không thêm service hạ tầng bắt buộc cho V1.
- Global concurrency = 1/group; `maxActiveItems=1` cho profile batch tuần tự mới.
- `TRANSLATION_BUDGET_LIMITS_ENABLED = false`; giữ cancellation, per-attempt timeout và no-progress termination.
- Alias `gemini-advanced`; `require_verified_model=false`; `require_complete_response=true`; tempo tối đa `1.80x`.
- Giữ LICENSE/NOTICE, typed IPC, code-owned cue ID/timestamp, path containment, disk budget và Planar RGB cho OCR blur.
- Không xác nhận tính năng đã triển khai dựa trên tài liệu này; không tự commit toàn bộ dirty tree hoặc restart dịch vụ trong lượt planning.

---

- Ngày: 2026-09-17.
- Trạng thái: **PLANNED — chưa triển khai các thay đổi trong kế hoạch này**.
- Phạm vi: `F:\Son\tool\CreateMediaTool` và `F:\Son\tool\TediaPros`.
- Mục tiêu: chạy lần lượt nhiều video, tự xử lý giới hạn tạm thời, bảo toàn tiến độ; sau đó nối audio/OCR vào khôi phục ASR và dịch tự động.
- Ưu tiên thực hiện: P0 → P1 → P2 → P3 → P4 → P5. P6 là lựa chọn riêng cho API chính thức.
- Không cam kết tránh mọi giới hạn/chặn của Google. Không có ngưỡng giây/request nào đã được Google chứng nhận an toàn cho gateway Gemini Web này.

## 1. Kết quả cần đạt

Người dùng bấm chạy batch một lần. TediaPros xử lý lần lượt; CreateMediaTool điều tiết mọi lượt upload/generation, kể cả retry và request từ ứng dụng khác. Khi bị giới hạn tạm thời, batch hiển thị đang chờ, giữ checkpoint, tự tiếp tục khi được phép. Video chưa chạy không bị đánh dấu lỗi chỉ vì Google đang giới hạn.

Lỗi nguồn riêng một video được tự khôi phục có bằng chứng; nếu không giải quyết được thì lưu lỗi của video đó và tiếp tục các video khác. Lỗi dùng chung của dịch vụ phải dừng admission vào Google cho toàn phạm vi liên quan. CAPTCHA, yêu cầu đăng nhập hoặc kết quả upstream không xác định không được biến thành vòng retry vô hạn.

Tự động nghỉ/tiếp tục áp dụng trong phiên đang chạy. Người dùng hủy, đóng ứng dụng hoặc chủ động tạm dừng thì không được tự khởi chạy lại. Sau crash/restart, giữ cơ chế phục hồi hiện có; không tự đổi chính sách khởi chạy ứng dụng.

## 2. Baseline và giới hạn bằng chứng

Checkout được kiểm tra: TediaPros HEAD `d73db03`, CreateMediaTool HEAD `f44b6ac`. Cả hai có nhiều thay đổi chưa commit. Các nhận định dưới đây phản ánh **working tree**, không chỉ hai commit đó. Khi bắt đầu triển khai phải đối chiếu lại diff; không reset, clean, stash-all hoặc ghi đè phần đang làm.

| Bằng chứng | Hiện trạng xác nhận | Hệ quả cho triển khai |
|---|---|---|
| `TediaPros/src/main/geminiGateway.ts:418–505` | Giãn cách client 3 giây; nghỉ 45 giây rồi thử lại một lần với lỗi nhận diện throttling | Chuyển quyền điều tiết sang gateway; không cộng dồn cả cơ chế cũ và mới |
| `TediaPros/src/main/autoshort.ts:3529–3533` | Preflight gọi capabilities rồi phát sinh generation probe | Chế độ mới bỏ ping mỗi batch; request công việc đầu tiên làm phép thử sau thời gian nghỉ |
| `TediaPros/src/main/autoShortQueueRunner.ts:101–111` | Circuit breaker hiện finalize phần chưa xong thành `error` | Thêm trạng thái chờ không terminal, giữ thứ tự và không tăng lỗi hàng loạt |
| `TediaPros/src/main/autoShortResourceManager.ts` | `server-inference` mặc định 1 trong tiến trình TediaPros | Không bảo vệ nhiều ứng dụng/route/client pool của gateway |
| `CreateMediaTool/internal/server/server.go` và `internal/commons/configs/configs.go` | Limiter HTTP inbound tùy chọn, default disabled | Không phải bộ điều tiết generation upstream; bật limiter này không giải quyết toàn bộ vấn đề |
| `CreateMediaTool/internal/modules/openai/openai_service.go:179–254` | Provider attempt limit 1, structured generation tối đa 3 attempts; khoảng chờ 1–2 giây | Mỗi actual attempt phải đi qua cùng governor, không đặt retry bên ngoài để nhân số lần gọi |
| `CreateMediaTool/internal/modules/providers/client_pool.go` | Pool theo hash cookie; cookie/session có thể thay đổi | Không dùng mỗi pool key làm biên an toàn duy nhất; cần governor dùng chung toàn gateway |
| `CreateMediaTool/internal/modules/providers/gemini_service.go`, `gemini_chat_session.go` | Có nhiều đường phát sinh generation; có upload trước generate | Đặt admission trước upload; rà cả đường SendMessage, image, research, model verification |
| Probe live ở lượt kiểm tra trước trong cùng phiên | Audio WAV + PNG + bản ASR cố tình sai được Gemini đọc/sửa đúng; 15,91 giây, 1 attempt, observed `3.1 Pro`, completion complete | Chứng minh một request media; không chứng minh batch dài, mọi định dạng hay mọi lỗi ngữ nghĩa |
| Cấu hình Fiber hiện tại | Không override body limit; dependency đang dùng mặc định 4 MiB | Đo kích thước JSON sau base64 trước dispatch; không dựa vào giới hạn attachment nội bộ lớn hơn |

Probe media: [verification](../../../../CreateMediaTool/.artifacts/gateway-media-probe-20260917-085853/verification.json), [response](../../../../CreateMediaTool/.artifacts/gateway-media-probe-20260917-085853/response.json). Đây là artifact cục bộ, không yêu cầu commit WAV/PNG hoặc dữ liệu người dùng vào Git.

Tài liệu task cũ mô tả 3 giây là mô phỏng hành vi tự nhiên và 45 giây là đủ để bucket phục hồi. **Không dùng hai nhận định đó làm bằng chứng.** Các con số chỉ là tham số phần mềm, không phải đặc tính đã đo của Google.

## 3. Các quyết định thiết kế

### 3.1. Gateway sở hữu điều tiết upstream

- Tạo một `UpstreamGovernor` được dependency injection dùng chung cho provider mặc định và toàn bộ `ClientPool`.
- V1 chạy một gateway owner cho một `egressGroup` trên máy; khóa liên tiến trình và state directory ngăn hai instance cùng group tự nhận mình là owner. Không mặc định cô lập theo port.
- Khóa owner dùng OS-backed file lock, không chỉ kiểm tra file tồn tại. Chọn thư viện khóa đa nền tảng nhỏ sau khi kiểm tra dependency hiện hữu; nếu cần thêm phải ghi version/license trong ADR. Hai tiến trình có state directory khác nhau chưa thể tự bảo vệ lẫn nhau; cài đặt phải dùng chung đường dẫn đã canonicalize cho cùng egressGroup.
- Global concurrency = 1 cho upload/generation Gemini Web. Account/profile state có thể chặn riêng tài khoản; tín hiệu chặn không rõ phạm vi thì nghỉ ở mức group bảo thủ.
- Mọi generation, kể cả image/research/chat-session/verification/structured retry, phải đi qua admission. Các RPC catalog/auth maintenance dùng đường maintenance được coalesce, có backoff, không tự sinh generation.
- FIFO có công bằng giữa các logical operation. Retry trả lại hàng đợi, không giữ mutex trong lúc ngủ và không chiếm slot mãi.
- Giữ slot từ trước upload đến khi attempt upstream thực sự kết thúc, kể cả khi client đã ngừng chờ. Không nhả slot chỉ vì UI đóng hoặc HTTP phía client timeout.
- Không acquire lồng nhau giữa service/provider/upload. Một permit bao trọn một attempt upload + generate; upload con nhận permit đã cấp.
- Điều phối giữa nhiều máy cùng IP ra ngoài nằm ngoài V1; nếu triển khai topology đó phải dùng chung một gateway owner/điều phối phân tán trước khi gọi là được bảo vệ chung.

### 3.2. Chính sách chờ và phân loại lỗi

Các default dưới đây là **đề xuất vận hành ban đầu**, chưa có bằng chứng làm Google không chặn. Cho cấu hình bằng environment, validate khoảng hợp lệ, không dùng jitter để giả hành vi người.

| Tham số | Default đề xuất |
|---|---|
| Concurrent Gemini Web attempt | 1/group |
| Khoảng nghỉ sau attempt hoàn tất | 15 giây; áp dụng cả retry, không chỉ giữa video |
| Cooldown khi xác nhận throttling mà không có chỉ dẫn thời gian | 60 → 120 → 240 giây; backoff có jitter dương nhỏ để tránh các client cùng thức |
| `Retry-After`/reset được upstream cung cấp | Không thử trước mốc đó; hỗ trợ cả delta-seconds và HTTP-date; không cắt ngắn reset dài thành 15 phút |
| Half-open | Chỉ 1 request công việc thực, không ping sinh thêm generation |
| Hạn dừng do không tiến triển | 3 half-open liên tiếp vẫn throttled mà không có reset đáng tin → `blocked`; không tự lặp vô hạn |
| Phục hồi tốc độ | Chỉ giảm backoff sau 3 completion hợp lệ liên tiếp; không tăng concurrency |
| Legacy HTTP admission wait | Tối đa 20 giây; hết hạn trả lỗi local `gateway-busy`, không gọi Google |
| Pending async operation | Tối đa 16/group; vượt trả backpressure trước upload |

Không bật lại tổng quota request/recovery/thời gian dịch đang tắt theo yêu cầu 2026-09-08. Rate shaping, quota do nhà cung cấp áp dụng, cancellation và dừng khi không tiến triển là các cơ chế độc lập.

| Loại lỗi đã xác minh | Phạm vi và cách xử lý |
|---|---|
| `provider-throttled` | Cooldown group/account theo evidence; lưu `not_before`; không thử video kế tiếp qua cùng gate |
| `provider-quota-exhausted` + reset biết rõ | Chờ reset; status poll không generation; không thử lặp mỗi phút |
| `provider-quota-exhausted` không reset | `blocked`, bảo toàn tiến độ; không tự bịa thời điểm hết quota |
| `provider-auth-required` / `provider-challenge` | Ngừng gửi cho scope liên quan; cần session hợp lệ/được giải quyết trước resume |
| 405/403 hoặc BardErrorInfo không đủ evidence | `provider-restriction-unknown`; không khẳng định ban IP hoặc CAPTCHA chỉ từ status/code chung |
| 5xx, lỗi mạng | Chỉ retry nếu xác nhận retryable và không có completion chưa xác định; retry vẫn đi qua governor |
| Timeout/disconnect sau khi dispatch nhưng không có terminal evidence | `outcome-unknown`; tra registry, không tự tạo operation mới để gửi lại |
| JSON/schema lỗi với response đã complete | Giữ giới hạn repair hiện có; lần generation sửa cũng phải xếp hàng; không mở circuit Google chỉ vì JSON lỗi |
| Input sai, quá kích thước, thiếu cue | Lỗi riêng operation/video; không làm chặn toàn dịch vụ |
| `gateway-busy`/disk capacity | Backpressure tại máy; không gắn nhãn Google rate limit; chưa dispatch thì không tăng upstream attempts |

Nếu provider-restriction-unknown có evidence rejection trước generation, có thể cho một lần thử sau cooldown để phân biệt lỗi tạm thời. Nếu delivery/completion chưa rõ thì đi nhánh outcome-unknown, không thử mù.

State governor: `ready → running → spacing → ready`; lỗi giới hạn đưa sang `cooldown → half-open → ready/cooldown/blocked`. `blocked` không được tự biến thành `ready` chỉ vì GET capabilities trả `provider_ready=true`. Persist cooldown/block trước khi trả lỗi cho client; restart phải giữ thời điểm nghỉ. Clock fake/monotonic trong phiên, UTC cho persistence; xử lý clock jump bảo thủ.

### 3.3. Chờ dài qua operation API, không giữ HTTP generation

Cooldown vài phút/giờ không được chạy trong deadline generation 180 giây. Thêm operation API opt-in, giữ route synchronous cũ để tương thích. Cả hai vẫn dùng chung governor.

| API đề xuất, dưới `/openai/v1/gateway` và `/v1/gateway` | Hợp đồng |
|---|---|
| `GET /scheduler` | State, nextEligibleAt, reason, revision, queue depth; đọc cache, không gọi Google |
| `POST /requests` | `{client_request_id, request: <ChatCompletionRequest hiện tại>}`; persist input/identity trước khi trả 202; 503 local nếu không admission được |
| `GET /requests/:id` | Status, attempt count, dispatch/completion evidence, nextEligibleAt; response JSON cuối khi completed |
| `POST /requests/:id/cancel` | Idempotent; bỏ queued request ngay; đang chạy gửi cancel và vẫn quản lý lease cho đến khi network settle |
| `POST /requests/:id/ack` | Client xác nhận đã lưu kết quả/checkpoint; cho phép dọn payload/result, giữ tombstone chống replay |

- Advertise `scheduler_contract_version: 1`, `request_status: true`, `request_jobs: true`, `max_request_body_bytes`; chỉ bật sau implementation/test. Giữ `gateway_contract_version: 2` và completion/model metadata hiện tại.
- Request id là UUID sinh và persist ở TediaPros trước submit, gắn với job/item/stage/source+media digest/prompt+parser/locale/model policy. Gateway tự tính canonical request hash; không tin hash client gửi.
- Cùng ID + cùng payload trả operation cũ, không dispatch mới. Cùng ID + payload khác trả 409. Hai submit đồng thời cùng ID chỉ có một owner.
- TediaPros sinh operation token ngẫu nhiên tối thiểu 256 bit; gửi trong header riêng cho submit/status/cancel/ack, gateway lưu hash và kiểm tra constant-time. Token không vào URL, audit, progress IPC hay log; client lưu qua vùng credential bảo vệ hiện có. Kết quả chỉ trả đúng owner token và scope. Với deployment có auth hiện hữu, giữ thêm auth đó.
- Async operation states: `queued`, `waiting-provider`, `running`, `succeeded`, `failed`, `blocked`, `cancelling`, `cancelled`, `outcome-unknown`. Kèm `dispatch_state: not-dispatched|dispatched|unknown`; không gọi failed là chưa dispatch nếu chưa chứng minh.
- Gateway persist intent trước dispatch và result/evidence trước khi report success. Worker tách khỏi connection HTTP submit, có deadline/cancel riêng. Client disconnect không tự tạo retry.
- Sau restart: queued/not-dispatched có thể khôi phục; running/dispatched chưa có result phải là outcome-unknown. Không có exactly-once guarantee xuyên crash của Gemini Web; registry tránh replay mù, không giả tạo bảo đảm đó.
- Governor sau crash có running attempt chưa biết kết quả phải giữ gate `blocked/outcome-unknown`; process cũ chết không phải bằng chứng Google đã ngừng xử lý. Không tự cho phép replay hoặc half-open dựa riêng vào việc khóa process cũ đã nhả.
- Poll theo `next_poll_after_ms` tối thiểu 5 giây khi running, giảm tần suất mạnh khi cooldown; countdown UI chạy local. Một bộ poll dùng chung, không một timer gọi server cho mỗi cue.
- Result registry chỉ lưu input/media cần chạy trong storage scope riêng, bounded byte counts. Đề xuất quota 256 MiB, tối đa 16 pending; result đã terminal giữ tối đa 24h hoặc đến ack, tombstone 7 ngày. Không prune queued/running/unknown input đang cần dùng; hết chỗ thì từ chối admission. Nếu result đã expired mà client chưa lưu, trả expired và không tái generate cùng ID. Các con số là cấu hình lưu trữ, không quota dịch.
- Khi operation token bị mất hoặc ID mất registry, client không tự đổi ID gửi lại một request có khả năng đã dispatch. Giữ trạng thái cần khôi phục dịch vụ, không dựng kết quả thành công.

### 3.4. TediaPros lưu trạng thái chờ, không finalize lỗi

- Thêm model shared cho `ProviderWaitState` và operation receipt; toàn bộ IPC đi qua `src/shared/types.ts` và preload typed.
- Nâng batch journal payload schema từ v1 sang v2 với migration đọc v1 rõ ràng; storage directory/envelope cũ có thể giữ tên, không xóa snapshot cũ. Parser hiện strict exact fields nên phải nâng validator, backup reader và tests đồng thời.
- Bổ sung trạng thái item `waiting-provider`, batch provider gate và trường operation id/stage/reason/nextEligibleAt. Token không nằm trong journal chung hay UI.
- Long wait trả outcome `deferred` nội bộ về queue coordinator, không gọi `onTerminal`. Giữ ordinal/reservedOutputDir/attempt, không tăng attempt chỉ vì status poll/cooldown.
- Lưu ASR, source alignment, draft/translation hợp lệ và receipt bền vững trước khi nhả item scope. Dọn scratch có thể tái tạo; không xóa artifact checkpoint rồi hứa resume không chạy lại ASR.
- Nhả GPU/CPU/disk reservation có thể tái cấp và local inference lease khi deferred; upstream permit do gateway quản lý độc lập. Không giữ file lease không cần thiết trong hàng giờ.
- Dừng admission video mới khi provider gate đang cooldown/blocked. Cho phép local render đang chạy hoàn tất; không tiếp tục tích lũy ASR/OCR scratch của toàn batch.
- Default batch theo yêu cầu này: `maxActiveItems=1`. Không tự đổi profile cũ của người dùng; chế độ 2 worker nếu còn hỗ trợ vẫn dùng chung provider gate.
- Trong phiên đang chạy: đến hạn tự tra state, lấy lại đúng item, kiểm tra source/config/evidence digest rồi tiếp tục stage còn thiếu. Không chạy lại draft nếu draft đã valid, không dịch lại vì TTS/render lỗi.
- Khi người dùng hủy: hủy timer/poll, gửi cancel idempotent, không tự resume. Khi đóng app/crash: giữ `interrupted` và resume intent phù hợp quy tắc hiện hữu, không tự launch batch trong nền.
- UI chỉ hiển thị: “Đang chờ Gemini, tự tiếp tục lúc …”, “Đang kiểm tra lại kết nối”, hoặc “Cần đăng nhập lại Gemini”. Các nút tạm dừng/hủy luôn hoạt động; không bắt duyệt từng câu.
- Client kết nối gateway cũ: giữ luồng legacy được ghi rõ; không giả rằng có coordinated auto-resume. Khi capability mới có mặt, bỏ `enforceGatewaySpacing`, cooldown 45 giây và generation Ping khỏi nhánh mới. Không để cả hai scheduler hoạt động trên một operation.

### 3.5. Media và tự sửa ASR là phần tích hợp sau governor

- Không cần xây lại hỗ trợ `input_audio`/`image_url` của gateway. TediaPros chuẩn bị audio gốc của processing timeline phù hợp source cues, giữ mapping tới original source-time và temporal-cut plan.
- Ưu tiên audio toàn short + ledger ASR; thêm OCR nguồn tách riêng khi có. OCR giữ provenance/time/ROI, không coi confidence=1 của bản fused hiện tại là xác nhận ngữ nghĩa.
- Đo JSON bytes sau base64. Target tối đa 3,5 MiB/request khi HTTP max là 4 MiB; nén audio trước, giảm frame không cần thiết, rồi mới chia theo nhóm cue với context overlap. Không cắt âm tiết; ánh xạ offset clip bằng code. Các chunk và retry đều qua operation API.
- Lượt draft đối chiếu và trả source edits + translation có ID; reviewer nhận nguồn gốc, edits, bằng chứng và draft. Hai lượt đồng thuận không được ghi thành bằng chứng chắc chắn đúng.
- Source edits có evidence refs hợp lệ, bảo toàn cue ID/timestamp; corrected source là layer riêng, không ghi đè raw ASR. Thay đổi số/tên/phủ định phải có bằng chứng, không bị hợp thức hóa chỉ bởi confidence do model tự khai.
- Nếu thiếu bằng chứng: một bước bổ sung clip/frame đúng đoạn, chỉ tiếp tục khi evidence/candidate có thay đổi thực; không gọi lại cùng payload vô hạn. Hết khả năng cải thiện thì lỗi riêng video và tiếp tục batch khi provider khỏe; không yêu cầu người dùng duyệt nội dung để hàng đợi chạy tiếp.
- Draft checkpoint identity phải thêm media digest, evidence revision và restoration prompt/parser version. Checkpoint text-only cũ không được gắn nhãn đã nghe audio.
- Giữ model policy hiện tại: alias `gemini-advanced`, `require_verified_model=false`, `require_complete_response=true`, observed model trung thực. Không pin Pro trở lại chỉ vì probe vừa quan sát được Pro.
- Giữ tempo 1.80x, cue completeness, code-owned timing, Planar RGB và no-silent-drop. Chất lượng nguồn không được đánh đổi bằng xóa câu để job thành công.

## 4. Work packages theo thứ tự

### P0 — Chốt baseline và contracts

1. Ghi inventory dirty/untracked của hai repo, source hashes và gateway process/binary đang chạy; chỉ sửa hunk thuộc task. Không đọc/xuất cookie từ `.env`.
2. Viết fixture chung TypeScript/Go cho scheduler metadata, errors, operation status và duplicate semantics. Chốt clock/sleeper/network adapter inject được để test không ngủ thật.
3. Thêm ADR mới về quyền điều tiết tại gateway khi bắt đầu implementation; nội dung lấy từ quyết định trong kế hoạch này. Cập nhật tài liệu cũ có phát biểu chưa có bằng chứng.
4. Giữ tests/baseline hiện tại; không coi passing baseline là feature mới đã có.

Gate: schema wire thống nhất; bảng phân loại lỗi có ví dụ rejected/unknown; xác định đầy đủ call sites upstream.

### P1 — Governor tại CreateMediaTool

Tệp mới đề xuất: `internal/modules/providers/upstream_governor.go`, `upstream_failure.go`, `upstream_state_store.go` cùng tests.

Tệp tích hợp: `provider_module.go`, `client_pool.go`, `gemini_service.go`, `gemini_chat_session.go`, `gemini_upload.go`, `internal/commons/configs/configs.go`; đối chiếu `deep_research.go`, OpenAI/Gemini/Claude/image/verification routes để không có bypass.

1. Shared permit + FIFO + pacing + persisted cooldown/block + owner lock.
2. Giữ upstream HTTP status, `Retry-After`, response evidence đủ để phân loại; không parse lỗi bằng substring “rate limit” nằm trong mô tả BardError chung.
3. Tất cả actual retry dùng admission chung. Lỗi 429 upload cũng mở cooldown; không retry generation khi upload thất bại.
4. Tách limiter inbound hiện hữu khỏi quota/pacing upstream; tên config và log phân biệt hai lớp.

Gate: 1000 operation giả lập từ nhiều route/client không có hơn một attempt active, không generation trong cooldown, cancel không leak permit, restart không xóa block.

### P2 — Operation API và chống gửi trùng

Tệp mới đề xuất: `internal/modules/openai/gateway_requests.go`, `gateway_request_store.go`, `gateway_scheduler_controller.go` và tests. Sửa DTO/controller/module, metadata/capabilities và operation executor dùng service hiện hữu.

1. Implement submit/status/cancel/ack, operation token, canonical digest, result/tombstone storage và bounded disk admission.
2. Lưu request trước 202; lưu dispatch intent trước gọi provider; complete result trước trả success/status.
3. Cùng ID dùng lại receipt; sau disconnect/restart không tạo request mới nếu outcome còn unknown.
4. Legacy sync routes vẫn được governor bảo vệ, không tự trả 202 cho client cũ. Khi không thể chờ admission, trả local busy có retry hints và attempts=0.

Gate: simultaneous duplicates, payload conflict, client timeout sau dispatch, crash boundaries, token/scope isolation, expired response và cancel/running race đều có fixture.

### P3 — Batch tự nghỉ/tiếp tục trong TediaPros

Tệp chính: `src/main/geminiGateway.ts`, `geminiGatewayDraftCheckpoint.ts`, `autoShortQueueRunner.ts`, `autoShortItemCoordinator.ts`, `autoshort.ts`, `autoShortBatchStore.ts`; thêm `geminiGatewayOperations.ts` và `autoShortProviderWait.ts` nếu giúp cô lập trách nhiệm.

Contracts/UI: `src/shared/autoShortBatchJournal.ts`, `src/shared/types.ts`, `src/shared/translation.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/renderer/src/components/AutoShort.tsx`. Phải đọc AGENTS theo thư mục trước khi sửa.

1. Capability negotiation; dùng operation API khi hỗ trợ, đọc state thay generation Ping.
2. Persist receipt → deferred outcome → batch state waiting-provider; không finalize những item chưa chạy.
3. Một timer/poller cancellable của main; UI countdown bằng IPC; half-open gate do gateway quyết định.
4. Resume đúng stage, validate digest/checkpoint, re-acquire resource; không dịch lại phần đã hoàn tất.
5. Schema v1 migration, shutdown/cancel/resume và legacy fallback rõ ràng. Bỏ client 45-second retry trong nhánh mới.
6. Mọi Gemini dùng cho title/SEO/rephrase cũng đi qua cùng operation helper; lỗi metadata không xóa video đã render thành công.

Gate: fake cooldown 30 phút không phát sinh request generation lặp, UI không freeze, cancel <1 giây ở lớp app; 100 video mock giữ thứ tự, số success/failure đúng và video pending không thành error hàng loạt.

### P4 — Qualification và rollout phần điều tiết

1. Chạy toàn bộ test phù hợp và build hai ứng dụng. Deploy gateway mới trước; xác minh binary/path/process và capabilities, sau đó mới bật client mới.
2. Test offline lỗi 429, quota, auth, challenge, unknown, disconnect, restart. Không cố tình gây rate limit/challenge thật để “test ban”.
3. Live canary: một operation synthetic, sau đó batch 3 video; chỉ tăng lên 10 khi không có throttle/unknown. Không benchmark 100–500 request thật liên tục.
4. Ghi latency p50/p95, queue wait, upload bytes, actual attempts, cooldown reasons, resume reuse, duplicate dispatch count, source/output digest. Không log raw media/cookie/token.
5. Rollback: drain/cancel admission rồi giữ state/operation store; không hạ client sang legacy rồi replay operation unknown. New journal cần down-migration tool hoặc chỉ rollback binary khi không còn active v2 job; không ép app cũ đọc schema mới.

Gate: running binary xác nhận cả governor và operation API; canary artifacts chứng minh resume và không duplicate trong phạm vi đã chạy. Không dùng từ “không thể bị ban”.

### P5 — Nối audio/OCR và tự kiểm chứng bản dịch

Tệp chính: `autoShortItemCoordinator.ts`, `geminiGatewayPrompts.ts`, `geminiGateway.ts`, `geminiGatewayDraftCheckpoint.ts`, `src/shared/translation.ts`, các helper evidence/media mới có scope đường dẫn an toàn và cancellation.

1. Chuẩn bị audio/OCR/frame, byte budgeting và cue/clip mapping từ processing timeline.
2. Contract source edits, evidence refs và review; tăng identity version để checkpoint mới không lẫn text-only.
3. Máy tự phát hiện bất đồng, bổ sung evidence và kết thúc khi không tiến triển; không thêm luồng bắt người dùng duyệt từng cue.
4. So sánh ASR-text-only với audio+ASR(+OCR) trên corpus có transcript chuẩn sẵn: tên riêng, số, phủ định, từ đồng âm, tiếng ồn, không phụ đề, OCR mâu thuẫn. Đo cả lỗi được sửa và câu đúng bị sửa sai. Không dùng một LLM tự chấm làm ground truth duy nhất.
5. Live bounded test nhiều video theo governor mới; kiểm tra cue completeness/timestamp và output audio/video.

Gate: transport media đúng không đủ để pass quality; phải có báo cáo corpus, regression fixtures và dữ liệu nào chưa được chứng nhận. Không tự đổi cấu hình user cũ sang upload media cho đến khi feature được bật theo triển khai đã thống nhất.

### P6 — Adapter Gemini API chính thức (tùy chọn)

Giữ API TediaPros → gateway và operation contract; thêm provider chính thức phía sau gateway. Điều tiết theo project/model/quota thực tế, không áp hạn mức Gemini Web lên API. Đây là work package riêng cần credentials và lựa chọn billing của người dùng; không tự fallback từ Web sang API có phí, không đổi key/tài khoản để vượt quota.

## 5. Checklist thực thi P0–P4

Các interface/code dưới đây là **hợp đồng đích và ví dụ test để triển khai**, chưa phải symbol có sẵn trong repo. P5 là chặng chất lượng riêng: thực hiện sau P4, viết plan media chi tiết theo corpus đã chọn trước khi sửa pipeline. Không tự mở rộng P0–P4 thành adapter API chính thức hoặc engine ASR mới.

Mỗi task kết thúc bằng kiểm tra diff chỉ của task và một commit khu trú khi thực sự triển khai trên nhánh được chọn. Không `git add .`; không gộp dirty changes của người dùng vào commit mới. Lượt planning này không tạo commit.

### Task 1: Phân loại lỗi từ evidence thay cho chuỗi thông báo chung

**Files:** Create `CreateMediaTool/internal/modules/providers/upstream_failure.go`, `upstream_failure_test.go`; Modify `gemini_service.go`, `gemini_upload.go`, `internal/modules/openai/openai_service.go`.

**Interfaces:** Consumes HTTP status/header, terminal/completion evidence từ provider. Produces:

```go
type FailureEvidence struct {
    HTTPStatus int
    RetryAfter string
    QuotaExhausted bool
    AuthRequired bool
    Challenge bool
    Dispatched bool
    OutcomeUnknown bool
}
type FailureDecision struct {
    Code string
    RetryAt time.Time
    Retryable bool
    Block bool
}
func ClassifyUpstreamFailure(e FailureEvidence, now time.Time) FailureDecision
```

- [ ] Viết table test cho HTTP 429 với Retry-After seconds/date, 405 không evidence, challenge, auth và outcome unknown. Test trọng tâm:

```go
func TestFailure405DoesNotInventRateLimit(t *testing.T) {
    got := ClassifyUpstreamFailure(FailureEvidence{HTTPStatus: 405}, time.Unix(0, 0))
    if got.Code != "provider-restriction-unknown" || got.Retryable {
        t.Fatalf("must retain uncertainty: %+v", got)
    }
}
func TestFailureHonorsRetryAfter(t *testing.T) {
    now := time.Unix(0, 0)
    got := ClassifyUpstreamFailure(FailureEvidence{HTTPStatus: 429, RetryAfter: "600"}, now)
    if got.RetryAt.Before(now.Add(600*time.Second)) { t.Fatal("retry too early") }
}
```

- [ ] Chạy `go test ./internal/modules/providers -run 'TestFailure' -count=1`, xác nhận FAIL do classifier chưa có/chưa phân loại đúng.
- [ ] Implement theo thứ tự: outcome unknown → challenge/auth → quota → 429 → restriction unknown → transport; parse Retry-After bằng số giây hữu hạn không âm hoặc `http.ParseTime`. Không đọc cookie hoặc nguyên HTML lỗi vào error payload. Mã nhánh cốt lõi:

```go
if e.OutcomeUnknown { return FailureDecision{Code: "outcome-unknown", Block: true} }
if e.Challenge { return FailureDecision{Code: "provider-challenge", Block: true} }
if e.AuthRequired { return FailureDecision{Code: "provider-auth-required", Block: true} }
if e.HTTPStatus == 405 || e.HTTPStatus == 403 {
    return FailureDecision{Code: "provider-restriction-unknown", Block: true}
}
```

- [ ] Chạy table tests và OpenAI/provider baseline; kiểm tra generic BardError không còn tự kích hoạt retry bằng các từ trong câu giải thích.
- [ ] Review/commit riêng classifier và adapter extraction; ghi rõ lỗi nào là unknown trong task handoff.

### Task 2: Governor có concurrency một và pacing dùng chung

**Files:** Create `internal/modules/providers/upstream_governor.go`, `upstream_governor_test.go`; Modify `provider_module.go`, `client_pool.go`, `gemini_service.go`, `gemini_chat_session.go`, `gemini_upload.go`, config.

**Interfaces:** Consumes `FailureDecision` từ Task 1. Produces bộ state machine có thể test bằng thời gian tường minh, được waiter cancellable gọi trong production:

```go
type GovernorPolicy struct { MinSpacing, InitialCooldown time.Duration }
type Permit struct { ID uint64 }
type GateDecision struct { Allowed bool; NotBefore time.Time; Reason string }
type AttemptOutcome struct { Kind string; RetryAt time.Time }
func NewUpstreamGovernor(p GovernorPolicy) *UpstreamGovernor
func (g *UpstreamGovernor) TryStart(now time.Time) (Permit, GateDecision)
func (g *UpstreamGovernor) Finish(p Permit, result AttemptOutcome, now time.Time) error
```

- [ ] Viết test tránh permit kép, stale/double Finish, sau completion phải spacing và half-open chỉ một owner:

```go
func TestGovernorBlocksOverlapAndSpacesAfterFinish(t *testing.T) {
    now := time.Unix(0, 0)
    g := NewUpstreamGovernor(GovernorPolicy{MinSpacing: 15*time.Second, InitialCooldown: time.Minute})
    p, first := g.TryStart(now)
    if !first.Allowed { t.Fatal("first attempt not admitted") }
    if _, second := g.TryStart(now.Add(time.Second)); second.Allowed { t.Fatal("overlap") }
    end := now.Add(20*time.Second)
    if err := g.Finish(p, AttemptOutcome{Kind: "complete"}, end); err != nil { t.Fatal(err) }
    if _, early := g.TryStart(end.Add(14*time.Second)); early.Allowed { t.Fatal("spacing") }
    if _, ready := g.TryStart(end.Add(15*time.Second)); !ready.Allowed { t.Fatal("not ready") }
}
```

- [ ] Chạy `go test ./internal/modules/providers -run 'TestGovernor' -count=1`; xác nhận test đỏ trước implementation.
- [ ] Implement mutex bao state transition; `TryStart` từ chối khi running/block/now < nextEligible; cấp permit tăng đơn điệu. `Finish` chỉ nhận permit đang active, đặt `nextEligible=max(end+spacing,retryAt)`; outcome unknown giữ blocked. FIFO waiter chỉ wake head hợp lệ, bỏ cancelled entry. Không ngủ khi giữ mutex.
- [ ] Inject **cùng một pointer governor** vào default Client và pooled Client. Đưa admission trước upload, Finish sau upstream settle; service retries đi lại admission. Thêm tests đa route bằng fake transport, kiểm tra maximum inflight=1 và cancelled waiter không gọi network.
- [ ] Chạy OpenAI/provider suites; review call-site inventory không bypass rồi commit khu trú.

### Task 3: Giữ cooldown/block qua restart và ngăn hai owner

**Files:** Create `internal/modules/providers/upstream_state_store.go`, `upstream_state_store_test.go`; Modify provider module/config và tài liệu `docs/gemini-gateway-v2.md`.

**Interfaces:** Consumes governor state Task 2; produces store và owner lock cùng một root canonical:

```go
type GovernorSnapshot struct {
    Version int
    State string
    NotBefore time.Time
    UncertainRequestID string
}
func OpenGovernorStore(root string) (*GovernorStore, error)
func (s *GovernorStore) Save(v GovernorSnapshot) error
func (s *GovernorStore) Load() (GovernorSnapshot, error)
func (s *GovernorStore) Close() error
```

- [ ] Viết restart/owner test; dùng `t.TempDir()` và hai lần open cùng root:

```go
func TestGovernorStoreAllowsOneOwner(t *testing.T) {
    dir := t.TempDir()
    owner, err := OpenGovernorStore(dir)
    if err != nil { t.Fatal(err) }
    defer owner.Close()
    if second, err := OpenGovernorStore(dir); err == nil {
        second.Close()
        t.Fatal("second process owner must not be admitted")
    }
}
```

- [ ] Chạy `go test ./internal/modules/providers -run 'TestGovernorStore' -count=1`, xác nhận đỏ.
- [ ] Implement canonical root + OS-backed lock; validate version/state/date/digest; save temp cùng thư mục → sync file → replace có backup phù hợp Windows → load validate. Fail save thì giữ gate blocked trong RAM và báo storage error, không continue dispatch. Crash running state phục hồi thành blocked/outcome-unknown.
- [ ] Test lỗi corrupt/disk full/rename và clock rollback; chạy test lock bằng process con trên Windows và macOS/CI. Không chỉ test hai object trong cùng process.
- [ ] Review quyền file, redaction, shared directory của các instance; commit riêng store và deployment config example, không sửa `.env` chứa secret.

### Task 4: Registry admission và idempotency

**Files:** Create `internal/modules/openai/gateway_request_store.go`, `gateway_request_store_test.go`; Create `gateway_requests.go` cho operation model; sửa DTO để response status dùng kiểu thống nhất.

**Interfaces:** Consumes existing `ChatCompletionRequest` JSON, owner token hash và limits. Produces:

```go
type StoreLimits struct { MaxPending int; MaxBytes int64 }
type Operation struct {
    ID, ClientRequestID, Status, DispatchState string
    PayloadHash string
    UpstreamAttempts int
}
func OpenRequestStore(root string, limits StoreLimits) (*GatewayRequestStore, error)
func (s *GatewayRequestStore) Admit(owner [32]byte, clientID string, payload []byte) (Operation, bool, error)
func (s *GatewayRequestStore) Close() error
```

Boolean trả từ `Admit` là `created`; owner+clientID là lookup key, canonical parsed JSON là digest input. Các field result/wait/error dùng envelope ở mục 3.3, không log payload.

- [ ] Viết test concurrent duplicate, changed payload conflict, malformed/oversized JSON và store capacity:

```go
func TestRequestStoreDeduplicatesCanonicalJSON(t *testing.T) {
    s, err := OpenRequestStore(t.TempDir(), StoreLimits{MaxPending:16, MaxBytes:256<<20})
    if err != nil { t.Fatal(err) }
    defer s.Close()
    owner := sha256.Sum256([]byte("synthetic-owner-token"))
    a, created, err := s.Admit(owner, "9848538a-a1af-4f86-bddd-772f081c3253", []byte(`{"model":"gemini-advanced","messages":[{"role":"user","content":"hello"}]}`))
    if err != nil || !created { t.Fatalf("first admit: %v", err) }
    b, created, err := s.Admit(owner, "9848538a-a1af-4f86-bddd-772f081c3253", []byte(`{"messages":[{"content":"hello","role":"user"}],"model":"gemini-advanced"}`))
    if err != nil || created || a.ID != b.ID { t.Fatalf("duplicate: %+v %v", b, err) }
}
```

- [ ] Chạy `go test ./internal/modules/openai -run 'TestRequestStore' -count=1`, xác nhận đỏ.
- [ ] Implement exact schema validation trước canonical hashing, map lookup dưới mutex + atomic disk write trước `created=true`; media bytes tính sau decode lẫn encoded HTTP size. Canonicalization phải giữ array order, loại duplicate JSON keys, không strip field có ý nghĩa. Capacity fail không tạo operation/attempt.
- [ ] Kiểm tra token hash/scope, traversal IDs, terminal retention/tombstone, concurrent admission và failure injection; không prune queued/running/unknown.
- [ ] Chạy suites và commit riêng registry; chưa advertise request_jobs cho đến Task 5.

### Task 5: Worker, status/cancel/ack API và restart semantics

**Files:** Create `internal/modules/openai/gateway_scheduler_controller.go`, `gateway_requests_test.go`; Modify `gateway_requests.go`, `gateway_request_store.go`, `openai_controller.go`, `openai_module.go`, metadata contract fixtures.

**Interfaces:** Consumes Task 2 governor, Task 4 registry và existing `CreateChatCompletionWithClient`; produces 5 routes tại mục 3.3 và hàm pure `RecoverOperation(op Operation) Operation`. Execution adapter gọi service hiện hữu; không thêm vòng retry quanh service.

- [ ] Test crash trước/sau dispatch và status query không gọi provider; regression cốt lõi:

```go
func TestRecoveryNeverRequeuesDispatchedRequest(t *testing.T) {
    got := RecoverOperation(Operation{ID:"op-1", Status:"running", DispatchState:"dispatched", UpstreamAttempts:1})
    if got.Status != "outcome-unknown" || got.UpstreamAttempts != 1 { t.Fatalf("unsafe replay: %+v", got) }
}
```

- [ ] Chạy `go test ./internal/modules/openai -run 'TestRecovery|TestGatewayRequest' -count=1`; tạo HTTP contract tests với Fiber `app.Test` và fake provider đếm calls; xác nhận đỏ trước routes.
- [ ] Implement recover transition:

```go
func RecoverOperation(op Operation) Operation {
    if op.Status == "running" || op.Status == "cancelling" {
        if op.DispatchState == "not-dispatched" { op.Status = "queued" } else { op.Status = "outcome-unknown" }
    }
    return op
}
```

- [ ] Wire submit persist→202, worker dispatch persist→service→result persist, status read-only, cancel idempotent và ack tombstone. Token authorization áp dụng tất cả routes của operation; governor state endpoint chỉ trả scope phù hợp. Client disconnect không cancel worker ngầm; explicit cancel không nhả permit trước network settle.
- [ ] Test lost HTTP response rồi submit cùng ID, token sai, expired result, cancel khi upload, success/cancel race, worker restart; advertise capability chỉ sau route parity tests.
- [ ] Chạy full Go tests/build; review/commit API và operation contracts, giữ legacy sync response semantics.

### Task 6: Client operation adapter và receipt bền vững

**Files:** Create `TediaPros/src/main/geminiGatewayOperations.ts`, `src/shared/gatewayOperation.ts`, `tests/gemini-gateway-operations.test.ts`; Modify `geminiGateway.ts`, `geminiGatewayDraftCheckpoint.ts`, `scripts/run-local-runtime-tests.mjs`.

**Interfaces:** Shared module không import Node; consumes JSON operation status và receipt. Produces `operationAction(status)` dùng bởi client orchestrator:

```ts
export type GatewayOperationStatus = 'queued' | 'waiting-provider' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelling' | 'cancelled' | 'outcome-unknown'
export type OperationAction = 'poll' | 'consume' | 'stop'
export function operationAction(status: GatewayOperationStatus): OperationAction
```

- [ ] Đăng ký test mới trong knownTests. Test trước implementation:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { operationAction } from '../src/shared/gatewayOperation'
test('unknown outcome never causes resubmit', () => {
  assert.equal(operationAction('outcome-unknown'), 'stop')
  assert.equal(operationAction('running'), 'poll')
  assert.equal(operationAction('succeeded'), 'consume')
})
```

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs gemini-gateway-operations.test`; xác nhận đỏ.
- [ ] Implement action map:

```ts
export function operationAction(status: GatewayOperationStatus): OperationAction {
  if (status === 'succeeded') return 'consume'
  if (status === 'queued' || status === 'waiting-provider' || status === 'running' || status === 'cancelling') return 'poll'
  return 'stop'
}
```

- [ ] Adapter persist client UUID/token/identity trước POST; timeout submit chỉ GET/POST cùng ID+payload để retrieve receipt, không tạo UUID mới. Chỉ ack sau checkpoint local thành công. Poll/wait ngoài generation deadline; dùng AbortSignal cho từng HTTP và timer. Validate result qua parser hiện hữu; lấy capabilities chọn async hoặc legacy, bỏ legacy spacing/cooldown/Ping chỉ ở nhánh mới.
- [ ] Mock fetch chuỗi submit-lost/status-running/status-success và assert đúng 1 logical generation, không đổi ID; thêm cancellation/schema/owner-token redaction tests. Chạy typecheck và gateway suites rồi review/commit adapter.

### Task 7: Deferred batch, migration và UI countdown

**Files:** Create `src/main/autoShortProviderWait.ts`, `tests/autoshort-provider-wait.test.ts`; Modify `src/shared/autoShortBatchJournal.ts`, `src/shared/types.ts`, `src/preload/index.ts`, `src/main/index.ts`, `autoShortBatchStore.ts`, `autoShortQueueRunner.ts`, `autoShortItemCoordinator.ts`, `autoshort.ts`, `src/renderer/src/components/AutoShort.tsx`, runner manifest.

**Interfaces:** Consume Task 6 receipt/status. Produce typed `ProviderWaitState`, journal v2 migration và deferred result union dùng nội bộ; `AutoShortItemResult` terminal không bị ép nhận waiting:

```ts
export interface ProviderWaitState {
  operationId: string
  stage: 'restore-translate' | 'independent-review' | 'rephrase' | 'metadata'
  reason: string
  nextEligibleAtUtc: string | null
}
export function shouldWakeProviderWait(wait: ProviderWaitState, nowMs: number, cancelled: boolean): boolean {
  if (cancelled || wait.nextEligibleAtUtc === null) return false
  const deadline = Date.parse(wait.nextEligibleAtUtc)
  return Number.isFinite(deadline) && nowMs >= deadline
}
```

- [ ] Test cancel không wake và pending không terminal; regression timing:

```ts
test('cancelled batch cannot wake after cooldown', () => {
  const wait = { operationId:'op-1', stage:'restore-translate' as const, reason:'provider-throttled', nextEligibleAtUtc:'2026-09-17T00:01:00.000Z' }
  assert.equal(shouldWakeProviderWait(wait, Date.parse('2026-09-17T00:02:00.000Z'), true), false)
})
```

- [ ] Chạy provider-wait/queue/resume tests, xác nhận các hành vi mới đỏ trước sửa queue. Nâng v1 snapshot đọc thành normalized v2, đổi test hiện đang từ chối mọi schemaVersion=2 để chỉ từ chối version không hỗ trợ. Giữ checksum envelope khi migrate/backup.
- [ ] Sửa flow `processItem` trả `{kind:'deferred', wait}` hoặc `{kind:'terminal', result}` nội bộ. Deferred persist checkpoint và release resource; queue lưu waiting, không gọi finalize/onTerminal và không tăng attempt vì poll. Wake lấy lại đúng ordinal/digest/stage. Dừng admission trong cooldown toàn group.
- [ ] Wire typed IPC progress và countdown UI, cleanup listeners/timers; cancel chuyển explicit cancelled, crash phục hồi interrupted. Title/metadata waiting không xóa rendered output; summary counts không cộng deferred vào failed.
- [ ] Test 100 video mock + 30 phút clock giả + restart/cancel + changed input digest. Chạy typecheck, queue/batch/store/gateway tests rồi review/commit riêng integration.

### Task 8: Regression toàn đường và rollout có bằng chứng

**Files:** Create `tests/gateway-batch-recovery.test.ts`, Go governor/request HTTP integration fixtures; Modify task handoff, `docs/architecture.md`, `docs/domain.md`, `CreateMediaTool/docs/gemini-gateway-v2.md`; tạo ADR mới khi implementation bắt đầu, không ghi PLANNED thành Accepted trước test.

**Interfaces:** Consumes governor/operation/batch behavior của Tasks 1–7. Produces báo cáo test offline và canary, không API phần mềm mới.

- [ ] Viết end-to-end fixture cho 100 jobs với 429 tại operation thứ 3, Retry-After 600 giây, resume thành công; dùng fake clock và fake Gemini. Các assertion phải có trong test:

```ts
assert.equal(report.maxUpstreamInflight, 1)
assert.equal(report.generationsDuringCooldown, 0)
assert.equal(report.duplicateDispatches, 0)
assert.equal(report.failedPendingItems, 0)
assert.equal(report.completedItems, 100)
```

`report` là kết quả harness thu từ actual fake transport events và terminal queue results, không lấy trực tiếp từ cấu hình governor. Fixture phải thêm đường cancel và unknown result với expected completedItems tương ứng, không tái dùng assertion 100 khi đã hủy.

- [ ] Chạy toàn lệnh ở mục ma trận bên dưới; test failure phải được giải quyết trước deploy. Race suite có compiler mới ghi PASS; nếu chưa có toolchain thì ghi NOT_RUN và chạy ở CI hỗ trợ.
- [ ] Build gateway/client, lưu build hashes; drain và thay đúng binary gateway, kiểm tra capabilities/process trước bật client feature. Không deploy khi có operation active/unknown không có phương án bảo toàn.
- [ ] Live canary 1 synthetic → 3 video → tối đa 10 theo gate P4; dừng ngay nếu có restriction, không tạo tải thử chặn. Ghi số attempt/latency/queue wait thực tế và các trường hợp chưa kiểm tra.
- [ ] Hoàn tất docs/handoff và commit khu trú; chỉ công bố điều tiết/auto-resume đúng phạm vi đã kiểm chứng. P5/P6 chưa làm giữ trạng thái PLANNED.

## 6. Ma trận kiểm thử bắt buộc khi triển khai

| Nhóm | Ca kiểm thử có ý nghĩa |
|---|---|
| Admission | Nhiều route, nhiều ClientPool entry, cookie rotation, hai process cùng egressGroup, retry cùng lúc, FIFO không starvation |
| Timing | Khoảng nghỉ tính sau attempt settle; Retry-After seconds/date; reset dài; jitter không thử sớm; clock rollback/suspend |
| Errors | 429 tại upload/generate, 405 có/không challenge, BardError mơ hồ, 401/403 theo evidence, 5xx và unknown dispatch |
| Breaker | Không upload/generate trong cooldown, chỉ 1 half-open, restart giữ block, không mở circuit vì schema/input riêng video |
| Idempotency | Hai submit cùng ID, ID/payload conflict, timeout khi server vẫn chạy, crash trước/sau dispatch/result persistence, result expiry |
| Storage | Disk-full trước admission, fsync/rename lỗi, corrupt state, không prune active lease, redaction token/cookie, scope/token sai |
| Batch | 100/1000 item mock, pending không bị fail, deferred không gọi onTerminal, thứ tự giữ nguyên, cancel không auto-resume |
| Checkpoint | Draft valid chỉ review; translation valid không dịch lại vì TTS/render; source/config/media digest đổi phải invalidate |
| UI/IPC | Waiting state/countdown, app đóng/mở lại, migration journal v1, listener cleanup, không hiển thị token/thuật ngữ nội bộ không cần thiết |
| Media | WAV/MP3 có giải mã thật, OCR/ASR mâu thuẫn, split/overlap/source cut mapping, request vượt HTTP byte cap, không mất cue |
| Legacy | Gateway v2 cũ + client mới; client cũ + governor mới; đồng thời Web sync/job API không vượt global permit |

Lệnh dự kiến (chạy ở đúng repo; tests mới bổ sung vào runner manifest nếu runner yêu cầu):

```powershell
# CreateMediaTool
go test ./internal/modules/openai/... ./internal/modules/providers/... -count=1
go test ./...
go build ./...
# Race: chạy trong CI/máy có CGO/compiler phù hợp; không ghi PASS nếu chưa chạy.
go test -race ./internal/modules/openai/... ./internal/modules/providers/...

# TediaPros
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-queue-throughput.test autoshort-batch-resume.test autoshort-batch-store.test gemini-gateway-contract.test gemini-gateway-draft-resume.test
npm.cmd run test:local-runtime
npm.cmd run build
```

## 7. Definition of Done theo chặng

- P1–P4 hoàn thành mới được mô tả là “batch có điều tiết và tự phục hồi giới hạn tạm thời”.
- P5 hoàn thành mới được mô tả là “ASR được đối chiếu audio/OCR tự động trong pipeline”. Probe media riêng không thay thế gate này.
- Phân biệt CODE_CONFIRMED, TEST_CONFIRMED, LIVE_CONFIRMED và UNKNOWN trong task handoff.
- Mỗi chặng có file diff khu trú, tests cụ thể, migration/rollback và cập nhật docs; giữ LICENSE/NOTICE và các invariants của AGENTS.
- Không coi cooldown/block hợp lệ là đã chạy thành công toàn batch. Không coi CAPTCHA/auth/outcome-unknown là lỗi có thể tự bỏ qua bằng retry.

## 8. Kiểm chứng đã chạy cho bản planning này

- `npm.cmd run typecheck`: PASS node + web.
- `node scripts/run-local-runtime-tests.mjs autoshort-queue-throughput.test gemini-gateway-contract.test autoshort-batch-resume.test`: PASS 29 tests (7 + 19 + 3).
- CreateMediaTool `go test ./internal/modules/openai/... ./internal/modules/providers/... -count=1`: PASS 3 packages.
- Chưa triển khai governor/operation API/schema v2/media pipeline, chưa chạy các test mới hoặc live canary P4/P5. Những kết quả trên là baseline của working tree hiện tại.

## 9. Nguồn tham khảo đã đối chiếu ngày 2026-09-17

- [Google: Gemini Apps limits](https://support.google.com/gemini/answer/16275805?hl=en): hạn mức Web thay đổi và phụ thuộc compute/model/context; không suy ra một số video/giờ an toàn.
- [Google: Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits): quota API theo project/model, có nhiều chiều; chỉ áp dụng cho P6, không lấy quota API gán sang Gemini Web.
- [Google: API retry guidance](https://ai.google.dev/gemini-api/docs/troubleshooting): backoff/jitter, phân loại lỗi và retry hữu hạn là hướng dẫn API. Dùng làm nguyên tắc vận hành, không làm bằng chứng rằng Web sẽ gỡ chặn sau một thời gian cụ thể.
- [Chính sách ngân sách dịch hiện hành](../../translation-budget-policy.md).
- [Kế hoạch khôi phục/dịch trước đó](2026-09-14-gemini-gateway-restoration-translation.md): tái dùng mục tiêu evidence và cue identity; các quyết định scheduling/operation API ở bản này là thiết kế tiếp theo, chưa có trong runtime.
