# Phân Hệ Tiến Trình Chính (Electron Main Core)

- **Thư mục mã nguồn:** `src/main/` (core files: `index.ts`, `appIdentity.ts`, `logger.ts`, `cookies.ts`, `proxy.ts`, `processTree.ts`, `safeContainedPath.ts`)

---

## 1. Trách Nhiệm Cốt Lõi
- Quản lý vòng đời ứng dụng Electron: Khởi động (`whenReady`), tạo cửa sổ `BrowserWindow`, quản lý trạng thái nền và đóng ứng dụng (`before-quit`).
- Đăng ký và xử lý giao thức custom streaming `tblao:`, giải quyết bài toán phát video/audio cục bộ an toàn với tính năng tua thời gian (Range Request).
- Duyệt và quản lý cây tiến trình con (`processTree.ts`), đảm bảo không để lại tiến trình ma khi người dùng bấm Hủy.
- Quản lý hệ thống ghi nhật ký thời gian thực (`logger.ts`) và tạo báo cáo hỗ trợ kỹ thuật (`support.ts`).

---

## 2. Chi Tiết Các Cơ Chế Kỹ Thuật Trọng Yếu

### 2.1. Giao thức cục bộ `tblao:` (Local Media Streaming)
Tại [src/main/index.ts#L40-L45](file:///f:/Son/tool/TediaPros/src/main/index.ts#L40-L45):
- Giao thức được cấp quyền đặc biệt: `standard: true, secure: true, stream: true, supportFetchAPI: true`.
- Khi Renderer yêu cầu một file video qua URL `tblao:///C:/path/to/video.mp4`, Main Process phân tích header `Range: bytes=start-end`.
- Nếu có Range Request, mở stream `createReadStream(path, { start, end })` và trả về HTTP `206 Partial Content`.
- Đảm bảo video trong React Player có thể tua tiến/lùi mượt mà mà không phải tải toàn bộ file hàng trăm MB vào RAM.

### 2.2. Kiểm Soát Đường Dẫn An Toàn (`safeContainedPath.ts`)
- Hàm `assertContainedRegularFile(baseDir, relativePath)`:
  1. Kiểm tra không chứa ký tự null byte `\0`.
  2. Phân giải đường dẫn tuyệt đối bằng `resolve(baseDir, relativePath)`.
  3. Kiểm tra tính bao hàm bằng `relative(baseDir, resolved)`: nếu bắt đầu bằng `..` hoặc ký tự ổ đĩa khác, lập tức ném lỗi bảo mật.
  4. Đảm bảo file tồn tại và không phải là symlink trỏ ra ngoài.

### 2.3. Quản Lý Cây Tiến Trình Con (`processTree.ts`)
- Khi spawn các tiến trình con FFmpeg, Python RapidOCR, MDX-Net:
  - Gọi `trackChildProcess(child)` để đưa PID vào danh sách theo dõi.
  - Khi cần dừng (Cancel/Abort/Quit): Gọi `terminateProcessTree(child)`. Trên Windows, lệnh thực thi `taskkill /pid <PID> /T /F` để hủy triệt để cả tiến trình con và mọi tiến trình cháu.

---

## 3. Kiểm Thử Liên Quan
```powershell
cmd.exe /c "npm run typecheck:node"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs release-tooling.test"
```
