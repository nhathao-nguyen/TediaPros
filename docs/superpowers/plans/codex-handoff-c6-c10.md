# Codex Handoff — AutoShort Client Remediation

> **Ngày**: 2026-09-06  
> **Workspace**: `F:\Son\tool\TediaPros`  
> **Kế hoạch gốc**: `docs/superpowers/plans/2026-09-06-autoshort-client-remediation.md`  
> **Review findings**: `docs/benchmarks/2026-09-06-gemini-throughput-review.md`

---

## Ràng buộc bắt buộc (KHÔNG ĐƯỢC vi phạm)

1. **Giữ cấu hình mặc định Conservative**: `maxActiveItems: 1`, `overlapIndependentStages: false`, `prefetchTts: false`, `ocrTransport: 'legacy-disk'`.
2. **KHÔNG commit git, git push, stash hay reset branch.**
3. **Bảo toàn phiên bản**: STTN 1.1.0, mô hình RapidOCR hiện tại. Không sửa backend hay thay đổi API endpoint/request body.
4. **Mọi thay đổi phải pass**:
   ```powershell
   node node_modules/typescript/bin/tsc --noEmit
   python -m unittest discover -s engines/ocr-engine/tests -p "test_*.py" -v
   node scripts/run-local-runtime-tests.mjs
   ```

---

## Trạng thái hiện tại

| Milestone | Trạng thái |
|-----------|-----------|
| C0 — Conservative defaults & queue runner | ✅ DONE |
| C1 — Item Scope lifecycle, fatal error | ✅ DONE |
| C2 — TTS prefetch child scope | ✅ DONE |
| C3 — withLease wiring, ResourceManager | ✅ DONE |
| C4 — OCR Fast stable selection bounded buffers | ✅ DONE |
| C5 — Pipe watchdog, EOF/timeout OCR | ✅ DONE |
| **C6 — Telemetry sanitize & job budget** | **🔧 90% — 2 test cần fix** |
| C7 — OCR capability/package 1.2.0 | ❌ NOT STARTED |
| C8 — Retry budget & TTS cache atomic | ❌ NOT STARTED |
| C9 — Disk ledger & 2-item admission | ❌ NOT STARTED |
| C10 — Acceptance test & rollout | ❌ NOT STARTED |

---

## VIỆC 1: Fix 2 test failures trong C6

### Test runner

```powershell
node scripts/run-local-runtime-tests.mjs autoshort-telemetry.test
```

> **QUAN TRỌNG**: KHÔNG dùng `node --test` trực tiếp. Runner `run-local-runtime-tests.mjs` bundle TS qua esbuild, mock electron, chạy trong temp dir. Truyền tên test KHÔNG có phần mở rộng `.ts`.

### Bug 1: `AutoShortTelemetryJobBudget is not defined`

**Test bị lỗi**: `AutoShortTelemetryJobBudget preserves terminal records when non-terminal budget is full` (line 167)

**Nguyên nhân**: Test file import thiếu `AutoShortTelemetryJobBudget`.

**File**: `tests/autoshort-telemetry.test.ts` dòng 6-11

**Hiện tại**:
```ts
import {
  AutoShortTelemetryCollector,
  sanitizeEndpointAlias,
  sanitizeTelemetryPath,
  MAX_DIAGNOSTICS_BYTES
} from '../src/main/autoShortTelemetry'
```

**Sửa thành**:
```ts
import {
  AutoShortTelemetryCollector,
  AutoShortTelemetryJobBudget,
  sanitizeEndpointAlias,
  sanitizeTelemetryPath,
  MAX_DIAGNOSTICS_BYTES
} from '../src/main/autoShortTelemetry'
```

`AutoShortTelemetryJobBudget` đã được export từ `src/main/autoShortTelemetry.ts` (line 167).

### Bug 2: `progress events are coalesced at <= 1Hz per item`

**Test bị lỗi**: Line 269-289 — kỳ vọng chỉ 1 progress event được record nhưng lỗi `0 !== 1`.

**Nguyên nhân**: `performance.now()` bắt đầu từ 0 trong test runner. Biến `lastProgressRecordedAtMs` khởi tạo = 0, nên check `performance.now() - this.lastProgressRecordedAtMs < 1000` đánh giá event đầu tiên là "quá sớm" → drop tất cả.

**File**: `src/main/autoShortTelemetry.ts` — trong method `recordEvent()` của class `AutoShortTelemetryCollector`

**Cách sửa**: Tìm logic coalesce progress. Đổi điều kiện thành chỉ coalesce khi `lastProgressRecordedAtMs > 0` (tức đã có ít nhất 1 event trước đó):

```ts
// Coalesce progress events: only suppress if we already recorded one recently
if (event.phase === 'progress') {
  const now = performance.now()
  if (this.lastProgressRecordedAtMs > 0 && now - this.lastProgressRecordedAtMs < 1000) {
    return // drop — within 1s of last progress
  }
  this.lastProgressRecordedAtMs = now
}
```

> **Lưu ý**: Fix này có thể đã được áp dụng rồi nhưng chưa verify. Hãy kiểm tra code hiện tại trước khi sửa. Nếu đã có `> 0` check thì chạy lại test để xác nhận pass.

### Sau khi fix, chạy toàn bộ:

```powershell
node scripts/run-local-runtime-tests.mjs autoshort-telemetry.test
node scripts/run-local-runtime-tests.mjs
node node_modules/typescript/bin/tsc --noEmit
```

---

## VIỆC 2: C7 — Capability, package và installed runtime OCR 1.2.0

**Spec đầy đủ**: `docs/superpowers/plans/2026-09-06-autoshort-client-remediation.md` dòng 201-219

### Files cần sửa/tạo

| File | Thay đổi |
|------|----------|
| `engines/ocr-engine/engine.py` | Đổi version → `1.2.0`, thêm features `visual-stream-full-v1` và `visual-stream-roi-v1`, thêm arg `--visual-transport legacy-disk\|stream-full\|stream-roi`, giữ `--legacy-disk-extract` làm alias backward-compatible |
| `engines/ocr-engine/ocr-engine.spec` | Cập nhật spec nếu cần |
| `engines/ocr-engine/tests/test_*.py` | Tests cho CLI args mới, feature negotiation |
| `src/main/ocr.ts` | Manifest negotiation logic: binary cũ → legacy fallback, binary mới → mặc định `stream-full`, ROI chỉ opt-in |
| Test files tương ứng | Negotiation tests, feature flags |

### Yêu cầu chi tiết

1. **Negotiation**: Binary cũ không nhận flag mới → vẫn chạy legacy. Binary mới mặc định `stream-full` khi qualified, ROI chỉ opt-in. Thiếu feature → reject hoặc fallback legacy có log rõ, KHÔNG đổi profile `accurate` thành `fast`.
2. **Stream-full**: Cùng pixels/geometry/FPS/full-frame OCR như baseline.
3. **Stream-roi**: Halo 32px, translate coordinates trước clip ROI.
4. **Provider thực**: Báo provider thực `det/cls/rec` từ session, KHÔNG lấy startup probe thay thế.
5. **Fingerprint**: Lưu implementation fingerprint vào artifacts và OCR evidence.
6. **Build**: 
   ```powershell
   python -m unittest discover -s engines/ocr-engine/tests -p "test_*.py" -v
   python -m PyInstaller --noconfirm --distpath release-artifacts/ocr-client-remediation/dist --workpath release-artifacts/ocr-client-remediation/build engines/ocr-engine/ocr-engine.spec
   ```
7. **Quality corpus**: Chữ sát ROI, chữ nhỏ, flash, multiline/vertical, scene cut, rotation/SAR/VFR. Full-frame stream tương đương legacy; ROI recall giảm ≤0.5 điểm, false-positive area tăng ≤0.5 điểm, boundary lệch ≤125ms.
8. **Gate**: Test trên canonical installed executable và main-path OCR→STTN→render/cancel thật.

---

## VIỆC 3: C8 — Retry có budget và TTS cache nguyên tử

**Spec đầy đủ**: dòng 221-231

### Files

| File | Thay đổi |
|------|----------|
| `src/main/localTranslate*.ts` (policy) | Deadline 10 phút/item; mặc định không giới hạn số request, có thể truyền `maxRequests` để bật quota tùy chọn |
| `src/main/dubbing*.ts` (cache) | TTS cache atomic single-flight |
| `src/main/autoshort.ts` | Nối budget objects |
| `src/main/tts*.ts` | Cache wiring |
| Tests tương ứng | Mock 429/timeout, concurrent callers, corrupt audio |

### Yêu cầu

1. **Translation budget**: Mọi attempt (transport, schema repair, semantic split) trừ chung budget. Exhaustion → error + checkpoint đã hợp lệ.
2. **Retry-After**: Dùng HTTP-date và giây. Vượt remaining deadline → fail rõ, KHÔNG gửi trước thời điểm server yêu cầu.
3. **TTS cache**: 
   - 2 callers cùng key → chỉ 1 request, không ai đọc WAV partial
   - Ghi temp → validate → rename
   - Cancel waiter không hủy producer đang phục vụ waiter khác
   - Cache key thêm content hash + model revision
4. **Gate**: Deterministic cache fixtures, client concurrency ≤ 1.

---

## VIỆC 4: C9 — Disk ledger và điều kiện admit 2 item

**Spec đầy đủ**: dòng 233-254

### Files mới

| File | Mô tả |
|------|-------|
| `src/main/autoShortDiskBudget.ts` [NEW] | Interface `DiskReservation` (update, release) và `AutoShortDiskBudget` (reserve) |
| `tests/autoshort-disk-budget.test.ts` [NEW] | Tests fake free-space, 2 jobs, cancel, ENOSPC |

### Interface spec

```ts
export interface DiskReservation {
  update(remainingBytesToWrite: number): void
  release(): void
}
export interface AutoShortDiskBudget {
  reserve(volume: string, remainingBytesToWrite: number,
    signal: AbortSignal): Promise<DiskReservation>
}
```

### Sửa thêm

- Queue/coordinator/STTN admission, execution policy
- Admission: `freeBytes - sum(otherRemainingReservations) >= newRemaining + safetyHeadroom`
- STTN 0.685 GiB rolling reserve là headroom, KHÔNG phải tổng video
- **Giữ `maxActiveItems = 1` trong production release**; C10 chỉ test experimental 2-item

---

## VIỆC 5: C10 — Acceptance và quyết định rollout

**Spec đầy đủ**: dòng 256-278

### Chạy đầy đủ

```powershell
npm.cmd run test:local-runtime
npm.cmd run typecheck
npm.cmd run test:ocr-engine
npm.cmd run test:sttn-engine
npm.cmd run build
git diff --check
```

### Deliverables

- Register mọi test mới trong `scripts/run-local-runtime-tests.mjs`
- Tạo `docs/benchmarks/2026-09-06-autoshort-client-remediation-acceptance.md`
- Regression R2/R3/R4/R5
- Fault matrix: lỗi ASR khi OCR chạy, lỗi STTN khi TTS chạy, cancel all, server 403/429/timeout, disk hết, corrupt cache, app shutdown...

---

## Danh sách files đã thay đổi trong C0-C6

| File | Milestones |
|------|-----------|
| `src/shared/types.ts` | C0-C6 |
| `src/main/autoshort.ts` | C0-C6 |
| `src/main/autoShortItemCoordinator.ts` | C1-C6 |
| `src/main/autoShortTelemetry.ts` | C6 (major rewrite) |
| `src/main/autoShortResourceManager.ts` | C3, C6 |
| `src/main/autoShortQueueRunner.ts` | C0 |
| `src/main/ocr.ts` | C5 |
| `engines/ocr-engine/engine.py` | C4, C5 |
| `engines/ocr-engine/visual_timeline.py` | C4 |
| `tests/autoshort-telemetry.test.ts` | C6 |
| `tests/autoshort-queue.test.ts` | C0, C1 |
| `tests/autoshort-resource.test.ts` | C3 |
| Various other test files | C1-C5 |

---

## Cấu trúc kiến trúc cần biết

### Telemetry Budget Flow (C6)
```
executeJob() → new AutoShortTelemetryJobBudget()
  ↓ job.telemetryBudget
processSingleVideo() → context.telemetryBudget
  ↓ 
AutoShortTelemetryCollector({ budget }) ← mỗi item 1 collector, share 1 budget
  ↓
claimWriteBudget(bytes, isTerminal) → true/false
```

### Resource Lease Flow (C3 + C6)
```
ResourceManager.withLease(type, signal, async (lease) => { ... })
  ↓
lease.waitMs → thời gian chờ queue (0 nếu immediate)
  ↓
span.recordResourceWait(lease.waitMs) → ghi vào telemetry
```

### Test Runner
- `scripts/run-local-runtime-tests.mjs` — bundle TS qua esbuild, mock electron
- Tên test: truyền KHÔNG có `.ts`, ví dụ `autoshort-telemetry.test`
- Mảng `knownTests` ở line ~49-76 — phải register test mới vào đây

---

## Checklist review cho mỗi task

- [ ] Có regression chạy RED trước sửa và GREEN sau sửa
- [ ] Test output ghi rõ mock/source/native/installed/live
- [ ] Giữ cấu hình và output cũ; thay đổi ngoài files task phải giải thích
- [ ] Module mới phải nối vào production caller, không chỉ tồn tại
- [ ] Tài liệu acceptance đánh dấu riêng: implemented / verified / enabled
- [ ] Self-review theo R1-R7 trước mốc tiếp
