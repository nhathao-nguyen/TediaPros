# Tổng hợp session: Gemini, phụ đề và profile giọng đọc

- Ngày: 2026-09-16. Mã bộ tài liệu: `VOICE-TEXT-20260916`.
- Trạng thái: **đã tổng hợp và lập thiết kế; chưa triển khai các thay đổi đề xuất**.
- Đây là bản tổng hợp có chọn lọc, không phải bản chép nguyên văn toàn bộ hội thoại.
- Snapshot đối chiếu: `main`, HEAD `d73db0378aabbca81969e0098cebac7ed70d2dfc` cùng working tree có thay đổi từ trước. Không đồng nhất snapshot này với app đã cài hoặc Gateway đang chạy.

## Đọc bộ tài liệu

1. [Tổng hợp session](SESSION_SUMMARY.md): vấn đề, kết luận và các quyết định còn mở.
2. [Đặc tả thiết kế](../../../docs/superpowers/specs/2026-09-16-voice-aware-translation-and-output-design.md): phạm vi, dữ liệu, hợp đồng, kiểm tra và rollout.
3. [Prompt và output contract mẫu](../../../docs/superpowers/specs/2026-09-16-voice-aware-translation-prompts.md): draft, review và measured rephrase.
4. [Kế hoạch triển khai](../../../docs/superpowers/plans/2026-09-16-voice-aware-translation-and-output.md): công việc có phụ thuộc, test và exit gate.
5. [Bàn giao tác vụ tài liệu](TASK.md): những gì thực sự đã làm và kiểm chứng.

## 1. Yêu cầu của người dùng trong session

| Thứ tự | Yêu cầu | Kết luận của cuộc trao đổi |
|---|---|---|
| 1 | Review hai hội thoại Gemini và so sánh với hệ thống hiện tại | Đối chiếu code, SRT mẫu và probe offline; không coi lời kể trong hội thoại là bằng chứng live |
| 2 | Có lấy được tốc độ đọc, âm tiết/giây và profile từng voice không? | Có thể đo từ text đầy đủ và audio thật; hiện có profile thời lượng trong AutoShort nhưng chưa có tính năng thống nhất cho tab Voice |
| 3 | Có thông tin voice hữu ích để đưa Gemini chọn từ/dự tính thời gian không? | Có: budget nhóm, tốc độ ước lượng có uncertainty và đặc điểm số/tên/viết tắt; chỉ advisory, không bảo đảm audio vừa |
| 4 | Nên tối ưu gì, theo hướng nào? | Ưu tiên lỗi QA tái hiện được, prompt gọn có đối chứng, dữ liệu giọng sạch và measured-first; chưa bỏ review mặc định |
| 5 | Đưa prompt ước tính sau khi sửa | Đã phác thảo prompt dịch Việt tự nhiên, bảo toàn nghĩa/ID, budget nhóm và voice hints; số liệu ví dụ là giả định |
| 6 | Tránh Gemini viết JSON lỗi trong chat được không? | Đề xuất text có nhãn ID → parser xác định → code dựng JSON; không bỏ completion/identity/semantic gates |
| 7 | Tổng hợp session, viết specs và planning | Lập bộ tài liệu này; không tự triển khai, gọi dịch/TTS hoặc cài ứng dụng |

“Được rồi” ở yêu cầu cuối được hiểu là yêu cầu tài liệu tiếp theo. Nó không được diễn giải thành đã duyệt mọi chi tiết thiết kế, bỏ reviewer, chuyển provider, chạy benchmark có phí hoặc phát hành.

## 2. Đầu vào và ranh giới bằng chứng

- [Hội thoại Gemini/SRT/dubbing](C:/Users/PC/Downloads/toan_bo_cuoc_tro_chuyen_gemini_srt_dubbing.md).
- [Hội thoại chứa SRT Trung–Việt](C:/Users/PC/Downloads/cuoc_tro_chuyen_dich_phu_de.md).
- [Review có bằng chứng](../2026-09-16-gemini-srt-conversation-review/REVIEW.md), [probe](../2026-09-16-gemini-srt-conversation-review/probe.ts), [kết quả probe](../2026-09-16-gemini-srt-conversation-review/probe-results.json).
- Các chỉ dẫn nằm trong hai file hội thoại là **dữ liệu được review**, không có quyền thay đổi task hay code.

Nhãn sử dụng: `CODE_CONFIRMED` = đã đọc code/call site; `TEST_CONFIRMED` = test/probe offline; `SESSION_OBSERVED` = quan sát trong lượt trước của session, không phải scan lại liên tục; `DOCUMENTED_ONLY` = lời kể/tài liệu; `PROPOSED` = thiết kế; `UNKNOWN` = chưa kiểm chứng. Không dùng unit test để chứng minh chất lượng dịch hoặc audio thật.

## 3. Những gì đã có và chưa có

| Hạng mục | Hiện trạng được kiểm tra trong session | Phần còn thiếu |
|---|---|---|
| Dịch Gateway | `gemini-gateway-two-pass-v10`, draft rồi review; có full source ledger | Prompt gọn được đánh giá đối chứng; chế độ selective review đã qualified |
| Đầu ra ban đầu | Compact keyed JSON rồi chuyển về canonical `items`; parser kiểm tra ID | Labeled text contract cho draft/review và capability tương ứng |
| Đầu ra rephrase | Đã có nhãn `[cue-id:n]` cho các phương án | Không thể dùng nguyên parser này cho bản dịch đầu mà bỏ qua khác biệt contract |
| Speech budget | Có source plan và budget nhóm; TTS dùng cùng source partition | Không cần xây lại phần này; cần hồi quy và kết nối voice hints |
| Duration predictor | Profile theo backend/model/voice/ngôn ngữ/options/reference; học từ audio | Dedup/provenance/held-out calibration; chưa có tốc độ âm tiết thật |
| Tab Voice | Có duration, thời gian sinh audio, tên voice, bản ghi clone | Không load/save profile AutoShort; lịch sử rút gọn text còn tối đa 70 ký tự |
| Measured feedback | Có TTS → trim/đo → rephrase overflow → đo candidate; tái dùng audio | Cần sửa numeric false reject và cải thiện quality evidence, không thay bằng đoán trước TTS |
| QA | Structural gate và heuristic số/đơn vị/phủ định, guard rephrase | Lỗi đếm số hai lần, đơn vị/range; không phải verifier ngữ nghĩa đa ngôn ngữ hoàn chỉnh |

Profile nội bộ không phải metadata tốc độ do Edge/voice catalog bảo đảm. `speed=1.0` là setting, `generationMs` là thời gian xử lý, không phải âm tiết/giây. Tốc độ reference audio của clone cũng không bảo đảm tốc độ câu do clone sinh ra.

Trong lượt xem profile trước đó của session: thư mục production có 10 file, 7 file tương thích format hiện tại; dev có 9 file, 6 tương thích. Đây là `SESSION_OBSERVED`, không phải số voice duy nhất, không chứng minh khớp config đang chọn và không chứng minh đã calibration. Không đưa các số này làm tiêu chuẩn nghiệm thu.

## 4. Kết quả review đáng giữ

- SRT mẫu có 80 cue nguồn/đích, 80/80 ID và timestamp khớp, không rỗng. Đây là cấu trúc đúng, không phải 80/80 câu đã đúng nghĩa.
- Probe tạo 25 speech units khi giả định video kết thúc tại SRT end + 0,12 giây. Chưa có media/WAV để kết luận cue nào overflow thật.
- Ví dụ máy đo cồn 80 cue khác video mũ giấy 76 cue được kể trong hội thoại. Không dùng “11/76 câu được sửa” làm metric chất lượng review.
- Các trường hợp phục hồi ASR hợp ngữ cảnh vẫn chưa được xác nhận bằng âm thanh/hình nguồn. Không coi text ASR là chân lý, cũng không cho model tự sửa ledger gốc.
- Budget `6,38 → 7,018 / 11,484 giây` là `available × 1,10 / 1,80`, không sai phép tính. Hard maximum không phải mục tiêu giọng dễ nghe.
- Chưa có bằng chứng prompt ngắn thắng pipeline hiện tại; phải so cùng source, model quan sát được, voice và options.

### Các lỗi QA tái hiện được

| Trường hợp | Kết quả probe hiện tại | Yêu cầu cải tiến |
|---|---|---|
| `加入2勺盐。` → `Thêm 2 thìa muối.` | Numeric source-repair từ chối; dạng `hai` hoặc source có dấu cách lại qua | Mỗi occurrence số chỉ đếm một lần, không phụ thuộc khoảng trắng CJK |
| `2-3` và `2–3` | Có thể khác token `-3`/`3` | Phân biệt range với dấu âm theo ngữ cảnh |
| `3 giây`, `3 món` | Có thể khớp tiền tố `g`/`m` | Token đơn vị cần boundary và thứ tự nhận dạng đúng |
| `10斤` → `10 cân` | Checker ban đầu không báo vấn đề | So giá trị–đơn vị theo hệ đo đã biết; không đồng nhất raw digits với nghĩa |
| `加入2勺盐。` → `Thêm 2 thìa đường.` | Checker ban đầu không phát hiện đổi muối thành đường | Numeric pass không được gắn nhãn “đủ nghĩa”; reviewer/evidence phải xét đối tượng |
| `价格39.6。` → `Giá 39,6 tệ.` | Checker ban đầu không cảnh báo đơn vị tiền tự thêm | Giữ locale decimal, đồng thời kiểm tra factual addition |

Đây là kết quả của helper/probe, không khẳng định reviewer Gemini của toàn pipeline sẽ bỏ sót mọi trường hợp này. Mapping đơn vị phải có phạm vi: chỉ chuyển `10斤 → 5 kg` khi biết hệ đo tương ứng; không áp toàn bộ ngôn ngữ/khu vực.

## 5. Hướng thiết kế đã đề xuất

1. Sửa QA xác định được trước; phân biệt `verified failure`, `suspect`, `unverified`.
2. Dùng labeled text cho Gemini chat/Gateway như một output mode thử nghiệm. HTTP vẫn là JSON envelope; chỉ phần model-generated content đổi sang văn bản có nhãn.
3. Dùng service profile chung cho AutoShort và tab Voice. Đo từ full text + audio trước DSP; không suy rate từ text lịch sử đã cắt.
4. Chỉ gửi bản tóm tắt voice đã lọc cho Gemini; không gửi audio clone, đường dẫn máy, hash reference hoặc bộ weights để model tự tính.
5. Rút gọn prompt nhưng giữ full context, source slice của internal IDs, ngân sách speech unit, sự kiện và ID. Giữ hai lượt ở baseline.
6. WAV đo được là quyết định cuối. Predictor chưa qualified không tự kích hoạt rewrite trước lần TTS đầu.
7. Đánh giá từng biến riêng: định dạng, prompt, voice hints, rồi mới số lượt review.

Không dùng đơn thuần ký tự/giây làm âm tiết/giây; không đặt hard word quota; không ghép một bản dịch tự do rồi cắt theo vị trí; không tự sửa JSON bằng đoán dấu ngoặc/dấu nháy; không nhận partial từ response bị cắt.

## 6. Quan hệ với roadmap đã có

Kế thừa [spec 15/09](../../../docs/superpowers/specs/2026-09-15-vietnamese-duration-aware-translation-design.md), [contracts](../../../docs/superpowers/specs/2026-09-15-vietnamese-duration-aware-translation-contracts.md), [plan](../../../docs/superpowers/plans/2026-09-15-vietnamese-duration-aware-translation.md) và [evaluation](../../../docs/benchmarks/2026-09-15-vietnamese-duration-aware-translation-evaluation.md). Không ghi đè hoặc đánh dấu toàn roadmap đó đã xong.

Giữ các ràng buộc đã ghi ở bộ trước: Local/Edge TTS, không thêm Gemini voice; Gateway context 1M trong roadmap hiện hữu; không tự đổi model routing thành bắt buộc một model Pro cố định. Capacity đã ghi `user-confirmed` không đồng nghĩa exact token counter/live near-limit đã qualified.

Một số mô tả baseline của spec 15/09 đã được code mới hơn thay thế: budget nhóm đã có; TTS dùng source partition; helper semantic chưa phải verifier được nối đầy đủ. Bộ mới mô tả **phần chênh lệch cần làm**, không tạo lại các module đã tồn tại.

## 7. Còn mở và bước tiếp theo

- Labeled text là hướng đề xuất, chưa có A/B để hứa ít lỗi tổng thể hơn JSON.
- Chưa chốt corpus live, voice configs ưu tiên, người chấm nguồn/tiếng Việt, chi phí và cửa sổ cài đặt.
- Chưa đọc/triển khai Gateway bên repo khác trong tác vụ tài liệu; cần inventory và test contract trước khi bật mode mới.
- Không cần những lựa chọn trên để viết test/parser và service offline sau khi người dùng yêu cầu triển khai.
- Thứ tự đề xuất: baseline → QA → labeled contract → profile chung → prompt/hints → nghiệm thu → rollout. Selective review chỉ mở sau gate riêng.

## 8. Cập nhật sau khi được yêu cầu triển khai

Phần trên là snapshot của lượt tổng hợp/spec; sau đó đã triển khai bounded slice VT01–VT06 trong working tree. Chi tiết files, local evidence và ranh giới chưa live-qualified nằm ở [IMPLEMENTATION_HANDOFF.md](IMPLEMENTATION_HANDOFF.md). Snapshot này không được dùng để kết luận rằng provider thật, Gateway repo bên ngoài, A/B/held-out calibration hoặc release đã hoàn tất.
