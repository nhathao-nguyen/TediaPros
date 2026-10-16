# TASK-20261013-EFFECT-LAYERS: Tối ưu thuật toán và các lớp hiệu ứng

- **Trạng thái:** Hoàn thành, đã kiểm chứng trên source/build dev
- **Người thực hiện:** Codex
- **Thời gian:** 2026-10-13

## 1. Mục tiêu

Tiếp tục sửa lỗi lớp trắng đục khi xuất video; giữ đủ các pass của Nhiễu 2, ghép RGB/alpha/cường độ đúng, giảm việc xử lý lặp và đồng nhất preview texture với bản xuất. Giữ nguyên các sửa đổi dev đã có trong worktree.

## 2. Tiêu chuẩn nghiệm thu

- [x] Scanner giữ Screen a0–a27 và Multiply b0 của gói Nhiễu 2 thật.
- [x] Alpha PNG được giữ qua màu nền trung tính; cường độ áp dụng một lần lên nhóm texture, matte cũng nhận cường độ.
- [x] Preview giữ đủ các hiệu ứng và pass theo thứ tự, không thay thế hình/phụ đề nền.
- [x] Cache có phiên bản/hash, không chạy FFmpeg khi dùng lại; nguồn đổi được phát hiện khi quét lại.
- [x] Kho nhiều lớp vẫn dùng được sau xóa cache; cấu hình/kho cũ được khôi phục khi còn tài nguyên gốc.
- [x] Input lỗi, shader không hỗ trợ, traversal và thiếu pass không bị ghép đoán hoặc xuất thiếu lớp.
- [x] Hủy/tắt ứng dụng theo process tree, giới hạn tài nguyên và dọn các tệp encode tạm.
- [x] Typecheck, build, test và kiểm chứng media/UI thành công.

## 3. Phạm vi

Hợp đồng layers, scanner/cache/vault, FFmpeg compositor, typed preload IPC và renderer preview/controls. Không đổi bitrate, TTS/tempo, OCR mask policy, giấy phép hoặc installer. Timing texture được chuẩn hóa 24 fps; chưa nhập Lua speed/keyframe/curve hoặc mọi shader CapCut.

## 4. Quyết định và lý do

- Optional `layers` tương thích cấu hình cũ, giới hạn 4 pass Screen/Multiply trong mỗi hiệu ứng (tối đa 4 hiệu ứng).
- Bộ nhập chỉ đọc literal/reference của họ shader pass1 Screen → pass2 Multiply đã kiểm tra; không chạy code gói ngoài.
- PNG alpha được ghép lên màu trung tính một lần trước encode cache nhỏ. Cache gồm hash nội dung và phiên bản, temporary file độc quyền và rename.
- FFmpeg giữ một graph cho video người dùng, ghép pass theo thứ tự trong RGB, rồi trộn toàn bộ kết quả với nguồn theo cường độ.
- Preview dùng dạng affine `A*K+C` để gộp texture thành hai canvas Multiply/Screen. Giữ nguyên backdrop/phụ đề, tái sử dụng bộ nhớ và chỉ đọc frame mới đã thực sự được trình bày.
- Loại bỏ contrast/brightness tự thêm trong preview Multiply. Add được hỗ trợ bằng cộng màu có clipping giống CSS plus-lighter.
- [ADR 013](../../docs/adr/013-ordered-rgb-texture-composition.md) ghi hợp đồng, thuật toán và giới hạn.

## 5. Tệp thay đổi

- `src/shared/videoEffects.ts`, `overlayCompositing.ts`: hợp đồng và mô hình RGB thuần túy.
- `src/main/capcutTextureLayers.ts`, `capcutScanner.ts`: metadata, cache, khôi phục và kho.
- `src/main/videoEffects.ts`, `burn.ts`: input/pass planning, RGB group intensity, matte và hủy.
- `src/main/index.ts`, `src/preload/index.ts`: typed composition lookup.
- Renderer `VideoEffectsPreview.tsx`, `OverlayTexturePreview.tsx`, `VideoEffectsControl.tsx`: đủ lớp và đồng nhất phép ghép.
- `tests/effect-layer-composition.test.ts`, `tests/video-effects.test.ts`, test runner và smoke scripts.
- `docs/autoshort-video-effects.md`, ADR 013, task/evidence folder này.

## 6. Kiểm chứng và bằng chứng

```powershell
$env:TEDIAPROS_TEST_FFMPEG = (Get-Command ffmpeg).Source
node scripts/run-local-runtime-tests.mjs effect-layer-composition.test video-effects.test autoshort-overlays.test autoshort-ocr-burn.test video-adjustments.test portrait-blur.test autoshort-ocr-pipeline.test autoshort-ocr-contract.test ipc-origin-validation.test
node scripts/smoke-effect-layer-ui.mjs
# Chuyển evidence của các smoke cũ sang scope task mới trước khi chạy:
$env:TEDIAPROS_EFFECT_UI_EVIDENCE = Join-Path (Get-Location) '.ai/tasks/2026-10-13-effect-layers/procedural-ui'
node scripts/smoke-video-effects-ui.mjs
$env:TEDIAPROS_EFFECT_UI_EVIDENCE = Join-Path (Get-Location) '.ai/tasks/2026-10-13-effect-layers/chroma-ui'
node scripts/smoke-chroma-key-ui.mjs
node .ai/tasks/2026-10-13-effect-layers/verify-real.mjs
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

Kết quả cuối:

- **90 pass, 0 fail, 1 skip** trong 9 bộ runtime/contract. Skip là test real BurstingSmoke cần biến môi trường riêng; smoke chroma dùng fixture xanh và pass. [Log](2026-10-13-effect-layers/final-tests.log).
- Typecheck và build exit 0. Build giữ các cảnh báo dynamic/static import hiện có; không có lỗi mới. [Typecheck](2026-10-13-effect-layers/typecheck.log), [build](2026-10-13-effect-layers/build.log).
- Smoke layered preview pass sau sửa race frame đầu; chạy lại hai lần đều pass để kiểm chứng lỗi khởi tạo. Kiểm tra RGB/cường độ 25/75/100%, nhiều effect, matte, pause/play, seek/rate và cleanup. [Proof](2026-10-13-effect-layers/preview-proof.json).
- Smoke thủ tục và chroma đều pass; chroma có `green: 0`. Evidence nằm trong `procedural-ui/` và `chroma-ui/`.
- Gói Nhiễu 2 thật: Screen 28 frames + Multiply 1 frame; encode qua `burnAutoShort` giữ 36 frames/3 giây/âm thanh/chuyển động, giải mã toàn bộ thành công. Sai lệch trung bình trên từng vùng tối/xanh/tím/trắng dưới **1,94/255** so với mô hình RGB hai pass. [Proof](2026-10-13-effect-layers/real-proof.json).
- Cache thật tổng 400.423 bytes. Mẫu đo cuối: chuẩn bị mới 576,7 ms, dùng lại 102,6 ms, warm cache chạy được ngay cả khi lệnh FFmpeg không tồn tại. Đây là một mẫu local khi có smoke UI chạy song song, không phải benchmark batch hoặc tốc độ render toàn hệ thống.
- [Ảnh nguồn / một pass / hai pass](2026-10-13-effect-layers/real-comparison.png), [video kiểm chứng](2026-10-13-effect-layers/real-output.mp4).

Harness đầu tiên phát hiện preview có thể đọc texture trước frame đầu tiên. Sửa bằng video-frame callbacks, tái dùng token frame và bỏ readback/tính lại khi texture chưa thay đổi. Các phép thử sau sửa đều pass.

## 7. Bàn giao

Source dev và `out/` đã build. Chưa đóng gói/cài lại release hoặc đăng Facebook. Video kiểm chứng dùng bảng màu tổng hợp và texture CapCut thật; chưa đối chiếu clip thực tế người dùng hoặc native CapCut export. Họ shader khác vẫn được quét gần đúng như trước. Cấu hình/kho legacy chưa từng khôi phục nhưng mất cache gốc cần nhập lại tài nguyên để có đủ pass.

Runner kiểm chứng lỗi trắng đục ở task trước được giữ ở chế độ texture custom một pass, tránh tự nâng thành hai pass và làm thay đổi mục đích phép thử cũ.
