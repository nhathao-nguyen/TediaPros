# OCR GPU 1.2.1 — tích hợp và kích hoạt cục bộ

Ngày 2026-09-10; Windows 11 x64, GTX 1660 SUPER. Phạm vi: đổi OCR AutoShort
sang GPU theo yêu cầu người dùng; giữ CPU dự phòng, mask/ROI/8 fps và scheduler.

## Kết quả đã xác minh

- **CODE_CONFIRMED:** Windows dùng RapidOCR 1.4.4 + ONNX Runtime DirectML 1.24.4,
  giữ ba model PP-OCRv3/v2 đã đo A/B. `auto` chọn cả det/cls/rec trên DML; nếu
  khởi tạo thất bại hoặc provider bị rơi về CPU không đồng nhất thì dựng lại
  cả ba trên CPU một lần, có `fallback_reason`. Không retry vô hạn giữa video.
- **TEST_CONFIRMED:** 46 Python tests, 98 TypeScript tests thuộc tám suite,
  `npm.cmd run typecheck`, `git diff --check` đều đạt. Có thử CPU thật sau lỗi
  khởi tạo DML giả lập, kiểm tra session options và tắt runtime fallback âm thầm.
- **TEST_CONFIRMED:** EXE cuối chạy GPU/CPU trên cùng clip ngắn qua coordinator
  AutoShort thật, tạo SRT → timed mask → MP4. SRT và MP4 trùng SHA-256; 26/26
  frame mask giải mã trùng. 14 đoạn/hộp chữ trùng text, thời gian, hình học;
  không yêu cầu bit-identical confidence float. MP4 giải mã toàn bộ với `-xerror`.
- **TEST_CONFIRMED:** Hủy EXE cuối trong lúc OCR GPU: hoàn tất hủy sau **321 ms**,
  không còn child được quan sát, allocation CPU/GPU/server đều 0. Một lượt lỗi
  thiết bị có chủ đích trả error, nhả tài nguyên; lượt GPU sau đó xuất video được.
- **INSTALLED_CONFIRMED:** Đã thay runtime lúc **08:36:25 giờ Việt Nam**. Không
  kill process, không restart app, không hủy hàng đợi. Hai lần rename cùng ổ mất
  7,1 ms; bộ 551 file / 280.943.195 byte được đối chiếu SHA toàn cây trước swap.
  `--version` và `--probe` sau swap đạt `1.2.1`, `ready:true`, GPU cả ba session.
- **LIVE_APP_CONFIRMED:** App đóng gói đang mở, parent PID 16276 giữ
  nguyên, tự gọi child PID 19384 từ đường dẫn canonical lúc 08:36:50. Child nạp
  `DirectML.dll` từ runtime mới. Lượt OCR thật hoàn thành và đã đọc timeline lúc
  **08:41:38**: det/cls/rec đều DML, fingerprint 1.2.1 đúng, video 127,17 giây,
  1.017 khung hình / 1.003 đoạn / 1.013 hộp chữ; profile accurate, stream-roi.
  Không tự chạy thêm một batch hoặc đổi cấu hình UI. Đây là hoàn thành bước OCR,
  không phải xác nhận tất cả dịch/TTS/render của batch đã thành công. Log app
  xác nhận tiếp tục sang TTS lúc 08:41:51 và có kết quả audio lúc 08:42:54,
  08:43:08; không bị kẹt lại ở bước OCR.

Không dùng các con số smoke ngắn này để cam kết tốc độ: máy còn chạy batch thật.
Phép A/B cô lập trước tích hợp trên clip 166,7 giây cho OCR **600,8 → 197,2 giây
(3,05x)**; OCR+mask+render **694,7 → 286,5 giây (2,42x)**. Xem
[báo cáo A/B](../2026-09-10-ocr-gpu-lab/README.md); không bao gồm dịch/TTS.

## Runtime và phục hồi

- Active: `C:/Users/PC/AppData/Roaming/tedia-pros/bin/ocr-engine/ocr-engine.exe`
- EXE SHA-256: `fc91f85653d6bd84819338d420dcd08aa646d5fe1867d2dfcddde658a98eb4da`
- Fingerprint: `99020e272c77c9b90f46e587eb3b6d5891ebfa24e3d954cff6f66bb1cae34808`
- Backup CPU 1.2.0:
  `C:/Users/PC/AppData/Roaming/tedia-pros/bin/ocr-engine.cpu-1.2.0-backup-20260910`
- Backup receipt:
  `C:/Users/PC/AppData/Roaming/tedia-pros/runtime-state/installed-runtime.before-ocr-gpu-20260910.json`

Receipt chỉ đổi entry OCR. Bản backup 1.1.0 cũ vẫn giữ nguyên. Muốn rollback,
đợi không còn OCR đang chạy; giữ bản mới ở thư mục khác rồi khôi phục **toàn bộ
thư mục** 1.2.0 và entry OCR từ receipt backup (không đè các entry engine khác
nếu chúng đã được cập nhật sau lần cài này). Phải probe lại trước/sau rollback.
Không xoá cache OCR của người dùng; cache hợp lệ có thể bỏ qua quét lại.

## Thay đổi và bằng chứng

[Hướng dẫn engine](../../../engines/ocr-engine/README.md) giải thích lock `--no-deps`,
nguồn/model SHA, giấy phép, `--device`, fallback và cách build. Windows workflow
được thêm kiểm tra lock/provider/model/test và exit code; runtime input nâng
1.2.1/fingerprint. Sửa thêm `done.version` để main không ghi nhầm default 1.1.0.
Không sửa scheduler, translation/TTS, renderer hay blur vì task này.

Evidence nhỏ được lưu cùng báo cáo trong `evidence/`. Các log đầy đủ và harness
ở `.runner-staging/ocr-gpu-runtime-20260910/`:

- `python-tests-qualified.log`: 46/46, không skip.
- `local-tests-corrected.log`: 98/98, native FFmpeg fixture đã có đúng path.
- `typecheck.log`, `build-final.log`, `qualified.json`, `activated.json`.
- `live-app-ocr.json`, `postflight.json`: timeline thật sau cài; SHA của 551 file
  đang active đúng bản đã kiểm tra, các entry receipt ngoài OCR không đổi,
  backup CPU đúng SHA 1.2.0 trước swap.
- `runs/{auto,cpu}-final-smoke`, `auto-final-cancel`, `invalid-final-fail-b`,
  `auto-final-rerun`; output nằm riêng, không chạm video input/user output.
- `staged.json`: SHA từng file; trường tổng `bytes` của bản ghi đầu là null do
  lỗi hiển thị PowerShell Hashtable, tổng đã được tính lại từ 551 entry trong
  `qualified.json`, không bỏ qua đối chiếu byte/hash nào.

Một lần gọi suite sai tên `ocr-process-cancel.test` bị từ chối trước khi test
chạy; đã chạy lại tên đúng `autoshort-ocr-runtime.test`. Harness quan sát PID đã
được tăng kiểm tra creation-time và trạng thái exit Windows để không coi metadata
process còn giữ handle là một tác vụ còn chạy. Kết quả lỗi đo ban đầu được giữ
trong staging, không lấy làm bằng chứng đạt. Không sửa production để che lỗi test.

## Ranh giới và vấn đề riêng

- Chưa chạy/publish remote CI/release; đây là runtime cục bộ, chưa xác minh macOS.
- Review độc lập theo skill `requesting-code-review` đã yêu cầu nhưng agent bị
  quota trước khi trả kết quả. Main agent tự rà scoped diff, không coi là đã có
  independent approval. Skill `verification-before-completion` dẫn tới kiểm thử
  chính EXE và kiểm chứng sau cài, không chỉ kiểm tra mã nguồn.
- Batch thật có lỗi **dubbing**, không phải GPU OCR: lúc 08:36:46, video trước
  báo `Cue cue-47-76620 vẫn vượt thời lượng sau khi chỉnh nhịp; không cắt lời.`
  OCR của video này đã chạy xong trên 1.2.0 trước swap; các bước TTS/tempo và
  rephrase không bị thay đổi. Hàng đợi tự sang video kế tiếp lúc 08:36:49.
  Không sửa lỗi dubbing hoặc nới tempo trong task này.
- Không khẳng định toàn bộ batch thành công hay GPU không bao giờ lỗi. Thử hủy,
  lỗi và nhả lease đã đạt; lỗi native trong tương lai vẫn phải do watchdog/main
  quản lý. GPU chỉ tăng tốc nhận diện, CPU vẫn decode video, xử lý mask và việc khác.
