# EVIDENCE.md — Bảng Đối Soát Bằng Chứng Kỹ Thuật (Evidence Ledger)

Mọi khẳng định trong bộ tài liệu TediaPros Atlas đều được bảo chứng bởi các nguồn chứng cứ cụ thể dưới đây, phân loại theo thang đo bằng chứng nghiêm ngặt.

---

## 1. Thang Đo Bằng Chứng (Evidence Scale)

- **`[CODE_CONFIRMED]`**: Được xác nhận trực tiếp bằng mã nguồn đang tồn tại trong repo (kèm đường dẫn và số dòng cụ thể).
- **`[TEST_CONFIRMED]`**: Đã chạy kiểm thử tự động trên môi trường khảo sát với lệnh và kết quả xác thực.
- **`[DOCUMENTED_ONLY]`**: Chỉ mới được mô tả trong tài liệu lịch sử, ADR hoặc bản kế hoạch cũ, chưa có code tương ứng hoặc code chưa hoàn thiện.
- **`[INFERRED]`**: Kết luận suy luận logic có căn cứ rõ ràng từ mã nguồn hoặc tài liệu.
- **`[UNKNOWN]`**: Chưa đủ dữ liệu để chứng minh hoặc không tìm thấy trong phạm vi khảo sát.

---

## 2. Bảng Đối Soát Các Nhận Định Trọng Yếu

| Hạng Mục Kỹ Thuật | Trạng Thái Bằng Chứng | Căn Cứ Mã Nguồn / Lệnh Kiểm Thử | Tác Động & Chi Tiết Xác Thực |
| :--- | :--- | :--- | :--- |
| **Giới hạn nhịp độ Dubbing (1.10x - 1.45x)** | `CODE_CONFIRMED` + `TEST_CONFIRMED` | [src/main/dubbing/policy.ts#L9-L15](file:///f:/Son/tool/TediaPros/src/main/dubbing/policy.ts#L9-L15); Test: `node scripts/run-local-runtime-tests.mjs dubbing-plan.test` | Đạt 16/16 test. Khi vượt quá trần 1.45x, hàm sẽ throw Error yêu cầu sửa bản dịch, tuyệt đối không tự ý cắt bỏ âm thanh. |
| **Khoảng lặng bảo vệ Dubbing (0.50s)** | `CODE_CONFIRMED` | [src/main/dubbing/policy.ts#L9](file:///f:/Son/tool/TediaPros/src/main/dubbing/policy.ts#L9) (`DUBBING_PROTECTED_GAP_SECONDS = 0.5`) | Giữ khoảng lặng tự nhiên giữa 2 câu nói kế tiếp. |
| **Ngưỡng âm thanh cắt tỉa (-50dB, 30ms/100ms)** | `CODE_CONFIRMED` | [src/main/autoShortPolicy.ts#L30-L35](file:///f:/Son/tool/TediaPros/src/main/autoShortPolicy.ts#L30-L35) | Thiết lập filter silenceremove của FFmpeg để loại bỏ khoảng lặng thừa đầu/cuối clip voice. |
| **Làm mờ OCR bắt buộc dùng Planar RGB (`gbrp`)** | `CODE_CONFIRMED` | [src/main/burn.ts#L848-L865](file:///f:/Son/tool/TediaPros/src/main/burn.ts#L848-L865); [docs/adr/004-planar-rgb-for-ocr-blurring.md](file:///f:/Son/tool/TediaPros/docs/adr/004-planar-rgb-for-ocr-blurring.md) | Chuyển frame sang `format=gbrp` trước khi gọi `maskedmerge` để chống lem màu viền YUV 4:2:0. |
| **Lấy mẫu OCR cố định 8 FPS** | `CODE_CONFIRMED` | [src/shared/ocrVisualTimeline.ts#L8](file:///f:/Son/tool/TediaPros/src/shared/ocrVisualTimeline.ts#L8) (`OCR_SAMPLE_FPS = 8`) | Cố định tần số quét khung hình cho RapidOCR, tiết kiệm tài nguyên tính toán. |
| **Tách thoại DirectML có fallback CPU** | `CODE_CONFIRMED` + `TEST_CONFIRMED` | [src/main/separation/runner.ts#L130-L175](file:///f:/Son/tool/TediaPros/src/main/separation/runner.ts#L130-L175); Test: `node scripts/run-local-runtime-tests.mjs separator-contract.test` | Khi DirectML crash hoặc OOM, pipeline tự động kích hoạt tiến trình tách thoại bằng backend CPU. |
| **Ghim SHA-256 Model MDX & Runtime** | `CODE_CONFIRMED` | [distribution/separator-model-inputs.json](file:///f:/Son/tool/TediaPros/distribution/separator-model-inputs.json); [src/main/separation/modelManifest.ts](file:///f:/Son/tool/TediaPros/src/main/separation/modelManifest.ts) | Model tải về bị đối soát mã băm SHA-256; nếu sai lệch sẽ bị xóa ngay lập tức. |
| **Giao thức STTN Inpainting `sttn-engine/1`** | `CODE_CONFIRMED` + `TEST_CONFIRMED` | [src/main/inpainting/runner.ts#L13](file:///f:/Son/tool/TediaPros/src/main/inpainting/runner.ts#L13); Test: `node scripts/run-local-runtime-tests.mjs sttn-contract.test` | Giao tiếp qua Stdio JSONL; kiểm soát ngặt nghèo việc hủy tiến trình trước khi dọn file tạm tránh EBUSY. |
| **Custom Protocol `tblao:` phục vụ Media Range** | `CODE_CONFIRMED` | [src/main/index.ts#L40-L45](file:///f:/Son/tool/TediaPros/src/main/index.ts#L40-L45) | Đăng ký `tblao:` với `stream: true` và `supportFetchAPI: true`, cho phép tua video trực tiếp từ đĩa người dùng mà không cần tắt webSecurity. |
| **Ngân sách đĩa (Disk Budget Ledger)** | `CODE_CONFIRMED` | [src/main/autoShortDiskBudget.ts#L5-L10](file:///f:/Son/tool/TediaPros/src/main/autoShortDiskBudget.ts#L5-L10) | Headroom 685 MB (`STTN_ROLLING_RESERVE_BYTES`); theo dõi byte ghi qua `statfs`. |
| **Bảo vệ Directory Traversal** | `CODE_CONFIRMED` | [src/main/safeContainedPath.ts#L10-L45](file:///f:/Son/tool/TediaPros/src/main/safeContainedPath.ts#L10-L45) | Kiểm tra `assertContainedRegularFile` và `assertContainedParentDirectory` trên mọi đường dẫn ghi/đọc. |
| **Bảo vệ Bản quyền PolyForm Noncommercial** | `CODE_CONFIRMED` | [LICENSE](file:///f:/Son/tool/TediaPros/LICENSE); [NOTICE](file:///f:/Son/tool/TediaPros/NOTICE); [src/renderer/src/components/License.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/License.tsx) | Điều khoản phi thương mại được hiển thị minh bạch tại Tab License và file LICENSE gốc. |
| **TypeScript Typecheck 0 lỗi** | `TEST_CONFIRMED` | Lệnh: `cmd.exe /c "npm run typecheck"` | Chạy thành công cả `typecheck:node` và `typecheck:web` trên commit HEAD 6291184. |
