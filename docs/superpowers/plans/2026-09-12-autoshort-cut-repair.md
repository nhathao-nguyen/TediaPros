# AutoShort Cut Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Thực thi trong task hiện tại; không tạo sub-agent/task khác nếu chưa có yêu cầu cho việc đó.

**Goal:** Sửa toàn bộ 12 findings và hoàn thành Core cắt đoạn theo specs, giữ video xem được, cắt hình–tiếng đúng, snapshot/resume đáng tin và các nhánh AI hiểu mối nối.

**Architecture:** Frame index và rational cut plan là nguồn tính thời gian chung. Main lưu draft/applied/run snapshot độc lập; executor có quota/lease và artifact identity xác định. Renderer dựng công cụ cắt quanh preview; OCR/ASR/STTN/TTS nhận retained segment/provenance, final output được validate trước publish.

**Tech Stack:** Electron 34, React 19, TypeScript 5.7, Vite 6, Node test/esbuild, managed FFmpeg/FFprobe và sidecar hiện có; không thêm UI framework hoặc dependency media mới nếu chưa chứng minh cần thiết.

**Spec:** [Spec repair](../specs/2026-09-12-autoshort-cut-repair-design.md), [spec gốc](../specs/2026-09-12-autoshort-temporal-cut-design.md), [review/evidence](../../../.ai/tasks/2026-09-12-autoshort-cut-review/REVIEW.md).

## Global Constraints

- Baseline review `0d7fa21b911f1eb540140999f5c51dead6141c78`; plan ngày 2026-09-12. Tất cả task bên dưới PLANNED, chưa triển khai.
- Đủ F01–F12 và Core T01–T11/R01–R18; không thu nhỏ thành MVP. Extension hold/suggestions giữ kế hoạch gốc riêng.
- Không thay LICENSE/NOTICE, source hoặc output cũ; typed IPC, shared isomorphic, safeContainedPath và child-exit-before-cleanup.
- Hard tempo 1.80x; protected gap 0.50s theo EOF; extension 60%; slowdown 20%; không tự cắt lời hoặc tăng budget/tempo.
- Blur Planar RGB; không tự chuyển STTN sang blur; runtime/model vẫn SHA-256 pinned.
- Tối đa 1.000 raw ranges, 2 MiB/edit, 200 history transactions; graph chunks <=64 keep segments. Overflow trả lỗi, không truncate.
- Prepared PCM <=1 sample; final A/V markers <=20ms sau codec delay; duration <=1 output-frame tick hợp lệ; 0 removed frames trong output.
- Cached timeline P95<=100ms, first-page 1080p local<=3s trên máy baseline được ghi nhận. GUI/real media/provider/platform là evidence riêng.
- Đọc root/shared/renderer và AGENTS của dubbing/inpainting/separation trước khi sửa các thư mục đó. Kiểm current overrides từ code/ADR khi bắt đầu.
- Dùng worktree `codex/autoshort-cut-repair` ở bước triển khai; không sửa đè dirty overlay/performance/batch work hiện tại. Bảo toàn các tài liệu untracked cần cho task bằng bản sao đã hash, không dùng `git add .`.

## 1. Chia việc và thứ tự

Ba subplan có module, interface, test cycle và gate riêng. Một executor thực hiện lần lượt, không mặc định chạy song song. Chúng cùng dùng contract tại spec repair; thay contract phải cập nhật consumer/test trong cùng thay đổi.

| Đợt | Task | Đầu ra có thể review |
|---|---|---|
| 0 | P00 | Worktree/evidence baseline, guard cut run chưa đạt capability; no-cut còn hoạt động |
| 1 | A01, A02, A03 | UI không che video, input/history đúng, no-cut legacy resume hoạt động |
| 2 | B01 → B02 → B03 → B04 | Index/schedule/executor/validation/cache đúng trên real media |
| 3 | A04 → A05 | Edit store + journal v2, snapshot/new-run UI và preset batch |
| 4 | C01 → C02 → C03; C04 sau A05/B04/C01 | Segment-aware AI, review nội dung, retime, exact preview |
| 5 | C05 → Z01 | Publish/receipt/telemetry, full Core matrix và quyết định enable theo platform |

- [A — UI, lịch sử và phục hồi](2026-09-12-autoshort-cut-repair-a-editor-recovery.md).
- [B — Frame index và media](2026-09-12-autoshort-cut-repair-b-media.md).
- [C — Pipeline, preview và publication](2026-09-12-autoshort-cut-repair-c-pipeline.md).

Thứ tự triển khai mặc định: P00→A01→A02→A03→B01→B02→B03→B04→A04→A05→C01→C02→C03→C04→C05→Z01. Có 16 task; mỗi task có gate riêng. A01/A03 được làm sớm để có bản sửa UI/no-cut kiểm được độc lập. Không merge/enable Core chỉ vì hoàn thành một đợt.

## 2. Task P00 — Cố định baseline và guard chức năng lỗi

**Files:** Create `src/main/autoShortCutCapability.ts`, `tests/autoshort-cut-capability.test.ts`; Modify `src/main/autoshort.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/src/components/AutoShort.tsx`, `scripts/run-local-runtime-tests.mjs`; evidence `.ai/tasks/2026-09-12-autoshort-cut-repair/`.

**Interfaces:** `assertCutRunCapability(hasCut: boolean, coreVerified: boolean): void` (Main). Readiness trả `temporalCut: {editing:boolean; execution:boolean; reason?:string}`; renderer chỉ dùng để trình bày, Main giữ authoritative guard. Guard đặt trước create journal/reserve output/model call, gồm start và cut-resume.

- [ ] Ghi `git status --short --branch`, HEAD, dirty paths/hashes; tạo worktree từ HEAD theo skill using-git-worktrees. Sao chép spec/plan/review cần thiết đúng allowlist, kiểm hash; không mang source dirty của task khác sang như đã review.
- [ ] Đăng ký suite mới rồi viết regression:

```ts
assert.doesNotThrow(() => assertCutRunCapability(false, false))
assert.throws(() => assertCutRunCapability(true, false), /CUT_CORE_NOT_VERIFIED/)
assert.doesNotThrow(() => assertCutRunCapability(true, true))
```

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-cut-capability.test`; red phải do chưa có guard/behavior, không do fixture hỏng.
- [ ] Triển khai guard tối thiểu và readiness. UI vẫn mở/xem/restore draft; Start cho no-cut vẫn hoạt động. Migration v1 cut ở A04 không được tự chạy.

```ts
export function assertCutRunCapability(hasCut: boolean, coreVerified: boolean): void {
  if (hasCut && !coreVerified) throw new Error('CUT_CORE_NOT_VERIFIED')
}
```

- [ ] Gate: snapshot/requests xác nhận cut bị chặn trước model/process; no-cut không phát sinh encode mới; `npm.cmd run typecheck` và suite trên pass. Lưu task record; commit đúng path đã review với message `fix(autoshort): gate unverified temporal cut execution`.

## 3. Ma trận finding → task → bằng chứng đóng

| Finding | Tasks | Điều kiện đóng tối thiểu |
|---|---|---|
| F01 sync | B01/B02/B03/B04/C03 | Microcut không xóa audio riêng; audio offset đúng; decoded oracle + PCM |
| F02 legacy resume | A03/A04/C05 | Journal thật trước/sau commit resume no-cut; old receipt không bị đổi |
| F03 UI resume ignored | A04/A05 | Sửa/restore trên resume → new run đúng plan; old snapshot còn nguyên |
| F04 layout | A01/A05/C04 | Ảnh UI actual profile: video nhìn được, không overflow các state |
| F05 quota/lease | B03/B04/C05 | Temp khác output, maxActive1/2, ENOSPC/cancel không orphan |
| F06 seams/provenance | C01/C02/C03/C05 | No grouping/tracking/replay xuyên seam; review unresolved chặn stage liên quan |
| F07 cache | B04/A04/C02 | Same effective edit warm hit, changed dependency miss, corrupted artifact rejected |
| F08 1.000 ranges | B03/Z01 | Windows real spawn/decode 1.000 ranges bounded memory/process |
| F09 bit depth | B01/B03/B04 | 8/10-bit + PCM formats/colour metadata policy measured; no forced downgrade |
| F10 input | A01/A02/A05 | Blank/space/reversed input không Apply; draft không bị âm thầm bỏ khi Start |
| F11 history/ID | A02/A04/A05 | Overlap undo/redo đúng riêng item, unique IDs, history/cap tests |
| F12 preview | B01/C04 | Same source/edit identity; source switch/stale/cancel; cut/STTN preview theo retained source |

## 4. Core coverage không được bỏ sót

| Requirement gốc | Tasks | Worst → recovery → normal fixture |
|---|---|---|
| R01 nguồn/output | P00/A04/B04/C05 | Mutation/relink/crash → giữ draft/old receipts → publish riêng |
| R02 frame | B01/B02/B04/C04 | VFR/EOF/duplicate PTS → unsupported rõ → step/export cùng frame |
| R03 invalid | A01/A02/B02 | Empty/all-delete/no-frame → sửa/restore → canonical plan |
| R04 source clocks | A05/C04 | Bỏ đầu rồi sửa giữa → source clock/map rõ → không trôi mốc |
| R05 nghĩa ở biên | C01/C02 | Partial word/phủ định/số → review/sửa retained text → cue rõ |
| R06 Core semantics | A02/B02 | Mixed/hold schema sai → reject giữ edit → linked ripple delete |
| R07 cues | C01/C02 | Split/multi-fragment → evidence/re-recognition → source spans đúng |
| R08 translation | B04/C02 | Context change/IDs same → invalidate đủ → warm hit đúng |
| R09 TTS/replay | C03 | Borrow/replay quá seam → recovery đúng trần → fit retained unit |
| R10 audio | B02/B04/C03 | Offset/many joins/no-audio → schedule có evidence → sync đúng |
| R11 OCR/STTN | C01/C03 | Same box/different text/short segment → capability error → reset context |
| R12 preview | C04 | Stale/source switch/export mismatch → cancel/rebuild → exact preview |
| R13 gestures | A02/A05/C04 | Shortcut trong input/wrong item → scoped history → mouse/keyboard |
| R14 presets | A05 | Mixed durations/FPS invalid subset → chọn subset → applied per item |
| R15 persistence | A03/A04/A05 | Restart/CAS/config change → recover immutable/new run → không mất edit |
| R16 cache/receipts | A03/B04/C05 | Legacy/corrupt/mismatch → miss/reconcile rõ → đúng identity |
| R17 resources | B01/B03/B04/C05 | ENOSPC/decoder/hang → drain/pause admission → bounded processing |
| R18 publication | C03/C05 | Wrong SRT/SEO/revision/partial write → giữ video/receipt hợp lệ → đủ output |
| R19 / hold extension | Ngoài repair | Giữ spec T12–T14; không hiện control chưa hỗ trợ |

## 5. Task Z01 — Nghiệm thu Core và rollout

**Depends:** tất cả A/B/C tasks. **Files:** Create `scripts/verify-autoshort-cut.mjs`, `tests/autoshort-cut-acceptance.test.ts`, evidence manifest; Modify capability P00, architecture/domain, spec status, original implementation handoff (thêm correction link, giữ lịch sử), task record và test runner.

**Interfaces:** verifier xuất JSON `{commit,runtimeDigests,hardware,platform,cases:[{id,mode,status,evidencePaths}],coreGate}`. `status` chỉ `PASS|FAIL|NOT_VERIFIED`; capability enable phải dẫn được tới manifest cùng commit/runtime/platform, không chỉ số tests pass. `evaluateCutAcceptance(manifest,requiredIds,expectedIdentity):{ok:boolean;missing:string[];mismatched:boolean}` trong `scripts/verify-autoshort-cut.mjs` là pure gate; requiredIds là registry cố định gồm media/GUI/migration/resource cases, không lấy từ chính observed cases để tự chứng nhận.

- [ ] Đăng ký acceptance suite; test gate không nâng `NOT_VERIFIED` thành pass:

```ts
const expectedIdentity = { commit: 'candidate', runtimeDigests: ['managed-ffmpeg'], platform: 'win32' }
const manifest = {
  ...expectedIdentity, hardware: 'test-baseline',
  cases: [{ id: 'audio-offset', status: 'PASS', evidencePaths: ['offset.json'] },
    { id: 'vfr', status: 'NOT_VERIFIED', evidencePaths: [] }]
}
assert.equal(evaluateCutAcceptance(manifest, ['audio-offset', 'vfr', 'gui-resume'], expectedIdentity).ok, false)
assert.deepEqual(evaluateCutAcceptance(manifest, ['audio-offset', 'vfr', 'gui-resume'], expectedIdentity).missing, ['vfr', 'gui-resume'])
```

- [ ] Thêm fixture ledger nối GF01–GF18 với review F01–F12 và tasks. Mỗi case chạy worst/recovery/normal; lưu expected độc lập executor, không hardcode observed output thành oracle.
- [ ] Chạy full matrix media: CFR24/25/30/60,30000/1001,VFR,B-frames/longGOP,EOF/1-frame,audio lead/lag/no-audio,rotation/SAR,8/10-bit, supported HDR policy,1.000 ranges,high-compression/long input,corruption sát seam. Decode frame payload và PCM markers. Final lossy encode kiểm marker/quality, không so raw pixel hash như lossless.
- [ ] Chạy 30-item batch gồm valid/invalid/needs-review và tổ hợp xấu cut+STTN+TTS-replay+resume; inject restart tại cut/recognition/TTS/STTN/render/publish. 0 mất edit,0 duplicate success,0 orphan; no-cut trace giữ số model/encode calls baseline.
- [ ] Chạy actual Electron test profile với source video: add→draft→Apply→join preview→run→restart/resume→new edit run; keyboard/mouse, windows1040/wide,DPI100/125/150,panel696/440,fullscreen,empty/loading/error/long ranges. Đọc actual IPC payload, xem hình/nghe join; screenshot harness không thay thế acceptance này.
- [ ] Chạy lệnh cuối `npm.cmd run typecheck`, `npm.cmd run test:local-runtime`, `npm.cmd run test:subtitles`, `npm.cmd run build`; Python OCR/STTN/separator suites nếu thay engine. Kiểm full runner đã đăng ký mọi test mới. Không gọi paid/live provider ngoài phạm vi được user cho phép; các mode provider chưa chạy giữ NOT_VERIFIED.
- [ ] Benchmark cold/warm và hardware: hash/index/thumbnail, cached timelineP95, preview elapsed/cancel, prepare/AI/render, peak disk/RAM,1/2item. Nếu không đạt target, xử lý bottleneck rồi rerun case bị ảnh hưởng; không giảm fidelity.
- [ ] Enable capability theo platform đã đủ gates. Windows runtime/media/GUI, installed build và macOS ARM64 ghi riêng. Thiếu máy/runtime không ghi completed cho toàn platform; Core global gate còn mở. Cài WinLocal chỉ khi user yêu cầu, giữ rollback và kiểm active jobs.
- [ ] Gate code review toàn diff: 12/12 findings có regression/evidence, 18/18 Core requirements có outcome, không còn Core requirement chưa làm. Lưu exact commit/runtime/logs. Chỉ sau đó mới tích hợp branch theo ủy quyền hiện hành; không tự push hoặc cài app trong task lập kế hoạch này.

**Rollback:** tắt execution capability cut trong Main+UI; giữ edit/journal v2 và output/evidence. No-cut legacy vẫn dùng được. Không cho old build nhận cut v2 như no-edit; không xóa store để “reset”. Rollback execution không đánh dấu lỗi đã sửa.

## 6. Quy trình làm mỗi task

Mỗi task trong subplan có một test cycle: đăng ký test mới → viết regression → chạy red → implement đúng interface → chạy green/scoped+typecheck → review diff/docs → commit riêng với path allowlist. Red phải là lỗi hành vi mong đợi; missing module ban đầu chỉ kiểm setup, cần thêm regression quan sát fail trước implementation. Không tạo test chỉ đếm chuỗi CSS/filter để chứng minh UI/media.

Artifact evidence theo `.ai/tasks/2026-09-12-autoshort-cut-repair/<task-id>/`; chỉ giữ generator, manifests, số đo và ảnh cần review, scratch/video lớn nằm ngoài Git và có owner cleanup. Chốt baseline mới nếu task khác merge trước triển khai; rerun regression ở integration cuối, giữ overlay/SEO/portrait behavior đang có.

**Definition of Done của repair:** đủ gates Z01, source/old outputs nguyên, Core khớp spec và docs, không còn finding mở bị đổi tên thành “phần sau”. **Definition of Done của task hiện tại:** hoàn thành bộ planning có traceability, kiểm links/coverage/typecheck; chưa sửa implementation.
