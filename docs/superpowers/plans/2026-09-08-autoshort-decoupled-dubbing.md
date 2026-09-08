# AutoShort Decoupled Dubbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tách AutoShort dubbing thành measured TTS pass, batch rephrase pass và measured rescue pass để Local AI Server không bị đổi model qua lại theo từng cue, trong khi vẫn giữ nguyên nghĩa, source anchor, protected gap `0.50s` và trần tempo vật lý `1.45x`.

**Architecture:** `synthesizeDubbingPlan()` đo và trim toàn bộ plan trước, ghi các cue tràn vào một overflow queue sau khi đã thử structural split ở ranh giới source. Queue được chuyển một lần qua `DubbingRephraseAdapter`; chỉ các candidate hợp lệ mới đi qua TTS/trim rescue. Finalization, tempo DSP, subtitle segments và validation chạy sau rescue trên cùng source ledger. AutoShort cung cấp adapter dùng `rephraseDubbingCues()`; Local provider gửi batch tối đa 8 cue/request, provider ngoài Local giữ semantics tuần tự.

**Tech Stack:** TypeScript, Electron main process, Node `fetch`, FFmpeg audio adapters, Local/Gemini/OpenAI translation providers, `node:test` local-runtime suites.

**Spec:** [docs/superpowers/specs/2026-09-08-autoshort-decoupled-dubbing-design.md](../specs/2026-09-08-autoshort-decoupled-dubbing-design.md)

## Global Constraints

- Chỉ sửa đường chạy AutoShort có TTS và các test/docs liên quan; không thay đổi IPC, SRT format, provider API public hoặc format cache.
- Không đặt character cap cứng vào translation prompt; giữ `speaking_duration_seconds`, `target_natural_seconds` và `hard_max_natural_seconds` hiện có làm hướng dẫn mềm có kiểm chứng bằng WAV thật.
- Không vượt `AUTO_SHORT_TTS_HARD_MAX_TEMPO` (`1.45x`), không cắt audio, không bỏ cue và không dùng candidate chưa qua completeness validation.
- Structural split luôn xảy ra trước batch LLM. Khi split, bỏ queue của plan cha và chạy lại measured pass với plan con.
- Mọi request TTS, audio DSP và LLM đều dùng cùng `AbortSignal`; cancellation không được trả về plan một phần.
- Không stage hoặc xóa các artifact audit/untracked hiện có ngoài các file được liệt kê trong từng task.
- Mỗi task phải chạy test đỏ trước khi sửa production code, sau đó test xanh, rồi mới refactor; sau mọi thay đổi dùng `git diff --check`.

---

## Task 1: Chốt contract và refactor synthesis thành ba pha

**Files:**

- Modify `src/main/dubbing/synthesis.ts`.
- Modify `tests/dubbing-plan.test.ts`.
- Modify `tests/dubbing-grouping.test.ts`.
- Modify `tests/autoshort-tts-pipeline.test.ts`.

### Red

- [ ] Thêm test cho plan không overflow: `rephraseBatch` không được gọi, `batchCount`, `overflowCount` và `rescueAttemptCount` bằng `0`, toàn bộ cue được đo một lần và finalization vẫn pass.
- [ ] Thêm test với 10 cue overflow: trace phải cho thấy tất cả TTS/trim của measured pass hoàn tất trước LLM; adapter nhận hai batch ID theo thứ tự `[8, 2]`; không có TTS candidate nào chạy trong lúc batch đang xử lý.
- [ ] Thêm test với response có candidate cho một phần queue: chỉ cue có candidate mới được TTS rescue; cue thiếu candidate giữ audio/text gốc và kết thúc bằng diagnostic hard ceiling rõ ràng nếu vẫn overflow.
- [ ] Thêm test candidate rescue: candidate được trim và đo thật, chọn candidate ngắn nhất vẫn fit, candidate dài hơn không thay thế clip gốc; `rephraseCount`, `rescueAttemptCount` và `rescueAcceptedCount` phản ánh đúng.
- [ ] Giữ và mở rộng regression structural split: grouped overflow phải gọi `onStructuralSplit` trước `rephraseBatch`, child plan giữ đủ `sourceCueIds`, không tạo batch cho plan cha.
- [ ] Thêm cancellation assertions cho measure, batch và rescue: promise reject theo signal và không trả `DubbingSynthesisResult` một phần.

Chạy bước đỏ:

```powershell
node scripts/run-local-runtime-tests.mjs dubbing-plan.test
node scripts/run-local-runtime-tests.mjs dubbing-grouping.test
node scripts/run-local-runtime-tests.mjs autoshort-tts-pipeline.test
```

Expected: các test mới fail vì contract `rephraseBatch`/metrics và thứ tự phase chưa tồn tại.

### Green

- [ ] Export trong `src/main/dubbing/synthesis.ts` các kiểu `DubbingPhase = 'measure' | 'batch-rephrase' | 'rescue' | 'finalize'`, `DubbingOverflowRequest` và `DubbingRephraseAdapter` theo spec; `DubbingOverflowRequest` phải có `cueId`, `currentText`, `sourceText`, `targetDuration`, `measuredDuration`, `maxDuration`, `contextBefore`, `contextAfter`.
- [ ] Đổi `DubbingSynthesisInput` sang `rephraseBatch?: DubbingRephraseAdapter`; event `onRephrase` nhận phase `batch` hoặc `rescue`, `batchSize`, candidate count và số đo trước/sau; `onProgress` nhận thêm phase.
- [ ] Bổ sung metrics `overflowCount`, `batchCount`, `batchCueCount`, `rescueAttemptCount`, `rescueAcceptedCount`, `phaseWaitMs`, vẫn giữ toàn bộ metrics cũ để manifest hiện tại không mất field.
- [ ] Tách vòng xử lý hiện tại thành các helper có trách nhiệm rõ ràng: measured preparation/slot ledger, tạo overflow request, rank candidate, rescue measured audio và finalization. Measured pass chỉ gọi TTS ở `speed: 1`, trim và cập nhật predictor; tuyệt đối không gọi LLM.
- [ ] Trong measured pass, nếu grouped unit tràn và `buildStructuralSplitPlan()` tạo được plan con thì ném `DubbingStructuralSplitRequired` trước khi queue; giữ giới hạn `MAX_STRUCTURAL_SPLIT_DEPTH` và recursive retry hiện có.
- [ ] Với cue không split được và tràn hard max, ghi một overflow request; sau khi toàn bộ measured pass kết thúc, gọi `rephraseBatch` đúng một lần nếu queue không rỗng. Adapter lỗi hoặc trả map rỗng không được làm mất `PreparedCue` gốc.
- [ ] Chỉ rank tối đa ba candidate khác text gốc, loại label/prose không hợp lệ, đo/trim candidate tuần tự ở rescue, kiểm tra completeness và slot thật; chỉ candidate cải thiện và fit ở tối đa `1.45x` mới được nhận.
- [ ] Chạy finalization chung sau rescue: áp tempo một lần từ trimmed PCM, retry DSP overshoot từ PCM gốc, kiểm tra deadline/hard ceiling, tạo subtitle segments/clips, validate và trả kết quả đầy đủ.
- [ ] Dọn pending prefetch khi structural split/cancel; prefetch (nếu policy bật) chỉ thuộc measured pass và không được khởi động candidate rescue.

Chạy bước xanh:

```powershell
node scripts/run-local-runtime-tests.mjs dubbing-plan.test
node scripts/run-local-runtime-tests.mjs dubbing-grouping.test
node scripts/run-local-runtime-tests.mjs autoshort-tts-pipeline.test
```

Expected: ba suite pass, bao gồm thứ tự measured → batch-rephrase → rescue và hard ceiling.

### Refactor

- [ ] Xóa nhánh `input.rephrase` gọi ngay bên trong vòng lặp cue; không để lại đường tắt LLM xen kẽ trong measured pass.
- [ ] Gom logic tính `measuredSpeechSlot`, completeness và tempo thành helper dùng chung để candidate gốc/candidate rescue không có quy tắc khác nhau.
- [ ] Cập nhật fixture/test helper sang `rephraseBatch`, kiểm tra `git diff --check`, rồi chạy lại ba suite trên.

## Task 2: Nối batch rephrase vào Local provider với contract ID chặt

**Files:**

- Modify `src/main/autoshort.ts`.
- Modify `tests/translation-rephrase.test.ts`.
- Modify `tests/translation-prompts.test.ts`.

### Red

- [ ] Thêm test `rephraseDubbingCues()` với 9 request: Local fetch phải nhận batch `[8, 1]`, không phải một request chứa toàn bộ queue.
- [ ] Thêm assertion request JSON chứa `measured_natural_seconds`, `target_duration_seconds`, `hard_max_natural_seconds`, `source_text`, `current_text` và context cho từng cue.
- [ ] Thêm test partial/invalid response: candidate hợp lệ giữ nguyên theo exact cue ID; unknown ID, duplicate label, continuation/prose, truncated response và cue thiếu không được đưa vào map; repair chỉ gửi cue thiếu theo batch tối đa 8.
- [ ] Thêm test Local batch dùng một lease `server-inference` tuần tự và abort trong lúc batch/repair không gửi request tiếp theo.

Chạy bước đỏ:

```powershell
node scripts/run-local-runtime-tests.mjs translation-rephrase.test
node scripts/run-local-runtime-tests.mjs translation-prompts.test
```

Expected: test giới hạn batch và timing fields fail vì implementation hiện gửi request đầu tiên với toàn bộ `requests` và chưa truyền timing vào batch.

### Green

- [ ] Mở rộng `DubbingRephraseRequest` trong `src/main/autoshort.ts` với `measuredDuration` và `maxDuration`; giữ `targetDuration`, source/context và exact `cueId`.
- [ ] Sửa `rephraseDubbingCues()` để chunk request ban đầu thành từng nhóm tối đa 8, chạy tuần tự trong một `withLease(['server-inference'], ...)`, và repair từng nhóm missing tối đa 8 trong cùng deadline/AbortSignal.
- [ ] Đưa measured/max duration vào `buildRephraseMessages()`; không sửa character cap hay semantics của translation prompt. Các test prompt phải tiếp tục chứng minh budget dịch là hướng dẫn mềm.
- [ ] Giữ candidate hợp lệ từng ID ngay cả khi batch có lỗi khác; không ghi candidate vào duration predictor ở pha batch; log diagnostics `phase=batch-rephrase`, `batchSize`, `usableCandidates`, `invalid-candidate`/`repair-missing`.
- [ ] Giữ provider Gemini/OpenAI tuần tự qua `rephraseDubbingCue()` nhưng truyền timing/source/context mới để cùng contract; không đổi endpoint/provider API.

Chạy bước xanh:

```powershell
node scripts/run-local-runtime-tests.mjs translation-rephrase.test
node scripts/run-local-runtime-tests.mjs translation-prompts.test
```

Expected: parser, partial repair, exact IDs, timing fields, chunking và cancellation đều pass.

### Refactor

- [ ] Tách helper chunk/parse/repair để Local và provider ngoài Local chia sẻ `DubbingRephraseRequest` mà không lặp logic.
- [ ] Đổi log cũ `phase=preflight` của đường batch dùng cho measured overflow thành `phase=batch-rephrase`; giữ log legacy preflight của `legacySynthesizeVoice()` chỉ khi đường đó còn được gọi.
- [ ] Chạy `git diff --check` và hai suite translation sau refactor.

## Task 3: Kết nối active AutoShort, tiến độ và manifest metrics

**Files:**

- Modify `src/main/autoshort.ts`.
- Modify `src/main/autoShortItemCoordinator.ts`.
- Modify `tests/autoshort-tts-pipeline.test.ts`.
- Modify `tests/local-runtime.test.ts` only if source-contract assertions require updated phase/metric names.

### Red

- [ ] Thêm test wiring kiểm tra `synthesizeVoice()` truyền một `rephraseBatch` adapter lấy context/source từ plan và không còn truyền callback per-cue vào `synthesizeDubbingPlan()`.
- [ ] Thêm test progress/log contract: measured, batch-rephrase và rescue phát message phase tương ứng; queue rỗng không phát batch message.
- [ ] Thêm test serialization `tts-timeline.json`: metrics mới xuất hiện cùng metrics cũ và legacy result path vẫn có giá trị `0` hợp lệ.

Chạy bước đỏ:

```powershell
node scripts/run-local-runtime-tests.mjs autoshort-tts-pipeline.test
node scripts/run-local-runtime-tests.mjs local-runtime.test
```

Expected: active wiring và manifest field assertions fail trước khi adapter/metrics được nối.

### Green

- [ ] Trong active `synthesizeVoice()`, truyền `rephraseBatch: (requests, signal) => rephraseDubbingCues(config, requests, language, detectedLanguage, signal)`; xóa callback `rephrase` per-cue khỏi object input.
- [ ] Map `onRephrase`/`onProgress` sang log và `emitProgress()` với các phase `measure`, `batch-rephrase`, `rescue`, `finalize`; nội dung hiển thị phải phân biệt số cue/batch và không gọi batch khi overflow queue rỗng.
- [ ] Bổ sung các metrics mới vào return type của active `synthesizeVoice()`, fallback `legacySynthesizeVoice()` với `0`, và manifest `tts-timeline.json` trong `src/main/autoShortItemCoordinator.ts`.
- [ ] Cập nhật diagnostic mapping để phân biệt `measured-overflow`, `batch-rephrase`, `rescue-accepted`, `rescue-improved-overflow`, `no-candidate`, `invalid-candidate`, `hard-ceiling`; giữ `rephraseAttempted`/`rephraseCount` tương thích.
- [ ] Đảm bảo artifact/cache paths cho candidate vẫn nằm trong item scope và candidate raw/trim tạm được dọn sau finalization/cancel theo scope hiện có.

Chạy bước xanh:

```powershell
node scripts/run-local-runtime-tests.mjs autoshort-tts-pipeline.test
node scripts/run-local-runtime-tests.mjs local-runtime.test
```

Expected: active path, progress, diagnostics, legacy compatibility và manifest serialization pass.

### Refactor

- [ ] Xóa hoặc chuyển mọi message active còn mô tả “mỗi cue rephrase ngay khi tràn” sang thứ tự phase mới; không thay đổi text của legacy path ngoài log cần thiết.
- [ ] Kiểm tra `rg -n "input\.rephrase|phase=preflight" src/main tests` chỉ còn kết quả đã được xác định là legacy/test parser, không còn active measured path.
- [ ] Chạy `git diff --check` và hai suite wiring sau refactor.

## Task 4: Cập nhật ADR/task handoff và xác minh toàn repo

**Files:**

- Modify `docs/adr/005-source-anchored-dubbing-tempo-policy.md`.
- Modify `docs/superpowers/specs/2026-09-08-autoshort-decoupled-dubbing-design.md`.
- Create `.ai/tasks/2026-09-08-autoshort-decoupled-dubbing.md` using `.ai/tasks/TASK_TEMPLATE.md`.

### Documentation

- [ ] Ghi trong ADR 005 thứ tự ba phase, structural split trước batch, Local batch tối đa 8, rescue đo thật và hard ceiling `1.45x`; không ghi kế hoạch chưa thực hiện thành evidence.
- [ ] Cập nhật spec từ “sẵn sàng lập plan” sang trạng thái implementation đã kiểm chứng sau khi các test cuối pass; giữ rõ ranh giới media acceptance và local test evidence.
- [ ] Tạo task handoff ghi phạm vi, files changed, test commands, metrics/log contract, known limitation rằng TTS server thật chưa được xác nhận trong môi trường offline.

## Task 5: Chạy kiểm thử bắt buộc và build

**Files:**

- No source changes expected; chỉ tạo output build theo script hiện có.

- [ ] Chạy targeted suites sau khi mọi task hoàn tất:

```powershell
node scripts/run-local-runtime-tests.mjs dubbing-plan.test
node scripts/run-local-runtime-tests.mjs dubbing-grouping.test
node scripts/run-local-runtime-tests.mjs translation-rephrase.test
node scripts/run-local-runtime-tests.mjs translation-prompts.test
node scripts/run-local-runtime-tests.mjs autoshort-tts-pipeline.test
```

- [ ] Chạy bắt buộc typecheck:

```powershell
cmd.exe /d /c "npm.cmd run typecheck"
```

Expected: node và web typecheck đều exit code `0`.

- [ ] Chạy full local runtime suite:

```powershell
cmd.exe /d /c "npm.cmd run test:local-runtime"
```

Expected: toàn bộ suite exit code `0`, không có failure hoặc unhandled rejection.

- [ ] Chạy build:

```powershell
cmd.exe /d /c "npm.cmd run build"
```

Expected: Electron/Vite build tạo artifact thành công; không coi build thành bằng chứng TTS server thật.

- [ ] Chạy `git diff --check`, kiểm tra `git status --short`, và chỉ stage các file trong plan; không stage các artifact audit pre-existing.
- [ ] Ghi kết quả thực tế vào task handoff, phân biệt `TEST_CONFIRMED`, `CODE_CONFIRMED`, `DOCUMENTED_ONLY` và `UNKNOWN`.

## Dependency Order

1. Task 1 phải hoàn tất trước Task 3 vì active AutoShort cần synthesis contract mới.
2. Task 2 có thể viết song song với Task 1 nhưng phải hoàn tất trước bước wiring Task 3.
3. Task 4 chỉ cập nhật evidence sau khi Task 1–3 pass.
4. Task 5 chạy sau Task 1–4; nếu test fail thì quay lại task chứa regression, sửa rồi chạy lại từ targeted suite đến full suite.

## Final Acceptance Checklist

- [ ] Không còn LLM rescue xen kẽ trong measured cue loop của active Local path.
- [ ] Log có thứ tự `phase=measure` → `phase=batch-rephrase` (chỉ khi cần) → `phase=rescue`.
- [ ] Batch Local tối đa 8 cue, exact IDs, partial repair bounded và không gọi TTS trong batch.
- [ ] Structural split xảy ra trước batch; source ledger/IDs/subtitles validate pass.
- [ ] Không candidate nào vượt `1.45x`; cue không fit báo lỗi rõ ràng và không bị cắt/bỏ.
- [ ] Targeted tests, typecheck, full local-runtime và build đều pass với bằng chứng lệnh thực tế.
