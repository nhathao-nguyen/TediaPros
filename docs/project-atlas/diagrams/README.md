# Danh Mục Sơ Đồ Kiến Trúc & Vận Hành Trực Quan (Archify Diagrams)

Tài liệu này hướng dẫn cách mở, tra cứu và đối soát 5 sơ đồ kiến trúc, luồng công việc, trình tự thời gian, dòng dữ liệu và vòng đời trạng thái của hệ thống **TediaPros**.
Toàn bộ sơ đồ được tạo bởi bộ công cụ [Archify CLI](https://github.com/tt-a1i/archify) với hồ sơ chất lượng cao nhất (**Quality Profile: Showcase**), xuất bản dưới dạng các tệp HTML độc lập (**Self-Contained HTML**), có thể mở và tương tác ngay trên bất kỳ trình duyệt web hiện đại nào mà không cần kết nối mạng hay cài đặt thêm phụ thuộc.

---

## 1. Danh Sách 5 Sơ Đồ & Đường Dẫn Truy Cập

| STT | Tên Sơ Đồ | Loại Sơ Đồ | Tệp Nguồn Spec | Tệp HTML Trực Quan | Trạng Thái Showcase |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Kiến Trúc Toàn Cảnh Hệ Thống** | `architecture` | [`tediapros-architecture.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/diagrams/tediapros-architecture.json) | [**`tediapros-architecture.html`**](file:///f:/Son/tool/TediaPros/docs/project-atlas/diagrams/tediapros-architecture.html) | `PASS (0 errors, 0 warnings)` |
| **2** | **Quy Trình Xử Lý AutoShort Pipeline** | `workflow` (v2) | [`autoshort-pipeline.workflow.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/diagrams/autoshort-pipeline.workflow.json) | [**`autoshort-pipeline.workflow.html`**](file:///f:/Son/tool/TediaPros/docs/project-atlas/diagrams/autoshort-pipeline.workflow.html) | `PASS (0 errors, 0 warnings)` |
| **3** | **Trình Tự Thực Thi Một Video Item** | `sequence` | [`autoshort-execution.sequence.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/diagrams/autoshort-execution.sequence.json) | [**`autoshort-execution.sequence.html`**](file:///f:/Son/tool/TediaPros/docs/project-atlas/diagrams/autoshort-execution.sequence.html) | `PASS (0 errors, 0 warnings)` |
| **4** | **Dòng Chảy Dữ Liệu Đa Phương Tiện** | `dataflow` | [`autoshort-media.dataflow.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/diagrams/autoshort-media.dataflow.json) | [**`autoshort-media.dataflow.html`**](file:///f:/Son/tool/TediaPros/docs/project-atlas/diagrams/autoshort-media.dataflow.html) | `PASS (0 errors, 0 warnings)` |
| **5** | **Vòng Đời Trạng Thái Video Item** | `lifecycle` | [`autoshort-item.lifecycle.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/diagrams/autoshort-item.lifecycle.json) | [**`autoshort-item.lifecycle.html`**](file:///f:/Son/tool/TediaPros/docs/project-atlas/diagrams/autoshort-item.lifecycle.html) | `PASS (0 errors, 0 warnings)` |

> 💡 **Cách mở xem:**
> - Trong VS Code / Cursor: Click đúp vào tệp HTML hoặc chọn *Open with Live Server*.
> - Trong Windows Explorer: Nhấp đúp chuột vào tệp `.html` để mở bằng trình duyệt mặc định (Chrome, Edge, Firefox, Brave).
> - Tính năng tương tác: Nhấp chuột vào các nút **Views** phía trên góc trái sơ đồ để chuyển đổi góc nhìn tập trung (Focus View), rê chuột lên các kết nối để làm sáng rõ luồng tín hiệu (Signal Flow Animation).

---

## 2. Chi Tiết Từng Sơ Đồ & Ánh Xạ Mã Nguồn

### 2.1. Sơ Đồ Kiến Trúc (`tediapros-architecture.html`)
- **Mục đích:** Trả lời câu hỏi *"Hệ thống TediaPros gồm những phân vùng nào, các ranh giới bảo mật nằm ở đâu và liên lạc giữa các tầng diễn ra thế nào?"*
- **Các phân vùng (Boundaries):**
  1. `Renderer GUI (Chromium)`: Giao diện React 19 chạy trong tiến trình hiển thị cô lập (`src/renderer/src/App.tsx`, `useAutoShortStore.ts`).
  2. `Security Boundary (Preload Bridge)`: Cầu nối cách ly qua `contextBridge` loại bỏ hoàn toàn Node integration ở Renderer (`src/preload/index.ts`).
  3. `Desktop Shell (Node.js/Electron Main)`: Tiến trình trung tâm điều phối toàn bộ tài nguyên, tiến trình con và logic nghiệp vụ (`src/main/index.ts`, `src/main/autoshort.ts`).
  4. `Sidecar Python & Binary Engines`: Không gian tiến trình con chạy độc lập (Whisper, OCR, MDX Separator, STTN, FFmpeg, Video2X) (`engines/*`, `src/main/engineHost.ts`).
  5. `Local Storage & Assets`: Vùng lưu trữ tệp, scratch directory và fonts (`userData`, `.autoshort-item-<id>/`).
- **Bằng chứng mã nguồn:**
  - Cầu nối IPC an toàn gõ kiểu: [`src/shared/types.ts`](file:///f:/Son/tool/TediaPros/src/shared/types.ts).
  - Quản lý vòng đời tiến trình con: [`src/main/childProcessTracker.ts`](file:///f:/Son/tool/TediaPros/src/main/childProcessTracker.ts).

### 2.2. Sơ Đồ Quy Trình Pipeline (`autoshort-pipeline.workflow.html`)
- **Mục đích:** Mô tả các bước nghiệp vụ mà một video trải qua từ lúc tiếp nhận đầu vào đến khi hoàn tất xuất bản, làm nổi bật 2 cổng kiểm soát an toàn vật lý bất khả xâm phạm.
- **Các làn quy trình (Lanes):**
  - `ui`: Tiếp nhận danh sách video và hiển thị thành phẩm.
  - `coord`: Điều phối tiến trình, probe metadata, kiểm soát ngân sách đĩa (685MB Headroom) và giới hạn nhịp độ (Tempo Gate 1.10x - 1.45x).
  - `worker`: Các sidecar engine thực hiện trích xuất âm thanh/chữ, tổng hợp giọng nói và render FFmpeg.
- **Ánh xạ mã nguồn:**
  - Kiểm tra dung lượng đĩa tối thiểu: [`src/main/autoShortDiskBudget.ts`](file:///f:/Son/tool/TediaPros/src/main/autoShortDiskBudget.ts).
  - Giới hạn tốc độ lồng tiếng: [`src/main/autoShortPolicy.ts`](file:///f:/Son/tool/TediaPros/src/main/autoShortPolicy.ts).
  - Lệnh merge và blur Planar RGB: [`src/main/burn.ts`](file:///f:/Son/tool/TediaPros/src/main/burn.ts).

### 2.3. Sơ Đồ Trình Tự Thực Thi (`autoshort-execution.sequence.html`)
- **Mục đích:** Làm rõ dòng thời gian liên lạc giữa React UI, Preload Bridge, Main Coordinator, Disk Storage, Python Sidecar và FFmpeg trong quá trình xử lý 1 video item.
- **Trình tự các thông điệp:**
  1. UI gọi hàm `window.api.autoShort.start(item)`.
  2. Preload chuyển tiếp sang Main qua kênh IPC `autoshort:start-item`.
  3. Coordinator thẩm định dung lượng ổ đĩa `checkHeadroom(685MB)` với module Storage.
  4. Sau khi duyệt, Coordinator spawn Sidecar Python bóc băng Whisper và quét toạ độ OCR.
  5. Sidecar trả về mảng từ và bounding boxes; Coordinator áp dụng chính sách Clamp Tempo (1.10x - 1.45x).
  6. Coordinator bắn sự kiện tiến độ định kỳ về UI.
  7. Sidecar tổng hợp giọng đọc TTS ra `dub.wav`.
  8. FFmpeg nhận filter graph để render phụ đề ASS và mặt nạ Planar RGB.
  9. Coordinator xóa sạch thư mục tạm `.autoshort-item-<id>/` và báo thành công về UI.
- **Ánh xạ mã nguồn:**
  - Vòng lặp điều phối tuần tự: [`src/main/autoShortItemCoordinator.ts`](file:///f:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts).

### 2.4. Sơ Đồ Dòng Chảy Dữ Liệu (`autoshort-media.dataflow.html`)
- **Mục đích:** Trực quan hóa 3 luồng dữ liệu song song độc lập (Audio, Subtitle và OCR Vision) từ tệp video gốc cho đến khi hội tụ tại bộ lọc ghép của FFmpeg.
- **Các phân đoạn (Stages):**
  - Stage 0 (Nguồn Vào): Video gốc (MP4/MOV).
  - Stage 1 (Tách Lớp): Demux PCM Mono 16kHz & Trích xuất khung hình RGB 8 FPS.
  - Stage 2 (Trích Xuất AI): Whisper ASR tạo speech tokens & OCR Vision phát hiện hộp phụ đề gốc.
  - Stage 3 (Biến Đổi Media): TTS tổng hợp giọng lồng tiếng, layout phụ đề ASS determinism, mặt nạ Planar Mask chống lem màu YUV.
  - Stage 4 (Thành Phẩm): FFmpeg hội tụ cả 3 luồng thành tệp video MP4 hoàn chỉnh.
- **Ánh xạ mã nguồn:**
  - Tách Planar RGB cho OCR blur: [`docs/adr/004-planar-rgb-for-ocr-blurring.md`](file:///f:/Son/tool/TediaPros/docs/adr/004-planar-rgb-for-ocr-blurring.md).
  - Tự động wrap text phụ đề ASS: [`src/main/fontMeasure.ts`](file:///f:/Son/tool/TediaPros/src/main/fontMeasure.ts).

### 2.5. Sơ Đồ Vòng Đời Trạng Thái (`autoshort-item.lifecycle.html`)
- **Mục đích:** Mô tả máy trạng thái hữu hạn (FSM) của một video item trong hàng đợi, từ lúc xếp hàng đến khi hoàn tất hoặc chuyển hướng sang nhánh lỗi/hủy bỏ.
- **Các làn trạng thái (Lanes):**
  - `Lifecycle phases (main)`: Trục tiến trình chính gồm 5 pha tuần tự: `Pending (01)` $\\rightarrow$ `Extracting (02)` $\\rightarrow$ `Dubbing (03)` $\\rightarrow$ `Rendering (04)` $\\rightarrow$ `Completed (05)`.
  - `Interruptions (waiting)`: Nhánh tạm dừng `Quota Wait` (khi đĩa khả dụng dưới 685MB).
  - `Recovery loop (exceptions)`: Nhánh thử lại `Retryable` (lỗi tạm thời được phục hồi mà không làm vỡ batch).
  - `Terminal exits (terminal)`: Hai lối thoát kết thúc bất biến `Cancelled` (người dùng bấm Dừng) và `Fatal Error` (lỗi nghiêm trọng), cả hai đều kích hoạt dọn sạch scratch directory.
- **Ánh xạ mã nguồn:**
  - Định nghĩa trạng thái Item: [`src/shared/autoShortContract.ts`](file:///f:/Son/tool/TediaPros/src/shared/autoShortContract.ts).
  - Dọn dẹp an toàn: [`src/main/safeContainedPath.ts`](file:///f:/Son/tool/TediaPros/src/main/safeContainedPath.ts).

---

## 3. Bằng Chứng Xác Thực Tiêu Chuẩn Showcase (Verification Receipts)

Cả 5 sơ đồ đều được kiểm tra cú pháp và chất lượng hiển thị nghiêm ngặt thông qua lệnh:
```bash
node scratch/archify/archify/bin/archify.mjs validate <type> <spec.json> --quality showcase --json
node scratch/archify/archify/bin/archify.mjs deliver <type> <spec.json> <out.html> --quality showcase --json
```

Tất cả 10 biên bản kiểm thử tự động (Receipts) được lưu trữ tại [`docs/project-atlas/validation/`](file:///f:/Son/tool/TediaPros/docs/project-atlas/validation/):
- [`architecture-validate.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/validation/architecture-validate.json) & [`architecture-deliver.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/validation/architecture-deliver.json)
- [`workflow-validate.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/validation/workflow-validate.json) & [`workflow-deliver.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/validation/workflow-deliver.json)
- [`sequence-validate.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/validation/sequence-validate.json) & [`sequence-deliver.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/validation/sequence-deliver.json)
- [`dataflow-validate.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/validation/dataflow-validate.json) & [`dataflow-deliver.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/validation/dataflow-deliver.json)
- [`lifecycle-validate.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/validation/lifecycle-validate.json) & [`lifecycle-deliver.json`](file:///f:/Son/tool/TediaPros/docs/project-atlas/validation/lifecycle-deliver.json)

**Kết quả chung cuộc:** `profile: showcase`, `status: pass`, `errors: 0`, `warnings: 0`, `exit code: 0`.
