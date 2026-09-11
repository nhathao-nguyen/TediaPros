# DEVELOPMENT.md — Hướng Dẫn Phát Triển & Mở Rộng Mã Nguồn

Tài liệu này dành cho kỹ sư phần mềm muốn thiết lập môi trường, chạy ứng dụng, viết code mới và nắm bắt quy chuẩn kỹ thuật của TediaPros.

---

## 1. Yêu Cầu Môi Trường & Cài Đặt

- **Node.js:** Phiên bản 20.x trở lên (môi trường khảo sát hiện tại: **Node.js v24.19.0**).
- **Trình quản lý gói:** npm (đi kèm Node.js).
- **Python:** Phiên bản 3.10 hoặc 3.11 x64 (để chạy và test các sidecar engines).
- **Hệ điều hành:** Windows 10/11 x64 hoặc macOS 12+ ARM64.

### Lệnh Cài Đặt & Khởi Chạy:
```powershell
# Lưu ý trên Windows PowerShell: Nếu gặp lỗi script execution policy, dùng cmd.exe /c "npm ..."
cmd.exe /c "npm install"

# Khởi động chế độ phát triển (Electron + Vite Hot Reload)
cmd.exe /c "npm run dev"
```

---

## 2. Bản Đồ Hướng Dẫn "Muốn Sửa X Thì Tìm Ở Đâu"

| Khi Bạn Muốn... | Bắt Đầu Tại Tệp / Thư Mục Nào? |
| :--- | :--- |
| Thêm một Tab giao diện mới | `src/renderer/src/App.tsx` (thêm vào `TABS` array) và tạo component trong `src/renderer/src/components/`. |
| Sửa đổi giao diện AutoShort | `src/renderer/src/components/AutoShort.tsx` và styles tại `src/renderer/src/styles/autoshort.css`. |
| Thêm một hàm IPC mới | 1. Khai báo kiểu trong `src/shared/types.ts` $\rightarrow$ 2. Expose trong `src/preload/index.ts` $\rightarrow$ 3. Đăng ký handler trong `src/main/index.ts`. |
| Chỉnh sửa thuật toán căn nhịp Dubbing | `src/main/dubbing/policy.ts` và `src/main/dubbing/plan.ts`. |
| Tinh chỉnh bộ lọc làm mờ OCR Planar RGB | `src/main/burn.ts` (hàm `buildFilterComplex`) và `src/main/ocrMask.ts`. |
| Thêm nhà cung cấp dịch thuật AI mới | `src/main/translate-shared.ts` và giao diện chọn tại `src/renderer/src/components/AutoShort.tsx`. |
| Thay đổi model tách thoại MDX | `distribution/separator-model-inputs.json` và `src/main/separation/modelManifest.ts`. |
| Cập nhật hoặc thêm engine Python | `engines/<engine-name>/` và file `.spec` tương ứng để đóng gói PyInstaller. |

---

## 3. Quy Chuẩn Bắt Buộc Khi Đóng Góp Code (Definition of Done)

1. **Chạy Typecheck trước khi commit:**
   `cmd.exe /c "npm run typecheck"` $\rightarrow$ Bắt buộc phải đạt 0 lỗi ở cả Node và Web.
2. **Không phá vỡ tính Isomorphic trong `src/shared/`:**
   Không import thư viện đặc thù Node vào `src/shared/`.
3. **Chạy lại các test liên quan:**
   Xem chi tiết các lệnh test trong [TESTING.md](./TESTING.md).
