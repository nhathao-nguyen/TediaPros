# VIDEO07-CUE52-20260909: Chẩn đoán lỗi kéo dài 341,4%

- **Trạng thái:** Hoàn thành chẩn đoán; tái hiện offline đúng thông báo lỗi. Chưa sửa pipeline hoặc chạy lại video.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-09

## 1. Mục tiêu

Giải thích vì sao video 07, job `63b6a6c4-5eba-48f5-b44c-dc951d199d6f`, lỗi tại `cue-52-97820` với mức kéo dài đoạn hình `341.4%`.

## 2. Tiêu chuẩn nghiệm thu

- [x] Đối chiếu log gốc và checkpoint đúng video 07.
- [x] Kiểm tra nội dung nguồn, nội dung dịch, thời gian nguồn và WAV đo được.
- [x] Tái hiện `341.4%` bằng hàm production `deriveDubbingWindow` và `planDubbingTimeMap`.
- [x] `npm run typecheck` pass.
- [x] Phân biệt bằng chứng từ log/checkpoint, probe offline và phần chưa biết.

## 3. Phạm vi

Đọc dữ liệu cục bộ, chạy probe không gọi mạng, tạo tài liệu chẩn đoán. Không sửa mã sản phẩm, checkpoint, cache hay dữ liệu dịch. Không có lần chạy server mới trong task này.

## 4. Kết luận và nguyên nhân

**DATA_CONFIRMED:** Bản dịch đã lệch nội dung giữa các cue trước TTS. Cue `cue-52-97820`, thời gian `97.82–98.18s`, chỉ có nguồn `能走` (đi được). Checkpoint gán cho ID đó:

> A nine-kilometer mountain-passing stretch with a sheer cliff and a deep abyss.

Nội dung về đoạn đường 9 km/vách đá/vực sâu thuộc nguồn cue 54–55. Cue 51 vốn là câu hỏi `这路我朋友能走吗?` lại mang tên đường thuộc cue 53. Batch provider đã được parse/persist gồm cue 45–58 có sẵn các cặp ID/text lệch; sai không bắt đầu ở time-map.

**LOG_CONFIRMED:** Pipeline gộp cue 52 và 53; nhóm có 194 ký tự, WAV sau trim dài `10.256s`. Rephrase nhóm trả candidate bị loại; structural split tách thành hai cue. WAV riêng cue 52 ban đầu dài `3.818s`; ba candidate rephrase đo được `2.736s`, `3.406s`, `3.084s`. Candidate `2.736s` được giữ vì cải thiện nhưng vẫn overflow.

**CODE/PROBE_CONFIRMED:** Công thức của `src/main/dubbing/timeMap.ts:37` dùng độ dài đoạn đến start cue kế tiếp làm mẫu số. Với số đo làm tròn trong log:

| Đại lượng | Giá trị |
|---|---:|
| Đoạn nguồn `98.18 - 97.82` | 0,360 s |
| Khoảng nghỉ hiệu dụng theo `deriveDubbingWindow` | 0,054 s |
| Khe đọc được cấp | 0,306 s |
| WAV tốt nhất sau trim | 2,736 s |
| Thời lượng tối thiểu ở trần `1.80x` | 1,520 s |
| Guard DSP | 0,015 s |
| Cần thêm `1.520 - 0.306 + 0.015` | 1,229 s |
| Tỷ lệ cần thêm `1.229 / 0.360 × 100` | 341,3889% → 341,4% |
| Thời gian được phép thêm ở trần 40% | 0,144 s |

Đây là phần trăm tăng thêm của đoạn hình 0,36 giây. Độ dài đoạn yêu cầu theo phép tính là 1,589 giây, tương đương 4,414 lần đoạn nguồn. Không phải tổng video phải dài thêm 341,4%.

**CODE/PROBE_CONFIRMED:** `validateAutoShortContentQuality` vẫn trả `ok: true` cho checkpoint này. Bộ kiểm tra xác nhận cấu trúc ID/text và tạo cảnh báo cho số/phủ định khác nhau, chưa xác nhận ngữ nghĩa từng cặp nguồn–đích. Checkpoint ghi `disposition=with-warnings`, 23 issues. Rephrase hiện có mục tiêu rút gọn `current_text`, không phải một bước căn chỉnh lại batch dịch. Probe riêng thay câu sai bằng `Yes.` còn vượt qua semantic heuristic hiện tại; không được hiểu heuristic này là kiểm chứng ngữ nghĩa đầy đủ.

**UNKNOWN:** Không có raw HTTP request/response của lần chạy video 07 trong trace video 01 tạo sau đó. Chưa xác định sai phát sinh từ output model hay bước chuẩn hóa/parser cụ thể. Không có nội dung candidate rephrase thực trong log, nên không kết luận nguyên nhân từng candidate bị loại. Chưa synthesize bản sửa `Yes.`; chưa khẳng định bản sửa chắc chắn fit.

Ưu tiên sửa đối ứng ngữ nghĩa nguồn–dịch của batch cue 45–58, giữ ID/timestamp nguồn; kiểm tra trước TTS, rồi mới đo lại audio. Giữ trần kéo dài 40% đã được người dùng chọn. Structural split dựa vào số câu và thứ tự chỉ bảo toàn ID, không khôi phục được bản dịch đã lệch nghĩa.

## 5. Tệp tạo mới

- Bản ghi bàn giao này.
- [Probe độc lập](F:/Test_video/diagnose-video07-cue52-20260909.mjs).
- [Dữ liệu chẩn đoán chi tiết](F:/Test_video/video07-cue52-diagnosis-20260909.json): các cặp cue 45–58, checkpoint batch, công thức, log và SHA-256 checkpoint.

## 6. Kiểm chứng và bằng chứng

```powershell
node F:\Test_video\diagnose-video07-cue52-20260909.mjs
cmd.exe /d /c "npm.cmd run typecheck"
```

- Probe PASS: grouping tái hiện 35 nhóm; time-map tái hiện đúng thông báo `341.4%`; không gọi server.
- Typecheck PASS (node và web).
- [Checkpoint nguồn](C:/Users/PC/AppData/Roaming/tedia-pros/autoshort-checkpoints/video-input-07/checkpoint.json:3016).
- [Bản dịch cùng ID](C:/Users/PC/AppData/Roaming/tedia-pros/autoshort-checkpoints/video-input-07/checkpoint.json:6073).
- [Batch provider được lưu](C:/Users/PC/AppData/Roaming/tedia-pros/autoshort-checkpoints/video-input-07/checkpoint.json:5348).
- [Log nhóm ban đầu](F:/Test_video/autoflow-batch-live-20260909-rerun2.log:1573).
- [Log split](F:/Test_video/autoflow-batch-live-20260909-rerun2.log:1624).
- [Log measured rescue và lỗi](F:/Test_video/autoflow-batch-live-20260909-rerun2.log:1714).
- `src/main/dubbing/plan.ts:110`: effectiveGap cho cue rất ngắn được giảm theo rawGap.
- `src/main/dubbing/synthesis.ts:710`: time-map dùng `state.current.naturalDuration` tốt nhất và `state.safeAvailable`.
- `src/main/autoShortContentQuality.ts:224`: protected-token mismatch là warning.

## 7. Bàn giao

Lỗi số học đã giải thích và tái hiện. Việc tiếp theo là sửa/kiểm tra bản dịch bị lệch nội dung ở batch 45–58; không tự thay đổi quy tắc 40% hoặc cho chạy tiếp batch chỉ để vượt qua lỗi.
