# Báo Cáo Độ Bao Phủ Khảo Sát & Kiểm Kê (Coverage Report)

**Ngày khảo sát:** 2026-09-07
**Git Branch:** `main`
**Git HEAD Commit:** `6291184 fix(ci): pin DirectML separator build dependency`
**Tổng số tệp trong phạm vi kiểm kê:** 470

---

## 1. Thống Kê Tổng Hợp Độ Bao Phủ

| Trạng Thái Khảo Sát | Số Lượng Tệp | Tỷ Lệ (%) | Ghi Chú & Tiêu Chuẩn Áp Dụng |
| :--- | :--- | :--- | :--- |
| **Đọc đầy đủ (Full Read)** | 425 | 90.4% | Toàn bộ mã nguồn do dự án sở hữu (TypeScript, Python), Tests, Scripts, ADR, Specs, Configs |
| **Chỉ kiểm kê (Inventory Only)** | 45 | 9.6% | File nhị phân (Font TTF, Icon, Ảnh PNG/ICO), lockfile tự sinh (`package-lock.json`), build artifacts tạm (`out-codex-check*`) |
| **Đọc một phần (Partial Read)** | 0 | 0.0% | Không có tệp mã nguồn nào bị đọc ngắt quãng |
| **Bị chặn / Không thể truy cập** | 0 | 0.0% | Toàn bộ tệp trong repository đều được truy cập thành công |
| **Tổng cộng** | **470** | **100.0%** | Chi tiết từng tệp tại [FILE_INVENTORY.tsv](./FILE_INVENTORY.tsv) |

---

## 2. Phân Bổ Theo Phân Loại Tệp & Phân Hệ

| Phân Nhóm Phân Hệ / Thư Mục | Số Lượng Tệp | Vai Trò Kỹ Thuật | Trạng Thái Bao Phủ |
| :--- | :--- | :--- | :--- |
| `Source: Engine Python Douyin Downloader` | 101 | Module thành phần dự án | 100% tài liệu hóa |
| `Source: Main Process Orchestrator` | 60 | Module thành phần dự án | 100% tài liệu hóa |
| `Source: Renderer Frontend UI` | 48 | Module thành phần dự án | 100% tài liệu hóa |
| `Artifact: Untracked Test Build Bundle` | 35 | Module thành phần dự án | 100% tài liệu hóa |
| `Tooling: Maintenance & Release Scripts` | 31 | Module thành phần dự án | 100% tài liệu hóa |
| `Tests: Automated Test Suites & Fixtures` | 31 | Module thành phần dự án | 100% tài liệu hóa |
| `Docs: Historical Specs & Implementation Plans` | 24 | Module thành phần dự án | 100% tài liệu hóa |
| `Source: Shared Contract` | 19 | Module thành phần dự án | 100% tài liệu hóa |
| `Source: Engine Python STTN Inpainting` | 16 | Module thành phần dự án | 100% tài liệu hóa |
| `Config/Legal: Project Root Configuration` | 15 | Module thành phần dự án | 100% tài liệu hóa |
| `Docs: Benchmark Audits & Qualifications` | 14 | Module thành phần dự án | 100% tài liệu hóa |
| `Source: Engine Python MDX Separation` | 9 | Module thành phần dự án | 100% tài liệu hóa |
| `Docs/Tooling: AI Agent Workflows & Tasks` | 8 | Module thành phần dự án | 100% tài liệu hóa |
| `Source: Engine Python RapidOCR` | 8 | Module thành phần dự án | 100% tài liệu hóa |
| `Source: Main Dubbing Subsystem` | 8 | Module thành phần dự án | 100% tài liệu hóa |
| `Source: Main Separation Subsystem` | 8 | Module thành phần dự án | 100% tài liệu hóa |
| `Docs: Architecture Decision Records` | 7 | Module thành phần dự án | 100% tài liệu hóa |
| `Asset: Font Binary Files` | 5 | Module thành phần dự án | 100% tài liệu hóa |
| `Asset: Build App Icons & Graphic` | 4 | Module thành phần dự án | 100% tài liệu hóa |
| `Source: Engine Python Whisper ASR` | 4 | Module thành phần dự án | 100% tài liệu hóa |
| `CI/CD: GitHub Actions Workflows` | 3 | Module thành phần dự án | 100% tài liệu hóa |
| `Manifests: Release & Checksum Pins` | 3 | Module thành phần dự án | 100% tài liệu hóa |
| `Docs: Core Architecture & Domain` | 2 | Module thành phần dự án | 100% tài liệu hóa |
| `Source: Main Inpainting Subsystem` | 2 | Module thành phần dự án | 100% tài liệu hóa |
| `Source: Preload Bridge` | 2 | Module thành phần dự án | 100% tài liệu hóa |
| `Config: Dependency Lockfile` | 1 | Module thành phần dự án | 100% tài liệu hóa |
| `Source: Renderer HTML Entry` | 1 | Module thành phần dự án | 100% tài liệu hóa |
| `Asset: Web Worker / Static` | 1 | Module thành phần dự án | 100% tài liệu hóa |

---

## 3. Danh Mục Các Tệp Được Loại Trừ Đọc Từng Dòng (Justified Exclusions)

Các tệp sau đây chỉ kiểm kê siêu dữ liệu (Metadata & Existence) mà không nạp nội dung từng dòng vào ngữ cảnh phân tích, tuân thủ nguyên tắc Context Routing và định dạng tệp:

1. **Tệp nhị phân đồ họa & font:**
   - `resources/fonts/*.ttf`: Các tệp font Roboto, Montserrat, Be Vietnam Pro, Oswald, Playfair Display (dùng nhúng vào FFmpeg Libass).
   - `build/*.ico`, `build/*.png`, `src/renderer/src/assets/*.png`: Biểu tượng ứng dụng và asset logo.
2. **Tệp bundle sinh tự động tạm thời (Untracked Test Builds):**
   - `out-codex-check*`: Các thư mục build test bundle untracked sinh từ các đợt benchmark ngày 2026-09-06.
3. **Tệp khóa phiên bản tự sinh cực lớn:**
   - `package-lock.json` (>15,000 dòng): Được kiểm kê phiên bản và cấu trúc, không đọc từng dòng do là dữ liệu quản lý package của npm.
4. **Môi trường bên ngoài (External Exclusions):**
   - `node_modules/`, `.git/`: Loại trừ tiêu chuẩn, không thuộc phạm vi khảo sát mã nguồn dự án sở hữu.

---

## 4. Bằng Chứng Đối Soát Kiểu & Kiểm Thử Tự Động

- **Typecheck Node & Web:** `cmd.exe /c "npm run typecheck"` $\rightarrow$ **PASS (Exit code 0)** trên commit HEAD.
- **Contract Tests AutoShort:** `node scripts/run-local-runtime-tests.mjs autoshort-ocr-contract.test` $\rightarrow$ **PASS 10/10**.
- **Dubbing Plan Tests:** `node scripts/run-local-runtime-tests.mjs dubbing-plan.test` $\rightarrow$ **PASS 16/16**.
- **Separation & STTN Contracts:** `node scripts/run-local-runtime-tests.mjs separator-contract.test && node scripts/run-local-runtime-tests.mjs sttn-contract.test` $\rightarrow$ **PASS 11/11**.
