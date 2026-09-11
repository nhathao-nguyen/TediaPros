# Luồng Xử Lý AutoShort Hoàn Chỉnh (AutoShort End-to-End Trace)

Tài liệu này truy vết chi tiết từng bước của luồng nghiệp vụ hạt nhân nhất trong TediaPros: Từ thao tác người dùng trên giao diện đến khi tạo ra video thành phẩm cuối cùng.

---

## 1. Trình Tự Thực Thi Từ UI Đến Thành Phẩm

```
[Người dùng tại Tab AutoShort]
  │
  ├─► 1. Chọn video (1 đến 100 tệp) & Cấu hình (ngôn ngữ dịch, giọng đọc, làm mờ/xóa chữ, tách nhạc)
  ├─► 2. Bấm "Bắt đầu xử lý"
  │
  ▼ [src/renderer/src/components/AutoShort.tsx]
  │  Gọi window.api.autoShortStart(request)
  │
  ▼ [src/preload/index.ts]
  │  Gửi IPC 'autoshort:start' kèm request đã tiền kiểm
  │
  ▼ [src/main/index.ts & autoshort.ts]
  │  Hàm startAutoShortJob:
  │  - Gọi validateAutoShortStartRequest(request)
  │  - Khởi tạo jobId và AbortController
  │  - Đưa danh sách video vào AutoShortQueueRunner (hàng đợi FIFO)
  │
  ▼ [src/main/autoShortItemCoordinator.ts] (Vòng lặp từng video trong hàng đợi)
  │
  ├─► GIAI ĐOẠN 1: Validate & Chuẩn bị
  │    - Kiểm tra tính tồn tại của file nguồn
  │    - Đọc metadata video (giay, w, h, fps) qua probeBurnMedia
  │    - Dự trù ngân sách đĩa qua AutoShortDiskBudgetLedger
  │    - Tạo thư mục scratch cô lập: .autoshort-item-<id>/
  │    - Kiểm tra fingerprint checkpoint để tái sử dụng bước trước (nếu chạy lại)
  │
  ├─► GIAI ĐOẠN 2: Nhánh Thị Giác Song Song (Visual Processing Branch)
  │    - Nếu bật OCR tự động hoặc STTN:
  │      + Khởi chạy RapidOCR quét vùng scanRegion ở tần số 8 FPS
  │      + Ghép bounding boxes thành OcrVisualTimeline
  │      + Nếu chọn STTN: Gọi sttn-engine xóa chữ -> sttn-cleaned.mkv
  │      + Nếu chọn Làm mờ tự động: Rasterize mask -> sinh ocr-mask.mkv
  │
  ├─► GIAI ĐOẠN 3: Bóc Băng Phụ Đề Nguồn (ASR & Subtitle Extraction)
  │    - Phương thức Whisper: Gọi whisper-engine (Faster-Whisper CUDA/CPU) -> source.srt
  │    - Phương thức OCR: Chiếu OcrVisualTimeline sang phụ đề -> source.srt
  │    - Phương thức Whisper-OCR: Hợp nhất speech cues và visual cues qua fuseWhisperAndOcr
  │
  ├─► GIAI ĐOẠN 4: Dịch Thuật Ngữ Cảnh (Translation)
  │    - Gọi translateStrict (OpenAI, Gemini hoặc Local Translate)
  │    - Dịch theo lô có ngữ cảnh, bảo toàn số lượng cue -> translated.srt
  │
  ├─► GIAI ĐOẠN 5: Tách Thoại Âm Thanh (Vocal Separation - nếu bật)
  │    - Trích xuất âm thanh gốc sang file WAV uncompressed
  │    - Gọi separator-engine (MDX-Net ONNX DirectML hoặc fallback CPU)
  │    - Tách thành Vocals (xóa) và Instrumental (giữ lại nhạc nền + SFX) -> instrumental.wav
  │
  ├─► GIAI ĐOẠN 6: Lồng Tiếng AI (Dubbing & TTS Synthesis)
  │    - Gom nhóm ngữ nghĩa: buildSemanticGroups
  │    - Lập kế hoạch cửa sổ thời gian: buildDubbingPlan, áp dụng trần tempo 1.10x - 1.45x
  │    - Tra cứu cache TTS (buildTtsCacheKey)
  │    - Tổng hợp câu thoại qua Edge TTS / Local TTS Server / ElevenLabs
  │    - Căn chỉnh timeline và kiểm tra đồng bộ: validateAutoShortTimelineSync -> tts-timeline.wav
  │
  ├─► GIAI ĐOẠN 7: Trộn Âm Thanh (Audio Mixing)
  │    - Nếu có Instrumental: Trộn lồng tiếng + Instrumental qua composeAutoShortNarratedAudio
  │    - Nếu có Nhạc nền BGM: Trộn lồng tiếng + BGM qua composeAutoShortBackgroundAudio
  │    - Xuất file âm thanh hoàn chỉnh -> final_audio.wav
  │
  ├─► GIAI ĐOẠN 8: Render Video & Ghi Đè Phụ Đề (Video Rendering & ASS Burning)
  │    - Khởi tạo kịch bản phụ đề ASS với kiểu diễn hoạt (Standard / Reveal / Highlight)
  │    - Thiết lập filter complex FFmpeg:
  │      + Chuyển khung hình sang Planar RGB: format=gbrp
  │      + Áp dụng làm mờ đa tầng: gblur=sigma=...:steps=6
  │      + Trộn vùng mờ qua maskedmerge với ocr-mask.mkv
  │      + Ghi đè phụ đề ASS qua bộ lọc ass
  │      + Muxing luồng âm thanh hoàn chỉnh
  │    - Xuất bản file: <ten-video>_autoshort.mp4
  │
  └─► GIAI ĐOẠN 9: Lưu Trữ Audit & Dọn Dẹp (Finalization & Cleanup)
       - Lưu audit metadata: source.srt, translated.srt, timed.srt, tts-timeline.json, tieude.txt
       - Xóa sạch thư mục scratch workDir và sttnWorkDir
       - Phát sự kiện item-done lên giao diện
```

---

## 2. Xử Lý Khi Người Dùng Bấm Hủy (Cancellation Handling)
1. Người dùng bấm "Hủy" trên UI $\rightarrow$ gọi `window.api.autoShortCancel(jobId)`.
2. Main process kích hoạt `AbortController.abort()`.
3. Tín hiệu `signal.aborted` kích hoạt:
   - Gọi `terminateProcessTree` tiêu diệt ngay lập tức các tiến trình con FFmpeg, Python.
   - Chờ tiến trình con nhả khóa file hoàn toàn (`await scope.drain()`).
   - Xóa sạch thư mục scratch tạm thời, không để rác trên ổ cứng.
   - Phát sự kiện `item-cancelled` cập nhật trạng thái UI.
