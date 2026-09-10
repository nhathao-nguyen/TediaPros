# OCR-GPU-MERGE: Sửa lỗi kiểm thử và tích hợp OCR GPU vào main cục bộ

- **Trạng thái:** Hoàn thành — đã kiểm tra và merge main cục bộ
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-10

## 1. Mục Tiêu (Goal)

Theo yêu cầu người dùng: tìm nguyên nhân 14 lỗi test đã chặn merge, sửa lỗi rồi
commit riêng thay đổi liên quan và merge vào `main` cục bộ. Không push GitHub.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Tái hiện 12 lỗi `dubbing-plan.test` và 2 lỗi `translation-rephrase.test`.
- [x] Đối chiếu main nguyên trạng và lịch sử để xác định nguyên nhân.
- [x] Sửa đúng fixture/contract, giữ kiểm tra overflow, rescue và trần 1.80x.
- [x] Typecheck, toàn bộ local-runtime và Python OCR đạt; kiểm tra native riêng.
- [x] Kiểm tra riêng cây sẽ commit, không phụ thuộc thay đổi dirty ngoài scope.
- [x] Commit và merge main cục bộ, không push, bảo toàn thay đổi ngoài scope.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **In Scope:** OCR GPU đã triển khai, hai bộ test dubbing/rephrase đang lỗi,
  tài liệu giải thích hợp đồng thời gian và bằng chứng kiểm tra/merge.
- **Out of Scope:** thay đổi SEO/UI/dịch đang dirty, tăng tempo, thay đổi scheduler,
  cài runtime dev, rebuild/release installer, publish/remote CI, chạy lại batch thật.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- `f20ddc6` sửa `dubbingSpeakingDurations()` để tái sử dụng cửa sổ đã tính bởi
  `deriveDubbingWindow()`, bỏ phép reserve 0.50s lần thứ hai. Câu cuối dùng
  guard EOF 0.12s; không có cue tiếp theo nên không cần reserve inter-cue 0.50s.
- Các fixture vẫn giả định EOF 0.50s, nên cửa sổ thật rộng hơn 0.38s: audio
  giả lập vốn dùng để kiểm tra overflow lại vừa. Một số assert nằm trong adapter
  bị bắt như provider error, khiến lỗi quan sát được ở finalization thay vì tại
  assertion. Không phải lỗi GPU và không phải lý do để tăng tempo hoặc retry.
- Sửa thời lượng video fixture để giữ nguyên cửa sổ overflow đã tính tay;
  không hạ yêu cầu rephrase/candidate-count/identity/no-DSP/tempo. Request timing
  cuối video được kiểm tra theo 1.47s = 5 - 0.12 - 3.41, thay cho 1.09s cũ.
- Thêm kiểm tra cửa sổ câu cuối và trường hợp WAV 2.84s vừa trong 1.80s mà không
  rephrase. Giữ nguyên thuật toán runtime đã được sửa, protected gap và source ledger.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `tests/dubbing-plan.test.ts`: sửa fixture và thêm regression cửa sổ EOF.
- `tests/translation-rephrase.test.ts`: fixture rescue và expected EOF budget.
- `docs/adr/005-source-anchored-dubbing-tempo-policy.md`: làm rõ EOF vs inter-cue gap.
- Task handoff này; OCR GPU được liệt kê trong `2026-09-10-ocr-gpu-activation.md`.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

- Main ban đầu: `b02c4a52f80dda8d138794fb2462b4202852eeb9`, cùng HEAD nhánh
  `codex/measured-dubbing-first`; index rỗng, 28 file tracked dirty đã ghi SHA-256.
- RED: `node scripts/run-local-runtime-tests.mjs dubbing-plan.test translation-rephrase.test`
  với private clean `TEDIAPROS_TEST_USER_DATA`: 61 tests, 47 pass, 14 fail.
- Baseline main đã tái hiện cùng 14 lỗi, trước khi sửa fixture. `typecheck` và
  46 Python OCR tests đã pass ở lượt preflight trước; phải chạy lại trước merge.
- Log cục bộ: `.runner-staging/ocr-gpu-runtime-20260910/fix-red-tests.log`;
  staging, runtime/model/binary và user profile không đưa vào Git.

### Kết quả trước commit

| Phạm vi | Kết quả |
| --- | --- |
| Hai bộ test đã sửa | 63/63 pass, gồm 2 ca EOF mới |
| Workspace hiện tại (có dirty ngoài scope) | 698 pass / 0 fail / 1 skip, tổng 699 |
| Bản sao sạch HEAD + đúng file sẽ commit | 683/683 pass, 0 fail / 0 skip |
| Main sau merge, có đủ fixture retime | 699/699 pass, 0 fail / 0 skip |
| Typecheck node + web | Pass cả workspace lẫn bản sao sạch |
| Python OCR trong môi trường pinned, model/wheel offline | 46/46 pass cả hai bản |
| Native FFmpeg: retime, mask, OCR burn/pipeline | 29/29 pass cả hai bản |
| Mutation check hai ca EOF | Code hiện tại: 2 pass; mô phỏng reserve thừa: 2 fail |

Hai bộ full suite khác tổng số test vì bản sao sạch không chứa các thay đổi
SEO/UI/content-quality đang dirty của task khác. Không cộng số lần chạy lặp thành
số test độc lập. Lượt workspace bỏ qua fixture retime khi chưa đặt biến FFmpeg;
ca đó đã chạy thật trong lượt native và full suite của bản sao sạch.

Lệnh kiểm tra trên từng root:

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime
node scripts/run-local-runtime-tests.mjs dubbing-retime.test ocr-mask.test autoshort-ocr-burn.test autoshort-ocr-pipeline.test
& <ocr-build-venv>/Scripts/python.exe -X utf8 -B -m unittest discover -s engines/ocr-engine/tests -p test_*.py -v
git diff --check
```

- `TEDIAPROS_TEST_USER_DATA`: private clean profile cho full suite, private
  native profile cho nhóm FFmpeg; không dùng user profile thật.
- `TEDIAPROS_RETIME_TEST_FFMPEG` / `TEDIAPROS_RETIME_TEST_FFPROBE`: cặp thật tại
  `.runner-staging/ocr-gpu-lab-20260909-v1/native-test-userdata/bin/ffmpeg/`.
- `TEDIAPROS_OCR_MODELS_DIR` và `TEDIAPROS_TEST_OCR_WHEEL`: model/wheel đã ghim
  trong staging runtime riêng, không tải mạng trong tests.
- Lượt candidate đầu tiên nhập nhầm path FFmpeg (thiếu thư mục `ffmpeg/`),
  một test báo ENOENT. Đã xác minh path bằng filesystem và chạy lại **toàn bộ**
  suite thành công; không sửa code để che lỗi cấu hình harness.
- Log cuối: `fix-green-tests.log`, `candidate-full-tests-final.log`,
  `candidate-typecheck.log`, `candidate-python-tests.log`, `candidate-native-tests.log`,
  `fix-eof-control.log`, `fix-eof-mutated.log` trong staging runtime riêng.
- Bản sao sạch tạo từ `git archive HEAD` + allowlist file, không chép các code dirty
  ngoài scope. SHA-256 của toàn bộ 28 file tracked dirty ban đầu không thay đổi.
- Main agent đã review diff/fixture/provider/model/build-boundary; không có kết quả
  independent production review (lượt trước bị quota), không coi lab review là
  production review. Chưa chạy remote CI hay nghiệm thu lại batch TTS thật.

### Tích hợp Git

- Commit mã và evidence: `791e8d6` — `feat(ocr): enable DirectML GPU runtime and align dubbing fixtures`.
- `main` đã fast-forward từ `b02c4a5` đến `791e8d6`, không conflict. Nhánh
  `codex/measured-dubbing-first` được giữ lại. Không fetch/pull/push GitHub.
- 37 file được stage theo allowlist. Mỗi Git blob khớp bản sao đã test sau
  chuẩn hoá line ending. Không stage model, EXE, venv hay dữ liệu user profile.
- Riêng log native mask lịch sử (16 dòng) đã đọc và kiểm tra trước khi stage
  explicit để liên kết evidence trong báo cáo lab không bị thiếu.
- 21 file tracked dirty ngoài scope vẫn nguyên SHA-256 sau merge, index rỗng.
  Không stash/reset/clean hay ghi đè thay đổi SEO/UI/translation của task khác.
- Typecheck node + web và full suite trên main sau merge đã pass:
  **699/699**, không fail/skip. Logs: `postmerge-typecheck.log` và
  `postmerge-full-tests.log`. Bản ghi bàn giao này được commit riêng; không có
  thay đổi code sau lượt kiểm tra cuối.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Đã đạt GREEN, regression/mutation check và kiểm tra cây commit độc lập.
Code đã commit và fast-forward main cục bộ; không push.
Không khẳng định app dev hoặc installer đã cập nhật chỉ từ việc merge source code.
Không thay runtime trong lượt sửa test/merge này: bản dev vẫn cần bước cài runtime
riêng nếu người dùng yêu cầu. Không coi kết quả offline là nghiệm thu batch TTS thật.
