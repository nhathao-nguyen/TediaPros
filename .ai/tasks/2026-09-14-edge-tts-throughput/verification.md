# Edge-TTS throughput verification — 2026-09-14

## Local/code gates

- `npm.cmd run typecheck`: PASS, node và web 0 lỗi.
- `npm.cmd run test:local-runtime`: PASS toàn bộ runner; các case có điều kiện thiếu `TEDIAPROS_TEST_FFMPEG` được runner ghi SKIP như trước.
- `npm.cmd run build`: PASS production Main, preload và renderer.
- Regression mới: scheduler/recovery 6 PASS; preparation queue 4 PASS, gồm 500 unique unit, cap 2 và lookahead 4; Edge adapter 20 PASS.
- `ipc-origin-validation.test` 4 PASS và `autoshort-ui-contract.test` 4 PASS sau khi bổ sung exact file-entry gate cho `electron-vite preview`.

## Preview startup gate

`npm.cmd run start` nạp đúng entry `file:///F:/Son/tool/TediaPros/out/renderer/index.html` theo nhánh `loadFile(rendererEntryPath)`. Cửa sổ mới có tiêu đề `TediaPros`, PID `20128`, `Responding=True`. Log phiên `tediapros-preview-20260914-085319` có startup, dependency/GPU checks bình thường và không còn lỗi `Nguồn IPC Auto Short không được phép.` từng xảy ra ở `whisper:modelStatus` và `autoshort:getReadiness`.

Origin gate chỉ cho đúng file entry nội bộ (query/hash được phép); sibling/arbitrary file URL và child frame vẫn bị từ chối. Cùng điều kiện exact-entry cũng áp dụng cho packaged build.

## Live full-adapter gates

Managed FFmpeg: `C:\Users\PC\AppData\Roaming\tediapros\bin\ffmpeg.exe`. Mọi sample thành công đều đi qua WebSocket, full decode PCM WAV, FFprobe duration, positive-size stat và SHA-256 trước khi scratch bị xóa.

| Gate | Kết quả | Tổng thời gian | p50 | p95 | Peak | Retry |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 50 request, concurrency 1 | 50/50 audio hợp lệ | 389,809 ms | 6,959 ms | 12,834 ms | 1 | 11 |
| 100 request, concurrency 2 | 96 success + 1 exhausted failure; dừng ở 97/100 | 241,669 ms | 2,579 ms | 11,315 ms | 2 | 7 |

Lượt 100 không gặp `403` hoặc `429`, nhưng sample 95 gặp `transient_network` ở cả ba attempt và không có audio hợp lệ. Harness phiên này dừng khi một request transient đã hết retry, nên ba sample cuối chưa được dispatch. Đây là gate fail vì không đạt 100/100 và retry ratio cũng vượt mục tiêu 1%.

Phát hiện này dẫn tới một sửa lỗi bổ sung: typed `transient_network` giờ được giữ xuyên qua TTS cache adapter, request hết ba attempt mở cooldown 30 giây, và queue AutoShort cho item đúng một recovery pass dùng lại các cue cache hit. Regression xác nhận pass thứ hai không thể lặp vô hạn. Kết quả live ở bảng là bằng chứng trước sửa này và không được đổi thành 100/100 bằng suy luận.

Không chạy mốc 500. Kết quả hiện tại không hỗ trợ kết luận 400–500 request cho một video sẽ ổn định trên Edge-TTS tại thời điểm thử. Preset 2 giảm p50 quan sát được nhưng vẫn để ở nhãn thử nghiệm và mặc định tiếp tục là 1.

Artifacts:

- `live-50-c1.json`: chi tiết 50 sample và attempt.
- `live-100-c2.json`: chi tiết 97 sample đã chạy và failure sample 95.

## Video DALAM

Hai source người dùng chỉ định vẫn nguyên vẹn và chưa chạy full AutoShort vì gate 100 không đạt, đúng thứ tự nghiệm thu trong plan:

- DALAM-01 SHA-256 `50140CA1D518F4DBE80D564BBABCE727790F066E619D31AA3D45CBCD4042E1EE`
- DALAM-02 SHA-256 `5CD216B7145AC65CD49AA1D8B2F3A758184CA4B7B2E2F5F166FA6DDA77A57BD9`

## Kết luận vận hành

Code path mới đạt local correctness gate và build gate. Live service gate chưa đạt để nâng preset 2 thành mặc định hoặc thử 500. Khi chạy lại, harness mới chỉ dừng sớm cho `access_denied`/`rate_limited`; transient exhausted được ghi lại nhưng các sample còn lại vẫn chạy để có denominator đầy đủ.
