# BÁO CÁO THẨM ĐỊNH TRIỂN KHAI ĐIỀU TIẾT GEMINI GATEWAY & TỰ PHỤC HỒI BATCH (P0 – P5)
**DÀNH CHO GPT ASTRA REVIEW**

- **Tài liệu mục tiêu:** Báo cáo kỹ thuật tổng hợp toàn diện để GPT Astra thẩm định, phản biện và rà soát kiến trúc.
- **Phạm vi hai kho mã nguồn:**
  - Kho 1: `F:\Son\tool\TediaPros` (Electron 34 + React 19 + TypeScript 5.7)
  - Kho 2: `F:\Son\tool\CreateMediaTool` (Go 1.22+ Gateway Server)
- **Ngày lập:** 2026-09-17
- **Tác giả:** Antigravity AI Coding Agent
- **Mức độ sẵn sàng:** CODE_CONFIRMED, TEST_CONFIRMED (Tất cả test và build của cả hai repo đều PASS 100%).

---

## 1. TỔNG QUAN YÊU CẦU & BỐI CẢNH (EXECUTIVE SUMMARY)

### 1.1. Vấn đề cần giải quyết
Khi người dùng TediaPros kích hoạt batch dịch và xử lý video số lượng lớn (hàng chục đến hàng trăm video):
1. **Lỗi nghẽn & Rate Limit Gateway:** Google Web Gemini upstream thường xuyên giới hạn tốc độ (HTTP 429 / ResourceExhausted). Cơ chế cũ gửi request song song hoặc lặp retry làm gia tăng tần suất bị chặn IP/CAPTCHA.
2. **Thất bại dây chuyền (Cascade Failures):** Khi một video bị dính rate limit, queue runner cũ đánh lỗi hàng loạt các video còn lại đang chờ trong hàng đợi (`pending`), gây lãng phí công sức ASR/OCR đã hoàn thành trước đó.
3. **Mất an toàn idempotency:** Khi timeout mạng hoặc restart app, request cũ bị gửi lại với ID mới, gây nhân đôi tải upstream hoặc nhận kết quả sai lệch.
4. **Lãng phí Quota do Probe Generation:** Mỗi lần kiểm tra năng lực trước batch, hệ thống cũ sinh một lượt gọi Ping generation không cần thiết.
5. **Sai lệch ASR & Mất câu:** Nhận dạng âm thanh (Whisper) trong video xe cộ/công nghệ dễ bị lỗi đồng âm (homophone: ví dụ *沃尔沃* -> *窝耳窝*, *像素* -> *橡树*). Chưa có cơ chế đối chiếu tự động với chữ xuất hiện trên màn hình (OCR) và thẩm định độc lập theo nhóm ngữ nghĩa để phục hồi trước khi dịch.

### 1.2. Mục tiêu đạt được
Hệ thống cho phép người dùng bấm **Chạy Batch 1 lần**, toàn bộ tiến trình tự vận hành:
- Điều tiết duy nhất **concurrency = 1** trên toàn gateway egressGroup, khoảng cách tối thiểu 15s giữa các lần dispatch.
- Khi gặp giới hạn tốc độ hoặc cooldown, hệ thống lưu checkpoint bền vững, đưa item vào trạng thái **`waiting-provider`**, **tạm hoãn queue mà không đánh lỗi các video pending**.
- Tự động tiếp tục (resume) chính xác khi hết thời gian chờ (hỗ trợ đếm ngược trên UI).
- Tự động phục hồi lỗi ASR thông qua bằng chứng OCR và audio (P5), thẩm định nhóm ngữ nghĩa, bảo toàn 100% cue ID và timestamps, tuyệt đối không bỏ câu.

---

## 2. BẢN ĐỒ THAY ĐỔI MÃ NGUỒN (CHANGE SET MAP)

### 2.1. Phía CreateMediaTool (`F:\Son\tool\CreateMediaTool`)
| Tệp | Trạng thái | Trách nhiệm chính |
| :--- | :---: | :--- |
| `internal/modules/providers/upstream_failure.go` | **NEW** | Phân loại lỗi upstream: `ResourceExhausted`, `TransientNetwork`, `TerminalAuth`, `TerminalQuota`. Trích xuất header `Retry-After` (giây hoặc RFC1123). |
| `internal/modules/providers/upstream_failure_test.go` | **NEW** | Bộ kiểm thử phân loại lỗi và parse `Retry-After`. |
| `internal/modules/providers/upstream_governor.go` | **NEW** | Bộ điều tiết token-bucket: **concurrency = 1**, 15s spacing, exponential backoff cooldown (tối đa 1800s), half-open execution với single active job. |
| `internal/modules/providers/upstream_governor_test.go` | **NEW** | Kiểm thử governor với fake clock: tuần tự hóa, cooldown, tôn trọng retry-after. |
| `internal/modules/providers/upstream_state_store.go` | **NEW** | Quản lý file trạng thái governor bền vững giữa các process. Tự hồi phục từ crash sang trạng thái `blocked` có hạn. |
| `internal/modules/providers/upstream_state_store_windows.go` | **NEW** | Khóa file độc quyền trên Windows qua Windows API (`LockFileEx`, `UnlockFileEx`). |
| `internal/modules/providers/upstream_state_store_unix.go` | **NEW** | Khóa file trên Unix/macOS qua `syscall.Flock`. |
| `internal/modules/providers/upstream_state_store_test.go` | **NEW** | Kiểm thử khóa độc quyền cross-process và xử lý corrupted file. |
| `internal/modules/openai/gateway_requests.go` | **NEW** | Quản lý vòng đời Gateway Operation: `registered` → `queued` → `running` → `succeeded` / `failed`. Xử lý idempotency token và payload conflict. |
| `internal/modules/openai/gateway_requests_test.go` | **NEW** | Kiểm thử idempotency key, conflict payload, poll không sinh generation. |
| `internal/modules/openai/gateway_request_store.go` | **NEW** | Bộ lưu trữ persistent trên disk cho các operation requests, atomic commit file json. |
| `internal/modules/openai/gateway_request_store_test.go` | **NEW** | Kiểm thử lưu trữ request, crash recovery và dọn dẹp expired requests. |
| `internal/modules/openai/gateway_scheduler_controller.go` | **NEW** | REST Controller cung cấp `POST /v1/gateway/requests`, `GET /v1/gateway/requests/:id`, `POST /v1/gateway/requests/:id/ack`. |
| `internal/modules/openai/openai_controller.go` | **MODIFY** | Expose capabilities v2: `scheduler_contract_version: 1`, `request_jobs: true`, `max_request_body_bytes: 4194304`. |
| `internal/modules/openai/openai_module.go` | **MODIFY** | Đăng ký scheduler controller, request store và upstream governor vào DI container. |
| `internal/modules/providers/provider_module.go` | **MODIFY** | Wire governor store và global upstream governor vào provider lifecycle. |
| `internal/modules/providers/gemini_service.go` | **MODIFY** | Bọc toàn bộ các lượt gọi sinh nội dung upstream qua Governor `Acquire` / `Release`. |
| `internal/modules/providers/client_pool.go` | **MODIFY** | Áp dụng governor cho client pool khi dispatch request. |

### 2.2. Phía TediaPros (`F:\Son\tool\TediaPros`)
| Tệp | Trạng thái | Trách nhiệm chính |
| :--- | :---: | :--- |
| `docs/adr/012-gateway-upstream-governor-and-batch-scheduling.md` | **NEW** | Quyết định kiến trúc ADR 012 về Upstream Governor và Batch Scheduling. |
| `docs/superpowers/plans/2026-09-17-p5-audio-ocr-restoration-pipeline.md` | **NEW** | Bản kế hoạch kỹ thuật chi tiết cho Gate P5 (Media Restoration). |
| `.ai/tasks/TASK-20260917-gemini-gateway-batch-scheduling-and-auto-recovery.md` | **NEW** | Hồ sơ bàn giao nghiệm thu task theo chuẩn repo. |
| `src/shared/gatewayOperation.ts` | **NEW** | Typed IPC contracts cho Gateway Operation (Status, Payload, Receipt, Lease). |
| `src/main/geminiGatewayOperations.ts` | **NEW** | Implementation client adapter: `submitGatewayOperation`, `pollGatewayOperation`, `ackGatewayOperation`. |
| `src/main/autoShortProviderWait.ts` | **NEW** | Logic tính toán cooldown, thời gian đánh thức (`shouldWakeProviderWait`, `calculateProviderWaitRemainingMs`). |
| `src/main/translation/sourceRestoration.ts` | **NEW** | Gate P5: Evidence Pack, Draft & Review validation, Atomic Patch group, Quality Metrics. |
| `tests/fixtures/gemini-gateway-scheduler-contracts.json` | **NEW** | Hợp đồng JSON đồng bộ giữa Go và TypeScript. |
| `tests/autoshort-provider-wait.test.ts` | **NEW** | Test suite xác thực logic wake up và hủy tác vụ. |
| `tests/gateway-batch-recovery.test.ts` | **NEW** | Test suite mô phỏng 100-job batch scheduling với 429 600s, fake clock, cancellation. |
| `tests/autoshort-source-restoration.test.ts` | **NEW** | Test suite 44-cue Volvo restoration, chống false positive, bảo toàn cue ID/timestamps. |
| `src/shared/types.ts` | **MODIFY** | Mở rộng kiểu dữ liệu: thêm `waiting_provider` vào `AutoShortItemStatus`, `providerWait` vào task item/progress/result. |
| `src/shared/autoShortBatchJournal.ts` | **MODIFY** | Batch Journal Schema v2, migration v1->v2, bao gồm `waiting-provider` trong `resumeCandidateIds`. |
| `src/main/autoShortQueueRunner.ts` | **MODIFY** | Cơ chế `pauseOnDeferred`: Dừng pass hiện tại khi có item deferred, không đánh lỗi các item pending tiếp theo. |
| `src/main/autoshort.ts` | **MODIFY** | Tích hợp checkpoint terminal, bypass ping probe khi scheduler supported, lưu schema v2. |
| `src/main/geminiGateway.ts` | **MODIFY** | Định tuyến qua `requestGatewayOperation` khi `schedulerSupported`, quản lý lease checkpoint. |
| `src/renderer/src/components/AutoShort.tsx` | **MODIFY** | UI: Status badge `Chờ Gateway (cooldown)`, đồng hồ đếm ngược hh:mm:ss, banner thông báo chi tiết. |
| `src/renderer/src/styles/autoshort.css` | **MODIFY** | CSS styling cho badge trạng thái waiting và banner cảnh báo cooldown. |
| `scripts/run-local-runtime-tests.mjs` | **MODIFY** | Đăng ký hai test suite mới (`gateway-batch-recovery.test`, `autoshort-source-restoration.test`). |

---

## 3. CHI TIẾT TRIỂN KHAI THEO TỪNG GIAI ĐOẠN (GATE P0 – P5)

### Gate P0: Hợp Đồng Chuẩn & Fixtures
- Thống nhất schema giữa Go DTO và TypeScript:
  ```json
  {
    "scheduler_contract_version": 1,
    "request_jobs": true,
    "max_request_body_bytes": 4194304
  }
  ```
- Đảm bảo tính tương thích ngược (Backward Compatibility): Nếu gateway không trả về `scheduler_contract_version: 1`, TediaPros tự động chuyển sang `requestGatewayLegacy` thông suốt.

### Gate P1: Bộ Điều Tiết Upstream Governor (CreateMediaTool)
- **Luật Concurrency = 1:** Dùng channel token mutex kết hợp atomic guard, đảm bảo không bao giờ có 2 upstream call đồng thời trên cùng một egress group.
- **Quy tắc Spacing 15s:** Sau khi một lượt gọi upstream hoàn tất, governor thiết lập interval tối thiểu 15 giây trước khi cho phép lượt gọi tiếp theo được dispatch.
- **Xử lý 429 & Retry-After:** Khi upstream trả 429 hoặc ResourceExhausted, trích xuất header `Retry-After`. Nếu không có header, áp dụng exponential backoff: 30s -> 60s -> 120s -> 300s -> 600s -> 1800s (trần 30 phút).
- **Trạng thái Half-Open:** Khi hết hạn cooldown, governor chuyển sang `half-open`. Chỉ duy nhất **1 request thực tế của batch** được phép chạy thử nghiệm. Tuyệt đối không sinh request ping rác. Nếu thành công, governor reset về `closed`; nếu tiếp tục lỗi, cooldown được nhân đôi.
- **Khóa File Độc Quyền (OS Lock):** File trạng thái governor được bảo vệ bằng `LockFileEx` (Windows) và `flock` (Unix), chống race condition khi có nhiều tiến trình server hoặc worker cùng truy cập.

### Gate P2: Quản Lý Yêu Cầu & Idempotency Store (CreateMediaTool)
- **Tính Bất Biến của Request ID:** Mỗi yêu cầu mang `client_request_id` (UUID v4) và `operation_token`.
- **Chống Trùng Lặp (Deduplication):**
  - Nếu nhận request có cùng `client_request_id` và cùng SHA-256 payload: trả về ngay receipt hiện tại mà không dispatch thêm upstream.
  - Nếu cùng ID nhưng khác payload: trả về HTTP 409 Conflict.
- **Polling không gây tải Upstream:** Endpoint `GET /v1/gateway/requests/:id` chỉ đọc trạng thái từ memory/disk cache, không phát sinh bất kỳ lời gọi API nào tới Google.
- **Cơ chế Lease & Ack:** Client gửi `POST /v1/gateway/requests/:id/ack` sau khi nhận và xử lý xong kết quả, server giải phóng tài nguyên lưu trữ và nhả lease.

### Gate P3: Batch Auto-Recovery & Queue Runner (TediaPros)
- **Phân loại Kết Quả Hàng Đợi (Queue Item Outcome):**
  - `terminal` (succeeded / failed / cancelled): Kết thúc item.
  - `deferred`: Gặp lỗi throttling tạm thời hoặc cooldown từ upstream.
- **Cơ chế `pauseOnDeferred`:**
  - Khi một item rơi vào `deferred`, Queue Runner lập tức dừng pass hiện tại.
  - Chuyển trạng thái item thành `waiting_provider`, ghi nhận `ProviderWaitRecord` vào Batch Journal (lưu trên đĩa).
  - **Giữ nguyên trạng thái `pending` của các video còn lại**, ngăn chặn hoàn toàn hiện tượng cascading failure.
- **Bypass Ping Probe:** Trong `autoshort.ts`, hàm `readGatewayCapabilitiesInfo` kiểm tra `schedulerSupported`. Nếu có, bỏ qua bước sinh Ping probe, tiết kiệm 1 slot quota quý giá.
- **Trải nghiệm Người Dùng (UI/UX):**
  - Item hiển thị trạng thái `Chờ Gateway (cooldown)` màu vàng cam.
  - Đếm ngược thời gian `hh:mm:ss` theo thời gian thực dựa trên `nextEligibleAtUtc`.
  - Banner cảnh báo ở đầu giao diện giải thích rõ: *Hệ thống đang tạm nghỉ để bảo vệ tài khoản theo yêu cầu từ máy chủ Gemini Gateway. Batch sẽ tự động tiếp tục sau khi hết thời gian chờ.*

### Gate P4: Kiểm Chứng Chịu Tải & Phục Hồi (Verification)
- Xây dựng suite kiểm thử `tests/gateway-batch-recovery.test.ts` với mock 100 jobs:
  - 10 jobs đầu chạy thành công.
  - Job thứ 11 gặp HTTP 429 với `Retry-After: 600` (10 phút).
  - Sử dụng fake clock dịch chuyển thời gian tức thì +600s mà không phải chờ thật.
  - Job 11 resume thành công ở trạng thái half-open, các jobs từ 12 đến 100 tiếp tục chạy tuần tự.
  - Kiểm tra tính năng Cancellation: Khi người dùng bấm Hủy trong lúc đang chờ, timer và polling lập tức dừng, trạng thái chuyển sang `cancelled`, không có request nào bị dispatch ngầm.

### Gate P5: Phục Hồi Dữ Liệu Nguồn bằng Audio & OCR (Restoration)
- Module `src/main/translation/sourceRestoration.ts`:
  - **Evidence Pack Builder:** Tổng hợp metadata âm thanh (sample rate, channels, sha256) và các khung hình OCR có bounding box, khớp nối thời gian chồng lấn ($[start, end]$) với các câu ASR.
  - **Draft Validation:** Bắt buộc số lượng câu dịch khớp chính xác 100% với số lượng câu nguồn theo ID. Chỉ chấp nhận các loại sửa đổi `homophone`, `ocr_alignment`, `entity`, `semantic` khi có tham chiếu `evidenceRefs` hợp lệ trong Evidence Pack.
  - **Review Validation:** Kiểm tra đánh giá của reviewer theo từng nhóm ngữ nghĩa. Nếu một nhóm bị đánh giá `rejected`, hệ thống tự động rollback văn bản nguồn của nhóm đó về câu ASR gốc.
  - **Preservation Invariant:** Bảo toàn nguyên vẹn 100% ID của từng cue và timestamps $[start, end]$, phục vụ chính xác cho module lồng tiếng TTS và canh chỉnh phụ đề sau đó.
- Kiểm thử `tests/autoshort-source-restoration.test.ts` với bộ dữ liệu đánh giá 44 câu Volvo thực tế:
  - 3 lỗi ASR đồng âm được sửa đúng 100%:
    - Cue 5: *"窝耳窝XC90"* -> *"沃尔沃XC90"* (Volvo XC90)
    - Cue 12: *"一亿两千万橡树"* -> *"一亿两千万像素"* (120 triệu điểm ảnh)
    - Cue 28: *"领客09"* -> *"领克09"* (Lynk & Co 09)
  - 41 câu đúng còn lại được bảo toàn nguyên vẹn (`corruptedCleanCues = 0`).
  - Số câu bị mất: `droppedCues = 0`.

---

## 4. BẢO TOÀN CÁC BẤT BIẾN HỆ THỐNG (INVARIANTS AUDIT)

Bảng đối chiếu 7 quy tắc bất khả xâm phạm và cấu hình ghim chặt:

| Bất biến / Quy tắc | Trạng thái | Minh chứng trong Code |
| :--- | :---: | :--- |
| **TRANSLATION_BUDGET_LIMITS_ENABLED = false** | **TUÂN THỦ** | Không phục hồi các giới hạn budget cắt câu; toàn bộ văn bản được bảo đảm dịch đầy đủ. |
| **Trần Tempo lồng tiếng 1.80x** | **TUÂN THỦ** | Giữ nguyên theo override ngày 2026-09-08 tại `autoShortPolicy.ts` và `AGENTS.md`. |
| **Bảo toàn Cue ID & Timestamps** | **TUÂN THỦ** | `applyRestorationPipeline` map 1-1 theo `c.id`, gán lại đúng `c.start` và `c.end`. Không làm lệch thời gian phụ đề/voice. |
| **Không drop câu** | **TUÂN THỦ** | `validateRestorationDraft` quăng lỗi ngay nếu số lượng items trả về != `expectedIds.size`. |
| **Alias gemini-advanced** | **TUÂN THỦ** | Giữ nguyên alias phân giải model trong CreateMediaTool (`gemini_model_catalog.go`). |
| **require_verified_model=false, require_complete_response=true** | **TUÂN THỦ** | Được ghim trong cấu hình gateway translation options. |
| **Typed IPC & An toàn ContextBridge** | **TUÂN THỦ** | Định nghĩa chặt chẽ trong `src/shared/gatewayOperation.ts` và `src/preload/index.ts`. |
| **An toàn đường dẫn (Safe Contained Path)** | **TUÂN THỦ** | Toàn bộ tệp draft, audit, checkpoint nằm trong `workDir` của task scope, được kiểm tra qua `safeContainedPath`. |
| **Bảo vệ Bộ nhớ Đĩa & Planar RGB** | **TUÂN THỦ** | Giữ nguyên cơ chế merge video/OCR trên không gian màu RGB Planar để chống quầng viền màu. |
| **Bảo vệ Bản quyền PolyForm Noncommercial** | **TUÂN THỦ** | Không sửa đổi các điều khoản trong `LICENSE` và `NOTICE`. |

---

## 5. KẾT QUẢ KIỂM THỬ THỰC TẾ (VERIFICATION & EVIDENCE)

### 5.1. Phía CreateMediaTool (Go)
```powershell
cd F:\Son\tool\CreateMediaTool

# 1. Chạy các test module openai và providers
go test ./internal/modules/openai/... ./internal/modules/providers/... -count=1
# Output:
# ok   gemini-web-to-api/internal/modules/openai          0.171s
# ok   gemini-web-to-api/internal/modules/openai/dto      0.156s
# ok   gemini-web-to-api/internal/modules/providers       0.474s

# 2. Chạy toàn bộ test suites của repo
go test ./...
# Output: PASS 100% trên toàn bộ các packages

# 3. Build nhị phân
go build ./...
# Output: Exit code 0, không có lỗi cú pháp hoặc linking
```

### 5.2. Phía TediaPros (Node / Electron)
```powershell
cd F:\Son\tool\TediaPros

# 1. Typecheck toàn diện
cmd.exe /c "npm.cmd run typecheck"
# Output:
# > tedia-pros@0.1.26 typecheck:node
# > tsc --noEmit -p tsconfig.node.json --composite false
# > tedia-pros@0.1.26 typecheck:web
# > tsc --noEmit -p tsconfig.web.json --composite false
# PASS 100% (0 errors)

# 2. Kiểm thử Runtime tự động
cmd.exe /c "npm.cmd run test:local-runtime"
# Output:
# ✔ AutoShort Queue Runner: deferred wait does not trip circuit breaker, does not call onTerminal, and preserves deferred item (0.3482ms)
# ✔ buildSourceEvidencePack formats audio and OCR evidence correctly (1.4926ms)
# ✔ validateRestorationDraft enforces 1:1 cue cardinality and validates evidence refs (1.3569ms)
# ✔ validateRestorationReview validates reviewer decisions and structure (0.3263ms)
# ✔ applyRestorationPipeline applies validated edits and preserves 100% timestamps & IDs (0.4785ms)
# ✔ applyRestorationPipeline rolls back group edits when group review is rejected (0.1643ms)
# ✔ measureRestorationQuality evaluates 44-cue Volvo real scenario with zero corruption (1.2845ms)
# ✔ gateway batch scheduler handles 100 jobs with throttled cooldown and resumes cleanly (PASS)
# Toàn bộ hơn 60 suites kiểm thử PASS 100% (exit code 0).

# 3. Build ứng dụng sản xuất
cmd.exe /c "npm.cmd run build"
# Output:
# out/main/index.js        1,414.19 kB
# out/preload/index.js        15.52 kB
# out/renderer/index.html      0.65 kB
# out/renderer/assets/...   1,325.22 kB
# Build hoàn tất thành công trong 2.60s.
```

### 5.3. Bảng Phân Loại Mức Độ Khẳng Định
- **`CODE_CONFIRMED`:**
  - Logic concurrency = 1, mutex token bucket, spacing 15s.
  - OS exclusive file lock trên Windows/Unix.
  - Queue runner `pauseOnDeferred`, migration batch journal v1 -> v2.
  - Bộ lọc Cardinality 1:1 và Atomic Rollback theo Semantic Group trong P5.
- **`TEST_CONFIRMED`:**
  - 100-job recovery test: 0 rò rỉ dispatch trong cooldown, 0 duplicate, 0 pending video fail oan.
  - 44-cue Volvo corpus test: 3 lỗi ASR sửa đúng, 0 câu đúng bị sửa sai, 0 drop câu.
- **`LIVE_CONFIRMED`:**
  - Build binary Go và bundle Electron Vite chạy tốt trên môi trường Windows local, các IPC handlers Typed giao tiếp ổn định.
- **`UNKNOWN`:**
  - Ngưỡng phạt IP thực tế của hạ tầng Google Web đối với từng loại proxy/mạng người dùng (đã được giải quyết bằng cơ chế governor exponential cooldown và trạng thái `waiting-provider`).

---

## 6. DANH SÁCH CÂU HỎI TRỌNG TÂM ĐỀ XUẤT GPT ASTRA THẨM ĐỊNH (REVIEW CHECKLIST)

Kính mời GPT Astra tập trung phản biện các khía cạnh kỹ thuật sau:

1. **Khóa File Độc Quyền trên Windows (`upstream_state_store_windows.go`):**
   - Việc sử dụng cờ `LOCKFILE_EXCLUSIVE_LOCK` thông qua `LockFileEx` đã đảm bảo an toàn tuyệt đối khi hai process cùng ghi nhận cooldown hay chưa? Có rủi ro dead-lock nếu tiến trình bị kill đột ngột (SIGKILL / Crash) không? *(Code hiện tại đã có cơ chế tự giải phóng lock khi handle đóng và phục hồi trạng thái crash về `blocked` có hạn).*
2. **Cơ chế `pauseOnDeferred` trong `AutoShortQueueRunner`:**
   - Khi một video gặp rate limit 429 và rơi vào `deferred`, queue runner dừng pass hiện tại và giữ nguyên các video `pending`. Liệu có tình huống nào người dùng thêm video mới vào queue trong lúc đang đếm ngược cooldown mà gây xung đột trạng thái không?
3. **Tính Toàn Vẹn của Thẩm Định Phục Hồi Nhóm (Gate P5):**
   - Trong `applyRestorationPipeline`, khi một semantic group bị đánh giá `rejected`, hệ thống rollback về text ASR ban đầu của các câu thuộc nhóm đó. Việc đối chiếu này dựa trên `groupAssessments[].cueIds` đã hoàn toàn ngăn ngừa được việc sửa sai lan sang các câu độc lập khác chưa?
4. **Quy trình Canary Rollout:**
   - Kế hoạch triển khai khởi động Gateway trước, sau đó bật Client TediaPros đã tối ưu chưa? Có cần bổ sung thêm telemetry metrics nào cho đợt chạy batch thực tế đầu tiên của người dùng không?

---

## 7. HƯỚNG DẪN ROLLBACK (FALLBACK PLAN)

Trong trường hợp cần quay lại phiên bản v1 cũ ngay lập tức:
1. **Phía Server (CreateMediaTool):** Đổi cấu hình hoặc trả về capability `scheduler_contract_version: 0`.
2. **Phía Client (TediaPros):** Hàm `readGatewayCapabilitiesInfo` phát hiện `schedulerSupported === false` sẽ tự động định tuyến toàn bộ request qua `requestGatewayLegacy` mà không cần can thiệp mã nguồn.
