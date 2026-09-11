# Phân Hệ Xóa Chữ AI STTN (STTN Inpainting Subsystem)

- **Thư mục mã nguồn:** `src/main/inpainting/` & `engines/sttn-engine/`
- **Tài liệu tham chiếu:** [src/main/inpainting/AGENTS.md](file:///f:/Son/tool/TediaPros/src/main/inpainting/AGENTS.md), [docs/adr/006-sttn-inpainting-vs-masked-blur.md](file:///f:/Son/tool/TediaPros/docs/adr/006-sttn-inpainting-vs-masked-blur.md)

---

## 1. Trách Nhiệm Cốt Lõi
- Quản lý việc thực thi engine xóa chữ AI [engines/sttn-engine](file:///f:/Son/tool/TediaPros/engines/sttn-engine) qua giao thức JSONL `sttn-engine/1` ([runner.ts](file:///f:/Son/tool/TediaPros/src/main/inpainting/runner.ts)).
- Quản lý assets, models và weights phục vụ cho quá trình inpainting ([assets.ts](file:///f:/Son/tool/TediaPros/src/main/inpainting/assets.ts)).
- Chuyển đổi timeline bounding box từ RapidOCR sang mặt nạ chuỗi thời gian phù hợp với kích thước khung hình video.
- Đảm bảo cây tiến trình Python STTN được giải phóng triệt để khi hủy qua `terminateProcessTree`.

---

## 2. Quy Tắc Kỹ Thuật Bắt Buộc
1. **Giao thức JSONL Chuẩn Hóa (`sttn-engine/1`):**
   - Dữ liệu giao tiếp giữa Node.js và Python STTN qua stdio theo từng dòng JSON:
     - `{"protocol":"sttn-engine/1","type":"progress","percent":35,"phase":"inpainting"}`
     - `{"protocol":"sttn-engine/1","type":"done","outputPath":"...","provider":"cuda","elapsedMs":1420}`
2. **Không để tiến trình chiếm giữ tệp khi hủy (File Locking Prevention):**
   - Trên Windows, nếu tiến trình con Python chưa thoát hẳn, các tệp video và frame tạm thời sẽ bị hệ điều hành khóa (`EBUSY` / `EPERM`).
   - Runner STTN cam kết: Không bao giờ giải quyết (settle) promise hủy trước khi tiến trình con thực sự dừng hẳn.
3. **Kiểm tra đường dẫn an toàn:** Mọi tệp video đầu vào và đầu ra đều phải đi qua `assertContainedRegularFile`.

---

## 3. Kiểm Thử Liên Quan
```powershell
cmd.exe /c "node scripts/run-local-runtime-tests.mjs sttn-contract.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs sttn-pipeline.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs sttn-runtime.test"
cmd.exe /c "npm run test:sttn-engine"
```
