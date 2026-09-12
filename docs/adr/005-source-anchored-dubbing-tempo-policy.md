# ADR 005: Chính Sách Điều Chỉnh Nhịp Độ Lồng Tiếng Neo Theo Bản Gốc (Source-Anchored Dubbing Tempo Policy)

- **Trạng thái:** Đã chấp thuận (Accepted)
- **Ngày quyết định:** 2026-08-30
- **Tác giả:** Kiến trúc sư TediaPros

- **Điều chỉnh tạm thời theo yêu cầu người dùng 2026-09-08:** Nâng hard ceiling từ `1.45x` lên `1.80x`. Preferred/normal pace vẫn là `1.10x`/`1.25x`; chỉ tăng thêm khi cần fit. Các hằng số runtime, prompt dịch (`translation-v7`) và thông báo lỗi dùng cùng trần mới. Đây là thay đổi chính sách cho phép tăng tốc, chưa phải bằng chứng chất lượng nghe ở `1.80x`.

- **Bổ sung 2026-09-08:** Publication dùng số đo WAV/DSP làm bằng chứng bất biến và fail trước stitch nếu audio vượt EOF; không clamp `plannedEnd`/`finalDuration` sau synthesis. Pha rephrase dùng một adapter call cho toàn queue, Local adapter chia request tối đa 8 cue dưới cùng một lease. Translation prompt `translation-v7`; checkpoint identity phân biệt `speakingDuration`.
- **Bổ sung 2026-09-08:** Khi một candidate đã rút ngắn nhưng vẫn bị cue trước chiếm khoảng bảo vệ, finalization được phép reflow cue trước bằng DSP trong trần `1.80x`, cập nhật lại audio và subtitle của cue trước, rồi đo lại cue hiện tại. Khoảng bảo vệ `0.50s`, source anchor và toàn vẹn lời vẫn bắt buộc; nếu cue trước cũng không thể rút đủ thì giữ lỗi policy thay vì cắt lời.

---

## Bối Cảnh (Context)

Trong bài toán lồng tiếng tự động cho video ngắn (AutoShort Dubbing), câu dịch (ví dụ: Tiếng Trung dịch sang Tiếng Việt) thường có số âm tiết dài hơn câu gốc từ 15% đến 40%.
Nếu xử lý ngây thơ:
- **Tăng tốc mù quáng (Blind Time-Stretching):** Ép tempo lên 1.7x – 2.5x làm giọng đọc bị méo mó, the thé, giống tiếng sóc chuột và không thể nghe hiểu.
- **Giữ nguyên thời lượng:** Khiến âm thanh câu trước đè lên âm thanh câu sau, tạo mớ hỗn độn (audio collision) hoặc làm lệch pha hoàn toàn hình ảnh - âm thanh (drift).
- **Nuốt chữ / Bỏ câu (Silent Dropping):** Tự ý ngắt âm thanh khi hết thời lượng làm mất thông tin quan trọng của video.

---

## Quyết Định (Decision)

Áp dụng chính sách **Neo theo nhịp thoại gốc với các ràng buộc vật lý nghiêm ngặt** ([src/main/autoShortPolicy.ts](file:///f:/Son/tool/TediaPros/src/main/autoShortPolicy.ts) và [src/main/dubbing/policy.ts](file:///f:/Son/tool/TediaPros/src/main/dubbing/policy.ts)):
1. **Thiết lập trần nhịp độ (Tempo Bounds):**
   - *Preferred Max:* `1.10x`
   - *Normal Max:* `1.25x`
   - *Hard Ceiling:* `1.80x` (Mức tạm thời theo yêu cầu người dùng ngày 2026-09-08).
2. **Khoảng đệm bảo vệ (Protected Silence Gap):**
   - Duy trì tối thiểu `0.50s` khoảng lặng tự nhiên trước câu tiếp theo để tai người kịp nghỉ ngơi và tiếp nhận thông tin.
   - Phân biệt với **guard cuối video `0.12s`**: khi không còn cue tiếp theo,
     cửa sổ thoại kết thúc tại `videoDuration - 0.12`. Translation budget và
     measured synthesis cùng dùng `deriveDubbingWindow()`, không trừ thêm
     `0.50s` ở EOF. Fixture kiểm thử overflow phải tính từ cửa sổ này, không
     nhầm duration nguồn của cue với toàn bộ thời gian còn được phép đọc.
3. **Cắt tỉa khoảng lặng vật lý (Calibrated Silence Trimming):**
   - Sử dụng bộ lọc phát hiện âm thanh ở ngưỡng `-50 dB` với độ trễ bắt đầu `30ms` và độ trễ kết thúc `100ms` để loại bỏ phần thừa của tệp TTS sinh ra mà không làm mòn âm đầu/âm cuối.
4. **Cấp khe thoại đo được thay vì nuốt chữ (Measured Speech Slot vs. Silent Drop):**
   - `sourceStart`, `sourceEnd` và thứ tự source cue là ledger bất biến. Với chế độ thay thế audio hoặc tách thoại, nếu audio đo được chỉ thiếu một phần nhỏ để fit, lời đọc được bắt đầu sớm tối đa `0.35s` trong khoảng lặng dẫn đã xác minh. Cách này không làm thay đổi deadline của cue kế tiếp và vẫn giữ khoảng lặng bảo vệ `0.50s`.
   - Chế độ trộn với audio nguồn không được mượn khoảng lặng dẫn để tránh chồng tiếng nguồn. Start của phụ đề và clip luôn dùng start đã lập lịch, còn mốc nguồn vẫn được lưu riêng để kiểm tra.
5. **Quy tắc phân tách ngữ nghĩa thay vì nuốt chữ (Semantic Splitting vs. No Silent Drop):**
   - Khi câu thoại dài không thể nhét vừa ở mức tempo `1.80x`:
     - Nếu WAV đo được thuộc nhóm nhiều cues và lời đích có đủ câu hoàn chỉnh tương ứng: Tự động tách tại ranh giới source cue, sau đó tổng hợp lại từng phần trong cửa sổ riêng. Fallback này được giới hạn theo độ sâu và chỉ chạy sau lần đo thật, không dựa vào predictor để rewrite lời.
     - Nếu chỉ có 1 cue: Báo lỗi vượt quá dung lượng thời gian để người dùng hoặc AI tinh chỉnh bản dịch, **tuyệt đối không âm thầm cắt bỏ câu thoại**.

---

## Hệ Quả (Consequences)

### Tích cực:
- Giọng lồng tiếng giữ được âm sắc tự nhiên, tròn vành rõ chữ, nhịp điệu dễ nghe như người thật.
- Khớp nối hoàn hảo với chuyển động môi và hành động của nhân vật trong video gốc.
- Đảm bảo tính toàn vẹn nội dung của kịch bản dịch.

### Tiêu cực / Đánh đổi:
- Yêu cầu bản dịch ban đầu phải được rút gọn tương đối vừa vặn với độ dài câu gốc; nếu bản dịch quá dài, pipeline sẽ từ chối hoặc cần tách phân đoạn.

## Bổ Sung Triển Khai (2026-09-08)

Đường chạy AutoShort hiện thực hiện việc fit theo ba pha tuần tự:

1. **Measured pass:** TTS chạy ở tốc độ server `1.0`, trim và đo WAV thật cho toàn bộ cue. Cue nhóm tràn được structural split tại ranh giới source và câu dịch hoàn chỉnh trước khi gửi LLM.
2. **Batch rephrase:** Chỉ overflow queue sau measured pass mới được gửi cho adapter rephrase. Local provider chia request measured overflow thành batch tối đa `8` cue, giữ exact cue ID, source/current text, context và `measured_natural_seconds`/`hard_max_natural_seconds`. Pha này không gọi TTS.
3. **Measured rescue:** Chỉ candidate hợp lệ mới được TTS/trim lại. Candidate được chọn phải cải thiện và fit khi tempo đo được không vượt `1.80x`; finalization có thể reflow cue trước để giữ khoảng bảo vệ rồi đo lại candidate. Nếu không fit sau reflow thì cue vẫn báo lỗi policy, không cắt hoặc bỏ lời.

Progress và manifest `tts-timeline.json` phân biệt `measure`, `batch-rephrase`, `rescue`, `finalize`, đồng thời lưu `overflowCount`, `batchCount`, `batchCueCount`, `rescueAttemptCount`, `rescueAcceptedCount` và `phaseWaitMs`. Các test local chỉ xác nhận contract và thứ tự phase; việc chấp nhận với TTS server thật vẫn cần media run riêng.

### Hiệu chỉnh DSP theo thời lượng đo

Finalization đo lại cả hai phía: WAV dài quá deadline và WAV ngắn đến mức tempo đo vượt trần. Tối đa ba lượt hiệu chỉnh target theo tỷ lệ thời lượng thực tế, luôn xử lý lại WAV gốc đã trim để tránh nén lặp. Không dùng padding để che tempo quá nhanh, không cắt lời để đạt deadline. Nếu DSP vẫn không đạt ràng buộc thì báo lỗi sau số lượt hữu hạn.

Thời lượng đầu vào của mỗi lượt DSP phải dùng trực tiếp số đo đã trả về từ bước trim. Planner chuyển số đo này cùng đường dẫn WAV sang audio adapter; adapter không chạy lại FFprobe trên cùng input trước khi áp tempo. Thời lượng file DSP đầu ra vẫn được đo lại để hiệu chỉnh và kiểm tra trần vật lý. Quy tắc này tránh một lần probe dư thừa làm hỏng cả item sau khi measured pass đã hoàn tất thành công.

Đây chỉ sửa sai số DSP (ví dụ 1.818x dù target là 1.80x), không giải quyết trường hợp lời đầy đủ thực sự cần 2.282x. Với thời lượng hình bất biến, đủ lời và trần tempo hữu hạn, không thể cam kết mọi đầu vào đều fit.

## Override kéo dài hình có giới hạn — 2026-09-08

Người dùng đã đồng ý kéo dài hình tối đa khoảng 30–40%. Triển khai lấy **40% làm trần cứng của từng đoạn**, không lấy 30% làm mức kéo dài tối thiểu. Đoạn được tính từ start của speech unit đến start unit tiếp theo (đoạn cuối đến hết video); đoạn dẫn không lời giữ nguyên. Chỉ thêm lượng thời gian còn thiếu sau measured rescue, cộng guard DSP 15ms, nên khi đủ trong 30% sẽ không tăng lên 40%. Vì các đoạn tạo thành phân hoạch video, tổng video cũng không dài hơn 140% nguồn.

- `synthesizeVoice` bật `allowVideoExtension`. Synthesis giữ nhóm ngữ nghĩa qua measured rephrase trước khi cân nhắc structural split, tránh tạo thêm khoảng nghỉ làm nhóm vốn vừa trở thành không vừa. Split vẫn là fallback hữu hạn khi nhóm vượt cả trần kéo dài.
- `dubbing/timeMap.ts` tạo một map tuyến tính từng đoạn từ nguồn gốc, không áp dụng lặp map lên output. Khe thoại và phụ đề được lập lại ở tọa độ output, vẫn giữ tempo 1.80x và protected gap. Lời không bị cắt hoặc pad để che tempo.
- `dubbing/retimeMedia.ts` dùng cùng map cho video và mask OCR; âm thanh nguồn/nhạc đã tách chạy qua trim, atempo và concat theo từng đoạn. Nhạc nền chọn ngoài tiếp tục lặp theo thời lượng output ở tốc độ bình thường. Nhánh STTN hoàn tất ở tọa độ nguồn trước khi kéo dài hình đã xử lý.
- Coordinator dùng output duration cho validation, stitch, mix và kiểm tra render; không còn cắt narration tại duration nguồn. Artifact `dubbing-time-map.json` và `dubbing-plan.json` lưu map cùng source ledger gốc; các mốc `sourceStart/sourceEnd` trong plan đã retime thuộc hệ tọa độ output được ghi rõ, không thay checkpoint nguồn.
- Intermediate ở workDir được dọn bởi scope hiện có. Kiểm tra dung lượng trống trừ reservation/headroom và giới hạn kích thước FFmpeg chặn ghi vượt dự trù. Có thêm một lượt encode H.264 cho video cần kéo dài, tăng chi phí và có tổn hao hình nhẹ.
- Nếu vẫn cần hơn 40%, dừng với cue ID và phần trăm cần kéo dài; không tự nới trần, cắt lời hay giả thành công. Đây không phải cam kết mọi video/provider đều thành công.

Kiểm chứng: test planner/synthesis cho giới hạn từng đoạn, nhóm ngữ nghĩa, ledger gốc, khoảng nghỉ và tempo; fixture FFmpeg thật đối chiếu chuyển cảnh và chuyển âm tại mốc được map cho video, mask và audio riêng. Chưa nghiệm thu lại batch video thực tế với TTS server.

## Chốt nhóm thoại từ nguồn trước dịch — 2026-09-10

Lỗi video `7635582620131374579`, cue `cue-45-58680`, cho thấy dấu hỏi trong bản dịch có thể biến một mảnh câu nguồn thành đoạn TTS đơn lẻ quá ngắn. `sourceSpeechGrouping.ts` nay xác lập nhóm chỉ từ text/timing nguồn trước khi chia request dịch; `groupDubbingPlanForSpeech` dùng cùng thuật toán cho TTS. Dấu câu và độ dài bản dịch không được thay đổi ranh giới nhóm.

- Kết thúc câu nguồn đóng nhóm **sau** cue cuối câu; không tự ngắt trước cue có dấu hỏi. Dấu hỏi Arabic `؟` cũng được nhận diện. Đổi người nói và khoảng nghỉ từ 0.60s tiếp tục tạo ranh giới.
- Đoạn nguồn không có dấu câu dùng phân hoạch cân bằng theo toàn đoạn, tối đa 6 cue, 15s và 300 ký tự nguồn cho nhóm nhiều cue. Một cue nguồn quá dài vẫn giữ ID để planner chia đơn vị request nội bộ, không tự sửa timestamp. Đây là heuristic có giới hạn, không phải bằng chứng hiểu đúng mọi ranh giới ngữ nghĩa.
- Translation gán `source-speech-v1:<first-cue-id>` trước resume/recovery. ID/timestamp/text của mỗi cue nguồn vẫn bất biến; provider vẫn trả từng ID gốc. `sourceSpeechGroups` giữ bản sao nhóm nguồn hoàn chỉnh làm ngữ cảnh chỉ đọc, kể cả khi cue giữa đã dịch thành công, tránh ghép hai đầu thành câu bị mất phủ định.
- Prompt `translation-v10` yêu cầu giữ mảnh câu đúng ID và không chuyển phần hỏi/phủ định/sự kiện sang cue kế bên. Version mới vô hiệu hóa việc tái dùng bản dịch theo prompt cũ qua identity hiện có; không xóa source checkpoint.
- Nhóm thoại và request provider là hai khái niệm riêng: một nhóm vẫn có thể trải qua nhiều request khi chạm context hoặc giới hạn 24 đơn vị/20.000 ký tự ước lượng. Metadata nhóm được giữ nguyên qua chia request, retry và resume.
- Tiếp tục đo WAV thật, rephrase, structural split sau đo, tempo tối đa 1.80x và kéo dài hình tối đa 40% từng đoạn. Không bảo đảm mọi bản dịch/TTS đều vừa thời lượng.

Kiểm chứng hồi quy dùng đúng 54 cue nguồn đã lưu của video trên, cặp câu hỏi nhiều cue, dấu câu Pháp/Arabic, giữ ledger, resume thưa có phủ định ở giữa, missing-ID recovery và chia cue dài. Test offline chứng minh hành vi code; chưa chạy lại dịch/TTS provider thật hoặc cập nhật app cài đặt.

## Phục hồi audio Chatterbox bất thường — 2026-09-11

Một lượt thật sinh câu `Oh my!` thành WAV `8.76s`. File có container hợp lệ và phần sóng có âm thanh nên kiểm tra header cùng silence trim không phát hiện được; planner sau đó hiểu nhầm đây là lời hợp lệ và báo cần kéo dài hình `52.1%`. `validateVoiceAudioCompleteness` nay chặn thời lượng vượt ngưỡng bảo thủ `max(6s, 2.5s × số từ)`. Với lần tổng hợp chính, pipeline bỏ đúng cache key đó, gọi lại TTS một lần, trim và đo lại trước khi tính tempo hay kéo dài hình. Audio thay thế vẫn bất thường thì dừng với cue ID và lỗi chất lượng rõ ràng.

Server cũng có thể trả mã riêng `chatterbox_generation_failed`. Client voice clone chỉ gửi lại cùng request một lần cho đúng mã này. Lỗi xác thực, timeout, cấu hình, HTTP khác và thao tác hủy không được retry theo nhánh phục hồi này. Các giới hạn `1.80x`, khoảng nghỉ bảo vệ và kéo dài hình tối đa `40%` không thay đổi.

## Thay thế chính sách kéo dài hình — 2026-09-11

Theo yêu cầu người dùng, trần kéo dài cục bộ `40%` ở các phần lịch sử phía trên được thay bằng **60% mỗi đoạn nguồn**. Planner làm chậm đoạn chính tối đa `20%`; guard DSP `15ms` ở lại đoạn liên tục để không sinh nhánh replay ngắn hơn một frame. Phần còn thiếu phát lại phần cuối nằm trong chính khoảng nguồn của speech unit. Map luôn được lập từ nguồn ban đầu và không cộng dồn trên output đã retime.

Video, mask OCR và instrumental dùng cùng thứ tự segment. Audio nguồn ở chế độ mix bị tắt trong segment replay để không lặp thoại; narration và phụ đề đích chỉ phát một lần trên timeline output. Blur vẫn dùng Planar RGB sau khi mask đã được retime.

Khi vẫn vượt 60%, item lưu cue ID, số giây và phần trăm cần thêm, tiếp tục các item còn lại rồi tự chạy lại một lần ở cuối batch. Lượt hai bỏ cache TTS nghi vấn và đổi prompt sang `repair-source`: `source_text` là bằng chứng nghĩa chính, `current_text` chỉ dùng để phát hiện lệch nội dung. Nếu lượt hai vẫn lỗi, batch kết thúc với lỗi được giữ lại; không lặp vô hạn, cắt lời hoặc vượt trần 1.80x.
