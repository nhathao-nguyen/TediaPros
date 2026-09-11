# DATA_AND_STORAGE.md — Bản Đồ Dữ Liệu & Quản Lý Lưu Trữ

Tài liệu này mô tả chi tiết vị trí các thư mục lưu trữ bền vững, bộ nhớ đệm, file tạm thời, và cơ chế kiểm soát ngân sách đĩa trong **TediaPros**.

---

## 1. Cấu Trúc Thư Mục Dữ Liệu Bền Vững (`userData`)

Được Electron quản lý tại:
- **Windows:** `%APPDATA%\tedia-pros\` (`C:\Users\<User>\AppData\Roaming\tedia-pros\`)
- **macOS:** `~/Library/Application Support/tedia-pros/`

```
userData/
├── config.json                 # Cấu hình người dùng (UI state, đường dẫn mặc định, theme)
├── keys.json                   # Khóa API dịch thuật (OpenAI, Gemini, Local) - được mã hóa an toàn
├── cookies/                    # Kho lưu trữ cookie theo tên miền (YouTube, Facebook, Douyin)
│   ├── youtube.com.txt
│   └── douyin.com.txt
├── runtime/                    # Các engine và models được tải on-demand
│   ├── ffmpeg/ (ffmpeg.exe, ffprobe.exe)
│   ├── yt-dlp/ (yt-dlp.exe)
│   ├── whisper/ (models: base, small, medium)
│   ├── ocr/ (RapidOCR models)
│   ├── separator/ (MDX-Net models)
│   └── sttn/ (STTN weights)
├── tts_cache/                  # Bộ nhớ đệm các tệp âm thanh TTS đã tổng hợp
│   └── <hash>.wav
└── logs/                       # Tệp nhật ký hệ thống xoay vòng
    └── tedia-pros.log
```

---

## 2. Thư Mục Làm Việc Tạm Thời (Scratch Directory) & Item Scope

Để đảm bảo không làm rác ổ cứng và ngăn chặn xung đột tệp giữa các video trong hàng đợi:
- Mỗi video trong hàng đợi AutoShort sở hữu một thư mục tạm thời riêng biệt:
  `<outputDir>/.autoshort-item-<itemId>/`
- Thư mục này chứa toàn bộ các artifacts trung gian:
  - `source.wav`: Âm thanh thô trích xuất từ video nguồn.
  - `vocals.wav` & `instrumental.wav`: Các stems tách ra từ MDX-Net.
  - `ocr/`: Các khung hình frame tạm phục vụ nhận diện chữ.
  - `ocr-mask.mkv`: Video mặt nạ nhị phân làm mờ đa tầng.
  - `sttn-cleaned.mkv`: Video đã xóa chữ qua STTN.
  - `tts-timeline.wav`: Luồng âm thanh giọng lồng tiếng đã căn chỉnh tempo.
  - `checkpoint.json`: Điểm lưu trạng thái để phục hồi nếu tiến trình bị gián đoạn.

---

## 3. Cơ Chế Quản Lý Ngân Sách Đĩa (`autoShortDiskBudget.ts`)

- **Vấn đề:** Các thao tác trích xuất video, WAV uncompressed và STTN inpainting có thể tiêu tốn từ **1 GB đến 5 GB** dung lượng đĩa cho mỗi video. Nếu ổ đĩa bị đầy trong lúc đang chạy, hệ điều hành hoặc app sẽ bị treo cứng.
- **Cơ chế Sổ Cái (Ledger):**
  - Trước khi bắt đầu xử lý một video, hàm `budget.reserve(volume, bytes, signal)` được gọi.
  - Hệ thống kiểm tra dung lượng trống khả dụng qua `statfs(volume)`.
  - Luôn duy trì dung lượng dự phòng tối thiểu: `STTN_ROLLING_RESERVE_BYTES = Math.round(0.685 * 1024 ** 3)` (~**685 MB**).
  - Nếu dung lượng trống $<$ dung lượng dự trù + 685 MB $\rightarrow$ Báo lỗi `AutoShortDiskBudgetError (ENOSPC)` và từ chối chạy tiếp để bảo vệ hệ thống.

---

## 4. Dọn Dẹp File Tạm (Cleanup Guarantee)
- Ngay sau khi video thành phẩm được xuất bản thành công vào thư mục đích:
  `await rm(workDir, { recursive: true, force: true })`
  `await rm(sttnWorkDir, { recursive: true, force: true })`
- Nếu người dùng bấm Hủy (Cancel) hoặc xảy ra lỗi giữa chừng: Khối `finally` của `createAutoShortItemProcessor` cam kết giải phóng toàn bộ thư mục scratch của item đó, đảm bảo 0 byte rác bị bỏ lại trên ổ cứng người dùng.
