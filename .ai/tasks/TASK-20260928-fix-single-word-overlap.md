# TASK-20260928-fix-single-word-overlap: Sửa chồng chữ Give me 30 minutes

- **Trạng thái:** Đã kiểm chứng code và render mẫu; chưa đóng gói/cài đặt hoặc xuất lại toàn bộ video người dùng.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-28

## 1. Mục Tiêu (Goal)

Sửa lỗi single-word khiến `me` và `30` vẽ đè tại khoảng 10.58s trong video `923923593724102` bản (17), theo chẩn đoán ở `TASK-20260928-give-me-30-overlap-diagnosis.md` và yêu cầu người dùng “sửa đê”.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Word timing không bị dồn vào cuối render segment do layout cả câu chia đoạn.
- [x] Không kéo từ ngắn qua đầu từ sau hoặc cuối cue để đạt minimum hold.
- [x] Regression tái hiện lỗi trước sửa và pass sau sửa.
- [x] Typecheck, font verification, subtitle smoke có FFmpeg và bộ test local-runtime được chạy.
- [x] Render mẫu từ video nguồn bằng ASS sinh từ code đã sửa; xem khung hình xác nhận từ hiện riêng.
- [x] Ghi tài liệu; bảo toàn dirty work có sẵn và video người dùng.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

Chỉ điều chỉnh tạo ASS của single-word và thêm test liên quan. Không thay mốc cue/SRT/ASR, không thay hợp đồng IPC, không sửa chế độ hiển thị khác hoặc thuật toán DP của layout. Repo đã có nhiều thay đổi chưa commit trước task: không coi toàn bộ git diff là thay đổi của task này.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- `taoAss` chuẩn hóa displayStyle trước layout. Single-word dùng `autoOptimize: false` nội bộ cho render plan, giữ một render segment với start/end gốc của mỗi cue. Việc wrap hình học vẫn có sẵn; các mode khác giữ lựa chọn autoOptimize cũ.
- Bỏ phép `Math.max(beat.start + 0.05, wordEnd)`. `wordEnd` đã tính theo từ kế tiếp/cue và giới hạn khoảng lặng; minimum 50ms có thể tạo giao nhau khi từ chỉ dài 20ms.
- Không sửa bằng cách xóa từ hoặc dịch cứng thời gian chữ. Fixture đầu vào có word timings tuần tự, không giao nhau.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/burn.ts`: ba thay đổi khu trú: vị trí tính displayStyle; gate autoOptimize cho single-word; bỏ minimum hold vượt ranh giới.
- `[MODIFY]` `tests/subtitle-layout.test.ts`: thêm parser text events và 2 regression tests, không thay test cũ.
- `[MODIFY]` `docs/domain.md`: ghi quy tắc Single-Word.
- `[NEW]` Bản ghi này và thư mục `2026-09-28-subtitle-overlap-fix/` chứa script xác minh, ASS, event JSON, clip mẫu và ảnh.
- `[NEW]` `2026-09-28-subtitle-overlap-diagnosis/postfix-local-runtime.log`: log đầy đủ của lần chạy suite sau sửa.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Red → Green

Trước thay đổi production, `node scripts/run-local-runtime-tests.mjs subtitle-layout.test` có 12 pass, 2 fail đúng lỗi:

- `single-word ASS preserves Give me 30 minutes timing even when full-sentence layout splits`: me và 30 đều bị dồn vào 10.57–10.62 thay vì 10.58–10.68 / 10.68–10.88.
- `single-word ASS never extends a short word over the next word or past the cue boundary`: I dài 1.00–1.05 lấn vào see bắt đầu 1.02; it kết thúc 1.27 vượt cue end 1.24.

Sau sửa: 14 pass, 0 fail. Test đầu duyệt Social/Vertical/Readable với box hẹp, xác nhận cả câu thông thường vẫn chia đoạn, từng từ giữ mốc chuẩn. Test thứ hai kiểm tra cả text và Box hết hạn đúng lúc.

### Các lệnh đã chạy

```powershell
node scripts/run-local-runtime-tests.mjs subtitle-layout.test
npm.cmd run typecheck
npm.cmd run fonts:verify
# Smoke renderer tìm ffmpeg qua PATH (không dùng TEDIAPROS_TEST_FFMPEG).
$env:PATH = 'C:\Users\PC\AppData\Roaming\tedia-pros-dev\bin;' + $env:PATH
npm.cmd run test:subtitles
npm.cmd run test:local-runtime
node .ai/tasks/2026-09-28-subtitle-overlap-fix/verify-render.mjs
git diff --check -- src/main/burn.ts tests/subtitle-layout.test.ts
```

- Typecheck node/web: PASS, exit 0.
- Font verification: 6 fonts, 13.53 MiB, pack 2026.08.14.1; PASS.
- Subtitle smoke: PASS; render FFmpeg thực có frame counts standard/reveal/highlight = 2/10/24. Lần đầu truyền TEDIAPROS_TEST_FFMPEG bị SKIP render do smoke chỉ tìm PATH; đã chạy lại với PATH đúng, không dùng lượt SKIP làm bằng chứng render.
- Full local-runtime: 1,060 tests; 1,033 pass, 27 skipped, 0 fail; exit 0. Không khẳng định các test bỏ qua đã được xác minh.
- `verify-render.mjs`: PASS assertions cho bốn events và FFmpeg exit 0. Lỗi escape dấu phẩy trong filter trích ảnh ở lượt đầu đã sửa; lượt cuối sinh được clip và ảnh.
- Đã mở ảnh `me-10.583333.png` và `30-10.708333.png`: mỗi ảnh chỉ có đúng một từ. Cả hai lấy từ clip 2s bắt đầu tại 9.5s của nguồn bằng frame index 26 và 29.
- Review độc lập read-only: không có lỗi chặn trong delta; lưu giới hạn bên dưới.

### Kết quả mẫu

`2026-09-28-subtitle-overlap-fix/give-me-30-fixed-sample.mp4` là render thử 9.5–11.5s trên video nguồn với font Anton 65px, Social, autoOptimize bật và input word timings từ fixture chẩn đoán. Không phải toàn bộ video (17) được tái xuất theo config gốc.

| Từ | ASS sau sửa |
|---|---|
| Give | 9.98–10.58 |
| me | 10.58–10.68 |
| 30 | 10.68–10.88 |
| minutes. | 10.88–11.18 |

### Giới hạn

- Không kiểm chứng lại độ chính xác âm học của ASR; đây là sửa lỗi render làm hỏng word timings tuần tự đã có.
- Không khẳng định timestamp hỏng/trùng/không tuần tự hoặc các cue nguồn giao nhau đã được sửa.
- `requireWordTimings: true` thiếu alignment sẽ dùng fallback toàn cue không chia segment ở single-word, có thể vượt chiều cao box; reviewer không thấy caller sản phẩm hiện tại bật flag. Không mở rộng task để thiết kế lại fallback/preview.
- Chưa build/install, chưa thay đổi hay xuất lại toàn bộ MP4 (17); file cũ chứa chữ đã burn cần được xuất lại bằng bản code mới.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Khởi động lại ứng dụng dev hoặc dùng build mới trước khi xuất lại video. Giữ nguyên tùy chọn tự tối ưu: single-word tự bỏ qua việc chia thời gian cả câu khi render. Bộ bằng chứng chẩn đoán trước sửa được giữ lại; script `reproduce.mjs` cũ cố ý assert lỗi cũ nên sẽ fail khi chạy trên code đã sửa. Dùng `2026-09-28-subtitle-overlap-fix/verify-render.mjs` để kiểm chứng bản sửa.
