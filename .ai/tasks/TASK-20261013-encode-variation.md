# TASK-20261013-encode-variation: Khôi phục CQ/GOP ngẫu nhiên khi xuất video

- **Trạng thái:** Hoàn thành, kiểm chứng source/dev.
- **Người thực hiện:** Codex `/root`
- **Thời gian:** 2026-10-13
- **Checkout:** `F:\Son\tool\TediaPros`, nhánh `SonVersion`; giữ các thay đổi đang có, chưa commit/push hoặc nâng bản cài đặt.

## 1. Mục Tiêu (Goal)

Người dùng xác nhận CQ/GOP ngẫu nhiên là chức năng có chủ đích và yêu cầu khôi phục sau đợt tối ưu. Phục hồi biến thiên mã hóa theo từng lượt xuất, đồng thời giữ trần bitrate/VBV, bảo vệ chất lượng hạt nhiễu, lựa chọn CPU/GPU, metadata cleanup và các sửa hiệu ứng.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Video thông thường chọn CQ22/23/24 và GOP60/120 ngẫu nhiên ở production.
- [x] Grain/analog chọn CQ22/23 để giữ trần chất lượng CQ23 đã được kiểm chứng.
- [x] Mỗi export chọn một lần; các encoder attempt/fallback dùng cùng giá trị; các job sau chọn lại.
- [x] Giữ peak/VBV, FPS, geometry, CPU CRF và preference/cache hiện có.
- [x] Sáu tổ hợp NVENC và hai GOP CPU encode/full-decode thực; số frame, kích thước, GOP và SSIM đúng.
- [x] Metadata nguồn và encoder tag trong container/streams vẫn được xóa khi xuất thật.
- [x] Tests, typecheck, build, ADR/tài liệu và bàn giao hoàn tất.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- Tách bước chọn ngẫu nhiên khỏi planner cân bằng xác định; gọi tại `runBurnSubtitleLower` trước khi lập danh sách encoder.
- Khôi phục mức chất lượng ngẫu nhiên cho NVENC và các fallback AMF/QSV như chức năng cũ. CPU giữ CRF21/22 nhưng dùng GOP đã chọn. VideoToolbox giữ chế độ q65 hiện có.
- Không sửa shader/compositor, pipeline OCR/audio, IPC/UI hoặc thêm encode trung gian. Không bỏ trần dung lượng mới, không ngẫu nhiên FPS/độ phân giải, không tạo ID máy/UUID mới trong file.
- Đây là khôi phục biến thiên tham số mã hóa, không phải kiểm chứng rằng không thể liên kết video với máy render hoặc tài khoản đăng tải.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- `planBalancedVideoExport` vẫn thuần/xác định để budget và benchmark tái lập được. `randomizeVideoExportPlan` dùng Node `crypto.randomInt` và trả bản sao với CQ/GOP đã chọn, không mutate base plan.
- Chỉ lấy hai mẫu mỗi job (quality và GOP), đặt ngoài vòng lặp fallback. Cache chỉ ghi tên encoder theo FFmpeg path/preference, không giữ các tham số ngẫu nhiên cho job sau.
- CQ22–24 khôi phục miền cũ cho video thông thường. Với hạt nhiễu, không chọn CQ24 vì chất lượng bảo vệ hiện tại là CQ23; CQ thấp hơn giữ thêm chi tiết. X264 CRF và peak/VBV không bị jitter.
- Random có thể chọn lại cùng tổ hợp. Không dùng kết quả trùng làm lỗi, không hứa mỗi file có một "vân tay" duy nhất. [ADR014](../../docs/adr/014-balanced-video-export-policy.md) được bổ sung amendment và giới hạn của các số đo base trước đây.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` [videoExportPolicy.ts](../../src/main/videoExportPolicy.ts): helper ngẫu nhiên có injection cho test, marker trong plan, quality fallback AMF/QSV theo lựa chọn.
- `[MODIFY]` [burn.ts](../../src/main/burn.ts): áp lựa chọn mới một lần trước candidates; log plan giữ giá trị thực đã chọn.
- `[MODIFY]` [balanced-video-export.test.ts](../../tests/balanced-video-export.test.ts): sáu tổ hợp, ràng buộc quality/rate, real encode/GOP/SSIM, metadata cleanup trên CPU → GPU → CPU.
- `[MODIFY]` ADR014 và [effects guide](../../docs/autoshort-video-effects.md): giữ các số đo cũ dưới nhãn base cố định; mô tả cơ chế hiện tại.
- `[NEW]` Task và [thư mục bằng chứng](2026-10-13-encode-variation/summary.json).

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Lệnh đã chạy từ root:

```powershell
$env:TEDIAPROS_TEST_FFMPEG=(Get-Command ffmpeg).Source
node scripts/run-local-runtime-tests.mjs balanced-video-export.test
node scripts/run-local-runtime-tests.mjs balanced-video-export.test packed-video-alpha.test effect-layer-composition.test video-effects.test autoshort-overlays.test autoshort-ocr-burn.test autoshort-ocr-pipeline.test portrait-blur.test video-adjustments.test canonical-display-geometry.test rendered-media-validation.test autoshort-telemetry.test
npm.cmd run typecheck
npm.cmd run build
git diff --check -- src/main/burn.ts src/main/videoExportPolicy.ts tests/balanced-video-export.test.ts docs/adr/014-balanced-video-export-policy.md docs/autoshort-video-effects.md .ai/tasks/TASK-20261013-encode-variation.md
```

- **111 pass, 0 fail, 1 optional skip** across 12 suites; skip là test asset BurstingSmoke thật chưa cung cấp environment variable. [Tổng hợp](2026-10-13-encode-variation/summary.json), [log đầy đủ](2026-10-13-encode-variation/tests.log).
- Lượt focused cuối: **6 pass**, bao gồm sentinel metadata nguồn không xuất hiện trong output và encoder tag container/streams được xóa trên ba export CPU → GPU → CPU. [Focused log](2026-10-13-encode-variation/focused-tests.log).
- **Typecheck/build/diff check trong phạm vi task:** pass. Build giữ các cảnh báo Vite import tĩnh/động hiện có. [Typecheck](2026-10-13-encode-variation/typecheck.log), [build](2026-10-13-encode-variation/build.log).
- Mẫu thật 160×90, 30 FPS, 5 giây: mỗi tổ hợp giữ 150 frames; GOP60 có keyframes 0/60/120, GOP120 có 0/120; toàn bộ output được decode trong SSIM comparison.

| Encoder / quality | SSIM GOP60 | SSIM GOP120 |
| --- | ---: | ---: |
| NVENC CQ22 | 0.988993 | 0.989792 |
| NVENC CQ23 | 0.985036 | 0.985474 |
| NVENC CQ24 | 0.980303 | 0.981573 |
| x264 CRF22 | 0.986786 | 0.986365 |

SSIM này thuộc fixture nhỏ và không hiệu ứng, không phải cam kết chất lượng trên mọi video. Các regression effect/packed alpha/vault/OCR/audio/frame count tiếp tục pass. Không chạy lại benchmark lớn để suy ra mức tiết kiệm chung cho mọi tổ hợp.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Source/dev đã khôi phục variation. Các số đo giảm dung lượng/tăng tốc trong task balanced trước đây là cấu hình base cố định; đừng dùng như bảo đảm cho mọi CQ/GOP ngẫu nhiên.
- NVENC/x264 đã chạy thực trên máy đang dùng; AMF/QSV chỉ được kiểm tra argument contract, VideoToolbox vẫn giữ hành vi cũ. Chưa kiểm chứng forensic anonymity, nền tảng đăng tải hoặc installer.
- Các scope test riêng của lượt này được dọn sau khi xong. Không xóa thay đổi đang có hoặc các bằng chứng của task trước.
- Checkout có thêm thay đổi ngoài task tại `facebookArticle.ts`/`facebookReelsExporter.ts` xuất hiện trong lúc bàn giao. Lượt `git diff --check` toàn repo phát hiện trailing whitespace ở `facebookArticle.ts:417,420`; các tệp thuộc task này sạch. Giữ nguyên phần việc ngoài phạm vi.
