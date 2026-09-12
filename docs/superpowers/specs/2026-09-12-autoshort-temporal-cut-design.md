# Đặc tả Cắt đoạn theo thời gian trong AutoShort

- **Ngày:** 2026-09-12.
- **Trạng thái:** CORE MVP IMPLEMENTED — đã có cắt ripple-delete theo timestamp, UI trong AutoShort, journal/resume và tích hợp edited master trước pipeline. Exact frame index/step, join preview, semantic cue review, batch preset và các extension vẫn chưa triển khai.
- **Baseline đã đọc:** HEAD `2d4a8822c05a99bd1101f758811044631b4f88d0`, package `0.1.26`.
- **Kế hoạch:** [Implementation plan](../plans/2026-09-12-autoshort-temporal-cut.md).
- **Bàn giao tài liệu:** [Task record](../../../.ai/tasks/TASK-20260912-autoshort-temporal-cut-planning.md).

## 1. Mục tiêu và quyết định sản phẩm

Thêm bảng **Cắt đoạn** trong AutoShort để người dùng bỏ đầu/cuối, nhiều khoảng giữa video hoặc từng frame trước khi OCR/ASR, dịch, lồng tiếng và xuất. Không mở tab cấp cao riêng, không bắt người dùng xuất file trung gian rồi nhập lại.

Mặc định **Bỏ đoạn** là ripple delete: bỏ hình và âm thanh nguồn tương ứng, nối các phần còn lại theo thứ tự nguồn. Không thay đổi tỷ lệ khung hình; không phải crop và không phải trích ảnh.

**Thay hình, giữ thời lượng** là chế độ mở rộng riêng. Không được ngầm giữ audio trong khi rút ngắn hình. Phần phát hiện khoảng lặng/frame đen và chọn câu trên transcript là các mở rộng có kế hoạch, không bị coi là đã có trong bản cắt cơ bản.

Luồng mặc định: thêm video → chọn video → mở Cắt đoạn → đánh dấu → xem mối nối → áp dụng → chạy AutoShort. Không cắt thì đường chạy hiện tại giữ nguyên. Người dùng không cần chạy model chỉ để đánh dấu điểm cắt.

## 2. Ranh giới bằng chứng

| Nhãn | Bằng chứng hiện tại | Hệ quả thiết kế |
|---|---|---|
| CODE_CONFIRMED | `src/shared/types.ts`: `AutoShortQueueItemInput` chỉ có `id`, `filePath`; Start có config chung và items | Bản cắt phải bổ sung vào từng item, không lưu một vùng cắt toàn batch |
| CODE_CONFIRMED | `src/renderer/src/components/AutoShort.tsx`, `hooks/useVideoTransport.ts`: preview/tua theo thời gian | Không phải bằng chứng hỗ trợ bước từng frame chính xác |
| CODE_CONFIRMED | `src/main/dubbing/timeMap.ts`: map nguồn liên tục, primary/replay, extension 0.6 và slowdown 0.2 | Cần compose bản đồ cắt riêng; không dùng hàm map liên tục để suy đoán vị trí của thời gian đã xóa |
| CODE_CONFIRMED | `src/main/dubbing/policy.ts`: hard tempo 1.8; ADR 005 có protected gap 0.50s và ghi chú EOF | Giữ policy, tính trên phần giữ của từng speech unit, không dùng lại độ dài trước cắt |
| CODE_CONFIRMED | `src/main/autoshort.ts`: journal config digest chung; checkpoint version 5; resume nhận config hiện tại | Thêm snapshot bản cắt và item digest; không chỉ bổ sung một hash rồi mất nội dung bản cắt sau restart |
| CODE_CONFIRMED | `src/shared/autoShortBatchJournal.ts`: schema 1 dùng exact-fields; trạng thái `needs-review` đã có | Migration phải tường minh; không thêm field vào JSON cũ rồi bỏ qua validator |
| CODE_CONFIRMED | `autoShortStageKeys.ts`, `autoShortArtifactCache.ts`: canonical key và artifact lease | Mở rộng dependency của cache theo cut/segment; không mặc định cache cũ hợp lệ |
| CODE_CONFIRMED | `autoShortItemCoordinator.ts`: visual branch, cue/translation/TTS, mix, retime và publish | Điểm tích hợp gồm cả hai nhánh hình/tiếng, không chỉ `burn.ts` |
| CODE_CONFIRMED | `tests/autoshort-trim-cache.test.ts` kiểm tra trim khoảng lặng PCM của TTS | Không được dùng tên test này làm bằng chứng tính năng cắt video |
| TEST_CONFIRMED | Contract khoảng cắt canonical; source-to-edited map; FFmpeg filter hình/tiếng; fingerprint; journal/resume; đường AutoShort/OCR hiện hữu | Các test local và một probe FFmpeg tổng hợp 6s -> 4s đã pass |
| IMPLEMENTED | UI nhập mốc microsecond, bỏ trước/sau/nhiều đoạn, khôi phục; edited master lossless được probe lại và dùng cho OCR/ASR/STTN/separation/audio/render | Đây là Core MVP theo timestamp; không phải bằng chứng exact-frame/VFR hoặc semantic seam review |
| DOCUMENTED_ONLY | Exact frame index/step, after-cut join preview, undo/redo history, cue semantic review, batch preset, hold-frame và suggestions | Là yêu cầu các đợt tiếp theo; chưa được test xác nhận |
| UNKNOWN | Fidelity VFR/frame ordinal, latency preview, chi phí đĩa của intermediate, chất lượng STTN/cue sát seam trên media người dùng | Phải đo bằng fixture/media trước khi tuyên bố hoàn tất Core đầy đủ |

Các giới hạn 40% trong đoạn lịch sử ADR/memory đã được thay bằng 60% trong code và phần bổ sung ADR 005 hiện tại. Task này không thay các giới hạn tempo/extension, chính sách request hoặc chất lượng OCR/STTN.

## 3. Phạm vi và các đợt giao

| Đợt | Bao gồm | Điều kiện |
|---|---|---|
| Core | Bỏ đầu/cuối, nhiều đoạn, từng frame; hình–tiếng liên kết; per-video; undo/redo; preview; review cue; tích hợp toàn pipeline; batch preset; resume/cache/publish | T01–T11 trong plan; không mở mặc định nếu chỉ bộ cắt riêng pass |
| Extension A | Thay hình bằng frame giữ trước/sau, giữ thời lượng và tiếng | T12 + T14; control ẩn cho tới khi engine/contract đã hỗ trợ |
| Extension B | Gợi ý khoảng lặng/frame đen, chọn vùng bỏ qua transcript đã phân tích | T13 + T14; chỉ gợi ý, không tự áp dụng |

Không gồm: editor nhiều track, đảo thứ tự đoạn, chuyển cảnh chồng lấn, phát ngược, AI chọn nội dung hay nhất, tab cắt độc lập, tự đăng video, thay model/giảm chất lượng để tăng tốc. Chưa có chế độ “cắt nhanh không chính xác”.

## 4. Bất biến bắt buộc

1. File nguồn chỉ đọc. Không ghi đè thành phẩm cũ; bản cắt sửa được và khôi phục được.
2. Mọi frame hình được xuất phải truy được về phần giữ hoặc phép thay hình tường minh. Replay/retime không được lấy frame bị bỏ.
3. Ba miền thời gian riêng: `source` → `edited` → `output`. Không ghi đè ledger nguồn và không compose lại lên output đã retime.
4. Một snapshot bất biến cho mỗi lần chạy. Audio, OCR, STTN, subtitle, metadata và receipt cùng identity của lần chạy.
5. Cắt do người dùng chọn chỉ loại phần được chọn. Không dùng nó làm lý do tự bỏ thêm lời, tự tăng tempo hoặc âm thầm dịch điểm cắt.
6. Cue giao với vùng bỏ phải được xét theo interval; mapping chỉ đầu/cuối cue là không đủ.
7. `source → output` có thể không có kết quả (đã bỏ) hoặc nhiều kết quả (replay). Không ép thành một hàm số luôn trả timestamp.
8. Typed IPC; Renderer không dùng Node; shared không dùng Node/DOM. Main kiểm tra lại toàn bộ dữ liệu, đường dẫn, ownership, revisions và frame boundary.
9. Blur vẫn Planar RGB. Runtime/model pin SHA-256, lease tài nguyên, disk budget và hủy cây tiến trình giữ nguyên.
10. Không có silent fallback: đổi STTN sang blur, thay hình thay vì xóa hoặc dùng frame gần đúng đều cần lựa chọn sản phẩm tường minh.

## 5. Ma trận tình huống: tệ nhất → phục hồi → thuận lợi

Mỗi hàng là một requirement. Mã R01–R19 được nối với fixture F01–F19 và task trong plan. `Cần xem lại` dành cho lựa chọn nội dung; lỗi kỹ thuật không bị đổi thành một cảnh báo có thể bỏ qua.

| ID | Tệ nhất và cách ngăn | Có thể phục hồi và tương tác | Thuận lợi | Đợt |
|---|---|---|---|---|
| R01 | Ghi hỏng nguồn/thành phẩm: nguồn read-only; ghi tạm, validate rồi publish riêng | Relink nguồn: hash giống thì giữ plan; hash khác giữ nháp và yêu cầu rà lại | Mở lại đúng edit revision, không mất output cũ | Core |
| R02 | Sai một frame/VFR: dùng frame ordinal + PTS/time base thực; không suy từ FPS trung bình | Probe biên và decode; không thể map đáng tin cậy thì chặn exact cut ở item đó | Tiến/lùi frame, bỏ frame hiện tại đúng cả preview lẫn export | Core |
| R03 | Xóa hết, số sai, out-of-range, interval không có frame: từ chối item trước model | Merge overlap/touch; giữ mẩu còn sót, đưa nút xem; nhập số có draft | Normalize idempotent, tổng thời lượng bỏ không đếm trùng | Core |
| R04 | Bỏ đầu rồi mốc giữa bị đổi nghĩa: mọi edit lưu ở source | Source/edited clocks, danh sách khoảng có sửa/khôi phục; không đổi các khoảng khác | Bỏ trước/sau và nhiều khoảng nối đúng thứ tự | Core |
| R05 | Cắt giữa từ/phủ định/số: không đoán nội dung để tự xuất TTS sai | Review câu ảnh hưởng: dời biên, bỏ trọn câu, sửa fragment hoặc dùng Extension A khi có | Ranh giới câu/khoảng không lời được chấp nhận, bỏ đúng phần chọn | Core |
| R06 | Rút ngắn hình nhưng giữ tiếng gây lệch: reject mixed semantics | Chế độ thay hình có lựa chọn frame trước/sau; vùng dài cần preview; không có frame hợp lệ thì từ chối | Thay vài frame và giữ nguyên duration/audio | Extension A; Core phải chặn thao tác sai |
| R07 | Chữ của vùng xóa vẫn tồn tại hoặc hai nửa cue nối sai: interval projection và provenance | Word timing đáng tin hoặc nhận dạng lại fragment; không đủ bằng chứng thì review/edit text | Cue giữ nguyên chuyển mốc; cue bỏ trọn vắng khỏi mọi output | Core |
| R08 | Translation cache đủ ID nhưng sai ngữ cảnh: identity gồm ngữ cảnh/cut policy | Dịch lại block ảnh hưởng; không xác định dependency thì dịch lại toàn bộ phần giữ | Reuse bản dịch chỉ khi đủ điều kiện identity | Core |
| R09 | TTS mất đuôi/vượt tempo/replay hình đã bỏ: hard guard trên map cuối | Đo audio, recovery hiện hành, tính trên retained segment; vẫn không fit thì lỗi cue | Voice vừa, protected gap và EOF policy được giữ | Core |
| R10 | Cắt âm nhỏ hoặc tạo click/A–V drift: linked schedule và boundary rounding chung | Xem/nghe mối nối, tùy chọn ramp ngắn không overlap, không fade ăn lời | Nối sạch; tiếng gốc/stem theo cut, nhạc mới theo output, no-audio hợp lệ | Core |
| R11 | Mask lệch/ảnh STTN xuyên seam: phân đoạn xử lý, reset tracking/context theo seam | Đo boundary behavior; engine thiếu capability thì lỗi hoặc người dùng chọn blur | Blur/STTN đúng vùng/thời gian, effect hình giữ thứ tự composition | Core |
| R12 | Preview stale hoặc export khác: token item/source/revision, cùng execution plan | Xem nhanh có nhãn; exact join render; response cũ không được cập nhật UI | Preview mượt, frame chọn khớp output cùng chế độ | Core |
| R13 | Phím tắt/undo tác động nhầm video: scoped focus, history và cancellation riêng item | Escape rollback draft, undo một drag, apply atomic | Có bàn phím/mouse, chọn video khác không lẫn trạng thái | Core |
| R14 | Batch preset xóa rỗng/nhầm video: expand theo từng nguồn trước áp dụng | Bảng hợp lệ/không hợp lệ; người dùng chọn áp dụng tập hợp lệ, không tự clamp | Preset giây đầu/cuối hoặc số frame tạo plan riêng từng video | Core |
| R15 | Một run dùng hai cut revision hoặc restart mất edit: immutable run snapshot | Recovery exact snapshot; sửa thành new run, `needs-review` không retry mù | Resume phần thiếu, UI hiển thị đúng applied revision | Core |
| R16 | Cache/receipt cũ bị coi là đúng: item digest và stage dependencies | Corrupt/mismatch thành miss hoặc review output; lease bảo vệ file đang đọc | Reuse có checksum và version; không chạy trùng item succeeded | Core |
| R17 | ENOSPC/treo/decoder lỗi: admission, streaming/chunk, cancel/drain trước cleanup | Lỗi riêng terminal item; lỗi tài nguyên chung tạm dừng admission; fallback phải giữ frame contract | Tài nguyên bounded; cleanup scratch, giữ journal/evidence nhỏ | Core |
| R18 | Video đúng nhưng SRT/SEO sai revision, file thiếu đuôi vẫn publish: validate final identity/timeline | Metadata lỗi riêng không xóa video; render lỗi không tạo success receipt | Video/SRT/metadata thuộc một revision, xuất theo quy ước hiện hành | Core |
| R19 | Detector xóa cảnh đêm/ngắt nghỉ có ý nghĩa: suggestions tách applied edits | Duyệt từng/nhóm ứng viên, xem mối nối, undo; transcript chưa có thì phân tích theo yêu cầu | Accept suggestion đi qua cùng cut contract như thao tác tay | Extension B |

## 6. Mô hình dữ liệu đề xuất

Tên module/interface dưới đây là PROPOSED; không được mô tả là đã tồn tại. Shared chứa kiểu/validator/map thuần; Main hash/probe/file I/O.

### 6.1. Frame boundary và độ chính xác

- `FrameBoundary`: `presentationIndex` là safe integer, `ptsTicks` là chuỗi số nguyên có dấu, `timeBase = { num, den }` dương. EOF là boundary sentinel sau frame cuối, không phải một frame có thể chọn.
- Gắn boundary với `sourceDigest`, stream index, `frameIndexRevision` và policy canonical display. PTS dạng integer/rational là nguồn tính toán; millisecond chỉ dùng hiển thị.
- Interval `[startBoundary, endBoundary)`; frame tại end thuộc phần tiếp theo. Nút bỏ frame i tạo `[i, i+1)`; frame cuối dùng EOF sentinel.
- Nhập thời gian được resolve tới boundary thực theo quy tắc công bố: boundary bắt đầu frame đầu tiên có presentation time >= thời gian nhập; hiển thị giá trị thực đã snap trước Apply. Không dùng snap để sửa input ngoài duration.
- Seek decode có thể bắt đầu trước vùng giữ để giải mã GOP, nhưng frame trước boundary chỉ là decoder dependency, không được vào artifact/AI context/output.
- Chỉ mục phân trang, không chuyển toàn bộ danh sách frame/video qua IPC. Thiếu timestamp/duplicate không giải quyết được một cách xác định phải trả `CUT_FRAME_INDEX_UNSUPPORTED`, không đoán FPS.
- Canonicalization không được ngầm đổi toàn bộ nguồn về 30fps trước khi chọn frame. Nếu runtime buộc chuẩn hóa, phải có mapping frame một-một kiểm chứng; trường hợp không có mapping giữ trạng thái unsupported.

### 6.2. Applied edit và snapshot

`AutoShortTemporalEditV1` có `schemaVersion: 1`, `editId`, `revision`, `sourceDigest`, `frameIndexRevision`, `mode: 'ripple-delete'`, `removedRanges`, `reviewResolutions`, `policyVersion`. Không chứa credential, filter FFmpeg, arbitrary output path hoặc frame buffer.

- `removedRanges`: ID ổn định, start/end frame boundaries. Main canonicalize sorting/union; giữ thao tác raw trong draft history để undo, applied digest dựa trên interval hiệu lực.
- `reviewResolutions`: cue/fragment identity, action, nội dung sửa nếu có, hash evidence và cut revision. UI không thể tự gửi `verified: true` để bypass validation.
- `AutoShortQueueItemInput.temporalEdit?`: optional per-item. Vắng field tương đương identity/no edit, bảo toàn legacy behavior. `null`/unknown schema/mode xử lý rõ bằng validator, không silently ignore.
- Main tạo `editDigest` từ canonical applied content/policy; `revision` phục vụ stale/CAS, không cần làm cache miss chỉ vì undo quay lại nội dung hoàn toàn giống.
- Main biên dịch `CutExecutionPlan`: `sourceDigest`, `editDigest`, `keepSegments`, `joins`, source/edited duration, frame/audio schedules, provenance version. Renderer không được gửi plan đã biên dịch làm authority.
- `RunSnapshotV2`: lưu đầy đủ non-secret config ảnh hưởng output, per-item applied edit, execution identity, policy/engine revisions. Credentials được resolve lại bằng cơ chế hiện có.
- Hạn mức cấu trúc ban đầu: tối đa 1.000 raw ranges/item, 2 MiB JSON/edit; 200 history transactions trong RAM/item đang hoạt động; vượt giới hạn báo rõ trước chạy. Đây là guard cấu trúc chống quá tải, không phải quota request dịch. Benchmark T11 quyết định có cần điều chỉnh, không tự cắt bớt ranges.
- Không persist thumbnails, WAV, tokens/key vào JSON. Hash source stream một lần/run, không dùng size/mtime làm bằng chứng bằng nhau; kiểm tra nguồn không đổi trong lúc đọc và trước publication, fail nếu có thay đổi.

### 6.3. Source, edited và output maps

Ví dụ nguồn 60s, bỏ `[0,3)` và `[20,25)` → giữ `[3,20)` và `[25,60)` → edited duration 52s. Source 30s → edited 22s; source 22s không có edited position. Nếu dubbing kéo dài, output time được tính tiếp từ edited time.

Mỗi keep segment có `segmentId`, source boundaries, edited start/end. Source→edited chỉ có kết quả bên trong keep; không extrapolate/clamp điểm đã bỏ. Interval projection trả 0..N fragments, không trả một envelope phủ cả mối nối.

Compose `CutTimeMap` với `DubbingTimeMap` theo từng segment. Replay lưu owner segment/cue và chỉ dùng frame còn giữ trong segment đó. Inverse output→source giữ loại mapping primary/replay/hold; source→output có thể trả nhiều spans. Không dùng `dubbingVideoPtsExpression` hiện tại làm cut map tổng quát.

Audio boundaries xuất phát từ cùng rational schedule. Làm tròn sample theo vị trí tuyệt đối trên timeline cuối, không cộng sai số làm tròn độc lập từng đoạn. Chênh lượng tử phải được kế toán ở biên; không pad hoặc trim narration để che drift.

### 6.4. Cue provenance

Ledger nguồn giữ bất biến ID/text/start/end. Cue phái sinh có `derivedCueId`, `sourceCueIds`, source spans, `segmentId`, edited spans, text provenance (`recognized`, `word-aligned`, `user-edited`), evidence revision và review state.

Không ghép source cue qua seam thành một speech unit. Translation có thể đọc ngữ cảnh của các đoạn giữ lân cận, nhưng output vẫn keyed theo derived cue ID; không dùng cả script tự do rồi chia lại theo vị trí. Removed content không được phục hồi vào final narration/subtitles/SEO.

## 7. Pipeline thực thi

### 7.1. Chuẩn bị và nhận dạng

Main freeze snapshot → validate/probe source → compile cut plan → reserve resources → tạo nguồn làm việc theo retained segments. Bản trung gian là chi tiết nội bộ, không yêu cầu người dùng import lại.

Đường Core ưu tiên adapter phân đoạn: mỗi đoạn giữ có timeline cục bộ/canonical geometry và provenance; OCR/ASR/STTN xử lý đoạn liên tục, trả dữ liệu được chiếu về edited timeline. Có thể nối một edited master để phục vụ audio/render, nhưng không được vứt join manifest rồi chạy temporal AI xuyên seam. Một segment/no cut dùng fast path hiện có.

Codec trung gian và batching decode được chọn ở T03–T04 bằng chứng frame identity, fidelity, disk và runtime capability. Không mặc định thêm hai lượt encode lossy cho mọi video. Có thể dùng lossless/intermediate tối ưu nếu disk admission đạt; bất kỳ lựa chọn nào cũng phải giữ contract về frame/PTS.

Nhận dạng nội dung biên không đòi chạy full-source AI mặc định. Nếu có source transcript/word timings hợp lệ thì dùng để phân loại cue; nếu không, đọc các đoạn giữ với context nằm trong cùng segment. Phân tích nguồn trước cắt chỉ là công cụ review theo yêu cầu; không đưa text ngoài phần giữ vào output.

### 7.2. Review tại mối nối

Trước khi gọi dịch/TTS cho fragment có rủi ro: đánh dấu câu/âm đầu-cuối bị cắt; cung cấp original/after audio hoặc image context, transcript evidence nếu có và lý do. Detector confidence không được coi là chứng nhận ngữ nghĩa.

Actions Core: `move-boundary`, `remove-whole-cue` (hiển thị phần xóa thêm), `edit-retained-text`, `keep-intentional-cut`. Lựa chọn cuối ghi ý định biên tập, không khẳng định cắt giữ nguyên nghĩa. Khi tạo subtitle/TTS, text fragment vẫn phải có nguồn rõ và qua validation; thiếu text đáng tin thì user sửa hoặc item needs-review. Khi chỉ giữ audio gốc và không sinh text, intentional cut có thể xuất đúng lựa chọn dù nghe bị cụt; app không tự chữa nội dung.

Extension A thêm `replace-visual`. Không quảng bá action chưa hỗ trợ. Sau sửa boundary/text, resolution cũ hết hiệu lực nếu evidence/cut hash đổi. User không phải duyệt mọi seam không có issue.

### 7.3. Dịch, TTS và âm thanh

- Derive cues trước translation/grouping; seam là hard boundary cho speech unit và borrowed-time/reflow. User text không được coi là system instruction.
- Giữ measured-first recovery, hard ceiling 1.80x, protected gap 0.50s theo policy (không tự đòi gap sau EOF), extension 60% và slowdown 20% của retained source unit. Không tính phần đã xóa vào mẫu số/headroom.
- Nếu retime cần replay, chỉ replay frame từ owner retained segment; fallback đọc thêm frame trong `retimeMedia.ts` cũng phải bị chặn tại source boundary. Narration không lặp; mix-mode source speech trong replay giữ policy tắt hiện tại.
- Audio gốc/finite instrumental theo cùng map; thêm nhạc ngoài sau duration cuối. No-audio không sinh audio giả nếu output không yêu cầu.
- Giữ A–V offset nguồn khi normalize; trim/concat theo một schedule. Không có crossfade overlap Core. Ramp chống click optional chỉ ở vùng hợp lệ, không ăn phoneme hoặc đổi duration.

### 7.4. OCR, STTN, mask và composition

- Reset tracker/stabilizer/context ở seam. Một gap synthetic không thể nối detection trước/sau seam.
- Validate raw/stabilized OCR như hiện tại; projected result cần contract mới hiểu segment/provenance. Không tắt validator hoặc fake frame count để nhận timeline sau cắt.
- STTN short segment phải có behavior đã đo; không có thì báo boundary issue. Blur fallback chỉ sau chọn mode mới và tạo run mới.
- Mask sampling tại seam phải chọn theo segment của output frame; không interpolate xuyên seam. Retime và fps conversion cũng không lấy frame/mask từ vùng bỏ.
- Apply image adjustments, ASS, portrait theo composition hiện hành trên edited/retimed media. Manual/OCR regions theo canonical display geometry; cắt thời gian không đổi ROI không gian.

### 7.5. Validate và publish

Kiểm tra output nonempty/full decode, stream/duration, frame lineage quanh seams/EOF, A–V schedule, subtitle/word timings nằm trong output, đúng snapshot identity. Production validator dựa trên plan/provenance và media probe; không tuyên bố có thể kiểm chứng ngữ nghĩa mọi video tự động.

Output/SRT/SEO/completion manifest đều có cùng run identity. SEO từ final retained cues; lỗi metadata giữ video hợp lệ và `titleError` hiện có. Publish exclusive vào output riêng; manifest và journal theo protocol crash-safe hiện hành, reconcile cần tất cả dependency mới khớp.

## 8. Giao diện và typed IPC

### 8.1. UI

- Bảng Cắt đoạn trong preview AutoShort, mặc định đóng/giữ toàn bộ. Queue badge: `3 đoạn bỏ · 60s → 52s`; đây là thời lượng sau cắt, không cam kết output sau dubbing vẫn 52s.
- Thumbnail timeline, waveform khi có, vùng bỏ có màu + nhãn, không chỉ dựa vào màu. Source/after-cut clock có nhãn rõ.
- Controls: đặt đầu/cuối, bỏ đoạn, bỏ trước/sau, bỏ frame, previous/next frame, zoom timeline, danh sách khoảng, apply, undo/redo, restore all.
- Source preview xem được cả vùng bỏ; after-cut preview bỏ qua các vùng. Exact join preview hiển thị frame cuối giữ và đầu giữ tiếp theo, play-loop khoảng 1–2s mỗi phía khi có đủ duration.
- Mouse và keyboard cùng hành vi; không bắt phím tắt trong input/contenteditable. Focus/ARIA/disabled reason; bảng dùng được tại chiều rộng cửa sổ 1040px.
- Draft khác applied. Một drag là một undo; Escape bỏ draft thao tác; Apply lưu atomic. Bấm Start khi có unapplied draft phải dẫn tới Apply/Discard lựa chọn cụ thể, không silently lấy draft.
- History riêng item, capped; switch item hủy request chưa cần, đổi token. History không bắt buộc phục hồi qua app restart; applied edit và draft gần nhất phải phục hồi, hiển thị rõ cái nào được chạy.

### 8.2. API đề xuất

Thêm typed request/result/progress trong shared/types/preload/Main registration, ví dụ `autoShortProbeFrames`, `autoShortGetEdit`, `autoShortSaveEdit`, `autoShortPreviewCut`, `autoShortCancelCutPreview`. Tên cuối có thể chuẩn hóa khi implementation; không dùng raw/untyped event.

- Mỗi response/event gắn `requestId`, `itemId`, `sourceDigest`, `editRevision`; UI chỉ nhận active identity.
- Frame probe phân trang và thumbnail theo cửa sổ, phục vụ decoder exact step. Preview request chứa applied/draft revision đã validate, không chứa arbitrary FFmpeg filter.
- Save dùng expectedRevision/CAS; stale save trả conflict và cho reload/giữ nháp, không last-writer-wins âm thầm.
- Cancel theo requestId/owner; không được hủy preview hoặc job của item khác. Cleanup listener trên unmount/source switch.
- Main cấp artifact token/path trong scope; reuse local-media validation hiện có. Chống traversal/junction, stale token và đọc arbitrary file bằng token của request khác.
- STTN preview hiện tại phải nhận đúng edit identity qua adapter; không cho preview đầu nguồn gốc trong khi UI ghi đang xem bản cắt.

## 9. Batch, persistence, migration và cache

### 9.1. Batch preset

Phân biệt `trim-head-seconds`, `trim-tail-seconds`, `trim-head-frames`, `trim-tail-frames`, `copy-absolute-ranges`. Expand thành plan từng item, hiển thị duration thực sau snap. Bảng kết quả valid/invalid; chỉ khi người dùng chọn áp dụng subset mới bỏ qua item invalid. Không tự clamp. Applied plan, không preset mutable, là input của run.

### 9.2. State và recovery

Editing state tách khỏi job state. Applied edit → validated → queued/running → succeeded/failed/needs-review/interrupted/cancelled. Run đang chạy khóa snapshot; edit mới thuộc draft/new run. Needs-review không bị automatic retry để tránh gọi model lại cùng đầu vào không tiến triển.

Lưu edit store do Main quản lý dưới userData; chỉ applied revision đã ghi bền vững được enqueue. Preview không thay journal job. Resume lấy edit/config non-secret từ snapshot, credentials resolve hiện tại; thay config là new run, không tiếp tục dùng receipt cũ.

`BatchSnapshot` schema 2 và completion manifest version mới cần reader/migration từ schema 1. Legacy là no-cut; không sửa hoặc gán lại digest receipt cũ như thể đã được xác minh theo schema 2. Đọc legacy qua đường kiểm chứng cũ, migrate nonterminal bằng ghi atomic kèm backup; reader unsupported version báo rõ, không ghi đè dữ liệu. Vị trí lưu/migration namespace phải chốt ở T08; dữ liệu schema 1 gốc được giữ để rollback. Downgrade app không được vô tình xử lý run có cut như no-cut.

### 9.3. Dependency table

| Artifact | Identity bắt buộc | Khi cut đổi |
|---|---|---|
| Source metadata/frame index | Source SHA-256, stream, probe/canonical policy | Có thể reuse nếu nguồn và policy giống |
| Retained segment media | Source, exact boundaries, canonical/codec policy, runtime revision | Reuse segment chỉ khi mọi field khớp |
| OCR/ASR | Segment evidence/boundaries, ROI/model/options/protocol | Recompute các segment khác; reset seam context |
| Derived cues/review | Source evidence, edit digest, projection/review policy, user edits | Invalidate resolution bị ảnh hưởng |
| Translation | Derived text/IDs, retained context, language/glossary/prompt/model | Không rõ context dependency thì invalidate toàn bộ translation item |
| TTS | Validated target text, voice/model/settings và policy | Reuse WAV theo key chính xác; luôn lập lại timing/map |
| STTN | Segment bytes/boundaries, canonical timeline, geometry, engine/model hash/options | Không reuse artifact cho boundary khác |
| Mix/render/subtitles | Edit/map digests + toàn bộ visual/audio/style dependencies | Recompute |
| SEO/receipt | Final retained cues, final duration, source/edit/config/output digest | Không reconcile nhầm phiên bản |

Cache là optimization: miss phải chạy đúng; lỗi cache không được mất video. Quota/lease hiện có giữ nguyên, không tăng ngầm. Không serialize secrets vào key payload lưu đĩa.

## 10. Lỗi, tài nguyên và quan sát

| Mã đề xuất | Kết quả | Phục hồi |
|---|---|---|
| CUT_INVALID_RANGE / CUT_EMPTY_OUTPUT | Item không được chạy | Sửa interval, restore |
| CUT_SOURCE_CHANGED / CUT_SOURCE_MISSING | Needs-review | Relink và hash/review |
| CUT_FRAME_INDEX_UNSUPPORTED / CUT_BOUNDARY_DECODE_FAILED | Item failed có boundary | Đổi nguồn hoặc vị trí; không fallback gần đúng |
| CUT_CUE_REVIEW_REQUIRED | Needs-review | Resolve fragment, lưu revision mới |
| CUT_STALE_REVISION | Save/preview conflict | Reload applied, giữ nháp có nhãn |
| CUT_TIMELINE_MISMATCH / CUT_FORBIDDEN_FRAME | Failed, không publish | Lưu evidence, sửa implementation; retry y hệt không chữa lỗi |
| CUT_SNAPSHOT_UNSUPPORTED | Dừng resume run đó | Dùng build hỗ trợ; không downgrade nội dung |
| CUT_RESOURCE_LIMIT / ENOSPC | Chặn/admission paused theo phạm vi | Giải phóng đĩa/giảm scope, tiếp tục theo thao tác |
| ABORT_ERR | Cancelled/interrupted đúng ngữ cảnh | Drain process, cleanup, giữ edit |

Preview/frame decode tham gia resource manager; Core không tăng concurrency GPU/server. Timeline 1.000 ranges không sinh một process/FFmpeg graph không giới hạn; chunk có lịch frame/sample toàn cục và concat đúng, hoặc admission từ chối trước start nếu runtime không hỗ trợ.

Các stage đề xuất `cut_probe`, `cut_prepare`, `cut_review`, `cut_preview`, `cut_validate`; ghi item/run/edit digest, số range/segment, durations source/edited/output, wait/elapsed, cache hit, bytes, encoder và lý do lỗi. Không log toàn bộ transcript/paths/key; diagnostic redaction theo cơ chế hiện có.

Source change, global ENOSPC và engine unavailable được phân biệt với một file hỏng. Global resource lỗi không làm batch phát sinh hàng loạt request vô ích. Cancel settle sau child exit; scratch xóa sau lease release; startup cleanup chỉ thư mục có owner/manifest/quota rõ.

## 11. Mở rộng có contract riêng

### Extension A: thay hình giữ tiếng

Schema edit mở rộng phải version mới/discriminated operation, old runtime từ chối mode mới. Mỗi hold có interval nguồn và replacement frame được người dùng chọn, nằm ngoài mọi delete/invalid interval. Delete và hold overlap bị từ chối để người dùng tách/sửa, không có precedence ngầm.

Hold giữ duration/audio; giữ/tạo output frame schedule theo source time. Nếu đầu/cuối không có frame ở một phía thì dùng phía còn lại khi người dùng chọn; không có frame hợp lệ thì lỗi. Preview trước Apply, đặc biệt vùng dài. Xóa chữ/blur xử lý ảnh thay thế đúng visual evidence; speech/subtitle vẫn lấy audio/content được giữ, không nhận chữ từ frame hold thành lời thoại mới. T12 phải chứng minh sự tách biệt visual evidence và subtitle-content evidence, không dùng một OCR stream cho cả hai một cách mù quáng.

### Extension B: suggestions và transcript

Detector chạy local theo yêu cầu/cấu hình, có cancel/progress; kết quả có confidence, lý do, source revision. Không tự đưa vào removedRanges. Accept từng/nhóm qua validator hiện có, có undo. Chọn text→source spans phải có alignment; text không có boundary đáng tin thì yêu cầu xem/chỉnh mốc. Detector lỗi không chặn thao tác tay. False positives cảnh đêm, intentional silence, nhạc nhỏ và chữ tĩnh là fixture bắt buộc.

## 12. Nghiệm thu và giới hạn chứng minh

- Core release phải có traceability R01–R18; R06 chứng minh Core chặn giữ-audio sai, phần hold cần Extension A. R19 cần Extension B.
- Fixture frame-ID sử dụng machine-readable payload/ordinal và expected keep ranges độc lập với code production. Frame bị bỏ xuất hiện 0 lần; thứ tự giữ đúng; replay chỉ từ whitelist owner.
- Lossless preparation fixture kiểm frame/pixel hash khi format tương đương. Final lossy encode kiểm decoded frame markers và quality riêng, không so hash byte ảnh như thể bit-exact.
- VFR/GOP/EOF/start-offset/frame-duration cuối; frame count đơn lẻ không đủ. Output duration so kế hoạch cuối theo time base thực; ngưỡng tối đa 1 output-frame tick do lượng tử và audio decoded PCM error <=1 sample khi chưa encode lossy. Final audio marker sync mục tiêu <=20ms sau khi tính priming/codec delay; không nới ngưỡng để qua test nếu media không đạt.
- Sau TTS, duration dự kiến là `outputDuration`, không phải source trừ cut đơn thuần. Word timings/cues không âm, không vượt EOF, không trở về miền deleted source.
- Semantic review phải có các trường hợp mất phủ định/số/âm cuối; local contract tests không chứng nhận nghĩa mọi ngôn ngữ hoặc giọng thật. Live provider/real STTN/Windows/macOS acceptance báo riêng; thiếu runtime thì gate mở.
- Kiểm restart/cancel tại prepare, recognition, TTS, STTN, render, publish; không orphan, không trùng output, không mất edit/source.
- No-edit regression bảo toàn đường chạy hiện tại. Không tăng copy/encode hoặc gọi model chỉ vì control được thêm vào UI.
- Target UX đề xuất: thao tác timeline dùng index đã cache phản hồi P95 <=100ms; fixture 1080p local first-page thumbnail <=3s; exact join preview có progress và cancel, đo thời gian riêng, không cam kết cho mọi codec/máy. Nếu không đạt phải tối ưu/tái đánh giá trước release, không giảm fidelity.

## 13. Tài liệu và quyết định khi triển khai

Khi contract ổn định, viết ADR source/edited/output time-map và cập nhật `docs/architecture.md`, `docs/domain.md`, ADR 005/006/002 theo behavior thực. Chưa sửa các tài liệu mô tả runtime hiện tại trong task planning này.

Các quyết định phải có bằng chứng ở plan: codec/proxy fidelity (T03–T04), sentence-boundary confidence/fallback (T05), STTN short-segment support (T07), migration namespace và rollback (T08), target performance/hardware (T11). Không có số đo thì ghi UNKNOWN, không điền success giả định.

## 14. Nguồn tham khảo

- Code/repo: các file được liệt kê trong mục 2, AGENTS.md root/shared/renderer/inpainting/dubbing, ADR 002/005/006 và `.ai/tasks/TASK_TEMPLATE.md`.
- [FFmpeg trim](https://ffmpeg.org/ffmpeg-filters.html#trim), [atrim](https://ffmpeg.org/ffmpeg-filters.html#atrim), [concat](https://ffmpeg.org/ffmpeg-filters.html#concat): trim không tự reset timestamp; concat yêu cầu quản lý timestamp/stream properties.
- [FFmpeg seek](https://ffmpeg.org/ffmpeg.html#Main-options): input seek/stream copy không thay thế decode chính xác theo boundary. Tài liệu tham khảo không chứng minh capability của binary được cài; T03 phải probe runtime thực.
