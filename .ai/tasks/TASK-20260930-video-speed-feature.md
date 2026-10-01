# TASK-20260930-video-speed-feature: Tích Hợp Chức Năng Tua Nhanh Video Đã Xuất

- **Trạng thái:** Đã kiểm chứng / Hoàn thành
- **Người thực hiện:** Antigravity AI
- **Thời gian:** 2026-09-30

---

## 1. Mục Tiêu (Goal)

Tích hợp tính năng tua nhanh video (tăng tốc độ lên 1.05x, 1.1x, 1.15x, 1.2x, 1.25x, 1.5x...) cho các video đã xuất ra trong TediaPros. Đảm bảo giữ nguyên cao độ giọng nói (pitch preservation) bằng FFmpeg `atempo`, đồng bộ 100% hình ảnh và phụ đề đã gán, hỗ trợ tăng tốc phần cứng (NVENC/AMF/QSV/VideoToolbox) và tích hợp tiện lợi trong giao diện UI (AutoShort, Biên tập video, và Header toàn ứng dụng).

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Tạo module `src/main/videoSpeed.ts` xử lý filter complex FFmpeg (`setpts` + `atempo`), chống tràn ổ đĩa, xử lý file tạm `.partial.mp4` an toàn và tự động tăng số thứ tự nếu file trùng tên.
- [x] Định nghĩa hợp đồng IPC kiểu tĩnh (`VideoSpeedRequest`, `VideoSpeedProgress`, `VideoSpeedResult`) tại `src/shared/types.ts` và `src/preload/index.ts`.
- [x] Tạo giao diện `VideoSpeedModal.tsx` với thiết kế hiện đại: chọn file kéo-thả, preset tốc độ (1.05x, 1.10x khuyên dùng cho Reels/Shorts, 1.15x,...), thanh trượt tinh chỉnh, tùy chọn giữ giọng nói, thanh tiến độ % trực quan, nút xem video và mở thư mục sau khi hoàn thành.
- [x] Tích hợp nút `⚡ Tua nhanh (1.1x)` ngay cạnh file output hoàn tất trong tab **AutoShort** và **Biên tập video**, cùng nút mở modal trên header chính.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Bộ test unit `tests/video-speed.test.ts` pass 100% (5/5 tests).

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Xử lý tăng tốc video đầu ra đã render/xuất từ trước hoặc chọn video bất kỳ từ máy tính.
  - Bộ filter `atempo` ghép chuỗi khi tốc độ > 2.0 hoặc < 0.5.
  - Tùy chọn bảo toàn âm vực giọng nói (`preservePitch`).
  - Giao diện Modal tương tác và các nút kích hoạt nhanh sau khi render.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Không thay đổi logic nhịp độ của TTS dubbing pipeline trong `autoShortPolicy.ts` (vẫn tuân thủ ADR 005 / trần tempo 1.80x của dubbing).

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Filter FFmpeg:* Sử dụng `setpts=(1/speed)*PTS` cho hình ảnh và `atempo=speed` cho âm thanh. Giúp âm thanh và hình ảnh co ngắn chính xác theo tỷ lệ mà giọng người không bị biến thành giọng sóc chuột (chipmunk).
- *Xử lý hậu kỳ độc lập:* Vì video đã xuất đã được gán phụ đề cứng (hardsub) hoặc hiệu ứng, việc tua nhanh toàn bộ file video thành phẩm đảm bảo phụ đề, nhạc nền, SFX và hình ảnh luôn luôn đồng bộ tuyệt đối (in-sync).

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` [src/main/videoSpeed.ts](file:///f:/Son/tool/TediaPros/src/main/videoSpeed.ts)
- `[NEW]` [src/renderer/src/components/VideoSpeedModal.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/VideoSpeedModal.tsx)
- `[NEW]` [tests/video-speed.test.ts](file:///f:/Son/tool/TediaPros/tests/video-speed.test.ts)
- `[MODIFY]` [src/shared/types.ts](file:///f:/Son/tool/TediaPros/src/shared/types.ts)
- `[MODIFY]` [src/preload/index.ts](file:///f:/Son/tool/TediaPros/src/preload/index.ts)
- `[MODIFY]` [src/main/index.ts](file:///f:/Son/tool/TediaPros/src/main/index.ts)
- `[MODIFY]` [src/renderer/src/App.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/App.tsx)
- `[MODIFY]` [src/renderer/src/components/AutoShort.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/AutoShort.tsx)
- `[MODIFY]` [src/renderer/src/components/VideoEditor.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/VideoEditor.tsx)
- `[MODIFY]` [scripts/run-local-runtime-tests.mjs](file:///f:/Son/tool/TediaPros/scripts/run-local-runtime-tests.mjs)

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:
```powershell
cmd.exe /c "npm run typecheck"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs video-speed.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-ui-contract.test video-speed.test"
```

### Kết quả thực tế:
- `Typecheck (node + web)`: PASS (0 errors)
- `video-speed.test.ts`: PASS (5/5 tests passed)
  - `buildAtempoFilter formats standard and chained speeds correctly`
  - `buildVideoSpeedFilter creates correct filter graph without audio`
  - `buildVideoSpeedFilter creates correct filter graph with pitch preservation`
  - `buildVideoSpeedFilter creates correct filter graph without pitch preservation`
  - `generateSpeedOutputName handles non-existent and collision names`
