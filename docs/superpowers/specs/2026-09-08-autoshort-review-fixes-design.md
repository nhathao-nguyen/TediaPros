# AutoShort Review Fixes — Design

Ngày: 2026-09-08. Trạng thái: **Đã implement F1–F6 và kiểm chứng local; media acceptance với provider/video lỗi gốc còn pending**.

Baseline: `863f55c38822e28046b0f0592c206ca9303aeeb5`, branch `codex/measured-dubbing-first`.
Nguồn yêu cầu: [review F1–F6](/F:/Son/tool/TediaPros/docs/reviews/2026-09-08-multilingual-dubbing-review/REVIEW.md). Kế hoạch thực thi: [implementation plan](/F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-08-autoshort-review-fixes.md).

Bằng chứng hiện tại là `CODE_CONFIRMED` và `TEST_CONFIRMED`: predecessor-dependent group không còn bị split theo lịch tạm; một adapter call sở hữu toàn queue và một lease bao trùm initial/JSON/repair; publication validator không mutate số đo; QA giữ phủ định thật và parse số Hán theo cụm/ngữ cảnh; prompt là `translation-v6` và identity có `speakingDuration`. Chưa có bằng chứng provider/GPU/video lỗi gốc nên không coi là production acceptance.

## 1. Mục tiêu và lựa chọn

Sửa sáu findings đã review, bảo toàn lời thoại và giảm các lần recovery không cần thiết. Mỗi fix phải có regression test kiểm tra hành vi thật của module, không chỉ tìm chuỗi trong source.

| Phương án | Đánh đổi | Quyết định |
|---|---|---|
| Chỉ thêm guard ở các dòng lỗi | Ít code nhưng không giải quyết lịch phụ thuộc predecessor và ownership toàn batch | Không chọn |
| Sửa lịch measured/rescue và ranh giới adapter, giữ pipeline hiện có | Phạm vi vừa đủ cho F1–F6, kiểm thử độc lập được | **Chọn** |
| Viết scheduler model toàn ứng dụng và semantic validator bằng LLM | Phạm vi lớn, thêm provider calls và khó tách hiệu quả từng fix | Ngoài phạm vi |

Không tăng retry/deadline để che lỗi. Không đổi IPC, schema SRT, thuật toán blur hay rate đọc theo suy đoán. QA tiếp tục là heuristic: structural error chặn job; nghi vấn số/phủ định là warning, không tự ý sửa lời.

## 2. Ràng buộc chung

- Trần tempo vật lý `1.45x`; preferred `1.10x`, normal `1.25x`. Không thêm fallback `1.50x/1.55x`.
- Protected gap `0.50s`; early lead tối đa `0.35s` chỉ cho `replace`/`separate-vocals`, bằng `0` khi mix thoại nguồn.
- TTS server dùng `speed: 1`; trim giữ `-50 dB`, onset `0.03s`, offset `0.10s`.
- Không drop cue, không cắt âm đuôi để xuất MP4, không thay source ID/order/start/end.
- Giữ tối đa ba candidate TTS phân biệt cho mỗi unit được rephrase, một pha LLM, batch tối đa tám cue/request measured-overflow, một repair pass missing trong cùng deadline `90_000 ms`.
- Structural replacement tối đa tám lần trên toàn invocation, không reset budget khi split. Child mới ở fallback sau LLM không mở thêm LLM round.
- Giữ cache/PCM trong item scope, cancellation phải drain công việc thật trước khi nhả tài nguyên; không sửa LICENSE/NOTICE.
- Dữ liệu đo audio không được ghi đè chỉ để vượt validation. Không tăng tolerance đang có của phép đối chiếu duration/tempo.

## 3. F1 — Lịch phụ thuộc predecessor và structural split

Giữ measure → batch-rephrase → rescue/finalize, nhưng phân biệt **lịch tạm** và **audio đã được chốt**.

### Measure

1. Tổng hợp/trim original như hiện tại, tái dùng bootstrap/cache.
2. Ghi trạng thái unit `fit`, `overflow` hoặc `deferred`. `deferred` nghĩa là unit có thể fit nếu predecessor đang chờ rescue giải phóng early lead.
3. Khi predecessor chưa chốt, tính thêm cửa sổ optimistic: bỏ giới hạn từ đuôi tạm predecessor, nhưng vẫn giữ source start, early lead cap, hard deadline. Đây chỉ là phép phân loại, không phải lịch có thể xuất.
4. Chỉ split trước LLM khi overflow vẫn tồn tại trong cửa sổ optimistic và mọi child có `dubbingSpeakingDurations > 0` theo cùng protected-gap policy. Đủ số câu dịch/source IDs và thứ tự source là điều kiện bắt buộc. Không dùng riêng `deriveDubbingWindow.availableDuration` để khẳng định child hợp lệ.
5. Unit deferred được giữ nguyên, được đưa vào batch cùng overflow với budget bảo thủ hiện tại để có candidate dự phòng. Không bỏ unit khỏi hàng đợi chỉ vì optimistic fit.

### Batch

Một lần gọi adapter cho toàn queue; không TTS. Adapter tự chunk HTTP. Không sửa plan bằng candidate chưa được đo.

### Rescue và chốt lịch

1. Duyệt **tất cả unit theo thứ tự nguồn**, kể cả unit fit ở measured pass; cập nhật predecessor bằng `voiceEnd` DSP đo thật đã chốt.
2. Tính lại slot với predecessor thật. Thử original đã đo trước: nếu vừa, giữ original và không TTS candidate chỉ vì unit từng được đánh dấu overflow/deferred.
3. Nếu original không vừa, duyệt tối đa ba candidate theo predictor, đo/trim rồi chọn **candidate fit đầu tiên**, không tuyên bố là candidate ngắn nhất toàn bộ.
4. Chạy DSP từ trimmed PCM gốc bằng helper fit hiện tại; tối đa một correction hiện có, không tăng trần. Lưu kết quả chốt gồm path/start/duration/tempo/voiceEnd để unit sau dùng. Finalize chỉ serialize kết quả này, không tự đổi lịch lần nữa.
5. Nếu chưa fit và còn structural replacement budget: kiểm tra split an toàn trên lời hoàn chỉnh giữ source ledger; chỉ đo TTS các child mới trong pha rescue hiện tại. Không đệ quy quay lại toàn pipeline, không LLM tiếp, không synthesize lại các predecessor đã chốt. Child không fit thì kết thúc bằng diagnostic rõ ràng, giữ đầy đủ evidence.
6. Nếu không có split an toàn hoặc candidate đủ điều kiện: báo lỗi policy; không xuất file thành công giả.

Regression chính phải có kết quả như base: A kết thúc `0.5s`, nhóm B giữ `['b1','b2']`, bắt đầu khoảng `1.75862069s`, kết thúc `3s`, tempo `1.45x`; trace không split B và không TTS lại B khi original đã vừa.

## 4. F2 — Adapter sở hữu toàn pha LLM

Giữ chữ ký `DubbingRephraseAdapter.rephraseBatch(requests, signal): Promise<ReadonlyMap<string, readonly string[]>>`.

- Synthesis gọi adapter một lần với toàn queue. Giới hạn tám cue là giới hạn HTTP request, không phải kích thước đối số callback.
- Local adapter tạo một deadline `90_000 ms`, lấy một lease `server-inference`, chạy initial batches và tối đa một pass repair missing bên trong lease đó.
- Cả `fetch`, đọc JSON, parser và đóng/cancel response lỗi đều thuộc callback lease. Không lấy lease lồng trong `requestBatch` vì capacity mặc định bằng một sẽ deadlock.
- Timeout/cancel trong body: chờ action settle rồi mới release. Abort của caller phải propagate; lỗi provider có thể trả partial candidates hợp lệ như contract cũ nhưng không reset deadline hoặc repair budget.
- Drain prefetch TTS trước khi vào batch; không giữ lease LLM trong lúc chờ một TTS đang cần cùng lease.
- Provider Gemini/OpenAI giữ adapter tuần tự hiện có; không bọc một outer lease Local quanh callback vốn tự lấy lease.
- `batchCount` giữ nghĩa số initial chunks tương đương `ceil(queueSize/8)`, không bao repair. `batchCueCount` là số cue đã gửi. `phaseWaitMs` giữ field tương thích nhưng tài liệu gọi đúng là elapsed toàn adapter phase. Log adapter ghi riêng HTTP request/repair count và lease wait nếu cần, không mở rộng IPC.

Cam kết kiểm chứng là độc quyền **trong pha LLM này**. Không tuyên bố triệt tiêu model swap toàn ứng dụng hoặc giữa mọi external consumer.

## 5. F6 — Validation thuần, không sửa duration

- Xóa toàn bộ block “Resilient timeline clamping” sửa `dubbingUnits` trong coordinator.
- Thêm `validateAutoShortPublicationTimeline(units, videoDuration)` trong `autoShortPolicy.ts`: gọi validator timeline hiện có, kiểm tra thêm end audio tính từ `plannedStart + finalDuration` và `plannedEnd` không vượt video; chỉ dung sai số thực `1e-6s` cho kiểm tra EOF. Không đổi các tolerance duration/tempo hiện có.
- Validation không mutation, không FFmpeg, không “sửa” tempo. EOF overshoot `3ms`, `10ms`, `0.3s` đều được chặn với diagnostic EOF trước stitch/burn, thay vì biến thành lỗi tempo giả hoặc cắt tiếng.
- Sai lệch biểu diễn `3ms` giữa end metadata và duration nhưng vẫn nằm trong video và thuộc tolerance cũ được giữ nguyên để validator cũ quyết định. Không đồng nhất drift metadata với WAV thật vượt EOF.
- DSP correction vẫn nằm trong synthesis. Không thêm rescue/export fallback mới ở coordinator.
- Thêm dependency tùy chọn cho synthesis/stitch vào `AutoShortItemCoordinatorDeps` để test coordinator bằng fixture; production mặc định vẫn gọi hàm đang có. Đây là seam nội bộ, không thay IPC.

## 6. F3 — Phủ định và trợ từ nghi vấn

Loại bỏ exemption đối xứng cho cả câu. Tách nhận diện polarity khỏi numeric normalization bằng helper nội bộ mới `contentQuality/negation.ts`.

- `negationTokensForComparison(sourceText, targetText)` trả token phủ định cho hai phía; giữ `NEGATION_WORDS`/script coverage hiện có.
- Chỉ loại đúng token `không/chưa` cuối **mệnh đề nghi vấn** khi có bằng chứng cấu trúc câu hỏi tương ứng; mục tiêu kiểm chứng ban đầu là positive Chinese polar question `吗/嗎` → Vietnamese `có … không?`, `đã … chưa?`, `có thể … được không?`.
- Nguồn có phủ định thật hoặc câu đích có phủ định trước suffix: giữ các token đó. Dấu `?` đơn lẻ, từ `sao`, `hả`, `chăng` không làm miễn toàn câu. Câu ghép/wh-question không rõ cấu trúc giữ warning.
- Chỉ dùng rule đã có fixture đối chiếu. Ngôn ngữ/cấu trúc ngoài tập đã kiểm chứng giữ so sánh conservative hiện có, không thêm LLM để “xác nhận nghĩa”.

## 7. F4 — Số Hán theo cụm và ngữ cảnh

Tách helper `contentQuality/numerals.ts`; bỏ thay chữ Hán từng ký tự và bỏ xóa `第...`.

- `normalizeUnicodeDecimalDigits(text)` giữ NFKC và số Eastern Arabic/Persian/Devanagari/Thai đang có; không đổi chữ Hán.
- `extractContextualNumberTokens(text)` phát token `num:<integer>` hoặc `ordinal:<integer>`, có range span để tránh đếm trùng với parser số/đơn vị hiện tại.
- Hỗ trợ số nguyên chữ Hán `零〇一二两兩三四五六七八九十百千万萬`, chuỗi digit như `二〇二四`, dạng `十二/二十/一百零二/一千零二十/一万零三`, ordinal `第...`. Không thay từng glyph bằng chuỗi `10/100/1000` rồi nối.
- Chỉ xác nhận số trong ngữ cảnh lượng/tần suất/thứ tự: classifier thông dụng `个/個/本/次/只/件/条/條/人/张/張/岁/歲`, unit đang hỗ trợ, ordinal `第`, hoặc cue chỉ có numeral. Loại lexical `一起/一定/一直/一样/一樣/一般/万一/萬一/千万不要/千萬不要`; không coi danh sách loại trừ hữu hạn là bằng chứng hỗ trợ mọi từ Hán.
- Canonical hóa ordinal digits `第3`, `thứ 3`, `3rd`; ordinal words 1–10 trong English/Vietnamese **chỉ ở cấu trúc rõ ràng** (`the third time`, `lần thứ ba`). Trường hợp thứ ba → thứ tư phải warning; thứ ba → thứ ba không warning. Không biến mọi từ `ba/tư/năm` thành số.
- Giữ unit/signed-number behavior hiện có; số ngoài grammar/range an toàn không được parse một phần thành giá trị khác. Dạng không chắc chắn không được gắn nhãn “semantic validated” mới hoặc rewrite nội dung.
- Fixture `第一句` → `translated a` phải đổi thành nội dung dịch tương ứng hoặc kỳ vọng warning. Không sửa production logic để che fixture mất số.

## 8. F5 — Invalidate prompt cũ đúng phạm vi

- Tăng `TRANSLATION_PROMPT_VERSION` từ `translation-v5` lên `translation-v6`; không đổi parser schema hoặc assessment schema chỉ để version cache.
- Giữ bảng rate hiện tại, coi là heuristic. Mọi thay đổi rate/payload sau này phải tăng prompt version; không thêm rate mới trong task fix.
- Checkpoint key cũ không được reuse sang v6. Cùng v6/source/config/model vẫn reuse; không xóa toàn bộ cache. QA của bản dịch reuse phải chạy lại qua validator hiện hành.
- Kiểm tra input identity có `speakingDuration` hay không: bổ sung field này vào canonical cue identity khi có để tránh hai prompt dubbing khác budget cùng key. Omit field khi undefined để không tạo nhiễu cho subtitle input cũ. Video duration vẫn được đưa qua options của coordinator như hiện tại.

## 9. Tài liệu và nghiệm thu

Plan mới là nguồn triển khai fixes; tài liệu cũ được giữ như lịch sử và gắn trạng thái rõ, không sửa review evidence để giả thành test xanh. Khi triển khai, đồng bộ spec multilingual/decoupled, plan cũ, ADR và walkthrough bằng kết quả thật; bỏ soft ceiling 1.55x/gap 0.25 s khỏi yêu cầu active và bỏ tỷ lệ hiệu quả chưa đo.

Hai gate riêng:

1. **Local fixes verified:** regression F1–F6, suite liên quan, typecheck, full local runtime và build pass trên cùng HEAD; lưu commands/logs. Đây chưa phải nghiệm thu server thật.
2. **Media acceptance:** có video lỗi gốc hoặc fixture media tái tạo được, local provider/voice/model được ghi nhận, kiểm tra request/phase/lease, cue ledger và MP4; nghe các cue rescue, kiểm tra phủ định/số bằng nội dung nguồn. Chưa có media hoặc server thì gate này giữ `pending`, không làm chậm việc sửa và kiểm thử local.

Không có quyết định sản phẩm còn thiếu để viết plan. Việc triển khai production code là bước tiếp theo sau yêu cầu planning hiện tại.
