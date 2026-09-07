# Auto Short toàn diện Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Chỉ dùng subagent khi người dùng yêu cầu hoặc hướng dẫn áp dụng cho phép.

**Goal:** Tăng tốc Auto Short có bằng chứng, giữ hoặc cải thiện chất lượng, khóa độ ổn định và khả năng cài/phát hành.
**Architecture:** Giữ hybrid Electron/React/Python và các manager hiện có. Sửa correctness trước; thử từng tối ưu dưới capability/feature gate; tách cache theo stage và qualification theo thiết bị.
**Tech Stack:** TypeScript, Electron, React, Python, FFmpeg, RapidOCR, Faster-Whisper, STTN, MDX và các API dịch/TTS đang có.
**Spec:** [Thiết kế](F:/Son/tool/TediaPros/docs/superpowers/specs/2026-09-07-autoshort-optimization-design.md).

## Global Constraints

Toàn bộ mục 3 của spec là ràng buộc chung cho mọi task; các gói con lặp lại các hằng số nhạy cảm. Giữ output/config cũ và worktree hiện có. Đây là planning, tất cả 23 task dưới đây chưa triển khai. Không cộng các phần trăm tiết kiệm stage thành phần trăm toàn pipeline.

## 1. Cách dùng bộ kế hoạch

Đọc spec → chọn task đã đủ dependency → đọc gói tương ứng → chạy chu trình test đỏ/sửa tối thiểu/test xanh/typecheck → kiểm tra media nếu liên quan → review diff và ghi handoff → chuyển task tiếp theo. Từng task là một đơn vị commit tại thời điểm triển khai; stage explicit files, không git add cả workspace.

Không cần viết lại planning cho những quyết định đã chốt ở đây. Nhánh server/hardware thiếu evidence phải kết thúc bằng báo cáo đo hoặc thiếu dependency cụ thể, không tự tạo endpoint/model mới.

## 2. Các đợt và điểm dừng

| Đợt | Task | Kết quả có thể nghiệm thu | Điều kiện chuyển tiếp |
| --- | --- | --- | --- |
| A — Nền đo và tính đúng | T01–T07 | Baseline, policy đúng, lifecycle/đĩa/path/output/verifier đáng tin | G1: regression + fault tests đạt; T01 có baseline trước khi đo tăng tốc |
| B — Giảm latency một video | T08–T11 | OCR stream-full, prefetch, lịch overlap, title chuẩn bị sớm | G2: từng cờ có A/B output + timing; vẫn maxActiveItems=1 |
| C — Tái sử dụng và khởi động | T12–T16 | Cache stage/trim, resume, worker/server được qualification | G3: cache/cancel/migration đạt; nhánh không có lợi giữ off |
| D — Chất lượng, GUI và release | T17–T23 | QC có mục tiêu, GUI phản hồi, runtime đầy đủ, qualification và rollout | G4: E2E thật + fresh install + offline + rollback trên nền tảng công bố |

Các đợt không buộc tuần tự tuyệt đối: T07/T20/T21 có thể được thực hiện trước trong nhánh độc lập; T17/T18 chuẩn bị quality corpus sớm; T22/T23 phải chờ các phần thực sự được đưa vào release.

## 3. Danh mục 23 đầu việc

| ID | Đầu việc | Phụ thuộc | Tài liệu |
| --- | --- | --- | --- |
| T01 | Telemetry, corpus, baseline/frozen replay | Không | Gói A |
| T02 | Tempo/gap và xử lý câu không vừa | Không | Gói A |
| T03 | Containment/junction và atomic output | Không | Gói A |
| T04 | Lease giữ tới close, shutdown/drain helpers | Không | Gói A |
| T05 | Disk race, reservation và cleanup/crash | T04 | Gói A |
| T06 | OCR output thật, Douyin stdout/final status | T03,T04 | Gói A |
| T07 | Package verifier fail closed | Không | Gói A |
| T08 | OCR runtime stream-full đủ dependency | T01,T03,T04 | Gói B |
| T09 | Prefetch một câu, lỗi/retry đúng | T01,T02,T04 | Gói B |
| T10 | Lịch overlap sau ASR và separation | T01,T04,T05,T08,T09 | Gói B |
| T11 | Title chuẩn bị cùng render | T03,T04 | Gói B |
| T12 | Cache artifact có quota/pin/integrity | T03,T04,T05 | Gói C |
| T13 | Cache stage và resume/invalidation | T01,T12 | Gói C |
| T14 | Cache trim PCM và giảm copy có đo | T02,T12 | Gói C |
| T15 | Worker local thường trú có ngân sách | T01,T04,T10 | Gói C, có điều kiện |
| T16 | Server TTS conditioning/warmup/request reuse | T01,T09 | Gói C, cần mã server |
| T17 | QA nội dung dịch/lồng tiếng theo rủi ro | T01,T02 | Gói D |
| T18 | Quality corpus hình/audio/subtitle | T01,T08 | Gói D |
| T19 | GUI, IPC và progress không gây lag | T01,T04,T13 | Gói D |
| T20 | Runtime/model distribution đầy đủ | T07,T08 | Gói D |
| T21 | Dependency, Electron/IPC hardening | T07 | Gói D |
| T22 | Qualification hardware + hai item | T02–T06,T10,T13,T18,T19,T20; T15/T16 nếu bật | Gói D |
| T23 | Release, docs, migration và rollback | T01–T22 cho mọi tính năng đưa vào release; T15/T16 có thể off/unqualified | Gói D |

- [ ] Gói A: [Nền đo và tính đúng](F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-07-autoshort-a-foundation.md)
- [ ] Gói B: [Giảm latency](F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-07-autoshort-b-latency.md)
- [ ] Gói C: [Cache và worker](F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-07-autoshort-c-reuse.md)
- [ ] Gói D: [Chất lượng và phát hành](F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-07-autoshort-d-quality-release.md)

## 4. Truy vết đầy đủ từ review

| Phát hiện/ý tưởng | Task đáp ứng |
| --- | --- |
| R1 tempo/gap | T02,T17 |
| R2 junction/containment | T03,T12 |
| R3 runtime/model thiếu hoặc URL không truy cập | T08,T20,T23 |
| R4 disk ledger | T05,T22 |
| R5 lease nhả sớm | T04,T10,T22 |
| R6 OCR success giả | T06 |
| R7 Douyin stdout/status | T06 |
| R8 dependency advisories | T21 |
| R9 verifier PASS giả | T07,T23 |
| OCR stream-full/ROI | T08; ROI ở nghiên cứu có điều kiện |
| TTS prefetch/cache hiện có | T09,T12,T14 |
| Overlap visual/server, separation | T10 |
| Stage cache, partial translation checkpoint, rerun | T12,T13 |
| Title song song | T11 |
| Conditioning, reference upload, server warm worker | T16 |
| Whisper/model warm start | T15 |
| STTN I/O đã tối ưu | T18 bảo vệ regression; không tính lại thành gain mới |
| GUI đồng thời nhiều tab, orphan process, IPC | T04,T19,T21 |
| Chất lượng nghĩa/âm đầu cuối/mask/font | T02,T17,T18 |

## 5. Chỉ số và evidence phải bàn giao

Mỗi biến thể có commit/config/model/runtime/source hashes, thiết bị/driver, requested/effective provider, cold/warm/cache state, n quan sát, median/range và p95 khi đủ n. Kèm E2E, stage active/wait, retries/calls/bytes, RAM/VRAM/scratch peak, cache hits, success/cancel/fail và bản so chất lượng.

T01 định nghĩa `benchmark-v1`; terminal job event là nguồn tổng thời gian, không cộng các span overlap. Các file JSON/Markdown là deliverable bắt buộc; đồ thị chỉ là cách trình bày thêm.

## 6. Cơ chế chọn và loại tối ưu

Giữ mặc định nếu chất lượng hoặc ổn định chưa đạt. Một tối ưu không đạt mức lợi ích lớn hơn noise phải giữ off hoặc loại bỏ để tránh chi phí bảo trì. Không cố giữ mọi ý tưởng chỉ vì đã nằm trong planning.

Không tự bật OCR ROI, FP16/quantization, model nhỏ, giảm FPS, đổi encoder/CRF hoặc giảm STTN window. Những hướng này có thể đổi chất lượng và chỉ được khảo sát sau khi các tối ưu tương đương hoàn tất. Không chạy nhiều TTS request hoặc streaming dịch→TTS trước khi hiểu tài nguyên server và dependency ngữ nghĩa.

Chỉ thử cache toàn video lossless khi quota/headroom phù hợp; tránh đổi chờ CPU thành tràn đĩa. Chỉ thử loại bỏ probe/copy lặp khi fingerprint và định dạng đầu vào chứng minh có thể tái sử dụng.

## 7. Nguồn lực và thông tin bên ngoài

Chưa ước lượng lịch ngày hoàn thành vì chưa có baseline, máy mục tiêu và backend. Đánh giá effort lại sau T01/T02/T04, dựa trên task đã hoàn thành và độ ổn định thực tế.

Các gate cần input khi thực thi: corpus video thật được dùng, ngân sách gọi dịch/TTS live, mã/commit và kiến trúc server, máy AMD/Intel/macOS nếu muốn công bố hỗ trợ, kênh runtime công khai/private có auth. Có thể làm toàn bộ regression/fixture/local build độc lập trong lúc chờ các input này.

## 8. Lệnh kiểm tra theo cấp

Mỗi task code:
```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-telemetry.test
git diff --check
```
Lệnh telemetry trên minh họa cấp kiểm tra của T01; từng task dưới gói con có lệnh cụ thể cần chạy. Khi tạo test file mới phải đăng ký runner nếu runner có allowlist; chạy file khác không chứng minh test mới được thực thi.

Trước release:
```powershell
npm.cmd run test:local-runtime
npm.cmd run test:ocr-engine
npm.cmd run test:separator-engine
npm.cmd run test:sttn-engine
npm.cmd run fonts:verify
npm.cmd run test:subtitles
npm.cmd run release:verify
npm.cmd run release:verify-runtime
npm.cmd run package:verify
```
Chọn venv có dependency thực; fail gate nếu test media/model bắt buộc bị skip. FFmpeg managed phải nằm trên PATH của process test. Metadata verifier pass không thay thế package/E2E acceptance.

## 9. Trạng thái lúc bàn giao planning

Chỉ thêm spec, master, bốn gói kế hoạch và task handoff. Không sửa source/config/dependency hoặc tự bật tính năng. Kết quả 418 TS tests và các suite Python trong review là evidence lượt trước; 22 focused tests của khảo sát cũng là evidence trước. Lượt planning chỉ chạy lại typecheck và kiểm tra tính nhất quán của tài liệu; không có benchmark mới.
