# TASK-20260911: Review chức năng chỉnh hình ảnh Auto Short

- **Trạng thái:** Hoàn thành review; 3 lỗi P2 đã sửa và kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

## 1. Mục tiêu

Review bản triển khai chưa commit trên branch `codex/autoshort-video-adjustments`, HEAD `fd0123a832f2e0f1c0cd8c2cebe176f96afc72e6`. Đối chiếu yêu cầu trong `docs/video-adjustments.md` với code hiện tại và hành vi thực tế. Checkout chứa nhiều thay đổi khác của người dùng; chỉ review chức năng chỉnh hình ảnh.

## 2. Tiêu chuẩn nghiệm thu review

- [x] Kiểm tra đường truyền cấu hình và thứ tự filter.
- [x] Tái hiện hành vi kéo phụ đề, nhập số và kích thước bảng điều chỉnh trong Electron.
- [x] Render FFmpeg thực tế cho các tổ hợp manual/OCR, có/không ASS, có/không portrait.
- [x] Typecheck và 22 test chức năng/contract chạy thành công.
- [x] Báo cáo lỗi có dòng code, điều kiện tái hiện và bằng chứng.

## 3. Phạm vi

- Các helper `videoAdjustments`, contract AutoShort/Burn, truyền cấu hình từ coordinator, filter render, `VideoAdjustmentsControl`, `RegionBox`, `PortraitFramePreview`.
- Không sửa mã nguồn hoặc trạng thái Git trong lượt review. Chỉ thêm biên bản và bằng chứng.
- Không đánh giá lại các thay đổi SEO/Gemini/translation/release không thuộc chức năng.

## 4. Kết quả review

### P2 — Ô nhập số thay đổi giá trị giữa lúc người dùng đang gõ — Đã sửa

- **Vị trí:** `src/renderer/src/components/VideoAdjustmentsControl.tsx:44-48` và `83-89`.
- **Tái hiện:** Chọn toàn bộ số trong ô, nhập từng ký tự qua API nhập liệu Electron vào input đang focus.
- Gõ Zoom `110`: sau ba ký tự, ô hiển thị lần lượt `100`, `120`, `120`; cấu hình lưu `zoom: 120`.
- Gõ độ sáng `-5`: dấu âm bị thay bằng giá trị cũ; kết quả lưu `brightness: 5`.
- Gõ tương phản `103`: hiển thị `50`, `150`, `150`; kết quả lưu `contrast: 150`.
- **Nguyên nhân:** Cả slider và number input dùng chung hàm clamp ngay trong mỗi `onChange`; giá trị số điều khiển input không giữ được trạng thái nhập dở như `-`, `1` hoặc chuỗi rỗng.
- **Ảnh hưởng:** Giá trị được lưu và chuyển vào render có thể khác giá trị người dùng định nhập.
- **Hướng sửa:** Giữ chuỗi nhập tạm riêng cho number input, chỉ commit giá trị hợp lệ khi nhập xong/blur/Enter; slider có thể tiếp tục cập nhật tức thời.
- **Bản sửa:** Mỗi ô số giữ chuỗi nhập tạm. Giá trị chỉ được phát ra khi chuỗi là một số nguyên hợp lệ trong giới hạn; blur/Enter mới chuẩn hóa giá trị ngoài giới hạn. Escape hủy chuỗi nhập dở.
- **Kiểm chứng sau sửa:** Nhập từng ký tự cho `110`, `-5`, `103` lưu đúng cả ba giá trị. Ca Escape với Zoom tạm thời là `9` giữ nguyên cấu hình đã commit `110`.

### P2 — Kéo/co giãn phụ đề bị chia nhầm cho hệ số zoom nguồn — Đã sửa

- **Vị trí:** `src/renderer/src/components/RegionBox.tsx:184-185`; vị trí hiển thị phụ đề tại `476-479`.
- **Tái hiện:** Kéo khung phụ đề lên 60 px bằng sự kiện chuột Electron. Zoom 100% cho dịch chuyển -60.09375 px; zoom 120% chỉ dịch chuyển -49.6875 px.
- **Nguyên nhân:** Hàm kéo sử dụng `videoAdjustmentSourceDelta(..., previewZoom)` cho cả `sub`, `blur` và `ocr`. Trong khi đó, phụ đề mới được hiển thị bằng tọa độ không zoom và render sau bước chỉnh hình.
- **Ảnh hưởng:** Khung phụ đề không bám con trỏ khi zoom lớn hơn 100%; cả di chuyển và co giãn dùng cùng phép tính sai.
- **Hướng sửa:** Chỉ chia zoom cho vùng nguồn blur/OCR; dùng tỷ lệ 100% khi target là `sub`.
- **Bản sửa:** `RegionBox` dùng zoom 100% cho target `sub`; vùng blur/OCR vẫn quy đổi theo zoom nguồn.
- **Kiểm chứng sau sửa:** Ở Zoom 112%, kéo khung phụ đề lên 60 px tạo dịch chuyển thực tế -59.59375 px, nằm trong sai số 2 px của phép đo layout.

### P2 — Bảng điều chỉnh bị cắt trong kích thước cửa sổ được hỗ trợ — Đã sửa

- **Vị trí:** `src/renderer/src/components/VideoAdjustmentsControl.css:5-10`; ancestor `.editor-canvas-panel` có `overflow: hidden` trong `styles/editor.css`.
- **Tái hiện:** Dùng AutoShort thật trong cấu trúc `.shell > .sidebar + .content` theo `App.tsx`, với CSS thật của ứng dụng. Ở cửa sổ 1040 px, bảng trải từ x=378.03125 đến x=738.03125 trong khi panel cha kết thúc tại x=644. Cửa sổ 1100 px cũng bị cắt. `src/main/index.ts` cho phép `minWidth: 1040`.
- **Ảnh hưởng:** Mất các ô số bên phải và nút đóng. Ảnh `panel-1040.png` thể hiện lỗi.
- **Nguyên nhân:** Bảng neo trái vào nút và giới hạn chiều rộng theo viewport, không xét không gian còn lại trong panel đang clip.
- **Hướng sửa:** Định vị bảng theo phần không gian thực tế hoặc dùng portal/popover không bị ancestor clip; kiểm tra cả trái/phải khi header xuống dòng.
- **Bản sửa:** Bảng dùng tọa độ fixed theo vị trí nút và viewport, tính lại khi resize/scroll, giới hạn chiều rộng và có cuộn dọc khi cần. Vì fixed không chịu vùng clip của `.editor-canvas-panel`, toàn bộ điều khiển vẫn thao tác được.
- **Kiểm chứng sau sửa:** Với BrowserWindow rộng 1040 px, viewport nội dung là 1024 px; bảng nằm trong x=499.734375..859.734375 và điểm sát mép phải hit đúng phần tử của bảng.

## 5. Tệp báo cáo và bằng chứng

- `[NEW]` `.ai/tasks/TASK-20260911-autoshort-video-adjustments-review.md`
- `[NEW]` `docs/reviews/2026-09-11-video-adjustments/review/video-adjustments-results.json`: thao tác kéo chuột và nhập từng ký tự.
- `[NEW]` `docs/reviews/2026-09-11-video-adjustments/review/shell-results.json`: tọa độ bảng trong bố cục có sidebar.
- `[NEW]` `docs/reviews/2026-09-11-video-adjustments/review/panel-1040.png`: bảng bị cắt ở chiều rộng tối thiểu được hỗ trợ.
- `[NEW]` `docs/reviews/2026-09-11-video-adjustments/review/render-matrix.json`: 8 tổ hợp render thành công.
- `[NEW]` `docs/reviews/2026-09-11-video-adjustments/video-adjustments-results.json`: kết quả kiểm thử hồi quy sau sửa.
- `[NEW]` `docs/reviews/2026-09-11-video-adjustments/autoshort-adjustments-panel.png`: bảng sau sửa ở chiều rộng cửa sổ tối thiểu.

## 6. Kiểm chứng

- `npm.cmd run typecheck`: PASS cho Node và Web.
- `node scripts/run-local-runtime-tests.mjs video-adjustments.test autoshort-ocr-contract.test`: 22 PASS, 0 FAIL, 0 SKIP.
- `git diff --check`: PASS; có cảnh báo line ending ở tệp translation đã được sửa từ trước.
- Probe Electron dùng bản sao tạm của `scripts/test-video-adjustments-preview.mjs`, profile riêng và video tổng hợp. Kéo bằng `webContents.sendInputEvent`; nhập từng ký tự bằng `webContents.insertText` vào input đã focus/chọn toàn bộ. Không phát sinh lỗi JavaScript trong các ca tái hiện.
- Probe layout sử dụng component AutoShort và CSS thật, dựng lại cấu trúc shell/sidebar/content từ `App.tsx`; không khởi động các tab và dịch vụ khác của app.
- Probe FFmpeg gọi trực tiếp hai hàm dựng graph hiện tại, kiểm tra 8 tổ hợp manual/OCR × ASS bật/tắt × portrait bật/tắt với `{zoom:110, brightness:5, saturation:95, contrast:103}`. Mỗi ca xuất/giải mã thành công, đúng 4 frame/0.4 giây, kích thước 320×180 hoặc 1080×1920. SHA-256 âm thanh PCM sau giải mã trùng nguồn ở cả 8 ca.
- Đọc code xác nhận: automatic OCR vẫn dùng `format=gbrp` trước `maskedmerge`; chỉnh hình đặt sau mask và trước ASS/portrait; coordinator truyền `videoAdjustments`; contract kiểm tra số hữu hạn và giới hạn.
- Sau sửa, `npm.cmd run typecheck`: PASS cho Node và Web.
- Sau sửa, 7 bộ test đúng phạm vi: 61 PASS, 0 FAIL, 0 SKIP.
- Probe Electron sau sửa kiểm tra nhập từng ký tự, Escape khi nhập dở, kéo phụ đề, layout 1040 px, lưu cấu hình, payload chạy và trạng thái disabled; tất cả PASS, không có lỗi JavaScript.
- Sau sửa, `npm.cmd run build` và `npm.cmd run test:subtitles` với managed FFmpeg: PASS.
- Sau sửa, `git diff --check`: PASS; chỉ có cảnh báo line ending ở tệp translation đã sửa từ trước.

### Giới hạn bằng chứng

- Probe render trực tiếp kiểm tra graph và FFmpeg; không phải batch OCR/Whisper/STTN/TTS hoàn chỉnh trên video người dùng.
- Lượt review ban đầu không chạy build. Sau khi sửa đã chạy build và 61 test đúng phạm vi; không chạy lại toàn bộ `test:local-runtime` vì suite này có lỗi `release-tooling.test` ngoài phạm vi từ bản `electron-builder.yml` đã sửa sẵn.
- Reviewer độc lập bị dừng bởi giới hạn sử dụng trước khi hoàn tất. Kết luận trên dựa vào kiểm chứng trực tiếp của agent chính.

## 7. Bàn giao

Ba lỗi P2 đã được sửa trong phạm vi renderer và có kiểm thử hồi quy bằng thao tác Electron thật. Bằng chứng lỗi ban đầu trong thư mục `review/` được giữ lại để đối chiếu trước/sau.
