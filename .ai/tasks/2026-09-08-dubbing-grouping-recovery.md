# DUBBING-GROUPING: Sửa cửa sổ thoại quá ngắn do mảnh ASR

- **Trạng thái:** Đã sửa, test/build/restart và kiểm chứng toàn phần dubbing trên bốn checkpoint; chưa nghiệm thu render toàn pipeline
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-08

## 1. Mục tiêu

Xử lý lỗi tiếp tục xảy ra ở cue thứ ba sau khi đã sửa rephrase. Log thật xác nhận audio gà 0.830s bị fit vào 0.14s, cua 1.384s vào 0.38s. Nguyên nhân là coi từng mảnh ASR như câu thoại độc lập và trừ 0.50s sau mọi mảnh.

## 2. Tiêu chuẩn nghiệm thu

- [x] Gom các mảnh cùng chuỗi lời, giữ ledger đủ ID/text/mốc nguồn, không gom qua câu hỏi/speaker/pause rõ ràng.
- [x] Không để một cảnh báo ngắn bị rơi thành nhóm lẻ do chia nhóm tham lam.
- [x] Protected gap giữa đơn vị thoại, tempo <=1.45x, không drop/cắt audio.
- [x] Chia phụ đề nhóm theo lời đọc và giữ sourceIndex gốc.
- [x] Preflight tối đa 8 đơn vị khi plan có nhóm nhiều cue.
- [x] Hoàn tất live cả bốn video từ checkpoint đã có với model/voice/FFmpeg thật.
- [x] Typecheck/test/build cuối.
- [x] Mở lại app.

## 3. Phạm vi

Worktree `F:/Son/tool/TediaPros/.worktrees/codex-autoshort-optimization`, không merge/commit/reset công việc có sẵn. Sửa plan/grouping, synthesis captions và điểm nối AutoShort. Không tự sửa ASR sai hoặc thay cài đặt người dùng.

## 4. Quyết định

Theo ADR 008: plan version 3 có ledger nguồn; phân nhóm liên tiếp giới hạn 6 cue/15s/300 ký tự, tránh cửa sổ cuối quá ngắn; giữ ranh giới câu hỏi và các dấu hiệu đổi câu. Một nhóm có thể gồm nhiều phụ đề gốc nhưng vẫn là một đơn vị nói với 0.50s nghỉ sau đoạn. Câu đơn không thể fit vẫn báo lỗi.

## 5. Tệp thay đổi

- `src/main/dubbing/plan.ts`: grouping, ledger và validation.
- `src/main/dubbing/synthesis.ts`: preflight 8 đơn vị, caption nhiều chunk và sourceIndex gốc.
- `src/main/dubbing/subtitles.ts`: chia nhóm thành caption theo ranh giới từ, không bỏ text.
- `src/main/autoshort.ts`: gọi grouping sau applyDubbingTranslations, log số mảnh/đoạn.
- `tests/dubbing-grouping.test.ts`, `scripts/run-local-runtime-tests.mjs`: regression mới.
- `docs/adr/008-dubbing-fragments-to-speech-units.md`: quyết định và giới hạn.
- `.ai/tasks/2026-09-08-dubbing-group-live.ts`: harness toàn phần dubbing; lấy cấu hình profile bản sao, đọc video gốc để probe duration, dùng server/voice thật; giữ WAV/text/plan/SRT và kiểm tra sync theo production validator. Không chạy OCR/inpainting/render lại toàn bộ video.
- `.ai/tasks/2026-09-08-dubbing-group-verify.mjs`: probe lại WAV đã chấp nhận, kiểm tra tempo thực và khoảng nghỉ; tạo bản caption/plan riêng bằng code hiện tại để xác minh sửa `sourceIndex` sau khi harness live đã được bundle.

## 6. Kiểm chứng

- Log app gốc: `2026-09-08-dubbing-grouping-before.log`.
- RED: `2026-09-08-dubbing-grouping-red.log`, `2026-09-08-dubbing-grouping-tail-red.log`, `2026-09-08-dubbing-grouping-index-red.log`.
- Audit tất cả checkpoint: `2026-09-08-dubbing-group-audit.json` — gà 96→32, cua 108→41, bò 118→40, đá 56→31; 378 source ID được giữ, validator pass. Audit riêng giả định video dài hơn cue cuối 0.5s; live dùng duration probe thực.
- Live lần 1 là chẩn đoán chưa đạt: batch 24 timeout, gà cue đầu vẫn quá dài; cua qua cue thứ ba nhưng vấp câu “Not edible.” bị nhóm tham lam bỏ lẻ. Lượt này bị ngắt trước khi xong video bò. Các lỗi này dẫn đến partition toàn chuỗi và batch 8.
- Live lần 2 dùng code mới, tái dùng cache WAV trong thư mục evidence khi text/voice giống hệt; profile/cache thật không bị sửa. Tiến độ và kết quả tại `2026-09-08-dubbing-group-live2.stdout.log`, `2026-09-08-dubbing-group-live2.stderr.log`, `2026-09-08-dubbing-group-evidence2/report.json`.
- `npm.cmd run test:local-runtime`: 557 test pass trong 53 suite, không fail/skip, log `2026-09-08-dubbing-grouping-all-tests.log`.
- `npm.cmd run typecheck` và `npm.cmd run build`: exit 0, log `2026-09-08-dubbing-grouping-typecheck.log` và `2026-09-08-dubbing-grouping-build.log`.
- Gà đã hoàn tất 96 cue nguồn/32 đơn vị. Probe lại WAV: tempo tối đa 1.4117559x, khoảng nghỉ ngắn nhất 0.513515s; 50 subtitle chunk với sourceIndex đã cập nhật. Cua đã qua `cue-2-5530`, đang tiếp tục các đoạn sau.
- Audit cấu hình thật ở `2026-09-08-dubbing-profile-audit/profile-audit.json`: model không dùng named voice, profile key `62163da13be0f40fd91af93d0abe3bc347833dc9059e59f629bce51e3188a154` có 268 mẫu. Live lần 2 khởi tạo predictor mới để kiểm tra bootstrap; đây là khác biệt với lần chạy trong app. Predictor chỉ chọn preflight/nhịp ưu tiên, không thay trần fit theo WAV thực. Không xóa/reset profile người dùng để làm test pass.
- Cua đã hoàn tất 108 cue/41 đơn vị; probe WAV: max 1.4108188x, gap min 0.510975s; 59 subtitle chunk. Bò đã qua cue đầu, đang tiếp tục.
- Review độc lập phát hiện so sánh `1.7 - 1.1 >= 0.6` bị sai số nhị phân. RED `2026-09-08-dubbing-grouping-pause-red.log` tái hiện; epsilon 1e-9 giây và test 600ms/599ms xác nhận GREEN ở `2026-09-08-dubbing-grouping-pause-green.log`. Audit cả bốn checkpoint sau sửa giống hệt trước sửa, không làm stale cách gom nhóm trong live lần 2. Typecheck/build cuối sẽ chạy lại sau review.
- Review hoàn tất: cả lỗi dấu hỏi Arabic và sourceIndex SRT sau lọc/sort đã tái hiện RED rồi sửa GREEN. Reviewer chạy độc lập 11/11 test, không còn phát hiện chưa xử lý; xem `2026-09-08-dubbing-grouping-review.md`.
- Kiểm chứng code cuối sau review: **560/560 test, 53 suite**, `npm.cmd run typecheck` và `npm.cmd run build` exit 0. Log `2026-09-08-dubbing-grouping-final-tests.log`, `2026-09-08-dubbing-grouping-final-typecheck.log`, `2026-09-08-dubbing-grouping-final-build.log`. `git diff --check` pass. Verifier đối chiếu lại cách gom nhóm bằng code cuối và probe WAV gà/cua đều pass; metadata/caption mới ở `2026-09-08-dubbing-group-evidence2/verified/`.
- Live lần 2 hoàn tất với gà/cua pass, bò dừng `cue-52-82640`: cửa sổ 0.900s, audio 1.425397s, LLM trả nguyên câu hai lần và `Can you eat this cow?` 1.348934s (1.499x). Đá dừng `cue-8-22980`: cửa sổ 1.860s, audio tốt nhất 2.760181s (1.484x). Đây là câu hỏi riêng lẻ, không gom qua ranh giới để né lỗi.
- Bổ sung `compactEnglishDubbingQuestion` (translation.ts) và đưa các câu hỏi khẩu ngữ ngắn vào pool rescue (synthesis.ts), chỉ khi audio vượt trần. Mẫu `Is this cow edible?` → `This cow edible?` giữ mọi từ nội dung, vẫn hỏi; giới hạn một câu <=10 từ, locale en. Cả câu gốc và phương án LLM có thể được rút gọn theo cùng mẫu. Phương án rút gọn đứng trước khi predictor hòa điểm, nhưng toàn bộ pool vẫn chỉ thử tối đa ba audio và một request LLM. Regression tại `translation-rephrase.test.ts`: lỗi 1.499x RED rồi GREEN, locale/negation/numbers/question guards và budget pool bốn phương án vẫn ba audio. Log `2026-09-08-dubbing-question-red.log`, `2026-09-08-dubbing-question-green.log`, `2026-09-08-dubbing-question-budget-tests.log`.
- Review độc lập fallback xác nhận không tăng budget/trần, không áp dụng ngoài locale en hoặc khi audio đã dưới trần. Cần kiểm chứng giọng thật. Live lần 3 chạy lại cả bốn video, dùng cache WAV khớp text/voice; replay response LLM lần 2 chỉ khi toàn bộ JSON request khớp, ghi rõ `replayed` trong evidence. Các request khác và audio mới gọi server thật. Tiến độ `2026-09-08-dubbing-group-live3.stdout.log`; evidence `2026-09-08-dubbing-group-evidence3/`. Kiểm chứng 560 test/build phía trên là trước bổ sung fallback; phải chạy lại khi kết thúc.
- Code sau fallback: **563/563 test trong 53 suite**, typecheck/build exit 0. Log `2026-09-08-dubbing-question-final-tests.log`, `2026-09-08-dubbing-question-final-typecheck.log`, `2026-09-08-dubbing-question-final-build.log`.
- Live lần 3 đã chạy hết lại gà/cua: max tempo thực 1.3855008x/1.4108188x, khoảng nghỉ min 0.514150s/0.510975s. Bò đã qua `cue-52-82640` bằng WAV mới `This cow edible?` dài 1.274218s (dưới hard max tự nhiên 1.305s), vẫn giữ cow và ý hỏi; đang chạy các đoạn sau. Verifier evidence3 đối chiếu code hiện tại và đo lại WAV gà/cua pass.
- Lần 3 hoàn tất bò: 118 nguồn/40 đơn vị, 68 caption, tempo thực max 1.4412160x, gap min 0.513016s, WAV/timeline/current-code grouping validation pass. Ba video hoàn tất nằm trong evidence3. Tiến trình lượt 3 biến mất giữa video đá sau 6/31 đoạn, không có kết quả cuối/exception trong stderr; không xác định nguyên nhân process bị dừng. Lần 4 tiếp tục riêng đá tại `2026-09-08-dubbing-group-evidence4`, replay exact request từ evidence3 và WAV cache dùng chung, log `2026-09-08-dubbing-group-live4.stdout.log`.
- App đã restart: launcher 20256, main 16440, renderer 19692; cửa sổ TediaPros responding, URL `http://localhost:5173/` HTTP 200, renderer `--app-path` đúng worktree. Evidence `2026-09-08-dubbing-grouping-activation.json` (08:27:20 +07), stdout/stderr `2026-09-08-dubbing-grouping-dev.*.log`. Lỗi còn hiển thị trong hàng đợi là kết quả lưu của lượt trước; không xóa lịch sử/cache người dùng. Đây là xác nhận process/window/URL, chưa phải quan sát native UI bằng ảnh hoặc render đầy đủ.

## 7. Bàn giao

### Kết quả cuối

| Video | Cue nguồn | Đơn vị thoại | Caption | Tempo thực lớn nhất | Khoảng nghỉ nhỏ nhất |
|---|---:|---:|---:|---:|---:|
| Gà | 96 | 32 | 50 | 1.385501x | 0.514150s |
| Cua | 108 | 41 | 59 | 1.410819x | 0.510975s |
| Bò | 118 | 40 | 68 | 1.441216x | 0.513016s |
| Đá | 56 | 31 | 45 | 1.424133x | 0.511088s |

Tổng 378 cue nguồn, 144 đơn vị, 222 caption. Toàn bộ WAV đã chấp nhận được probe lại; current-code grouping/ledger, giới hạn audio, khoảng nghỉ, subtitle và production timeline validator đều pass. Bằng chứng ba video đầu ở evidence3/verified, đá ở evidence4/verified. `2026-09-08-dubbing-grouping-final-summary.json` tổng hợp kết quả. Tất cả live helper đã dừng; app main 16440 vẫn responding, HTTP 200 tại 08:38 +07. Bản cuối có 563/563 test (53 suite), typecheck/build pass.

App đang dùng worktree sửa. Trong UI bấm **Bắt đầu chạy Auto Short** để chạy lại hàng đợi; các nhãn lỗi lưu của lượt trước không tự biến thành thành công chỉ vì app restart. Không cần xóa cache dịch để nhận sửa grouping; grouping chạy sau map bản dịch và cửa sổ nói được tính lại.

Chưa khẳng định chất lượng dịch/giọng hoặc render đầy đủ từ kiểm thử timing. Subtitle chunk dùng phân bổ thời gian theo text, không căn từng từ. Một số phương án LLM như `Edible?` hoặc lỗi tên do ASR vẫn tồn tại; timing/ledger validator không phải bộ xác minh ngữ nghĩa. Test dùng predictor mới mỗi video, còn app có profile 268 mẫu: candidate/nhịp ưu tiên có thể khác; trần cuối vẫn kiểm tra bằng WAV thực. Không reset profile để làm test pass. Chưa merge vào main hoặc đóng gói installer.

Dọn thư mục profile tạm của lượt live 1 bị ngắt tại `C:/Users/PC/AppData/Local/Temp/tedia-rephrase-live-vvrc23` bị automatic approval review từ chối, công cụ chỉ trả `blocked by policy`. Không thử né chặn bằng công cụ khác. Thư mục này còn bản sao cấu hình phục vụ test; không đưa nội dung credential vào báo cáo. Các lượt kết thúc bình thường có cleanup riêng trong launcher.
