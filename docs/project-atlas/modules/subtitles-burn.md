# Phân Hệ Phụ Đề & Render Video (Subtitles & Burning Subsystem)

- **Thư mục mã nguồn:** `src/main/burn.ts`, `src/main/fonts.ts`, `src/main/fontMeasure.ts`, `src/shared/subtitles.ts`, `src/shared/subtitleEffects.ts`
- **Tài liệu tham chiếu:** [docs/adr/004-planar-rgb-for-ocr-blurring.md](file:///f:/Son/tool/TediaPros/docs/adr/004-planar-rgb-for-ocr-blurring.md), [docs/adr/007-deterministic-ass-subtitle-geometry.md](file:///f:/Son/tool/TediaPros/docs/adr/007-deterministic-ass-subtitle-geometry.md)

---

## 1. Trách Nhiệm Cốt Lõi
- Đo đạc chính xác kích thước ký tự font chữ bằng `opentype.js` trước khi xuất phụ đề.
- Sinh kịch bản phụ đề ASS với các kiểu diễn hoạt hiện đại: Standard, Word-Reveal, Word-Highlight (Karaoke).
- Thực thi pipeline render FFmpeg tích hợp bộ lọc làm mờ chữ cũ trên không gian màu **Planar RGB** (`format=gbrp`) và ghi đè phụ đề mới qua Libass.

---

## 2. Quy Chuẩn Planar RGB (`format=gbrp`)
Tại [src/main/burn.ts#L848-L865](file:///f:/Son/tool/TediaPros/src/main/burn.ts#L848-L865):
- Khi làm mờ phụ đề cũ bằng FFmpeg `maskedmerge`, nếu để video ở định dạng YUV 4:2:0 thông thường, thành phần sắc độ (Chroma) bị nén 1/2 sẽ khiến viền vùng mờ bị lem màu hoặc bóng ma chữ cũ.
- TediaPros bắt buộc chuyển đổi khung hình sang Planar RGB:
  ```
  [0:v]null,format=gbrp[display];
  [display]split=2[base][blur_source];
  [blur_source]gblur=sigma=...:steps=6[blurred];
  [1:v]format=gray,settb=AVTB,setpts=PTS-STARTPTS[mask];
  [base][blurred][mask]maskedmerge,trim=duration=...[masked];
  [masked]ass=sub.ass:fontsdir=...[out]
  ```
- Kết quả: Vùng làm mờ mịn màng, sắc nét, hoàn toàn không có viền ám màu.

---

## 3. Đo Đạc Font & An Toàn Thư Mục Phông Chữ
- Sử dụng `opentype.js` đọc trực tiếp file font `.ttf` trong `resources/fonts/` để đo glyph metrics.
- Cô lập thư mục font bằng `safeContainedPath` để tránh crash FFmpeg Libass khi đường dẫn chứa khoảng trắng hoặc ký tự Unicode đặc biệt.

---

## 4. Kiểm Thử Liên Quan
```powershell
cmd.exe /c "npm run test:subtitles"
cmd.exe /c "npm run fonts:verify"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-ocr-burn.test"
```
