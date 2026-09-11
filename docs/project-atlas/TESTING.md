# TESTING.md — Chiến Lược & Danh Mục Kiểm Thử Tự Động

Tài liệu này hệ thống hóa toàn bộ các bài kiểm thử tự động hiện có trong TediaPros, hướng dẫn thực thi và ghi nhận các khoảng trống kiểm thử.

---

## 1. Danh Mục Test Suites Tự Động Hiện Có

Hệ thống kiểm thử bao gồm **31 tệp test** trong thư mục `tests/`:

| Tên Bộ Test | Mục Tiêu Kiểm Thử | Lệnh Thực Thi |
| :--- | :--- | :--- |
| `autoshort-ocr-contract.test.ts` | Tiền kiểm cấu hình AutoShort, di trú legacy config, kiểm tra vùng OCR. | `node scripts/run-local-runtime-tests.mjs autoshort-ocr-contract.test` |
| `dubbing-plan.test.ts` | Kế hoạch source-anchored timing, trần nhịp độ (1.10x–1.45x), dự đoán thời lượng câu nói. | `node scripts/run-local-runtime-tests.mjs dubbing-plan.test` |
| `separator-contract.test.ts` | Kiểm tra hợp đồng tách thoại MDX, các presets (fast, balanced, quality). | `node scripts/run-local-runtime-tests.mjs separator-contract.test` |
| `sttn-contract.test.ts` | Kiểm tra hợp đồng STTN Inpainting, tiền kiểm vùng quét chữ. | `node scripts/run-local-runtime-tests.mjs sttn-contract.test` |
| `autoshort-disk-budget.test.ts` | Sổ cái dự trù đĩa tạm, phát hiện lỗi tràn đĩa ENOSPC. | `node scripts/run-local-runtime-tests.mjs autoshort-disk-budget.test` |
| `autoshort-item-scope.test.ts` | Quản lý vòng đời item, hủy bỏ tiến trình con qua AbortSignal. | `node scripts/run-local-runtime-tests.mjs autoshort-item-scope.test` |
| `ocr-mask.test.ts` | Tính toán MD5 hash khung hình mặt nạ nhị phân làm mờ OCR. | `node scripts/run-local-runtime-tests.mjs ocr-mask.test` |
| `ocr-visual-timeline.test.ts` | Thuật toán IoU và gom nhóm bounding box qua trục thời gian 8 FPS. | `node scripts/run-local-runtime-tests.mjs ocr-visual-timeline.test` |
| `release-tooling.test.ts` | Kiểm tra công cụ đóng gói release và ghim mã băm SHA-256. | `node scripts/run-local-runtime-tests.mjs release-tooling.test` |

---

## 2. Kiểm Thử Các Sidecar Engines Bằng Python

Các engine Python sở hữu bộ test unittest độc lập:
```powershell
# Test OCR Engine
cmd.exe /c "npm run test:ocr-engine"
# Hoặc lệnh trực tiếp:
python -m unittest discover -s engines/ocr-engine/tests -p "test_*.py" -v

# Test Separator Engine (MDX)
cmd.exe /c "npm run test:separator-engine"
# Hoặc lệnh trực tiếp:
python -m unittest discover -s engines/separator-engine/tests -p "test_*.py" -v

# Test STTN Inpainting Engine
cmd.exe /c "npm run test:sttn-engine"
# Hoặc lệnh trực tiếp:
python -m unittest discover -s engines/sttn-engine/tests -p "test_*.py" -v

# Test Douyin Engine
python -m unittest discover -s engines/douyin-engine/tests -p "test_*.py" -v
```

---

## 3. Các Khoảng Trống Kiểm Thử (Testing Gaps)

1. **Thiếu End-to-End GUI Tests:** Dự án chưa cấu hình Playwright hoặc Spectron để tự động click trên giao diện Electron thực tế (các luồng UI hiện được kiểm chứng thủ công).
2. **Phụ thuộc phần cứng GPU thực tế:** Các bài test DirectML và CUDA yêu cầu phần cứng vật lý tương ứng; trên máy CI không có GPU rời, các test này chạy ở chế độ giả lập (mock) hoặc fallback CPU.
