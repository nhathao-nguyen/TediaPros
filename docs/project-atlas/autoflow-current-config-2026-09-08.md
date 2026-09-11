# AutoFlow / AutoShort — cấu hình hiện tại

> Snapshot lập ngày 2026-09-08 từ 8 ảnh chụp giao diện người dùng do người dùng cung cấp, đối chiếu với `AutoShortConfig` và các state persisted trong code. Đây là bản ghi cấu hình để đọc/đối chiếu, **không phải payload import trực tiếp**: ảnh không chứa danh sách `items`, `outputDir`, vùng tọa độ OCR/phụ đề hoặc toàn bộ metadata model.

## 1. Cấu hình đang hiển thị

| Khu vực | Field nội bộ | Giá trị hiện tại | Bằng chứng / ghi chú |
|---|---|---|---|
| Hàng đợi | `queueCount` | `15` | Nhãn `Hàng đợi (15)` trong ảnh #1/#5/#6/#7 |
| Nhận diện phụ đề | `subtitleMethod` | `whisper` | Ảnh #1 chọn Whisper |
| Nhận diện phụ đề | `whisperModel` | `small` | Ảnh #1: `Small (Chính xác hơn)` |
| Nhận diện phụ đề | `whisperDevice` | `cpu` | Ảnh #1: `CPU (tương thích)` |
| Nhận diện phụ đề | `whisperLanguage` | `zh` | Ảnh #1: ngôn ngữ nguồn `Tiếng Trung` |
| Dịch phụ đề | `translateTarget` | `en` | Ảnh #1/#2: ngôn ngữ đích `Tiếng Anh` |
| Dịch phụ đề | `translateProvider` | `local` | Ảnh #2: `AI nội bộ (TTS-Server)` |
| Dịch phụ đề | `translateServerUrl` | `http://192.168.1.16:8000` | Code truyền cùng server AI local vào translation runner |
| Ngữ cảnh dịch | `translationGuidance` | Chưa xác định | Disclosure đang đóng trong ảnh #2; không tự suy đoán synopsis/glossary |
| Tạo tiêu đề | `videoTitle.enabled` | `true` | Ảnh #2 đã chọn `Tạo tiêu đề AI từ SRT` |
| Tạo tiêu đề | `videoTitle.provider` | `gemini` | Ảnh #2: `Gemini (AI ngoài)` |
| Tạo tiêu đề | `videoTitle.language` | `en` | Lấy theo ngôn ngữ đích đang chọn |
| Khóa dịch local | `localApiKey` | Đã lưu, giá trị ẩn | Ảnh #2 hiển thị `Đã lưu trên máy`; giá trị thật không ghi vào tài liệu |
| Xử lý chữ gốc | `lamMo` | `true` | Ảnh #5 công tắc `Bật` |
| Xử lý chữ gốc | `blurMode` | `ocr-auto` | Ảnh #5 chọn `Tự động OCR` |
| Xử lý chữ gốc | `ocrBlurProfile` | `accurate` | Ảnh #5 chọn `Chính xác — khuyên dùng` |
| Kiểu hiển thị | `subtitleDisplayStyle` | `standard` | Ảnh #3 chọn `Hiển thị cả câu`; code cũng ép về `standard` khi dịch/TTS đang bật |
| Xuất phụ đề | `burnOnExport` | `true` | UI hiển thị `Luôn burn khi xuất` ở ảnh #3 |
| Bố cục phụ đề | `subtitleLayoutProfile` | `vertical` | Ảnh #3: `Video dọc · tối đa 2 dòng` |
| Preview | `showSafeArea` | `true` | Ảnh #3 đã chọn `Hiện vùng an toàn trên bản xem trước` |
| Font | `fontId` | `auto` | Ảnh #4: `Tự động theo nội dung` |
| Font | `subtitleFontSize` | `0` / tự động | Ảnh #4: `Cỡ chữ · Tự động theo khung` |
| Font | `textColor` | `#ffffff` | Ảnh #4 ô màu chữ trắng |
| Font | `outlineColor` | `#000000` | Ảnh #4 ô màu viền đen |
| Font | `outlinePx` | `6.5` | Ảnh #4 hiển thị `Độ dày viền · 6.5px` |
| Font | `bgEnabled` | `false` | Ảnh #4 bỏ chọn `Thêm nền sau chữ` |
| Lồng tiếng | `ttsEnabled` | `true` | Ảnh #6 công tắc `Bật` |
| Server dịch/TTS | `ttsServerUrl` | `http://192.168.1.16:8000` | Ảnh #2/#6; code dùng persisted key `tblao.ai.serverUrl` cho cả dịch local và TTS |
| Mô hình TTS | `ttsModel` | `tts-multilingual` (ID dự kiến) | Ảnh #6 hiển thị `Chatterbox Multilingual V3`; ID lấy từ server chưa được probe trong snapshot này |
| Giọng TTS | `ttsVoice` | Clone `English Funny`, ID chưa ghi | Ảnh #6: `English Funny (en · Clone)`; không tự điền UUID clone |
| Tốc độ TTS | `ttsSpeed` | `1.00` | Ảnh #6 |
| Nhịp đọc | `paceMode` | `source-adaptive` | Ảnh #6: `Tự bám nhịp nguồn (khuyến nghị)` |
| Chế độ âm thanh | `audioMode` | `separate-vocals` | Ảnh #7 chọn `Tách thoại gốc, giữ nhạc & SFX`; state gần nhất cũng ghi nhận giá trị này |
| Tách thoại | `separationPreset` | `balanced` | Ảnh #7: `Cân bằng — khuyên dùng` |
| Tách thoại | `effectiveProvider` | `directml` | Ảnh #7: `DirectML · NVIDIA/AMD/Intel`; trạng thái hiển thị `Sẵn sàng` |
| Âm lượng gốc | `originalAudioVolume` | Không áp dụng trong mode hiện tại | Slider chỉ hiện khi `audioMode = mix` |
| Nhạc nền riêng | `backgroundMusic` | Không dùng trong mode hiện tại | Contract cấm cấu hình nhạc nền riêng khi giữ nhạc/SFX bằng `separate-vocals` |

## 2. Luồng AutoFlow suy ra từ cấu hình

```text
Video hàng đợi (15)
  → Whisper Small trên CPU, nguồn tiếng Trung (zh)
  → OCR tự động để xử lý chữ gốc, profile accurate
  → Dịch zh → en qua local server http://192.168.1.16:8000
  → Gemini tạo tieude.txt từ SRT
  → Chatterbox Multilingual V3, voice clone English Funny
  → TTS 1.00x + source-adaptive pacing
  → Tách thoại gốc bằng DirectML, giữ nhạc/SFX, preset balanced
  → Burn phụ đề: video dọc tối đa 2 dòng, font tự động, chữ trắng,
    viền đen 6.5px, không nền chữ, luôn burn khi xuất
```

Code dubbing vẫn giữ giới hạn tempo vật lý `1.10x–1.80x`, rephrase/reflow trước khi cần kéo dài, và khả năng kéo dài từng đoạn tối đa 40% theo policy hiện tại. Các giới hạn này không phải giá trị slider trong ảnh nhưng là ràng buộc runtime.

## 3. Bản snapshot JSON tham chiếu

JSON dưới đây dùng cho ghi chép hoặc làm input cho một script chuyển đổi. Cần bổ sung dữ liệu thực tế trước khi gửi qua IPC `autoShortStart`.

```json
{
  "snapshotVersion": "autoflow-config-snapshot-v1",
  "capturedAt": "2026-09-08",
  "evidence": "user-screenshots-1-to-8",
  "queueCount": 15,
  "subtitle": {
    "subtitleMethod": "whisper",
    "whisperModel": "small",
    "whisperDevice": "cpu",
    "whisperLanguage": "zh",
    "translateTarget": "en",
    "translateProvider": "local",
    "translateServerUrl": "http://192.168.1.16:8000",
    "translationGuidance": null,
    "videoTitle": {
      "enabled": true,
      "provider": "gemini",
      "language": "en",
      "apiKey": "<stored-redacted>"
    },
    "blur": {
      "lamMo": true,
      "blurMode": "ocr-auto",
      "ocrBlurProfile": "accurate"
    },
    "display": {
      "subtitleDisplayStyle": "standard",
      "burnOnExport": true,
      "subtitleLayoutProfile": "vertical",
      "showSafeArea": true,
      "fontId": "auto",
      "subtitleFontSize": 0,
      "textColor": "#ffffff",
      "outlineColor": "#000000",
      "outlinePx": 6.5,
      "bgEnabled": false
    }
  },
  "dubbing": {
    "ttsEnabled": true,
    "ttsServerUrl": "http://192.168.1.16:8000",
    "ttsModel": "tts-multilingual",
    "ttsModelLabel": "Chatterbox Multilingual V3",
    "ttsVoiceLabel": "English Funny (en · Clone)",
    "ttsVoiceId": null,
    "ttsSpeed": 1.0,
    "paceMode": "source-adaptive",
    "audioMode": "separate-vocals",
    "separationPreset": "balanced",
    "effectiveProvider": "directml"
  },
  "requiredBeforeExecution": [
    "items[] với đường dẫn video tuyệt đối",
    "outputDir với đường dẫn tuyệt đối",
    "ocrRegion/subRegion nếu không dùng vùng mặc định",
    "translationGuidance nếu muốn synopsis/glossary",
    "model ID và clone voice ID xác nhận từ /v1/models của server"
  ]
}
```

## 4. Ranh giới bằng chứng

- `SCREENSHOT_CONFIRMED`: các giá trị có lựa chọn/nhãn nhìn thấy trong 8 ảnh.
- `CODE_CONFIRMED`: tên field, enum, cách truyền server và ràng buộc contract trong `src/shared/types.ts`, `src/shared/autoShortContract.ts` và `src/renderer/src/components/AutoShort.tsx`.
- `PERSISTED_STATE_HINT`: một số key trong Electron Local Storage; LevelDB còn có record của origin/phiên cũ nên không dùng nó để thay thế ảnh hiện tại.
- `UNKNOWN`: synopsis/glossary đang đóng, ID model/voice thực từ server, danh sách 15 video, thư mục xuất và vùng tọa độ.

Không ghi API key, cookie, token, đường dẫn clone audio hoặc nội dung riêng tư vào snapshot này.
