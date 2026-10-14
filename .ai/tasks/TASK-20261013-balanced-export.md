# TASK-20261013-balanced-export: Tối ưu hiệu ứng và xuất video theo ưu tiên cân bằng

- **Trạng thái:** Hoàn thành và kiểm chứng source/dev; bản cài đặt chưa nâng cấp.
- **Người thực hiện:** Codex `/root`
- **Thời gian:** 2026-10-13
- **Checkout:** `F:\Son\tool\TediaPros`, nhánh `SonVersion`; giữ các thay đổi đang có, chưa commit/push.

## 1. Mục Tiêu (Goal)

Người dùng chọn cân bằng chất lượng, tốc độ và dung lượng. Áp dụng tối ưu thuật toán/kiến trúc cho pipeline hiệu ứng và xuất cuối chung của AutoShort/dịch màn hình, tiếp nối sửa RGB và lớp texture. Dung lượng không được giảm bằng cách xóa chi tiết hiệu ứng hoặc thêm lượt encode video người dùng.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Policy encoder xác định theo nguồn và hiệu ứng; không đổi ngẫu nhiên CQ/GOP.
- [x] Share decode/resize texture trùng và hoist pass một frame; pixel, thứ tự lớp và cường độ giữ đúng.
- [x] Bảo vệ headroom hạt nhiễu; kiểm tra độc lập chất lượng so với graph sau hiệu ứng.
- [x] Export thật giữ frame count/duration/audio, full decode và dọn scratch trong các lượt hoàn thành.
- [x] Chọn CPU → GPU → CPU thật không bị cache encoder của loại job trước ghi đè; telemetry được giữ qua publication.
- [x] `npm.cmd run typecheck`, build, test liên quan và UI smoke pass.
- [x] ADR/tài liệu/bằng chứng được cập nhật. Có ghi rõ giới hạn và thư mục thí nghiệm còn lại do cleanup bị policy chặn.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- Policy xuất H.264 cuối tại `burn.ts`, video-stream metadata, dùng chung decoder/geometry RGB và cache frame tĩnh, metadata nhập texture/vault, telemetry và regression.
- Không triển khai shader engine GPU mới, thay engine CapCut native, keyframe, hệ thống batch mới hoặc thêm lựa chọn UI. Không thay đổi FPS/độ phân giải để lấy số đo nhỏ hơn.
- Không đóng gói/cài/release, không đăng Facebook, không chạy lại dịch/TTS live. Giữ nguyên các thay đổi source đang có từ phần sửa trước trong cuộc trò chuyện.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- [ADR 014](../../docs/adr/014-balanced-video-export-policy.md): tách pure encoder policy khỏi graph/lifecycle. NVENC VBR CQ và CPU CRF giữ chất lượng mục tiêu, có trần đỉnh từ bitrate nguồn, codec, geometry và loại hiệu ứng. Bitrate container không được dùng làm bitrate video.
- Normal texture dùng NVENC P4 CQ24 / CPU faster CRF22. Grain/analog giữ CQ23 / CRF21 và headroom lớn hơn. Trần thấp ban đầu đã bị loại vì làm giảm SSIM hạt nhiễu.
- Source rất ít dữ liệu hình ở ≤1080p/30 FPS và stack đủ metadata có thể ưu tiên CPU; đây là heuristic có giới hạn, không phải phân tích chuyển động mọi cảnh. Cache encoder theo đường dẫn FFmpeg + preference.
- Deduplicate asset input theo đường dẫn + mode static/dynamic; RGB resize/color một lần rồi split. `isStatic` từ sequence một frame cho phép lặp frame sau resize. Dữ liệu cũ thiếu cờ tiếp tục dùng đường động đúng chức năng.
- Giữ FFmpeg auto threads: ép 4 luồng chậm hơn khoảng 32% trên probe. Giữ P4: P5 chậm/lớn hơn với lợi ích SSIM nhỏ. Không áp cap NVENC/x264 sang AMF/QSV/VideoToolbox chưa được thử phần cứng.
- Giữ encoder attempts/selection trong kết quả `burnAutoShort` để telemetry hiện có phản ánh lựa chọn thật. Âm thanh cần filter dùng AAC128k; audio còn lại copy.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` [videoExportPolicy.ts](../../src/main/videoExportPolicy.ts): policy và encoder candidates.
- `[MODIFY]` [burn.ts](../../src/main/burn.ts): probe bitrate/codec, áp policy, cache theo preference, AAC rate và giữ telemetry.
- `[MODIFY]` [videoEffects.ts](../../src/main/videoEffects.ts): share input/RGB preparation, cache frame tĩnh.
- `[MODIFY]` [videoEffects contract](../../src/shared/videoEffects.ts), [capcutTextureLayers.ts](../../src/main/capcutTextureLayers.ts), [capcutScanner.ts](../../src/main/capcutScanner.ts): optional static flag, metadata v3 và vault.
- `[NEW/MODIFY]` [balanced-video-export.test.ts](../../tests/balanced-video-export.test.ts), [effect-layer-composition.test.ts](../../tests/effect-layer-composition.test.ts), [test runner](../../scripts/run-local-runtime-tests.mjs).
- `[NEW/MODIFY]` ADR 014, [architecture](../../docs/architecture.md), [effects documentation](../../docs/autoshort-video-effects.md), [proof folder](2026-10-13-balanced-export/README.md).

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Các lệnh đã chạy từ root:

```powershell
$env:TEDIAPROS_TEST_FFMPEG=(Get-Command ffmpeg).Source
node scripts/run-local-runtime-tests.mjs balanced-video-export.test effect-layer-composition.test video-effects.test autoshort-overlays.test autoshort-ocr-burn.test video-adjustments.test portrait-blur.test autoshort-ocr-pipeline.test autoshort-ocr-contract.test ipc-origin-validation.test canonical-display-geometry.test rendered-media-validation.test burn-video-title.test autoshort-telemetry.test
npm.cmd run typecheck
npm.cmd run build
node scripts/smoke-effect-layer-ui.mjs
node .ai/tasks/2026-10-13-balanced-export/probe-encoder.mjs
node .ai/tasks/2026-10-13-balanced-export/probe-filter-threads.mjs 0
node .ai/tasks/2026-10-13-balanced-export/probe-filter-threads.mjs 4
node .ai/tasks/2026-10-13-balanced-export/benchmark-pipeline.mjs motion
node .ai/tasks/2026-10-13-balanced-export/benchmark-pipeline.mjs static
node .ai/tasks/2026-10-13-balanced-export/benchmark-pipeline.mjs grain
node .ai/tasks/2026-10-13-balanced-export/summarize.mjs
git diff --check
```

- **Tests:** 133 pass, 0 fail, 3 optional skip across 14 suites. Skip: BurstingSmoke asset not supplied, two title/render tests require an embedded runtime missing on this machine. Separate live FFmpeg/NVENC and CPU renders did run.
- **Typecheck/build:** pass. Build retains existing Vite static/dynamic import warnings.
- **Hidden Electron UI:** pass for ordered passes, group intensity, all selected video effects, matte intensity, seek, play/pause/rate and cleanup. No host mouse/keyboard/focus automation.
- **Raw RGB:** optimized shared/static texture graph exactly matches decoded pixels of previous repeated-input graph, with 24 primary frames retained and reserved narration/mask input indexes unchanged.
- **Actual encoder cache:** production export sequence selects libx264 → h264_nvenc → libx264; first attempts succeed and telemetry survives publication.
- **Benchmark machine:** GTX1660 SUPER, driver616.92, i5-11400F, FFmpeg9.0.2. Generated 720×1280/24 FPS/4-second clips with real Nhiễu2 textures at 50%; three-run medians. Baseline CQ23/GOP60 represents the previous random range.

| Sample / selected path | MP4 bytes before → after | Render before → after | Post-effect SSIM before → after |
| --- | --- | --- | --- |
| Motion, NVENC | 1,870,228 → 1,444,549 (−22.8%) | 2.989 → 2.722 s (−8.9%) | 0.994834 → 0.993578 |
| Low-rate scene, NVENC → CPU | 807,763 → 268,113 (−66.8%) | 3.023 → 3.021 s (near equal) | 0.996766 → 0.995766 |
| Grain35%, NVENC | 3,982,194 → 3,918,922 (−1.6%) | 0.506 → 0.562 s (+11.0%) | 0.753276 → 0.752100 |

Per-case JSON also retains CPU-to-CPU comparisons. CPU grain becomes 4.1% larger/13.8% slower, with SSIM increasing 0.926261 → 0.930476. Size savings and speed improvements are not universal. Reference is a CRF0 export of the same final graph, not the clean source; quality metrics do not replace reviewing actual user footage.

All three final production renders retain 96 frames, four seconds and audio, fully decode and publish atomically. [Summary](2026-10-13-balanced-export/summary.json), [sample MP4](2026-10-13-balanced-export/balanced-motion.mp4), [tests](2026-10-13-balanced-export/tests.log), [typecheck](2026-10-13-balanced-export/typecheck.log), [build](2026-10-13-balanced-export/build.log), [UI smoke](2026-10-13-balanced-export/ui-smoke.log).

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Chỉ source/dev đã được sửa. Chưa đánh giá video người dùng, batch dài, installer, phần cứng AMD/Intel/Apple hoặc Facebook nén lại. Thêm chi tiết hiệu ứng có thể khiến output lớn nhiều lần so với nguồn, nhất là nguồn gần tĩnh hoặc hạt nhiễu.
- Hai lượt probe cộng dồn ban đầu vượt deadline của harness và để lại thư mục riêng trong Temp (khoảng 1.01 MB và 1.17 MB). Codex policy chặn lệnh cleanup PowerShell trước khi tạo process; không thử lại/bypass. Đường dẫn và log superseded được ghi trong [README evidence](2026-10-13-balanced-export/README.md). Final read-only process check thấy không còn FFmpeg chạy. Các lượt đo đơn và test hoàn thành đều dọn scope của chúng.
- Sau này đo trên clip thực/clip dài trước khi đổi ngưỡng heuristic hoặc thêm preset phần cứng. Giữ reference sau hiệu ứng và báo cáo cả trường hợp chậm/lớn hơn; không dùng riêng mức giảm dung lượng làm thước đo chất lượng.
