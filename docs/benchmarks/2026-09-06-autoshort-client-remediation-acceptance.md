# AutoShort client remediation acceptance

**Ngày kiểm tra:** 2026-09-06  
**Workspace:** `F:\Son\tool\TediaPros`  
**Phạm vi:** C6–C10 của `docs/superpowers/plans/codex-handoff-c6-c10.md`  
**Backend:** không thay đổi; các kiểm tra server dùng mock/fixture cục bộ.

## Trạng thái triển khai

| Mốc | Đã triển khai | Đã kiểm chứng | Được bật mặc định |
|---|---|---|---|
| C6 telemetry | Sanitize tại biên ghi, quota chung job, terminal reserve, progress coalesce | `autoshort-telemetry.test`: 11/11 | Có, không đổi hành vi đầu ra |
| C7 OCR transport | Capability negotiation, `stream-full`/`stream-roi`, alias legacy, provider report, implementation fingerprint | Python OCR: 31/31; OCR transport runtime: 13/13; PyInstaller build hoàn tất; executable `--version` trả 1.2.0 | Không; policy vẫn `legacy-disk` |
| C8 retry/TTS | Deadline theo item, giới hạn request chỉ bật khi gọi rõ `maxRequests`, Retry-After HTTP-date/giây, phục hồi response thiếu/thừa cue theo ID, TTS single-flight + atomic commit + audio-container check + content hash/model revision | `local-translation.test`: 11/11; `autoshort-tts-cache.test`: 4/4 | TTS cache có; không tăng concurrency |
| C9 disk ledger | Reservation future bytes, update/release, FIFO chờ theo volume, cancellation/ENOSPC, queue admission | `autoshort-disk-budget.test`: 6/6; queue throughput: 4/4 | Hai item chưa được qualify |
| C10 acceptance | Test runner đã đăng ký test mới; artifact này ghi evidence và giới hạn | Xem bảng kiểm bên dưới | Conservative |

## Kiểm tra đã chạy

| Lệnh | Kết quả | Ghi chú |
|---|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` | PASS | TypeScript toàn workspace |
| `npm.cmd run typecheck` | PASS | Node + renderer |
| `npm.cmd run test:local-runtime` | PASS | Tất cả test đã đăng ký; có fixture/mock và native FFmpeg cục bộ |
| `npm.cmd run test:ocr-engine` | PASS | 31 test, 0 fail |
| `npm.cmd run test:sttn-engine` | PASS | 21 test, 12 skipped vì thiếu PyTorch/PyAV hoặc `STTN_TEST_FFMPEG` |
| `python -m PyInstaller ... engines/ocr-engine/ocr-engine.spec` | PASS | Build vào `release-artifacts/ocr-client-remediation/dist` |
| Built OCR `--version` | PASS | Version 1.2.0, đủ feature stream và fingerprint `1e0c8bd778d9d97cf129c891e053b0421f5b43b4c3d0914e29e38c63b614c6a4` |
| Built OCR `--probe` | BLOCKED | Môi trường build Python 3.14 thiếu `rapidocr_onnxruntime`; trả `ready:false`, nên không qualify installed runtime |
| `npm.cmd run build` | BLOCKED ở output mặc định | Main/preload đã build; renderer bị `EPERM` khi Vite dọn `out/renderer/assets` đang bị tiến trình khác sử dụng |
| `npm.cmd run build -- --outDir out-codex-check` | PASS | Build đầy đủ main/preload/renderer vào output riêng |
| `git diff --check` | PASS | Chỉ cảnh báo line ending CRLF hiện hữu |

## Fault matrix

| Tình huống | Kết quả hiện tại |
|---|---|
| ASR lỗi trong lúc OCR chạy | Có test coordinator; scope hủy nhánh còn lại và chờ drain |
| OCR lỗi trong lúc ASR chờ | Có test; giữ lỗi gốc và dọn work directory |
| STTN lỗi/TTS lỗi/DSP lỗi | Có fixture cleanup và propagation; chưa phải live GPU/server acceptance |
| Cancel all | Queue đánh dấu item chưa chạy là cancelled; child process dùng process-tree fence |
| Translation 403/429/timeout | 403 không retry; retry transport chịu deadline và giới hạn request tùy chọn; chưa tải live backend |
| Translation response thiếu/thừa cue | Giữ các cue hợp lệ, gọi lại đúng các ID còn thiếu; cue ngữ cảnh ngoài batch chỉ bị bỏ qua khi mọi ID hiện tại đã xuất hiện đúng một lần; response không có cue hợp lệ kết thúc theo cấu trúc hoặc deadline, không tự sinh bản dịch |
| Corrupt/partial TTS cache | Cache kiểm tra chữ ký container audio và kích thước; producer ghi temp rồi commit nguyên tử, single-flight không lộ temp; lỗi trim từ entry đã cache được bypass tối đa một lần. Probe codec/thời lượng sâu vẫn do FFmpeg đảm nhiệm |
| Disk hết | Ledger trả ENOSPC trước admission nếu không thể fit; reservation được release khi lỗi/hủy |
| App shutdown | Existing shutdown cancellation path giữ nguyên; không có claim crash-resume đầy đủ |
| Two-item queue | Đã kiểm thử ledger admission bằng fixture; chưa bật release vì thiếu T8 resume/cache và quality qualification |

## Quyết định rollout

- Giữ `maxActiveItems: 1`, `overlapIndependentStages: false`, `prefetchTts: false`, `ocrTransport: 'legacy-disk'` làm mặc định.
- `stream-full`, `stream-roi`, overlap và two-item chỉ là đường thử nghiệm có cờ/policy; không tuyên bố OCR 2× hay queue nhanh hơn khi chưa có corpus/hardware benchmark.
- OCR runtime 1.2.0 đã build được nhưng probe không ready trong môi trường hiện tại, vì vậy installer/installed-path và quality corpus vẫn **chưa được qualify**.
- C8/C9 không yêu cầu backend thay đổi endpoint hoặc request body.

## Giới hạn còn lại

Full `StageArtifactV1`/job store, crash resume, quota TTL/LRU toàn cache, live TTS/translation, canonical installed OCR→STTN→render trên máy production và benchmark queue 10/15 video vẫn chưa được chứng minh trong workspace này.
