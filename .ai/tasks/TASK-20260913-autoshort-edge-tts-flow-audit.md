# TASK-20260913: Kiểm tra điểm chặn và nghẽn Edge-TTS trong AutoShort

- **Trạng thái:** Đã kiểm chứng; không thấy provider block trong probe hiện tại, còn điểm nghẽn thiết kế
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-13

## 1. Mục tiêu

Kiểm tra đường Edge-TTS của AutoShort từ preflight, queue, cache, synthesis từng cue, audio DSP đến cancellation; phân biệt bằng chứng code/test/live với log Local TTS cũ và phần chưa được chứng minh.

## 2. Kết luận

- `LIVE_PROBE`: 8/8 request thử nghiệm qua adapter `msedge-tts@2.0.7` thành công; gồm sáu request nối tiếp và hai request đồng thời. Median 1.304 giây, min 1.185 giây, max 3.263 giây; không gặp 403, 429, timeout hoặc socket error.
- `TEST_CONFIRMED`: 51 test liên quan Edge adapter, AutoShort Edge/cache/pipeline, queue và resource manager pass.
- `CODE_CONFIRMED`: cấu hình mặc định chạy một video, tắt TTS prefetch và tổng hợp cue tuần tự. Không có deadlock trong resource manager hoặc cache single-flight theo test hiện có.
- `CODE_CONFIRMED`: preflight Edge chạy một lần cho toàn batch. Nếu catalog live hoặc synthesis probe thất bại, toàn batch dừng trước item đầu tiên. Mỗi bước có deadline 60 giây.
- `CODE_CONFIRMED`: mỗi cache miss mở WebSocket mới, nhận MP3, chạy FFmpeg decode sang PCM WAV, FFprobe duration, copy cache, rồi trim. Đây là chi phí tuyến tính theo số cue.
- `CODE_CONFIRMED`: lỗi transport Edge giữa batch làm item hiện tại lỗi; queue vẫn sang item sau. Recovery tự động hiện chỉ áp dụng cho duration/quality, chưa áp dụng cho timeout, 403/429 hoặc socket reset.
- `HISTORICAL_LOG`: log Local voice-clone trước khi tích hợp Edge có 422 span TTS, 421 cache miss, median 20.192 giây và p90 59.096 giây. Không dùng số này làm dự báo Edge.

## 3. Phạm vi và giới hạn

- Probe chỉ dùng câu thử tổng hợp, không gửi nội dung hoặc video của người dùng.
- Live smoke tích hợp trước đó đã pass 4/4 ngôn ngữ và full decode, nhưng chưa chạy một video AutoShort thật bằng Edge-TTS.
- Chưa có soak dài hàng trăm cue, kiểm tra nhiều giờ hoặc SLA/rate-limit chính thức của Microsoft Read Aloud endpoint. Không thể cam kết endpoint sẽ không throttle hoặc thay đổi trong tương lai.

## 4. Khuyến nghị vận hành

- Giữ mặc định `maxActiveItems=1`, `prefetchTts=false` khi dùng Edge-TTS.
- Batch nhỏ có thể chạy ngay; theo dõi `requestSpans`, `stage=tts`, cache hit/miss và lỗi transport trong audit artifact.
- Chưa bật đồng thời hai item cộng prefetch vì code chưa có lane giới hạn concurrency riêng cho Edge.
- Ưu tiên tiếp theo nếu cần độ bền batch dài: một retry transport có backoff/jitter cho từng cue, circuit breaker để tránh lặp timeout trên nhiều item, và lane Edge toàn cục trước khi mở concurrency.

## 5. Bằng chứng

- `.ai/tasks/2026-09-13-autoshort-edge-tts-flow-audit/probe.json`: kết quả live burst.
- `.ai/tasks/2026-09-13-autoshort-edge-tts-flow-audit/probe.ts`: probe dùng đúng transport của project.
- `.ai/tasks/2026-09-12-edge-tts-integration/live-smoke.json`: catalog, WebSocket, decode và duration probe bốn ngôn ngữ.
- Lệnh test:

```powershell
npm.cmd run test:local-runtime -- edge-tts-adapter.test autoshort-edge-tts.test autoshort-tts-cache.test autoshort-tts-pipeline.test autoshort-queue-throughput.test autoshort-resource-manager.test
```

- Kết quả: 51 pass, 0 fail.
