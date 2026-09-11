# SECURITY_AND_LICENSE.md — Bảo Mật, An Toàn Dữ Liệu & Giấy Phép Bản Quyền

Tài liệu này làm rõ các quy tắc an toàn bất khả xâm phạm và cam kết bản quyền của **TediaPros**.

---

## 1. Giấy Phép Bản Quyền PolyForm Noncommercial 1.0.0

- **Loại giấy phép:** **PolyForm Noncommercial License 1.0.0** kết hợp ghi công ([LICENSE](file:///f:/Son/tool/TediaPros/LICENSE), [NOTICE](file:///f:/Son/tool/TediaPros/NOTICE)).
- **Nguyên tắc bất khả xâm phạm:**
  1. Dự án chỉ được sử dụng cho mục đích cá nhân, học tập, nghiên cứu và phi thương mại.
  2. Nghiêm cấm bán lại, thu phí sử dụng phần mềm, hoặc nhúng mã nguồn vào các dịch vụ thương mại hóa mà không có văn bản chấp thuận của tác giả.
  3. Mọi bản phân phối hoặc dẫn xuất phải giữ nguyên toàn văn file `LICENSE` và `NOTICE`.

---

## 2. An Toàn Đường Dẫn Tuyệt Đối (`safeContainedPath.ts`)

- **Rủi ro:** Khi người dùng nhập đường dẫn file từ bên ngoài hoặc từ URL, kẻ tấn công có thể chèn chuỗi `../` để ghi đè các tệp hệ điều hành (`system32`, `/etc/passwd`).
- **Giải pháp:**
  - Tất cả các thao tác đọc, ghi, xóa file trong `src/main/` đều đi qua `assertContainedRegularFile(baseDir, targetFile)` hoặc `assertContainedParentDirectory`.
  - Nghiêm cấm tuyệt đối mọi thao tác file vượt ra khỏi thư mục đích (`outputDir`, `scratchDir`, `userData`).

---

## 3. Bảo Vệ Khóa Bí Mật & Dữ Liệu Cá Nhân

1. **Khóa API Dịch Thuật (OpenAI, Gemini):**
   - Khóa API của người dùng được lưu trữ cục bộ trong thư mục `userData/keys.json`.
   - Ứng dụng **không bao giờ gửi khóa API** về bất kỳ máy chủ thu thập dữ liệu nào của TediaPros. Khóa chỉ được gửi trực tiếp từ máy người dùng đến endpoint chính thức của Google Gemini hoặc OpenAI qua giao thức HTTPS.
2. **Quản Lý Phiên Cookie:**
   - Cookie đăng nhập mạng xã hội (YouTube, Douyin) chỉ được dùng để vượt qua rào cản anti-crawler của yt-dlp và dy-downloader.
   - Không xuất log chứa giá trị cookie; các chuỗi cookie được che giấu (redacted) trong báo cáo `SupportReport`.

---

## 4. Xác Thực Tính Toàn Vẹn Checksum SHA-256

- Mọi tệp nhị phân runtime và weights mô hình AI tải về đều được đối soát với mã băm SHA-256 đã ghim cứng trong `distribution/runtime-inputs.json` và `distribution/separator-model-inputs.json`.
- Ngăn chặn nguy cơ tấn công Man-in-the-Middle (MitM) hoặc việc tệp bị can thiệp trên đường truyền mạng.
