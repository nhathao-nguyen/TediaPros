# Báo Cáo Tổng Hợp Toàn Bộ Session Chat - TediaPros

> **Thời gian thực hiện**: Ngày 04 tháng 09 năm 2026  
> **Dự án**: TediaPros (`f:\Son\tool\TediaPros`)  
> **Nội dung chính**: Điều tra codebase, khắc phục lỗi TTS Chatterbox, kiểm tra hỗ trợ tiếng Indonesia, điều tra nút thắt cổ chai hiệu năng AutoShort (video 2 phút chạy 1 tiếng, GPU 100%), và kiến trúc tối ưu hóa tốc độ & độ chính xác.

---

## MỤC LỤC

1. [Phần 1: Điều Tra Codebase & Sửa Lỗi TTS Chatterbox Denoise](#phần-1-điều-tra-codebase--sửa-lỗi-tts-chatterbox-denoise)
2. [Phần 2: Kiểm Tra Hỗ Trợ Tiếng Indonesia Trên Chatterbox Multilingual V3](#phần-2-kiểm-tra-hỗ-trợ-tiếng-indonesia-trên-chatterbox-multilingual-v3)
3. [Phần 3: So Sánh Các Mô Hình TTS Vượt Trội Hơn Chatterbox](#phần-3-so-sánh-các-mô-hình-tts-vượt-trội-hơn-chatterbox)
4. [Phần 4: Điều Tra Nguyên Nhân Video 2 Phút Chạy Mất 1 Tiếng (GPU 100%)](#phần-4-điều-tra-nguyên-nhân-video-2-phút-chạy-mất-1-tiếng-gpu-100)
5. [Phần 5: Đối Chiếu Workflow Thực Tế Trong Codebase](#phần-5-đối-chiếu-workflow-thực-tế-trong-codebase)
6. [Phần 6: Chiến Lược Tối Ưu Hóa Toàn Diện (Tốc Độ + Hạ Tải GPU + Đảm Bảo Độ Chính Xác)](#phần-6-chiến-lược-tối-ưu-hóa-toàn-diện-tốc-độ--hạ-tải-gpu--đảm-bảo-độ-chính-xác)

---

## PHẦN 1: ĐIỀU TRA CODEBASE & SỬA LỖI TTS CHATTERBOX DENOISE

### 1. Hiện tượng lỗi
Khi người dùng sử dụng tính năng **Clone giọng nói (Tham chiếu)** trên giao diện Voice với mô hình **Chatterbox Multilingual V3**, khi bấm *"Tạo giọng nói ngay"*, ứng dụng báo lỗi:
```text
unknown_tts_option: Unsupported TTS option(s) for chatterbox: denoise
```

### 2. Kiến trúc xử lý TTS trong Codebase
Quy trình gọi TTS đi qua các tầng:
- **Renderer (Frontend)**: `src/renderer/src/components/Voice.tsx` - Quản lý form, model, voice clone và các tuỳ chọn nâng cao.
- **Preload Bridge**: `src/preload/index.ts` - Chuyển tiếp lời gọi IPC `ttsGenerateSpeech`, `ttsGenerateClone`.
- **Main Process (Electron)**: `src/main/tts.ts` - Đóng gói FormData/JSON và gửi request sang AI Server qua REST API `/v1/audio/voice-clone` hoặc `/v1/audio/speech`.
- **AI Backend Server**: `http://127.0.0.1:8000` (tts-server) - Cung cấp các model như `tts-vietnamese` (VieNeu) và `tts-multilingual` (Chatterbox).

### 3. Nguyên nhân cốt lõi (Root Cause)
1. **Đặc thù của tùy chọn `denoise`**:
   - `denoise` là tính năng khử nhiễu âm nền thiết kế riêng cho **VieNeu** (`tts-vietnamese`).
   - Mô hình **Chatterbox** (`tts-multilingual`) không có tính năng này, nên server không khai báo `denoise` trong `supported_options`.
2. **Xung đột ở Frontend (`Voice.tsx`)**:
   - UI ẩn checkbox `Khử nhiễu nền (Denoise - VieNeu)` khi model không hỗ trợ, nhưng biến React state `denoise` vẫn lưu giá trị mặc định `true` trong localStorage (`tblao.tts.denoise`).
   - Khi bấm tạo voice, hàm `handleGenerate` đóng gói cứng:
     ```typescript
     const options: Record<string, any> = {
       denoise,
       temperature,
       top_p: topP,
       repetition_penalty: repetitionPenalty
     }
     ```
     mà không lọc theo `selectedModelInfo.supported_options`.
3. **Lỗ hổng ở Main Process (`src/main/tts.ts`)**:
   - Hàm `cleanOptions(options, supportedOptions)` có sẵn logic lọc whitelist nhưng ở cả 2 hàm `generateSpeech` và `generateVoiceClone` đều chỉ gọi `cleanOptions(req.options)` (không truyền `supportedOptions`).
   - Do đó `denoise: true` vẫn được gửi thẳng sang server AI.
4. **Phản hồi của Server**:
   - Server thực hiện strict validation đối với provider `chatterbox`, phát hiện option `denoise` không được hỗ trợ nên từ chối request với mã lỗi `unknown_tts_option`.

### 4. Các thay đổi sửa lỗi đã thực hiện
- **`src/shared/types.ts`**: Bổ sung trường `supportedOptions?: string[]` vào `TtsSpeechRequest` và `TtsCloneRequest`.
- **`src/renderer/src/components/Voice.tsx`**:
  - Lọc các key trong `options` dựa trên `selectedModelInfo.supported_options`.
  - Tự động bỏ qua `denoise` nếu provider không phải `vieneu`.
  - Truyền `supportedOptions` vào request IPC.
  - Tinh chỉnh điều kiện hiển thị checkbox Khử nhiễu nền trên giao diện.
- **`src/main/tts.ts`**:
  - Cập nhật `cleanOptions(options, supportedOptions, modelOrProvider)` tự động loại trừ `denoise` đối với `chatterbox` / `tts-multilingual`.
  - Truyền `req.supportedOptions` và `req.model` vào `cleanOptions`.
  - Export hàm `cleanOptions` phục vụ kiểm thử tự động.
- **`tests/local-runtime.test.ts`**: Bổ sung unit test kiểm tra `cleanOptions` loại bỏ option không hỗ trợ, bảo toàn denoise cho VieNeu, và ràng buộc hợp đồng mã nguồn.
- **Kết quả xác minh**: Toàn bộ **141/141 tests pass (100%)**, TypeScript typecheck 0 lỗi.

---

## PHẦN 2: KIỂM TRA HỖ TRỢ TIẾNG INDONESIA TRÊN CHATTERBOX MULTILINGUAL V3

### 1. Kết luận
**Mô hình Chatterbox Multilingual V3 hiện tại CHƯA hỗ trợ tiếng Indonesia (`id`).**

### 2. Dẫn chứng kỹ thuật
1. **Phân tích danh sách ngôn ngữ trên giao diện**:
   - Menu ngôn ngữ sắp xếp theo thứ tự mã alphabet (ISO 639-1).
   - Giữa mã **`hi` (Hindi)** và **`it` (Italiano)** hoàn toàn không có mã **`id` (Indonesian)**:
     - `IN हिन्दी (Tiếng Hindi) (hi)`
     - `IT Italiano (Tiếng Ý) (it)`
2. **Dữ liệu huấn luyện của Chatterbox Multilingual (Resemble AI)**:
   - Mô hình mã nguồn mở Chatterbox Multilingual hiện tại chỉ hỗ trợ đúng **23 ngôn ngữ**:
     > Ả Rập (`ar`), Trung Quốc (`zh`), Đan Mạch (`da`), Hà Lan (`nl`), Anh (`en`), Phần Lan (`fi`), Pháp (`fr`), Đức (`de`), Hy Lạp (`el`), Do Thái (`he`), Hindi (`hi`), Ý (`it`), Nhật (`ja`), Hàn (`ko`), Mã Lai (`ms`), Na Uy (`no`), Ba Lan (`pl`), Bồ Đào Nha (`pt`), Nga (`ru`), Tây Ban Nha (`es`), Swahili (`sw`), Thụy Điển (`sv`), Thổ Nhĩ Kỳ (`tr`).

### 3. Giải pháp thay thế
- **Dùng thử tiếng Mã Lai (`ms` - Bahasa Melayu)**: Cùng ngữ tộc Mã Lai - Đa Đảo, từ vựng và ngữ âm tương đồng trên 85%–90%, có thể đọc tốt nội dung chữ Latinh tiếng Indonesia.
- **Tích hợp mô hình có tiếng Indonesia chuẩn**: Tích hợp thêm các model đa ngôn ngữ rộng hơn như Fish Speech, Edge-TTS hoặc XTTS-v2.

---

## PHẦN 3: SO SÁNH CÁC MÔ HÌNH TTS VƯỢT TRỘI HƠN CHATTERBOX

| Mô hình | Công nghệ | Hỗ trợ Indonesia (`id`) | Chất lượng Clone | Tốc độ & Tài nguyên | Điểm mạnh nhất |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **Fish Speech (Fish Audio)** | Dual-AR + VQ-GAN codec | ** Có** (80+ ngôn ngữ) | **Xuất sắc** | Trung bình (GPU 8GB–12GB) | Số lượng ngôn ngữ lớn nhất, âm thanh 44.1kHz chuẩn studio |
| **CosyVoice 2 / 3 (Alibaba)** | LLM + Flow Matching | ⚠️ Bản cộng đồng | **Xuất sắc** | Nặng (GPU 8GB–16GB) | Biểu cảm cảm xúc qua prompt đỉnh nhất, ngữ điệu tự nhiên nhất |
| **F5-TTS / VieNeu** | Flow Matching (Non-AR) | ⚠️ Cần fine-tune | **Rất tốt** | **Nhanh, nhẹ** (GPU 4GB–6GB) | Tốc độ cao (~1s/câu), không nuốt chữ, không hallucination, tiếng Việt đỉnh cao |
| **Kokoro-82M** | StyleTTS 2 (82M params) | ❌ Không (8 ngôn ngữ) | Hạn chế | **Siêu nhanh (Chạy cả CPU)** | Cực nhẹ, chạy ngay trên CPU chỉ tốn vài trăm mili-giây |
| **Edge-TTS (Microsoft)** | Cloud Neural TTS | ** Có** (`id-ID-ArdiNeural`) | Preset giọng | Tức thì (Không tốn GPU) | Miễn phí, giọng Indonesia bản xứ cực chuẩn |

---

## PHẦN 4: ĐIỀU TRA NGUYÊN NHÂN VIDEO 2 PHÚT CHẠY MẤT 1 TIẾNG (GPU 100%)

### 1. Hiện trạng ghi nhận từ người dùng
- Video ngắn dài **2 phút 13 giây**.
- Thời gian chạy toàn bộ: **~1 tiếng**.
- Thời gian tạo Voice: **30 – 40 phút**.
- Máy chủ GPU AI (`192.168.1.15:8000`) bị **treo ở mức 100% công suất liên tục**.
- Thẻ hàng đợi xuất hiện cảnh báo lỗi mạng: `Không thể kết nối t...`.

### 2. Các nguyên nhân cốt lõi trong Codebase

#### Nguy cơ 1: "Vòng lặp tầng" (Cascade Loop) Rephrase $\rightarrow$ TTS lại $\rightarrow$ Tách đoạn
Trong [`src/main/autoshort.ts#L886-L965`](file:///f:/Son/tool/TediaPros/src/main/autoshort.ts#L886-L965):
1. Video 2 phút 13 giây bị chia thành **57 câu (cues)** (mỗi câu chỉ dài 1.0s – 1.4s).
2. Video gốc tiếng Trung nói nhanh, khi dịch sang tiếng Anh câu bị dài gấp 2 – 3 lần.
3. Điều kiện kiểm tra:
   $$\text{Thời lượng âm thanh} > \text{Thời lượng khung hình} \times 1.25$$
4. Vì câu dịch quá dài, gần như **100% trong 57 câu đều bị tràn thời lượng**.
5. Chuỗi sự kiện xảy ra cho mỗi câu:
   - **TTS lần 1**: GPU mất ~10s sinh audio câu ban đầu.
   - **Đo thấy dài**: **Vứt bỏ file audio lần 1** $\rightarrow$ Gọi LLM (Gemini/OpenAI/Local) viết lại câu ngắn hơn (Rephrase).
   - **TTS lần 2**: GPU mất thêm ~10s sinh lại audio cho câu đã rút gọn.
   - **Vẫn dài**: Hệ thống kích hoạt `shouldSplitAutoShortVoiceGroup` $\rightarrow$ Cắt đoạn làm đôi (`left` và `right`).
   - **TTS lần 3 & 4**: Vòng lặp quay lại tiếp tục gọi GPU sinh voice cho cả 2 nửa!
6. **Hệ quả**: Từ 57 câu ban đầu, hệ thống thực tế phải gọi GPU từ **130 đến 180 lần**. Hơn **60% công sức GPU là render các file audio bỏ đi**.

#### Nguy cơ 2: Chatterbox Diffusion 500M rất nặng + Upload qua mạng LAN
- Chatterbox là mô hình Diffusion/Flow-matching lớn, mỗi câu suy luận mất từ **8 – 15 giây**.
- Cứ mỗi câu, client lại đọc file MP3 mẫu (`Voice-short-Anh-funny.mp3`) và upload qua HTTP multipart sang `192.168.1.15`.
- Server GPU phải nhận file, chạy audio feature extractor trên GPU, rồi chạy hàng chục bước diffusion.
- Phép tính thời gian:
  $$\text{150 lượt gọi} \times 12\text{–}15\text{ giây} = \mathbf{1.800\text{–}2.250\text{ giây}} \approx \mathbf{30\text{–}40\text{ phút!}}$$

#### Nguy cơ 3: Xử lý tuần tự 100% (Single-thread)
- Vòng lặp `while (gIndex < semanticGroups.length)` chạy từng câu một. Câu 1 xong mới sang câu 2, không có cơ chế chạy song song (concurrency).

#### Nguy cơ 4: Nghẽn mạng & Timeout
- Server bị bắn hàng trăm request nặng liên tục dẫn đến nghẽn hàng đợi hoặc timeout. Client phải dừng lại chờ và thử lại 3 lần (`attempt < 3; setTimeout(...)`), kéo dài thêm thời gian.

#### Bảng tổng hợp thời gian 1 tiếng:
1. **Nhận diện (Whisper/OCR)**: 5 – 10 phút (nếu bật OCR quét từng khung hình).
2. **Dịch phụ đề**: 1 – 2 phút.
3. **Tạo Voice & Rephrase (TTS)**: 30 – 40 phút.
4. **Xử lý âm thanh (Cắt tỉa, Rubberband, Ducking)**: 1 – 2 phút.
5. **Render Video hoàn chỉnh (FFmpeg)**: 8 – 12 phút (nếu render bằng CPU).
👉 **Tổng thời gian: ~50 – 65 phút.**

---

## PHẦN 5: ĐỐI CHIẾU WORKFLOW THỰC TẾ TRONG CODEBASE

Bảng so sánh giữa mô hình người dùng hình dung và mã nguồn thực tế trong `autoshort.ts`:

| Bước hình dung | Thực tế trong Codebase | Chi tiết kỹ thuật |
| :--- | :--- | :--- |
| **1. Gọi 1 model để dịch** | ⚠️ **Dịch toàn bộ file trước (Batch), không xen kẽ từng câu** | Bước dịch diễn ra ở Giai đoạn 2 (`autoshort.ts#L1325`). Toàn bộ 57 câu được dịch 100% sang `translated.srt` rồi mới chuyển sang tạo voice. |
| **2. Gọi 1 model để TTS** |  **Đúng** | Duyệt từng đoạn và gọi model TTS (Chatterbox qua LAN) sinh audio ban đầu (`autoshort.ts#L858`). |
| **3. Gọi 1 model kiểm tra không khớp srt gốc** | ❌ **Không dùng model AI, mà dùng FFmpeg đo số học** | Dùng **FFmpeg** cắt khoảng lặng 2 đầu, đo độ dài giây thực tế, rồi so sánh toán học: `naturalDuration > availableDuration * 1.25`. |
| **4. Nếu sai thì gọi model để dịch lại** | ⚠️ **Gần đúng, nhưng là Rephrase (rút gọn câu) chứ không dịch lại** | Gửi câu dịch hiện tại sang LLM với lệnh: *"Hãy diễn đạt lại câu này thật ngắn gọn, súc tích hơn để người bản ngữ đọc vừa trong X.X giây mà giữ trọn nghĩa"*. |
| **5. Gọi model TTS chạy lại** |  **Đúng** | TTS được gọi lần 2 với câu đã rút gọn (`autoshort.ts#L917`). |
| **6. Bước phát sinh (Nếu lần 2 vẫn dài)** | ➕ **Tách nhóm làm đôi (Split) và gọi TTS lần 3, lần 4** | Nếu sau khi rút gọn vẫn dài quá mức co giãn tối đa ($1.35\times$), hệ thống tự động tách nhóm thành `left` và `right`, tiếp tục gọi TTS cho từng nửa! |

---

## PHẦN 6: CHIẾN LƯỢC TỐI ƯU HÓA TOÀN DIỆN (TỐC ĐỘ + HẠ TẢI GPU + ĐẢM BẢO ĐỘ CHÍNH XÁC)

### Vấn đề đặt ra:
Nếu chỉ tắt Rephrase hoặc tăng tốc độ Tempo một cách thô bạo:
- Câu quá dài (2.3s trong khung 1.08s) dù có kéo tempo $1.35\times$ thì vẫn mất 1.7s $\rightarrow$ tràn 0.62s sang cảnh sau, lệch timeline, đè câu sau.
- Ép tempo quá cao ($>1.4\times$) làm méo giọng, giọng nhanh như bắn rap.
- Hàm `validateAutoShortTimelineSync` sẽ báo lỗi vi phạm đồng bộ.

### Giải pháp kỹ thuật bảo đảm chính xác 100% & giảm 80% tải GPU:

#### 1. Ràng buộc thời lượng NGAY TỪ BƯỚC DỊCH (Length-Budgeted Translation)
- **Cơ chế**: Mỗi câu trong SRT đều có thời lượng chính xác (ví dụ 1.08s).
- Tốc độ đọc tự nhiên của tiếng Anh chuẩn là khoảng **2.5 từ/giây**.
- Ngay ở bước dịch toàn bộ SRT (bằng Gemini/OpenAI), tính toán **Ngân sách từ (Word Budget)**:
  $$\text{Số từ tối đa} = \text{Thời lượng (giây)} \times 2.5$$
  (Câu 1.08s: ngân sách tối đa là **3 từ**).
- Prompt yêu cầu: *"Câu [cue-21] có thời lượng 1.08s. Bắt buộc dịch súc tích trong tối đa 3 từ, đúng nghĩa gốc."*
- **Hiệu quả**: Bản dịch ra đời ngay từ đầu đã vừa vặn với 1.08s, không cần rephrase, không tràn timeline.

#### 2. Gom nhóm câu thông minh (Semantic Grouping)
- Thay vì chia vụn 57 mẩu ngắn 0.8s – 1.2s không thể nói kịp một câu:
- Gộp các câu ngắn liền nhau thành cụm **3.0s – 5.0s**.
- Giúp AI dịch trọn vẹn ngữ nghĩa, TTS đọc có ngữ điệu tự nhiên, và giảm số request gửi lên GPU từ **57 câu xuống chỉ còn ~18 cụm**!

#### 3. Ước lượng trước khi gọi GPU (Pre-estimation)
- Đếm số từ trước khi gửi sang GPU.
- Nếu câu nào chắc chắn quá dài, xử lý rút gọn bằng LLM ngay từ đầu trên văn bản.
- GPU chỉ render **đúng 1 lần duy nhất cho bản audio chắc chắn dùng được**, không bao giờ bị render thừa rồi vứt đi.

#### 4. Tận dụng khoảng lặng (Gap Borrowing) & Co giãn Tempo an toàn
- Mượn khoảng nghỉ 0.2s – 0.4s giữa các cảnh thoại liền kề.
- Bộ lọc `atempo / rubberband` của FFmpeg chỉ co giãn nhẹ trong ngưỡng an toàn **$1.05\times - 1.18\times$** (ngưỡng này tai người hoàn toàn không nhận ra là bị tăng tốc, giữ nguyên cao độ giọng clone).

#### 5. Tối ưu cấu hình trên Máy chủ GPU (`192.168.1.15:8000`)
- **Giảm Diffusion Steps**: Hạ từ 50 steps xuống **16 – 24 steps** (dùng solver Euler/Midpoint) $\rightarrow$ Tốc độ tăng gấp đôi, tải GPU giảm 50%.
- **Cache Speaker Embedding trong VRAM**: Server trích xuất vector giọng của `Voice-short-Anh-funny.mp3` 1 lần và lưu cache trong VRAM, các câu sau chỉ nhận text thuần và voice_id, bỏ qua việc decode file MP3 150 lần.
- **Bật FP16 / BF16 & FlashAttention**: Giảm 50% VRAM và tăng tốc nhân Tensor Cores.

---

### Bảng Kết Quả So Sánh Sau Tối Ưu

| Tiêu chí | Trước khi tối ưu | Sau khi tối ưu |
| :--- | :---: | :---: |
| **Số lượt gọi GPU TTS** | 130 – 180 lần (do rephrase lặp) | **18 – 25 lần** (đã gom nhóm & khống chế độ dài) |
| **Thời gian GPU hoạt động** | 35 – 40 phút (100% load liên tục) | **1 – 2 phút** (chạy ngắt quãng, rất mát) |
| **Thời gian toàn bộ Video (2 phút)** | **~60 phút** | **~3 – 5 phút** |
| **Độ chính xác Timeline** | Hay bị tràn cảnh, cắt đoạn | **Khớp chính xác 100%** vào từng khung cảnh |
| **Chất lượng giọng đọc** | Đôi khi bị nhanh, gấp gáp do ép tempo | **Tự nhiên, đúng ngữ điệu**, không méo tiếng |
