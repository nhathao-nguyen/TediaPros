# TASK-20260912-AUTOSHORT-TEMPORAL-CUT-REVIEW: Review UI và toàn bộ commit cắt đoạn

- **Trạng thái:** Hoàn thành review; các lỗi được phát hiện chưa sửa.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-12.

## 1. Mục Tiêu

Review commit `0d7fa21` theo phản hồi UI xấu và yêu cầu xem lại toàn bộ công việc đã làm; đối chiếu implementation với spec/plan, tái hiện vấn đề, ghi ưu tiên và gate sửa.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] Review 20/20 tệp thuộc commit, có FILE_INVENTORY/COVERAGE.
- [x] Đọc hai ảnh người dùng, tái hiện lỗi layout qua component/CSS tại commit.
- [x] Probe FFmpeg thật với media tổng hợp; phân biệt runtime evidence và code-only findings.
- [x] Typecheck PASS trên working tree tại lúc chạy.
- [x] 23 tests trong 5 suite liên quan PASS, lưu log.
- [x] Báo cáo đủ nguyên nhân, cách sửa/gate và các phần spec chưa triển khai.

## 3. Phạm Vi

- Trong phạm vi: audit code/UI/spec của temporal cut, fixture offline, báo cáo và handoff.
- Ngoài phạm vi: sửa source, thiết kế/triển khai UI mới, live provider, installed build, merge/push, dọn file của task khác.
- Working tree có overlay/performance/batch work đang diễn ra. Không ghi đè hoặc stage các thay đổi đó; anchors của review dùng frozen commit.

## 4. Quyết Định và Lý Do

- Dùng ảnh người dùng làm evidence UI thực tế; browser harness chỉ kiểm component/layout, có nhãn rõ.
- Dùng FFmpeg thực và PCM/frame measurements để kiểm độc lập với các unit tests đang pass.
- Không làm đầy ổ đĩa thật hoặc gọi model trả phí để kiểm rủi ro resource/semantic; các điểm đó được ghi CODE_CONFIRMED hoặc chưa kiểm.
- Report sửa lại mức tin cậy của claims trước, giữ lịch sử spec/implementation để reviewer đối chiếu.

## 5. Tệp Thay Đổi

- `[NEW]` [REVIEW.md](F:/Son/tool/TediaPros/.ai/tasks/2026-09-12-autoshort-cut-review/REVIEW.md).
- `[NEW]` [COVERAGE.md](F:/Son/tool/TediaPros/.ai/tasks/2026-09-12-autoshort-cut-review/COVERAGE.md).
- `[NEW]` Scripts fixture/harness, kết quả JSON, 6 ảnh PNG, accessibility evidence, typecheck/test logs trong cùng thư mục evidence.
- `[NEW]` Task record này. Không sửa production source trong lượt audit.

## 6. Kiểm Chứng

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-temporal-edit-contract.test autoshort-cut-media.test autoshort-batch-resume.test autoshort-stage-cache.test autoshort-ocr-pipeline.test
node .ai/tasks/2026-09-12-autoshort-cut-review/reproduce.mjs C:/Users/PC/AppData/Roaming/tediapros/bin/ffmpeg.exe C:/Users/PC/AppData/Roaming/tediapros/bin/ffprobe.exe
node .ai/tasks/2026-09-12-autoshort-cut-review/ui-harness.mjs
```

- Typecheck Node/Web: PASS, exit 0.
- Scoped suites: 23 pass, 0 fail. Không đồng nghĩa feature đã đạt.
- Media: aligned 6→4 pass; subframe cut gây 90 ms lệch duration; audio start offset mất; 10-bit→8-bit; cùng plan khác container SHA; 1.000 ranges ENAMETOOLONG.
- UI: ở shell 696×596, mở panel làm stage 414→24 px; blank-start bị hiểu thành0; overlap mất khả năng undo riêng thao tác.
- Source fixture giữ nguyên hash; scratch media được script dọn; tab/server harness đã đóng.
- Chưa kiểm: full AutoShort cut+OCR/STTN/TTS/resume trên Electron, real user media quality, macOS, installed build, VFR/HDR/codec matrix, fault injection/cancel matrix.

## 7. Bàn Giao

12 nhóm findings, gồm 6 P1/6 P2. Ưu tiên F01/F02/F03 về correctness, F04 về UI; sau đó preparation/resources/cache và các phần Core còn thiếu. Xem report để lấy điều kiện tái hiện và tiêu chí nghiệm thu. Audit hoàn thành; không đánh dấu implementation hoặc bất kỳ finding nào là đã sửa.
