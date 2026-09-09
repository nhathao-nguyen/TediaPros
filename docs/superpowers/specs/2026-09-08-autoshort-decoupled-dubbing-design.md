# AutoShort Decoupled Dubbing Design

Ngày: 2026-09-08
Trạng thái: Đã kiểm chứng local; media acceptance pending
Phạm vi: `src/main/dubbing/` và đường chạy AutoShort có TTS

Đính chính 2026-09-08: synthesis gọi adapter một lần với toàn overflow queue; Local adapter chia HTTP request tối đa 8 cue và giữ một `server-inference` lease tới khi đọc xong response/repair. Candidate được thử tuần tự theo thứ tự xếp hạng và nhận candidate đầu tiên có audio đo thật vừa trần, không claim đã đo mọi candidate để tìm bản ngắn nhất toàn cục. Chi tiết fix sau review nằm tại [review-fixes design](/F:/Son/tool/TediaPros/docs/superpowers/specs/2026-09-08-autoshort-review-fixes-design.md).

## Mục tiêu

Tách việc tổng hợp TTS và rephrase LLM thành ba pha tuần tự để Local AI Server không phải đổi model qua lại cho từng cue tràn thời lượng, đồng thời giữ nguyên source ledger, protected gap `0.50s`, trần tempo vật lý `1.45x` và toàn bộ lời thoại.

## Bối cảnh đã xác nhận trong code

- `synthesizeDubbingPlan()` hiện vừa tổng hợp/trim từng cue vừa gọi `input.rephrase()` ngay trong vòng lặp cue. Đây là rescue xen kẽ.
- `rephraseDubbingCue()` thực hiện một request Local cho một cue; `rephraseDubbingCues()` đã tồn tại nhưng chưa được nối vào đường chạy measured-first hiện tại.
- Structural split hiện đã có trong `synthesizeDubbingPlan()`: một grouped unit chỉ được tách sau khi WAV thật tràn, tại ranh giới source cue và câu dịch hoàn chỉnh.
- Pha dịch đã truyền `speaking_duration_seconds`, `target_natural_seconds` và `hard_max_natural_seconds` trong `src/main/translation/prompts.ts`. Thiết kế này không thêm character cap cứng và không dùng budget để cắt nghĩa.
- `DubbingTtsAdapter` và `DubbingAudioAdapter` đã tách API cache/TTS khỏi xử lý trim/tempo, nên có thể dùng lại trong ba pha.

## Phạm vi và không thuộc phạm vi

Trong phạm vi:

1. Refactor synthesis thành measured pass, batch rephrase và measured rescue pass.
2. Nối batch rephrase có ID chính xác vào Local provider.
3. Giữ structural split trước batch rephrase.
4. Cập nhật telemetry, tiến độ và diagnostics để phân biệt ba pha.
5. Thêm regression tests cho không-overflow, nhiều overflow, partial response, split và hard ceiling.

Không thuộc phạm vi:

- Không tăng tempo ceiling, không cắt âm thanh, không bỏ cue.
- Không thay đổi API IPC hoặc format SRT.
- Không thêm giới hạn ký tự cứng vào prompt dịch.
- Không thay đổi hành vi provider Gemini/OpenAI ngoài việc dùng chung abstraction; Local là provider được tối ưu batch.
- Không xử lý việc khởi động/restart tiến trình TTS Server bên ngoài app.

## Thiết kế được chọn

### Pha 1: measured TTS pass

`Synthesis` tạo một bản clone của plan và tổng hợp/trim từng cue ở tốc độ server `1.0`. Mỗi cue tạo `PreparedCue` gồm text thực sự đọc, raw path, trimmed path, natural duration và voice.

Với mỗi cue:

1. Tính slot từ source anchor, early lead được phép và protected gap.
2. Nếu grouped unit tràn ở WAV thật và đủ câu hoàn chỉnh, phát structural split rồi chạy lại measured pass với plan con. Không gọi LLM.
3. Nếu cue đơn hoặc grouped unit không thể split an toàn, ghi một `DubbingOverflowRequest` vào overflow queue thay vì rephrase ngay.
4. Nếu cue fit, giữ clip đã đo và chưa sửa text.

Pha này vẫn cập nhật `DurationPredictor` bằng audio gốc đã đo để telemetry và pace planning có dữ liệu thật. Predictor chỉ xếp hạng candidate ở pha sau; không được tự sửa text.

### Pha 2: batch LLM rephrase

Nếu overflow queue rỗng, bỏ qua hoàn toàn pha này.

Nếu có overflow:

- Local provider gom request theo batch tối đa 8 cue mỗi request, dùng một lease `server-inference` cho toàn bộ batch tuần tự.
- Mỗi record gửi `cueId`, `sourceText`, `currentText`, context lân cận, `measuredDuration`, `targetDuration` và `maxDuration`.
- Response phải dùng đúng nhãn `[cue-id:1..3]`; ID lạ, nhãn trùng, prose ngoài contract, response bị cắt hoặc cue thiếu đều không được dùng.
- Candidate được giữ theo cue trong `Map<string, string[]>`; candidate không hợp lệ không làm mất bản dịch hiện tại.
- Provider ngoài Local giữ adapter tuần tự hiện có để không thay đổi semantics/API trong phạm vi này.

Batch phase không gọi TTS và không ghi candidate vào duration profile.

### Pha 3: measured TTS rescue

Chỉ các overflow record có candidate hợp lệ mới được tổng hợp lại. Candidate được đo/trim tuần tự, kiểm tra completeness và nhận candidate đầu tiên vừa slot ở tempo tối đa `1.45x`; nếu không candidate nào fit thì giữ diagnostic overflow và kết thúc bằng lỗi rõ ràng.

Sau khi rescue hoàn tất, synthesis chạy bước finalization chung cho tất cả cue:

- áp tempo một lần từ trimmed PCM gốc;
- kiểm tra overshoot DSP và hard deadline;
- tạo subtitle segments từ `finalSpokenText`;
- tạo clips, metrics và output plan;
- validate plan trước khi trả kết quả.

## Interfaces dự kiến

`DubbingSynthesisInput` bổ sung một adapter batch thay cho callback rephrase đơn lẻ:

```ts
interface DubbingOverflowRequest {
  cueId: string
  currentText: string
  sourceText?: string
  targetDuration: number
  measuredDuration: number
  maxDuration: number
  contextBefore: string[]
  contextAfter: string[]
}

interface DubbingRephraseAdapter {
  rephraseBatch(
    requests: readonly DubbingOverflowRequest[],
    signal: AbortSignal
  ): Promise<ReadonlyMap<string, readonly string[]>>
}
```

`synthesizeDubbingPlan()` giữ callback `onRephrase` nhưng đổi phase thành `batch` hoặc `rescue`; event phải ghi `batchSize`, candidate count và measured result. `onStructuralSplit` giữ nguyên semantics hiện có.

## Cache, hủy và lỗi

- Audio gốc fit được giữ lại; candidate rescue dùng cache key chứa text cuối, model, voice, reference audio và revision như hiện tại.
- Hủy job phải abort request LLM, drain mọi branch TTS đang chờ và không xuất plan một phần.
- Lỗi batch LLM không được làm mất audio gốc. Cue overflow không có candidate hợp lệ sẽ báo lỗi policy, không fallback sang tempo > `1.45x`.
- Structural split bị giới hạn độ sâu hiện tại; nếu không thể tạo plan con thì cue đi vào overflow queue hoặc lỗi đơn cue.
- Diagnostics phải phân biệt `measured-overflow`, `batch-rephrase`, `rescue-accepted`, `rescue-improved-overflow`, `no-candidate`, `invalid-candidate` và `hard-ceiling`.

## Tiến độ và telemetry

AutoShort vẫn phát `generating_tts`, nhưng message phải nêu pha:

- `Đo voice 12/32 (phase=measure)`;
- `Rút gọn 3 cue quá dài (phase=batch-rephrase)`;
- `Đo lại voice 2/3 (phase=rescue)`.

Metrics bổ sung `overflowCount`, `batchCount`, `batchCueCount`, `rescueAttemptCount`, `rescueAcceptedCount` và `phaseWaitMs`. Các metrics cũ (`rephraseCount`, `fitFirstPassRatio`, tempo metrics) vẫn giữ để tương thích manifest.

## Kiểm thử và tiêu chí chấp nhận

1. Một plan không overflow không gọi rephrase adapter và không tạo batch.
2. Nhiều overflow gọi batch theo giới hạn 8 cue, giữ đúng ID và không gọi TTS trong pha batch.
3. Partial/invalid batch response chỉ bỏ candidate lỗi, không thay text gốc của cue khác.
4. Grouped measured overflow structural-split trước khi batch; child plan vẫn giữ đủ source IDs và validate pass.
5. Candidate rescue được TTS/trim lại, chọn bản fit ngắn nhất; candidate dài hơn không ghi đè audio gốc.
6. Cue đơn không fit ở `1.45x` vẫn reject với diagnostic rõ ràng.
7. Cancellation trong pha measure, batch và rescue đều không xuất plan một phần.
8. Chạy `dubbing-plan.test`, `dubbing-grouping.test`, `translation-rephrase.test`, `autoshort-tts-pipeline.test`, typecheck và full local runtime suite.

## Rủi ro và cách giảm thiểu

- **Tăng dùng đĩa:** Pha 1 giữ nhiều WAV hơn trước khi finalization. Dùng item scope hiện có, cache TTL/path hiện có và dọn raw candidate sau finalization.
- **Batch response lớn hoặc bị cắt:** Giới hạn 8 cue, repair chỉ cho ID thiếu trong cùng batch budget; cue vẫn giữ text/audio gốc khi repair thất bại.
- **Structural split làm tổng hợp lại cue đã đo:** ưu tiên cache TTS/trim; không dùng lại clip có source window không còn tương thích.
- **Provider ngoài Local khác semantics:** chỉ Local dùng batch ở đợt đầu; giữ adapter tuần tự và cùng contract candidate.

## Điều kiện hoàn thành

- Không còn gọi LLM rescue xen kẽ trong vòng lặp TTS của Local path.
- Log runtime cho thấy thứ tự `phase=measure` → `phase=batch-rephrase` (chỉ khi cần) → `phase=rescue`.
- Tất cả test liên quan và typecheck pass.
- Media acceptance chỉ được ghi nhận khi server TTS thật hoạt động và có log cho cả overflow batch/rescue; test local không được ghi thành bằng chứng provider thật.
