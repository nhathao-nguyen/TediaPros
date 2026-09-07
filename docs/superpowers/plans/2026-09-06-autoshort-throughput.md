# Kế hoạch triển khai tối ưu Auto Short 10–15 video

Ngày: 2026-09-06. **Kế hoạch tổng thể chưa hoàn tất; một phần tối ưu client đã được triển khai cục bộ theo yêu cầu tiếp theo.** Xem phần “Follow-up implementation” cuối tài liệu; chưa triển khai backend hoặc xác nhận hiệu năng end-to-end.

Spec bắt buộc: `../specs/2026-09-06-autoshort-throughput-design.md`.
Evidence: `../../benchmarks/2026-09-06-autoshort-throughput-audit.md`.
Baseline triển khai tiếp theo: STTN 1.1.0 đang cài, không dùng bản 1.0.0 lỗi disk.

## 1. Cách thực hiện

Mỗi task: đọc code/tests hiện tại → thêm test hành vi lỗi → chạy fail đúng lý do
→ sửa nhỏ nhất → chạy test liên quan → typecheck khi TS đổi → benchmark phù hợp
→ cập nhật evidence/decision log. Không commit/push hay triển khai server chỉ vì
task được liệt kê ở đây. Working tree đang có nhiều thay đổi được giữ nguyên;
trước implementation lưu manifest/diff baseline, không reset/stash hay copy file
cũ đè phần đã làm. Tách commit theo task khi được yêu cầu integration.

Các đường dẫn đề xuất mới bên dưới chưa tồn tại; không được mô tả như API sẵn có.
Không thêm test chỉ grep source chứa câu lệnh. Fake server dùng để kiểm scheduler,
không dùng để khẳng định throughput server thực tế.

## 2. Lộ trình và phụ thuộc

| Giai đoạn | Task | Phụ thuộc | Deliverable/điểm dừng |
| --- | --- | --- | --- |
| P0 đo | T0–T1 | — | Baseline thành công và stage timing đáng tin |
| P1 OCR | T2–T3 | T1 | OCR streaming/ROI đạt quality gate và runtime đã cài |
| P1 network | T4–T5 | T1 | Batch dịch ổn định, pipeline audio/TTS không đổi timing |
| P1 điều phối | T6–T7 | T1,T3,T4,T5 | Intra-item overlap có resource/cancel đúng |
| P2 phục hồi | T8 | T6 | Stage cache/resume có identity và budget |
| P2 queue | T9 | T7,T8 | 2-item queue pipeline, soak 10/15 |
| P3 tùy chọn | T10 | Server contract + benchmark | Clone session/batch/concurrency được xác minh |
| Release | T11 | Gates của phạm vi được bật | GUI + binary acceptance, rollback tested |

Không ước lượng ngày hoàn thành từ số task: OCR quality corpus và quyền đo
server quyết định effort. Hoàn tất P0 mới chốt thời gian dự kiến và mục tiêu
phút/video. Có thể release P1 client-only trong khi T10 còn blocked.

## T0 — Khóa baseline và tạo corpus

**Đọc:** config note, ba tài liệu hiện tại, installed receipts, source/benchmarks
STTN 1.1.0. Kiểm tra source hash, branch/dirty files, đủ disk, không có job đang
chạy trước benchmark để tránh tranh GPU/server.

**Artifacts mới dự kiến:** `scripts/autoshort-performance-main.ts`,
`docs/benchmarks/<date>-autoshort-throughput-baseline.md`, local evidence folder
mới trong `release-artifacts` (không ghi đè corpus/output cũ).

1. Giữ immutable config snapshot đã redact credentials, input content hash và
   reference voice hash. Corpus gồm Trùng Khánh 209s, ít nhất hai video khác;
   30 đoạn OCR có manual labels cho edge/cut/transient/small text.
2. Đọc lại server capabilities bằng cơ chế auth chính thức của app nếu được
   phép, không dump key hoặc bypass 403. Ghi topology/resources group là unknown
   khi server không khai báo. Không “benchmark” bằng cách gửi 15 video ngay.
3. Chuẩn bị baseline cold cache riêng trong evidence namespace; warm run dùng
   cùng inputs/cache. Không xóa cache user để giả cold cache.
4. Chạy một baseline thành công với config user sau T1; kiểm MP4/title/SRT/audio.
   Nếu server thiếu quyền hoặc unavailable, đo local stages và ghi live gate
   blocked, không thay model/endpoint hoặc mock thành kết quả live.

**Done:** source/config/runtime identity tái lập được; toàn bộ thời gian có
stage attribution; lỗi và lần thành công tách riêng; logs không có secrets.

## T1 — Stage spans, request timings và giao diện tiến độ

**Sửa:** `src/main/autoShortItemCoordinator.ts`, `src/main/autoshort.ts`,
`src/main/localTranslate.ts`, `src/main/tts.ts`, `src/main/ocr.ts`,
`src/main/inpainting/runner.ts`, `src/shared/types.ts`, preload/event IPC,
`src/renderer/src/components/AutoShort.tsx`.
**Thêm:** `src/main/autoShortTelemetry.ts`, tests tương ứng.

1. Implement schema v1, monotonic spans, resource wait vs active vs wall,
   bounded progress, sanitized endpoint aliases. Run wrapper `try/finally`
   phát đúng một terminal span kể cả throw/cancel/timeout.
2. TTS adapter log cache hit/miss, request start/end, trim/probe/tempo durations;
   dịch ghi batch size/attempt/schema status; OCR ghi decode/det/cls/rec và
   requested/effective provider nếu binary có, thiếu thì null.
3. Worker events correlate job/item/attempt bằng main wrapper, không yêu cầu
   Python biết user token. Atomic summary giữ cả fail/cancel; restart đánh dấu
   interrupted thay vì mất stage record.
4. UI hiện stage đang chạy/chờ, elapsed, số item; ETA chưa đủ data không hiển
   thị con số chắc chắn. Giữ IPC backward compatibility khi event optional.

**Test:** fake monotonic clock, overlapping spans không double-count wall,
out-of-order events, UTF-8/chunked JSONL, log quota, write failure, cancel,
redaction, renderer progress không lùi. **Gate:** overhead <3% fixture repeat.

## T2 — OCR streaming full-frame làm nền

**Sửa:** `engines/ocr-engine/engine.py`, `visual_timeline.py`, requirements/spec
nếu cần media library; `src/main/ocr.ts` cho feature negotiation.
**Thêm:** Python stream reader tests, `scripts/ocr-throughput-acceptance.py`.

1. Giữ canonical FFmpeg graph và fps=8; thay PNG directory bằng frame iterator
   bounded, timestamps/frame indices, kiểm dimensions một lần mỗi frame khi đọc.
2. Refactor timeline builder nhận iterable samples thay `frame_paths`; giữ
   adapter path-list cho regression/legacy. Do not materialize entire iterator.
3. Pipe short reads/EOF/truncated frame, stderr drain, timeout/cancel process
   tree và cleanup. DirectML session chỉ một consumer, không concurrent Run.
4. Ghi provider từ session thật, không suy `gpu=true` của probe thành inference
   provider. Không nâng runtime libs cùng lúc nếu không cần.

**Test:** full-frame old/new cùng images tạo cùng timeline, 8 FPS/last partial
frame, source rotation/SAR/VFR, dimension mismatch, Unicode path, cancel lúc
decode/inference, decoder error, memory bounded ở video dài.
**Gate:** no full-video PNG; output contract không đổi; memory không tỷ lệ duration.

## T3 — OCR ROI có halo và phát hành binary

**Sửa:** T2 paths, `src/shared/ocrVisualTimeline.ts` nếu metadata bổ sung,
`src/main/runtimeManifest.ts`/`runtimeProbes.ts` capability checks,
runtime build/package scripts có liên quan. Không đổi STTN policy thành fast.

1. Crop display-space ROI+halo=32px candidate, clamp, full res trong crop;
   dịch polygon x/y về display-space trước policy mask. Cùng original ROI phải
   là giới hạn erase; halo không mở vùng xử lý của user.
2. Sweep halo/full-frame vs ROI trên labeled corpus; giữ 8 FPS và rec mỗi mẫu.
   Không loại recognition trong task này. Small ROI/edge/out-of-frame phải có
   validation rõ, không silently scan vùng khác.
3. Benchmark CPU và provider thực dùng, OCR breakdown, det/rec count, temporary
   bytes và output masks. Full-frame streaming là fallback theo feature flag
   khi ROI chưa đạt corpus quality, không downgrade sampling.
4. Version/capability mới, reproducible archive+SHA256, managed installation,
   real main-path preview/cancel. Giữ archive trước để rollback.

**Gate:** các ngưỡng OCR quality trong spec; mục tiêu ≥2× OCR throughput trên
corpus; report cả trường hợp không đạt, không lựa sample đẹp nhất.

## T4 — Batch dịch có giới hạn cue/token và retry bounded

**Sửa:** `src/main/localTranslate.ts`, `translate-shared.ts`,
`localTranslatePolicy.ts`, tests translation contract/local-runtime.

1. Truyền local-specific policy thay thay global MAX_CHARS. Candidate 12/24/40
   cue, selected default sau measurement; tính output budget/context overhead.
2. Semantic split với context read-only, mọi source ID đúng một target; group
   oversize split tại cue boundaries, không cắt nội dung cue để vượt cap.
3. Invalid schema large batch split sớm, nhỏ repair tối đa một lần; transport
   retries dùng chung deadline budget. Không áp request-count ceiling mặc định;
   chỉ bật quota nếu caller truyền `maxRequests`. Respect Retry-After.
4. Cache/checkpoint mỗi batch valid; không đánh dấu all done khi partial invalid.

**Test:** fixture 117 Chinese cues, short source/long English expansion, 1 cue
oversize, duplicate/missing/extra IDs, wrong script, truncation, 429/503,
abort sau split, không repeat toàn bộ accepted batches.
**Gate:** không mất cue; first-pass schema mục tiêu ≥95%, retry time −50% trên
corpus; đo chất lượng dịch riêng, không chỉ count.

## T5 — Pipeline TTS request với local audio và cache an toàn

**Sửa:** `src/main/dubbing/synthesis.ts`, `dubbing/cache.ts`,
`src/main/autoshort.ts` adapter, `src/main/tts.ts`, related dubbing tests.

1. Giữ server in-flight=1; chuẩn bị reference audio/hash một lần/job.
2. Prefetch tối đa một raw next-cue WAV trong khi trim/probe current; commit
   predictor/final plan theo source order. Bootstrap audio dùng lại.
3. Rephrase không dùng text stale; bypass/quarantine corrupt cache đúng một
   lần. Atomic cache temp→complete và single-flight; hash reference/model rev.
4. Giữ existing source windows/tempo limits/subtitle placement; no group WAV
   mới hoặc đổi giọng để giảm requests. Late callbacks phải qua cancel fence.

**Test:** fake adapter controlled delays để chứng minh overlap thật mà server
peak active=1; predictor determinism; out-of-order completion; cache race/
corruption; reference file đổi content cùng metadata; bootstrap not repeated;
cancel while next audio downloaded. Audio fixture compare waveform/timeline.
**Gate:** plan unchanged under fixed inputs, bounded RAM/processes; báo mức
tiết kiệm local DSP, không nhận là server inference nhanh hơn.

## T6 — Resource manager và task graph

**Thêm:** `src/main/autoShortResourceManager.ts`, `autoShortStageRunner.ts`, tests.
**Sửa:** context dependencies trong coordinator, preview resource acquisition.

1. Implement capacities/spec resource groups, atomic claim tập resource,
   FIFO/aging, AbortSignal cancellation trong waiting queue.
2. Lease gắn stage attempt, await process close/network settle trước release;
   không giữ GPU trong khi chờ server, không deadlock nhiều lease.
3. GPU heavy capacity=1; CPU budget theo máy; shared server group default=1;
   disk reservations theo volume, measured actual reconciled vào ledger.
4. Đồ thị dependency conditional theo subtitle method/lamMo/tts/title;
   stage failure abort siblings và await allSettled. Publish barrier riêng.

**Test:** deterministic synthetic resource traces, impossible claim fail sớm,
double-release, cancel while waiting, starvation/aging, preview tranh GPU,
multi-resource deadlock, stage throw, same key fan-out exactly once, disk budget.
**Gate:** không oversubscribe cấu hình, no orphan leases/processes.

## T7 — Overlap trong một video và title draft

**Sửa:** coordinator, `autoshort.ts`, `burn.ts`, `videoTitle.ts`, progress UI.

1. Flag off là luồng cũ. Flag on khởi tạo visual OCR độc lập ngay sau validate;
   ASR CPU dùng scheduler; dịch/TTS nối tiếp source cues.
2. OCR hoàn tất thì STTN có thể chạy dù nhánh network còn xử lý; render join
   cleaned media + validated final audio/subtitle. Whisper-ocr merge giữ đúng
   dependency hai nguồn, không nhầm visual text thành target transcript.
3. Title draft chạy cùng render chỉ sau SRT cuối; chỉ ghi title sau publish,
   giữ titleError behavior cũ, cancel/title timeout không xóa MP4 thành công.
4. Preflight output/disk/engine readiness trước server requests; lock config
   immutable suốt attempt. Stage status UI không lẫn progress hai nhánh.

**Test:** controllable local/network delays chứng minh wall=max(branches)+join,
GPU peak=1, OCR one-call; no render early; source/translation failure aborts
STTN; STTN failure aborts pending TTS; disable flags/modes; late title result.
**Gate:** full main-path single item, quality same, live end-to-end cold cache
mục tiêu −30%; nếu không đạt thì profiling tiếp, không bật vì unit tests pass.

## T8 — Stage artifacts, cache và resume

**Thêm:** `src/main/autoShortStageCache.ts`, `autoShortJobStore.ts`, tests.
**Sửa:** checkpoint fingerprint/ownership, UI retry/re-add, output reservation.

1. StageArtifactV1 validate hashes and containment; bounded local quota/TTL/LRU,
   lock leases, atomic publish; source hash streaming once.
2. Dependency-specific invalidation: ROI → OCR/STTN; font/music → final only;
   target language → translation/TTS/title; voice → TTS/audio. Content/version
   change prevents reuse even if filename/item ID same.
3. Import only valid legacy v5 source/translation, giữ file cũ. Job manifest
   persists item order, config, output dir reservation, stages and attempts.
4. Crash → interrupted → revalidate → resume; never trust FFV1 partial. Clean
   media retention limited to pending/retry item, no 15-video FFV1 cache mặc định.

**Test:** crash between write/rename, malicious symlink/path, concurrent key,
quota with active lease, clock/TTL, altered source/reference content, mode
invalidation matrix, app restart, retry keeps accepted expensive work.
**Gate:** warm retry không gọi stage đã valid; cold benchmark vẫn cold; outputs cũ nguyên vẹn.

## T9 — Queue pipeline 2 item và soak 10/15

**Sửa:** `executeJob` scheduler integration, result ordering, progress UI;
tests new `autoshort-queue-throughput.test.ts`.

1. Admission tối đa 2 active items, lookahead=1; GPU heavy=1/server group=1,
   no direct Promise.all(15 processSingleVideo). Preserve selected music mapping
   và result array theo input index dù completion out-of-order.
2. Ưu tiên giải phóng clean media chờ render; khi disk thấp chặn admission,
   không lặp launch/fail. Global auth fail pause queue; per-item media fail
   không hủy item đã thành công. Cancel-all không admit thêm.
3. Show throughput/ETA source and confidence; settings chỉ hiệu lực job kế
   tiếp để benchmark/config không thay giữa chừng.
4. Run deterministic fake-server tests trước, sau đó queue thật 10 và 15 video
   mixed lengths. Ghi first-output latency, p50/p95 item latency, makespan,
   GPU/CPU/RAM/disk peaks, server request concurrency và failures.

**Gate:** output/title/audit count đúng, no duplicates or leaks, quality gates
same; target makespan −25% vs P1 optimized sequential, p95 latency regression
≤10%. Nếu GPU/server bottleneck khiến không đạt, giữ one-item default và báo
giới hạn capacity, không tăng concurrency mù.

## T10 — Server work có điều kiện

Không thể chốt file backend khi repo/server chưa được truy cập. Deliverable
đầu tiên là capability audit đã được server owner/auth cho phép, model revision
và architecture/resources map. Không chỉnh server đang phục vụ để thử giả thuyết.

1. Đo inference/queue/model load/reference conditioning, tách client latency.
2. Nếu conditioning lặp: đề xuất clone session content-addressed có TTL và
   account scope. Nếu đã cache phía server thì không xây trùng.
3. Nếu batch API có aligned cue IDs: thử 2/4 items/request, deadline và error
   isolation. Nếu không alignment thì giữ one-cue contract.
4. Concurrency 1 vs 2, model residency LLM/TTS và 429/OOM tests; chỉ qualify
   profile thực sự tăng throughput không giảm chất lượng.

**Gate:** endpoint/contract version thật, backward compatibility và rollback;
không cần T10 để release P1/P2 client-only. ETA toàn hệ thống cập nhật từ số đo.

## T11 — Release, verification và recovery

1. Chạy `npm run test:local-runtime`, `npm run typecheck`, `npm run build`,
   `npm run test:ocr-engine` bằng môi trường pinned, Python STTN suite với
   `STTN_TEST_FFMPEG`; `git diff --check`. Test mới register trong
   `scripts/run-local-runtime-tests.mjs`. Không coi test skip là media pass.
2. Build/package OCR runtime có feature mới, verify archive checksum/version,
   install qua managed installer. Giữ STTN 1.1.0 và những mode cũ hoạt động.
3. Native Electron acceptance: real OCR→STTN→render; server-backed complete
   config khi đủ auth; GUI check progress/cancel/retry/queue ordering/title.
4. Fault matrix: kill worker, server timeout/429, corrupt cache, disk exhaustion,
   app close/reopen, input deleted, title fail, one bad video among 15.
5. Rollback flags về sequential + old OCR binary; thực sự chạy lại 1 item kiểm
   rollback. Giữ outputs/checkpoints/source, dọn duy nhất owned test partials.
6. Viết báo cáo before/after với input hashes, versions, repetition count,
   cold/warm, topology, limits; mọi stage/queue gate chưa chạy ghi chưa đạt.

## 3. Checklist quyết định bắt đầu implementation

- [ ] P0 scope/corpus đầy đủ, xác định job thành công để đo mới.
- [ ] Giữ chất lượng/cấu hình nguồn là constraint cứng.
- [ ] Client-only P1 có thể làm ngay sau baseline; server extension phải có auth/contract.
- [ ] Không có performance claim dựa trên lần lỗi 98 GiB hoặc mock benchmark.
- [ ] Mọi feature flag/capacity mặc định và rollback có owner/test rõ.
- [ ] Tài liệu specs, audit và plan không mâu thuẫn về số liệu hay trạng thái.

Ưu tiên triển khai đầu tiên: **T0 + T1, sau đó T2/T3 và T4**. Đó là các bước
giải quyết phần thời gian lớn nhất có bằng chứng mà chưa thay chất lượng giọng,
model hoặc nhịp video. Không bắt đầu bằng tăng số video chạy đồng thời.
# Follow-up implementation: remote backend log (2026-09-06)

The later user request authorized quality/speed improvements after supplying the backend log. A bounded subset is now implemented in the client: local dubbing batches (24 cues / 2,000 characters with intact semantic groups), immediate split of failed multi-group responses, token-truncation rejection, meaning-preserving character-budget guidance, explicit translation-model selection, TTS/DSP timings, and original-PCM tempo fitting with measured total-tempo metrics. This is not completion of T0–T11: OCR streaming/ROI, resource scheduling, stage cache, TTS prefetch and multi-item scheduling remain pending. Backend changes remain proposals because the server is on another machine and its source is unavailable here.

Evidence and backend requirements: [2026-09-06-backend-quality-speed.md](../../benchmarks/2026-09-06-backend-quality-speed.md). Validation: 360 local runtime tests passed, typecheck passed, real cached-WAV/FFmpeg acceptance passed. Full build passed with `emptyOutDir: false` after a standard-build `EPERM` on old renderer assets. No live server or full queue performance result is claimed.
