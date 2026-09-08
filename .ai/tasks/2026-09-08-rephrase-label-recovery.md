# Sửa lỗi nhãn rephrase làm hỏng rescue TTS

- **Trạng thái:** Đã kiểm chứng cục bộ; đã build và restart dev app
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-08

## 1. Mục tiêu

Khắc phục lỗi provider trả ba candidate `[cue-id:n]` trên cùng một dòng khiến parser gộp toàn bộ phương án thành một câu. Lỗi đó làm TTS đọc cả nhãn và các phương án, tạo audio 14.860s thay cho clip 2.311s rồi vẫn bị đưa vào bước fit thời lượng.

## 2. Tiêu chuẩn nghiệm thu

- [x] Tách candidate inline theo nhãn và giữ strict validation.
- [x] Chặn nhãn còn sót trong `finalSpokenText` trước cả TTS/cache.
- [x] Chỉ nhận audio rescue nếu hợp lệ và ngắn hơn audio hiện tại.
- [x] Ghi log lý do rephrase: HTTP, response không hợp lệ, candidate rỗng, không cải thiện, audio không đầy đủ.
- [x] `npm.cmd run typecheck` pass.
- [x] 267 test pass, 0 fail; build pass; `git diff --check` pass.
- [x] Dev app đã restart từ worktree đúng mã sửa.

## 3. Bằng chứng

- Regression đỏ trước sửa: `.ai/tasks/2026-09-08-rephrase-label-red.log`.
- Test xanh sau sửa: `.ai/tasks/2026-09-08-rephrase-label-tests.log` — 14 suite, 267 pass, 0 fail.
- Typecheck: `.ai/tasks/2026-09-08-rephrase-label-typecheck.log`.
- Build: `.ai/tasks/2026-09-08-rephrase-label-build.log`.
- Log trước restart giữ nguyên: `.ai/tasks/2026-09-08-rephrase-label-before.log`.
- Dev startup đầu tiên: `.ai/tasks/2026-09-08-rephrase-label-dev.stdout.log`, `.ai/tasks/2026-09-08-rephrase-label-dev.stderr.log`; phiên đang chạy sau kiểm tra lại: `.ai/tasks/2026-09-08-rephrase-label-dev2.stdout.log`, `.ai/tasks/2026-09-08-rephrase-label-dev2.stderr.log`.

Offline ASR trên WAV cache lỗi đọc ra cả ba phương án và marker candidate, xác nhận parser/transport là boundary gây hỏng lời đọc. Không dùng kết quả đó làm bằng chứng chất lượng voice clone.

## 4. Phạm vi và giới hạn

Chỉ sửa parser rephrase, callback telemetry và synthesis rescue trong worktree `F:/Son/tool/TediaPros/.worktrees/codex-autoshort-optimization`. Không xoá toàn bộ TTS cache; key chứa câu gộp cũ không được tái sử dụng cho candidate sạch, còn nhãn bị chặn nếu xuất hiện trong plan tiếp tục.

`UNKNOWN`: chưa chạy xong hai video người dùng với server LLM/voice-clone thật sau restart. Nếu candidate sạch vẫn tạo audio quá dài, log mới sẽ ghi `phase=rescue outcome=no-improvement` hoặc `incomplete-audio`, sau đó pipeline báo vượt trần 1.45x thay vì ép tốc độ hoặc cắt lời.
