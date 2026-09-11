# ADR 001: Kiến Trúc Hybrid Electron Kết Hợp Python Sidecar Engines

- **Trạng thái:** Đã chấp thuận (Accepted)
- **Ngày quyết định:** 2026-08-20
- **Tác giả:** Kiến trúc sư TediaPros

---

## Bối Cảnh (Context)

TediaPros là ứng dụng desktop xử lý đa phương tiện cao cấp, đòi hỏi thực thi nhiều mô hình học sâu và thuật toán thị giác máy tính phức tạp:
1. Nhận diện chữ trên video thời gian thực (RapidOCR / PaddleOCR).
2. Tách giọng nói khỏi nhạc nền (MDX-Net / UVR ONNX DirectML).
3. Bóc băng âm thanh đa ngôn ngữ (Faster-Whisper / CTranslate2).
4. Xóa phụ đề bằng mạng Spatio-Temporal Transformer (STTN PyTorch).

Các giải pháp thuần Node.js (Node Addons qua N-API hoặc `onnxruntime-node`) gặp các hạn chế nghiêm trọng:
- Khó tích hợp thư viện tăng tốc DirectML/CUDA ổn định trên Windows đa nền tảng GPU.
- Một lỗi segmentation fault trong mô hình C++/GPU sẽ đánh sập ngay lập tức toàn bộ ứng dụng Electron (crash giao diện người dùng).
- Khó quản lý vòng đời bộ nhớ VRAM khi xử lý nhiều video nối tiếp.

---

## Quyết Định (Decision)

Chúng tôi quyết định áp dụng **Kiến trúc Hybrid**:
- Giao diện và tầng điều phối được viết bằng **Electron + React 19 + TypeScript**.
- Các engine xử lý AI nặng được tách thành các **Tiến trình con Python độc lập (Sidecar Engines)** đặt trong thư mục `engines/`.
- Tiến trình Node.js quản lý việc khởi động, gửi lệnh qua Stdio JSON / CLI và giám sát cây tiến trình thông qua `processTree.ts`.
- Khi đóng gói phát hành, các engine Python được biên dịch thành binary độc lập thông qua PyInstaller (`.spec`).

---

## Hệ Quả (Consequences)

### Tích cực:
- **Cô lập lỗi (Fault Isolation):** Nếu một engine Python bị tràn VRAM hoặc crash, Electron Main Process chỉ nhận diện exit code lỗi, ghi log cảnh báo và dọn dẹp an toàn mà không làm sập giao diện người dùng.
- **Tối ưu hóa phần cứng:** Tận dụng hệ sinh thái Python phong phú (PyTorch, DirectML, OnnxRuntime, SoundFile, OpenCV) mà không phải gò ép vào Node.js ecosystem.
- **Dễ kiểm thử riêng rẽ:** Mỗi engine có bộ test `unittest` độc lập, có thể chạy và gỡ lỗi bằng CLI mà không cần bật Electron.

### Tiêu cực / Đánh đổi:
- Cần cơ chế kiểm soát tiến trình con nghiêm ngặt để tránh tạo tiến trình mồ côi (zombie processes) khi tắt app đột ngột.
- Chi phí dung lượng đĩa của các binary PyInstaller lớn hơn so với thư viện chia sẻ.
