# Auto Short C — Cache và worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giảm tính lại khi rerun, giảm DSP/load model thừa khi đo cho thấy có lợi.
**Architecture:** Cache immutable theo stage, bounded quota và pin; worker/server là nhánh qualification riêng, không mặc định giữ mọi model trên GPU.
**Tech Stack:** TypeScript/Electron, Python, FFmpeg, Node test runner.
**Spec:** [Thiết kế](F:/Son/tool/TediaPros/docs/superpowers/specs/2026-09-07-autoshort-optimization-design.md).

## Global Constraints

Áp dụng đầy đủ mục 3 spec. Tempo ưu tiên 1.10x, thông thường 1.25x, trần 1.45x; gap 0.50s; trim -50 dB/onset 30ms/offset 100ms. Giữ planar RGB trước maskedmerge, model/geometry/FPS/encode trong phép so tương đương; maxActiveItems=1 ở các gói đầu và tối đa một request TTS đang chạy. Cache/scratch riêng, SHA-256 pin, typed IPC, không sửa LICENSE/NOTICE hoặc tệp ngoài phạm vi.

Các block test là phần kiểm tra hành vi cần đặt trong fixture của file được chỉ định; không giả định chúng là test hoàn chỉnh đã có. Mỗi task code: viết regression đỏ → chạy đúng suite → sửa tối thiểu → test xanh + `npm.cmd run typecheck` + `git diff --check` → cập nhật docs liên quan và handoff theo mẫu → commit riêng các file task sau review. Với file test mới, thêm vào danh sách trong `F:/Son/tool/TediaPros/scripts/run-local-runtime-tests.mjs` nếu cần. Không commit logs chứa dữ liệu riêng.


## T12 — Kho artifact có integrity, quota và pin
**Phụ thuộc:** T03,T04,T05.
**Files mới:** `F:/Son/tool/TediaPros/src/main/autoShortArtifactCache.ts`, `F:/Son/tool/TediaPros/tests/autoshort-artifact-cache.test.ts`.
**Files sửa:** `F:/Son/tool/TediaPros/src/main/autoShortDiskBudget.ts`, `F:/Son/tool/TediaPros/src/main/autoshort.ts`.
**Interface mới nội bộ:**
```ts
export type ArtifactStage = 'asr' | 'translation' | 'visual-ocr' | 'sttn' | 'trim-pcm';
export type ArtifactLease = { readonly path: string; release(): void };
export interface ArtifactCache {
  get(stage: ArtifactStage, key: string, signal: AbortSignal): Promise<ArtifactLease | null>;
  put(stage: ArtifactStage, key: string, sourcePath: string, signal: AbortSignal): Promise<void>;
  prune(signal: AbortSignal): Promise<{ removedBytes: number }>;
}
```
Giữ module này Main-only. Key/hash tạo ở T13/T14; get validate manifest/version/digest và pin trước trả path. put chỉ đọc source đã được scope validator chấp thuận.

- [ ] Test corrupt digest, missing file, version mismatch, traversal key, two writers/singleflight, abort reader không abort writer còn waiter, crash trước rename, eviction khi reader pin.
- [ ] Atomic temp+manifest verified rồi publish; output immutable, không cung cấp writable shared file cho FFmpeg. Tombstone/lock xử lý crash và pin đa process nếu app cho nhiều instance; nếu single instance, assert lock đó trước dùng cache.
- [ ] Quota mặc định đề xuất cache nhỏ 2 GiB, TTL14 ngày; cache STTN lớn opt-in 10 GiB/TTL7 ngày, không vượt headroom thực. Quota là giới hạn tối đa, không phải đặt trước dung lượng. Khi không đủ chỗ, bỏ cache write và giữ video chạy nếu scratch vẫn đủ.
- [ ] Prune LRU chỉ entry unpinned; user clear-cache không đụng output/source/scratch sống. Key và manifest không ghi prompt/reference/token plaintext.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-artifact-cache.test autoshort-disk-budget.test safe-contained-path.test`.
- [ ] Gate: không đọc sai artifact, disk bounded, cancelled reader release đúng một lần. Rollback bypass cache; không xóa cache cũ khi nâng schema.

## T13 — Cache stage, checkpoint nhóm dịch và resume
**Phụ thuộc:** T01,T12.
**Files mới:** `F:/Son/tool/TediaPros/src/main/autoShortStageKeys.ts`, `F:/Son/tool/TediaPros/tests/autoshort-stage-cache.test.ts`.
**Files sửa:** `F:/Son/tool/TediaPros/src/main/autoshort.ts`, `F:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts`, `F:/Son/tool/TediaPros/src/main/autoShortOcrCheckpoint.ts`, `F:/Son/tool/TediaPros/src/main/localTranslate.ts`.
**Interface:** `buildStageKey(stage: ArtifactStage, canonicalInputs: Readonly<Record<string, unknown>>): string` tại stageKeys, SHA-256 từ canonical JSON đã validate; không hash JSON.stringify có thứ tự key bất định.

- [ ] Viết ma trận invalidation: đổi voice → ASR/dịch/OCR/STTN hit, TTS miss; đổi ROI → visual/STTN miss; đổi source nội dung dù cùng size/mtime → toàn stage phụ thuộc miss; đổi prompt/model → dịch miss; đổi subtitle style → không gọi lại model trước render.
```text
same source + changed voice: asr=true, translation=true, visual=true, tts=false
same size/mtime + changed source bytes: every source-dependent hit=false
changed OCR transport: hit=false until equivalence qualification permits shared key
```
- [ ] Hash nguồn stream một lần mỗi run và chia sẻ promise; memoize probe metadata theo content hash + selected stream + probe revision. Không bỏ content validation chỉ vì size/mtime giống.
- [ ] Tích hợp cache ASR/dịch/visual trước, STTN opt-in sau kiểm tra quota. Copy/materialize vào scope khi consumer có thể sửa; cache entry luôn immutable.
- [ ] Checkpoint mỗi translation batch đã validate, giữ canonical full context/prompt trong key. Resume chỉ missing batch; nếu thay grouping/context, invalidate batch liên quan. Giữ regenerate action để người dùng yêu cầu kết quả AI mới.
- [ ] Durable job checkpoint tham chiếu manifest/schema/key; sau crash kiểm tra lại source/cache trước resume, không dùng mỗi count cue làm bằng chứng hợp lệ. Output ID mới không làm mất cache nội dung.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-stage-cache.test autoshort-artifact-cache.test autoshort-ocr-contract.test autoshort-tts-cache.test`; fault test restart giữa write và publish.
- [ ] Benchmark first-pass và rerun riêng; gate: không dùng sai voice/text/mask, rerun giảm đúng calls, cache budget không làm ENOSPC. Rollback bypass stage cache, giữ checkpoint migration đọc an toàn.

## T14 — Cache trim PCM và tránh copy/probe lặp
**Phụ thuộc:** T02,T12.
**Files:** `F:/Son/tool/TediaPros/src/main/dubbing/synthesis.ts`, `F:/Son/tool/TediaPros/src/main/dubbing/cache.ts`, `F:/Son/tool/TediaPros/src/main/autoshort.ts`; mới `F:/Son/tool/TediaPros/tests/autoshort-trim-cache.test.ts`.
**Interface:** dùng ArtifactCache stage='trim-pcm'; key rawWavSha256 + trimPolicyVersion + FFmpegRevision + sampleRate/channels/sampleFormat. Tempo/timeline không được ghi đè vào entry trim.

- [ ] Test raw cùng hash→trim hit; threshold/FFmpeg/format đổi→miss; voice khác raw khác→miss; corrupt→retrim một lần; cancel trong cache hit không xóa cached WAV.
```text
raw hash same + trim policy same -> same PCM/hash/onset/offset metadata
target cue window changes -> reuse natural trimmed PCM, recalculate tempo anew
```
- [ ] Lưu PCM và duration/onset/offset đo kèm manifest atomic; dùng riêng natural trimmed source cho mọi correction. Không cache audio đã atempo dưới key natural.
- [ ] Dùng T01 đếm copy/probe; loại đúng thao tác lặp đã chứng minh. Nếu cần materialize cache → scope, ưu tiên copy an toàn; chỉ thử hardlink/reflink sau kiểm tra consumer không sửa và cùng volume hỗ trợ, fallback copy rõ ràng.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-trim-cache.test autoshort-tts-cache.test autoshort-tts-pipeline.test dubbing-plan.test`.
- [ ] Gate: PCM/timing tương đương, file shared không bị mutate, rerun có lợi hơn hash/copy overhead. Rollback cache trim off.

## T15 — Worker local thường trú có điều kiện
**Phụ thuộc:** T01,T04,T10.
**Files khảo sát/sửa nếu gate đạt:** `F:/Son/tool/TediaPros/src/main/whisper.ts`, `F:/Son/tool/TediaPros/engines/whisper-engine/engine.py`, `F:/Son/tool/TediaPros/src/main/autoShortResourceManager.ts`; mới `F:/Son/tool/TediaPros/tests/whisper-worker-lifecycle.test.ts`, `F:/Son/tool/TediaPros/docs/benchmarks/whisper-worker-qualification.md`.
**Deliverable độc lập:** báo cáo cold/load/inference/idle-memory. Chỉ thêm persistent mode khi load overhead đáng kể và giữ model không làm STTN chậm/thiếu bộ nhớ.

- [ ] Tách time load/first inference/warm inference trên model/provider hiện dùng; so worker tái sử dụng với process-per-job. Không gọi comment “resident” là bằng chứng.
- [ ] Nếu đáng làm, thêm capability warm-session và JSONL requestId; giữ CLI one-shot làm fallback. Tại một worker chỉ một request active; model/device/options mismatch phải unload/recreate.
```json
{"type":"transcribe","requestId":"job-1","inputPath":"scoped-path","options":{}}
```
JSON là shape giao thức đề xuất; options phải validate theo CLI hiện có, không mở quyền đọc file tùy ý từ renderer.

- [ ] Timeout idle đề xuất60s, shutdown/cancel phải drain; VRAM pressure hoặc STTN cần bộ nhớ → unload trước khi cấp công việc GPU khác. Resident allocation phải được budget riêng, không coi lease rảnh là VRAM đã trống.
- [ ] Test crash worker→restart đúng một lần cho request retryable, response sai requestId bị loại, cancel không lẫn output lần sau, app quit không còn worker.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs whisper-worker-lifecycle.test local-runtime.test autoshort-resource-lifecycle.test`; Python protocol tests được thêm cùng engine khi triển khai.
- [ ] Gate: benchmark combined với STTN có lợi, output quality đạt. Không đạt → giữ one-shot, báo kết luận; không chặn release các gói khác.

## T16 — Server TTS conditioning, warm worker và reference reuse
**Phụ thuộc:** T01,T09; cần repo/commit server thực, topology và quyền chạy benchmark.
**Files cục bộ có thể sửa:** `F:/Son/tool/TediaPros/src/main/tts.ts`, `F:/Son/tool/TediaPros/src/main/dubbing/cache.ts`; mới `F:/Son/tool/TediaPros/tests/tts-reference-capability.test.ts`, `F:/Son/tool/TediaPros/docs/benchmarks/tts-server-optimization-audit.md`.
**Không invent đường dẫn backend:** đọc wrapper đang deploy để lập manifest các file server thật trước khi patch. Nếu chưa có source, deliverable là audit client + danh sách evidence thiếu, trạng thái nhánh unqualified.

- [ ] Đo upload/reference preprocessing/model load/inference riêng. Xác minh server đã cache conditioning chưa, request có reset mutable voice state không, dịch/TTS có tranh cùng GPU không.
- [ ] Chỉ nếu preprocessing lặp đáng kể: server cache immutable conditioning theo reference content hash + model/revision + options, tenant/voice scope; serialize access hoặc clone trạng thái để A/B không trộn giọng. Không dựa mỗi tên file.
- [ ] Giữ API hiện hành làm fallback. Reference upload-once/hash-session chỉ thêm sau capability server hỗ trợ rõ, expiry/401/403/missing reference được xử lý; không gửi hash-only cho server cũ.
```text
capability absent -> existing full-reference request
capability present, content registered -> use server-scoped reference ID
unknown/expired ID -> re-register once, then retry bounded
401/403/billing -> surface error; no blind regeneration
```
- [ ] Test concurrent voices A/B, same filename khác bytes, same bytes khác user, server restart, cache eviction, cancellation và request retry count. Không tăng server in-flight vượt1 trong gói này.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs tts-reference-capability.test autoshort-tts-cache.test autoshort-tts-pipeline.test`; server test command lấy từ repo thật, ghi vào audit trước chạy.
- [ ] Gate: audio/voice không nhiễm, total latency có lợi gồm upload và cold-start. Chọn phiên bản backend deploy/rollback cụ thể khi đã có quyền thực thi; không bắt các tối ưu client phụ thuộc server này.

## Gate G3

- [ ] Cache immutable + pin/quota/invalidation/resume đạt cả fault tests.
- [ ] Report first-run/rerun/cold/warm riêng; cache hit không được tính là model inference nhanh hơn.
- [ ] Worker/server không đủ evidence giữ off và đánh dấu unqualified trong release matrix.
