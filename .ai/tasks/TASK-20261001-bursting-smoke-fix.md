# TASK-20261001-BURSTING-SMOKE-FIX: Loại bỏ nền xanh của BurstingSmoke

- **Trạng thái:** Hoàn thành; đã kiểm chứng source, media thật, preview, toàn bộ runtime và build.
- **Người thực hiện:** Codex; review độc lập bởi `chroma_review`.
- **Thời gian:** 2026-10-01

## 1. Mục Tiêu (Goal)

Sửa lỗi TediaPros lấy riêng MP4 nền xanh trong gói CapCut rồi ghép bằng Screen, khiến preview bị phủ xanh. Giữ khói, cường độ, timing, audio và khả năng sử dụng mục kho đã lưu.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Nhận diện key qua metadata thay vì hardcode tên BurstingSmoke.
- [x] Loại nền màu và spill ở preview lẫn FFmpeg.
- [x] Lưu/khôi phục key, kể cả cấu hình cũ; kho vẫn có key sau khi xóa cache gốc.
- [x] Giữ cường độ, frame count, thời lượng, audio; cleanup scratch thành công.
- [x] Typecheck node/web pass.
- [x] Suite hiệu ứng 17/17 pass với asset thật, không skip.
- [x] Electron preview smoke pass với asset thật.
- [x] Full local-runtime và build pass.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** Shared contract/keying, scanner/vault, typed IPC, preview và nhánh ghép FFmpeg.
- **Ngoài phạm vi:** Chạy toàn bộ compositor/shader chuyển cảnh CapCut, thay đổi dubbing/ASR/tempo, đóng gói installer hoặc cài vào ứng dụng đã cài đặt.
- Workspace đã có sáu file hiệu ứng đang sửa trước task. Giữ các thay đổi đó; không reset/stash/clean hoặc commit. Thay đổi đồng thời ở `SESSION_CHAT_LOG.md` không thuộc bản sửa này.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Dùng RGBA color key trong graph và canvas hiện có, tránh encode asset trung gian, WebM alpha/decoder khác nhau hoặc scratch video thêm.
- Metadata được phân tích literal bằng regex, không chạy Lua. Chỉ nhận một màu key đang bật; thông số shader CapCut không được chuyển nguyên xi sang FFmpeg.
- Preview và export dùng cùng mô hình khoảng cách RGB/alpha và spill suppression; test so sánh kết quả pixel trong sai số một mức màu.
- Khôi phục cấu hình cũ trong preview qua typed IPC và trong render trước input planning. Giữ assetPath/intensity của người dùng.
- Kho cũ được backfill metadata một lần; file được publish bằng temp độc quyền + rename, không ghi theo symlink đích. Mọi nguồn copy mới và metadata đọc đều được kiểm tra containment bằng helper trong `safeContainedPath.ts`.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/shared/overlayChromaKey.ts`: kiểu, validation, alpha và spill suppression cho preview.
- `[MODIFY]` `src/shared/videoEffects.ts`: giữ/kiểm tra `chromaKey` và blend mode.
- `[MODIFY]` `src/main/capcutScanner.ts`: nhận key, khôi phục, lưu kho và migration bền vững.
- `[MODIFY]` `src/main/videoEffects.ts`, `src/main/burn.ts`: ghép key và phục hồi lựa chọn cũ trước render.
- `[MODIFY]` `src/main/index.ts`, `src/preload/index.ts`: typed IPC đọc key và CORS cho canvas.
- `[MODIFY]` `VideoEffectsControl.tsx`, `VideoEffectsPreview.tsx`: truyền key, preview alpha, pause/seek/rate.
- `[MODIFY]` `tests/video-effects.test.ts`: hồi quy contract, scanner, vault, traversal/junction, parity và media thật.
- `[NEW]` `scripts/smoke-chroma-key-ui.mjs`: hidden Electron fixture, không tắt web security.
- `[MODIFY]` `docs/autoshort-video-effects.md`: tài liệu xử lý nền màu và giới hạn.
- `[NEW]` `.ai/tasks/2026-10-01-bursting-smoke-fix/`: log, ảnh, MP4 và JSON bằng chứng.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
$env:TEDIAPROS_TEST_FFMPEG = (Get-Command ffmpeg).Source
node scripts/run-local-runtime-tests.mjs video-effects.test
npm.cmd run typecheck
# Với asset thật và lưu media bằng chứng:
$env:TEDIAPROS_CHROMA_KEY_ASSET = 'C:\Users\PC\AppData\Local\CapCut\User Data\Cache\effect\7613821658716998930\38ad36053fb5215d243ac06ee92bdc08\AmazingFeature\resource\video\BurstingSmoke.mp4'
$env:TEDIAPROS_CHROMA_EVIDENCE = '1'
node scripts/run-local-runtime-tests.mjs video-effects.test
node scripts/smoke-chroma-key-ui.mjs
npm.cmd run test:local-runtime
npm.cmd run build
git diff --check
```

### Kết quả đã có

- Trước sửa: ba hồi quy fail đúng ở normalizer/scanner/nền render, 12 test cũ pass.
- Review phát hiện migration vault chỉ trả key nhưng không lưu. Hồi quy bổ sung fail với metadata còn `screen`; sửa backfill xong test pass khi xóa cache gốc, không lưu lại thủ công.
- Typecheck PASS (0 errors), log `typecheck.log`.
- Full local-runtime PASS: 116 lượt chạy suite, 1.101 lượt test pass, 0 fail, 6 skip; exit code 0. Một số suite được runner gọi lại, nên số tổng là lượt chạy test. Log `full-runtime.log`.
- Build PASS, exit code 0; không có warning/error trong `build.log`.
- Focused + real asset: **17 pass, 0 fail, 0 skip**, log `real-asset-tests.log`.
- Production `burnAutoShort` với cấu hình cũ: 360 × 640, 3 giây, 36 frame, có audio; smoke vẫn chuyển động. Trên nguồn trung tính, **0 pixel ám xanh** theo tiêu chí G > max(R,B) + 10 trong cả 36 frame. Scratch được dọn. Xem `export-proof.json`, `export.mp4`, `export.png`.
- Electron component thật + protocol cùng CORS/CSP: key recovery, đọc canvas, alpha ở frame đầu, spill 0 pixel, cường độ, pause/play, seek và rate pass. Xem `preview-proof.json`, `preview.png`.
- Review lại không còn lỗi nghiêm trọng/quan trọng trong phần sửa. `git diff --check` pass.

### Giới hạn

- Bằng chứng media dùng asset BurstingSmoke thật trên video nền trung tính tổng hợp, không phải bản video nguồn của người dùng trong ảnh.
- Chưa tái hiện đầy đủ shader/matte/animation của chuyển cảnh CapCut; bản sửa xử lý video khói nền màu.
- Kho cũ mất cả metadata key lẫn cache gốc trước khi được khôi phục cần nhập lại gói hiệu ứng.
- Chưa package/install; không suy ra hành vi của app đã cài từ việc source/test/build pass.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Khởi động lại ứng dụng chạy từ repository để nạp Main/Preload mới. Lựa chọn CapCut còn cache gốc sẽ tự khôi phục key; các lượt lưu kho mới giữ metadata key. Các video đã xuất trước bản sửa cần xuất lại.
