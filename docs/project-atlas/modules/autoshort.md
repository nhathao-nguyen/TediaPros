# Phân Hệ Điều Phối AutoShort (AutoShort Orchestrator)

- **Thư mục mã nguồn:** `src/main/` (`autoshort.ts`, `autoShortItemCoordinator.ts`, `autoShortQueueRunner.ts`, `autoShortDiskBudget.ts`, `autoShortItemScope.ts`, `autoShortResourceManager.ts`, `autoShortTelemetry.ts`)
- **Tài liệu tham chiếu:** [docs/architecture.md](file:///f:/Son/tool/TediaPros/docs/architecture.md), [docs/domain.md](file:///f:/Son/tool/TediaPros/docs/domain.md)

---

## 1. Trách Nhiệm Cốt Lõi
- Nhận yêu cầu xử lý batch video từ Renderer, tiền kiểm cấu hình bằng `validateAutoShortStartRequest`.
- Điều phối hàng đợi xử lý tuần tự qua `autoShortQueueRunner.ts`.
- Thực thi quy trình biên tập 12 bước cho từng video qua `createAutoShortItemProcessor`.
- Quản lý ngân sách đĩa tạm qua `AutoShortDiskBudgetLedger`, bảo vệ đĩa khỏi cạn kiệt dung lượng (`ENOSPC`).
- Thu thập số liệu chẩn đoán (telemetry spans & counters) và lưu trữ audit metadata cho từng video.
- Video lỗi thời lượng có thể phục hồi được giữ checkpoint, không chặn các item khác và được chạy lại tuần tự đúng một lần sau lượt chính.

---

## 2. Quy Trình 12 Bước Xử Lý AutoShort Item
Tại [src/main/autoShortItemCoordinator.ts#L158-L980](file:///f:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts#L158-L980):

```
[Bắt đầu Item] ──► 1. Validate Input & Probe Media (giay, w, h, fps)
                       │
                       ├─► [Nhánh Visual song song nếu có OCR/STTN]
                       │    ├─► 2. Quét Visual OCR (RapidOCR 8 FPS)
                       │    ├─► 3. Xóa chữ STTN (nếu chọn) -> sttn-cleaned.mkv
                       │    └─► 4. Tạo mặt nạ làm mờ nhị phân (nếu chọn) -> ocr-mask.mkv
                       │
                       ├─► [Nhánh Âm thanh & Phụ đề chính]
                       │    ├─► 5. Bóc băng Whisper / OCR -> source.srt
                       │    ├─► 6. Dịch thuật ngữ cảnh -> translated.srt
                       │    ├─► 7. Tách nhạc nền MDX (nếu bật separate-vocals) -> instrumental.wav
                       │    ├─► 8. Tổng hợp giọng đọc TTS & Căn nhịp tempo -> tts-timeline.wav
                       │    └─► 9. Trộn nhạc nền (Instrumental hoặc BGM) -> mixed_audio.wav
                       │
                       ▼
                 10. Chọn vùng phụ đề từng item từ OCR hoặc dùng vùng dự phòng
                       │
                       ▼
                 11. Render Video & Burn Phụ đề ASS (FFmpeg Libass Planar RGB)
                       │
                       ▼
                 12. Xuất bản, lưu Audit Manifests & Dọn dẹp Scratch Files
```

---

## 3. Ngân Sách Đĩa & Dọn Dẹp File Tạm (`autoShortDiskBudget.ts`)
- **Headroom Reserve:** Luôn giữ lại tối thiểu **685 MB** trống trên ổ đĩa đích (`STTN_ROLLING_RESERVE_BYTES = Math.round(0.685 * 1024 ** 3)`).
- **FIFO Ledger:** Trước khi bắt đầu ghi file tạm, coordinator phải gọi `budget.reserve(volume, bytes, signal)`. Nếu dung lượng không đủ, job dừng lại và báo lỗi `AutoShortDiskBudgetError (ENOSPC)`.
- **Cleanup Guarantee:** Khối `finally` trong `autoShortItemCoordinator.ts` luôn dọn dẹp `workDir` và `sttnWorkDir` dù job thành công hay thất bại.

---

## 4. Hình học vùng chỉnh sửa trong batch

- Renderer giữ khung phụ đề, vùng OCR và các vùng blur thủ công bằng tọa độ normalized `0..1`. Khi đổi video, UI chỉ chiếu state này sang pixel của video đang xem; không lấy pixel của video trước dùng cho video mới.
- `startBatch` và preview STTN gửi trực tiếp tọa độ normalized. `autoShortItemCoordinator.ts` tiếp tục chiếu các vùng sang display pixels riêng cho từng item sau khi probe media.
- Metadata preview phải khớp nguồn đang chọn. Khi đổi nguồn, geometry cũ bị xóa, thao tác kéo đang dở bị hủy và các hành động cần geometry chờ metadata hợp lệ.
- Font thủ công và viền dùng mốc tham chiếu 1080×1920. Thiết lập pixel cũ được migrate một lần sau khi đọc video đầu tiên, giữ kích thước đang thấy và tạo `subtitleFontScale` / `outlineScale` ổn định cho batch nhiều độ phân giải.
- Các video khác tỷ lệ vẫn dùng cùng phần trăm trên hình nguồn. Khi để chế độ đặt phụ đề thủ công, nội dung chữ nằm ở vị trí khác giữa các clip vẫn cần điều chỉnh bố cục hoặc tách batch.
- Khi bật **Tự đặt vị trí theo OCR**, `ocrRegion` vẫn là vùng batch do người dùng khoanh. Coordinator dùng timeline OCR đã có để chọn `subRegion` riêng cho từng item; không thêm lượt OCR và không chia sẻ quyết định giữa các video.
- Vùng được chọn phải đạt đồng thời tiêu chí thời gian xuất hiện và chiều cao chữ điển hình, đồng thời có text thay đổi. Nếu không có một vùng thắng rõ, `subRegion` trên preview được dùng làm dự phòng.
- Audit manifest ghi mode, reason, region, số ứng viên, độ phủ và chiều cao chữ normalized; không ghi nội dung OCR vào metadata placement.

---

## 5. Kiểm Thử Liên Quan
```powershell
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-ocr-pipeline.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-subtitle-placement.test autoshort-ocr-contract.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-disk-budget.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-item-scope.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-queue-throughput.test"
node scripts/test-autoshort-region-resolution.mjs docs/reviews/region-resolution
node scripts/test-autoshort-ocr-placement.mjs
```
