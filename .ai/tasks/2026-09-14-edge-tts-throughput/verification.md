# Edge-TTS throughput verification — 2026-09-14

## Local/code gates

- `npm.cmd run typecheck`: PASS, node và web 0 lỗi.
- `npm.cmd run test:local-runtime`: PASS toàn bộ runner; các case có điều kiện thiếu `TEDIAPROS_TEST_FFMPEG` được runner ghi SKIP như trước.
- `npm.cmd run build`: PASS production Main, preload và renderer.
- Full `npm.cmd run test:local-runtime` sau thay đổi cuối: PASS, exit 0; các case yêu cầu `TEDIAPROS_TEST_FFMPEG` tiếp tục SKIP có điều kiện như runner ghi nhận.
- Regression mới: scheduler/recovery 6 PASS; preparation queue 4 PASS, gồm 500 unique unit, cap 2 và lookahead 4; Edge adapter 20 PASS.
- `ipc-origin-validation.test` 4 PASS và `autoshort-ui-contract.test` 4 PASS sau khi bổ sung exact file-entry gate cho `electron-vite preview`.

## Preview startup gate

`npm.cmd run start` nạp đúng entry `file:///F:/Son/tool/TediaPros/out/renderer/index.html` theo nhánh `loadFile(rendererEntryPath)`. Cửa sổ mới có tiêu đề `TediaPros`, PID `20128`, `Responding=True`. Log phiên `tediapros-preview-20260914-085319` có startup, dependency/GPU checks bình thường và không còn lỗi `Nguồn IPC Auto Short không được phép.` từng xảy ra ở `whisper:modelStatus` và `autoshort:getReadiness`.

Origin gate chỉ cho đúng file entry nội bộ (query/hash được phép); sibling/arbitrary file URL và child frame vẫn bị từ chối. Cùng điều kiện exact-entry cũng áp dụng cho packaged build.

## Live full-adapter gates

Managed FFmpeg lấy từ runtime profile đã checksum. Mọi sample thành công đều đi qua WebSocket, full decode PCM WAV, FFprobe duration, positive-size stat và SHA-256 trước khi scratch bị xóa.

| Gate | Kết quả | Tổng thời gian | p50 | p95 | Peak | Retry |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 50 request, concurrency 1 | 50/50 audio hợp lệ | 389,809 ms | 6,959 ms | 12,834 ms | 1 | 11 |
| 100 request, concurrency 2 | 96 success + 1 exhausted failure; dừng ở 97/100 | 241,669 ms | 2,579 ms | 11,315 ms | 2 | 7 |
| 100 request, concurrency 1, spacing 1.000 ms | 100/100 audio hợp lệ | 152,796 ms | 1,021 ms | 2,091 ms | 1 | 3 |
| 100 request, concurrency 1, spacing 1.500 ms | 100/100 audio hợp lệ | 150,391 ms | 1,506 ms | 1,652 ms | 1 | 0 |
| 100 request, concurrency 2, spacing 1.500 ms | 100/100 audio hợp lệ | 150,039 ms | 3,015 ms | 3,093 ms | active 1, queued 2 | 0 |
| 500 request, concurrency 1, spacing 1.500 ms | 283 success, 8 exhausted; circuit từ chối cục bộ 209 mẫu còn lại | 2,126,814 ms | 6,580 ms success-only | 15,567 ms success-only | 1 | 59 |

Lượt 100 cũ không gặp `403` hoặc `429`, nhưng sample 95 gặp `transient_network` ở cả ba attempt và không có audio hợp lệ. Harness phiên đó dừng khi một request transient đã hết retry, nên ba sample cuối chưa được dispatch.

Phát hiện này dẫn tới một sửa lỗi bổ sung: typed `transient_network` giờ được giữ xuyên qua TTS cache adapter, request hết ba attempt mở cooldown 30 giây, và queue AutoShort cho item đúng một recovery pass dùng lại các cue cache hit. Regression xác nhận pass thứ hai không thể lặp vô hạn. Sau sửa, lượt 100 ở spacing 1.000 ms đạt đủ mẫu nhưng có 3 retry; tăng spacing lên 1.500 ms cho hai lượt concurrency 1/2 đều đạt 100/100 và 0 retry.

Concurrency 2 không rút ngắn tổng thời gian ở spacing 1.500 ms: peak active thực tế vẫn là 1 và p50 theo logical request tăng do request thứ hai chờ admission. Vì vậy scheduler mặc định dùng spacing 1.500 ms và preset 1; preset 2 tiếp tục mang nhãn thử nghiệm.

Lượt 500 không đạt gate. Có 291 logical request tới network, trong đó 283 thành công và 8 lỗi sau retry. Tổng 350 network attempt có 67 transient attempt lỗi (19,14%); 36 logical request được recovery thành công. Sau hai half-open probe không đạt, circuit mở và 209 sample còn lại bị từ chối cục bộ, không gửi tiếp ra Edge. 283 output thành công đều có WAV decode/probe hợp lệ, kích thước dương và 283 SHA-256 riêng biệt. P50/P95 trong bảng chỉ tính success; trường `wallP50Ms` cũ trong JSON tính cả các từ chối circuit tức thời nên không dùng để đánh giá latency thành công.

Harness sau phép đo được sửa để dừng ngay ở `circuit_open`, đồng thời ghi riêng `successWallP50Ms`, `successWallP95Ms`, số network attempt và số failure attempt. Artifact lịch sử vẫn giữ nguyên để bảo toàn bằng chứng thực tế.

Artifacts:

- `live-50-c1.json`: chi tiết 50 sample và attempt.
- `live-100-c2.json`: chi tiết 97 sample đã chạy và failure sample 95.
- `live-100-c1-rerun.json`: 100/100 ở spacing 1.000 ms, 3 retry.
- `live-100-c1-spacing1500.json`: 100/100 ở spacing 1.500 ms, 0 retry.
- `live-100-c2-spacing1500.json`: 100/100 ở spacing 1.500 ms, 0 retry.
- `live-500-c1-spacing1500.json`: gate 500 không đạt; 283 success trước khi circuit mở.

## Video DALAM

Hai source người dùng chỉ định vẫn nguyên vẹn:

- DALAM-01 SHA-256 `50140CA1D518F4DBE80D564BBABCE727790F066E619D31AA3D45CBCD4042E1EE`
- DALAM-02 SHA-256 `5CD216B7145AC65CD49AA1D8B2F3A758184CA4B7B2E2F5F166FA6DDA77A57BD9`

DALAM-01 TTS-only đã chạy bằng pipeline AutoShort thật để cô lập Edge TTS khỏi translation server: 56 source cue → 32 speech unit → 32/32 clip, 29 request mới đều thành công attempt đầu và 3 cache hit, output H.264/AAC dài 131 giây. Timeline không overflow/cut-off/overlap; tempo lớn nhất 1.0918x. Source hash trước/sau trùng nhau. Xem `.ai/tasks/2026-09-14-edge-tts-dalam-acceptance/acceptance.md`.

Lượt target tiếng Việt dừng ở preflight do local translation endpoint timeout 30 giây. Đây là nghẽn dịch độc lập; chưa có bằng chứng output dịch tiếng Việt. DALAM-02 và ma trận A/B/warm/cancel chưa chạy.

## Kết luận vận hành

Code path mới đạt local correctness/build gate và live 100 gate. Live 500 không đạt và chứng minh 400–500 request mạng liên tục chưa ổn định trên Edge trong phiên này. Spacing mặc định 1.500 ms vẫn giảm retry ở cửa sổ 100; ở tải dài, app dừng an toàn bằng circuit thay vì tiếp tục gửi request. Không tăng preset mặc định hoặc quảng bá 400–500 request/video là ổn định từ kết quả này.
