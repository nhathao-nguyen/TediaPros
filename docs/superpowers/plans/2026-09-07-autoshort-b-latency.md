# Auto Short B — Giảm latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tận dụng I/O và thời gian chờ mà giữ model/output policy.
**Architecture:** Bật từng cờ độc lập theo capability; scheduler giữ một local GPU-heavy và một video ở giai đoạn đầu.
**Tech Stack:** TypeScript/Electron, Python, FFmpeg, Node test runner.
**Spec:** [Thiết kế](F:/Son/tool/TediaPros/docs/superpowers/specs/2026-09-07-autoshort-optimization-design.md).

## Global Constraints

Áp dụng đầy đủ mục 3 spec. Tempo ưu tiên 1.10x, thông thường 1.25x, trần 1.45x; gap 0.50s; trim -50 dB/onset 30ms/offset 100ms. Giữ planar RGB trước maskedmerge, model/geometry/FPS/encode trong phép so tương đương; maxActiveItems=1 ở các gói đầu và tối đa một request TTS đang chạy. Cache/scratch riêng, SHA-256 pin, typed IPC, không sửa LICENSE/NOTICE hoặc tệp ngoài phạm vi.

Các block test là phần kiểm tra hành vi cần đặt trong fixture của file được chỉ định; không giả định chúng là test hoàn chỉnh đã có. Mỗi task code: viết regression đỏ → chạy đúng suite → sửa tối thiểu → test xanh + `npm.cmd run typecheck` + `git diff --check` → cập nhật docs liên quan và handoff theo mẫu → commit riêng các file task sau review. Với file test mới, thêm vào danh sách trong `F:/Son/tool/TediaPros/scripts/run-local-runtime-tests.mjs` nếu cần. Không commit logs chứa dữ liệu riêng.


## T08 — Runtime OCR và stream-full
**Phụ thuộc:** T01,T03,T04. **Files sửa:** `F:/Son/tool/TediaPros/engines/ocr-engine/requirements.txt`, `F:/Son/tool/TediaPros/engines/ocr-engine/ocr-engine.spec`, `F:/Son/tool/TediaPros/engines/ocr-engine/engine.py`, `F:/Son/tool/TediaPros/src/main/ocr.ts`, `F:/Son/tool/TediaPros/src/main/autoShortExecutionPolicy.ts`, `F:/Son/tool/TediaPros/tests/autoshort-ocr-runtime.test.ts`, `F:/Son/tool/TediaPros/engines/ocr-engine/tests/test_stream_reader.py`, `F:/Son/tool/TediaPros/engines/ocr-engine/tests/test_engine_cli.py`.
**Interface:** reuse capability negotiation visual-stream-full-v1; legacy engine vẫn dùng legacy-disk, requested/effective transport phải khác nhau rõ khi fallback.

- [ ] Đóng gói trong venv Python có wheel RapidOCR/ONNX đúng; pin dependency sau probe thực. Bản cũ từng thiếu rapidocr_onnxruntime không được coi là đầu ra hợp lệ chỉ vì PyInstaller exit0.
- [ ] Viết test engine thiếu feature → fallback legacy có reason, advertise nhưng probe failed → không dùng; ready và feature hợp lệ → stream-full. Không sửa default trước khi qualification.
```text
requested=stream-full, installed=1.1/no feature => effective=legacy-disk
requested=stream-full, feature present, ready=false => setup error or valid old-runtime fallback
requested=stream-full, feature present, ready=true => effective=stream-full
```
- [ ] Kiểm tra pipe bounded queue2, raw-frame byte length, EOF/truncated frame, watchdog, child close khi cancel. Giữ full display geometry, sample FPS/profile và timeline logic.
- [ ] Dùng corpus T01 so legacy/stream ở frame decode, sample timestamps, visual timeline và downstream mask/STTN. Nếu khác, tìm màu/geometry/reader thay vì nới tolerance tùy ý. Rotation/VFR/ROI biên phải có fixture.
- [ ] Build archive mới, manifest SHA-256, `--version`, `--probe` thực trên binary; cài vào userData qualification riêng qua installer hiện có, giữ receipt/archive cũ. Không thay runtime người dùng trong bước build.
- [ ] Chạy `npm.cmd run test:ocr-engine` và `node scripts/run-local-runtime-tests.mjs autoshort-ocr-runtime.test autoshort-ocr-pipeline.test ocr-visual-timeline.test`.
- [ ] Ghi A/B timings/scratch; gate đạt spec mới cho opt-in. T23 mới quyết định default theo capability. Rollback: legacy transport + receipt cũ, không đổi cue/model.

## T09 — TTS prefetch một câu
**Phụ thuộc:** T01,T02,T04.
**Files:** `F:/Son/tool/TediaPros/src/main/dubbing/synthesis.ts`, `F:/Son/tool/TediaPros/src/main/autoShortExecutionPolicy.ts`, `F:/Son/tool/TediaPros/tests/autoshort-tts-pipeline.test.ts`, `F:/Son/tool/TediaPros/tests/autoshort-tts-cache.test.ts`.
**Interface:** reuse prefetchTts; server in-flight≤1, chuẩn bị một next cue, mọi promise thuộc item scope.

- [ ] Giữ 5 test hiện có và bổ sung text đổi sau rephrase, cache hit/miss xen kẽ, voice/model đổi giữa lượt, cuối queue không request thừa. Phần chuẩn bị obsolete phải cancel/drain hoặc được định danh để không gắn nhầm cue.
```ts
assert.equal(peakServerInFlight, 1);
assert.deepEqual(prefetchPlan, sequentialPlan);
assert.deepEqual(prefetchClipOrder, sequentialClipOrder);
assert.equal(extraRetryAfterForbidden, 0);
```
- [ ] Giữ natural synthesis/trim và predictor update đúng thứ tự; không biến prefetch thành Promise.all mọi cue. Request lỗi 401/403/billing không retry; timeout/rate-limit chỉ theo budget/retry contract hiện có.
- [ ] Thêm counter prefetchUsed/prefetchDiscarded/DSP hidden time. Dùng fixed WAV so timing/PCM; separate live benchmark để biết server có cạnh tranh tài nguyên không.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-tts-pipeline.test autoshort-tts-cache.test dubbing-plan.test`.
- [ ] Gate: cùng output deterministic, lỗi/cancel không request mồ côi, gain vượt noise. Rollback prefetch=false, giữ correctness T02.

## T10 — Lịch overlap sau Whisper và separation
**Phụ thuộc:** T01,T04,T05,T08,T09.
**Files:** `F:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts`, `F:/Son/tool/TediaPros/src/main/autoShortResourceManager.ts`, `F:/Son/tool/TediaPros/src/main/autoShortExecutionPolicy.ts`, `F:/Son/tool/TediaPros/tests/autoshort-ocr-pipeline.test.ts`, `F:/Son/tool/TediaPros/tests/separator-pipeline.test.ts`; mới `F:/Son/tool/TediaPros/tests/autoshort-stage-scheduling.test.ts`.
**Interfaces:** reuse itemScope.start/drain, visualOcrPromise memoization, withLease. Không cần một scheduler framework tổng quát mới.

- [ ] Dùng deferred stage tests, không sleep để đo đúng thứ tự: Whisper first; source cues ready mở remote translation; visual start trong lúc translation pending; một GPU-heavy; burn chỉ sau cả audio + visual done.
```text
assert asr.end <= translate.start
assert asr.end <= visual.start < translate.end
assert burn.start >= max(audio.end, visual.end)
assert peakLocalGpuHeavy == 1
assert visualOcrCallCount == 1
```
- [ ] Di chuyển điểm mở visual branch khỏi trước ASR trong Whisper mode. Không đổi OCR/whisper-ocr dependency; checkpoint hit vẫn cung cấp cùng source evidence.
- [ ] Tách separation khỏi việc chặn bước gọi server nếu chỉ audio composition cần instrumental. Giữ local queue ổn định, mọi tác vụ eventual progress, không starve separation bởi chuỗi stage visual. Chưa đổi resource capacity dựa trên tên CPU/GPU.
- [ ] Resource server theo endpoint/provider identity: nếu dịch/TTS dùng cùng một backend có capacity1, serialize đúng; không gộp mọi URL thành server bất kỳ hoặc tự suy cùng host là hai GPU khác.
- [ ] Nhánh lỗi đầu tiên abort nhánh còn lại, drain tới close trước cleanup; titleError optional không abort video. Thử cache hit, no-TTS, replace/mix/separate-vocals, blur/STTN, không có visual cue, abort trong mỗi stage.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-stage-scheduling.test autoshort-ocr-pipeline.test autoshort-resource-lifecycle.test autoshort-disk-budget.test separator-pipeline.test`.
- [ ] A/B E2E thật + fixed-output replay. Gate đủ bằng chứng không oversubscribe/thiếu output; keep maxActiveItems=1. Rollback overlap=false, không rollback lifecycle fixes.

## T11 — Chuẩn bị title cùng render
**Phụ thuộc:** T03,T04.
**Files:** `F:/Son/tool/TediaPros/src/main/burn.ts`, `F:/Son/tool/TediaPros/src/main/videoTitle.ts`, `F:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts`; mới `F:/Son/tool/TediaPros/tests/autoshort-title-overlap.test.ts`.
**Interface:** tách prepare khỏi commit, typed nội bộ:
```ts
// New internal result, does not change current UI contract.
type PreparedVideoTitle = {
  inputDigest: string;
  text?: string;
  error?: string;
};
```
inputDigest bao gồm final SRT text được cắt theo duration dùng trong request, output language và title model/prompt/options; reuse generator hiện có.

- [ ] Test title chỉ bắt đầu khi final spoken SRT chốt; render fail/cancel không ghi tieude; title fail vẫn giữ video success với titleError; file cũ không overwrite.
- [ ] Launch chuẩn bị khi burn bắt đầu; dùng external-title resource và scope riêng không làm lỗi optional lan thành lỗi video. Abort có drain.
- [ ] Sau probe video, dựng lại inputDigest từ duration thật: bằng → dùng prepared, khác → regenerate tối đa một lần với đầu vào đúng. Nếu không thể chốt duration trước, giữ đường sequential thay vì đoán.
```text
prepared.inputDigest == actual.inputDigest -> commit title after validated video
prepared.inputDigest != actual.inputDigest -> regenerate from actual once
render invalid -> discard prepared title
```
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-title-overlap.test autoshort-ocr-burn.test`; fixture title API cho logic, live đo riêng khi được phép.
- [ ] Gate: tieude đặt đúng output scope, không title thừa khi hủy; lợi ích chỉ là thời gian title được che. Rollback giữ completeBurnVideoTitle sequential.

## Gate G2

- [ ] Mỗi cờ có requested/effective, default cũ giữ tới T23, disable độc lập.
- [ ] Không dùng chung tổng gain của các cờ độc lập; đo bản combined sau từng A/B.
- [ ] Đối chiếu fixed inputs cho parity và live cho latency; không dùng test promise giả làm benchmark GPU/server.
