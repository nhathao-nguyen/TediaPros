# TASK-20260917-gemini-web-throttling-circuit-breaker: Xử Lý Chặn/Throttling Gemini Web, Circuit Breaker Cho AutoShort & Preflight

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Antigravity AI
- **Thời gian:** 2026-09-17

---

## 1. Mục Tiêu (Goal)

Khắc phục triệt để sự cố Google Gemini Web chặn/giới hạn tần suất (HTTP 405 robot HTML / 429 rate limit) khi chạy batch nhiều video trong AutoShort:
1. Thêm khoảng giãn cách tự nhiên (Pacing / Spacing) giữa các lượt gọi dịch.
2. Tự động tạm dừng Cooldown (45s) và thử lại 1 lần khi gặp 405/429 thay vì làm hỏng video ngay lập tức.
3. Kích hoạt Circuit Breaker trong Queue Runner để ngắt mạch tạm dừng batch sau 2 lỗi liên tiếp, tránh lãng phí Whisper ASR trên hàng chục video tiếp theo.
4. Bổ sung Generation Preflight trước batch để phát hiện sớm lệnh chặn từ Google.
5. Chuẩn hóa phân loại lỗi `provider-throttled` và thông báo lỗi UI.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Test cases liên quan pass kèm bằng chứng log (`autoshort-queue-throughput.test`, `gemini-gateway-contract.test`, `local-runtime.test`).
- [x] Giãn cách tối thiểu 3s giữa các request Gateway (tự động bypass trong test).
- [x] Tự động cooldown 45s và retry lần 2 khi nhận `provider-throttled`.
- [x] Circuit breaker dừng hàng đợi sau 2 lỗi provider liên tiếp.
- [x] Checkpoint ASR và dịch được bảo toàn, resume không chạy lại ASR.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - `src/shared/translation.ts`: Bổ sung mã lỗi `provider-throttled`.
  - `src/shared/types.ts`: Bổ sung `provider-throttled` vào `recovery.kind`.
  - `src/main/translation/checkpoint.ts` & `src/main/autoShortItemCoordinator.ts`: Cập nhật bộ hợp lệ mã lỗi checkpoint.
  - `src/main/translation/budget.ts`: Nhận diện `provider-throttled` trong `classifyTranslationError`.
  - `src/main/geminiGateway.ts`: `enforceGatewaySpacing`, `waitForGatewayCooldown`, `providerError` cải tiến, `probeGeminiGatewayGeneration`, cấu hình scheduler cho test.
  - `src/main/autoShortQueueRunner.ts`: Bộ ngắt mạch Circuit Breaker khi lỗi throttled liên tiếp.
  - `src/main/autoshort.ts`: Tích hợp `probeGeminiGatewayGeneration` vào `preflight()` và cấu hình circuit breaker trong `executeJob()`.
  - `tests/autoshort-queue-throughput.test.ts`: Thêm test case xác minh Circuit Breaker.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Sửa đổi CreateMediaTool (Go gateway nằm ngoài workspace TediaPros).

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Áp dụng Spacing 3.0s ở tầng client `requestGateway` và Backoff Cooldown 45s trước khi fail item.
- *Lý do:* Google anti-bot hoạt động dựa trên phát hiện burst requests. Giãn cách 3s mô phỏng hành vi tự nhiên, còn 45s là thời gian đủ để Google giải phóng rate-limit bucket tạm thời.
- *Lựa chọn:* Ngắt mạch sau 2 lỗi liên tiếp ở cấp Queue Runner thay vì từng item độc lập.
- *Lý do:* Giữ an toàn cho toàn bộ batch 50–100 video, không để các video sau tiếp tục tốn thời gian chạy Whisper ASR khi provider dịch đang bị block.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` [src/shared/translation.ts](file:///f:/Son/tool/TediaPros/src/shared/translation.ts)
- `[MODIFY]` [src/shared/types.ts](file:///f:/Son/tool/TediaPros/src/shared/types.ts)
- `[MODIFY]` [src/main/translation/checkpoint.ts](file:///f:/Son/tool/TediaPros/src/main/translation/checkpoint.ts)
- `[MODIFY]` [src/main/translation/budget.ts](file:///f:/Son/tool/TediaPros/src/main/translation/budget.ts)
- `[MODIFY]` [src/main/geminiGateway.ts](file:///f:/Son/tool/TediaPros/src/main/geminiGateway.ts)
- `[MODIFY]` [src/main/autoShortItemCoordinator.ts](file:///f:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts)
- `[MODIFY]` [src/main/autoShortQueueRunner.ts](file:///f:/Son/tool/TediaPros/src/main/autoShortQueueRunner.ts)
- `[MODIFY]` [src/main/autoshort.ts](file:///f:/Son/tool/TediaPros/src/main/autoshort.ts)
- `[MODIFY]` [tests/autoshort-queue-throughput.test.ts](file:///f:/Son/tool/TediaPros/tests/autoshort-queue-throughput.test.ts)

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:
```powershell
cmd.exe /c "npm run typecheck"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-queue-throughput.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs gemini-gateway-contract.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs local-runtime.test"
```

### Kết quả thực tế:
- `Typecheck`: PASS (0 errors node & web)
- `autoshort-queue-throughput.test`: PASS (7/7 tests passed)
- `gemini-gateway-contract.test`: PASS (19/19 tests passed)
- `local-runtime.test`: PASS (158/158 tests passed)

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Người dùng có thể bấm chạy lại các video bị lỗi bằng nút "Thử lại dịch" trên UI, hoặc khởi động batch mới.
- Hệ thống sẽ tự động giãn cách 3s và tự cooldown 45s nếu Google xuất hiện 405/429 trở lại.
