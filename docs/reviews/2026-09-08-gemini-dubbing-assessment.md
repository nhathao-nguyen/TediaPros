# Đánh giá chat Gemini và khả năng áp dụng vào TediaPros

Ngày: 2026-09-08. Phạm vi: đọc chat, kiểm chứng nguồn và code; chưa triển khai cải tiến.

## Kết luận

Áp dụng có chọn lọc: dịch có ngữ cảnh và gợi ý thời lượng, đo WAV thật, giữ timeline có kiểm chứng. Không áp dụng bộ đếm âm tiết và prompt ép min/max trong chat làm điều kiện nghiệm thu. Giữ local server hiện tại, tempo ceiling 1.80x, protected gap 0.50s, cơ chế kéo dài đoạn tối đa 40% hiện có. Người dùng xác nhận giữ khả năng kéo dài và ưu tiên giảm nhu cầu dùng nó. Tổng quota dịch vẫn tắt; cancellation, timeout từng request và dừng khi không tiến triển vẫn hoạt động.

## Nguồn và giới hạn bằng chứng

- Đã đọc đủ 8 lượt hỏi/đáp trong [chat Gemini](https://gemini.google.com/share/0643ccd59a03), tiêu đề “Lý do video đổi giọng theo vùng”, từ câu hỏi đổi ngôn ngữ trên nền tảng đến prompt ép âm tiết. Link ngắn người dùng gửi: https://share.gemini.google/4ITcVtfd5rVS. Đọc qua trình duyệt vì web fetch không mở được link ngắn. Một số công thức render không hiện trong accessibility text; không suy diễn giá trị bị thiếu, dựa vào đoạn code và văn bản nhìn thấy.
- Repo local: `codex/measured-dubbing-first`, HEAD `863f55c38822e28046b0f0592c206ca9303aeeb5`, cùng working tree có nhiều thay đổi sẵn. HEAD không đại diện đầy đủ code đã review.
- CODE_CONFIRMED: đọc các file bên dưới. TEST_CONFIRMED chỉ áp dụng cho các lệnh cụ thể ghi ở handoff. Chưa benchmark server/model/voice thực tế.
- Nhận định về thuật toán nội bộ YouTube/Meta, phần trăm tiết kiệm GPU, chất lượng clone, tốc độ lip-sync trong chat không được coi là bằng chứng cho TediaPros. Lip-sync ngoài phạm vi kế hoạch.

## Đánh giá từng nhóm đề xuất

| Đề xuất trong chat | Đánh giá | Quyết định |
| --- | --- | --- |
| Dịch ngắn tự nhiên theo thời lượng, rồi sinh giọng và đo | Phù hợp; code đã có measured rephrase và candidate TTS | Cải thiện chất lượng đầu vào và chọn candidate, không dựng lại pipeline |
| Bảng SPS cố định cho mọi giọng, ví dụ Việt 4.90 | Chưa có bằng chứng bảng đó phù hợp model/voice hiện tại; tốc độ còn phụ thuộc số, tên riêng, pause và cách đọc | Chỉ dùng prior có provenance nếu được kiểm chứng; ưu tiên profile từ audio thật |
| Việt: số token tách khoảng trắng bằng số âm tiết | Chỉ là proxy cho văn bản thuần; `2026`, `3,5 kg`, `AWS`, URL và tiếng nước ngoài không tuân theo quy tắc đó; từ tiếng Việt có thể gồm nhiều tiếng | Chuẩn hóa để ước lượng riêng, báo uncertainty; không sửa source ledger |
| Pyphen đếm âm tiết tiếng Anh chính xác | Pyphen là thư viện hyphenation, không phải bộ phân tích phát âm | Không dùng làm bộ đếm chuẩn; từ điển phát âm/G2P chỉ thử khi có bộ đánh giá |
| Đếm ký tự trong `ipa_vowels` để đếm âm tiết | Đoạn code chứa cả phụ âm như `ŋ`, `ð`, `β`; còn sai với nguyên âm đôi, dấu kết hợp, phụ âm tạo âm tiết | Loại đoạn code này |
| LLM trả `syllable_count` và `is_within_budget` | Là tự khai của model, không phải phép đo độc lập | Backend tính features; audio measurement quyết định fit |
| Ép bản dịch đủ số âm tiết tối thiểu; thêm từ đệm khi ngắn | Có thể tạo lời dư, đổi sắc thái; không cần cho câu đã đủ nghĩa | Bỏ min-length và yêu cầu thêm từ. Câu ngắn giữ wording, timeline chừa phần còn lại |
| Chỉ giữ “thông điệp chính”, cắt chính xác N âm tiết | Không đáp ứng bảo toàn chi tiết, phủ định, điều kiện, quan hệ nhân quả | Dùng mục tiêu thời lượng mềm; chi tiết nghĩa là ràng buộc |
| ±10% ký tự bảo đảm vừa tiếng và không nghe biến dạng | IWSLT 2022 định nghĩa một metric length compliance, không bảo đảm thời lượng hoặc chất lượng nghe từng cue | Chỉ báo cáo tham khảo; không biến thành pass/fail chung cho Trung–Việt |
| WhisperX bắt buộc, chính xác tới mili-giây | Không đúng như một bảo đảm chung; alignment phụ thuộc ngôn ngữ, từ và tín hiệu. Repo công bố giới hạn | Giữ faster-whisper hiện có; chỉ thử alignment bổ sung nếu chứng minh được lỗi mốc nguồn |
| Cắt micro-pause tùy ý để fit | Có thể mất nhịp và phụ âm yếu; protected gap là chính sách riêng | Không thay trim calibration/gap trong đợt này |
| `-c:v copy` cho mọi đầu ra | Chỉ phù hợp khi không filter/re-time video; AutoShort có burn, OCR/STTN, kéo dài hình | Không thay đường render hiện tại |
| BGM/SFX giữ nguyên 100% sau separation | Tách nguồn không bảo đảm phục hồi hoàn hảo mọi tiếng động; laughter có thể nằm ở vocal | Giữ separation hiện tại; không hứa bảo toàn 100% |
| Đổi toàn bộ sang Demucs/WhisperX/F5-TTS/Speech-to-Speech | Tăng scope, chưa chứng minh tốt hơn server và engine hiện có | Hoãn; đánh giá model/voice riêng khi có nhu cầu |

Ví dụ AWS cuối chat không chứng minh khớp 3.2 giây: khoảng trắng không thể xác định cách TTS đọc AWS. Cụm “backend architecture” cũng bị đổi thành “hệ thống” và thêm “máy chủ”; không lấy ví dụ đó làm bản dịch tham chiếu chuẩn.

Nguồn xác minh: [Pyphen](https://pyphen.org/), [IWSLT 2022 isometric](https://iwslt.org/2022/isometric), [WhisperX](https://github.com/m-bain/whisperX), [nghiên cứu duration predictor và reranking](https://aclanthology.org/2023.iwslt-1.9/), [nghiên cứu prompting kiểm soát độ dài](https://aclanthology.org/2025.iwslt-1.11/). Các nghiên cứu chỉ hỗ trợ hướng tiếp cận; không phải benchmark TediaPros.

## Đọc code repo tham khảo

### pyvideotrans

Snapshot `d1cb6220dc1aaa30cc1b3f816ca8892e278ea1d4`:

- [`_stage_align.py`](https://github.com/jianchang512/pyvideotrans/blob/d1cb6220dc1aaa30cc1b3f816ca8892e278ea1d4/videotrans/task/_stage_align.py): tách stage alignment, đo video trước/sau và gọi `SpeedRate`.
- [`_rate.py`](https://github.com/jianchang512/pyvideotrans/blob/d1cb6220dc1aaa30cc1b3f816ca8892e278ea1d4/videotrans/task/_rate.py): có Rubber Band, FFmpeg atempo, kéo dài video và đo output. Nhưng helper Rubber Band cho phép tỷ lệ tới 50; helper FFmpeg dùng `-t` theo target. Không sao chép các giới hạn/đường ép thời lượng đó.
- [`_base.py`](https://github.com/jianchang512/pyvideotrans/blob/d1cb6220dc1aaa30cc1b3f816ca8892e278ea1d4/videotrans/translator/_base.py): có batching và cache. TediaPros đã có hợp đồng ID/checkpoint riêng nên chỉ tham khảo tổ chức stage.

### Ai-Vedio-Dubbing

Snapshot `892ed87530db582621b1c3412b0ea19509babd49`:

- [`app.py`](https://github.com/DjebrilSVN/Ai-Vedio-Dubbing/blob/892ed87530db582621b1c3412b0ea19509babd49/app.py), dòng 478–489: tăng tốc tới giới hạn rồi cắt `trimmed_audio[:max_safe_duration_ms].fade_out(100)` nếu còn dài.
- [`service_c_voice/app.py`](https://github.com/DjebrilSVN/Ai-Vedio-Dubbing/blob/892ed87530db582621b1c3412b0ea19509babd49/Micro_Services%20Version/service_c_voice/app.py), dòng 116–118: ước lượng theo ký tự; dòng 157–158 cũng cắt audio. Đây không phải thiết kế bảo toàn lời có thể mang nguyên vào TediaPros.
- Có thể học cách cô lập voice reference và stage; không cần thêm microservices chỉ vì repo đó dùng Docker.

### Subtitle Edit và cuebridge từ nghiên cứu trước

- [Subtitle Edit advanced](https://github.com/SubtitleEdit/subtitleedit/blob/main/docs/features/auto-translate-advanced.md): context, glossary, synopsis, chia batch lỗi. [Protocol snapshot](https://github.com/SubtitleEdit/subtitleedit/blob/fb44553c19b5288905aee91ac62f79f81f895146/src/ui/Features/Translate/LlamaCppAdvanced/LlamaCppAdvancedProtocol.cs) có structured JSON và phần prompt ổn định để tận dụng prefix cache.
- [cuebridge snapshot](https://github.com/jaysonsantos/cuebridge/blob/6feafd6992d825fe2defbce182254f34e6d72154/cuebridge/subtitle_windows.py): marker validation và thu nhỏ cửa sổ. TediaPros đã chia batch lỗi; phần còn đáng học là phản hồi kích thước cho batch chưa gửi, phải giữ checkpoint nhất quán.

## Trạng thái TediaPros đã kiểm tra lại

| File/symbol | Hiện có | Còn thiếu hoặc cần đánh giá |
| --- | --- | --- |
| `localTranslate.ts:createLocalTranslationAdapter` | Local server `/v1/chat/completions`, prompt dịch/repair riêng | Lease chỉ bọc fetch headers; chưa chuyển Retry-After; model alias, contextTokens null, chưa structured output |
| `translation/prompts.ts:buildTranslationBatchMessages` | Repair đã nối runtime, prompt v7, trần lấy từ policy | Kết luận trước rằng repair chưa nối đã lỗi thời. Repair chưa gửi context section như prompt dịch |
| `autoshort.ts:translationInput`; `translation/fileRunner.ts` | Hợp đồng có context/glossary | Điểm gọi truyền rỗng; planner chưa dựng context lân cận cho mỗi batch |
| `translation/planner.ts` | Semantic grouping, token estimation hook, tách cue dài, batching | Local không biết context limit; repair/schema/history mới phải cùng được tính vào request size |
| `translation/budget.ts` | Tổng quota tắt; bộ đếm và local retry/no-progress còn giữ | Không bật lại quota trong kế hoạch |
| `dubbing/durationPredictor.ts`; `profileStore.ts` | Profile v2 theo features, bootstrap WAV, uncertainty, lưu profile | Chưa phải bộ đếm âm tiết; chưa dùng profile đã đủ tin cậy để gợi ý lần dịch đầu; cần đánh giá sai số held-out |
| `autoshort.ts:profileKey` | Key theo endpoint/model/voice/language/options/reference metadata | TTS cache có revision/content hash ở vùng code lân cận; profile key chưa nhận chúng tương đương |
| `dubbing/synthesis.ts` | Đo WAV, rephrase tối đa 3 candidate, rank theo dự đoán, thử audio, fit/DSP, retime | Ngắn nhất/nhanh nhất không đồng nghĩa tốt nhất; cần rà lại semantic gate cho từng candidate trong toàn đường gọi |
| `dubbing/timeMap.ts`; `autoshort.ts:synthesizeVoice` | Extension 0.4, `allowVideoExtension: true` | Giữ nguyên; đo tỷ lệ sử dụng để đánh giá cải tiến |
| `engines/whisper-engine/engine.py` | faster-whisper `word_timestamps=True`, xuất alignment JSON | Không cần thay bằng WhisperX chỉ để có word timestamps |

Kế hoạch triển khai: [local-server-dubbing-improvements](../superpowers/plans/2026-09-08-local-server-dubbing-improvements.md).
