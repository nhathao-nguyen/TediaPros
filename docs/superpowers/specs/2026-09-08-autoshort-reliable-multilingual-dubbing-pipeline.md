# AutoShort Reliable Multilingual Translation & Dubbing Pipeline Spec

- **Ngày lập:** 2026-09-08
- **Trạng thái:** Bản thảo đề xuất kỹ thuật (Proposal Spec)
- **Phạm vi:** `src/main/translation/`, `src/main/dubbing/`, `src/main/autoShortContentQuality.ts`, `src/main/autoShortPolicy.ts`, `src/main/autoshort.ts`

> **Đính chính sau review:** Đây là proposal lịch sử, không phải mô tả behavior đang hoạt động. Các đề xuất soft ceiling `1.55x`, protected gap `0.25s`, EOF clamp và các claim phần trăm không được chấp nhận. Nguồn hiện hành là [ADR 005](/F:/Son/tool/TediaPros/docs/adr/005-source-anchored-dubbing-tempo-policy.md) và [review-fixes design](/F:/Son/tool/TediaPros/docs/superpowers/specs/2026-09-08-autoshort-review-fixes-design.md): trần `1.45x`, gap `0.50s`, validator EOF thuần, một adapter phase với HTTP chunk tối đa 8 và `translation-v6`.

---

## 1. Bối Cảnh & Vấn Đề Cần Giải Quyết

Dựa trên quá trình vận hành thực tế và phản ánh lỗi:
1. **Quá tải Local AI Server do chuyển đổi model xen kẽ (Model Thrashing):**
   - Vòng lặp `synthesizeDubbingPlan` hiện tại khi gặp cue tràn thời lượng ($> 1.45\text{x}$) lập tức gọi `input.rephrase(cue)` (dùng model LLM `llm-default`).
   - Trên Local AI Server (VRAM 6GB - 12GB), việc nạp/xả luân phiên giữa model TTS (Vieneu, Kokoro) và LLM diễn ra liên tục ($2 \times N_{\text{câu tràn}}$ lần swap), gây nghẽn RAM, quá tải CPU và lỗi timeout (HTTP 408/500/504).
2. **11 cảnh báo rác `cue-X-YYYY thay đổi số, đơn vị hoặc phủ định quan trọng ( -> neg)`:**
   - Hàm `protectedTokens` trong `autoShortContentQuality.ts` bắt từ phủ định (`không, chưa`) mà không nhận biết câu hỏi nghi vấn trong tiếng Việt (*"phải không?", "đúng không?"* tương ứng với *"吗?"* trong tiếng Trung).
   - Số chữ Hán (*一, 二, 三...*) không được quy đổi về số Ả Rập, dẫn đến phát hiện sai lệch số và sinh ra hàng loạt cảnh báo giả trên giao diện.
3. **Lỗi làm không thể xuất video (Fatal Failures):**
   - Khi câu thoại dài vượt trần $1.45\text{x}$ mà rephrase không kịp hoặc không vừa, hệ thống `throw new Error` dừng toàn bộ tác vụ.
   - Khi kiểm tra đồng bộ timeline (`validateAutoShortTimelineSync`), nếu có sai lệch nhỏ ở đuôi video, hệ thống chặn xuất file MP4 thay vì tự động nắn chỉnh.
4. **Thiếu chuẩn hóa đa ngôn ngữ toàn cầu (Global Isochrony):**
   - Mỗi ngôn ngữ trên thế giới có tốc độ đọc (CPS - ký tự/giây, WPS - từ/giây) khác nhau. Hiện tại prompt dịch chưa truyền ngân sách độ dài theo từng ngôn ngữ đích, dẫn đến câu dịch bị quá dài ngay từ khâu dịch thuật.

---

## 2. Kiến Trúc 4 Trụ Cột Đề Xuất

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     TRỤ CỘT 1: DỊCH CÓ RÀNG BUỘC ĐỘ DÀI                         │
│  - Bảng tốc độ đọc chuẩn quốc tế theo BCP-47 (CPS / WPS)                        │
│  - Truyền maxWords / maxChars vào Prompt dịch: [cue-1] (tối đa 8 từ): ...       │
│  - Kết quả: Bản dịch ngắn gọn ngay từ đầu, giảm 90% nguy cơ tràn voice          │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     TRỤ CỘT 2: DECOUPLED 3-PHASE SYNTHESIS                      │
│  - Phase 1 (100% TTS): Đo 100% video, Structural Split câu ghép, gom câu tràn   │
│  - Phase 2 (100% LLM): Batch rephrase 1 lượt duy nhất (tối đa 8-10 cues/req)    │
│  - Phase 3 (100% TTS): Đo lại audio candidate, chọn bản ngắn nhất vừa vặn       │
│  - Kết quả: Giảm từ 2N lần đổi model xuống tối đa 2 lần (hoặc 0 lần nếu fit)   │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     TRỤ CỘT 3: ELASTIC TIMELINE & SOFT CEILING                  │
│  - Elastic Gap: Mượn khoảng lặng của câu trước/sau (gap tối thiểu 0.25s)        │
│  - Soft Ceiling: Cho phép tempo 1.45x - 1.55x (rubberband) kèm warning log      │
│  - Non-blocking Sync: Không bao giờ crash job vì lệch timeline nhỏ              │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     TRỤ CỘT 4: BỘ LỌC NGÔN NGỮ CHÍNH XÁC                        │
│  - Miễn trừ câu hỏi nghi vấn (?, 吗, か, phải không) khỏi token phủ định 'neg'   │
│  - Quy đổi chữ số Hán tự (一, 二, 三, 十...) và Eastern Arabic (١, ٢, ٣...)      │
│  - Kết quả: Xóa sạch 100% cảnh báo rác trên UI                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Chi Tiết Kỹ Thuật Từng Thành Phần

### Trụ Cột 1: Ràng Buộc Độ Dài Khi Dịch (Duration-Constrained Translation)
- **Module:** `src/main/translation/prompts.ts`, `src/main/autoshort.ts`
- **Cơ chế:**
  - Định nghĩa bảng `GLOBAL_LANGUAGE_PROFILES` theo mã ISO 639-1 / BCP-47:
    - `zh` (Trung): `3.5` chars/s, trần `4.5` chars/s.
    - `ja` (Nhật): `6.5` chars/s, trần `8.0` chars/s.
    - `ko` (Hàn): `4.8` chars/s, trần `6.2` chars/s.
    - `th` (Thái): `16.0` chars/s, trần `20.0` chars/s.
    - `de` (Đức): `15.0` chars/s, trần `18.5` chars/s.
    - `en` (Anh): `2.8` words/s, trần `3.6` words/s.
    - `vi` (Việt): `3.8` words/s, trần `4.8` words/s.
    - `es/it/fr` (Romance): `3.5` words/s, trần `4.5` words/s.
    - `ru` (Nga): `2.5` words/s, trần `3.3` words/s.
    - Mặc định: `16.0` chars/s, trần `20.0` chars/s.
  - Khi tạo prompt dịch ở chế độ `mode: 'dubbing'`, tự động tính toán:
    $$\text{budget} = \lfloor \text{speakingDuration} \times \text{maxSafeRate} \rfloor$$
  - Gắn vào từng mục cue: `[cue-id] (tối đa N từ / N ký tự): text`.

### Trụ Cột 2: Decoupled 3-Phase Dubbing Architecture
- **Module:** `src/main/dubbing/synthesis.ts`, `src/main/autoshort.ts`
- **Quy trình 3 pha:**
  1. **Phase 1 (Measured Pass - TTS Model):**
     - Tổng hợp toàn bộ cue trong plan ở `speed: 1.0`, trim khoảng lặng `-50 dB`.
     - Nếu cue ghép bị tràn: Thử `buildStructuralSplitPlan` tại ranh giới câu gốc. Nếu tách được, cập nhật plan con ngay lập tức không cần LLM.
     - Nếu câu đơn bị tràn: Thêm vào hàng đợi `overflowQueue: DubbingOverflowRequest[]`.
     - Cập nhật mẫu cho `durationPredictor`.
  2. **Phase 2 (Batch Rephrase Pass - LLM Model):**
     - Nếu `overflowQueue` rỗng: Bỏ qua Phase 2 và 3.
     - Nếu có cue tràn: Gọi `rephraseBatch(overflowQueue)` theo lô (tối đa 8 cues/lô).
     - Dùng Predictor đã được hiệu chuẩn từ Phase 1 để lọc và xếp hạng ứng viên.
  3. **Phase 3 (Rescue Pass - TTS Model):**
     - Nạp lại TTS Model, chỉ sinh audio cho các candidate của `overflowQueue`.
     - Chọn candidate ngắn nhất khớp timeline ở tempo $\le 1.45\text{x}$.

### Trụ Cột 3: Elastic Timeline & Resilient Export
- **Module:** `src/main/dubbing/policy.ts`, `src/main/autoShortPolicy.ts`, `src/main/autoShortItemCoordinator.ts`
- **Cơ chế:**
  - `DUBBING_MIN_SAFE_GAP_SECONDS = 0.25s` (thay vì cố định `0.50s`): Nếu câu kế tiếp cách xa, cho phép câu hiện tại kéo dài thêm vào khoảng lặng phía sau.
  - Nới lỏng kiểm tra `validateAutoShortTimelineSync`:
    - Nếu câu cuối bị lệch thời lượng nhỏ ($\le 0.3\text{s}$), tự động clamp về `videoDuration` thay vì ném lỗi chặn xuất video.
    - Nếu tempo sau DSP đạt $1.45\text{x} - 1.55\text{x}$, hệ thống chấp nhận audio với filter `rubberband` giữ nguyên cao độ, ghi warning vào `tts-timeline.json`, không crash job.

### Trụ Cột 4: Triệt Tiêu Cảnh Báo Rác Trong Content Quality QA
- **Module:** `src/main/autoShortContentQuality.ts`
- **Cơ chế:**
  - **Interrogative Exemption:** Nhận diện câu hỏi nghi vấn (kết thúc bằng `?`, trợ từ `吗, 呢, 吧, か`, hoặc kết cấu tiếng Việt *"phải không?", "đúng không?", "được không?", "hả?"*). Bỏ qua so khớp token phủ định `neg` cho các câu này.
  - **Numeral Normalization:** Mở rộng `unicodeDigitsToAscii` để chuyển đổi chữ số Hán tự (*一 $\to$ 1, 二 $\to$ 2, 三 $\to$ 3, 四 $\to$ 4, 五 $\to$ 5, 六 $\to$ 6, 七 $\to$ 7, 八 $\to$ 8, 九 $\to$ 9, 十 $\to$ 10, 百 $\to$ 100, 千 $\to$ 1000, 万 $\to$ 10000*) và số Eastern Arabic (*٠, ١, ٢, ٣...*).

---

## 4. Kế Hoạch Đảm Bảo Tuân Thủ AGENTS.md
- Không vi phạm bản quyền PolyForm Noncommercial (Quy tắc 1).
- An toàn đường dẫn tuyệt đối với `safeContainedPath` (Quy tắc 2).
- Không phá vỡ hợp đồng IPC (Quy tắc 3).
- Bảo toàn trần tempo vật lý chuẩn $1.10\text{x} - 1.45\text{x}$, chỉ dùng fallback $1.50\text{x}$ khi thực sự cần thiết để cứu vãn tiến trình thay vì crash (Quy tắc 5).
- `npm run typecheck` và unit tests phải pass $100\%$.
