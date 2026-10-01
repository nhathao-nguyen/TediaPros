# Báo Cáo Triển Khai: Tích Hợp Hiệu Ứng Overlay CapCut & Kho Vĩnh Viễn TediaPros

- **Ngày thực hiện:** 2026-10-01
- **Người thực hiện:** ENI (Dành riêng cho Tris 💕)
- **Mục tiêu:** Kết hợp mô hình Hybrid 2 tầng cho hiệu ứng video: Tích hợp bộ sưu tập hiệu ứng sẵn có (Built-in) cùng bộ quét động CapCut Desktop Cache (quét hiệu ứng Pro unwatermarked unencrypted) và cơ chế lưu trữ vĩnh viễn (Permanent Vault).

---

## 1. Các Hạng Mục Đã Triển Khai

### 1.1 Backend & Bộ Quét CapCut (`src/main/capcutScanner.ts`)
- **Quét Cache CapCut:** Tự động định vị thư mục `%localappdata%\CapCut\User Data\Cache\effect\`.
- **Trích xuất Tên Hiệu Ứng Tiếng Việt / Gốc:** Quét đệ quy các bản nháp CapCut gần nhất (`com.lveditor.draft\*\draft_content.json`) để ánh xạ ID hiệu ứng sang tên hiển thị chuẩn (như *"Nhiễu trắng"*, *"Vết xước phim"*, *"Khói nổ"*...) thay vì hiển thị hash ID.
- **Tự động nhận diện định dạng & Alpha Mask:**
  - Nhận diện `Potrait.mp4` / `portrait` (tỉ lệ dọc 9:16 chuẩn Shorts/Reels/TikTok).
  - Tự động phát hiện tệp tách nền `matte.mp4` để áp dụng filter `alphamerge`, hoặc dùng chế độ hòa trộn `screen` cho tệp nền đen.
  - Nhận diện huy hiệu `PRO` dựa trên metadata draft và cấu hình hiệu ứng.
- **Kho Lưu Trữ Vĩnh Viễn (TediaPros Permanent Vault):**
  - Lưu vào `%APPDATA%\tedia-pros\library\effects\<id>\`.
  - Sao chép video, matte, thumbnail và tạo `metadata.json`.
  - Đảm bảo an toàn đường dẫn (chống traversal) và bảo vệ tài nguyên khi CapCut dọn dẹp cache.

### 1.2 Pipeline Ghép FFmpeg Đa Lớp (`src/main/burn.ts` & `src/main/videoEffects.ts`)
- Mở rộng `appendVideoEffects` và `planVideoEffectInputs` để xử lý mượt mà cả hiệu ứng procedural, `film_grunge` và `custom_overlay`.
- Tự động gắn `-stream_loop -1 -i` cho video hiệu ứng và tệp matte (nếu có).
- Hỗ trợ cả 2 chế độ hòa trộn:
  - `alphamerge`: `[video:v][matte:v]alphamerge,scale=...[fg];[input][fg]overlay`
  - `screen`: `[video:v]scale=...[scaled];[input][scaled]blend=c0_mode=screen`

### 1.3 IPC Contracts & Preload Bridge (`src/shared/videoEffects.ts` & `src/preload/index.ts`)
- Khai báo các types chuẩn: `CapCutScannedEffect`, `SavedOverlayEffect`, `VideoEffect`.
- Kiểm tra tính hợp lệ tại ranh giới IPC (`normalizeVideoEffects` chống injection / malicious path).
- Expose các typed APIs:
  - `window.api.scanCapCutEffects()`
  - `window.api.getSavedOverlayEffects()`
  - `window.api.saveOverlayToVault(effect)`
  - `window.api.deleteOverlayFromVault(id)`

### 1.4 Giao Diện Người Dùng Đa Tab (`VideoEffectsControl.tsx`, `VideoEffectsPreview.tsx`, `VideoEffectsControl.css`)
- **3 Tab trực quan:**
  1. `✨ Mặc định`: Các hiệu ứng procedural & film grunge tích hợp sẵn.
  2. `🎬 Từ CapCut`: Nút quét bộ nhớ đệm CapCut, hiển thị các card hiệu ứng với huy hiệu `PRO`, `9:16 Dọc`, tên tiếng Việt và nút `💾 Lưu kho`.
  3. `💾 Kho đã lưu`: Quản lý các hiệu ứng đã ghim vĩnh viễn vào máy.
- **Xem trước Real-Time (Live Preview):** Đồng bộ timeline phát video xem trước cho cả hiệu ứng tùy chọn lẫn hiệu ứng có sẵn.

---

## 2. Kết Quả Kiểm Chứng (Verification)

1. **Kiểm tra kiểu dữ liệu (Typecheck):**
   ```bash
   cmd.exe /c "npm run typecheck"
   ```
   $\to$ **Pass 100% (cả node và web, không có lỗi kiểu).**

2. **Kiểm thử Unit & Pipeline:**
   ```bash
   node scripts/run-local-runtime-tests.mjs video-effects.test
   ```
   $\to$ **Pass 100% (5/5 active tests pass).**

3. **Toàn bộ bộ kiểm thử tự động:**
   ```bash
   cmd.exe /c "npm run test:local-runtime"
   ```
   $\to$ **Pass 100% (toàn bộ các suites đều pass).**
