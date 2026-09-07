# Auto Short A — Nền đo và tính đúng Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khóa bằng chứng đo, policy và vòng đời trước tối ưu.
**Architecture:** Giữ manager/coordinator hiện có; thêm regression tái hiện lỗi thật và instrument ở ranh giới stage.
**Tech Stack:** TypeScript/Electron, Python, FFmpeg, Node test runner.
**Spec:** [Thiết kế](F:/Son/tool/TediaPros/docs/superpowers/specs/2026-09-07-autoshort-optimization-design.md).

## Global Constraints

Áp dụng đầy đủ mục 3 spec. Tempo ưu tiên 1.10x, thông thường 1.25x, trần 1.45x; gap 0.50s; trim -50 dB/onset 30ms/offset 100ms. Giữ planar RGB trước maskedmerge, model/geometry/FPS/encode trong phép so tương đương; maxActiveItems=1 ở các gói đầu và tối đa một request TTS đang chạy. Cache/scratch riêng, SHA-256 pin, typed IPC, không sửa LICENSE/NOTICE hoặc tệp ngoài phạm vi.

Các block test là phần kiểm tra hành vi cần đặt trong fixture của file được chỉ định; không giả định chúng là test hoàn chỉnh đã có. Mỗi task code: viết regression đỏ → chạy đúng suite → sửa tối thiểu → test xanh + `npm.cmd run typecheck` + `git diff --check` → cập nhật docs liên quan và handoff theo mẫu → commit riêng các file task sau review. Với file test mới, thêm vào danh sách trong `F:/Son/tool/TediaPros/scripts/run-local-runtime-tests.mjs` nếu cần. Không commit logs chứa dữ liệu riêng.


## T01 — Corpus, telemetry và baseline
**Phụ thuộc:** không. **Đầu ra:** benchmark-v1 dùng chung cho T08–T23.
**Files sửa:** `F:/Son/tool/TediaPros/src/main/autoShortTelemetry.ts`, `F:/Son/tool/TediaPros/src/shared/types.ts`, `F:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts`, `F:/Son/tool/TediaPros/tests/autoshort-telemetry.test.ts`.
**Files mới:** `F:/Son/tool/TediaPros/scripts/autoshort-benchmark-main.ts` (adapter gọi luồng app thật), `F:/Son/tool/TediaPros/scripts/summarize-autoshort-benchmark.mjs`, `F:/Son/tool/TediaPros/tests/autoshort-benchmark.test.ts`, `F:/Son/tool/TediaPros/docs/benchmarks/autoshort-optimization-protocol.md`.

- [ ] Chốt schema benchmark, input manifest và ba mode: fixed-output replay, live single-video, live batch. Ghi source/config/runtime hashes, driver/provider, cold/warm/cache, số request/retry/bytes; ghi null khi không lấy được VRAM, không ghi 0 giả.
```ts
// Proposed benchmark record; define in the benchmark script, not a new production IPC.
type BenchmarkV1 = {
  schemaVersion: 1; caseId: string; variant: string; mode: 'replay' | 'live';
  runId: string; e2eMs: number; stageActiveMs: Record<string, number>;
  stageWaitMs: Record<string, number>; peakRamBytes: number | null;
  peakVramBytes: number | null; peakScratchBytes: number;
  quality: 'pass' | 'fail' | 'unverified';
};
```
- [ ] Test fake-clock hai stage overlap 0–100 và 20–80: E2E=100, không 160; missing sample=null; credentials/reference không xuất hiện trong JSON.
- [ ] Gắn stage spans hiện có; chỉ thêm counters thiếu, redaction và sampling bounded. Không log từng frame vô hạn. Xuất summary atomic kể cả cancel/error.
- [ ] Tạo manifest từ video thật được phép dùng; tối thiểu 8 clip + 1 dài, chọn class ở spec. Không giả lập benchmark live khi thiếu server; frozen WAV/cues dùng cho replay và ghi rõ mode.
- [ ] Chạy A/B theo protocol spec, measure instrumentation on/off; output vào thư mục run riêng dưới release-artifacts, summary có thể đưa Git sau redaction. CLI mới bắt buộc manifest/output explicit và live opt-in; không tự dùng API key tìm thấy trên máy.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-telemetry.test autoshort-benchmark.test`. Gate: schema/test/privacy đạt và baseline có n, hash, timings, quality status; không dùng replay latency để dự báo inference live.

## T02 — Tempo, khoảng nghỉ và câu không vừa
**Phụ thuộc:** không; T17 dùng kết quả.
**Files:** `F:/Son/tool/TediaPros/src/main/dubbing/synthesis.ts`, `F:/Son/tool/TediaPros/src/main/dubbing/plan.ts`, `F:/Son/tool/TediaPros/src/main/dubbing/policy.ts`, `F:/Son/tool/TediaPros/src/main/autoShortPolicy.ts`, `F:/Son/tool/TediaPros/tests/dubbing-plan.test.ts`, `F:/Son/tool/TediaPros/scripts/dubbing-tempo-acceptance.mjs`, `F:/Son/tool/TediaPros/docs/adr/005-source-anchored-dubbing-tempo-policy.md`.
**Interface:** giữ DubbingTimingPlan hiện có; validator và synthesis dùng cùng policy. Failure không trả timeline hợp lệ.

- [ ] Đổi regression hiện đang bảo vệ 5s → 1.98s thành yêu cầu không chấp nhận tempo 2.5253x. Thêm boundary 1.45, >1.45, single cue/multi cue, final cue và khoảng nguồn không đủ 0.50s.
- [ ] Trước DSP, tính giới hạn thực; không nới voiceEnd/hardEnd hoặc giảm gap xuống 0.02s để qua validator.
```text
available = nextStart - 0.50 - voiceStart
minimumSpeechDuration = naturalSpeechDuration / 1.45
if minimumSpeechDuration > available:
    bounded rephrase preserving meaning -> remeasure
    if still cannot fit and multi-cue: split at semantic cue boundary
    if single-cue cannot fit: explicit error
```
- [ ] Đối chiếu tên biến/timestamp thật trong planner; giữ raw 1.0x để đo. Không tăng tốc quá trần sau correction chain; tính cumulative tempo và kiểm tra lại duration đo thực.
- [ ] Thêm fixture âm đầu/đuôi nhỏ, kiểm tra không truncate và không mất cue IDs; cập nhật test kỳ vọng đúng policy, ghi lý do đổi behavior. Policy impossible phải có thông báo GUI actionable, không tự đổi nội dung không giới hạn.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs dubbing-plan.test autoshort-tts-pipeline.test`, chạy media acceptance bằng managed FFmpeg. Gate: 0 tempo vượt trần, gap đạt hoặc báo lỗi đúng; human nghe mẫu rephrase dày.

## T03 — Containment và xuất file an toàn
**Phụ thuộc:** không.
**Files:** `F:/Son/tool/TediaPros/src/main/safeContainedPath.ts`, `F:/Son/tool/TediaPros/src/main/ocrMask.ts`, `F:/Son/tool/TediaPros/tests/ocr-mask.test.ts`; mới `F:/Son/tool/TediaPros/tests/safe-contained-path.test.ts`.
**Interface:** giữ public helper hiện có; phát hiện junction/symlink truyền lỗi, chỉ ENOENT cho phép đi lên ancestor.

- [ ] Chuyển repro R2 thành regression có fixture junction trong temp scope và cleanup đúng absolute root. Kiểm thử nested nonexistent ancestor, path absolute/.., junction bên trong/bên ngoài, EACCES và tệp thường.
```ts
// Catch only missing ancestors; never swallow the intentionally raised safety error.
if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
```
- [ ] Tách stat/realpath catch khỏi assertion; xác minh containment của ancestor đã resolve và tên đích, không bỏ kiểm tra sau normalize. Ghi rõ giới hạn TOCTOU; không khẳng định chống mọi thay đổi filesystem đối kháng.
- [ ] Output mới dùng scope đã xác minh, write temp + validate + rename; không overwrite video/tieude cũ. Cache T12 gọi cùng helper.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs safe-contained-path.test ocr-mask.test`. Gate: junction repro bị chặn, các đường Unicode hợp lệ vẫn hoạt động.

## T04 — Lease, child close và shutdown
**Phụ thuộc:** không; chặn T09/T10/T15/T22.
**Files:** `F:/Son/tool/TediaPros/src/main/autoShortResourceManager.ts`, `F:/Son/tool/TediaPros/src/main/autoShortItemScope.ts`, `F:/Son/tool/TediaPros/src/main/processTree.ts`, `F:/Son/tool/TediaPros/src/main/audioPreview.ts`, `F:/Son/tool/TediaPros/src/main/douyin.ts`; tests mới `F:/Son/tool/TediaPros/tests/autoshort-resource-lifecycle.test.ts`.
**Interfaces:** giữ `withLease<T>(resources, signal, action): Promise<T>`; hợp đồng action settle chỉ sau helper close/error. Reuse createAutoShortItemScope.start/drain.

- [ ] Test capacity=1: A giữ deferred; B đợi; abort A; B vẫn chưa bắt đầu; resolve/close A thì B được chạy đúng một lần. Thêm signal đã aborted ngay sau acquire và double-release.
```ts
const lease = await this.acquire(resources, signal);
try {
  if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
  return await action(lease);
} finally {
  lease.release();
}
```
- [ ] Bỏ release-on-abort của lease; audit action adapters OCR/Whisper/STTN/separation để promise không settle sớm. Không chỉ sửa manager rồi để provider treo vô hạn.
- [ ] Dùng processTree registry cho helper audioPreview/Douyin còn spawn ngoài registry. Hủy: yêu cầu dừng → deadline graceful đề xuất 5s → kill tree → chờ close tối đa thêm 10s. Nếu chưa xác minh dừng, đánh dấu resource unavailable, báo lỗi và không cấp slot giả; ghi PID bị kẹt.
- [ ] Test close đến muộn, spawn error, taskkill lỗi + fallback, shutdown với child/grandchild, preview + AutoShort cùng hoạt động. Teardown xong mới cleanup tệp.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-resource-lifecycle.test local-runtime.test sttn-pipeline.test separator-pipeline.test`. Gate: không overlap2 khi capacity1, không orphan helper trong smoke thật; timeout không làm mất primary error.

## T05 — Disk ledger và crash cleanup
**Phụ thuộc:** T04.
**Files:** `F:/Son/tool/TediaPros/src/main/autoShortDiskBudget.ts`, `F:/Son/tool/TediaPros/src/main/autoshort.ts`, `F:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts`; mới `F:/Son/tool/TediaPros/tests/autoshort-disk-budget.test.ts`.
**Interface:** giữ `reserve(volume, remainingBytesToWrite, signal): Promise<DiskReservation>` và update/release idempotent.

- [ ] Repro: trì hoãn getFreeBytes, A reserve100, B reserve100, abort A rồi trả1000; A reject ABORT_ERR, B resolve, không giữ reservation A. Lặp với statfs reject và abort sát grant.
- [ ] Sau mỗi await recheck entry theo ID và signal; không giữ index qua await. Serialize drain tránh grant trùng; tính remaining-bytes theo volume thực, không trừ tổng file đã ghi thêm lần nữa.
```text
await freeBytesProbe
find pending entry by stable ID again
if absent or aborted: do not grant; continue drain
remove that exact entry -> create one reservation -> resolve
```
- [ ] Thử ledger admission cho single-item sau test, giữ STTN rolling headroom khác tổng dung lượng video. Khôi phục sau crash chỉ dọn scope do app sở hữu, không child sống, không file output/cache đang pin.
- [ ] Fault tests ENOSPC giữa encode, volume khác, UNC unavailable, user xóa input, cleanup EBUSY. Không làm đầy ổ thật; dùng adapter + media temp bounded.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-disk-budget.test autoshort-queue-throughput.test sttn-pipeline.test`. Gate: reservation=0 sau teardown, B không treo, output đã hoàn tất được giữ.

## T06 — Kết quả OCR/Douyin phản ánh output thật
**Phụ thuộc:** T03,T04.
**Files:** `F:/Son/tool/TediaPros/src/main/ocr.ts`, `F:/Son/tool/TediaPros/src/main/douyin.ts`, `F:/Son/tool/TediaPros/engines/douyin-engine/cli/progress_display.py`; mới `F:/Son/tool/TediaPros/tests/standalone-engine-results.test.ts`.
**Interface:** OCR không trả ok:true với artifact invalid. Douyin thêm terminal JSON version1 tại điểm kết thúc CLI sau khi xác định entrypoint đang dùng; giữ parser legacy cho binary cũ.

- [ ] OCR test engine done+exit0 nhưng SRT missing/empty/malformed → fail; SRT hợp lệ nhưng conversion lỗi → chỉ fallback tới file gốc đã validate.
- [ ] Douyin trước tiên sửa `outBuf += chunk`; test chunks split, không newline cuối, stderr diagnostic. Structured result đề xuất:
```json
{"type":"result","schemaVersion":1,"total":3,"success":1,"failed":1,"skipped":1,"status":"partial"}
```
- [ ] Engine final error dùng nonzero exit; Main ưu tiên terminal JSON và đối chiếu counts, không suy all-success từ exit0. Old binary không có JSON: legacy parse có giới hạn; unknown giữ unknown thay vì fake0 success.
- [ ] Hủy engine phải drain theo T04; status partial không bị cleanup xóa các file tải thành công.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs standalone-engine-results.test autoshort-ocr-runtime.test`; dùng venv Douyin có dependency chạy CLI/tests phù hợp framework thực tế. Gate không giả thành công; không cần Douyin live để xác minh parser.

## T07 — Verifier package fail closed
**Phụ thuộc:** không.
**Files:** `F:/Son/tool/TediaPros/scripts/verify-packaged-app.mjs`, `F:/Son/tool/TediaPros/tests/release-tooling.test.ts`.
**Interface:** CLI giữ cách gọi hiện tại; exit0 chỉ khi layout app, executable, resources/ASAR và mandatory assets đã được kiểm kê.

- [ ] Fixture root missing/empty/unreadable/truncated ASAR/missing mandatory asset → nonzero. Positive fixture phải giống đúng win-unpacked hoặc mac .app layout được hỗ trợ.
- [ ] Tách lỗi readdir khỏi empty scan; yêu cầu ít nhất một package hợp lệ. Kiểm kê ASAR qua API/tool đang có dependency, không đọc cả archive vào RAM hoặc thêm downloader.
- [ ] Assert:
```ts
assert.notEqual(missingRoot.exitCode, 0);
assert.notEqual(emptyRoot.exitCode, 0);
assert.equal(validPackage.exitCode, 0);
```
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs release-tooling.test`, sau đó verifier trên artifact build riêng. Gate: R9 không tái diễn; metadata-only pass vẫn được gọi đúng tên.

## Gate G1

- [ ] T02–T07 có regression xanh, typecheck xanh, diff review và handoff riêng.
- [ ] T01 baseline phân loại cold/warm/replay/live, không ghi dữ liệu nhạy cảm.
- [ ] Tài liệu architecture/domain được sửa các mô tả không khớp code, đặc biệt thứ tự separation/OCR/Whisper và chính sách tempo.
