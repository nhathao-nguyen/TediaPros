# ADR 010: Lập lịch Edge-TTS có giới hạn và chuẩn bị cue theo thứ tự nguồn

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-14

## Bối cảnh

AutoShort có thể cần hàng trăm speech unit cho một batch. Gọi Edge-TTS tuần tự làm tăng thời gian chờ, nhưng mở concurrency không giới hạn dễ tạo burst, giữ quá nhiều audio tạm và làm nhiều video cùng lặp lại một lỗi dịch vụ. Timeline dubbing còn yêu cầu predictor, overflow và reflow được cập nhật đúng thứ tự cue nguồn.

## Quyết định

Main process sở hữu một `EdgeTtsScheduler` dùng chung cho catalog, synthesis probe và synthesis thực tế. Scheduler có hai preset hợp lệ: `1` và `2`, giãn thời điểm bắt đầu request mặc định 1 giây, retry tối đa ba attempt cho 429, timeout mạng, lỗi kết nối tạm thời và 5xx. Retry dùng backoff 2/4 giây cộng jitter; 429 tôn trọng thời gian lớn hơn giữa backoff và `Retry-After`, đồng thời hạ concurrency về 1.

HTTP 403/401 mở trạng thái `access_denied` và dừng dispatch. Ba lỗi transport liên tiếp mở circuit 30 giây; chỉ một request được dùng làm probe, và hai probe lỗi chuyển sang chờ thao tác chạy/tiếp tục mới. `nextEligibleAt`, circuit và lý do block được ghi atomically trong user data để restart không xóa cooldown.

Preset `2` dùng `PreparationQueue` trong dubbing. Queue có hai worker, lookahead tối đa bốn cue, chuẩn bị synthesis/trim/duration ở ngoài thứ tự nhưng chỉ trả kết quả cho planner theo thứ tự nguồn. Predictor, overflow, structural split, rephrase và finalization vẫn chạy tuần tự. Legacy `prefetchTts` không chạy cùng preparation queue. Decode và probe Edge dùng lease `local-audio-dsp` hiện có.

`executionPolicy` chỉ điều khiển lịch chạy nên bị loại khỏi content checkpoint digest. Resume có thể đổi preset mà không làm mất media/cache hợp lệ; matcher vẫn nhận digest cũ để tương thích journal đã tạo.

## Hệ quả

- Mặc định vẫn là một request. Người dùng phải chọn preset thử nghiệm để mở tối đa hai request.
- Một 429 tự hạ scheduler về một request cho phần còn lại của tiến trình; không tự tăng lại.
- Queue giữ số work và file tạm hữu hạn theo concurrency/lookahead, còn output cue luôn theo source order.
- UI có thể hiển thị số request đang chạy/chờ, circuit/cooldown và thời gian thử lại qua progress hiện có; không thêm IPC không định kiểu.
- Scheduler hiện giữ slot cho tới khi request đã decode, probe và publish xong. Điều này thận trọng hơn việc trả slot ngay sau khi đóng socket và tránh vượt cap khi cleanup chưa quiesce.

## Kiểm chứng bắt buộc

Chạy typecheck; scheduler/recovery tests; preparation queue gồm corpus giả lập 500 unit; dubbing, cache, cancellation, resource, telemetry, resume và UI contract tests. Live load phải tăng theo 50 rồi 100 rồi 500; dừng tăng nếu gặp 403/429 và không dùng kết quả local để tuyên bố dịch vụ luôn chịu tải.
