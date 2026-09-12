# AutoShort Cut Repair A — Editor and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa UI, input/history và legacy resume; lưu draft/applied edit bền vững, chạy đúng snapshot và preset từng video.

**Architecture:** Pure editor state và semantic edit tách nhau. Main giữ store/CAS và run snapshot; Renderer chỉ đề nghị edit, không sửa snapshot đang chạy. UI cắt dùng vùng có giới hạn quanh video trong AutoShort.

**Tech Stack:** React/TypeScript, typed preload IPC, Node atomic JSON store, test runner hiện hữu.

**Spec:** [Repair design](../specs/2026-09-12-autoshort-cut-repair-design.md), [master plan](2026-09-12-autoshort-cut-repair.md).

## Global Constraints

Kế thừa nguyên vẹn Global Constraints master. Đọc `src/shared/AGENTS.md`, `src/renderer/AGENTS.md`. Không thay Video Editor hoặc serialize secrets. A01/A02/A03 sau P00; A04 sau A03/B04; A05 sau A04. Tên kiểu/hàm ở spec repair là contract chung, không tự đổi giữa các task. Tests mới phải được thêm `knownTests` trong `scripts/run-local-runtime-tests.mjs` trước chạy.

## File map

| Create | Trách nhiệm |
|---|---|
| `src/shared/autoShortCutContract.ts` | V2 edit/index/IPC/error types, validator không I/O |
| `src/shared/autoShortCutEditor.ts` | Parse draft, raw history, run intent; không hash/process |
| `src/main/autoShortCutIdentity.ts` | Legacy digest compatibility, semantic hash |
| `src/main/autoShortEditStore.ts` | Atomic edit document + checksum/backup/CAS |
| `src/main/autoShortRunSnapshot.ts` | Snapshot v2, sanitized config, immutable execution identity |
| `src/renderer/src/components/AutoShortCutTimeline.tsx` | Timeline thumbnails/markers/waveform/zoom, controlled state |
| `src/renderer/src/hooks/useAutoShortCutEditor.ts` | Per-item draft/save/status/IPC cleanup |
| `src/shared/autoShortCutPreset.ts` | Validate preset và expand kết quả per-item |
| `scripts/smoke-autoshort-cut-ui.mjs` | Isolated app/profile UI smoke; không sửa dữ liệu user |

Modify files trong từng task; không tách lại toàn `AutoShort.tsx` hoặc `autoshort.ts` ngoài phần feature.

## A01 — Giữ vùng video và chặn input trống

**Findings:** F04/F10. **Modify:** `AutoShort.tsx`, `AutoShortCutPanel.tsx`, `styles/autoshort.css`; đọc `styles/editor.css`, chỉ sửa shared CSS nếu có regression Video Editor. **Create:** `autoShortCutEditor.ts`, `tests/autoshort-cut-editor.test.ts`, smoke script trong file map.

**Interfaces:** `parseCutSeconds(raw)` theo spec; thêm `.autoshort-cut-workspace` wrapper, `.autoshort-cut-tools` area. UI wire existing temporalEdit v1 ở bước này; không giả đã có exact frame. Sau A02/A05 thay bằng draft v2.

- [ ] Viết regression parser với Node assert; test này kiểm đầu vào người dùng, không mirror render markup:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCutSeconds } from '../src/shared/autoShortCutEditor'
test('rejects empty and ambiguous draft numbers', () => {
  for (const raw of ['', ' ', '-1', 'Infinity', '1e3', '1,2.3']) {
    assert.equal(parseCutSeconds(raw).ok, false, raw)
  }
  assert.deepEqual(parseCutSeconds(' 1,25 '), { ok: true, seconds: 1.25 })
  assert.deepEqual(parseCutSeconds('0'), { ok: true, seconds: 0 })
})
```

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-cut-editor.test`; lưu red. Dùng evidence harness review làm điều kiện đối chứng bố cục; actual app smoke phải dùng code checkout, không snapshot commit cũ.
- [ ] Implement parser strict: cho dấu `.` hoặc `,` thập phân duy nhất, không scientific notation/negative/group separators; dùng parsed result trước `applyRange`, trả lỗi cạnh field.

```ts
export function parseCutSeconds(raw: string):
  { ok: true; seconds: number } | { ok: false; error: string } {
  const text = raw.trim()
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) return { ok: false, error: 'Nhập mốc thời gian hợp lệ.' }
  const seconds = Number(text.replace(',', '.'))
  return Number.isFinite(seconds) && seconds >= 0
    ? { ok: true, seconds } : { ok: false, error: 'Mốc thời gian không hợp lệ.' }
}
```

- [ ] Đặt named area cho header/stage/transport/tools; tools không được nhận hàng `1fr`. CSS hướng thực thi:

```css
.autoshort-page .autoshort-cut-workspace {
  display: grid;
  grid-template-areas: "head" "stage" "transport" "tools";
  grid-template-rows: auto minmax(200px, 1fr) auto auto;
  min-height: 0;
}
.autoshort-page .autoshort-cut-workspace > .editor-stage-head { grid-area: head; }
.autoshort-page .autoshort-cut-workspace > .editor-stage-shell { grid-area: stage; }
.autoshort-page .autoshort-cut-workspace > .editor-transport { grid-area: transport; }
.autoshort-page .autoshort-cut-tools { grid-area: tools; min-height: 0; }
```

- [ ] Thêm compact responsive groups và bounded list/inspector: ở 696×596 stage>=240; 440px stage>=200; nếu tools không vừa thì inspector/list cuộn, không tăng height toàn trang để giả pass. Theo control tokens/input style chung; summary phút:giây.millisecond, frame label ở B01/C04. Không hiển thị 6 decimals như lời hứa accuracy.
- [ ] Chạy parser suite + `npm.cmd run typecheck`; kiểm browser/Electron: closed/open,empty/list/error,preview9:16/adjustments,fullscreen,keyboard; lưu ảnh before/after và kích thước. Video Editor vẫn đúng khi không có `.autoshort-page`.
- [ ] Gate/review: video không bị che, blank không apply, một primary action/context; commit `fix(autoshort): preserve preview while editing cuts`, chỉ add file thuộc A01.

## A02 — Schema v2, ID và lịch sử từng video

**Findings:** F11/F10; nền F01/F03. **Create/Modify:** `src/shared/autoShortCutContract.ts`, `src/shared/autoShortCutEditor.ts`, `src/shared/autoShortTemporalEdit.ts`, `src/shared/types.ts`, `src/shared/autoShortContract.ts`, `src/main/autoshort.ts`, `src/main/autoShortItemCoordinator.ts` (narrowing schema tại adapter); **Tests:** `tests/autoshort-cut-editor.test.ts`, `tests/autoshort-temporal-edit-contract.test.ts`, new `tests/autoshort-cut-v2-contract.test.ts`.

**Interfaces:** các kiểu spec mục 3; `normalizeFrameCutRanges`, `reduceCutHistory`, `chooseCutRunIntent`. Existing v1 type giữ để import/legacy, không đổi ý nghĩa serialized payload. `validateAutoShortTemporalEditV2(raw:unknown):AutoShortTemporalEditV2` kiểm cấu trúc; Main B01/B02 mới kiểm boundary thật.

`AutoShortQueueItemInput.temporalEdit` nhận union `AutoShortTemporalEdit | AutoShortTemporalEditV2`. Validator phân nhánh theo schemaVersion; old compiler chỉ nhận v1 sau narrowing, executor v2 dùng B02. P00 chặn cut execution trước các nhánh chưa có capability; không ép v2 bằng type cast sang timestamp v1 để vượt typecheck.

- [ ] Test raw history: hai `replace` transaction `[1,3)` rồi thêm `[2,4)`, normalize applied thành `[1,4)` nhưng undo còn đúng `[1,3)`, redo `[1,4)`. Assert state input immutable; history cap200; mỗi drag chỉ push khi pointerup/commit. Duplicate raw IDs/out-of-range index/unknown schema/mode/null phải reject trước run.

```ts
const boundary = (i: number) => ({ presentationIndex: i, ptsTicks: String(i), timeBase: { num: 1, den: 1 }, eof: i === 6 })
const first = { id: 'one', start: boundary(1), end: boundary(3) }
const second = { id: 'two', start: boundary(2), end: boundary(4) }
const empty = { operations: [], reviewResolutions: [] }
let h = { past: [], present: empty, future: [] } as CutHistory
h = reduceCutHistory(h, { type: 'replace', content: { operations: [first], reviewResolutions: [] } })
h = reduceCutHistory(h, { type: 'replace', content: { operations: [first, second], reviewResolutions: [] } })
assert.equal(normalizeFrameCutRanges(h.present.operations).length, 1)
assert.deepEqual(reduceCutHistory(h, { type: 'undo' }).present.operations, [first])
assert.deepEqual(h.present.operations, [first, second])
```

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-cut-editor.test autoshort-cut-v2-contract.test autoshort-temporal-edit-contract.test`, xác nhận red đúng hành vi.
- [ ] Implement union trên copy, unique ID validation trước union. Sửa v1 compiler keep ID dùng cặp boundary hoặc chỉ số keep nhất quán để không lặp `keep-1`; v2 segmentId ổn định theo source indices. Implement history mỗi action immutable; undo/redo không dùng union làm raw state. Giới hạn raw1000/JSON2MiB fail rõ, không cắt bớt.

```ts
// undo branch of reduceCutHistory
if (action.type === 'undo' && state.past.length > 0) {
  return {
    past: state.past.slice(0, -1),
    present: state.past[state.past.length - 1],
    future: [state.present, ...state.future].slice(0, 200)
  }
}
```

- [ ] Pure run-intent: draft trước, config/effective-edit khác snapshot thì new-run, không có diff thì resume. Revision-only/equivalent edit không làm semantic cache miss; stale token vẫn đổi.
- [ ] Gate: suite pass + typecheck; test keep IDs với v1 bỏ `[0,1),[2,3)` trên nguồn4s; restore union và undo có semantics khác rõ. Commit `fix(autoshort): separate cut history from execution ranges`.

## A03 — Khôi phục tương thích no-cut legacy

**Finding:** F02. **Create:** `autoShortCutIdentity.ts`, `tests/autoshort-cut-legacy-resume.test.ts`; **Modify:** `autoshort.ts`, `autoShortBatchStore.ts` chỉ khi cần legacy reader, `tests/autoshort-stage-cache.test.ts`, `tests/autoshort-batch-resume.test.ts`.

**Interfaces:** `legacyNoCutDigests(config)` theo spec. Extract checkpoint serializer của parent `2d4a882` thành compatibility function không đổi bytes; tính thêm fingerprint no-cut của `0d7fa21`. Chỉ lookup candidate sau verify `temporalEdit===undefined`, sourceDigest/config đã validate. Không nới digest của cut job.

- [ ] Tạo fixtures journal/checkpoint bằng serializers từ hai commit, lưu nhỏ tại `tests/fixtures/autoshort-cut-legacy/` cùng source commit và expected hashes. Có pending/interrupted/succeeded; v1-cut tách case phải được hướng import/review thay vì resume tự động.
- [ ] Test digest và **gọi resumeAutoShortBatch thật** qua test-profile store, stub launch boundary để capture request/model calls=0; dùng config baseline của `autoshort-stage-cache.test.ts`. Assert request no-cut đúng, old success receipt byte-identical. Hai công thức cần giữ:

```ts
export function legacyNoCutDigests(config: AutoShortConfig): readonly string[] {
  const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
  return [hash(config), hash({ config, temporalEdit: undefined })]
}
```

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-cut-legacy-resume.test autoshort-batch-resume.test autoshort-stage-cache.test`; red phải tái hiện “Cấu hình hiện tại khác…” của legacy fixture, không dừng ở mock initialization.
- [ ] Implement no-cut-only compatibility. Log identity version thay vì full config. Corrupt digest/source hoặc changed config vẫn bị từ chối. Không rewrite cached manifest/receipt cũ, không đổi fingerprint qua serializer mới rồi coi tương đương.
- [ ] Chạy suites + `autoshort-batch-store.test`, typecheck; fault current/backup checksum, unknown schema, succeeded receipt mismatch. Gate: không gọi thêm model/encoder khi legacy source cue checkpoint hợp lệ. Commit `fix(autoshort): preserve legacy no-cut resume identities`.

## A04 — Edit store, journal v2 và snapshot immutable

**Findings:** F02/F03/F07/F11. **Depends:** A02/A03/B04. **Create:** `autoShortEditStore.ts`, `autoShortRunSnapshot.ts`, `tests/autoshort-cut-edit-store.test.ts`, `tests/autoshort-cut-run-snapshot.test.ts`; **Modify:** `autoShortBatchStore.ts`, `autoShortBatchJournal.ts`, `autoshort.ts`, `autoShortContract.ts`, `types.ts`, `preload/index.ts`, `main/index.ts`.

**Interfaces:** `createCutEditStore`, get/save IPC theo spec. New `BatchSnapshotV2` trong journal: schemaVersion2,jobId,revision,createdAtUtc,updatedAtUtc,`runConfig:AutoShortConfig`,`runConfigDigest`,optional originJobId,items. Mỗi item giữ các field hiện có + `appliedEdit?:AutoShortTemporalEditV2`, `executionIdentity?:CutExecutionIdentity`,optional originItemId; validated execution plan/media manifest gắn lúc prepare. Snapshot union đọc v1/v2, namespace writes v2. Config whitelist versioned từ toàn bộ output-affecting keys hiện hành (kể cả overlay nếu đã tích hợp); ttsOptions theo runtime capability allowlist, reject credential fields và credential-bearing URL, resolve auth qua profile hiện hành. Không persist bearer/apiKey/password trong nested object.

Item v2 dùng `Omit<BatchItemRecord,'temporalEdit'>` rồi thêm các field v2 trên, không lưu đồng thời temporalEdit v1 và appliedEdit v2. Adapter snapshot→queue gán `temporalEdit: item.appliedEdit`. Cut item bắt buộc có executionIdentity đã freeze trước enqueue; prepared manifest/checkpoint là kết quả thực thi tham chiếu identity đó, không đổi config/edit của snapshot sau start.

- [ ] Regression real-filesystem store: save→restart load; draft khác applied; stale CAS giữ both local draft/canonical applied; crash giữa tmp/rename; backup hỏng; symlink/junction ngoài root; empty restore vẫn giữ monotonic document revision.

```ts
const root = await mkdtemp(join(tmpdir(), 'cut-store-test-'))
const store = createCutEditStore(root)
const doc: CutEditDocument = {
  schemaVersion: 2, editId: 'edit-1', revision: 1, itemId: 'item-1',
  sourceDigest: 'a'.repeat(64), frameIndexRevision: 'index-v2',
  draft: { operations: [], reviewResolutions: [] }
}
await store.save(doc, null)
await assert.rejects(store.save({ ...doc, revision: 2 }, 0), /CUT_STALE_REVISION/)
assert.deepEqual(await createCutEditStore(root).get('edit-1'), doc)
// Test finally must verify root containment, then remove only this owned scratch.
```

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-cut-edit-store.test autoshort-cut-run-snapshot.test autoshort-cut-legacy-resume.test` và ghi red.
- [ ] Implement serialized write chain, safe ID→contained path, checksum envelope, atomic tmp+rename+backup và revision compare trước write; validate get/save ownership by sender/item/source. Apply resolves boundaries bằng index thật, canonicalize, hash B04 và save trước enqueue. Draft autosave không thay run journal. Source relink cùng hash giữ doc; khác hash giữ draft cần revalidate.
- [ ] Implement v2 resume overload lấy non-secret config/applied edit từ snapshot; input UI config bị loại khỏi authority. Khác config/effective edit thành new run; không đổi succeeded items/receipt. v1 timestamp cut import draft với snap diff, yêu cầu Apply sau xem; giữ original namespace/receipt. Resume cut v1 vẫn bị guard P00 chặn, không tự chuyển semantics.
- [ ] Gate: restart sau draft save/trước enqueue/trong running,corrupt/CAS,legacy no-cut,v1-cut import,unknown version,downgrade và secrets fixture; suites + typecheck. Diff snapshot trước/sau UI edits phải byte-identical tới khi tạo job mới. Commit `feat(autoshort): persist versioned cut edits and run snapshots`.

## A05 — Gắn UI draft/applied, batch preset và new-run

**Findings:** F03/F04/F10/F11; Core R04/R13/R14/R15. **Create:** hook/timeline/preset trong file map; `tests/autoshort-cut-preset.test.ts`, `tests/autoshort-cut-run-intent.test.ts`; **Modify:** `AutoShort.tsx`, `AutoShortCutPanel.tsx`, `styles/autoshort.css`, smoke script; APIs frame/preview từ B01/C04 nối khi capability có thật.

**Interfaces:** `chooseCutRunIntent`, `CutPreset = {kind:'head-seconds'|'tail-seconds';value:number} | {kind:'head-frames'|'tail-frames';value:number} | {kind:'absolute';ranges:{startSeconds:number;endSeconds:number}[]}`. `expandCutPreset(preset, items, resolve)` async trả per-item `{itemId,ok:true,ranges:FrameCutRange[]} | {itemId,ok:false,error:string}`; `items` gồm itemId/durationSeconds/frameCount; `resolve(itemId,seconds)` dùng B01, frame preset lấy boundaries theo index page. Không clamp source ngắn.

- [ ] Viết run-intent và UI integration cases: restore-all resumed item → new run; config change → new run; unchanged → resume; draft → resolve-draft; source switch không lẫn history/request. Action trong input/contenteditable không kích hotkey.

```ts
assert.equal(chooseCutRunIntent({ hasDraft: true, snapshotChanged: false, hasResume: true }), 'resolve-draft')
assert.equal(chooseCutRunIntent({ hasDraft: false, snapshotChanged: true, hasResume: true }), 'new-run')
assert.equal(chooseCutRunIntent({ hasDraft: false, snapshotChanged: false, hasResume: true }), 'resume')
```

- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-cut-run-intent.test autoshort-cut-preset.test autoshort-cut-editor.test`, rồi red UI case phải kiểm actual payload không chứa cut stale.
- [ ] Implement decision theo thứ tự dưới, wire CTA và Apply/Discard UI; autosave failure hiện lỗi, giữ local draft, Start không enqueue khi Apply chưa persist. No-edit mới đi fast path; sửa cut đã resume tạo new job/output và origin link.

```ts
export function chooseCutRunIntent(input: {
  hasDraft: boolean; snapshotChanged: boolean; hasResume: boolean
}): CutRunIntent {
  if (input.hasDraft) return 'resolve-draft'
  if (input.hasResume && input.snapshotChanged) return 'new-run'
  return input.hasResume ? 'resume' : 'start'
}
```

- [ ] Build controlled timeline theo source index: thumbnails window/paging, waveform khi có audio, kept/removed labels+color,source/edited clocks,zoom/selection,range list,undo/redo,Apply/Discard. Waveform request on-demand/worker với resource ownership B01, không chạy full-source AI. Frame controls disabled có lý do nếu index chưa sẵn; after-cut controls nối C04 khi preview capability đạt.
- [ ] Preset batch preview tất cả item với snapped bounds/duration và lý do invalid; nút áp dụng tập hợp lệ chỉ hoạt động khi user đã chọn subset. Ví dụ trim-head3s với source2s/10s: source2s invalid,source10s còn7s,không tự bỏ item2s khỏi batch. Frame presets test mixed25/30fps khác duration cắt nhưng đúng số frame. Preset snapshot expanded từng item, không giữ mutable preset làm run authority.
- [ ] Gate: scoped tests + typecheck, UI app actual profile tại1040/wide,panel696/440,DPI100/125/150,keyboard-only,draft conflict/long list/fullscreen. So sánh screenshot A01 để đảm bảo tools mới không chiếm lại stage. Commit `feat(autoshort): connect cut drafts presets and immutable runs`.

## Bàn giao A

Chỉ đóng F02/F03/F04/F10/F11 khi có tests và UI evidence tương ứng; không đánh dấu exact-frame/preview/media pass từ A. A04/A05 phải kiểm lại sau C04. Docs cập nhật luồng draft/applied/resume và migration; mọi file mới được task record liệt kê, commit theo path allowlist.
