# SCOPE.md — Bối Cảnh, Phạm Vi Khảo Sát & Phương Pháp Luận

Tài liệu này ghi nhận hiện trạng kho mã nguồn tại thời điểm khảo sát, phạm vi thực hiện và phương pháp kiểm chứng kỹ thuật.

---

## 1. Snapshot Khảo Sát

- **Ngày khảo sát:** 2026-09-07
- **Đường dẫn gốc:** `F:\Son\tool\TediaPros`
- **Git Branch:** `main`
- **Git Commit HEAD:** `6291184eddc6df893ef13eaae68bdd1d27736812`
  - Thông điệp commit: `fix(ci): pin DirectML separator build dependency`
  - Tác giả: `nhathaofn <nhathao7043@gmail.com>`
- **Trạng thái Working Tree:**
  - Tracked source files: 100% sạch (không có thay đổi uncommitted trên tệp nguồn).
  - Untracked items:
    - `.ai/`: Thư mục cấu hình agent quy trình nội bộ.
    - `docs/adr/`, `docs/architecture.md`, `docs/domain.md`: Thư mục tài liệu kỹ thuật đã có.
    - `out-codex-check*` (tại root và `src/renderer/`): Các tệp sinh tự động từ script test bundle cũ.

---

## 2. Phương Pháp Luận Khảo Sát

Chúng tôi áp dụng phương pháp khảo sát ba tầng nghiêm ngặt:
1. **Kiểm kê 100% (Full Inventory):**
   - Quét toàn bộ tệp bằng công cụ hệ thống (`git ls-files` kết hợp `git status --porcelain`).
   - Lập danh mục chi tiết với kích thước byte, số dòng, trạng thái git và phân loại kỹ thuật trong [FILE_INVENTORY.tsv](./FILE_INVENTORY.tsv).
2. **Đọc theo Context Routing (Nguyên tắc AGENTS.md):**
   - Không nạp toàn bộ repo một lúc gây loãng ngữ cảnh.
   - Đọc các AGENTS.md chuyên biệt của từng module trước khi truy vết mã nguồn chi tiết.
   - Đọc từng dòng các tệp do dự án sở hữu thuộc `src/shared/`, `src/preload/`, `src/main/`, `src/renderer/` và `engines/`.
3. **Quy Tắc Bằng Chứng Độc Lập:**
   - Mọi kết luận kỹ thuật đều gắn nhãn phân loại:
     - `CODE_CONFIRMED`: Trích xuất trực tiếp từ mã nguồn kèm file và số dòng.
     - `TEST_CONFIRMED`: Đã chạy lệnh kiểm thử cụ thể và có kết quả pass tại môi trường khảo sát.
     - `DOCUMENTED_ONLY`: Chỉ xuất hiện trong tài liệu cũ hoặc kế hoạch nhưng chưa tìm thấy mã nguồn thực thi.
     - `INFERRED`: Suy luận logic có cơ sở rõ ràng.
     - `UNKNOWN`: Chưa đủ thông tin xác minh.

---

## 3. Phạm Vi Loại Trừ Có Căn Cứ (Justified Exclusions)

Để đảm bảo hiệu quả khảo sát mà không làm ô nhiễm bộ nhớ ngữ cảnh, các nhóm sau được xếp loại "Chỉ kiểm kê" (Inventory Only) hoặc "Loại trừ" (Excluded):

1. **`node_modules/` và `.git/`:** Loại trừ hoàn toàn khỏi việc đọc nội dung; đây là thư mục dependency bên ngoài và metadata của VCS.
2. **Các tệp nhị phân đồ họa & font chữ:**
   - Font TrueType: `resources/fonts/*.ttf` (5 tệp).
   - Biểu tượng ứng dụng: `build/*.ico`, `build/*.png`, `src/renderer/src/assets/*.png` (5 tệp).
   - Lý do: Không chứa mã nguồn văn bản; được kiểm kê sự hiện diện và kích thước.
3. **Các tệp bundle sinh tự động tạm thời (Untracked Test Builds):**
   - `out-codex-check-20260906*` và `out-codex-check/` (chứa các tệp `index-*.js`, `index-*.css` sinh ra từ lệnh test bundle trước đó).
   - Lý do: Đây là build artifacts cũ, không phải mã nguồn nguồn cội (source of truth).
4. **`package-lock.json`:**
   - Dung lượng >15,000 dòng, được quản lý tự động bởi npm. Chỉ đọc kiểm tra phiên bản các package trọng yếu (`electron 34.0.0`, `react 19.0.0`, `vite 6.0.7`).
