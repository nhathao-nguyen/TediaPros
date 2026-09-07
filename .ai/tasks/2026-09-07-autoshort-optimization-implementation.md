# TEDIA-AUTOSHORT-OPT-20260907: Implement kế hoạch tối ưu AutoShort

- **Trạng thái:** Đã kiểm chứng cục bộ, chờ review/integration
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-07
- **Nhánh:** `codex/autoshort-optimization`

---

## 1. Mục Tiêu

Đưa các phần có thể chứng minh của kế hoạch tối ưu AutoShort vào codebase:
khóa lỗi correctness trước, giảm chờ khi an toàn, tái sử dụng artifact theo
content identity, giữ chất lượng nội dung/media, và làm cho telemetry/release
fail closed. Những nhánh cần server, binary hoặc hardware chưa đủ bằng chứng
được giữ opt-in/unqualified thay vì tự bật.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] Tempo synthesis và validator dùng trần cứng 1.45x, không cắt lời hoặc nới deadline để qua gate.
- [x] Junction/path, lease/process close, disk reservation, OCR/Douyin result và package verifier có regression.
- [x] OCR stream reader bounded/cancel-safe; transport negotiation không dùng stream khi runtime không advertise feature.
- [x] Overlap bắt đầu sau source ASR/checkpoint; TTS prefetch tối đa một cue và request vẫn serialized.
- [x] Artifact cache atomic, immutable best effort, SHA-256, quota/TTL/LRU, pin và clear không xóa reader đang dùng.
- [x] Stage keys có source content digest; ASR/translation/visual OCR/trim PCM cache hit được validate trước khi dùng.
- [x] Title chuẩn bị song song render nhưng chỉ ghi sau media validation/publication; lỗi title không làm mất video.
- [x] Content structural QA và renderer progress coalescing có test.
- [x] AutoShort IPC kiểm tra sender origin/top-level frame; navigation/redirect ngoài app origin bị chặn.
- [x] Typecheck và các suite liên quan pass trong evidence bên dưới.
- [ ] Fresh package/install, live server, full corpus/hardware matrix và macOS qualification chưa đạt gate.

## 3. Phạm Vi Triển Khai

### Thuộc phạm vi

- `src/main/` AutoShort policy/coordinator/cache/title/burn/resource/disk/OCR/Douyin.
- OCR Python stream reader và tests.
- Benchmark schema/summarizer với redaction và critical-path accounting.
- Content QA, renderer progress coalescer và test runner registration.
- Benchmark/release/qualification/handoff docs.

### Nằm ngoài phạm vi

- Không sửa `LICENSE`, `NOTICE`, model license hoặc typed IPC thành raw event.
- Không tự đổi model, FP16/quantization, ROI/FPS/encoder/preset hoặc STTN quality.
- Không tạo endpoint/backend TTS/Whisper resident, không tải binary/model mới và
  không claim KPI khi chưa có run live/hardware.
- Không xóa output/cache/scratch của người dùng ngoài scope app.

## 4. Quyết Định Kiến Trúc & Lý Do

- **Policy bảo thủ:** config cũ nhận `maxActiveItems=1`, overlap/prefetch off và
  `legacy-disk`; feature mới phải qua capability gate. Runtime OCR cài trên máy
  đang là 1.1.0, healthy nhưng không có stream feature.
- **Content identity:** hash SHA-256 source một lần mỗi item; checkpoint và stage
  cache không dựa riêng size/mtime.
- **Cache:** manifest được publish sau artifact copy/hash; reader pin giữ entry;
  writer single-flight và waiter abort không hủy writer chung.
- **Scheduling:** visual branch plain Whisper chỉ bắt đầu sau source cues đã
  được lưu; fused Whisper+OCR vẫn chạy hai provider cùng stage để giữ fallback.
- **TTS/title:** server request vẫn tuần tự; prefetch là một lookahead có thể
  bị discard an toàn. Title là optional và chỉ commit sau output media gate.
- **QA:** structural checks báo lỗi rõ ràng nhưng không tự sửa text/nghĩa; human
  review vẫn cần cho semantic fidelity và chất lượng nghe/xem.

## 5. Danh Sách Tệp Thay Đổi

Các nhóm tệp chính:

- `[NEW]` `src/main/autoShortArtifactCache.ts`, `src/main/autoShortStageKeys.ts`, `src/main/autoShortContentQuality.ts`.
- `[NEW]` `src/renderer/src/lib/autoshortProgressCoalescer.ts`.
- `[NEW]` benchmark scripts, cache/quality/scheduling/title/UI tests và các
  report trong `docs/benchmarks`, `docs/releases`, `docs/reviews`.
- `[MODIFY]` `autoShortItemCoordinator.ts`, `autoshort.ts`, `dubbing/synthesis.ts`,
  `dubbing/policy.ts`, `burn.ts`, `videoTitle.ts`, OCR,
  resource/disk/path/audioPreview/Douyin, renderer AutoShort và release verifier.
- `[MODIFY]` Python OCR stream reader, test runner và regression fixtures.

Danh sách đầy đủ xem bằng `git diff --name-status` trên nhánh này; không stage
toàn bộ workspace vì còn file local không thuộc task.

## 6. Kiểm Chứng & Bằng Chứng

### Các lệnh đã chạy

```powershell
npm.cmd install --no-audit --no-fund
npm.cmd run typecheck:node
npm.cmd run typecheck:web
node scripts/run-local-runtime-tests.mjs autoshort-stage-cache.test autoshort-artifact-cache.test autoshort-ocr-pipeline.test autoshort-ui-contract.test
node scripts/run-local-runtime-tests.mjs autoshort-content-quality.test autoshort-benchmark.test
node scripts/run-local-runtime-tests.mjs autoshort-tts-pipeline.test autoshort-item-scope.test
node scripts/run-local-runtime-tests.mjs autoshort-trim-cache.test ipc-origin-validation.test
npm.cmd run test:ocr-engine
npm.cmd run test:sttn-engine
npm.cmd run test:separator-engine
npm.cmd run test:subtitles
npm.cmd run build
npm.cmd run release:verify
```

### Kết quả thực tế

- Typecheck node/web: PASS, 0 lỗi.
- `npm.cmd run typecheck`: PASS; `npm.cmd run build`: PASS với các cảnh báo
  dynamic-import đã có.
- `npm.cmd run test:local-runtime`: PASS toàn bộ suite đã đăng ký; cache/stage/OCR/
  UI/content/benchmark/TTS/scope/trim-key/IPC suites đều xanh.
- Fixture scheduling đã được đổi từ `sleep(60ms)` sang tín hiệu hoàn tất ASR;
  test `autoshort-item-scope` chạy lặp 10 lần đều pass, tránh flake khi máy bận.
- OCR Python: PASS, 32 tests, gồm bounded queue, EOF, cancel, timeout và visual timeline.
- STTN engine: PASS 26 tests, 17 skip vì thiếu PyTorch/media dependencies.
- Separator engine: PASS 13 tests. Subtitle smoke: PASS logic, render FFmpeg skip
  vì binary không có trong PATH. Release metadata: PASS.
- Runtime hiện cài probe: version 1.1.0, `ready=true`, không có
  `visual-stream-full-v1`; đây là lý do stream-full không được bật mặc định.

### Chưa kiểm tra / rủi ro

- Đã chạy `npm.cmd run typecheck`, `npm.cmd run test:local-runtime` và
  `git diff --check` sau các chỉnh sửa cuối.
- `fonts:verify` bị chặn do thiếu `NotoSans.ttf`; `release:verify-runtime` thiếu
  `release-artifacts/runtime-manifest.json`; package/setup asset verifiers fail
  closed vì chưa có `dist` hoặc installer artifact.
- Chưa có benchmark-v1 live, corpus media tám clip, E2E server dịch/TTS, fresh
  install/rollback package, two-item hardware hoặc macOS.
- Cache `put/prune` thêm I/O/hash; lợi ích latency chưa được đo. Cache hit chỉ là
  giảm công việc lặp, không phải inference nhanh hơn.
- Content QA chỉ structural; bản dịch/rephrase có thể vẫn cần human review.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao

1. Chạy final gates và review diff theo nhóm correctness → cache → UI/docs.
2. Dùng `docs/benchmarks/autoshort-optimization-protocol.md` để tạo manifest và
   run A/B; chỉ bật từng cờ sau khi quality matrix đạt.
3. Giữ T15/T16 off/unqualified cho đến khi có backend/server/hardware evidence.
4. Khi tích hợp, chỉ stage explicit files của task; giữ nguyên file untracked
   local và không ghi đè output người dùng.
