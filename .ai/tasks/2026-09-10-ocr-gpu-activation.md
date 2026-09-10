# OCR-GPU-121: Đổi AutoShort OCR sang GPU, có CPU dự phòng

- **Trạng thái:** Hoàn thành — đã cài và xác minh một lượt OCR GPU thật từ app đang mở.
- **Người thực hiện:** Codex; reviewer độc lập bị quota, không trả assessment.
- **Thời gian:** 2026-09-10

## 1. Mục Tiêu (Goal)

Theo yêu cầu “Giup toi doi sang gpu”, tích hợp phương án đã thử A/B vào OCR
production và cài runtime mới cho AutoShort trên máy này, không làm gián đoạn batch.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Runtime 1.2.1 mặc định DML cả det/cls/rec, có CPU fallback lúc khởi tạo.
- [x] Model cũ được ghim SHA và đóng gói offline cùng giấy phép.
- [x] Không đổi 8 fps/ROI/mask/scheduler/TTS, không sửa dirty work ngoài phạm vi.
- [x] `npm.cmd run typecheck` pass node + web.
- [x] 46 Python tests và 98 TypeScript tests liên quan pass.
- [x] EXE GPU/CPU thật xuất SRT, 26 frame mask và MP4 tương đương.
- [x] Hủy, lỗi có chủ đích, chạy lại; trả resource lease và dọn child.
- [x] Cài canonical runtime, giữ backup và cập nhật riêng entry OCR trong receipt.
- [x] Probe sau cài xác nhận 1.2.1, ready:true và cả ba provider DML.
- [x] App không restart/kill, tự spawn runtime mới từ parent đang chạy.
- [x] Lượt OCR thật đầu tiên hoàn tất: timeline mới ghi det/cls/rec DML, 1.017
  khung hình, 1.003 đoạn chữ / 1.013 hộp; không khẳng định toàn bộ batch hoàn thành.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **In Scope:** Python OCR adapter/CLI/model/build lock/spec, Windows workflow OCR,
  runtime input version/fingerprint, tests, tài liệu, cài runtime cục bộ.
- **Out of Scope:** Renderer, hàng đợi/scheduler, cache policy, TTS/translation,
  tempo, fix lỗi dubbing, commit/push/publish hoặc remote CI, macOS qualification.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- RapidOCR 1.4.4 + ORT DirectML 1.24.4, Python 3.12 riêng; cài lock `--no-deps`
  để generic dependency `onnxruntime` không đè DLL DirectML.
- Model det/rec PP-OCRv3 và cls mobile v2 từ wheel 1.2.3 checksum-pinned; giữ
  chuẩn hoá detector đã xác minh A/B. Không tải model trong inference.
- Khởi tạo session dưới lock, tắt memory pattern và đặt ORT_SEQUENTIAL. Chỉ
  report provider từ session thật. Native error giữa item không silently fallback.
- Đợi OCR cũ kết thúc, staging cùng ổ, SHA toàn cây, hai rename 7,1 ms và receipt
  replace có backup. Không restart app vì đang chạy batch. Backup CPU không bị xóa.
- Sửa `done.version` vì main fallback 1.1.0 khi thiếu field; đã có test RED→GREEN.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `engines/ocr-engine/engine.py`, `requirements.txt`, `ocr-engine.spec`.
- `[NEW]` `engines/ocr-engine/ocr_models.py`, `prepare_models.py`, `README.md`,
  `RapidOCR-LICENSE.txt`, `tests/test_ocr_provider.py`, `tests/test_model_preparation.py`.
- `[MODIFY]` `engines/ocr-engine/tests/test_engine_cli.py`.
- `[MODIFY]` `.github/workflows/build-windows-runtime.yml` (chỉ OCR step).
- `[MODIFY]` `distribution/runtime-inputs.json` (OCR), `tests/release-tooling.test.ts` (version).
- `[NEW]` `docs/reviews/2026-09-10-ocr-gpu-activation/` và task handoff này.
- `[LOCAL GENERATED]` `.runner-staging/ocr-gpu-runtime-20260910/`: isolated venv,
  build artifacts, native harness, qualification/install scripts và logs.
- `[LOCAL INSTALLED]` `%APPDATA%/tedia-pros/bin/ocr-engine`, receipt OCR entry;
  backup 1.2.0 và receipt giữ riêng. Không stage/commit bất kỳ file nào.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Các lệnh đã chạy từ root repo:

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-ocr-pipeline.test autoshort-ocr-runtime.test autoshort-ocr-contract.test ocr-visual-timeline.test ocr-mask.test autoshort-ocr-burn.test autoshort-resource-manager.test release-tooling.test
& .runner-staging/ocr-gpu-runtime-20260910/venv/Scripts/python.exe -X utf8 -B -m unittest discover -s engines/ocr-engine/tests -p test_*.py -v
node .runner-staging/ocr-gpu-runtime-20260910/qualify.mjs
& .runner-staging/ocr-gpu-runtime-20260910/install-runtime.ps1 -Mode stage
& .runner-staging/ocr-gpu-runtime-20260910/install-runtime.ps1 -Mode activate
git diff --check
```

Tests Python dùng `TEDIAPROS_OCR_MODELS_DIR` đã chuẩn bị và
`TEDIAPROS_TEST_OCR_WHEEL` trỏ offline wheel; tests TS dùng
`TEDIAPROS_TEST_USER_DATA` là private fixture có FFmpeg canonical, không profile thật.

- 46/46 Python, 98/98 TS, typecheck PASS, native GPU/CPU PASS.
- EXE SHA `fc91f85653d6bd84819338d420dcd08aa646d5fe1867d2dfcddde658a98eb4da`.
- SRT SHA `1e5a4a81f0ab15bce99bce250af847af453d7b5b4c57a51db17557ba72bbd611`.
- MP4 SHA `e7db04b062fc900a5524fc3cfa5f9829e08873d7a9f4efddd2bf5371c9fcb395`.
- Bằng chứng, scope boundaries và ghi nhận test/harness lỗi ban đầu ở
  [báo cáo kích hoạt](../../docs/reviews/2026-09-10-ocr-gpu-activation/README.md).

**Chưa kiểm tra / rủi ro:** remote release/CI và macOS chưa chạy; chưa nghiệm thu
toàn bộ batch dịch/TTS/render. Independent review không hoàn thành do quota.
Giữ cơ chế watchdog và CPU-init fallback; không cam kết mọi lỗi driver đều hồi phục.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- AutoShort tiếp tục gọi canonical runtime mới cho mỗi lượt OCR mới, không cần
  người dùng restart. Cue/cache đã xong không tự chạy lại.
- CPU backup: `%APPDATA%/tedia-pros/bin/ocr-engine.cpu-1.2.0-backup-20260910`.
- Không tự sửa lỗi dubbing riêng: video trước báo cue-47-76620 vượt thời lượng
  sau tempo lúc 08:36:46, OCR video đó đã xong trên CPU trước lúc cài GPU.
- Giữ nguyên mọi file dirty của user và backup 1.1.0 cũ; không dọn staging rộng.
