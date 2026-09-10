# OCR-GPU-LAB-20260910: Thử CPU/GPU OCR cô lập trên video thật

- **Trạng thái:** Đã kiểm chứng; hoàn thành spike, chưa tích hợp/phát hành.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-10 (Asia/Saigon)

## 1. Mục tiêu

Tiếp tục bước thử nghiệm người dùng đã đồng ý: build GPU OCR riêng, đo CPU/GPU
cùng video qua OCR → timed mask → render, kiểm tra parity/tài nguyên/hủy/lỗi;
không tác động hàng đợi hoặc runtime thật.

## 2. Tiêu chuẩn nghiệm thu

- [x] Runtime lab có provider thật cho det/cls/rec, có inference profiling.
- [x] CPU/GPU A/B lần lượt, cùng model/input/dependency/8fps/ROI, không cache.
- [x] Đối chiếu SRT/timeline/mask, output hash, metadata và decode toàn video.
- [x] Thử hủy/lỗi/rerun, kiểm tra lease/PID/output/scratch.
- [x] Typecheck và tests liên quan pass; native mask không chỉ skip fixture.
- [x] Xác nhận managed executable chưa thay đổi và vẫn `gpu:false`.
- [x] Báo cáo giới hạn; không biến spike thành triển khai production.

## 3. Phạm vi

- In scope: `.runner-staging/ocr-gpu-lab-20260909-v1`, báo cáo/evidence/handoff.
- Out of scope: source sản phẩm, installed runtime/receipt, scheduler, cache,
  queue đang chạy, dịch/TTS/separation/title, stress driver/VRAM/90-item batch.
- Checkout bẩn có nhiều thay đổi sẵn; không stage, revert hoặc commit chúng.

## 4. Quyết định và lý do

- Spike cô lập theo bước đã duyệt; bản sao engine/venv/user-data/output riêng.
- Python 3.12.14, RapidOCR 1.4.4 và ORT DirectML 1.24.4; ép provider khác nhau
  nhưng giữ nguyên model. Không cài thư viện vào Python/global runtime sản phẩm.
- GPU runtime thử không fallback âm thầm; lỗi chọn provider phải fail để phép
  đo không nhầm CPU thành GPU. Chưa thiết kế chính sách recovery sản phẩm.
- Giữ 1 item / 1 GPU-heavy lane, không đồng thời thay đổi scheduler.
- Các skill debugging/TDD dẫn đến test red/green cho reporting/provider trong
  bản sao; verification-before-completion dẫn đến rerun assertion native với
  fixture thật và xác minh managed runtime bằng version/probe/hash.

## 5. Tệp thay đổi

- [NEW] `docs/reviews/2026-09-10-ocr-gpu-lab/README.md`, `PROTOCOL.md`, `evidence/*`.
- [NEW] `.runner-staging/ocr-gpu-lab-20260909-v1/*`: source copy, venv, build,
  packaged lab runtime, harness/tests, input/output/evidence. Không phải release.
- [NEW] `.ai/tasks/2026-09-10-ocr-gpu-isolated-lab.md`.
- Không sửa file production trong task; các tracked modifications khác thuộc
  công việc đã có trước.

## 6. Kiểm chứng

Các entrypoint đã chạy từ repo root:

```powershell
node .runner-staging/ocr-gpu-lab-20260909-v1/build-runner.mjs
# monitor.py: cpu-full-c; dml-full-c; dml-cancel-e cancel;
# invalid-fail-e fail; dml-after-cancel-e smoke
node .runner-staging/ocr-gpu-lab-20260909-v1/compare.mjs cpu-full-c dml-full-c
node .runner-staging/ocr-gpu-lab-20260909-v1/postflight.mjs
node .runner-staging/ocr-gpu-lab-20260909-v1/validate-media.mjs
node .runner-staging/ocr-gpu-lab-20260909-v1/verify.mjs
```

`verify.mjs` chạy `npm.cmd run typecheck`, 32 OCR Python tests, 4 lab tests,
45 local-runtime tests, native mask rerun 6 tests với canonical fixture riêng,
và `git diff --check`: tất cả exit 0.

Kết quả: OCR **600.833 → 197.231 s (3.046×)**; tổng ba bước
**694.688 → 286.488 s (2.425×; -58.76%)**. CPU trung bình nội stage OCR
**56.40 → 12.62%**. SRT và mọi khung mask giống nhau; hai MP4 cùng SHA-256,
decode không lỗi. Cancel settle 232.387 ms, 0 allocation/PID còn sót, rerun PASS.

Giới hạn: baseline CPU lab khác dependency của binary đang cài; chỉ một cặp
full run trên một video, không translation/TTS; parity không chứng minh OCR
đúng ground truth (có lỗi nhận chữ giống nhau ở 35 s). Không thử UI/driver hang
hoặc queue thật nhiều item. Các lỗi harness ban đầu được ghi trong PROTOCOL.

Rà soát độc lập đọc report/evidence/harness: không có blocker bàn giao lab.
Hai lưu ý P3 về đỉnh tài nguyên trong cửa sổ lấy mẫu và overhead lưu bằng chứng
đã được main agent đối chiếu code, bổ sung vào report/protocol. Không đổi số đo.

## 7. Bàn giao

Đọc `docs/reviews/2026-09-10-ocr-gpu-lab/README.md`. Không copy runtime lab vào
`%APPDATA%/tedia-pros/bin/ocr-engine`. Managed exe còn nguyên hash 7ac0d6fe…190f781,
probe 1.2.0 / ready true / gpu false. Bước tích hợp, packaging/cache identity/
fallback/rollback và pilot production cần người dùng cho phép riêng.
