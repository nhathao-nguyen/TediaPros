# TASK-20261013-packed-overlay: Sửa vệt chia đôi ở hiệu ứng Overlay

- **Trạng thái:** Hoàn thành, kiểm chứng source/dev; chưa cập nhật bản cài đặt.
- **Người thực hiện:** Codex `/root`
- **Thời gian:** 2026-10-13
- **Checkout:** `F:\Son\tool\TediaPros`, nhánh `SonVersion`; giữ các thay đổi đang có.

## 1. Mục Tiêu (Goal)

Sửa các hiệu ứng dùng video chứa alpha/RGB ở hai nửa để không tạo vệt chia đôi như ảnh người dùng. Chẩn đoán bằng asset thật và sửa xuyên suốt scanner, preview/thẻ, export và dữ liệu kho cũ.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Xác định nguyên nhân bằng gói Overlay thật, không đoán từ screenshot hoặc tỉ lệ video.
- [x] Tách RGB/alpha trước resize/crop, áp đúng blend/cường độ; không đưa mask lên hình.
- [x] Kiểm tra pixel toàn khung, alpha/cường độ, bốn blend và khung chân dung.
- [x] Preview/control Electron và `burnAutoShort` với resource thật pass; frame/audio/full decode đúng.
- [x] Config cũ khôi phục metadata; kho lưu metadata để dùng sau khi cache nguồn bị xóa.
- [x] Tests, typecheck, build, tài liệu/ADR và bàn giao pass.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- Nhận diện họ Lumi video đã kiểm tra với alpha kênh đỏ ở trái/RGB ở phải, các mode Normal/Add/Multiply/Screen; giữ thứ tự và cường độ của pipeline hiện có.
- Không thực thi Lua/shader ngoài, không thay cơ chế OCR RGB, audio mapping, EOF/cancel hoặc thêm lượt encode trung gian.
- Không tải tài nguyên mới, sửa gói CapCut gốc, cài/release/push hoặc tái tạo toàn bộ shader/keyframe của preset. Video người dùng trong screenshot không được dùng cho fixture; nguồn mẫu màu được sinh, hiệu ứng là asset thật.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- **Nguyên nhân đã xác minh:** file `overlay.mp4` 1024×512 có mask trắng ở trái và màu phim ở phải. Metadata bật `enableVideoAlphaBlend_1_1`; shader lấy alpha từ red bên trái/RGB bên phải. Blend của layer là Multiply (2), còn scanner cũ ghép nguyên MP4 bằng Screen. Cả hai lỗi tạo vùng trắng và vệt giữa.
- [ADR 015](../../docs/adr/015-packed-video-alpha-layout.md): optional typed `packedAlpha: 'left'`; chỉ nhận diện từ metadata + shader sampling + binding MP4 duy nhất. Không phân loại theo tên hoặc hình dạng. Khước từ layout lạ hoặc kết hợp mâu thuẫn với matte/key/layers.
- FFmpeg split một frame decode, crop hai nửa, red-plane alpha, alphamerge rồi mới resize/crop. Canvas dùng cùng geometry và alpha, raw video được ẩn. Multiply/Screen giữ phần tử trung tính; Add clip đúng, Normal dùng alpha/cường độ.
- Kho cũ khôi phục/persist layout và blend, kho mới không phụ thuộc cache CapCut. Không thêm endpoint IPC mới; dùng typed composition hiện có.
- Test UI lớp cũ từng chụp frame compositor trước khi canvas mới được trình bày sau đổi intensity. Sửa harness bằng predicate màu của screenshot có giới hạn 1,5 giây; giữ nguyên công thức expected và tolerance, không che lỗi pixel hoặc tăng deadline toàn cục.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` [capcutPackedAlpha.ts](../../src/main/capcutPackedAlpha.ts): literal/binding reader có containment/resource bounds.
- `[MODIFY]` [videoEffects contract](../../src/shared/videoEffects.ts), [capcutScanner.ts](../../src/main/capcutScanner.ts): trường optional, scanner, legacy recovery/vault persistence.
- `[MODIFY]` [videoEffects.ts](../../src/main/videoEffects.ts): unpack/compose trong graph cuối.
- `[MODIFY]` [VideoEffectsPreview.tsx](../../src/renderer/src/components/VideoEffectsPreview.tsx), [VideoEffectsControl.tsx](../../src/renderer/src/components/VideoEffectsControl.tsx): canvas alpha/blend và picker propagation.
- `[NEW/MODIFY]` [packed-video-alpha.test.ts](../../tests/packed-video-alpha.test.ts), [runner](../../scripts/run-local-runtime-tests.mjs), [verify-packed-overlay.mjs](../../scripts/verify-packed-overlay.mjs), [layer UI harness](../../scripts/smoke-effect-layer-ui.mjs).
- `[NEW/MODIFY]` ADR015, [effects guide](../../docs/autoshort-video-effects.md), task/evidence folder.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Các lệnh đã chạy từ root:

```powershell
$env:TEDIAPROS_TEST_FFMPEG=(Get-Command ffmpeg).Source
node scripts/run-local-runtime-tests.mjs packed-video-alpha.test effect-layer-composition.test video-effects.test balanced-video-export.test autoshort-overlays.test autoshort-ocr-burn.test autoshort-ocr-contract.test autoshort-ocr-pipeline.test ipc-origin-validation.test portrait-blur.test video-adjustments.test canonical-display-geometry.test rendered-media-validation.test
node scripts/run-local-runtime-tests.mjs packed-video-alpha.test
node scripts/verify-packed-overlay.mjs
node scripts/smoke-effect-layer-ui.mjs
node scripts/smoke-chroma-key-ui.mjs
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

- **116 pass, 0 fail, 1 optional skip** across 13 suites. Skip is optional BurstingSmoke real-media test without its environment variable; its synthetic compositor tests and separate Electron chroma smoke did run. Final additional packed suite (including portrait pixel case) has 5 pass.
- **Typecheck/build:** pass. Vite retains existing static/dynamic import warnings.
- **Independent decoded pixels:** alpha 0/128/255, intensity 25/100%, Normal/Multiply/Screen/Add and portrait fill/crop; every channel agrees with mathematical expectation within three levels, frame count/EOF unchanged. Mask green/blue differ to verify alpha uses red.
- **Metadata/storage:** actual package returns left-layout/Multiply. Synthetic tests reject ambiguous videos, unsupported blend, inactive/mixed variants; legacy vault recovery persists metadata and continues after source-cache removal.
- **Actual preview/export:** resource `7620270556557921589/6cb91fa515cd8b6854c46673ba32e0cc/AmazingFeature/resource/video/overlay.mp4`; preview left/center/right RGB differs from FFmpeg by at most three levels. Hidden control selects packed layout and Multiply. Production export uses NVENC, retains 24 frames/two seconds/audio and fully decodes.
- **UI regressions:** ordered layers, intensity, matte, seek/play/rate/cleanup pass; chroma key transparency, spill, intensity and playback pass. Hidden fixtures use isolated temporary profiles and do not control host mouse/keyboard/focus.

[Before/after PNG](2026-10-13-packed-overlay/comparison.png): left panel is old behavior, right panel is fixed behavior on a generated blue source. [Preview](2026-10-13-packed-overlay/preview.png), [fixed MP4](2026-10-13-packed-overlay/fixed-overlay.mp4), [preview/control proof](2026-10-13-packed-overlay/preview-proof.json), [export/encoder proof](2026-10-13-packed-overlay/export-proof.json), [tests](2026-10-13-packed-overlay/tests.log), [typecheck](2026-10-13-packed-overlay/typecheck.log), [build](2026-10-13-packed-overlay/build.log).

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Trong dev, bấm **Quét lại** và chọn lại hiệu ứng để danh sách đã mở từ trước nhận layout/blend mới. Preview/export của config legacy cũng có bước khôi phục khi nguồn còn tồn tại.
- Họ layout này đã được nhận diện có kiểm tra binding; không cam kết tất cả preset CapCut tương đương native. Sharpen/vignette, keyframe, crop transform riêng và format packing khác chưa nhập.
- Chưa chạy full video gốc của người dùng, chưa nâng bản cài đặt hoặc đăng Facebook. Các thư mục test/proof tạm của lượt này đã dọn trong finally; không còn helper FFmpeg ở final process check.
