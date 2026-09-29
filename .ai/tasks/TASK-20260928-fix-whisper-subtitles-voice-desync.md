# [TASK-20260928-fix-whisper-subtitles-voice-desync]: Sửa Lỗi Phụ Đề Lệch Giọng Nói & Tách Ranh Giới Câu Whisper

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Antigravity Agent
- **Thời gian:** 2026-09-28

---

## 1. Mục Tiêu (Goal)

Người dùng phản ánh trên video thực tế (`Video [923923593724102]`), phụ đề Whisper và giọng nói của nhân vật bị lệch pha hoàn toàn, kèm theo hiện tượng ngắt câu phản cảm dính chữ lẻ từ câu kế tiếp sang câu trước (`Stay behind the line. It`) với ô highlight đỏ nhảy sai nhịp.

Mục tiêu:
1. Tách các cue phát ngôn dài của Whisper thành từng câu độc lập có mốc thời gian (`start`, `end`, `words`) bám sát 100% vào giọng nói thật của nhân vật.
2. Ngăn chặn thuật toán bọc dòng tham lam (`wrapWordsPx`) nhét lẻ từ của câu kế tiếp vào cuối dòng trước sau dấu kết câu.
3. Bảo toàn ánh xạ Word Timings chính xác khi render hiệu ứng làm nổi bật từ (Word-Highlight / WordBox).

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Hàm `splitLongAlignedCues` tự động tách các cue dài chứa nhiều câu dựa trên ranh giới câu (`.` `!` `?`) và mốc thời gian thực tế của từng từ (`words`).
- [x] Thuật toán ngắt dòng `wrapWordsPx` trong `subWrap.ts` tôn trọng ranh giới câu, không bẻ cụt từ đầu câu kế tiếp sang dòng cũ.
- [x] Thuật toán cân bằng dòng `balanceLineGroup` trong `subtitleLayout.ts` không đẩy từ kết câu xuống dòng dưới.
- [x] Hàm `taoAss` trong `burn.ts` giải quyết đúng danh sách từ của từng segment khi render Word Highlight thay vì bị rớt sang ước lượng giả lập.
- [x] Triển khai Quy hoạch động (Timeline Smoothing DP - `allocateSegmentTimingsDP`) để làm phẳng tốc độ đọc (CPS) giữa các segment, tránh trường hợp segment 1 quá gấp mà segment 2 lại quá thảnh thơi.
- [x] Tự động phát hiện khoảng lặng (Dead-Air Silence Gap) giữa các câu: tạo khoảng trống không hiện phụ đề giữa 2 câu khi có khoảng dừng dài (thay vì kéo dài phụ đề lê thê trên màn hình khi nhân vật đã ngừng nói).
- [x] Triển khai Dynamic Time Warping (DTW - `alignWordsDtw`) để căn chỉnh từ Karaoke / Word-Reveal / Word-Highlight, hỗ trợ gộp từ viết tắt ("that's" -> "that" + "'s"), dấu câu và lọc filler words.
- [x] Tăng cường ánh xạ từ Whisper trong `readWhisperAlignedCues` theo `sourceIndex` và độ tương đồng văn bản, loại bỏ lỗi trượt mili-giây làm mất word timestamps.
- [x] Xử lý lỗi Whisper Cross-Attention Alignment Drift qua khoảng lặng (`repairWhisperWordGaps` và `healOrphanDriftCues`): tự động kéo các từ bị trôi ảo về phía trước khoảng lặng (như từ "That's" bị trôi về giây 14 trong khi người nói phát âm ở giây 21) về đúng mốc thời gian thực ngay trước phần còn lại của câu ("impossible" ở giây 21.46s).
- [x] Xử lý an toàn `options.signal` trong `burnAutoShort`.
- [x] `npm run typecheck` pass 100% không có lỗi.
- [x] `npm run test:subtitles` pass 100%.
- [x] Toàn bộ test suites `npm run test:local-runtime` pass 100%.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - [src/shared/autoShortAlignment.ts](file:///f:/Son/tool/TediaPros/src/shared/autoShortAlignment.ts): Hàm `splitLongAlignedCues` (hỗ trợ dead-air pause), `repairWhisperWordGaps`, `healOrphanDriftCues` và `alignWordsDtw` (thuật toán DTW căn chỉnh từ).
  - [src/shared/subtitleLayout.ts](file:///f:/Son/tool/TediaPros/src/shared/subtitleLayout.ts): Hàm `allocateSegmentTimingsDP` (Quy hoạch động làm phẳng CPS và tách silence gap), cập nhật `planSubtitleLayout`.
  - [src/main/autoshort.ts](file:///f:/Son/tool/TediaPros/src/main/autoshort.ts): Cải tiến `readWhisperAlignedCues` với so khớp `sourceIndex`, dung sai nới lỏng và text similarity.
  - [src/main/autoShortItemCoordinator.ts](file:///f:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts): Áp dụng `splitLongAlignedCues` khi trích xuất phụ đề nguồn.
  - [src/shared/subWrap.ts](file:///f:/Son/tool/TediaPros/src/shared/subWrap.ts): Bảo vệ ranh giới câu trong `wrapWordsPx`.
  - [src/main/burn.ts](file:///f:/Son/tool/TediaPros/src/main/burn.ts): Tích hợp `alignWordsDtw` trong `resolveMatchingSegmentWords` và sửa `options.signal`.
  - [tests/subtitle-layout.test.ts](file:///f:/Son/tool/TediaPros/tests/subtitle-layout.test.ts): Unit tests cho Timeline Smoothing DP, Dead-Air Silence Gap, Whisper Drift Repair, và DTW word alignment.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

1. **Tách Cue tại tầng Alignment (`splitLongAlignedCues`):**
   - Thay vì để một cue dài 13s lọt vào layout rồi bị chia theo số ký tự cơ học, việc tách cue thành từng câu thoại độc lập ngay sau khi Whisper nhận diện giúp mỗi câu có mốc thời gian âm thanh (`start`, `end`) chuẩn xác 100%, bảo toàn khoảng lặng (silence) giữa các câu nói.
2. **Quy hoạch động làm phẳng tốc độ đọc (Timeline Smoothing DP):**
   - Thay vì chia thời lượng tuyến tính theo tỷ lệ số ký tự (dễ làm đoạn ngắn bị chớp tắt trong 0.3s hoặc đoạn dài bò lê thê 8s), thuật toán DP tối ưu hóa hàm mục tiêu giảm phương sai CPS giữa các segment kề nhau: $\min \sum (CPS_i - targetCPS)^2 + \lambda \sum |CPS_i - CPS_{i+1}|^2$.
3. **Phát hiện Dead-Air Silence Gap:**
   - Khi tổng thời lượng vượt quá thời gian đọc tối đa ($totalCs > \sum d_{max} + 80cs$), hệ thống phân tách cụm trước bám `cue.start`, cụm sau bám `cue.end`, để lại khoảng lặng ở giữa màn hình không hiện phụ đề, phản ánh đúng thực tế nhân vật không nói.
4. **Căn chỉnh từ Karaoke qua Dynamic Time Warping (DTW):**
   - `alignWordsDtw` tính toán ma trận chi phí Levenshtein giữa dãy từ phụ đề và dãy từ của Whisper, hỗ trợ ghép từ rút gọn (contractions như "that's" -> "that" + "'s"), tự động nội suy từ bị nuốt âm và bỏ qua tiếng thở/filler words.
5. **Khắc phục lỗi Whisper Alignment Drift qua khoảng lặng (`repairWhisperWordGaps` & `healOrphanDriftCues`):**
   - Khi trong video có khoảng lặng chứa tạp âm (tiếng máy, nhạc nền), Whisper DTW dễ gán từ đầu tiên của câu tiếp theo (ví dụ `"That's"`) vào tạp âm trước khoảng lặng (ở giây 14), cách xa từ chính (`"impossible"` ở giây 21) hơn 7 giây.
   - Thuật toán nhận diện các từ mồ côi (1-2 từ, không có dấu kết câu, là contraction/từ nối hoặc từ tiếp theo viết thường) bị tách bởi gap $\ge 1.2s$, tự động kéo các từ này về ngay trước từ tiếp theo (giây 21.46s).
   - Nhờ đó, loại bỏ hoàn toàn chữ ảo xuất hiện ở giây 14, gom trọn vẹn cụm *"That's impossible"* vào đúng thời điểm 21.46s - 22.18s khi nhân vật phát âm.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` [src/shared/autoShortAlignment.ts](file:///f:/Son/tool/TediaPros/src/shared/autoShortAlignment.ts)
- `[MODIFY]` [src/shared/subtitleLayout.ts](file:///f:/Son/tool/TediaPros/src/shared/subtitleLayout.ts)
- `[MODIFY]` [src/main/autoshort.ts](file:///f:/Son/tool/TediaPros/src/main/autoshort.ts)
- `[MODIFY]` [src/main/autoShortItemCoordinator.ts](file:///f:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts)
- `[MODIFY]` [src/shared/subWrap.ts](file:///f:/Son/tool/TediaPros/src/shared/subWrap.ts)
- `[MODIFY]` [src/main/burn.ts](file:///f:/Son/tool/TediaPros/src/main/burn.ts)
- `[MODIFY]` [tests/subtitle-layout.test.ts](file:///f:/Son/tool/TediaPros/tests/subtitle-layout.test.ts)

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:
```powershell
cmd.exe /c "npm run typecheck"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs subtitle-layout.test"
cmd.exe /c "npm run test:local-runtime"
cmd.exe /c "npm run test:subtitles"
```

### Kết quả thực tế:
- `Typecheck`: PASS (0 errors trên cả Node và Web).
- `subtitle-layout.test`: PASS 12/12:
  1. `subtitleLayoutRules assigns 1 maxLine for social and 2 for readable/vertical`
  2. `planSubtitleLayout splits multiline cues into 1-line segments for social profile`
  3. `ngatDongTheoPx respects sentence terminal and does not pack orphan words from the next sentence`
  4. `splitLongAlignedCues splits multi-sentence whisper cues into independent timed cues using word timestamps`
  5. `allocateSegmentTimingsDP inserts dead-air silence gap between sentences when total duration is large`
  6. `splitLongAlignedCues detects dead-air silence gaps without word timestamps (Video 923923593724102 case)`
  7. `alignWordsDtw matches contractions and token variations between subtitle text and speech words`
  8. `splitLongAlignedCues repairs pre-silence drift (That's vs impossible with 7s gap)`
  9. `splitLongAlignedCues splits legitimate clauses across significant pause >= 0.6s`
  10. `taoAss single-word display caps word duration and does not stretch across silence gaps`
  11. `repairWhisperWordGaps pulls pre-silence drifted contraction forward to destination speech timestamp`
  12. `healOrphanDriftCues merges dangling orphan cue into destination cue across dead air`
- `npm run test:local-runtime`: PASS 100% (tất cả các test suite).
- `Smoke subtitles test`: PASS (Logic verified: 2 cues, 14 tokens, 6 beats).


