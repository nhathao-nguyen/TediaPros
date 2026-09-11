# Phân Hệ Lồng Tiếng & TTS (Dubbing Subsystem)

- **Thư mục mã nguồn:** `src/main/dubbing/` (`plan.ts`, `policy.ts`, `durationPredictor.ts`, `synthesis.ts`, `cache.ts`, `profileStore.ts`, `translation.ts`)
- **Tài liệu tham chiếu:** [src/main/dubbing/AGENTS.md](file:///f:/Son/tool/TediaPros/src/main/dubbing/AGENTS.md), [docs/adr/005-source-anchored-dubbing-tempo-policy.md](file:///f:/Son/tool/TediaPros/docs/adr/005-source-anchored-dubbing-tempo-policy.md)

---

## 1. Trách Nhiệm Cốt Lõi
- Lập kế hoạch cửa sổ thời gian phát âm (`DubbingTimingPlan`) cho từng câu dịch.
- Ước lượng trước thời lượng phát âm của câu tiếng Việt/ngoại ngữ (`durationPredictor.ts`).
- Điều tiết nhịp độ phát âm (Tempo) trong khoảng an toàn vật lý **1.10x đến 1.45x**.
- Gọi TTS engine (Edge TTS, Local TTS Server, ElevenLabs) và lưu bộ nhớ đệm (`cache.ts`).
- Bảo tồn khoảng lặng tự nhiên giữa các câu nói (`DUBBING_PROTECTED_GAP_SECONDS = 0.50s`).

---

## 2. Bốn Ràng Buộc Bất Khả Xâm Phạm
1. **Trần nhịp độ âm thanh (Tempo Ceiling):**
   - Tuyệt đối không bao giờ áp dụng hệ số tempo $> 1.45x$ vào bất kỳ phân đoạn âm thanh nào.
   - Nhịp độ ưu tiên: `1.10x`, mức thông thường: `1.25x`.
2. **Khoảng lặng bảo vệ (Protected Silence Gap):**
   - Luôn chừa tối thiểu `0.50s` khoảng lặng tự nhiên giữa các câu thoại kế tiếp.
3. **Cấm cắt bỏ câu thoại đơn lẻ (No Silent Dropping):**
   - Nếu một cue đơn lẻ không thể phát âm vừa vặn ở trần `1.45x`, phải báo lỗi rõ ràng để xử lý lại bản dịch, không tự ý cắt cụt đuôi file âm thanh.
4. **Hiệu chuẩn ngưỡng âm thanh:**
   - Ngưỡng cắt tỉa khoảng lặng thừa: `-50 dB`, độ trễ onset `30ms`, offset `100ms`.

---

## 3. Mô Hình Dự Đoán Thời Lượng & Cache Thông Minh
- **`durationPredictor.ts`:** Dựa trên số lượng âm tiết, từ và ký tự của câu dịch để ước tính thời lượng phát âm tự nhiên trước khi gọi TTS.
- **`cache.ts`:** Khóa cache được tính toán dựa trên mã băm SHA-256 của: văn bản câu thoại + voice ID + tốc độ + provider + model. Giúp tái sử dụng ngay lập tức các câu thoại đã sinh khi render lại, tiết kiệm chi phí và thời gian.

---

## 4. Kiểm Thử Liên Quan
```powershell
cmd.exe /c "node scripts/run-local-runtime-tests.mjs dubbing-plan.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-tts-pipeline.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-tts-cache.test"
```
