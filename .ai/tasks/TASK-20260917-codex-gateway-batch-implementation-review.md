# TASK-20260917: Review triển khai gateway scheduling và phục hồi ASR

- Trạng thái: Hoàn thành review; triển khai **chưa đạt điều kiện nghiệm thu P0–P5**.
- Người thực hiện: Codex, với hai lượt review độc lập theo skill requesting-code-review.
- Ngày: 2026-09-17.
- TediaPros: HEAD `d73db03` cùng working tree hiện tại.
- CreateMediaTool: HEAD `f44b6ac` cùng working tree hiện tại.

## 1. Mục tiêu và phạm vi

Đối chiếu báo cáo Antigravity với kế hoạch đã duyệt, code thực tế và kiểm tra offline. Trọng tâm: giới hạn upstream dùng chung, retry/unknown outcome, restart, operation identity, cancellation, checkpoint, tự tiếp tục batch và phục hồi ASR dựa trên audio/OCR.

Hai repo có nhiều thay đổi chưa commit từ trước. Review này chỉ kết luận về phần scheduling/restoration đang được báo hoàn thành, không quy toàn bộ diff cho lần triển khai này. Không sửa mã sản phẩm, không restart gateway và không gửi generation lên Google trong lượt review.

Tài liệu đối chiếu:

- [Kế hoạch P0–P6](F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-17-gateway-batch-scheduling-and-auto-recovery.md).
- [Thiết kế](F:/Son/tool/TediaPros/docs/superpowers/specs/2026-09-17-gateway-batch-scheduling-design.md).
- [Bàn giao Antigravity](F:/Son/tool/TediaPros/.ai/tasks/TASK-20260917-gemini-gateway-batch-scheduling-and-auto-recovery.md).

## 2. Tiêu chuẩn review

- [x] Kiểm tra wiring production, không chỉ helper và fixture.
- [x] Chạy lại typecheck và các suite liên quan.
- [x] Tái hiện offline các lỗi trọng yếu bằng mã thật và transport giả.
- [x] Ghi rõ phần đã chứng minh và phần chưa chạy live.
- [ ] Nghiệm thu triển khai: còn các lỗi P1 dưới đây.

## 3. Các phát hiện cần sửa

### R01 — [P1] Fx không truyền governor vào client và pool production

Vị trí: [NewClient](F:/Son/tool/CreateMediaTool/internal/modules/providers/gemini_service.go:132), [NewClientPool](F:/Son/tool/CreateMediaTool/internal/modules/providers/client_pool.go:37), [Fx registration](F:/Son/tool/CreateMediaTool/internal/modules/gemini/gemini_module.go:11), [provider module](F:/Son/tool/CreateMediaTool/internal/modules/providers/provider_module.go:16).

Hai constructor nhận `gov ...*UpstreamGovernor`; Fx/Dig bỏ qua dependency variadic. Vì production đăng ký thẳng hai constructor, cả client mặc định lẫn pool nhận `nil`, mặc dù scheduler controller có một governor riêng để báo status. `GenerateContent` chỉ acquire khi governor khác nil, nên concurrency=1, spacing và cooldown không được thực thi trên các client này.

**TEST_CONFIRMED:** dựng Fx graph bằng constructor thật, không khởi động lifecycle/network: `client=0x0 pool=0x0`, khác governor đã supply.

Sửa: dùng dependency bắt buộc hoặc wrapper Fx truyền cùng một pointer vào mọi client; kiểm tra toàn bộ route generation/upload/session. Regression phải dựng graph production và đo transport qua nhiều client, không chỉ tự gọi `NewClient(..., gov)` trong test.

### R02 — [P1] Mất owner lock vẫn cho instance thứ hai chạy

Vị trí: [provider_module.go](F:/Son/tool/CreateMediaTool/internal/modules/providers/provider_module.go:38).

`OpenGovernorStore` hoặc `SetStore` lỗi chỉ ghi warning, sau đó trả governor mới ở trạng thái ready. Instance thứ hai vẫn được admit dù process khác đã giữ OS lock; trạng thái cooldown/block đã lưu cũng có thể bị bỏ qua khi load lỗi.

**TEST_CONFIRMED:** giữ lock bằng store thứ nhất, gọi constructor thứ hai cùng directory, `TryStart` vẫn trả `Allowed=true`.

Sửa: fail closed khi không có quyền sở hữu hoặc không đọc được state; khóa theo storage/egress identity chuẩn hóa. Test phải chứng minh instance thứ hai không phát upstream.

### R03 — [P1] Restart với operation queued làm treo constructor

Vị trí: [resumeQueued](F:/Son/tool/CreateMediaTool/internal/modules/openai/gateway_scheduler_controller.go:397), [ReadPayload](F:/Son/tool/CreateMediaTool/internal/modules/openai/gateway_request_store.go:224).

`resumeQueued` giữ `store.mu` rồi gọi `ReadPayload`, hàm này tiếp tục lock chính mutex đó. Constructor gọi `resumeQueued` đồng bộ, nên chỉ cần một queued operation còn trên đĩa là startup bị deadlock.

**TEST_CONFIRMED:** persist operation queued, mở lại store, dựng controller; constructor không hoàn tất trong probe 250 ms. Code xác nhận mutex không reentrant.

Sửa: lấy snapshot danh sách dưới lock rồi đọc payload/dispatch ngoài lock; thêm integration test restart có queued operation.

### R04 — [P1] Parse failure giữ permit và tự chờ chính mình

Vị trí: [retry Acquire](F:/Son/tool/CreateMediaTool/internal/modules/providers/gemini_service.go:699), [parse failure continue](F:/Son/tool/CreateMediaTool/internal/modules/providers/gemini_service.go:806).

Nhiều nhánh parse/read/response-limit lỗi `continue` mà chưa finish permit. Vòng sau acquire lại khi permit cũ còn active. Khi acquire hết deadline, phép gán ghi đè permit cũ bằng zero permit, nên defer cũng không giải phóng được permit đã giữ. Lỗi này xuất hiện khi governor được nối đúng, hiện bị R01 che khuất trong production.

**TEST_CONFIRMED:** response 200 có body không hợp lệ, max retries=2: chỉ gửi một request, sau deadline governor vẫn `state=running, active=1`.

Sửa: vòng đời permit rõ ràng cho từng attempt, tất cả nhánh kết thúc đều settle; không ghi đè handle chưa giải phóng. Regression gồm parse failure, oversized body và lỗi đọc stream.

### R05 — [P1] Lỗi kết nối sau dispatch vẫn tự gửi lại

Vị trí: [gemini_service.go](F:/Son/tool/CreateMediaTool/internal/modules/providers/gemini_service.go:743).

Mọi lỗi `plainClient.Do` đều finish với `provider-error` rồi `continue`. Không phân biệt lỗi trước dispatch với mất phản hồi sau khi server có thể đã nhận generation. Điều này phá yêu cầu không replay khi outcome chưa biết và có thể nhân quota/tải upstream.

**TEST_CONFIRMED:** transport giả trả connection reset sau khi nhận request; hai lượt gửi được ghi nhận, governor cuối ở `spacing`, không phải blocked/outcome-unknown.

Sửa: chỉ retry tự động khi chứng minh chưa dispatch; khi không biết kết quả phải lưu outcome-unknown và chặn replay. Giữ cùng operation identity khi client nối lại.

### R06 — [P1] HTTP 429 biến operation thành blocked terminal

Vị trí: [429 classification](F:/Son/tool/CreateMediaTool/internal/modules/providers/upstream_failure.go:112), [operation error handling](F:/Son/tool/CreateMediaTool/internal/modules/openai/gateway_scheduler_controller.go:368).

429 có cả `Retryable=true` và `Block=true`. Executor ưu tiên Block nên đặt operation thành `blocked`, không lưu `NextEligibleAt` ở nhánh này rồi kết thúc worker. Client xem blocked là terminal. Không có worker đang chạy để tự chuyển operation đó qua cooldown và tiếp tục sau Retry-After; kể cả nhánh waiting-provider cũng return, còn startup chỉ resume queued.

**CODE_CONFIRMED:** nhánh điều kiện và lifecycle worker. Không phải lỗi được phép bỏ qua vì governor tự hết cooldown: cooldown của governor và lifecycle của operation là hai trạng thái khác nhau.

Sửa: ánh xạ rõ throttle tạm thời sang waiting-provider; worker/scheduler durable tự thức đúng hạn, một half-open attempt, có cancellation. Test 429 Retry-After 600s qua executor thật.

### R07 — [P1] Batch đang chờ không tự quay lại video bị deferred

Vị trí: [AutoShort throttle conversion](F:/Son/tool/TediaPros/src/main/autoshort.ts:3647), [queue admission](F:/Son/tool/TediaPros/src/main/autoShortQueueRunner.ts:104), [skip deferred](F:/Son/tool/TediaPros/src/main/autoShortQueueRunner.ts:197), [batch-done](F:/Son/tool/TediaPros/src/main/autoshort.ts:3769).

Production không truyền `pauseOnDeferred`. Nhánh chuyển error sang deferred thường đặt operationId rỗng và nextEligibleAtUtc=null. Queue không chờ khi deadline null, tiếp tục admit video sau, rồi bỏ qua mọi deferred item trong pass retry. Cuối hàm batch vẫn phát batch-done; không có vòng wake/resume tự động cho item đang chờ. Nếu có deadline xa hơn 60 giây, queue chỉ sleep tối đa 60 giây rồi tiếp tục admission mà không kiểm tra lại.

**TEST_CONFIRMED:** chạy queue thật với defaults production và ba callback deferred/null deadline: admitted `[v1,v2,v3]`, tất cả kết quả waiting_provider, không item nào được retry/finalize.

Sửa: giữ lifecycle batch đang hoạt động, nối receipt thật vào journal/progress, chặn admission đến khi provider cho phép và tự tiếp tục đúng item. Chỉ thêm `pauseOnDeferred=true` chưa đủ vì vẫn cần bộ điều phối wake/resume.

### R08 — [P1] Cooldown vẫn tiêu hết deadline của generation

Vị trí: [runStage](F:/Son/tool/TediaPros/src/main/geminiGateway.ts:834), [poll loop](F:/Son/tool/TediaPros/src/main/geminiGatewayOperations.ts:120).

`createGatewayDeadline` bọc cả submit và poll. Queued/waiting-provider vì vậy vẫn tiêu ngân sách stage; hiện constant là 360.000 ms. Retry-After 600 giây hợp lệ sẽ hết timeout trước khi được chạy. Poll chưa nối `onProgress` vào batch, và lỗi timeout có thể bị trình bày như hủy tác vụ.

**TEST_CONFIRMED:** adapter thật với deadline rút gọn 40 ms, status waiting-provider và nextEligibleAt sau 600 giây: request thất bại khoảng 70 ms với `Đã hủy tác vụ.`.

Sửa: tách thời gian queue/cooldown khỏi deadline generation; các status request vẫn có timeout HTTP riêng và toàn bộ chờ vẫn hủy được. Test phải đi qua adapter, không chỉ helper tính thời gian.

### R09 — [P1] ACK và xóa lease trước khi checkpoint có thể dùng để resume

Vị trí: [ACK trong runStage](F:/Son/tool/TediaPros/src/main/geminiGateway.ts:901), [xóa lease](F:/Son/tool/TediaPros/src/main/geminiGateway.ts:695), [draft checkpoint lưu sau đó](F:/Son/tool/TediaPros/src/main/geminiGateway.ts:1052).

runStage ghi audit rồi ACK/xóa operation lease trước khi caller kiểm tra cue contract và ghi draft checkpoint. Crash trong khoảng này làm mất identity dùng nối lại; lần resume không có draft hợp lệ sẽ tạo request mới dù generation trước đã hoàn tất. Audit không phải checkpoint mà reader resume hiện sử dụng. `writeGatewayDraft` còn nuốt lỗi và tiếp tục.

**TEST_CONFIRMED:** tại lúc mock nhận `/ack`, draft directory chỉ có `restore-translate-operation.json`; sau adapter trả về mới xuất hiện `gemini-gateway-draft.json`.

Sửa: validate và commit checkpoint durable trước ACK; lỗi checkpoint không được ACK/xóa lease. Thêm fault injection tại ranh giới response → checkpoint → ACK cho cả draft và review.

### R10 — [P1] Cancel không bảo đảm dừng operation phía gateway

Vị trí client: [requestGatewayOperation](F:/Son/tool/TediaPros/src/main/geminiGateway.ts:687), [cancel helper](F:/Son/tool/TediaPros/src/main/geminiGatewayOperations.ts:138). Vị trí server: [cancel queued](F:/Son/tool/CreateMediaTool/internal/modules/openai/gateway_scheduler_controller.go:265), [executeOperation](F:/Son/tool/CreateMediaTool/internal/modules/openai/gateway_scheduler_controller.go:327).

Client chỉ abort polling; cancel helper không có caller production. Worker server dùng context Background nên vẫn tiếp tục. Ngoài ra cancel queued chỉ đổi record, còn executor không kiểm tra trạng thái terminal trước khi ghi running/dispatched: goroutine đã được tạo có thể chạy sau khi cancel và ghi đè cancelled.

**TEST_CONFIRMED:** explicit client abort tạo 0 POST `/cancel`; executor chạy trên record đã cancelled vẫn ghi `dispatched`, tăng attempts lên 1 và chuyển failed.

Sửa: nối hủy user/shutdown tới API cancel với timeout riêng; chuyển trạng thái queued→dispatch phải atomic và kiểm tra cancellation. Kiểm tra cả trước acquire, trong queue và sau dispatch; không nhầm timeout status HTTP với ý định user hủy.

### R11 — [P1] P5 chưa được nối vào luồng video và chưa gửi audio

Vị trí: [sourceRestoration payload](F:/Son/tool/TediaPros/src/main/translation/sourceRestoration.ts:246), [production translateStrict](F:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts:1262).

Tìm trong `src` không có caller/import của module sourceRestoration từ production; chỉ test import nó. Payload helper tạo JSON text với cues/evidenceItems; không có trích xuất/đính kèm audio bytes, `audioMeta` cũng không được đưa vào payload này. Production vẫn đi từ rawSrtPath vào translateStrict. Hai lượt text draft/review hiện hữu không phải pipeline audio/OCR P5.

**CODE_CONFIRMED:** P5 hiện là helper độc lập; không thể kết luận video thật đã tự sửa ASR nhờ audio/OCR.

Sửa: hoàn tất tích hợp evidence pack, media extraction/attachment, draft/review/checkpoint và đường vào subtitle/TTS; kiểm tra request thật chứa audio, cue IDs/timestamps giữ nguyên và resume sử dụng cùng evidence digest.

### R12 — [P2] Draft validator chấp nhận trùng ID và source edit không có evidence

Vị trí: [items validation](F:/Son/tool/TediaPros/src/main/translation/sourceRestoration.ts:303), [evidence refs](F:/Son/tool/TediaPros/src/main/translation/sourceRestoration.ts:325), [missing translation fallback](F:/Son/tool/TediaPros/src/main/translation/sourceRestoration.ts:548).

Kiểm tra count + ID thuộc tập nguồn không bảo đảm ánh xạ 1:1. Output `c1,c1` cho nguồn `c1,c2` vẫn hợp lệ, c2 âm thầm trở về ngôn ngữ nguồn. Evidence reference không tồn tại bị lọc bỏ nhưng source edit vẫn giữ và được áp dụng.

**TEST_CONFIRMED bằng probe trong bộ nhớ:** duplicate ID được nhận; `evidenceRefs=['missing-proof']` thành `[]` nhưng vẫn thay nguồn thành text bịa. Đây là lỗi cần sửa trước khi tích hợp helper P5, chưa phải đường production đang chạy.

Sửa: tập ID chính xác, duy nhất, text hợp lệ; từ chối source edit thiếu evidence phù hợp, không tự làm sạch thành một edit không còn căn cứ.

### R13 — [P2] Review rỗng được tự động approved

Vị trí: [review parameters](F:/Son/tool/TediaPros/src/main/translation/sourceRestoration.ts:373), [default approval](F:/Son/tool/TediaPros/src/main/translation/sourceRestoration.ts:443).

expectedDigestOrDraft và expectedIdsOrPack không được sử dụng. `{}` được nhận thành approved/confidence=1, candidateDigest rỗng và reviewedCueIds rỗng. Response không đánh giá candidate hoặc thiếu toàn bộ cue vẫn có thể qua gate.

**TEST_CONFIRMED bằng probe trong bộ nhớ.** Sửa: schema bắt buộc, exact digest/ID coverage, không mặc định phê duyệt, xử lý findings chưa giải quyết trước publication.

### R14 — [P2] Rollback group không loại bản dịch bị bác bỏ; patch không atomic

Vị trí: [rejected groups](F:/Son/tool/TediaPros/src/main/translation/sourceRestoration.ts:493), [replacements](F:/Son/tool/TediaPros/src/main/translation/sourceRestoration.ts:523).

Rejected group chỉ chặn source edits; translationMap vẫn chứa bản dịch bị bác bỏ. Replacement có cả ID hợp lệ và ID lạ vẫn áp dụng riêng phần hợp lệ, không rollback cả nhóm.

**TEST_CONFIRMED bằng probe trong bộ nhớ:** source về gốc nhưng target vẫn `bad translation`; replacement `c1 + unknown` vẫn sửa c1. Sửa: validate toàn bộ group trước mutation; kết quả bị bác bỏ không được xuất sang TTS/subtitle như một bản dịch đạt chất lượng.

### R15 — [P2] Chỉ số chất lượng và test batch đang được diễn giải vượt bằng chứng

Vị trí: [metrics](F:/Son/tool/TediaPros/src/main/translation/sourceRestoration.ts:553), [Volvo fixture](F:/Son/tool/TediaPros/tests/autoshort-source-restoration.test.ts:254), [100-job test](F:/Son/tool/TediaPros/tests/gateway-batch-recovery.test.ts:68).

applyRestorationPipeline hardcode corruptedCleanCues=0 và accuracyRate=1, đếm appliedEdits như số lỗi sửa đúng. Test Volvo sinh 44 câu synthetic rồi tự điền ba đáp án sửa, không chạy audio/OCR/model. Test 100 jobs đếm callback mock, ép concurrency=1, tự nhảy clock 601 giây rồi gọi pass hai; không chạy Go governor/store/adapter hoặc tự wake production. Test còn dùng pauseOnDeferred=true trong khi production bỏ trống.

Vì vậy các test pass chỉ chứng minh helper/fixture ở phạm vi đó; không chứng minh sửa ASR 100%, không gửi trùng, không generation trong cooldown hoặc tự phục hồi batch ngoài thực tế.

Sửa: sửa nhãn evidence trong handoff; đo quality từ corpus + ground truth độc lập và artifact pipeline; đo scheduling từ transport events qua production wiring. Không gắn LIVE_CONFIRMED cho mock/typecheck.

## 4. Quyết định review

Ưu tiên R01–R10 trước khi chạy batch dài. Hoàn tất R11 và các gate R12–R15 trước khi báo P5 hoàn thành. Việc chỉ chỉnh test để pass hoặc chỉ tăng timeout/retry không giải quyết các nguyên nhân trên.

Giữ nguyên các ràng buộc đã duyệt: alias gemini-advanced, require_verified_model=false, complete response, tempo 1.80x và chính sách translation budget hiện tại. Không thêm request thăm dò hay paid API vào phạm vi sửa.

## 5. Tệp được tạo trong lượt review

- Chính bản ghi này; không sửa implementation.
- [Provider regression probes](F:/Son/tool/TediaPros/.ai/tasks/2026-09-17-codex-gateway-review/review_providers_test.go).
- [Operation regression probes](F:/Son/tool/TediaPros/.ai/tasks/2026-09-17-codex-gateway-review/review_openai_test.go).
- [Runner Go overlay](F:/Son/tool/TediaPros/.ai/tasks/2026-09-17-codex-gateway-review/run-go-probes.ps1).

## 6. Kiểm chứng

Các kiểm tra hiện hữu chạy lại trong review:

```powershell
# F:\Son\tool\TediaPros
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs gemini-gateway-operations.test autoshort-provider-wait.test autoshort-batch-resume.test autoshort-batch-store.test autoshort-queue-throughput.test gemini-gateway-draft-resume.test gemini-gateway-contract.test
node scripts/run-local-runtime-tests.mjs autoshort-source-restoration.test gateway-batch-recovery.test

# F:\Son\tool\CreateMediaTool
go test ./internal/modules/openai/... ./internal/modules/providers/... -count=1
```

Kết quả: typecheck Node/Web pass; 59 test TypeScript thuộc 9 suite pass; 3 Go package pass. Không chạy lại full build/full suite và không xác nhận installed artifact trong lượt này.

Probe bổ sung dùng Go overlay, không chèn test vào source gateway, không gửi HTTP thật. Sáu regression expectations đều FAIL đúng tại lỗi đang review:

```text
TestReviewProductionFxInjectsGovernor: client=nil, pool=nil
TestReviewOwnerLockFailsClosed: second instance admitted despite held lock
TestReviewParseFailureDoesNotLeakPermit: calls=1, state=running, active=1
TestReviewUnknownTransportDoesNotReplay: calls=2, state=spacing
TestReviewRestartQueuedStoreDoesNotDeadlock: constructor blocked
TestReviewCancelledQueuedOperationCannotRestart: dispatched, attempts=1
```

Tái chạy bằng runner `.ps1` ở mục 5 với PowerShell. Exit code 1 là kết quả kỳ vọng trên implementation đang review; sau sửa đúng các expectation cần pass. Test này chỉ dựng Fx, dùng temp store và fake RoundTripper; không chạy service hay dùng cookie thật.

Probe client dùng esbuild bundle mã thật trong bộ nhớ, mock fetch và temp draft directory. Kết quả:

```text
QUEUE_REAL_DEFAULTS admitted=[v1,v2,v3]; statuses=[waiting_provider,waiting_provider,waiting_provider]
COOLDOWN_TIMEOUT stageTimeoutMs=40; nextEligible=+600s; elapsedMs~70; error="Đã hủy tác vụ."
EXPLICIT_ABORT cancelPosts=0
ACK_ORDER filesAtAck=[restore-translate-operation.json]; filesAfterReturn=[gemini-gateway-draft.json]
```

Các probe P5 là kiểm tra helper offline, không phải chất lượng mô hình. Không tạo kết luận mới về ngưỡng giới hạn/chặn IP thực tế của Google.

## 7. Bàn giao sửa và nghiệm thu lại

Sau sửa cần chạy một đường tích hợp dùng production Fx/client/adapter/queue với fake upstream và clock điều khiển được: nhận 429 Retry-After 600s, không dispatch trong cooldown, tự tiếp tục đúng item, cancel không wake lại, mất response không gửi generation trùng. Fault injection phải bao gồm crash trước/sau dispatch, trước/sau checkpoint/ACK và restart khi còn queued operation.

Sau khi các gate offline đạt, chạy canary nhỏ đã giới hạn để kiểm chứng request media và pipeline thật. Giữ riêng CODE_CONFIRMED, TEST_CONFIRMED và LIVE_CONFIRMED; chưa dùng bằng chứng helper để đánh dấu các gate tích hợp đã hoàn tất.
