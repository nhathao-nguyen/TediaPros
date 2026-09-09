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
