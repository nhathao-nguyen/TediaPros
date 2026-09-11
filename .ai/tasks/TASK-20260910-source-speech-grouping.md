# TASK-20260910: Chốt nhóm thoại từ nguồn trước khi dịch

- **Trạng thái:** Đã kiểm chứng code và test local; chưa cập nhật app cài đặt/chạy provider thật
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-10

## 1. Mục tiêu

Sửa cách chia câu từ đầu sau chẩn đoán `DubbingVideoExtensionLimitError` ở video `7635582620131374579`. Bản Pháp có dấu hỏi ở cue 45 làm logic cũ tách cue khỏi phần câu nguồn tiếp tục ở cue 46.

## 2. Tiêu chuẩn nghiệm thu

- [x] Chốt nhóm từ nguồn trước request dịch, dùng cùng thuật toán ở TTS.
- [x] Không dùng dấu câu/độ dài bản dịch để thay ranh giới; giữ mọi ID, thứ tự, timestamp và text nguồn.
- [x] Test đúng 54 cue checkpoint: cue 45–46 chung nhóm, không sửa dữ liệu fixture.
- [x] Giữ nhóm qua chia request, resume, missing-ID recovery và ngữ cảnh phủ định ở cue giữa đã hoàn thành.
- [x] Giới hạn request vẫn được thực thi cho cue quá dài; không ghép những mảnh nguồn rời rạc thành câu thiếu nội dung.
- [x] Typecheck node/web PASS.
- [x] 157 tests thuộc 11 suite liên quan PASS; 0 fail, 0 skip.
- [x] ADR và bàn giao cập nhật.

## 3. Phạm vi

Thay đổi đường AutoShort strict translation và lập nhóm TTS. Không thay ASR/OCR, không xóa hay sửa checkpoint người dùng, không đổi trần tempo 1.80x hoặc extension 40%, không cắt lời. Không thay đường dịch legacy không strict. Giữ nguyên các thay đổi chưa commit có sẵn của người dùng.

## 4. Quyết định và lý do

- `groupSourceSpeechCues` dùng ranh giới sau dấu kết thúc nguồn, đổi người nói và khoảng nghỉ >=0.60s; phần chưa có dấu câu dùng DP theo source text/timeline, tối đa 6 cue/15s/300 ký tự nguồn cho nhóm nhiều cue. Single cue quá dài vẫn nguyên ledger, chỉ chia đơn vị request nội bộ khi cần. Đây là heuristic, không chứng minh mọi nhóm là một câu ngữ nghĩa hoàn chỉnh.
- `groupDubbingPlanForSpeech` gọi cùng helper thay vì phân hoạch từ translated text. Bản dịch thêm `?` không còn cô lập fragment; dấu hỏi nguồn chỉ đóng câu sau fragment cuối.
- Gán `source-speech-v1:<first-id>` tại đầu orchestrator trên toàn ledger. Planner/prompt giữ identity qua các subset. Prompt vẫn yêu cầu trả một item cho mỗi ID gốc, không chia lại output theo vị trí.
- `TranslationInput.sourceSpeechGroups` là metadata tùy chọn, chứa bản sao các nhóm nhiều cue có giới hạn, chỉ đọc để tạo context. Nó giữ cả cue giữa đã hoàn thành trong sparse resume, tránh biến câu phủ định thành khẳng định khi ghép hai đầu.
- Không tạo group-context bằng cách nối các phần rời của singleton quá dài; các phần đó chỉ dùng context excerpt riêng lẻ hiện có.
- `translation-v10` làm identity cũ không còn khớp; lần chạy mới của bản code này sẽ dịch lại thay vì tái dùng output v9. Source checkpoint vẫn được giữ.
- Request phải tuân thủ context thực tế, tối đa 24 đơn vị và 20.000 ký tự ước lượng; giữ source group ID dù phải chia request.

## 5. Tệp thay đổi trong task này

- `[NEW]` `src/main/sourceSpeechGrouping.ts`
- `[NEW]` `src/main/translation/sourceGroups.ts`
- `[MODIFY]` `src/main/dubbing/plan.ts`, `src/main/semanticGrouping.ts`
- `[MODIFY]` `src/main/translation/planner.ts`, `src/main/translation/prompts.ts`, `src/main/translation/orchestrator.ts` (file orchestrator đã có thay đổi trước task; task này chỉ thêm import và bước chuẩn bị nhóm đầu hàm).
- `[MODIFY]` `src/shared/translation.ts` (metadata tùy chọn, không thêm IPC raw).
- `[NEW]` `tests/fixtures/video30-source-cues.json` (54 cue nguồn từ checkpoint, chỉ id/start/end/text).
- `[MODIFY]` `tests/dubbing-grouping.test.ts`, `tests/translation-planner.test.ts`, `tests/translation-prompts.test.ts`, `tests/translation-identity.test.ts`, `tests/translation-orchestrator.test.ts` (test orchestrator có thay đổi trước task; giữ nguyên).
- `[MODIFY]` `docs/adr/005-source-anchored-dubbing-tempo-policy.md`
- `[NEW]` `docs/reviews/2026-09-10-source-speech-grouping/evidence/typecheck.log`, `related-tests.log` và bản ghi này.

## 6. Kiểm chứng và bằng chứng

```powershell
cmd.exe /d /c "npm.cmd run typecheck"
cmd.exe /d /c "node scripts/run-local-runtime-tests.mjs dubbing-grouping.test dubbing-plan.test translation-planner.test translation-prompts.test translation-identity.test translation-orchestrator.test local-translation.test translation-provider-contract.test autoshort-tts-pipeline.test autoshort-tts-cache.test autoshort-ocr-pipeline.test"
git diff --check -- <các file thuộc task>
```

Kết quả lần cuối sau sửa: typecheck exit 0; 157/157 test pass, 0 skip. Số test theo suite: 17/43/11/10/5/24/18/8/5/4/12. Các lỗi giả lập và thông báo FFmpeg fallback trong log test không phải test thất bại; xem summary và exit 0. Không tuyên bố toàn bộ repo test suite đã chạy.

TDD: các test mới về câu hỏi nhiều fragment, tính bất biến trước/sau dịch và group ID trước batching đã fail trước khi sửa. Test long-cue request cap và sparse resume mất phủ định cũng fail trước bản sửa tương ứng và pass sau đó.

Rà độc lập phát hiện thiếu metadata ở recovery, request dài vượt cap và sparse resume mất nội dung giữa; cả ba có regression test và đã sửa. Reviewer không thực hiện lượt ký duyệt cuối do công cụ báo hết hạn mức; phần hoàn thiện context được tự rà và kiểm chứng bằng test.

Offline replay dùng nguyên fixture 54 cue, EOF giả định 71s (không ảnh hưởng nhóm không ở cuối được kiểm tra): 9 nhóm nguồn; nhóm chứa cue 45–46 bao gồm cue 42–47, từ 54.78 đến 62.44s, usable window 7.16s. Đây là **window của cả nhóm**, không được so với WAV 2.765s của riêng cue 45 để khẳng định cả nhóm đã fit. Cần tạo và đo lại WAV nhóm thật.

## 7. Bàn giao

Mã nguồn sẵn sàng để build/chạy mới. Bản cài đặt 0.1.23 trong `AppData/Local/Programs/TediaPros` chưa được thay thế; chưa restart app hay gửi request dịch/TTS thật. Chưa xác nhận video này xuất thành công hoặc mọi video không có dấu câu đều được phân ngữ nghĩa chính xác. Khi nghiệm thu, dùng code mới để dịch lại/đo TTS, kiểm tra đủ nghĩa và âm thanh rồi xác nhận render.
