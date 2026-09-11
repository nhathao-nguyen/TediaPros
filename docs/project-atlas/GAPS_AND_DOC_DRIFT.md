# GAPS_AND_DOC_DRIFT.md — Phân Tích Độ Lệch Tài Liệu & Khoảng Trống Kỹ Thuật

Tài liệu này đối chiếu các mâu thuẫn giữa tài liệu/kế hoạch cũ và mã nguồn thực tế, làm rõ các tính năng chưa hoàn thiện và các phạm vi chưa được xác minh trong kỳ khảo sát.

---

## 1. Các Điểm Lệch Giữa Tài Liệu Cũ & Mã Nguồn Thực Tế (Documentation Drift)

### 1.1. Tên gọi phương thức Whisper: `fast-whisper` so với `whisper`
- **Tài liệu/Spec cũ:** Nhiều kế hoạch trong `docs/superpowers/plans/` nhắc tới tùy chọn cấu hình `subtitleMethod = 'fast-whisper'`.
- **Mã nguồn thực tế:** [src/shared/autoShortContract.ts#L100-L109](file:///f:/Son/tool/TediaPros/src/shared/autoShortContract.ts#L100-L109) xác nhận giá trị chuẩn hiện tại là `'whisper'` hoặc `'whisper-ocr'`. Giá trị `'fast-whisper'` đã bị coi là legacy và được hàm `migrateLegacyConfig` tự động chuẩn hóa sang `'whisper'`.
- **Đánh giá:** Đã có cơ chế tương thích ngược (Backward Compatibility) trong mã nguồn.

### 1.2. Whisper Model Tiers: `tiny` và `large-v3`
- **Tài liệu cũ:** Đề cập tới việc cho phép người dùng chọn model Whisper `tiny` hoặc `large-v3`.
- **Mã nguồn thực tế:** Trong [src/shared/autoShortContract.ts#L102-L103](file:///f:/Son/tool/TediaPros/src/shared/autoShortContract.ts#L102-L103), `MODELS` chỉ chấp nhận tập cố định: `base`, `small`, `medium`. Khi nạp config cũ, `tiny` được tự động chuyển thành `base`, và `large-v3` được chuyển thành `medium`.
- **Lý do kỹ thuật:** Tránh trường hợp người dùng tải model `large-v3` quá nặng làm tràn VRAM hoặc crash trên máy tính không có card rời.

### 1.3. Tên thương hiệu ứng dụng
- **Tài liệu cũ / Code cũ:** Một số file còn lưu vết tên mã nội bộ `tblao` (ví dụ custom protocol `tblao:`, `TblaoApi`).
- **Hiện thực:** [src/main/appIdentity.ts#L10-L20](file:///f:/Son/tool/TediaPros/src/main/appIdentity.ts#L10-L20) và [src/shared/brand.ts](file:///f:/Son/tool/TediaPros/src/shared/brand.ts) đã đổi sang thương hiệu chính thức: **TediaPros** (`tedia-pros`). Đã có hàm `migrateLegacyUserData` chuyển đổi dữ liệu từ thư mục `tblao` sang `tedia-pros`.

---

## 2. Các Giới Hạn Kỹ Thuật Được Mã Nguồn Xác Nhận

1. **Giới hạn số lượng video trong hàng đợi AutoShort:**
   - [src/shared/autoShortContract.ts#L294](file:///f:/Son/tool/TediaPros/src/shared/autoShortContract.ts#L294) quy định cứng: hàng đợi chỉ chấp nhận từ **1 đến 100 video**. Không cho phép hàng đợi rỗng hoặc vượt quá 100 mục.
2. **Giới hạn số vùng làm mờ thủ công (Manual Blur Regions):**
   - [src/shared/autoShortContract.ts#L155](file:///f:/Son/tool/TediaPros/src/shared/autoShortContract.ts#L155) giới hạn tối đa **32 vùng làm mờ**.
3. **Giới hạn xử lý song song video:**
   - Mặc dù kiến trúc hỗ trợ hàng đợi, `autoShortResourceManager.ts` và chính sách thực thi mặc định ưu tiên 1 job active nặng tại một thời điểm (`maxActiveItems: 1 | 2`) nhằm ngăn ngừa xung đột tài nguyên GPU và VRAM.
4. **Không kết hợp Nhạc Nền BGM với Tách Thoại:**
   - [src/shared/autoShortContract.ts#L256-L258](file:///f:/Son/tool/TediaPros/src/shared/autoShortContract.ts#L256-L258) nghiêm cấm: khi chọn `audioMode = 'separate-vocals'` (giữ lại nhạc và SFX gốc), không được cấu hình `backgroundMusic`. Điều này nhằm bảo vệ tính toàn vẹn âm thanh, tránh xung đột 2 luồng nhạc nền đè lên nhau.

---

## 3. Các Phần Chưa Được Xác Minh Trong Kỳ Khảo Sát (Unverified Scenarios)

1. **Môi trường macOS ARM64 Apple Silicon:**
   - Codebase có các điều kiện nhánh cho `darwin` (ví dụ: `dmg`, đường dẫn binary trong `.app/Contents/Resources/engines`).
   - Tuy nhiên, máy khảo sát hiện tại là **Windows 10/11 x64**, nên toàn bộ luồng runtime thực tế trên macOS chưa được chạy trực tiếp (được xếp hạng `INFERRED` từ code và CI script).
2. **Tính năng Video2X Real-ESRGAN / Rife:**
   - Module `src/main/video2x.ts` và tab UI `VideoEnhance.tsx` đã hoàn thiện về mặt code và IPC. Tuy nhiên engine Video2X là thành phần tải on-demand dung lượng lớn và yêu cầu GPU Vulkan chuyên biệt; trong kỳ khảo sát chúng tôi không tải binary này để tuân thủ quy tắc không tải assets dung lượng lớn.
3. **API Keys thương mại thực tế:**
   - Các dịch vụ OpenAI, Gemini, ElevenLabs yêu cầu API key có trả phí. Mã nguồn đã được kiểm chứng qua unit test mock (`tests/local-translation.test.ts`), không thực hiện gọi API tính phí thật ra ngoài internet.
