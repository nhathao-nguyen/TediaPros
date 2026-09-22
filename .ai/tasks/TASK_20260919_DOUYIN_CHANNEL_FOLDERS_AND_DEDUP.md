# TASK_20260919_DOUYIN_CHANNEL_FOLDERS_AND_DEDUP: Quản Lý Thư Mục Kênh & Kiểm Tra Trùng Video Douyin

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** AI Coding Agent
- **Thời gian:** 2026-09-19

---

## 1. Mục Tiêu (Goal)

1. Lưu danh sách thư mục nơi các video trước đó đã tải về cho từng kênh trong Thư viện kênh Douyin; hiển thị rõ ràng đường dẫn thư mục cho người dùng, hỗ trợ mở thư mục trong Explorer và đổi thư mục lưu nếu muốn.
2. Tải về đúng folder lần trước: khi bấm "🔔 Lấy video mới" từ một kênh trong thư viện, công việc tải sẽ được chỉ định đúng folder riêng của kênh đó.
3. Kiểm tra video đã tồn tại hay chưa bằng file lưu ID các video đã lấy (`downloaded_ids.txt`) kết hợp danh sách video thực tế trong folder.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] `DyChannel` lưu và trả về `folderPath`.
- [x] Tự động khôi phục `folderPath` từ cơ sở dữ liệu `dy-library.db` cho các kênh cũ đã tải trước đó.
- [x] UI hiển thị đường dẫn thư mục của từng kênh, có nút mở thư mục và nút đổi thư mục.
- [x] Bấm "🔔 Lấy video mới" tải về đúng thư mục của kênh.
- [x] File `downloaded_ids.txt` được tạo và duy trì trực tiếp trong thư mục kênh, tự động đồng bộ từ file video hiện có.
- [x] Cơ chế `_should_download` trong Python engine kết hợp file lưu ID và file video thực tế trên đĩa: bỏ qua nếu đã có video, tải lại nếu video bị xoá khỏi folder, tải mới nếu chưa có.
- [x] `npm run typecheck` pass 100% không có lỗi.
- [x] Unit test `douyin-channel-folder.test.ts` pass 100%.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Cập nhật kiểu `DyChannel` và API IPC (`douyin:updateChannelFolder`).
  - Quản lý kênh, khôi phục `folderPath`, đồng bộ `downloaded_ids.txt` trong `src/main/douyin.ts`.
  - Nâng cấp deduplication trong Python engine `engines/douyin-engine/core/downloader_base.py`.
  - Cập nhật giao diện `Douyin.tsx` và styles `douyin.css`.
  - Bộ test xác minh `tests/douyin-channel-folder.test.ts`.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Không can thiệp sửa đổi các tính năng tải khác ngoài Douyin.
  - Bỏ qua lỗi api_403 của API phân trang Douyin theo yêu cầu người dùng.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn 1:* Lưu file ID dạng văn bản đơn giản `downloaded_ids.txt` (mỗi dòng 1 ID) ngay tại thư mục của kênh.
  - *Lý do:* Người dùng có thể dễ dàng kiểm tra, mở bằng Notepad hoặc copy nếu cần.
- *Lựa chọn 2:* Hai tầng đồng bộ (Node.js + Python sidecar).
  - *Lý do:* Đảm bảo dù chạy qua Python script dev hay binary đóng gói, file ID và danh sách video luôn được đồng bộ chặt chẽ.
- *Lựa chọn 3:* Tự động khôi phục `folderPath` từ `dy-library.db` (bảng `awemes`).
  - *Lý do:* Giúp người dùng ngay lập tức thấy lại vị trí đã tải của các kênh trước đó (`叮叮科普`, `小温夫妻测评`) mà không phải chọn lại bằng tay.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` [src/shared/types.ts](file:///f:/Son/tool/TediaPros/src/shared/types.ts)
- `[MODIFY]` [src/preload/index.ts](file:///f:/Son/tool/TediaPros/src/preload/index.ts)
- `[MODIFY]` [src/main/douyin.ts](file:///f:/Son/tool/TediaPros/src/main/douyin.ts)
- `[MODIFY]` [src/main/index.ts](file:///f:/Son/tool/TediaPros/src/main/index.ts)
- `[MODIFY]` [engines/douyin-engine/core/downloader_base.py](file:///f:/Son/tool/TediaPros/engines/douyin-engine/core/downloader_base.py)
- `[MODIFY]` [src/renderer/src/components/Douyin.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/Douyin.tsx)
- `[MODIFY]` [src/renderer/src/styles/douyin.css](file:///f:/Son/tool/TediaPros/src/renderer/src/styles/douyin.css)
- `[NEW]` [tests/douyin-channel-folder.test.ts](file:///f:/Son/tool/TediaPros/tests/douyin-channel-folder.test.ts)
- `[MODIFY]` [scripts/run-local-runtime-tests.mjs](file:///f:/Son/tool/TediaPros/scripts/run-local-runtime-tests.mjs)

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:
```powershell
cmd.exe /c "npm run typecheck"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs douyin-channel-folder.test"
```

### Kết quả thực tế:
- `Typecheck`: PASS (0 errors)
- `Test results`: PASS (2 tests in douyin-channel-folder.test.ts passed, 0 failed)
- `Python deduplication logic`: ALL test cases verification passed (chỉ tính file video thực tế, bỏ qua ảnh/nhạc, quét đệ quy qua mọi cấp folder con sâu bên trong).

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Hệ thống chỉ lọc các file video thực tế (`.mp4`, `.mkv`, `.mov`, `.webm`, `.avi`, `.flv`, `.ts`, `.m4v`), không coi ảnh cover hay nhạc là video.
- Quét đệ quy không giới hạn cấp độ thư mục con bên trong thư mục kênh (như `sub1`, `sub2`, `deep/...`).

