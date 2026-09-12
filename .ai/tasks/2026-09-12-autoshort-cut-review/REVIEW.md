# Review toàn bộ thay đổi Cắt đoạn AutoShort

Ngày 2026-09-12 · commit `0d7fa21b911f1eb540140999f5c51dead6141c78` · Windows.

**Kết luận: chưa đạt nghiệm thu Core.** Có 12 nhóm vấn đề cần xử lý: 6 nhóm P1 và 6 nhóm P2. UI mất vùng xem video là lỗi bố cục xác định được; đồng thời bộ cắt có lỗi đồng bộ hình–tiếng, resume và tài nguyên. Các nhãn “đồng bộ”, “lossless” và “resume đúng” trong bàn giao trước cần được hiểu lại theo bằng chứng bên dưới.

Phạm vi là **20 tệp của commit tính năng**, cộng các đường gọi liên quan; không phải audit toàn bộ repository. [FILE_INVENTORY và COVERAGE](F:/Son/tool/TediaPros/.ai/tasks/2026-09-12-autoshort-cut-review/COVERAGE.md) ghi từng tệp. Working tree đang có công việc overlay và các task khác; lượt review này không sửa source, không commit/merge, không thay bản cài. Các số dòng dưới đây lấy theo commit được review, có thể dịch chuyển trong working tree.

## 1. Review luồng UI

| Bước | Sức khỏe | Điều quan sát được | Cần thay đổi |
|---|---|---|---|
| 1. Chọn video, xem nguồn | Cần cải thiện | Video còn nhìn rõ khi đóng bảng. Toolbar có nhiều nút đậm cùng trọng số, chọn file và thêm/xóa bị xuống dòng | Giữ video làm trọng tâm; gom các công cụ chỉnh sửa, phân cấp hành động chính/phụ |
| 2. Mở Cắt đoạn | Hỏng — P1 | Bảng cắt chiếm phần lớn chiều cao; video chỉ còn một dải hẹp. “Bỏ sau” rơi riêng một hàng | Định nghĩa lại grid/areas; dành hàng co giãn cho video, bảng cắt có chiều cao theo nội dung và danh sách cuộn giới hạn |
| 3. Nhập và bỏ khoảng | Hỏng — P2 | Hai ô nhỏ hiển thị sáu chữ số thập phân. Bỏ trống điểm đầu vẫn cắt từ 0. Không có vùng chọn/timeline giúp kiểm tra | Draft string có validation; source/edited clock rõ; đánh dấu vùng giữ/bỏ; chỉ áp dụng khi hợp lệ |
| 4. Khôi phục | Thiếu — P2 | Hai thao tác chồng nhau bị gộp, không còn lịch sử để undo thao tác thứ hai | Lưu lịch sử riêng từng video; tách raw operations khỏi union dùng để thực thi |
| 5. Xem mối nối và chạy/resume | Hỏng/thiếu — P1/P2 | Không có after-cut join preview; STTN preview đọc nguồn cũ; resume không nhận sửa đổi đang hiện trên UI | Preview cùng plan/revision; sửa cut của snapshot cũ phải tạo run mới hoặc giải quyết trạng thái rõ ràng |

**Ảnh người dùng — UI thực tế được cung cấp:**

![Đóng bảng cắt: video còn nhìn rõ](F:/Son/tool/TediaPros/.ai/tasks/2026-09-12-autoshort-cut-review/01-user-closed.png)

![Mở bảng cắt: gần như mất vùng video](F:/Son/tool/TediaPros/.ai/tasks/2026-09-12-autoshort-cut-review/02-user-open.png)

**Bản tái hiện độc lập:** dùng component và CSS thật tại `0d7fa21`, shell cố định 696 × 596 px. Đây là browser harness, không phải Electron đang chạy. Vùng video đo được giảm **414 → 24 px** khi mở bảng; bảng cắt chiếm **390 px**. Hình nguồn trong harness được thay bằng nhãn để đo layout, không dùng làm bằng chứng chất lượng playback.

![Harness xác nhận bảng cắt chiếm hàng co giãn của video](F:/Son/tool/TediaPros/.ai/tasks/2026-09-12-autoshort-cut-review/04-harness-open.png)

Hướng thiết kế: giữ Cắt đoạn trong AutoShort. Video nằm trên, thanh phát và timeline nằm sát nhau, công cụ đánh dấu nằm dưới timeline. Cho xem “Nguồn / Sau cắt”, thời lượng còn lại và danh sách khoảng gọn, có cuộn khi dài. “Đặt đầu/cuối” gắn với playhead; “Bỏ đoạn” là thao tác chính; khôi phục/undo ở vị trí ổn định. Bố cục cần kiểm lại tại chiều rộng panel thực tế, không chỉ chiều rộng cửa sổ. Đây là hướng sửa, chưa phải thiết kế đã được triển khai/kiểm chứng.

## 2. Findings theo ưu tiên

### F01 — P1: hình và tiếng không dùng cùng lịch cắt thực tế

**TEST_CONFIRMED + CODE_CONFIRMED.** `src/main/autoShortCutMedia.ts:23–32` trim từng stream, reset PTS riêng, rồi concat video và audio thành hai chuỗi độc lập. Khoảng thời gian nhập tùy ý không được lượng tử hóa theo frame thực. `autoShortItemCoordinator.ts:599–604` chỉ probe metadata dương; không đối chiếu timeline hình/tiếng với plan.

- Fixture 6 giây, 25 fps: bỏ năm khoảng `[n+0.001, n+0.019)` với n=1…5. Plan và PCM còn **5,91 giây**, video vẫn **150 frame / 6 giây**. Không có PTS frame nào nằm trong các khoảng nhỏ đó nhưng audio bị xóa tổng cộng 90 ms.
- Fixture audio bắt đầu muộn **0,5 giây**: bỏ `[2,4)` làm video còn **4 giây**, PCM **3,5 giây**, audio bắt đầu từ **0**. Khoảng trễ nguồn đã mất.

**Sửa:** chốt frame-boundary/index và epoch chung; compile lịch hình/sample từ timeline tuyệt đối, bảo toàn phần im lặng/offset cần thiết; validate decoded frame sequence và PCM trước khi chuyển sang AI. Đổi sang một concat chung đơn thuần chưa đủ chứng minh mọi trường hợp đúng.

**Gate:** CFR, fractional FPS, VFR, đầu/cuối, một frame, nhiều seam và audio lead/lag; PCM prepared sai tối đa một sample theo spec, không có frame đã bỏ xuất lại. Độ chính xác của số nguyên microsecond không đồng nghĩa độ chính xác cắt frame.

### F02 — P1: batch cũ không cắt bị từ chối resume

**CODE_CONFIRMED + digest probe.** `src/main/autoshort.ts:185–187,3386` đổi digest từ hash(config) sang hash({config, temporalEdit}) cho mọi item. Ngay cả item không cắt cũng đổi digest, nhưng resume chỉ nhận công thức mới. Batch pending/interrupted được tạo trước commit sẽ báo cấu hình khác dù người dùng không thay cấu hình. Checkpoint fingerprint còn thêm `temporalEdit` vào serializer hiện hữu mà không tăng version/migration.

**Sửa:** giữ identity legacy cho no-cut, version hóa snapshot/edit identity mới; migration không viết lại receipt thành công cũ. Kiểm thử gọi resume thật với journal trước commit, không chỉ test hàm chuyển trạng thái.

### F03 — P1: sửa cut trên UI resume bị bỏ qua khi chạy

**CODE_CONFIRMED; chưa chạy end-to-end Electron.** `AutoShort.tsx:1379–1386` chỉ thay `tasks`, không đổi `resumeSnapshot`; `:1163` gọi `autoShortResume` chỉ với jobId/revision/config. Main `autoshort.ts:3381–3386` dựng items từ bản cắt trong journal. Vì UI chỉ khóa khi đang chạy, người dùng có thể sửa/khôi phục khoảng rồi bấm Tiếp tục và nhận kết quả dùng cut cũ.

**Sửa:** hiển thị snapshot đã đóng băng; sửa tạo draft/run mới và chuyển hành động chính tương ứng. Nếu hỗ trợ sửa pending snapshot thì cần typed mutation, CAS revision, invalidation và trạng thái xác nhận đã áp dụng. Không chỉ bỏ digest check để cho qua.

**Gate:** restore một/toàn bộ → resume; sửa một item trong batch nhiều video; snapshot revision đổi; chạy xong mở lại đúng plan đã dùng.

### F04 — P1: bảng cắt lấy mất hàng co giãn của preview

**USER_SCREENSHOT + BROWSER_HARNESS + CODE_CONFIRMED.** `AutoShort.tsx:1373–1389` thêm một direct child trước stage. `.editor-canvas-panel` trong `editor.css:89–92` vẫn có ba hàng `auto minmax(0,1fr) auto`. Khi có bốn child, cut panel nhận hàng lớn, stage nhận hàng auto nhỏ, transport rơi vào hàng implicit. `autoshort.css:142–166` tiếp tục giãn nội dung bên trong, tạo khoảng trắng lớn và wrap nút.

**Sửa:** định nghĩa rõ vị trí/chiều cao của header, video, cut tools và transport; kiểm soát overflow danh sách. Sau đó sửa style input, spacing và hierarchy. Chỉ giảm padding không xử lý nguyên nhân.

**Gate:** mở/đóng, danh sách dài, lỗi validation, đổi video, fullscreen và các kích thước panel; video vẫn đủ chỗ quan sát điểm cắt. Chưa đánh giá accessibility toàn diện hay đo contrast trong review này.

### F05 — P1: intermediate lớn chưa được dự trù đúng ổ đĩa và tài nguyên

**CODE_CONFIRMED; không thử làm đầy ổ người dùng.** `autoshort.ts:2912` tạo scratch trong `app.getPath('temp')`. `autoShortItemCoordinator.ts:581–599` encode FFV1 trực tiếp, không có resource lease/disk reservation riêng. Admission ở `autoshort.ts:3178–3191` chỉ bật khi chạy hai item, dự trù theo dung lượng file nén và ổ output. Ổ temp có thể khác ổ output; FFV1 có thể lớn hơn nhiều so với file đầu vào. Cleanup có tồn tại trên đường thành công/lỗi, nhưng cleanup sau cùng không thay thế admission.

**Sửa:** reserve trên volume thật của scratch cho cả một/hai item; ước tính theo duration/geometry/pixel format, cập nhật reservation theo bytes còn phải ghi; bounded preparation/chunk và CPU lease. ENOSPC phải dừng admission phù hợp, giữ journal và drain process trước cleanup.

**Gate:** fake-volume quota khác nhau, input nén cao, cancel/crash/encoder fail; fault injection thay vì làm đầy ổ thật. Bàn giao trước nói disk budget hiện hữu đã quản lý intermediate là chưa đủ cơ sở.

### F06 — P1: mất thông tin mối nối trước các stage temporal

**CODE_CONFIRMED về thiếu integration; chất lượng sai cụ thể chưa được tái hiện.** `autoShortItemCoordinator.ts:612–614` chỉ lưu `cut-plan.json` để audit. ASR/OCR/STTN/dubbing nhận file edited liên tục, không nhận retained-segment/join provenance để reset tracking/context hoặc chặn grouping/borrow xuyên seam. `mapSourceToEdited` hiện là helper độc lập, chưa compose với map TTS/output.

Đây là phần Core đã yêu cầu trong T04–T07, không phải extension. Chưa có cơ chế review khi cắt giữa từ, số, tên hoặc phủ định. Không thể suy từ việc “mọi stage dùng một file” rằng nghĩa câu và temporal context đã được bảo toàn.

**Sửa:** đưa segment/source spans vào contract downstream, reset OCR/STTN theo seam, giữ owner khi grouping/retime; thêm review có evidence ở biên cần thiết. Không suy text bằng tỷ lệ duration.

**Gate:** caption đổi đúng tại seam, STTN đoạn một frame, câu cắt mất phủ định, replay/extension sát biên; kiểm decoded media và input/output provider trong fixture offline trước khi tuyên bố chất lượng.

### F07 — P2: cùng source/edit nhưng retry có thể chạy lại AI vì cache key đổi

**TEST_CONFIRMED + CODE_CONFIRMED.** Hai lần chuẩn bị cùng source và cut `[2,4)` có cùng duration/frame count nhưng SHA-256 của Matroska khác nhau. `autoShortItemCoordinator.ts:600` hash file mới rồi dùng nó cho OCR/ASR/STTN/translation keys. Container nondeterminism trở thành thay đổi semantic identity. Outer checkpoint có thể khôi phục source cues; điều đó không bảo đảm mọi stage cache hoặc translation checkpoint còn hit.

**Sửa:** semantic preparation key = source digest + canonical effective edit + executor/runtime/geometry policy; checksum artifact dùng riêng để kiểm integrity. Revision phục vụ chống stale, không tự làm cache miss nếu nội dung hiệu lực không đổi.

**Gate:** prepare hai lần; restart giữa recognition/translation/render; sửa boundary phải miss, reorder tương đương phải hit; artifact hỏng vẫn bị từ chối.

### F08 — P2: contract cho 1.000 khoảng nhưng command line không chạy trên Windows

**TEST_CONFIRMED.** `autoShortTemporalEdit.ts:2` cho 1.000 ranges; `autoShortCutMedia.ts:50–51` đưa toàn bộ filter graph vào args. Fixture 1.000 khoảng sinh graph **145.765 ký tự** và process spawn trả **ENAMETOOLONG** trước khi FFmpeg chạy.

**Sửa:** dùng graph file hoặc chunk có giới hạn, theo một schedule chung; giới hạn capability theo số đã kiểm chứng. Wrapper FFmpeg đang mang thông báo lỗi trộn nhạc nền, cần đổi sang context “chuẩn bị video sau cắt”.

**Gate:** 1.000 khoảng trên Windows, bounded RAM/process, cancellation ở chunk giữa; không chỉ assert độ dài chuỗi filter.

### F09 — P2: “lossless master” vẫn giảm bit depth của nguồn

**TEST_CONFIRMED.** `autoShortCutMedia.ts:52–53` ép `yuv444p` và `pcm_s16le`. Fixture video `yuv420p10le` sau cắt thành `yuv444p` 8-bit. FFV1 là codec lossless nhưng chuyển đổi pixel format trước encode đã giảm độ sâu màu. Chưa đo HDR/colour metadata, nên không kết luận mọi nguồn HDR hỏng.

**Sửa:** chốt policy giữ pixel/sample format và metadata được hỗ trợ, test fidelity; nguồn không được hỗ trợ cần outcome rõ. Bỏ nhãn lossless tổng quát cho tới khi có bằng chứng trên format matrix.

### F10 — P2: ô điểm đầu trống bị hiểu là giây 0

**BROWSER_HARNESS + CODE_CONFIRMED.** `AutoShortCutPanel.tsx:69` gọi `Number(start)`. `Number('')` bằng 0; để trống đầu, nhập cuối=3, bấm Bỏ đoạn áp dụng `[0,3)` và không báo thiếu dữ liệu. Sau commit fields reset về playhead nên người dùng còn khó nhận ra input ban đầu đã bị hiểu sai.

**Sửa:** validate chuỗi trim không rỗng trước parse; draft và applied state riêng, lỗi sát trường, Enter/Escape/blur nhất quán; Start không bỏ qua draft đang nhập. Test cả whitespace, dấu thập phân, NaN, reversed/out-of-range và xóa toàn bộ.

![Sau khi đầu để trống và cuối bằng 3, UI đã áp dụng bỏ từ 0 đến 3](F:/Son/tool/TediaPros/.ai/tasks/2026-09-12-autoshort-cut-review/05-harness-empty-start.png)

### F11 — P2: history và ID chưa đủ để khôi phục đáng tin cậy

**TEST_CONFIRMED + CODE_CONFIRMED.** Bỏ `[1,3)` rồi `[2,4)` trở thành một range `[1,4)`. Khôi phục xóa cả union; không thể undo riêng thao tác sau để còn `[1,3)`, trái yêu cầu history trong Core. Normalizer cũng không reject ID trùng ở các range rời nhau; restore bằng filter ID sẽ xóa nhiều range nếu payload có ID trùng. Ngoài ra compiler với bỏ `[0,1)` và `[2,3)` trên nguồn 4 giây tạo hai keep segment đều tên `keep-1` (`autoShortTemporalEdit.ts:97–105`). Lỗi keep-ID chưa gây sai filter hiện tại vì executor dùng index, nhưng phá identity cho provenance dự kiến.

**Sửa:** tách operation history khỏi normalized execution plan; validate unique raw IDs, cấp keep IDs nhất quán; undo/redo scope từng item và một drag là một transaction. Khôi phục union có thể giữ như một hành động riêng nhưng không thay thế undo.

### F12 — P2: preview chưa thể kiểm tra bản cắt người dùng sắp chạy

**CODE_CONFIRMED.** `AutoShort.tsx:1216–1255` STTN preview luôn lấy `selectedTask.filePath` và 5 giây đầu, không nhận temporalEdit; token không phụ thuộc edit revision. Sau khi bỏ đầu, preview vẫn có thể xử lý đoạn đã bỏ. Video thường vẫn là nguồn, không có source/edited clock, marker hoặc exact join preview; chưa có frame step qua Main index. T09 yêu cầu rõ các phần này.

**Sửa:** cut preview dùng cùng planner/executor với source/item/revision token, có cancel và nhãn phạm vi; STTN preview của cut item phải theo retained plan. Chỉ hiện frame-step khi frame index đã bảo đảm. Không gọi preview cắt là preview final TTS/STTN nếu chưa chạy các stage đó.

## 3. Đối chiếu specs/planning

| Nhóm | Đã có ở commit | Còn thiếu / chưa đạt |
|---|---|---|
| T01–T02: contract/map | Typed per-item ranges, half-open integer timestamps, union, reject toàn bộ video | Frame boundaries; map source→edited→output/replay; unique IDs và property coverage |
| T03–T04: media | Edited master trước pipeline, source không bị ghi đè trong fixture | Frame index/oracle, common epoch/sample schedule, quota/lease, bit-depth policy, stress/cancel gates |
| T05–T07: nội dung/AI | Các đường source chính đã đổi sang processingPath/Meta | Seam provenance, semantic review, segment-aware grouping/retime, OCR/STTN reset |
| T08: persistence/cache | Edit trong journal, digest phân biệt edit | Draft/edit store trước enqueue, migration legacy/downgrade, stable semantic cache, run-edit conflict |
| T09: UI/preview | Bảng nhập mốc, bỏ trước/sau/khoảng, restore, queue badge | Layout, timeline/markers, draft/apply/discard, undo/redo, frame step, after-cut preview, stale guards |
| T10: batch/publish | Theo item, giữ output flow hiện hữu, cut-plan audit | Preset mixed sources, completion identity/map verification, fault injection, cut telemetry riêng |
| T11: nghiệm thu | Unit tests, smoke aligned 6→4, build/typecheck trước đó | Matrix F01–F18, real GUI/media integration và platform gates; chưa đủ để enable Core mặc định |
| T12–T14: extensions | Chưa có | Hold-frame và suggestions vẫn ngoài phần đã triển khai; không tính là lỗi vì extension chưa giao |

Spec đã ghi Core bao gồm frame/preview/undo/review/preset, nhưng bàn giao implementation thu nhỏ thành “Core MVP” và để các yêu cầu đó sang sau. Cách thu nhỏ phạm vi này chưa đáp ứng yêu cầu triển khai spec. Các check “đồng bộ hình/tiếng”, “resume đúng”, “no-edit giữ nguyên đường cũ” và “lossless” đã được đánh dấu rộng hơn kết quả kiểm thử cho phép. Merge trước khi kiểm UI và các gate Core là quá sớm.

## 4. Thứ tự sửa và nghiệm thu lại

1. **Khóa hành vi sai có thể tạo kết quả sai:** F01/F02/F03; giữ nguồn và journal, không silent fallback. Tạo regression từ các phản ví dụ đã lưu.
2. **Sửa bố cục F04 ngay trong cùng đợt:** giữ video có thể xem, fields hợp lệ, run snapshot/draft rõ. Kiểm UI thực tế với source video và mọi state, không chỉ harness shell.
3. **Hoàn thành preparation contract:** F05/F07/F08/F09, frame index và deterministic identity. Đo chi phí rồi chốt policy; cancel/fault trên scratch kiểm soát.
4. **Hoàn thành Core theo spec:** F06/F10/F11/F12; provenance, review seam, history, exact preview, batch preset và persistent edit.
5. **Nghiệm thu trước merge/enable:** freeze commit/runtime; run unit + real decoded media oracle + AutoShort/Electron. Tách live provider, installed build và macOS thành gate riêng. Nếu chưa đủ gate, ghi rõ phần chưa triển khai thay vì báo hoàn tất.

## 5. Bằng chứng và giới hạn

- [media-results.json](F:/Son/tool/TediaPros/.ai/tasks/2026-09-12-autoshort-cut-review/media-results.json): số đo stream start, frame end/count, PCM samples, SHA và lỗi spawn. FFmpeg thực tế `9.0.1-essentials_build-www.gyan.dev`.
- [reproduce.mjs](F:/Son/tool/TediaPros/.ai/tasks/2026-09-12-autoshort-cut-review/reproduce.mjs): fixture tổng hợp, production cut functions, Electron mock tối thiểu; tạo/xóa media trong scratch riêng. Các module cut được kiểm không có diff so với commit tại lúc chạy. Script dùng module của checkout, vì vậy chạy lại sau sửa sẽ đo behavior mới.
- [ui-harness.mjs](F:/Son/tool/TediaPros/.ai/tasks/2026-09-12-autoshort-cut-review/ui-harness.mjs): lấy source/CSS từ commit cố định; browser interactions và ảnh đã lưu. Tab/server thử nghiệm đã đóng.
- [typecheck.log](F:/Son/tool/TediaPros/.ai/tasks/2026-09-12-autoshort-cut-review/typecheck.log): `npm.cmd run typecheck` PASS, cả Node/Web trên working tree lúc review.
- [tests.log](F:/Son/tool/TediaPros/.ai/tasks/2026-09-12-autoshort-cut-review/tests.log): **23 tests PASS, 0 fail**: temporal-contract 3, cut-filter 2, journal-resume 3, stage-cache 3, OCR-pipeline 12. Working tree có thay đổi khác đang diễn ra; không gọi đây là CI của frozen commit.

Lệnh tái hiện media từ repository root:

```powershell
node .ai/tasks/2026-09-12-autoshort-cut-review/reproduce.mjs C:/Users/PC/AppData/Roaming/tediapros/bin/ffmpeg.exe C:/Users/PC/AppData/Roaming/tediapros/bin/ffprobe.exe
```

Lệnh kiểm thử đã chạy:

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-temporal-edit-contract.test autoshort-cut-media.test autoshort-batch-resume.test autoshort-stage-cache.test autoshort-ocr-pipeline.test
```

Các điểm tốt đã xác nhận: no-edit không gọi cut encoder trong coordinator; source fixture giữ nguyên hash; trường hợp căn frame `[2,4)` có đủ hình/tiếng 4 giây; contract reject một số payload sai và xóa hết; các downstream source chính đã chuyển sang edited master; typed IPC và cleanup path được tận dụng.

Không gọi test pass là đã sửa lỗi. Hai test cut media hiện có chỉ assert chuỗi graph; journal test không gọi `resumeAutoShortBatch` thật; OCR integration không đưa temporalEdit vào input. Chưa chạy full AutoShort với cut qua provider/GUI, Windows installed build, macOS, VFR/HDR fidelity hoặc nghe/đánh giá STTN tại seam. Các lỗi runtime cụ thể trong review là fixture offline; các thiếu sót integration được ghi CODE_CONFIRMED, không giả thành output hỏng đã quan sát.
