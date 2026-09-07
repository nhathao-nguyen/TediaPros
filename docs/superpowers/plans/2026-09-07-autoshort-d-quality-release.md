# Auto Short D — Chất lượng, GUI và phát hành Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kiểm chứng chất lượng thật, trải nghiệm sử dụng và bản cài trước đổi mặc định.
**Architecture:** Quality checks theo rủi ro, IPC có types và validation, release matrix theo capability/hardware; rollout từng tính năng đã qualification.
**Tech Stack:** TypeScript/Electron, Python, FFmpeg, Node test runner.
**Spec:** [Thiết kế](F:/Son/tool/TediaPros/docs/superpowers/specs/2026-09-07-autoshort-optimization-design.md).

## Global Constraints

Áp dụng đầy đủ mục 3 spec. Tempo ưu tiên 1.10x, thông thường 1.25x, trần 1.45x; gap 0.50s; trim -50 dB/onset 30ms/offset 100ms. Giữ planar RGB trước maskedmerge, model/geometry/FPS/encode trong phép so tương đương; maxActiveItems=1 ở các gói đầu và tối đa một request TTS đang chạy. Cache/scratch riêng, SHA-256 pin, typed IPC, không sửa LICENSE/NOTICE hoặc tệp ngoài phạm vi.

Các block test là phần kiểm tra hành vi cần đặt trong fixture của file được chỉ định; không giả định chúng là test hoàn chỉnh đã có. Mỗi task code: viết regression đỏ → chạy đúng suite → sửa tối thiểu → test xanh + `npm.cmd run typecheck` + `git diff --check` → cập nhật docs liên quan và handoff theo mẫu → commit riêng các file task sau review. Với file test mới, thêm vào danh sách trong `F:/Son/tool/TediaPros/scripts/run-local-runtime-tests.mjs` nếu cần. Không commit logs chứa dữ liệu riêng.


## T17 — QA nội dung dịch và lồng tiếng
**Phụ thuộc:** T01,T02.
**Files sửa:** `F:/Son/tool/TediaPros/src/main/dubbing/translation.ts`, `F:/Son/tool/TediaPros/src/main/dubbing/synthesis.ts`, `F:/Son/tool/TediaPros/src/main/autoShortPolicy.ts`, `F:/Son/tool/TediaPros/src/main/localTranslate.ts`; mới `F:/Son/tool/TediaPros/tests/autoshort-content-quality.test.ts`, `F:/Son/tool/TediaPros/docs/benchmarks/autoshort-content-quality.md`.
**Interface:** reuse cue identity/schema hiện có; bổ sung quality findings riêng với severity/reason/cue IDs, không thay text âm thầm.

- [ ] Tạo bộ tham chiếu có số, đơn vị, tên riêng, phủ định, câu hỏi/trả lời, chuyển người nói, bản dịch dài. Tách expected structural checks khỏi đánh giá ngữ nghĩa cần người duyệt.
- [ ] Regression: mọi source cue ánh xạ rõ; duplicate/missing/unexpected IDs fail; rephrase không được âm thầm đổi số/phủ định hoặc bỏ mệnh đề chỉ để vừa duration.
```text
source "không tăng 15%" -> rephrase "tăng 15%" => flag semantic-risk
missing source cue ID => reject batch
all IDs present but omitted spoken words => structural pass, quality still unverified
```
- [ ] Dùng kiểm tra rẻ cho mọi job: cue mapping, số/ký hiệu quan trọng, audio nonempty, duration và tempo/gap. ASR đối chiếu TTS/đánh giá nghĩa sâu chỉ trên corpus hoặc cue nghi vấn/opt-in; lưu finding thay vì tự xóa/sửa audio.
- [ ] Retry/rephrase có ngân sách theo policy hiện có, ghi số lần và lý do; hết ngân sách báo lỗi hoặc cần xem lại. Nếu không có reference đủ tin cậy, cảnh báo nghi vấn thay vì kết luận dịch sai chắc chắn.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-content-quality.test dubbing-plan.test autoshort-tts-pipeline.test`.
- [ ] Gate: không mất ý/câu trong bộ tham chiếu đã duyệt, audio không cụt đầu/cuối; số đo latency của QC được báo riêng. Không quảng cáo semantic fidelity chỉ từ test ID.

## T18 — Corpus hình, audio và subtitle
**Phụ thuộc:** T01,T08.
**Files:** `F:/Son/tool/TediaPros/scripts/verify-ocr-blur-media.mjs`, `F:/Son/tool/TediaPros/scripts/sttn-storage-benchmark.py`, `F:/Son/tool/TediaPros/scripts/dubbing-tempo-acceptance.mjs`, `F:/Son/tool/TediaPros/tests/ocr-mask.test.ts`, `F:/Son/tool/TediaPros/tests/ocr-visual-timeline.test.ts`; mới `F:/Son/tool/TediaPros/docs/benchmarks/autoshort-media-quality-matrix.md`.
**Interface:** dùng manifest corpus T01, output report mỗi sample với revision/hash/config và pass/fail/unverified từng chiều.

- [ ] Bao phủ chữ nhỏ/sát ROI, nhiều dòng, moving text, cảnh cắt nhanh, VFR/rotation/SAR, audio offset và nhiều audio stream. Thêm standard/reveal/highlight với font/ngôn ngữ đang hỗ trợ.
- [ ] So frame timestamp và vùng ngoài mask; kiểm tra residual text/flicker/ảnh hưởng mặt trong vùng xử lý bằng frame contact sheet + video playback. OCR chỉ chấm trong scan region đã chọn, không coi bỏ sót ngoài ROI là lỗi coverage toàn khung.
- [ ] Bảo vệ STTN optimization đã có: decoded RGB/audio/timestamp parity trên fixed mask; đo peak scratch riêng. Không đổi window/model/precision để làm benchmark đẹp.
```text
fixed model + fixed mask + I/O-only change:
    decoded frame sequence and timestamps match reference
    decoded audio mapping/offset/content match reference
    no new frames missing at EOF or scene boundary
```
- [ ] Separation kiểm tra giữ BGM/SFX và không lẫn nguồn thoại khi contract cấm fallback; provider CPU/DirectML được đánh giá riêng, không đòi bit-identical inference giữa backend nếu thực tế có sai số.
- [ ] Chạy `npm.cmd run test:ocr-engine`, `npm.cmd run test:sttn-engine`, `npm.cmd run test:separator-engine`, `npm.cmd run fonts:verify`, `npm.cmd run test:subtitles`. Chọn môi trường đủ dependency; ghi skip là gate chưa đạt.
- [ ] Gate: mọi biến thể đưa vào release có media evidence và mẫu human review; ROI/precision/encoder experiment không được lọt vào default dưới tên tối ưu tương đương.

## T19 — GUI, progress, cache controls và IPC
**Phụ thuộc:** T01,T04,T13.
**Files sửa:** `F:/Son/tool/TediaPros/src/renderer/src/components/AutoShort.tsx`, `F:/Son/tool/TediaPros/src/renderer/src/components/SetupScreen.tsx`, `F:/Son/tool/TediaPros/src/preload/index.ts`, `F:/Son/tool/TediaPros/src/shared/types.ts`, `F:/Son/tool/TediaPros/src/shared/autoShortContract.ts`, `F:/Son/tool/TediaPros/src/main/index.ts`; mới `F:/Son/tool/TediaPros/tests/autoshort-ui-contract.test.ts`.
**Interface:** progress giữ job/item/attempt IDs; terminal không bị throttle/drop; config mới có migration, Main validate lại.

- [ ] Profile render/IPC khi batch20 và nhiều tab mounted; đo event rate, render commits và heap sau cancel/restart. Không unmount tab đang giữ tác vụ chỉ để giảm số component.
- [ ] Coalesce progress theo item/attempt tối đa10Hz trong thử nghiệm; terminal flush ngay, log panel bounded theo budget hiện có. Danh sách lớn chỉ virtualize khi profile chứng minh đáng làm.
```text
progress attempt1 arrives after attempt2 starts -> ignore stale update
done arrives within throttle window -> flush immediately
unsubscribe called -> no state update from that subscription
```
- [ ] UI hiển thị công đoạn đang chạy, chờ server/tài nguyên, cache hit và khả năng tiếp tục khi lỗi. Cài đặt dùng nhãn người dùng hiểu: tái sử dụng kết quả, giới hạn cache, xóa cache không dùng, chế độ thử nghiệm; không buộc người dùng chọn tên transport/protocol nội bộ.
- [ ] Cache clear gửi yêu cầu có types, Main giới hạn vùng/pin; xác nhận phạm vi byte/entry sẽ xóa ngay trong UI nếu người dùng chủ động clear, không xóa output. Giữ config cũ và ba tab Phụ đề/Làm mờ/Lồng tiếng.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-ui-contract.test autoshort-ocr-contract.test` và `npm.cmd run typecheck`; GUI acceptance thật: start/cancel/retry, đổi tab, restart/resume, runtime missing, tiếng Việt/Unicode.
- [ ] Gate: không stale status/memory growth không giới hạn, UI không trắng, không mất terminal; profiling trước/sau chứng minh việc tối ưu render có ích.

## T20 — Runtime/model distribution đầy đủ
**Phụ thuộc:** T07,T08.
**Files sửa:** `F:/Son/tool/TediaPros/distribution/runtime-inputs.json`, `F:/Son/tool/TediaPros/distribution/separator-model-inputs.json`, `F:/Son/tool/TediaPros/scripts/pack-runtime-release.mjs`, `F:/Son/tool/TediaPros/scripts/pack-separator-model-release.mjs`, `F:/Son/tool/TediaPros/scripts/publish-github-release.mjs`, `F:/Son/tool/TediaPros/scripts/verify-runtime-release.mjs`, `F:/Son/tool/TediaPros/.github/workflows/release-app.yml`, `F:/Son/tool/TediaPros/src/main/distributionConfig.ts`, `F:/Son/tool/TediaPros/tests/release-tooling.test.ts`.
**Interface:** versioned manifest pin SHA-256 và capability; installer atomic + native probe hiện có. Không dùng URL public không tồn tại làm fallback giả.

- [ ] Kiểm kê engine/model bắt buộc theo feature bật, thêm STTN và separator model vào build→pack→verify inventory đúng vai trò từng manifest. Reject duplicate/missing/hash-size-version mismatch.
- [ ] Chốt kênh release có thể truy cập từ client: public hoặc authenticated theo thiết kế thực; không hardcode token trong app. HTTP404 đã thấy là evidence cũ, recheck khi chuẩn bị release.
```text
enabled feature -> all required engine/model/font artifacts present and hash-verified
manifest advertises stream-full -> installed executable probe confirms feature and ready
model mismatch/offline missing -> actionable setup error, not silent source-audio fallback
```
- [ ] Build môi trường pinned và kiểm tra packaged native imports; ký/manifest theo quy trình repo. Bản build source pass nhưng binary thiếu dependency phải fail gate.
- [ ] Fresh userData qualification riêng: install→download checksum→probe→one real job→restart offline dùng engine/model đã cài. Phần dịch/TTS mạng vẫn cần dịch vụ; chỉ tuyên bố offline cho thành phần offline.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs release-tooling.test canonical-runtime-migration.test sttn-runtime.test separator-runtime.test`, `npm.cmd run release:verify-runtime`, verifier model separator với artifact thật.
- [ ] Gate: installer trên máy sạch đủ artifacts, rollback receipt/archive được thử. Publish ngoài máy là bước riêng sau artifact review trong phạm vi được cho phép.

## T21 — Dependency và IPC/navigation hardening
**Phụ thuộc:** T07.
**Files:** `F:/Son/tool/TediaPros/package.json`, `F:/Son/tool/TediaPros/package-lock.json`, `F:/Son/tool/TediaPros/src/main/index.ts`, `F:/Son/tool/TediaPros/src/preload/index.ts`; mới `F:/Son/tool/TediaPros/tests/ipc-origin-validation.test.ts`, `F:/Son/tool/TediaPros/docs/reviews/dependency-upgrade-qualification.md`.
**Interface:** IPC vẫn typed; runtime source/sender allowlist chỉ cho renderer app hợp lệ. Không bật sandbox đại trà trước kiểm tra preload/native tương thích.

- [ ] Audit lại lockfile lúc thực thi, tra advisory/release notes nguồn chính thức và phân loại shipped Electron/builder/transitive. Chốt target version cụ thể trong qualification record sau kiểm tra compatibility; không tự chọn “latest” thiếu evidence, không audit fix --force.
- [ ] Upgrade Electron/toolchain trong commit riêng; build native/runtime/package trên nền tảng mục tiêu. Không đổi model hoặc xử lý media trong cùng commit dependency.
- [ ] Chặn navigation không được phép, validate sender frame/origin và payload cho các IPC filesystem/process; vẫn cho phép dev origin được cấu hình chính xác và packaged app URL đúng.
```text
trusted top-level app renderer + valid payload => existing typed operation
unknown frame/origin or untrusted navigation => reject
trusted origin + malformed filesystem request => reject in Main validation
```
- [ ] Kiểm tra có thể sandbox preload theo dependencies thật; nếu chưa tương thích, ghi boundary còn lại và điều kiện sửa, không đánh dấu hardening hoàn tất giả.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs ipc-origin-validation.test release-tooling.test local-runtime.test`, typecheck/build/package smoke và GUI IPC flows.
- [ ] Gate: advisory đã xử lý hoặc disposition có bằng chứng, không mất chức năng app; installer mới được verifier T07 kiểm tra. Không suy audit omit-dev=0 là Electron an toàn.

## T22 — Qualification phần cứng và hai item
**Phụ thuộc:** T02–T06,T10,T13,T18,T19,T20; T15/T16 nếu chúng được bật.
**Files:** `F:/Son/tool/TediaPros/src/main/autoShortExecutionPolicy.ts`, `F:/Son/tool/TediaPros/src/main/autoShortQueueRunner.ts`, `F:/Son/tool/TediaPros/src/main/autoShortResourceManager.ts`, `F:/Son/tool/TediaPros/src/main/autoShortDiskBudget.ts`, `F:/Son/tool/TediaPros/tests/autoshort-queue-throughput.test.ts`; mới `F:/Son/tool/TediaPros/docs/benchmarks/autoshort-hardware-qualification.md`.
**Interface:** maxActiveItems hiện chỉ1 hoặc2. Không nâng capacity GPU-heavy dựa vào số item; admission giữ ngân sách thực, effective policy có lý do.

- [ ] Chạy matrix Windows NVIDIA, AMD/Intel DirectML/CPU và macOS ARM64 trên thiết bị có thật; row thiếu thiết bị ghi unqualified. Không tuyên bố platform hỗ trợ feature chưa có binary/provider.
- [ ] Baseline single-item vs two-item cùng batch/source/order/config, fixed inputs và live riêng. Đo total throughput, từng item latency, fairness, RAM/VRAM/scratch, encoder session limits.
```text
maxActiveItems=2 does not imply two GPU inference jobs
admission denied -> item stays queued or effective single-item with reason
cancel A -> B continues only after shared resource close fence is satisfied
```
- [ ] Thử batch20, video dài, cancel mỗi stage, engine crash, network loss, storage exhaustion adapter, app restart, các tab GPU khác cùng mở. Burn singleton/current encoder contract phải được audit và serialize hoặc tách state đúng trước concurrency, không dựa queue mock pass.
- [ ] Đặt memory/headroom thresholds từ peak đã đo và safety margin được ghi trong report. Unknown memory/provider dùng conservative; không mặc định auto tăng concurrency vì GPU usage đang thấp tức thời.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-queue-throughput.test autoshort-stage-scheduling.test autoshort-resource-lifecycle.test autoshort-disk-budget.test` và E2E/hardware protocol T01/T18.
- [ ] Gate: không OOM/ENOSPC do admission, không job đói tài nguyên, gain throughput vượt noise và regression latency được công bố. Không đạt → maxActiveItems1 vẫn là release hợp lệ.

## T23 — Release, migration, tài liệu và rollback
**Phụ thuộc:** T01–T22 cho mọi tính năng đưa vào release, bao gồm title T11 và trim cache T14; T15/T16 được đánh dấu off/unqualified nếu chưa đạt và không đưa vào mặc định.
**Files:** `F:/Son/tool/TediaPros/docs/architecture.md`, `F:/Son/tool/TediaPros/docs/domain.md`, `F:/Son/tool/TediaPros/docs/adr/002-typed-ipc-contracts.md`, `F:/Son/tool/TediaPros/docs/adr/003-on-demand-runtime-with-sha256-verification.md`, `F:/Son/tool/TediaPros/src/main/autoShortExecutionPolicy.ts`, `F:/Son/tool/TediaPros/src/shared/autoShortContract.ts`, `F:/Son/tool/TediaPros/tests/release-tooling.test.ts`; mới `F:/Son/tool/TediaPros/docs/releases/autoshort-optimization-acceptance.md`.
**Interface:** giữ config migration đọc version cũ; hiệu lực từng cờ được quyết định bằng qualification, không theo việc source có code.

- [ ] Tạo release matrix: feature, default trước/sau, required runtime/model/provider, evidence run IDs, known limitation, kill switch và rollback target.
- [ ] Chạy full TypeScript/Python/media/typecheck/build/package/runtime checks như master. Không bỏ qua test mới do thiếu đăng ký runner; skip native/media bắt buộc là incomplete.
- [ ] Fresh install, upgrade từ config cũ, offline engine restart, lỗi giữa install, cache schema đổi và rollback receipt đều được kiểm tra trong scope riêng; không xóa dữ liệu người dùng để làm smoke pass.
```text
rollback optimization flags -> single-item sequential + verified compatible transport
rollback cache reader -> ignore new schema, preserve existing outputs and old cache
rollback runtime -> previous verified receipt/archive, probe before activate
correctness fixes R1/R2/R4/R5 must remain in rollback application build
```
- [ ] Sửa architecture diagram đang mô tả song song mặc định không đúng; docs ghi requested/effective capability, trần tempo/gap thật, giới hạn offline, môi trường được test và những row chưa qualification.
- [ ] Báo cáo before/after theo workload với n/median/range/p95 khi đủ mẫu; phân tách chất lượng sửa tốt hơn và output tương đương, không cộng gain của từng stage. Không release “nhanh X%” thiếu class/hardware/context.
- [ ] Artifact, release notes, exact file inventory và rollback đã review trước publish. Publish/merge/commit source theo phạm vi user yêu cầu tại lúc triển khai; không tự dùng planning làm quyền phát hành.
- [ ] Gate G4: mọi feature mặc định có E2E thật và evidence; unsupported/experimental hiển thị rõ. Bản bàn giao ghi commit/branch, kiểm chứng và trạng thái remote thực tế.

## Phần nghiên cứu không chặn release

ROI OCR, adaptive FPS, FP16/quantization, model nhỏ hơn, encoder/preset khác và stream dịch→TTS có thể đổi output hoặc ngữ nghĩa. Chỉ mở thử nghiệm riêng sau T01/T18, đánh giá lợi ích/chất lượng trên corpus và cần quyết định sản phẩm trước thay mặc định. Kế hoạch không gán các hướng này vào nhóm “giữ nguyên chất lượng” khi chưa có bằng chứng.

Refactor chỉ khu trú trách nhiệm mới như artifact cache/key builder/benchmark scripts. Không tách hàng loạt autoshort.ts, burn.ts hoặc AutoShort.tsx trong một PR tối ưu nếu chưa có mục tiêu đo được.
