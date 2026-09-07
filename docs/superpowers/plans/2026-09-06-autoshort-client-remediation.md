# AutoShort Client Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Thực hiện trong phiên hiện tại; không tự tạo task/agent khác. Yêu cầu hiện tại chỉ là viết planning, chưa thực thi sửa code.

**Goal:** Sửa 7 lỗi trong review Gemini, đưa AutoShort về trạng thái an toàn, kiểm chứng tối ưu cục bộ rồi mới cho phép hàng đợi hai video.

**Architecture:** Một runner queue dùng chung cho production và test, một scheduler dùng chung toàn ứng dụng, mỗi item sở hữu scope hủy/join riêng. OCR có buffer giới hạn, watchdog và capability theo binary; telemetry được lọc trước mọi đường lưu. Giữ backend hiện tại và giới hạn một yêu cầu inference tại một thời điểm.

**Tech Stack:** Electron/TypeScript, Node child processes, Python/RapidOCR/NumPy, FFmpeg, PyInstaller; sử dụng runtime và test harness hiện có.

**Spec:** [Throughput design](../specs/2026-09-06-autoshort-throughput-design.md), [review bắt buộc sửa](../../benchmarks/2026-09-06-gemini-throughput-review.md), [audit gốc](../../benchmarks/2026-09-06-autoshort-throughput-audit.md).

**Trạng thái:** Planning, chưa sửa production. Kế hoạch này thay thứ tự triển khai trong plan throughput cũ cho phần khắc phục client; không xác nhận toàn bộ T0–T11 đã xong. T8 đầy đủ được tách khỏi bản sửa đầu tiên, không được ghi là đã triển khai.

## Global Constraints

- Chỉ sửa `F:/Son/tool/TediaPros` và đóng gói OCR runtime chạy trên client. Không sửa/cài/restart backend, không thay model/voice/options phía server, không tạo endpoint hoặc clone session mới.
- Tests tự động dùng adapter giả hoặc audio/translation fixtures đã lưu; không gửi request thật tới server LAN. Các lượt benchmark dùng backend hiện tại chỉ thực hiện trong phạm vi chạy thực tế đã thống nhất, không tự tạo tải thử.
- `server-inference = 1` toàn ứng dụng cho dịch/TTS/local title; cache hit không chiếm slot mạng. Không giữ slot server khi trim/tempo/audio DSP.
- `local-gpu-heavy = 1`; OCR DML, STTN CUDA, Whisper CUDA, separation GPU và NVENC dùng chung lane ban đầu; preview cũng phải tuân theo.
- Giữ STTN 1.1.0 đã kiểm chứng, OCR 8 FPS, độ phân giải/canonical geometry, giọng, nhạc và nội dung. Không nới tempo hoặc cắt lời để đạt KPI. Giữ bản sửa single-pass PCM/tempo metrics trước review làm baseline.
- Queue mặc định một item; overlap và prefetch có thể tắt độc lập. Hai item chỉ là opt-in sau gate cuối, không tự bật qua nâng cấp app.
- Không reset/stash/clean working tree, không xóa output cũ, source hay checkpoint chỉ để tạo baseline lạnh. Trước sửa lưu diff và danh sách untracked vào evidence riêng, không gom tất cả thay đổi vào commit.
- Không commit/push hoặc thay runtime đang dùng chỉ vì bước đó có trong tài liệu. Trong phiên triển khai sau này, install runtime mới phải nằm trong phạm vi người dùng giao; giữ archive cũ để rollback, không sửa receipt bằng tay.
- Không hứa phút/video hoặc “nhanh hơn 2×” từ mock tests. Tách source tests, media fixtures, installed runtime và live full queue.

## Mốc bàn giao và dependency

| Mốc | Tasks | Điều kiện bàn giao |
|---|---|---|
| A — an toàn khi lỗi/hủy | C0 → C1 → C2 → C3 | Một item mặc định, mọi nhánh/request/process dừng và join trước cleanup |
| B — OCR và diagnostics đúng | C4, C5, C6 → C7 | RAM/no-progress có giới hạn, log sạch, binary mới được nhận diện; ROI chưa tự bật |
| C — giới hạn tải/retry/cache | C8 → C9 | Retry có ngân sách, cache không bị đọc lúc ghi dở, disk được hạch toán |
| D — mở throughput có kiểm chứng | C10 | Integration thật đạt rồi mới opt-in overlap/prefetch/two-item |

C4–C6 có thể review độc lập, nhưng không cần chạy nhiều agent. Không dùng test xanh của một mốc để bỏ gate mốc sau.

## Bản đồ file

| File | Trách nhiệm |
|---|---|
| `src/main/autoShortQueueRunner.ts` (mới) | Queue runner production có injection, giữ thứ tự và không admit sau cancel |
| `src/main/autoShortExecutionPolicy.ts` (mới) | Policy immutable và conservative defaults; resolve theo capability/qualification |
| `src/main/autoShortItemScope.ts` (mới) | Sở hữu controller, promise outcome và drain cho một item |
| `src/main/autoShortResourceManager.ts` | Atomic leases/FIFO, shared singleton; không chứa business stages |
| `src/main/autoShortItemCoordinator.ts`, `autoshort.ts` | Nối scope/scheduler/queue vào luồng thật |
| `src/main/dubbing/synthesis.ts`, `tts.ts`, `dubbing/cache.ts` | Prefetch bounded, lifecycle audio và cache nguyên tử |
| `src/main/autoShortTelemetry.ts` | Sanitize, quota chung job, bounded event buffer, terminal summary |
| `src/main/autoShortDiskBudget.ts` (mới) | Reservation còn phải ghi, working bytes thực tế và volume headroom |
| `engines/ocr-engine/engine.py`, `visual_timeline.py` | Stream reader, stable selection, crop, timing/capabilities |
| `src/main/ocr.ts`, `runtimeProbes.ts`, `runtimeInstaller.ts`, `runtimeManifest.ts` | Negotiate và cài/kiểm tra runtime cục bộ |

Tên file mới là thiết kế của kế hoạch này, không phải tuyên bố file đã tồn tại. Dùng absolute path khi gửi kết quả cho người dùng; path dưới đây tương đối so với repository root.

## C0 — Khóa mặc định an toàn và dùng runner thật trong tests

**Files:** thêm `autoShortQueueRunner.ts`, `autoShortExecutionPolicy.ts`; sửa `autoshort.ts`, `tests/autoshort-queue-throughput.test.ts`, `scripts/run-local-runtime-tests.mjs`.

**Interfaces:**

```ts
export interface AutoShortExecutionPolicy {
  maxActiveItems: 1 | 2
  overlapIndependentStages: boolean
  prefetchTts: boolean
  ocrTransport: 'legacy-disk' | 'stream-full' | 'stream-roi'
}
export const CONSERVATIVE_POLICY: Readonly<AutoShortExecutionPolicy> = Object.freeze({
  maxActiveItems: 1, overlapIndependentStages: false,
  prefetchTts: false, ocrTransport: 'legacy-disk'
})
export async function runAutoShortQueue(input: {
  items: readonly AutoShortQueueItemInput[]
  signal: AbortSignal
  maxActiveItems: 1 | 2
  processItem(item: AutoShortQueueItemInput, index: number): Promise<AutoShortItemResult>
  onTerminal(result: AutoShortItemResult, index: number): void
}): Promise<AutoShortItemResult[]>
```

- [ ] Lưu `git diff --binary`, `git status --short`, hash các file review và phiên bản tools vào thư mục evidence mới. Giữ nguyên untracked của người dùng.
- [ ] Thay test tự viết lại worker pool bằng import `runAutoShortQueue`. Fixture ba item dùng deferred gates, asserts ban đầu `started=[0]`; sau release item 0 mới có item 1. Test cancel-all không admit item chưa chạy, một item error không làm mất kết quả trước đó.
- [ ] Chạy `npm.cmd run test:local-runtime -- autoshort-queue-throughput.test`, xác nhận fail vì module mới chưa có.
- [ ] Di chuyển worker loop hiện có vào runner có injection; `executeJob` gọi đúng runner đó sau preflight, truyền policy snapshot. Trong catch giữ error theo index; đánh dấu những item chưa chạy cancelled chỉ khi cancel thực sự xảy ra.
- [ ] Nối policy vào coordinator/synthesis; khi overlap=false không khởi động `runVisualBranch` sớm, khi prefetch=false không tạo promise trước cue kế tiếp. Qualification thiếu hoặc không hợp lệ luôn về conservative, không chấp nhận giá trị client renderer không được validate.
- [ ] Chạy lại tests queue và main-path existing tests. Gate: test sử dụng production runner, mặc định một item; chưa bật hai item dù test tham số 2 đạt.

## C1 — Item scope: fatal → abort sibling → drain → cleanup

**Files:** thêm `autoShortItemScope.ts`, `tests/autoshort-item-scope.test.ts`; sửa coordinator, `processTree.ts`, adapter audio trong `autoshort.ts`, tests OCR/STTN pipeline.

**Interfaces:**

```ts
export type BranchOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown }
export interface AutoShortItemScope {
  readonly signal: AbortSignal
  start<T>(action: (signal: AbortSignal) => Promise<T>): Promise<BranchOutcome<T>>
  abort(reason: unknown): void
  drain(): Promise<void>
  dispose(): void
}
export function createAutoShortItemScope(parent: AbortSignal): AutoShortItemScope
```

- [ ] Chuyển reproduction trong `release-artifacts/gemini-review/reproduce.mjs` thành test coordinator thật. ASR lỗi khi OCR gate còn mở: assert signal OCR aborted, processor chưa settle trước OCR close, workDir còn tồn tại trước close; sau close mới cleanup. Đảo chiều OCR lỗi khi ASR/TTS đang chờ và kiểm tra original failure được giữ.
- [ ] Test thêm `process.on('unhandledRejection')` có cleanup listener, assert không có sự kiện; hai item dùng scope riêng, lỗi item A không abort B; cancel-all abort cả hai.
- [ ] Run targeted suite và xác nhận RED trên code Gemini.
- [ ] `start()` gắn handler lỗi ngay khi tạo promise; promise trả về luôn là `BranchOutcome`, handler ghi first failure và abort scope. `drain()` chờ toàn bộ promises đã đăng ký; đóng admission trước drain để không sinh nhánh mới trong lúc cleanup.
- [ ] Coordinator dùng `scope.signal` cho mọi adapter, unwrap outcome ở dependency/join cần thiết; trong outer finally: abort công việc còn lại → await drain → finalize telemetry → xóa owned partials → dispose listener. Phân biệt item failure với người dùng cancel qua parent signal/first failure; không đổi ASR error thành cancelled chỉ vì scope tự abort sibling.
- [ ] Sửa những audio child wrappers hiện reject ngay trong abort handler: handler chỉ lưu pending abort error và terminate tree; promise settle từ `close` hoặc spawn `error`. Mọi spawn phải `windowsHide: true`, track bằng `trackChildProcess`; không gọi global terminate-all cho lỗi một item.
- [ ] Gate: không publish/cleanup/release tài nguyên khi còn child/request thuộc item. Test fallback `taskkill` thất bại vẫn terminate child và chờ settle.

## C2 — TTS prefetch có ownership và lỗi rõ ràng

**Files:** `dubbing/synthesis.ts`, `autoshort.ts`, `tests/autoshort-tts-pipeline.test.ts`, `tests/dubbing-plan.test.ts`.

**Consumes:** C1 scope, C0 `prefetchTts`. **Produces:** `DubbingSynthesisInput.prefetchTts?: boolean`, mặc định false.

- [ ] Viết regression DSP fail với next TTS deferred: expected synthesizeDubbingPlan chưa reject trước next request settled; next signal aborted; số calls cue kế tiếp bằng 1. Test prefetch HTTP403 truyền nguyên lỗi, không tự retry thành lần gọi thứ hai.
- [ ] Chạy targeted suite, ghi RED cho `.catch(() => null as any)` và orphan request.
- [ ] Dùng scope con cho synthesis; chỉ giữ một `Promise<BranchOutcome<PreparedCue>>` và cue fingerprint. Bỏ catch-to-null. Lỗi phải unwrap và đi qua policy retry/corrupt-cache rõ ràng; final text fingerprint đổi thì bỏ kết quả một cách có kiểm soát sau drain.
- [ ] Giữ bootstrap tối đa 3 audio thật và update predictor theo thứ tự baseline. Chỉ prefetch sau quyết định rephrase hiện tại, không gọi request replacement trong lúc request kế tiếp còn giữ server lane.
- [ ] Test output plan/clip order/text/timing giống mode prefetch=false với fake deterministic audio; cache corrupt chỉ bypass một lần; cancel trong bootstrap, trim, tempo và correction không mở request mới.
- [ ] Gate: một request server tối đa, một pending cue tối đa; all paths chờ drain. C3 sẽ áp lane DSP, không cho prefetch trim cạnh applyTempo vượt budget.

## C3 — Nối scheduler vào stages, transport và preview thật

**Files:** resource manager, coordinator, `autoshort.ts`, `localTranslate.ts`, `tts.ts`, `burn.ts`, `ocr.ts`, `whisper.ts`, separation runner, STTN preview; tests manager/queue/pipeline.

**Interface:** giữ `withLease(resources, signal, action)` hiện có. Quy ước mỗi tài nguyên chỉ được acquire ở một tầng; không giữ cùng resource rồi gọi helper acquire lại.

| Operation | Nơi claim | Resource |
|---|---|---|
| OCR unknown/DML | visual/legacy OCR invocation wrapper | GPU + CPU heavy conservative |
| OCR CPU đã xác minh | cùng wrapper | CPU heavy |
| Whisper CPU / CUDA | ASR invocation wrapper | CPU / GPU + CPU heavy |
| STTN/separation | invocation wrapper, sau dependency | GPU + CPU heavy conservative |
| Render NVENC / software | render invocation wrapper | GPU + CPU / CPU heavy |
| Trim/tempo/stitch/mix | audio adapter boundary | audio DSP; không acquire lần hai trong child helper |
| Local translation/clone/speech/local title | một HTTP attempt, kể cả nhận body | server-inference |
| External title | transport provider | external-title |
| Preview | cùng wrappers với queue | tương ứng engine đang chạy |

- [ ] Test hai production item processors với gate đếm OCR/STTN/server/DSP, đồng thời khởi động preview; assert peak mỗi lane ≤1. Test GPU lease được trả trước khi chờ mạng; leaf acquire không tự deadlock.
- [ ] Test atomic multi-claim, cancelled waiter, capacity invalid/NaN, double release, FIFO starvation. Dùng strict FIFO conservative cho hàng đợi tranh tài nguyên; khi hủy head gọi drain ngay.
- [ ] Gọi singleton scheduler xuyên job/preview; tests inject manager riêng. Không tạo manager mỗi item. Claim local heavy trước probe/load model nếu probe có allocate GPU, không chỉ trước inference.
- [ ] Mỗi HTTP attempt giữ lease qua `response.json/arrayBuffer/body stream` và validation transport, rồi release; backoff bên ngoài lease. Cache lookup/hit bên ngoài server lease. Dịch/TTS/local title dùng cùng lane dù endpoint khác; không thay request body/backend API.
- [ ] Lease release chỉ sau C1/C2 lifecycle settled. Khi effective provider chưa rõ, giữ conservative; chỉ nới CPU/GPU overlap sau số đo. Giữ tối thiểu 2 logical CPU cho UI/OS khi các engines hỗ trợ giới hạn thread; nếu không chứng minh tổng budget, serialize các local heavy stages.
- [ ] Gate: search call graph chứng minh mọi launch path có claim; production integration đạt, queue default vẫn 1. Không chỉ test class manager.

## C4 — OCR Fast stable selection không giữ ảnh cả đoạn

**Files:** `engines/ocr-engine/visual_timeline.py`, `tests/test_visual_timeline.py`.

**Contract:** giữ lựa chọn `khung_on_dinh(rung,a,b)` của legacy, không tự thay frame đại diện hoặc ngưỡng Jaccard. Chỉ giữ previous crop, best crop và current frame; crop giữ lâu phải `.copy()` để không giữ full-frame backing buffer.

- [ ] Biến `reproduce-ocr-memory.py` thành regression weakref: static 80/800/8.000 sample, peak retained frame/crop buffers không vượt 4; dữ liệu test nhỏ để không tự gây OOM.
- [ ] Đối chiếu selected indices với `khung_on_dinh` cho các chuỗi change scores: all-zero, ties, một frame, hai frame, alternating, scene cut ở đầu/cuối, EOF. Assert exact equality chứ không chỉ số segments.
- [ ] Implement online scorer: khi có `d[i]`, hoàn tất score frame `i-1 = d[i-1]+d[i]`; update best chỉ khi `<` để giữ tie-break frame sớm. Nếu boundary ở i, finalize đoạn cũ sau khi tính score i-1, rồi reset best và bắt đầu đoạn mới tại i. EOF chấm frame cuối bằng `d[last]` vì không có next score, đúng legacy.

```python
score_previous = previous_change + current_change
if score_previous < best_score:
    best_score = score_previous
    best_index = previous_index
    best_crop = previous_crop  # already an owned cropped copy
```

- [ ] Không lưu `interval_crops` hay mảng full `rung` theo duration. Scalar segment output vẫn có thể tăng theo số đoạn; áp giới hạn JSON/timeline hiện có độc lập với frame buffers.
- [ ] Chạy `python -m unittest discover -s engines/ocr-engine/tests -p test_visual_timeline.py -v`. Gate: exact representative indices và bounded buffers, không chỉ hết RAM sau return.

## C5 — Pipe watchdog, EOF và thời gian OCR chính xác

**Files:** `engine.py`; thêm `engines/ocr-engine/tests/test_stream_reader.py`; sửa `ocr.ts`, `tests/autoshort-ocr-runtime.test.ts`.

**Interface:** `stream_video_frames(..., no_progress_timeout_seconds=120.0)`; reader tự sở hữu Popen, reader thread, stderr thread và stop event. Thời gian test inject 0.2 s, không bắt test chờ 120 s.

- [ ] Fake producer scenarios: còn sống/không byte, trả nửa frame rồi đứng, EOF giữa frame, exit nonzero, stderr flood, consumer OCR giữ một frame lâu. Assert timeout đúng read-wait, không timeout giả khi consumer đang inference.
- [ ] Dùng queue tối đa 2 frame giữa reader và OCR consumer; consumer đang đợi frame mới dùng timeout. Timeout/cancel đóng producer bằng process-tree helper tương ứng Windows; chờ reap, đóng pipes và join threads. Không kích watchdog chỉ vì queue đầy/backpressure chủ động.
- [ ] Stderr ring ≤80 KiB; lỗi gốc timeout/partial frame không bị exception trong finally ghi đè. Parent có watchdog phase-aware riêng: model load 180 s, OCR inference/no progress 120 s, mặc định conservative và test có thể override; không áp timeout read cho thời gian chờ resource lease.
- [ ] Ghi `frameCount` từ số frame thực đã đọc, metadata dự đoán chỉ dùng progress. Giữ k/8 timestamps, clip duration, loại sample không có khoảng thời gian dương; test duration fractional, rotation/SAR/VFR và frame cuối.
- [ ] Gate: producer treo tự kết thúc, không orphan; cancellation giữa inference vẫn tới helper process tree. Tests dùng mock producer không được coi là GPU runtime acceptance.

## C6 — Telemetry sanitize từ biên ghi và quota chung job

**Files:** telemetry, coordinator, `autoshort.ts`, shared types, renderer progress; tests telemetry.

**Interfaces:** thêm `AutoShortTelemetryJobBudget` dùng chung collectors của job, `sanitizeTelemetryEvent(event)` trả một bản sao sạch; `finalize` idempotent sau khi item scope drain.

- [ ] Dùng fixture giả R5 qua `withStageSpan`: inspect `getEvents`, events.jsonl và summary.json, assert không còn private path, URL credentials/query tokens, Authorization-like text. Test slash/backslash, UNC, macOS paths và nested errors. Không dùng key thật.
- [ ] Chỉ whitelist structured fields. Error/fallbackReason lưu code công khai và thông điệp đã lọc/bounded, không serialize stack/response body/prompt tùy ý. `sanitizeEndpointAlias` phải xử lý IPv6 loopback và bỏ userinfo/query. Sanitize trước `events.push`, không sửa bản gốc phía caller.
- [ ] Budget 20 MiB/job cho diagnostics telemetry, không tính subtitle audit riêng. Dành 1 MiB cho summaries/terminal records; nonterminal chỉ dùng phần còn lại, coalesce progress ≤1Hz/item. Ring in-memory tối đa 1.000 events. Terminal records lưu qua reserved budget hoặc compaction nguyên tử, không silently drop; test nhiều collectors cùng quota.
- [ ] I/O fail không phá MP4 đã publish nhưng trả `diagnosticsIncomplete=true` tới summary/UI; test disk write rejection. Crash recovery không được báo span running thành succeeded.
- [ ] Nối resourceWait từ C3, cache hits, attempt/token counts từ C8, effective OCR provider của det/cls/rec từ runtime; không dùng requested provider giả làm actual. Unknown ghi null.
- [ ] UI hiển thị stage/wait/elapsed và số item xong; progress monotonic không che failed/cancelled. ETA khi chưa có corpus ghi “chưa đủ dữ liệu”; chưa triển khai p50–p90 thì không hiện số giả.
- [ ] Gate: reproduction R5 không leak; terminal preserved khi vượt quota; sanitizer helper tests riêng chưa đủ.

## C7 — Capability, package và installed runtime OCR

**Files:** `engine.py`, `ocr-engine.spec`, tests CLI, `ocr.ts`, runtime probes/manifest, `scripts/ocr-blur-acceptance-main.ts`, release tooling tests.

**Contract mới:** OCR candidate version `1.2.0` nếu version này chưa được dùng lúc bắt đầu triển khai; advertise `visual-stream-full-v1` và `visual-stream-roi-v1`. Protocol `ocr-local/1` giữ backward compatibility. Thêm `--visual-transport legacy-disk|stream-full|stream-roi`; giữ alias `--legacy-disk-extract` cho rollback, reject tổ hợp mâu thuẫn.

- [ ] Test negotiation: binary cũ không nhận flag mới và vẫn chạy legacy; binary mới mặc định `stream-full` khi được qualified, ROI chỉ opt-in; thiếu feature từ chối hoặc fallback legacy có log rõ theo policy, không đổi profile accurate thành fast.
- [ ] Stream-full dùng cùng pixels/geometry/FPS và full-frame OCR như baseline; stream-roi giữ halo 32px, translate coordinates trước clip ROI. Báo provider thực det/cls/rec từ session, không lấy startup probe thay thế.
- [ ] Lưu implementation fingerprint vào artifacts và OCR evidence để không reuse lẫn source/runtime cũ mới. STTN version/model không đổi.
- [ ] Build bằng môi trường OCR pinned đã xác minh, không cài nâng version thư viện chỉ để build xanh:

```powershell
python -m unittest discover -s engines/ocr-engine/tests -p "test_*.py" -v
python -m PyInstaller --noconfirm --distpath release-artifacts/ocr-client-remediation/dist --workpath release-artifacts/ocr-client-remediation/build engines/ocr-engine/ocr-engine.spec
```

- [ ] Verify `--version`, `--probe`, feature flags từ binary trong dist; đóng archive theo schema runtime manifest hiện có, tính bytes/SHA256, chạy verifier rồi cài qua `downloadRuntimeEngineFromManifest` với manifest artifact cục bộ. Không ghi đè trực tiếp `bin` hoặc receipt; giữ archive/receipt trước update để rollback qua installer.
- [ ] Quality corpus: chữ sát ROI, chữ nhỏ, flash, multiline/vertical, scene cut, rotation/SAR/VFR. Full-frame stream phải tương đương legacy; ROI recall giảm ≤0,5 điểm phần trăm, false-positive area tăng ≤0,5 điểm, không mất cả cue, boundary lệch ≤125ms, không mask ngoài ROI; review 30 đoạn STTN về residue/flicker.
- [ ] Gate: test trên canonical installed executable và main-path OCR→STTN→render/cancel thật. ROI không đạt thì giữ stream-full; không dùng claim 2× trong walkthrough thay benchmark.

## C8 — Retry có budget và TTS cache nguyên tử

**Files:** localTranslate/policy, dubbing cache, autoshort, tts; tests local translation/dubbing cache.

**Translation contract:** deadline monotonic 10 phút/item theo spec. Mặc định không áp request-count ceiling; `maxRequests` chỉ là tùy chọn opt-in cho môi trường muốn tự đặt quota. Mọi transport attempt, schema repair và semantic split vẫn chịu deadline chung; response hợp lệ một phần chỉ gọi lại cue còn thiếu.

- [ ] Test server mock luôn thiếu ID/429/timeout: tổng requests không vượt budget. Dùng clock/sleep injection, HTTP-date và số giây Retry-After; nếu delay vượt remaining deadline thì fail rõ, không gửi trước thời điểm server yêu cầu. Giữ exact ID set, truncation rejection và batching hiện tại.
- [ ] Đặt budget object ở localTranslateSrt, truyền cùng object xuống recursive batches và transport; timeout attempt = min(60s, remaining). Backoff nhả server lease. Lưu mỗi batch valid theo input/prompt/model/policy fingerprint; không promote partial response.
- [ ] TTS cache test hai callers cùng key: chỉ một request, không ai đọc WAV partial; đổi reference bytes cùng path/mtime gây miss; corrupt audio bypass tối đa một lần, cancel waiter không hủy producer đang phục vụ waiter khác.
- [ ] Đọc/hash reference một lần theo immutable job snapshot; cache key thêm content hash và model revision khi capability thực có. Revision unknown thì ghi rõ scope, không giả revision. Ghi private temp → validate audio → rename complete; single-flight cùng key trong app, lease ngăn eviction khi đang đọc. Preserve v2 entries; không reuse key cũ nếu không chứng minh tương đương.
- [ ] Gate: deterministic cache fixtures giữ text/timing, client concurrency≤1; không yêu cầu backend hỗ trợ thêm gì.

## C9 — Disk ledger và điều kiện admit hai item

**Files:** thêm `autoShortDiskBudget.ts`, `tests/autoshort-disk-budget.test.ts`; sửa queue/coordinator/STTN admission, execution policy.

**Interfaces:**

```ts
export interface DiskReservation {
  update(remainingBytesToWrite: number): void
  release(): void
}
export interface AutoShortDiskBudget {
  reserve(volume: string, remainingBytesToWrite: number,
    signal: AbortSignal): Promise<DiskReservation>
}
```

- [ ] Fake free-space test hai jobs đồng thời, bytes đã ghi, cancel đang chờ, input/output khác volume, ENOSPC giữa stream. Không double-count file hiện hữu vừa nằm trong free-space vừa cộng vào reservation.
- [ ] Ledger chỉ giữ future bytes chưa ghi; admission yêu cầu `freeBytes - sum(otherRemainingReservations) >= newRemaining + safetyHeadroom`. Cập nhật reservation theo bytes thực/ước lượng còn lại, poll free space tại stage boundary/window. Reserve cho clean video và final output trên đúng volume; audio/temp/cache volume khác có budget riêng.
- [ ] STTN 0,685 GiB rolling reserve của fixture cũ chỉ là headroom, không phải tổng video. Estimate clean size từ rate đo trên mẫu tương ứng có safety factor; thiếu estimate đáng tin cậy thì không qualify hai item. Không tạo thêm clip STTN thử dài chỉ để lấy estimate.
- [ ] Chỉ một completed clean video được chờ render; video sạch của item tiếp theo phải chờ slot trước STTN. Lỗi/hủy dừng producer và drain trước release reservation; không chuyển ổ giữa stream.
- [ ] Gate: không admit rồi lặp fail vì disk thấp. T8 stage cache/resume đầy đủ chưa có thì **giữ maxActiveItems=1 trong release production**; C10 chỉ test experimental 2-item để đo correctness, chưa chứng nhận toàn bộ P2.

## C10 — Acceptance và quyết định rollout

**Files:** tests queue/coordinator/main-path, acceptance scripts; tạo `docs/benchmarks/2026-09-06-autoshort-client-remediation-acceptance.md` khi thực thi, ghi đúng ngày nếu khác.

- [ ] Register mọi test mới trong `scripts/run-local-runtime-tests.mjs`; tests queue phải import runner C0, adapters inject vào production processor, không chép thuật toán vào test.
- [ ] Chạy đầy đủ:

```powershell
npm.cmd run test:local-runtime
npm.cmd run typecheck
npm.cmd run test:ocr-engine
npm.cmd run test:sttn-engine
npm.cmd run build
git diff --check
```

- [ ] Python suites chạy trong môi trường pinned; cấu hình `STTN_TEST_FFMPEG` theo suite hiện có và ghi số skipped. Nếu build `EPERM` vì output đang dùng, validate vào output mới hoặc build không emptyDir có ghi rõ giới hạn; không gọi đó là clean package validation.
- [ ] Chạy regression R2/R3/R4/R5, real cached-WAV acceptance, installed OCR→STTN→render. So sánh output source IDs/text/timing/voice/music/output dirs với conservative baseline cùng cache. Fake-server fixtures được dùng để đo scheduling, không đo tốc độ inference server.
- [ ] Fault matrix bắt buộc: lỗi ASR khi OCR chạy; lỗi STTN khi TTS chạy; lỗi DSP khi prefetch chạy; cancel all; server403/429/timeout qua mock; bad video ở giữa queue; disk hết; corrupt cache; app shutdown; preview tranh GPU; late title. Assert no publish sau cancel fence, no orphan/duplicate request, không đụng output cũ.
- [ ] Microbench 3 lần; ít nhất 3 video đại diện cho end-to-end. Queue 10/15 fixtures kiểm thứ tự, output/title/audit count và peak resources. Queue real server chưa được phép/chưa chạy phải ghi “chưa xác nhận live”, không tự gửi tải thử.
- [ ] Rollout theo từng cờ: conservative → stream-full → ROI opt-in sau quality → TTS prefetch → intra-item overlap. Two-item chỉ khi C9 và full T8 resume/cache của spec gốc được triển khai + kiểm chứng, có qualification record gắn app/runtime/policy hashes; lỗi gate giữ một item.
- [ ] Mục tiêu hiệu năng vẫn là experiment: OCR≥2×; P1 cold median E2E −30%; queue makespan −25%, p95 latency không tăng quá10%. Không đạt thì giữ mặc định conservative và báo số đo, không nới chất lượng/tải backend.
- [ ] Rollback bằng policy sequential, prefetch/overlap=false và archive OCR cũ qua installer; chạy lại một fixture để xác minh. Không xóa source, output, checkpoints/cache cũ của người dùng.

## Phần chưa đưa vào bản sửa đầu tiên

Để không biến đợt khắc phục thành viết lại toàn bộ sản phẩm, các phần sau giữ trạng thái chưa hoàn tất của spec gốc: full `StageArtifactV1`/`AutoShortJobStore`, restore queue qua crash, dependency-specific invalidation cho mọi stage, quota/TTL/LRU toàn cache, title draft overlap và ETA p50–p90 theo corpus. C8 chỉ giải quyết bounded translation và cache TTS an toàn. Việc thiếu các phần này chặn tuyên bố P2 hoàn chỉnh và auto-enable two-item, nhưng không chặn phát hành mốc A/B với một item.

Không có task backend trong kế hoạch này. Optional clone session, model residency và TTS concurrency=2 bị loại khỏi phạm vi.

## Checklist review từng task

- [ ] Có regression chạy RED trước sửa và GREEN sau sửa; kiểm path production thay vì giả lập lại thuật toán.
- [ ] Test output ghi rõ mock/source/native/installed/live và không bỏ qua failed/skipped.
- [ ] Giữ cấu hình và output cũ; mọi thay đổi ngoài files task được giải thích, không gom dirty work của người khác.
- [ ] Caller đã nối module mới vào production; không kết luận hoàn tất từ việc file/class tồn tại.
- [ ] Tài liệu acceptance đánh dấu riêng task implemented, tests verified và rollout enabled.
- [ ] Trước mốc tiếp theo chạy self-review theo R1–R7; chỉ commit explicit files nếu phiên triển khai đã có yêu cầu commit/integration.

## Ma trận truy vết review → tasks

| Finding | Sửa chính | Acceptance |
|---|---|---|
| R1 resource manager chưa nối | C0, C3, C9 | Production queue + preview resource peaks; default 1 |
| R2 orphan visual branch | C1 | Both-direction failure/cancel, cleanup-after-close |
| R3 orphan/swallowed TTS prefetch | C2, C3, C8 | No request after failure, no hidden retry, cache publication barrier |
| R4 unbounded Fast RAM | C4 | Weakrefs + exact stable frame identity on long static interval |
| R5 telemetry leakage | C6 | Stored/getEvents/summary field inspection with fake secrets |
| R6 runtime/capability chưa cập nhật | C7 | Canonical binary identity, feature negotiation, quality + rollback |
| R7 blocking pipe không timeout | C5 | Hung/partial producer exits and reaps under deadline |

Điểm bắt đầu khi được giao triển khai: **C0 rồi C1**, trước mọi nỗ lực tăng throughput.
