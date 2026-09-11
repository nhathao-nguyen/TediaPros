# Phân Hệ Điều Phối AutoShort (AutoShort Orchestrator)

- **Thư mục mã nguồn:** `src/main/` (`autoshort.ts`, `autoShortItemCoordinator.ts`, `autoShortQueueRunner.ts`, `autoShortDiskBudget.ts`, `autoShortItemScope.ts`, `autoShortResourceManager.ts`, `autoShortTelemetry.ts`)
- **Tài liệu tham chiếu:** [docs/architecture.md](file:///f:/Son/tool/TediaPros/docs/architecture.md), [docs/domain.md](file:///f:/Son/tool/TediaPros/docs/domain.md)

---

## 1. Trách Nhiệm Cốt Lõi
- Nhận yêu cầu xử lý batch video từ Renderer, tiền kiểm cấu hình bằng `validateAutoShortStartRequest`.
- Điều phối hàng đợi xử lý tuần tự qua `autoShortQueueRunner.ts`.
- Thực thi quy trình biên tập 11 bước cho từng video qua `createAutoShortItemProcessor`.
- Quản lý ngân sách đĩa tạm qua `AutoShortDiskBudgetLedger`, bảo vệ đĩa khỏi cạn kiệt dung lượng (`ENOSPC`).
- Thu thập số liệu chẩn đoán (telemetry spans & counters) và lưu trữ audit metadata cho từng video.

---

## 2. Quy Trình 11 Bước Xử Lý AutoShort Item
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
                 10. Render Video & Burn Phụ đề ASS (FFmpeg Libass Planar RGB)
                       │
                       ▼
                 11. Xuất bản, lưu Audit Manifests & Dọn dẹp Scratch Files
```

---

## 3. Ngân Sách Đĩa & Dọn Dẹp File Tạm (`autoShortDiskBudget.ts`)
- **Headroom Reserve:** Luôn giữ lại tối thiểu **685 MB** trống trên ổ đĩa đích (`STTN_ROLLING_RESERVE_BYTES = Math.round(0.685 * 1024 ** 3)`).
- **FIFO Ledger:** Trước khi bắt đầu ghi file tạm, coordinator phải gọi `budget.reserve(volume, bytes, signal)`. Nếu dung lượng không đủ, job dừng lại và báo lỗi `AutoShortDiskBudgetError (ENOSPC)`.
- **Cleanup Guarantee:** Khối `finally` trong `autoShortItemCoordinator.ts` luôn dọn dẹp `workDir` và `sttnWorkDir` dù job thành công hay thất bại.

---

## 4. Kiểm Thử Liên Quan
```powershell
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-ocr-pipeline.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-disk-budget.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-item-scope.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-queue-throughput.test"
```
