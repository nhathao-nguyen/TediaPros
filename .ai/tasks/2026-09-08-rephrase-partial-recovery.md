# DUBBING-REFRASE-RECOVERY: Phục hồi batch một phần và đo thêm phương án TTS

- **Trạng thái:** Đã kiểm chứng, build và restart dev app; chờ người dùng chạy lại toàn bộ video
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-08

## 1. Mục tiêu

Sửa lỗi vẫn vượt 1.45x sau bản sửa parser inline. Log thật cho thấy preflight trả `unknown-id` khiến cả batch bị bỏ; rescue chỉ thử một candidate và gọi là `accepted` dù audio vẫn quá dài. Ba replacement vẫn lỗi: gà 1.959s trong 1.24s, cua 2.310s trong 1.42s, bò 1.989s trong 1.26s. Video đá cũng gặp một cue vượt nhẹ (1.479x).

## 2. Tiêu chuẩn nghiệm thu

- [x] Giữ cue hợp lệ trong batch có ID lỗi; chỉ yêu cầu lại phần thiếu một lượt, không đoán identity.
- [x] Một request LLM rescue/cue, tối đa ba candidate audio khác nhau; giữ clip tốt nhất và đo fit thật.
- [x] Giữ trần tempo 1.45x, protected gap 0.50s và các ngưỡng trim; không cắt lời.
- [x] Gửi thời lượng TTS đo được vào prompt và phân biệt `improved-overflow` với `accepted`.
- [x] Typecheck node/web pass; 127 test thuộc 14 suite pass; build pass.
- [x] Hoàn tất đối chiếu cue cua: lần 6 giữ “crab” và điều kiện trước khi ăn, tempo 1.2393x với audio gốc quá dài được phát lại.
- [x] Restart và xác nhận process/window/URL của bản mới.

## 3. Phạm vi triển khai

Chỉ sửa tại worktree `codex/autoshort-optimization`, giữ toàn bộ thay đổi có sẵn. Không merge/commit, sửa main, xóa cache dùng lại, thay giọng hoặc thay cài đặt người dùng. Kiểm thử live chỉ các cue lỗi và một batch 24 cue, không khẳng định đã render xong toàn bộ video.

## 4. Quyết định và lý do

- Parse từng cue dựa trên nhãn chính xác, cách ly cue mơ hồ; response có continuation không phân tích được hoặc bị cắt vẫn bị loại. Nhãn đơn `[exact-id]` được chuẩn hóa khi không trộn với candidate có số.
- Local preflight repair nhóm 8, tối đa một lượt trong deadline 90 giây ban đầu; giữ kết quả đã hợp lệ khi HTTP/deadline lỗi. Caller giới hạn batch ban đầu 24 cue và giữ resource lease trước TTS.
- Predictor chỉ dùng để sắp thứ tự candidate; audio thực đo mới quyết định có vừa không. Không gọi lại LLM giữa các candidate.
- Không dùng phép đếm từ như bộ kiểm tra nghĩa. Prompt yêu cầu giữ đối tượng, hành động, điều kiện và dùng động từ chính xác để rút gọn; kiểm tra ngữ nghĩa tự động độc lập chưa có.

## 5. Tệp thay đổi trong follow-up này

- `src/main/autoshort.ts`: partial repair Local, measured timing, chặn truncated response, log nhãn lỗi.
- `src/main/translation/response.ts`: `recoverBatchRephraseResponse`.
- `src/main/translation/prompts.ts`: nhãn được phép, measured duration, ngân sách ước lượng, các lựa chọn ngắn dần và giữ nghĩa.
- `src/main/dubbing/synthesis.ts`: thử tối đa ba candidate, giữ clip tốt nhất, telemetry đúng fit.
- `tests/translation-rephrase.test.ts`, `tests/dubbing-plan.test.ts`: regression parser/transport và số đo từ log thật.
- `docs/releases/dubbing-timing-recovery.md`: hành vi mới và giới hạn bằng chứng.
- `.ai/tasks/2026-09-08-rephrase-live.ts`, `.ai/tasks/2026-09-08-rephrase-live.mjs`: harness chẩn đoán có giới hạn; bản sao profile tạm để đọc cài đặt/auth; xóa bản sao sau khi kết thúc, không ghi auth vào evidence.

## 6. Kiểm chứng và bằng chứng

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs dubbing-plan.test translation-rephrase.test translation-response.test translation-prompts.test translation-budget.test translation-planner.test translation-orchestrator.test translation-identity.test translation-resume.test local-translation.test autoshort-tts-pipeline.test autoshort-tts-cache.test autoshort-ocr-pipeline.test autoshort-resource-manager.test
npm.cmd run build
git diff --check
```

- RED trước sửa: `2026-09-08-rephrase-partial-red.log` (6 lỗi), `2026-09-08-rephrase-partial-boundaries-red.log` (2 lỗi), `2026-09-08-rephrase-bare-inline-red.log` (1 lỗi: nhãn không đánh số inline lọt vào text).
- Final tests: `2026-09-08-rephrase-final-tests.log` — 127 pass, 0 fail, 14 suite được runner gọi.
- Typecheck: `2026-09-08-rephrase-final-typecheck.log` — node/web pass.
- Build: `2026-09-08-rephrase-final-build.log` — exit 0.
- Log app trước khi tắt: `2026-09-08-rephrase-partial-before.log`.
- Live 3: `2026-09-08-rephrase-live-evidence3/report.json`; preflight 24/24. Gà 1.2694x, bò 1.2793x, cua 1.2407x. Cua bỏ từ “crab”, vì vậy không tính lần này là đạt ngữ nghĩa.
- Live 4: prompt mới giữ “crab” trong cả ba candidate; audio gốc lần sinh mới tự fit 1.3559x, giữ gốc khi replacement dài hơn. Không dùng lần này để chứng minh cứu được audio gốc quá dài.
- Live 5: dùng lại WAV gốc thực từ lần 3 (2.199252s) và tạo mới các candidate TTS. Candidate ngắn nhất vẫn 2.080272s, cần 1.465x; pipeline từ chối đúng. Vì model tiếp tục dùng cụm dài, bổ sung ví dụ rút gọn cụm động từ bằng động từ chính xác, giữ đối tượng và điều kiện.
- Live 6: cùng WAV gốc 2.199252s và cửa sổ 1.42s; hai candidate dài 2.499728s/2.317347s bị loại. Candidate thứ ba “Check the crab before eating.” dài 1.666553s, qua FFmpeg thật ở 1.2393x. `2026-09-08-rephrase-live-evidence6/report.json` chứa plan và số đo; `llm-1.json` chứa request/response không có header auth. Exit 0. Đã đối chiếu text giữ đối tượng và điều kiện; không thay thế đánh giá ngữ nghĩa độc lập trên toàn bộ video.

## 7. Bàn giao

App khởi động lại lúc 02:26 ngày 2026-09-08 (Asia/Saigon), launcher PID 9080, Electron main PID 3956, cửa sổ `TediaPros` responding. Renderer PID 3168 có `--app-path` đúng worktree và parent là 3956; URL `http://localhost:5173/` trả HTTP 200. Bằng chứng: `2026-09-08-rephrase-final-activation.json`, `2026-09-08-rephrase-final-dev.stdout.log`, `2026-09-08-rephrase-final-dev.stderr.log`. Dev bundle có parser mới, `improved-overflow` và ví dụ prompt mới. Không thao tác trực tiếp nội dung UI hoặc tự chạy lại hàng đợi; xác nhận cửa sổ bằng process metadata.

Ngữ nghĩa LLM và chất lượng phát âm vẫn cần xem lại trên toàn bộ video. Đặc biệt ASR nguồn cue cua có ký tự sai `妓`; sửa timing không tự sửa ASR. Mọi số đo trên là cue-level với engine thật, không phải chứng nhận render đầy đủ.
