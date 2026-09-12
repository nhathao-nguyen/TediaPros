# Kế hoạch triển khai Cắt đoạn trong AutoShort

- **Ngày:** 2026-09-12.
- **Trạng thái:** IN PROGRESS — Core MVP theo timestamp đã triển khai. T02/T04/T08/T09/T10 có phần đã làm; exact-frame, provenance/cue review, preview chính xác và nghiệm thu matrix đầy đủ còn mở. Checkbox chi tiết bên dưới vẫn là gate của bản Core hoàn chỉnh, không được hiểu là đã đạt chỉ vì MVP chạy.
- **Baseline:** HEAD `2d4a8822c05a99bd1101f758811044631b4f88d0`, package `0.1.26` tại lúc lập kế hoạch.
- **Spec:** [Đặc tả chức năng](../specs/2026-09-12-autoshort-temporal-cut-design.md).
- **Bàn giao:** [Task planning](../../../.ai/tasks/TASK-20260912-autoshort-temporal-cut-planning.md).
- **Cách thực hiện:** làm tuần tự theo dependencies; không cần skill ngoài repo để đọc/thực hiện plan. Chỉ dùng subagent khi người dùng yêu cầu. Không coi yêu cầu viết tài liệu là yêu cầu triển khai, chạy provider tính phí hoặc cài lại WinLocal.

## 1. Mục tiêu, constraints và ranh giới hoàn thành

Thêm Cắt đoạn ngay trong AutoShort với bản cắt riêng từng item, nguồn bất biến, frame/audio schedule chính xác, giữ provenance qua OCR/ASR/dịch/TTS/STTN/render, preview và resume khớp cùng edit revision.

- Đọc AGENTS.md root và module trước khi sửa. Preserve dirty/untracked/worktree hiện có; chỉ stage file thuộc task, không `git add .`.
- Giữ LICENSE/NOTICE, typed IPC, safeContainedPath và pinned runtime/model SHA-256.
- Tempo <=1.80x; protected gap 0.50s theo policy kể cả ngoại lệ EOF; extension <=60% và slowdown <=20% trên retained source unit. Không dùng giới hạn 40% lịch sử; không thay policy trong feature này.
- Giữ no-silent-drop, measured-first, no-progress termination, cancellation và resource leases. Không bật concurrency/prefetch mới hoặc giới hạn tổng request dịch mới.
- Core: T01–T11. Extension A: T12, Extension B: T13; T14 nghiệm thu phần mở rộng. Core không được quảng bá hỗ trợ chức năng extension chưa qua gate.
- New file/API/test là đề xuất. Tên có thể điều chỉnh theo implementation nhưng phải cập nhật bảng traceability, không xóa yêu cầu để giảm scope.
- Mỗi task: red test đúng failure → implementation nhỏ → scoped tests/typecheck → evidence/handoff. Commit theo ranh giới review khi thực hiện; không commit trong task viết kế hoạch này.

## 2. Thứ tự và dependencies

| Task | Nội dung | Phụ thuộc | Kết quả qua gate |
|---|---|---|---|
| T01 | Xác minh baseline và thiết lập evidence | Không | Nguồn, policies, fixture manifest, baseline được ghi rõ |
| T02 | Contract bản cắt và pure time maps | T01 | Canonical intervals, deleted-time null, composition đúng |
| T03 | Frame probe và fixtures thực | T02 | Exact boundaries/EOF/VFR chứng minh trên runtime |
| T04 | Executor cắt hình–tiếng và resource lifecycle | T03 | Media cắt chính xác, no-edit fast path, cancel/ENOSPC đúng |
| T05 | Cue projection và review ngữ nghĩa | T04 | Không giữ text đã bỏ hoặc ghép sai câu qua seam |
| T06 | Dubbing, replay và audio integration | T05 | Không hồi sinh frame; giữ đủ lời theo policy |
| T07 | OCR/STTN/mask qua mối nối | T04, T05 | Không temporal context/mask xuyên seam |
| T08 | Edit store, run snapshot, migration/cache | T02, T06, T07 | Resume đúng revision, legacy an toàn |
| T09 | Bảng cắt, frame-step, exact preview | T03, T04, T05, T08 | Preview/input/history/async isolation hoạt động |
| T10 | Batch presets, publication và telemetry | T06–T09 | Batch độc lập, output/SRT/SEO cùng identity |
| T11 | Nghiệm thu và giao Core | T01–T10 | Traceability R01–R18, media/GUI/fault tests đạt |
| T12 | Thay hình giữ thời lượng | T11 | Contract mới, visual/audio evidence tách biệt |
| T13 | Suggestions và thao tác transcript | T11 | Không auto-delete, alignment và undo đúng |
| T14 | Nghiệm thu các extension | T12 hoặc T13 đã làm | Chỉ mở capability có evidence đạt |

Dependencies không yêu cầu chạy nhiều agent. Khi implementation bắt đầu, chọn worktree `codex/autoshort-temporal-cut` nếu cần cô lập, sau khi kiểm tra chưa tồn tại và không có dữ liệu chưa commit cần bảo vệ ở đó. Không tự dọn worktree khác.

## 3. Ma trận truy vết yêu cầu và fixtures

Fixture Fxx là ID nhóm evidence. Các subcase `worst`, `recovery`, `normal` phải cùng có expected outcome; một ID không đại diện duy nhất cho một assertion. Negative case đạt khi hệ thống từ chối đúng, không ép mọi đầu vào phải xuất thành công.

| Requirement | Fixture | Task sở hữu | Bằng chứng bắt buộc |
|---|---|---|---|
| R01 | F01 | T04, T08, T10 | Hash nguồn/output cũ trước/sau, relink cùng/khác hash, crash publish |
| R02 | F02 | T02–T04, T09 | Frame markers CFR/VFR/GOP/B-frame/EOF, raw PTS và output decoded |
| R03 | F03 | T02, T09 | Invalid intervals, all-delete, overlap/touch/idempotence, tiny remainder |
| R04 | F04 | T02, T09 | Head/tail/middle cuts, source/edited clocks, restore một range |
| R05 | F05 | T05, T09 | Cắt từ/phủ định/số/âm cuối; review resolution và intentional-cut policy |
| R06 | F06 | T02, T12, T14 | Core reject mixed mode; extension hold duration/audio không đổi |
| R07 | F07 | T05, T07 | Cue zero/one/many fragments, provenance, word effect/SRT |
| R08 | F08 | T05, T08 | Đổi context nhưng giữ ID vẫn invalidate translation |
| R09 | F09 | T06 | Measured tempo, retained headroom, replay owner whitelist, EOF |
| R10 | F10 | T04, T06 | PCM sample markers, nonzero stream offset, no-audio, BGM modes |
| R11 | F11 | T07 | Seam-adjacent OCR boxes, synthetic gaps, short STTN segment |
| R12 | F12 | T09 | Stale async response, preview-source change, exact preview/export agreement |
| R13 | F13 | T09 | Focus, keyboard typing, Escape, per-item undo, 1040px layout |
| R14 | F14 | T10 | Mixed duration/FPS, invalid subset, seconds vs frames, immutable expansion |
| R15 | F15 | T08, T10 | Restart matrix, CAS conflict, immutable snapshot, pending review |
| R16 | F16 | T08, T10 | Key mutation matrix, cache corruption/lease, receipt mismatch |
| R17 | F17 | T03, T04, T10 | ENOSPC, decoder failure, 1.000 ranges, no orphan/cancel latency |
| R18 | F18 | T10, T11 | Full decode, final timeline/subtitle/SEO identity, metadata failure isolation |
| R19 | F19 | T13, T14 | Dark scene/quiet music false positives, stale suggestions, transcript alignment |

## T01 — Baseline, instructions và evidence manifest

**Inspect:** `AGENTS.md`, `docs/architecture.md`, `docs/domain.md`, ADR 002/005/006, `src/shared/AGENTS.md`, `src/renderer/AGENTS.md`, `src/main/dubbing/AGENTS.md`, `src/main/inpainting/AGENTS.md`; đọc separation/engines AGENTS khi công việc thực sự chạm module đó.

**Create trong implementation:** `.ai/tasks/autoshort-temporal-cut-acceptance/manifest.json`, `README.md`; task record theo template.

- [ ] Ghi branch/HEAD/package, dirty file inventory, active jobs/processes, runtime FFmpeg/FFprobe/engine revisions, policies hiện tại. Không chạy test can thiệp profile đang xử lý batch.
- [ ] Chọn profile test/output root riêng bằng `TEDIAPROS_TEST_USER_DATA`; không dùng media riêng của người dùng nếu fixture tổng hợp đủ.
- [ ] Đọc call sites của `AutoShortQueueItemInput`, start/resume/preview, checkpoint fingerprint, publication receipt, subtitle layout và retime. Ghi source pointer theo symbol/line tại commit triển khai.
- [ ] Chạy `npm.cmd run typecheck` và baseline suites `autoshort-ocr-contract.test`, `autoshort-batch-resume.test`, `dubbing-retime.test`, `autoshort-publication-timeline.test`. Lưu failures có sẵn, không gọi feature test green khi nền đã lỗi.
- [ ] Lập F01–F19 manifest gồm trường hợp, synthetic generation seed, source SHA-256, runtime revisions, expected map độc lập, scope Core/extension và nhãn NOT_RUN ban đầu.

**Gate:** baseline và evidence boundary review được; không có hằng số lịch sử bị dùng làm policy hiện tại. Chưa mở UI feature.

## T02 — Contract, canonical ranges và map thuần

**Create:** `src/shared/autoShortTemporalEdit.ts`, `src/shared/autoShortTimeMap.ts`, `tests/autoshort-temporal-edit-contract.test.ts`, `tests/autoshort-cut-time-map.test.ts`.

**Modify:** `src/shared/types.ts`, `src/shared/autoShortContract.ts`, `scripts/run-local-runtime-tests.mjs`.

- [ ] Viết red tests F02/F03/F04/F06: NaN, Infinity, unsafe integer, malformed rational/ticks, EOF, reversed/outside ranges, empty output, no retained frame, invalid source/index identity, unknown schema/mode, payload/range limit.
- [ ] Contract per-item optional edit; legacy absent giữ no-cut. Core chỉ nhận ripple-delete. Giữ shared isomorphic, hash ở Main.
- [ ] Normalize union sorted half-open ranges; không tự clamp; idempotent. Raw gesture/history vẫn giữ riêng để undo không bị mất ý nghĩa sau union.
- [ ] Triển khai keep-segment derivation, source→edited optional result, interval→fragments và composition output provenance kể cả replay nhiều lần. Không tái sử dụng phép nội suy continuous timeMap cho deleted points.
- [ ] Test oracle độc lập: nguồn 60s, bỏ [0,3),[20,25), edited=52s, source30→edited22, source22→null. Test adjacency/EOF bằng rational frame boundaries, không chỉ số giây tròn.
- [ ] Test random interval sets dùng seeded PRNG/node:test: đúng complement/union, không trùng/đảo thứ tự, roundtrip ở phần giữ, không có output của frame bị bỏ. Expected membership lấy từ tập frame đơn giản, không gọi lại implementation để tạo expected.
- [ ] Đăng ký test mới vào `knownTests`; runner hiện từ chối tên chưa đăng ký. Chạy scoped suites và typecheck.

**Gate:** pure model giải quyết được deleted/replay/EOF; no-cut normalized behavior tương thích. Tên interface/serialized schema được chốt trong spec trước T03.

## T03 — Probe frame thực, index và fixture generator

**Create:** `src/main/autoShortFrameIndex.ts`, `scripts/generate-autoshort-cut-fixtures.mjs`, `tests/autoshort-frame-index.test.ts`, `tests/fixtures/autoshort-temporal-cut/manifest.json`.

**Inspect/reuse:** `src/main/canonicalDisplayGeometry.ts`, runtime resolver/probe, resource manager, `safeContainedPath.ts`, cách tạo fixtures trong `scripts/generate-ocr-blur-fixture.mjs`.

- [ ] Probe managed binary và options thật. Fixture generator chạy offline, có seed, giữ nguồn/big outputs ở test scratch/ignored path; chỉ commit generator và manifest nhỏ.
- [ ] Tạo CFR 24/25/30/60, fractional 30000/1001, VFR có thời lượng frame bất đều, long GOP/B-frames, frame cuối duration riêng, rotated/SAR source, nonzero audio/video starts, no-audio, decoder-corrupt near seam. Có 1-frame video và keep-segment chỉ 1 frame.
- [ ] Nhúng payload frame ordinal machine-readable và time-coded PCM markers để decode kiểm independently. Không chỉ draw text khó OCR hoặc so tổng frame count.
- [ ] Tạo index paging/on-demand theo presentation frames. Frame step exact được Main trả timestamp/token/frame thực; không dựa trên HTMLVideoElement.currentTime làm proof.
- [ ] Test thiếu/duplicate PTS: chỉ nhận canonical mapping khi chứng minh một-một, nếu không trả unsupported có lý do. EOF sentinel không được decode như frame.
- [ ] Chốt codec/intermediate policy thử nghiệm với bảng frame fidelity, color/geometry, bytes, elapsed; không quyết theo speed đơn thuần. Đánh giá no-extra-lossy option và resource cost trước khi chọn.
- [ ] Test cancel decode/thumbnail, bounded cache/page payload, nguồn đổi trong lúc index/hash, path traversal/junction và nguồn ngoài approved ownership.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-frame-index.test` sau khi đăng ký và typecheck; lưu raw probe + decoded fixture reports F02/F17.

**Gate:** supported/unsupported capability matrix rõ, một-frame cut có oracle thật. Thiếu FFmpeg là BLOCKED media gate, không phải SKIP rồi ghi PASS.

## T04 — Cắt hình–tiếng và nguồn làm việc của coordinator

**Create:** `src/main/autoShortCutMedia.ts`, `tests/autoshort-cut-media.test.ts`.

**Modify:** `src/main/autoShortItemCoordinator.ts`, `src/main/autoShortItemScope.ts`, `src/main/autoShortDiskBudget.ts` chỉ khi cần thêm accounting; mở rộng resource/lifecycle tests hiện có.

- [ ] Red media tests F01/F02/F04/F10/F17 cho first/last/single/multiple frames, overlap canonical result, GOP seek, VFR, audio lead/lag và tiny remainder.
- [ ] Compile schedule từ validated frame boundaries; trim/atrim/setpts/asetpts/concat quản lý chung stream epoch. Compute output sample boundaries từ timeline tuyệt đối, tránh drift theo số seams.
- [ ] Tạo adapter retained segments và join manifest trước các stage AI phụ thuộc timeline. Không truyền một edited file không có provenance vào mọi branch. No-edit dùng đường hiện tại, không encode/copy thêm.
- [ ] Nối edited master khi downstream cần; giữ segment boundary/provenance cho các xử lý temporal. Chọn codec theo gate T03; nếu format/rate buộc resample, lưu selection map và chứng minh không lấy frame đã bỏ.
- [ ] Register child processes, resource lease và disk reservation. Chunk nhiều ranges bằng một schedule toàn cục; không build graph/process tree không giới hạn.
- [ ] Test crash/cancel/full disk/encoder failure: output temp không thành success, source hash/output cũ nguyên vẹn, process close trước cleanup và release. Failed item không làm orphan rồi chuyển sang item tiếp.
- [ ] Compare decoded retained sequence với oracle. PCM prepared duration/sample markers sai <=1 sample; input A–V offset giữ đúng. Đo final encode delay riêng ở T11.
- [ ] Chạy `autoshort-cut-media.test`, `autoshort-item-scope.test`, `autoshort-disk-budget.test`, `autoshort-resource-lifecycle.test`, `autoshort-ocr-pipeline.test` và typecheck.

**Gate:** cắt thuần media đúng với fixture thật. Chưa coi là AutoShort complete vì cue/mask/cache còn chưa nối.

## T05 — Cue provenance và review biên

**Create:** `src/shared/autoShortCutCues.ts`, `src/main/autoShortCutReview.ts`, `tests/autoshort-cut-cues.test.ts`, `tests/autoshort-cut-review.test.ts`.

**Modify:** `src/main/autoShortItemCoordinator.ts`, `src/main/autoShortContentQuality.ts`, `src/main/translation/checkpoint.ts` và identity call sites khi cần; shared contract cho resolution types.

- [ ] F05/F07/F08 red tests: cue bỏ trọn, giữ trọn, bị cắt một/multiple phần, boundary đúng start/end, mất phủ định/số/tên, partial word không có word alignment, repeated text/duplicate IDs.
- [ ] Giữ source ledger immutable; derived cue có source spans/segment/identity mới. Project cue interval thành fragments, không splice text theo tỷ lệ duration.
- [ ] Word-alignment confidence phải có evidence; không có thì nhận dạng lại retained fragment hoặc needs-review. Không yêu cầu full-source model analysis chỉ để mở UI.
- [ ] Thêm review actions cụ thể theo spec; intentional-cut ghi lựa chọn nhưng không chứng nhận semantic preservation. Text tạo mới phải user-edited/recognized/word-aligned có provenance; sanitize như dữ liệu.
- [ ] Mọi resolution gắn edit/evidence revision; sửa cut, transcript hoặc source thì invalidate. Review chưa giải quyết chặn model stage liên quan, không retry cùng input vô ích.
- [ ] Xác định translation context dependency bằng source+retained blocks. Nếu không xác định đủ thì invalidate whole-item translation; không áp dụng heuristic “2 câu gần biên là đủ” như bảo đảm.
- [ ] Không nhóm speech unit xuyên seam. Test no-TTS/no-subtitle original audio intentional cut vẫn xuất được đúng lựa chọn; empty transcript là hợp lệ nếu các module cần text đã tắt.
- [ ] Chạy các test mới, `dubbing-grouping.test`, `translation-identity.test`, `translation-resume.test`, `autoshort-content-quality.test` và typecheck.

**Gate:** một partial cue không thể âm thầm giữ text của phần bỏ hoặc được tự sửa nghĩa. Tự động review không được tuyên bố nhận ra mọi lỗi ngữ nghĩa.

## T06 — TTS, retime và phối âm

**Create:** `tests/autoshort-cut-dubbing.test.ts`.

**Modify:** `src/main/dubbing/timeMap.ts`, `retimeMedia.ts`, `plan.ts`/`synthesis.ts` nếu cần truyền segment ownership; `src/main/autoShortItemCoordinator.ts`, `autoShortNarratedAudio.ts`, `autoShortBackgroundAudio.ts` đúng ranh giới map.

- [ ] Red F09/F10 fixtures: cần replay sát seam; cue trước muốn borrow time xuyên cut; source-end frame bị bỏ; extension tính nhầm cả deleted time; many cuts làm audio drift; partial last cue/EOF.
- [ ] Compose maps trên edited source, owner luôn giữ source segment provenance. Ràng buộc fallback decode thêm 2 frames trong retimeMedia không bước ra ngoài retained owner.
- [ ] Measure→rephrase/recovery→finalize theo policy hiện hành; retained unit budget <=60%, slowdown<=20%, measured tempo<=1.80. Không tăng budget/tempo, cut narration hoặc tự thêm deleted frame.
- [ ] TTS/narration/ASS/word timings dùng output map; source audio/instrumental cùng thứ tự; replay source speech bị tắt theo audio-mode policy; BGM ngoài theo duration cuối, no-audio giữ khả năng chạy.
- [ ] De-click ramp nếu làm phải có A/B PCM evidence và không ăn phoneme/duration; Core không overlap crossfade. Không mở rộng DSP nếu nguyên nhân không thuộc feature.
- [ ] Đo WAV/marker thật và output frame provenance. Synthetic measured fixtures xác nhận physics; live voice run riêng, không dùng mock duration để gọi quality đã pass.
- [ ] Chạy `autoshort-cut-dubbing.test`, `dubbing-plan.test`, `dubbing-retime.test`, `autoshort-tts-pipeline.test`, `autoshort-tts-cache.test`, `autoshort-publication-timeline.test` và typecheck.

**Gate:** không hồi sinh frame, đủ phần lời giữ hoặc explicit error. Audio không phù hợp nội dung vẫn là lỗi cần xử lý, không đạt bằng cách nới policy.

## T07 — OCR/STTN/mask theo retained segments

**Create:** `tests/autoshort-cut-visual.test.ts`.

**Modify:** `src/main/autoShortItemCoordinator.ts`, `src/shared/ocrVisualTimeline.ts`, `src/main/ocr.ts`, `src/main/ocrMask.ts`, `src/main/inpainting/runner.ts` khi integration yêu cầu; chỉ sửa engine Python khi có bằng chứng adapter không đủ.

- [ ] Red F07/F11: box chữ cùng vị trí trước/sau seam nhưng nội dung khác; gap synthetic đúng/sai; OCR cue bị cắt; STTN 1-frame/short segment; retime mask frame sampling sát seam.
- [ ] Adapter gọi processing theo đoạn liên tục; reset OCR stabilization/track và STTN context tại seam. Không giả frame count để lách raw/stabilized validator.
- [ ] Global normalized ROI chuyển về canonical display từng segment, không portrait canvas. Cắt thời gian không đổi geometry hoặc làm zoom/blur/subtitle drag sai.
- [ ] Probe real STTN short-segment capability; nếu không đủ thì error rõ. Nếu cần padding context, chỉ được dùng retained frames hợp lệ trong segment với mapping và loại padding khỏi output; không lấy frame đã bỏ/seam đối diện.
- [ ] Mask selection có hard seam, không nội suy từ segment trước. Visual effects và source audio đều theo cùng edited/output identity.
- [ ] Cho người dùng đổi mode sang blur qua run mới nếu STTN không xử lý được; không fallback tự động. Blur vẫn `format=gbrp` trước maskedmerge.
- [ ] Chạy `autoshort-cut-visual.test`, `ocr-visual-timeline.test`, `ocr-mask.test`, `autoshort-ocr-contract.test`, `autoshort-ocr-pipeline.test`, `autoshort-ocr-burn.test`, `sttn-contract.test`, `sttn-pipeline.test` và typecheck. Nếu sửa Python, chạy `npm.cmd run test:ocr-engine`/`test:sttn-engine` tương ứng.

**Gate:** mock engine call trace đúng và real seam media smoke đạt; thiếu real STTN chỉ được gọi adapter TEST_CONFIRMED, STTN media gate vẫn mở.

## T08 — Edit store, journal v2, cache và rollback

**Create:** `src/main/autoShortTemporalEditStore.ts`, `tests/autoshort-cut-store.test.ts`, `tests/autoshort-cut-resume.test.ts`, `tests/autoshort-cut-cache.test.ts`.

**Modify:** `src/shared/autoShortBatchJournal.ts`, `src/main/autoShortBatchStore.ts`, `autoshort.ts`, `autoShortStageKeys.ts`, `autoShortArtifactCache.ts`, `autoShortItemCoordinator.ts`, `src/shared/types.ts`.

- [ ] Chốt namespace: đề xuất edit store `autoshort-edits-v1`, new batch writes `autoshort-batches-v2`; reader liệt kê được schema 1 và 2, không overwrite schema 1. Ghi quyết định chính thức trong spec trước code migration.
- [ ] Applied edit save atomic/CAS, full non-secret snapshot persist trước enqueue. Save draft riêng, không để draft làm job identity. expectedRevision conflict giữ local draft để UI giải quyết.
- [ ] Add item edit/execution digest cho journal, checkpoint và completion manifest. Snapshot chứa config cần tái dựng + edit, không chỉ hash. Resume không lấy cut/config mutable hiện tại thay snapshot.
- [ ] F15/F16: restart sau save edit/trước enqueue, running→interrupted, source changed, corrupted current/backup, unknown fields/version, legacy no-cut, old receipt, downgrade reader không nuốt edit.
- [ ] Legacy no-cut giữ semantics/digest gốc khi kiểm receipt; nonterminal migration ghi bản mới/backup có liên hệ origin, không sửa dấu chứng nhận cũ. Không tạo v2 success receipt bằng đổi schema label.
- [ ] Dependency mutation tests: một thay đổi cut/ROI/model/prompt/text/context/codec policy đúng stage miss; reorder ranges tương đương không miss vô cớ; edit revision khác nhưng hiệu lực giống vẫn chống stale response bằng token riêng.
- [ ] Lease/cache corruption/quota/cancel put tests. Source digest memo scoped run và xử lý source mutation; old cache no-cut không phục vụ cut run.
- [ ] Chạy các test mới, `autoshort-batch-store.test`, `autoshort-batch-resume.test`, `autoshort-stage-cache.test`, `autoshort-artifact-cache.test`, `translation-resume.test` và typecheck.

**Gate:** crash/restart không mất nội dung edit, không trộn revisions, không chạy lại success sai identity. Rollback app cũ không tự mở new-cut run như no-cut.

## T09 — Bảng Cắt đoạn và preview chính xác

**Create:** `src/renderer/src/components/AutoShortCutPanel.tsx`, `src/renderer/src/hooks/useAutoShortTemporalEdit.ts`, `src/main/autoShortCutPreview.ts`, `tests/autoshort-cut-preview.test.ts`, `tests/autoshort-cut-ui-state.test.ts`, `scripts/test-autoshort-cut-preview.mjs`.

**Modify:** `src/renderer/src/components/AutoShort.tsx`, `src/renderer/src/styles/autoshort.css`, `src/renderer/src/hooks/useVideoTransport.ts` chỉ nếu cần dùng chung; `src/shared/types.ts`, `src/preload/index.ts`, `src/main/index.ts`, STTN preview handler.

- [ ] Viết pure reducer tests F03/F04/F12/F13 trước: drag transaction, draft/apply/Escape, per-item undo/redo, source switch, stale metadata/preview result, revision conflict, keyboard focus guard.
- [ ] Typed API requestId/itemId/sourceDigest/revision; page index và thumbnail window; cancel ownership và artifact token/path validation. Add listener cleanup trên unmount/switch.
- [ ] UI dùng pattern preview hiện có; bảng cắt không thêm top-level tab, không ảnh hưởng Video Editor. Thêm source/edited clock, marker removed/kept, duration sau cut, frame step bằng Main index.
- [ ] Range input draft string, Enter/blur commit hợp lệ, Escape revert. Apply/Discard unapplied change khi Start; không tự snapshot nửa drag. Source preview và after-cut preview có nhãn tách biệt.
- [ ] Exact join preview render bằng production cut planner/executor, cùng source/edit identity; response cũ không overwrite active preview. Cut-only preview không được dán nhãn final TTS/STTN preview; final processed preview dùng map cuối khi artifact đã tồn tại.
- [ ] Review panel đi đến cue/seam cụ thể, phát nghe trước/sau, actions T05; chỉ hiển thị controls có capability. Badge/reasons cho cần xem lại hoặc invalid.
- [ ] Browser/Electron interaction tests bằng test profile: 1040px và rộng, keyboard-only, input typing, drag range, delete single/last frame, apply/cancel, change file while preview in-flight, close panel cancel, restore one/all ranges.
- [ ] Test STTN preview của cut item không lấy video gốc đầu file. Compare exact preview frame sequence với export cut-only cùng plan.
- [ ] Chạy suites mới, `autoshort-ui-contract.test`, `autoshort-region-geometry.test`, typecheck; build rồi chạy GUI harness. DOM snapshot/typecheck không thay được xem/nghe preview và actual IPC payload.

**Gate:** UI đúng revision, frame step có media evidence, không lẫn item hoặc đánh cắp phím nhập liệu. Không để “preview” chỉ là ảnh tĩnh không thao tác được.

## T10 — Batch presets, publication, telemetry và lỗi theo phạm vi

**Create:** `tests/autoshort-cut-batch.test.ts`, `tests/autoshort-cut-publication.test.ts`.

**Modify:** `src/main/autoShortQueueRunner.ts`, `autoshort.ts`, `autoShortItemCoordinator.ts`, `autoShortTelemetry.ts`, shared request/event contracts và AutoShort queue UI; `src/main/videoTitle.ts` chỉ khi identity/content input cần cập nhật.

- [ ] F14 preset expansion mixed FPS/duration: head/tail seconds/frames và absolute ranges. Validate summary trước apply; user-selected valid subset, no auto-clamp/no leaked preset sang item chưa chọn.
- [ ] Run snapshot freeze, state mapping failed/needs-review/interrupted/cancelled; sửa khi running thành new draft/run. Needs-review không nhập vào retry loop cùng đầu vào chưa đổi.
- [ ] Isolate item errors; ENOSPC/global engine unavailable dừng admission cần thiết, không spam lỗi/request cho mọi item. Mục pending vẫn tồn tại và có cách resume.
- [ ] Extend completion manifest/version và reconcile với item edit/config/source/map digest. Fault injection trước/sau output rename, manifest write, journal receipt; chỉ báo success khi đủ bằng chứng, không ghi đè kết quả cũ.
- [ ] Final SRT/word timings và metadata lấy final retained cues/duration. `title`, `titlePath`, `titleError` giữ tương thích; hashtags ở phần riêng theo flow hiện có. Metadata lỗi/hủy không xóa video hợp lệ.
- [ ] Telemetry cut_probe/prepare/review/preview/validate có revision, waits/counts/durations/bytes/error; redact path/transcript/key. Preview cancel không bị tính thành job failure.
- [ ] F18 tests dùng fake provider capture input chứng minh deleted text không gửi vào final SEO; real output decode và timing validation, không chỉ assert file exists.
- [ ] Chạy suites mới, `autoshort-queue-throughput.test`, `autoshort-batch-resume.test`, `autoshort-publication-timeline.test`, `autoshort-video-title.test`, `autoshort-telemetry.test`, `autoshort-resource-lifecycle.test` và typecheck.

**Gate:** batch mixed valid/review/error không mất item; publish đúng revision và không trùng sau restart; metadata failure độc lập.

## T11 — Nghiệm thu Core, tài liệu runtime và rollout

**Create:** `scripts/verify-autoshort-cut-media.mjs`, `tests/autoshort-cut-e2e.test.ts`, `.ai/tasks/autoshort-temporal-cut-acceptance/CORE_REPORT.md` và báo cáo fixture nhỏ.

**Docs:** cập nhật spec bằng quyết định đã đo; `docs/architecture.md`, `docs/domain.md`, ADR source/edited/output mới (chọn số trống tại lúc tạo), ADR 002/005/006 phần thực sự đổi; task handoff.

- [ ] Freeze commit/config/runtime và matrix F01–F18 worst/recovery/normal. Extension F06 hold/F19 vẫn NOT_IMPLEMENTED, không đánh dấu pass Core.
- [ ] Chạy 3 lớp: pure/property tests; real FFmpeg prepared/exported fixtures; actual AutoShort/Electron smoke có OCR/STTN/TTS modes. Test mocks/provider fixtures ghi OFFLINE; live provider tách riêng và chỉ chạy khi trong scope được người dùng cho phép.
- [ ] Synthetic media: 0 removed frame markers, đúng retained order/replay owners; full decode; raw PCM boundary<=1 sample; final marker sync<=20ms sau codec delay; duration so map cuối trong lượng tử frame hợp lệ. Không lấy số test pass để thay chất lượng hình/tiếng/nghĩa.
- [ ] Test nguồn VFR/rotation/SAR/no-audio và các mode OCR/ASR/subtitle-off, manual blur/OCR blur/STTN, original/mix/replace/separate-vocals/BGM, standard/reveal/highlight, zoom/portrait. Pairwise tổ hợp phổ biến + tổ hợp xấu cut+STTN+TTS-replay+resume đầy đủ.
- [ ] Batch 30 mixed fixtures gồm hợp lệ/invalid/review, 1.000 ranges stress, restart tại cut/recognition/TTS/STTN/render/publish. 100% item có outcome đúng kỳ vọng, 0 lost edit, 0 duplicate success, 0 orphan.
- [ ] Benchmark cold/warm: source hash/index, thumbnail first page, edit response, exact preview, preparation/AI/render, disk peak. Mục tiêu spec P95<=100ms cached interaction, first page<=3s trên 1080p local máy baseline; giữ raw measurements/hardware. Không cam kết cùng số trên mọi máy hoặc giảm fidelity để đạt số.
- [ ] No-cut regression: không tăng encode/copy/model calls; compare production trace với baseline. Quota cache/process cancellation vẫn đúng.
- [ ] Chạy `npm.cmd run typecheck`, `npm.cmd run test:local-runtime`, `npm.cmd run test:subtitles`, `npm.cmd run build`; Python suites nếu sửa engine. Tests mới phải được `knownTests` đưa vào full suite.
- [ ] Nếu chuẩn bị artifact Windows: `npm.cmd run fonts:verify`, `npm.cmd run package:win`, `npm.cmd run release:verify-assets`. Packaging smoke không đồng nghĩa đã cài hoặc full batch installed đã pass.
- [ ] Windows 10/11 và macOS ARM64 media/GUI smoke là gate riêng; platform chưa có máy/runtime thì ghi NOT_VERIFIED, giới hạn capability/release claim tương ứng. Không dùng Windows mock để tuyên bố macOS hỗ trợ exact cut.
- [ ] Feature enable chỉ sau gates Core. Rollback tắt entry point mới và giữ edit/journal v2; không cho build cũ xử lý cut job. Cài WinLocal chỉ khi được yêu cầu, kiểm active jobs và giữ rollback theo workflow hiện hành.

**Gate:** Core release đúng chức năng công bố; mọi lỗi/blocker còn lại ghi cụ thể. Không tự coi planning được duyệt là permission chạy provider tính phí/cài sản phẩm.

## T12 — Extension A: thay hình, giữ thời lượng

**Create:** `tests/autoshort-frame-replacement.test.ts`; mở rộng fixture generator F06.

**Modify:** temporal edit schema/validator/compiler/executor/UI; cue/visual evidence routing, journal/cache migration nếu schema thay.

- [ ] Version/discriminant mới cho hold operations, Core-only reader reject rõ. Không silently coerce hold thành delete/no-op.
- [ ] F06: hold ở đầu/cuối, không có frame thay hợp lệ, replacement frame nằm trong deleted range, delete/hold overlap, hold dài, mixed operations, undo/copy preset.
- [ ] Người dùng chọn frame trước/sau rõ ràng. Frame replacement thuộc retained valid source; giữ output duration/audio exactly theo map. Không thêm AI frame interpolation.
- [ ] Tách content evidence khỏi rendered visual OCR: hold một frame có chữ không được biến chữ đó thành transcript lặp; vẫn làm sạch ảnh thay khi bật STTN/blur, xử lý mask/timeline hợp lệ.
- [ ] Compare audio PCM trước/sau hold, timestamps/cue invariance, frame lineage và exact preview. Long hold có preview/nhãn thời lượng, không ngầm sửa nhịp video.
- [ ] Chạy `autoshort-frame-replacement.test`, các cut contract/map/media/cue/visual/cache/resume tests và typecheck; T14 trước enable.

**Gate:** hold không làm A–V drift hoặc thay nguồn lời thoại; không có operation ambiguity.

## T13 — Extension B: suggestions và transcript selection

**Create:** `src/main/autoShortCutSuggestions.ts`, `tests/autoshort-cut-suggestions.test.ts`; UI panel/typed API theo pattern T09.

- [ ] F19 worst/recovery/normal: cảnh tối thật, black flash, quiet music/phoneme, pause có ý nghĩa, stale source/revision, ASR thiếu alignment, video không audio.
- [ ] Detector local trả candidates/reason/confidence và version; không đổi applied edit hoặc gọi model trả phí mặc định. Threshold có cấu hình/giải thích, chưa được hiệu chuẩn thì ghi rõ là heuristic.
- [ ] Accept từng/nhóm candidates qua đúng validator/compiler, có atomic undo; reject giữ source nguyên. Detector failure/cancel không chặn chỉnh tay.
- [ ] Transcript selection dùng evidence source spans; word không align đáng tin thì mở range editor, không suy bằng số ký tự. Review T05 giữ hiệu lực, không bypass vì gợi ý do model tạo.
- [ ] Typed ownership/cancel, cache suggestions theo detector/input config; invalidation khi nguồn/cut thay. Mọi suggestions cũ mất active badge khi mismatch.
- [ ] Chạy `autoshort-cut-suggestions.test`, cut preview/ui/contract/review tests và typecheck; T14 trước enable.

**Gate:** 0 tự xóa ngoài thao tác người dùng; false-positive fixture không thể tự trở thành applied edit.

## T14 — Nghiệm thu phần mở rộng

- [ ] Mở đúng matrix F06 hoặc F19 tùy extension đã implement; chưa làm extension kia giữ NOT_IMPLEMENTED.
- [ ] Rerun regression Core đúng dependency đã thay; full typecheck/local-runtime trước build phát hành extension. Schema migration/rollback phải kiểm với batch Core cũ.
- [ ] GUI + real media kiểm hold/delete phối hợp, suggestions→accept→undo→run→restart, stale request, content/visual evidence và metadata.
- [ ] Báo separate Core/Extension A/Extension B capabilities, build/installed/platform và live/offline evidence. Không gộp “mọi trường hợp pass” khi thiếu một scope.

**Gate:** extension được công bố khớp bằng chứng, không làm giảm bảo đảm Core.

## 4. Commands và cách lưu bằng chứng

Các lệnh sau chạy từ repo root trong implementation. Tên test mới chỉ callable sau khi file được tạo và đăng ký ở `scripts/run-local-runtime-tests.mjs`.

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-temporal-edit-contract.test autoshort-cut-time-map.test
node scripts/run-local-runtime-tests.mjs autoshort-frame-index.test autoshort-cut-media.test
node scripts/run-local-runtime-tests.mjs autoshort-cut-cues.test autoshort-cut-review.test
node scripts/run-local-runtime-tests.mjs autoshort-cut-dubbing.test autoshort-cut-visual.test
node scripts/run-local-runtime-tests.mjs autoshort-cut-store.test autoshort-cut-resume.test autoshort-cut-cache.test
node scripts/run-local-runtime-tests.mjs autoshort-cut-preview.test autoshort-cut-ui-state.test
node scripts/run-local-runtime-tests.mjs autoshort-cut-batch.test autoshort-cut-publication.test autoshort-cut-e2e.test
npm.cmd run test:local-runtime
npm.cmd run test:subtitles
npm.cmd run build
```

Mỗi evidence entry: requirement/fixture/subcase, commit, input hash, edit JSON/hash, runtime versions, expected/actual timeline, commands/exit codes, media metrics, review notes và nhãn CODE_CONFIRMED/TEST_CONFIRMED/UNKNOWN. Fixture gốc/large output đặt ngoài tracked docs; chỉ giữ report và script tái lập nhỏ, redact secrets.

DoD implementation: các task scope đã chọn có evidence, required tests pass, docs runtime khớp, task handoff đủ. Typecheck xanh khi viết spec chỉ kiểm baseline TypeScript, không chứng minh các test/capability tương lai.

## 5. Kiểm tra tài liệu trước bàn giao

- Spec bao phủ R01–R19; matrix plan bao phủ F01–F19, worst/recovery/normal và task owner.
- Tất cả file source đang có được kiểm tra tồn tại; file Create được đánh dấu PROPOSED; không chỉ dẫn gọi skill không có trong môi trường.
- Không có checkbox implementation được đánh dấu hoàn thành trong lần viết này.
- Kết quả typecheck và kiểm tra link/preservation thực tế được ghi ở task planning; không chạy runtime/GUI/engine/media tests chỉ để chứng minh văn bản.
