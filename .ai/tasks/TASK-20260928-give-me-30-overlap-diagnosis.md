# TASK-20260928-give-me-30-overlap-diagnosis: Chẩn đoán phụ đề chồng tại Give me 30 minutes

- **Trạng thái:** Đã kiểm chứng triệu chứng trong MP4 và tái hiện cơ chế trong code; chưa sửa sản phẩm.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-28

## 1. Mục Tiêu (Goal)

Tìm nguyên nhân phụ đề chồng nhau khoảng giây 9–11 trong `F:\New folder\Video [923923593724102] (17)\Video [923923593724102]-phude.mp4`.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Kiểm tra đúng MP4, SRT, manifest, batch receipt và log render.
- [x] Trích khung hình thực tế thể hiện chồng chữ.
- [x] Tái hiện bằng hàm production và chạy đối chứng đổi một biến.
- [x] Typecheck pass; các test layout hiện hữu pass, nêu giới hạn.
- [x] Bảo toàn video, checkpoint và các thay đổi code có sẵn.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

Điều tra và ghi bằng chứng. Không sửa source sản phẩm, không chạy lại job, không ghi đè video/SRT gốc. Chỉ tạo bản ghi này và thư mục `2026-09-28-subtitle-overlap-diagnosis` cùng cấp.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

Tách bằng chứng quan sát MP4 khỏi fixture tái hiện. Không dùng test layout pass làm bằng chứng sản phẩm không có lỗi. Không quy lỗi cho ASR, font hay STTN khi cơ chế chồng đã tái hiện với word timings tuần tự, không giao nhau.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` Bản ghi này.
- `[NEW]` `2026-09-28-subtitle-overlap-diagnosis/reproduce.mjs`: gọi trực tiếp `taoAss`, `boCuc`, `planSubtitleLayout`, đo font Anton thật; chỉ mock Electron để chạy trong Node.
- `[NEW]` `reproduction.json`, `repro.ass`, `control-no-layout-split.ass`: fixture và kết quả tái hiện/đối chứng.
- `[NEW]` `frames.png`, `detail.png`, `source.png`, `frame-10.583333.png`: bằng chứng ảnh trích bằng FFmpeg. `detail.png` là các frame liên tiếp từ seek 10.3s, không phải mỗi ô 0.1s. Ảnh đơn chọn chính xác frame index 254 của MP4 24 fps, thời gian 10.583333s.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Quan sát trên đúng bản xuất

- MP4: 1080×1920, 24 fps, duration 30.080s.
- Audit: `.autoshort-audit-3ab1c507-5372-4063-bf98-fd4c877658f6-d60a3bd8-8653-401d-a3fb-d25c0a0736c2` trong thư mục người dùng.
- `source.srt`: cue 4 là `Give me 30 minutes.`, 9.980–11.180; cue trước kết thúc 8.180, cue sau bắt đầu 11.580. Không có cue SRT trùng thời gian tại đoạn này.
- `manifest.json`: targetLanguage none; vùng sub normalized x=0.08–0.92, y=0.78–0.90. Metadata stage ghi nguồn 540×960.
- Frame 254 tại 10.583333s thể hiện `me` và `30` vẽ đè nhau. Dãy ảnh sau đó trống trước khi `minutes.` hiện; khung nguồn ở khoảng 10.7s không có sub cũ ở vị trí đó.
- Batch snapshot receipt trỏ đúng input `F:\Son\facebook\New folder\QUIET HOURS\Video [923923593724102].mp4` và output người dùng.
- Log `C:\Users\PC\AppData\Roaming\tedia-pros-dev\logs\tblao-session-419c0908-9414-4407-bc70-05a8ab2bb64b.log`: 08:25:24.970Z font Anton; 08:25:25.023Z ASS có 41 events; 08:25:25.159Z libass chọn Anton-Regular.

### Cơ chế tái hiện bằng code hiện tại

Fixture lấy word times của cùng video từ alignment local đã có ở `.ai/tasks/2026-09-28-thats-timing-diagnosis/whisper-small-reproduction.alignment.json`:

| Từ | Word timing đầu vào | ASS sau layout chia đoạn |
|---|---|---|
| Give | 9.98–10.58 | 9.98–10.57 |
| me | 10.58–10.68 | **10.57–10.62** |
| 30 | 10.68–10.88 | **10.57–10.62** |
| minutes. | 10.88–11.18 | 10.88–11.18 |

1. `src/main/burn.ts:587` chạy layout cả câu trước nhánh single-word. Fixture font Anton 65 px trên canvas nguồn 540×960, box 452 px, Social + autoOptimize: câu rộng 527.20 px nên chia `Give me 30` và `minutes.`.
2. `src/shared/subtitleLayout.ts:379` gọi `allocateSegmentTimingsDP` theo nhóm text/CPS, không truyền word timings. Hai nhóm được cấp 9.98–10.58 và 10.58–11.18.
3. `src/main/burn.ts:670` vẫn tìm được word times gốc cho nhóm thứ nhất.
4. `src/shared/subtitleEffects.ts:426` chặn start của từ trong `[cueStart, cueEnd - 0.01]`; cả `me` (10.58) và `30` (10.68) bị ép về 10.57. End của chúng thành 10.58.
5. `src/main/burn.ts:696` ép mỗi từ hiện ít nhất 0.05s; cả hai events thành 10.57–10.62, cùng layer và cùng `\\pos`. Do đó chữ đè nhau, rồi trống tới 10.88 khi minutes bắt đầu.

Đối chứng thay đúng `autoOptimize: false`, giữ font 65 px/cue/word timings/style: ASS trở lại `me` 10.58–10.68, `30` 10.68–10.88; assertions kiểm chứng không còn cặp events 10.57–10.62. Fixture font 35 px không phải chia đoạn cũng giữ đúng times.

### Các lệnh đã chạy và kết quả

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs subtitle-layout.test
node .ai/tasks/2026-09-28-subtitle-overlap-diagnosis/reproduce.mjs
```

- Typecheck node + web: PASS, exit 0.
- Layout tests hiện hữu: 12 PASS, 0 FAIL; không có regression kiểm tra các từ bị clamp trùng mốc sau layout split.
- Reproduction + đối chứng: PASS assertions, exit 0; xác nhận bug vẫn tồn tại trong code, không phải xác nhận đã sửa.
- FFmpeg trích ảnh: exit 0; đã mở và xem ảnh.

### Giới hạn

ASS và raw alignment nguyên bản của lần xuất (17) không có trong audit; snapshot chỉ giữ digest/receipt, không giữ toàn bộ config. Font 65 px/Social là fixture có chủ đích để tái hiện, không khẳng định đó là cỡ chữ/profile chính xác của job cũ. Word timing lấy từ lần ASR local trước trên cùng nguồn, không phải raw alignment được lưu của job (17). Cơ chế tái hiện khớp mẫu lỗi và khoảng thời gian trên MP4, nhưng chưa có bằng chứng replay byte-for-byte toàn bộ job. Chưa kiểm chứng âm học các mốc từ, chưa build/install hay render lại video hoàn chỉnh.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Hướng sửa: nhánh single-word cần giữ timeline từ trên cue gốc, không chia thời gian theo layout cả câu. Nếu vẫn cần các render segments cho kiểu khác, ranh giới segment phải theo word timing khi có alignment; không dồn nhiều từ nằm ngoài segment về cùng một centisecond. Kiểm tra mọi text event single-word không giao nhau và không làm mất từ. Không chữa bằng cách bỏ từ, tăng minimum duration, hoặc thay timestamp SRT nguồn.

Tạm thời có thể tắt Tự tối ưu phụ đề khi dùng single-word rồi xuất lại; đối chứng ASS đã xác nhận hiệu quả với fixture này, chưa xuất lại bản người dùng.
