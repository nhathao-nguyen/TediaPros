# Đánh giá hệ thống TediaPros — 07/09/2026

**Kết luận:** TediaPros có nền tảng xử lý media và kiểm thử cục bộ khá tốt, nhưng chưa đủ điều kiện chốt một bản phát hành ổn định cho máy cài mới. Cần ưu tiên tính đúng của kết quả, ranh giới filesystem, vòng đời tác vụ và phân phối runtime trước khi tiếp tục tăng mức song song.

Snapshot: nhánh `main`, commit `6291184eddc6df893ef13eaae68bdd1d27736812`, app `0.1.22`. Không sửa mã sản phẩm, dependency, LICENSE/NOTICE, Git index hoặc nhánh. Các tài liệu/thư mục untracked có từ trước được giữ nguyên. Build kiểm tra nằm riêng tại `F:/Son/tool/TediaPros/out/review-20260907`.

Đây là review diện rộng các phân hệ, đọc sâu các đường thực thi có rủi ro và kiểm chứng bằng test/probe. Không đồng nghĩa đã đọc từng dòng hoặc kiểm thử mọi tổ hợp giao diện, phần cứng và dịch vụ bên ngoài.

## 1. Những phát hiện cần xử lý

P1: xử lý trước khi phát hành rộng hoặc dựa vào tính năng liên quan. P2: lỗi/rủi ro cần xử lý, có điều kiện kích hoạt cụ thể. Không phát hiện nào dưới đây được diễn giải thành bằng chứng đã có tấn công hoặc mất dữ liệu thực tế.

### R1 — P1: Dubbing vượt trần 1,45× và lấy gần hết khoảng nghỉ

**Vị trí:** [synthesis.ts:285](F:/Son/tool/TediaPros/src/main/dubbing/synthesis.ts:285), [autoShortPolicy.ts:919](F:/Son/tool/TediaPros/src/main/autoShortPolicy.ts:919).

`preferredTempo` có giới hạn, nhưng `targetDuration = min(naturalDuration / preferredTempo, safeAvailable)` có thể buộc tempo thực vượt giới hạn đó. Deadline chỉ cách câu sau 0,02 giây. Sau xử lý, `hardEnd` được nới theo `voiceEnd`; validator `source-anchored-v2` biến tempo quá cao thành warning.

**Bằng chứng:** [test hiện hành:370](F:/Son/tool/TediaPros/tests/dubbing-plan.test.ts:370) yêu cầu audio 5 giây được ép còn 1,98 giây, tempo **2,5253×**, và `validateAutoShortTimelineSync(...).ok === true`. Test này đã chạy và pass trong lần review. Đây là hành vi đang được test bảo vệ, không phải suy đoán từ tên biến.

Hành vi mâu thuẫn với trần 1,45× trong hướng dẫn được cung cấp và khoảng nghỉ 0,50 giây trong [AGENTS dubbing](F:/Son/tool/TediaPros/src/main/dubbing/AGENTS.md:24), [ADR 005](F:/Son/tool/TediaPros/docs/adr/005-source-anchored-dubbing-tempo-policy.md). Không dùng test xanh để xác nhận tuân thủ policy.

**Hướng xử lý:** chốt một policy thống nhất; theo yêu cầu hiện tại, kiểm tra tempo tổng trước DSP và sau đo audio, không nới hardEnd để hợp thức hóa vi phạm, chuyển sang rephrase/split hợp lệ hoặc báo lỗi. Thêm kiểm thử audio quá dài và khoảng nghỉ trước câu sau. Chưa đo chất lượng nghe thực tế của mẫu 2,5253×.

### R2 — P1: Validator thư mục nuốt lỗi junction/symlink

**Vị trí:** [safeContainedPath.ts:83](F:/Son/tool/TediaPros/src/main/safeContainedPath.ts:83).

Khi thư mục cha là junction/symlink, code chủ động `throw` nhưng `catch` ngay bên dưới bắt luôn lỗi đó rồi đi lên thư mục cha tiếp theo. Trường hợp `allowed/redirect/output.bin`, với `redirect` trỏ sang thư mục ngoài `allowed`, vẫn được chấp nhận. Hàm được gọi khi kiểm tra đích mask tại [ocrMask.ts:330](F:/Son/tool/TediaPros/src/main/ocrMask.ts:330).

**Bằng chứng:** probe gọi trực tiếp module hiện hành với một junction Windows trong fixture riêng: `accepted: true`, `parentOutsideAllowedRoot: true`. Probe chỉ kiểm tra đường dẫn; không ghi file ra ngoài scope fixture.

**Tác động:** ranh giới ghi file mà caller tin cậy có thể bị vượt qua nếu cây thư mục chứa junction được chuẩn bị trước. Chưa chứng minh đường khai thác từ xa; một số caller còn kiểm tra bổ sung về sau.

**Hướng xử lý:** chỉ đi lên khi lỗi là không tồn tại; lỗi phát hiện symlink phải truyền ra ngoài. Kiểm tra containment của đích chuẩn hóa và realpath của ancestor trước khi ghi/rename; bổ sung test junction, ancestor không tồn tại và lỗi quyền truy cập.

### R3 — P1: Kênh runtime mặc định chưa dùng được cho cài mới; pipeline release thiếu thành phần

**Vị trí:** [distributionConfig.ts:73](F:/Son/tool/TediaPros/src/main/distributionConfig.ts:73), [publish-github-release.mjs:126](F:/Son/tool/TediaPros/scripts/publish-github-release.mjs:126), [pack-runtime-release.mjs:15](F:/Son/tool/TediaPros/scripts/pack-runtime-release.mjs:15).

GET không xác thực tới cả `runtime-manifest.json` và `separator-model-manifest.json` của kênh mặc định `nhathao-nguyen/TediaPros/runtime-v5` trả **HTTP 404** trong lần review. GitHub API release cùng tag cũng trả 404. Không thể phân biệt release chưa xuất bản với repository/private access chỉ bằng 404; điều được xác nhận là các URL công khai mặc định hiện không phục vụ manifest cho client không xác thực.

Đồng thời, workflow Windows build separator engine nhưng không đóng gói/publish hai model separator. Publisher chỉ liệt kê runtime manifest, provenance và các archive runtime. STTN là optional trong packer, không có trong `distribution/runtime-inputs.json` hiện hành và không có bước build STTN trong workflow này. Vì vậy chạy lại luồng release đang lưu trong repo không tự tạo đủ bộ phụ thuộc cho tất cả tính năng được bật.

**Tác động:** máy đã cài sẵn runtime có thể hoạt động, nhưng điều đó không chứng minh luồng cài mới. `release:verify-runtime` tại workspace cũng thất bại vì thiếu `release-artifacts/runtime-manifest.json`; đây là trạng thái artifacts cục bộ, không phải lỗi typecheck/build.

**Hướng xử lý:** thống nhất kênh phân phối có thể truy cập từ client, tích hợp STTN và model separator vào quy trình build/verify/publish, rồi chạy acceptance trên userData trống: cài → tải đủ → chạy → khởi động lại offline. Nếu có quy trình phát hành riêng ngoài repo, cần đưa quy trình và evidence vào release gate.

### R4 — P2: Hủy trong lúc đọc dung lượng làm rò reservation và mất waiter

**Vị trí:** [autoShortDiskBudget.ts:186](F:/Son/tool/TediaPros/src/main/autoShortDiskBudget.ts:186).

`drain()` giữ `entry` và `index` qua `await getFreeBytesFn()`. Trong lúc chờ, abort handler có thể xóa entry khỏi `pending`. Khi await trả về, code vẫn `splice(index, 1)` rồi cấp reservation cho entry đã hủy. Nếu B đứng sau A, thao tác này có thể xóa nhầm B mà không resolve/reject B.

**Bằng chứng:** free-space probe được trì hoãn có kiểm soát; hủy A rồi trả đủ dung lượng. A nhận `ABORT_ERR`, ledger vẫn giữ 100 byte của A, B tiếp tục pending dù còn 1.000 byte trống. Không sử dụng ổ đĩa thật gần đầy.

**Phạm vi:** admission ledger được bật trong nhánh thử nghiệm `maxActiveItems: 2` tại [autoshort.ts:2476](F:/Son/tool/TediaPros/src/main/autoshort.ts:2476). Không quy lỗi này thành hiện tượng mặc định mọi queue đều treo.

**Hướng xử lý:** sau mỗi await, kiểm tra lại signal và sự tồn tại của entry bằng ID; chỉ xóa đúng entry đang xử lý. Kiểm thử hủy trong cả nhánh thành công/lỗi statfs và waiter kế tiếp.

### R5 — P2: Giải phóng slot khi abort trước khi công việc thật dừng

**Vị trí:** [autoShortResourceManager.ts:110](F:/Son/tool/TediaPros/src/main/autoShortResourceManager.ts:110).

`withLease()` giải phóng resource ngay khi signal abort, dù `action()` chưa settle. Điều này mở slot cho tác vụ khác khi helper cũ vẫn có thể dùng GPU/CPU. Các caller OCR, STTN, ASR và separation dùng cùng cơ chế lease.

**Bằng chứng:** capacity GPU = 1; action A giữ promise chưa hoàn tất; B chờ; abort A làm B chạy khi A vẫn active. Peak đo ở adapter = **2 actions đồng thời**. Đây là probe vòng đời adapter, chưa phải phép đo OOM trên GPU thực.

**Tác động:** với các item/luồng song song có signal riêng, lỗi hoặc hủy một nhánh có thể phá giới hạn tài nguyên. Scope drain của item không ngăn item khác nhận slot đã được nhả sớm.

**Hướng xử lý:** giữ lease đến khi helper/action xác nhận dừng; xử lý provider không hợp tác bằng timeout và teardown có giới hạn. Kiểm thử ranh giới abort → close/settle → cấp slot kế tiếp.

### R6 — P2: OCR độc lập báo thành công với SRT thiếu hoặc rỗng

**Vị trí:** [ocr.ts:294](F:/Son/tool/TediaPros/src/main/ocr.ts:294), [ocr.ts:323](F:/Son/tool/TediaPros/src/main/ocr.ts:323).

OCR có kiểm tra file/cues nhưng catch dùng cho chuyển định dạng bắt cả lỗi kiểm tra đó, thêm `doneOut` vào outputs, rồi trả `ok: true`.

**Bằng chứng:** gọi hàm `ocrVideo()` hiện hành với engine giả lập gửi `done` và exit 0. Cả output không tồn tại lẫn SRT rỗng đều nhận `ok: true`. Mock chỉ thay ranh giới engine/probe; logic xử lý kết quả vẫn là source hiện hành.

**Tác động:** tab Đọc chữ video có thể hiển thị xong và cung cấp đường dẫn không sử dụng được. Đây là đường OCR độc lập; không đánh đồng với validator visual timeline của AutoShort.

**Hướng xử lý:** tách lỗi output không hợp lệ khỏi fallback chuyển định dạng; output gốc phải được xác minh trước khi cho phép fallback. Không trả đường dẫn đã bị xóa hoặc chưa tạo.

### R7 — P2: Douyin bỏ toàn bộ stdout nên mất thống kê thật

**Vị trí:** [douyin.ts:161](F:/Son/tool/TediaPros/src/main/douyin.ts:161), [progress_display.py:230](F:/Son/tool/TediaPros/engines/douyin-engine/cli/progress_display.py:230).

`feed()` chỉ cộng chunk vào `errBuf`; thiếu nhánh `outBuf += chunk`. Bảng Rich `Total/Success/Failed/Skipped` được engine xuất qua stdout nên không được đọc. Main còn coi exit 0 là thành công; CLI có nhánh lỗi config chỉ `return` bình thường.

**Bằng chứng:** cùng bảng tổng 3/thành công 1/lỗi 1/bỏ qua 1: đưa qua stdout cho kết quả `{total:0, failed:0, ok:true}`; control đưa qua stderr được `{total:3, failed:1}`. Đây là test adapter cục bộ, không gọi Douyin live.

**Hướng xử lý:** sửa buffer stdout; tốt hơn, dùng final result JSON có schema và quy ước exit code rõ ràng. Trạng thái partial failure phải dựa trên kết quả có cấu trúc thay vì chỉ mã thoát. Bổ sung test chunks bị chia đôi và dòng cuối không có newline.

### R8 — P2: Electron/toolchain còn dependency bị advisory cảnh báo

**Vị trí:** [package.json](F:/Son/tool/TediaPros/package.json), [package-lock.json](F:/Son/tool/TediaPros/package-lock.json).

Lockfile đang khóa Electron **34.5.8**, electron-builder **25.1.8**, tar **6.2.1**. `npm audit --json` trả exit 1 với **14 package entries: 13 high, 1 critical**. Đây là số package bị ảnh hưởng, có cả phụ thuộc lan truyền; không phải 14 lỗ hổng độc lập đã khai thác được trong TediaPros.

`npm audit --omit=dev` trả 0 vulnerabilities. Tuy nhiên Electron được khai báo devDependency nhưng binary Electron được dùng để đóng gói app, nên không thể dùng kết quả omit-dev để bỏ qua Electron. Một số advisory chỉ áp dụng API/OS không được luồng hiện tại sử dụng. `electron-updater` trong lock là 6.8.9 và mã cập nhật app hiện bị tắt có chủ đích.

**Hướng xử lý:** nâng Electron và toolchain theo một thay đổi riêng có regression/packaging validation; phân loại advisory theo đường sử dụng thật. Không chạy `npm audit fix --force` tự động. Electron khuyến nghị duy trì framework hiện hành và kiểm tra dependency; advisory node-tar mô tả DoS khi xử lý input không giới hạn. Nguồn chính thức: [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security), [node-tar advisory](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw).

### R9 — P2: Package verifier báo PASS khi thư mục đích không tồn tại

**Vị trí:** [verify-packaged-app.mjs:31](F:/Son/tool/TediaPros/scripts/verify-packaged-app.mjs:31), [verify-packaged-app.mjs:88](F:/Son/tool/TediaPros/scripts/verify-packaged-app.mjs:88).

`readdir()` thất bại được coi như scan rỗng; không có bước bắt buộc kiểm tra root/app executable/resources trước khi in PASS. Verifier chỉ duyệt filesystem, chưa kiểm kê nội dung ASAR.

**Bằng chứng:** chạy script với đường dẫn chắc chắn không tồn tại trong evidence: exit 0 và `PASS: No prohibited ...`. Không tạo/copy/xóa installer để thử.

**Tác động:** lỗi sai đường dẫn hoặc thiếu artifacts có thể cho tín hiệu kiểm chứng giả. Chưa kết luận một installer thực tế đã bị đóng gói sai.

**Hướng xử lý:** fail khi root không tồn tại/không đọc được; xác nhận cấu trúc package mong đợi; kiểm tra ASAR và các tài nguyên bắt buộc trước khi cấp trạng thái đạt.

## 2. Đánh giá theo phân hệ

| Phân hệ | Điểm đã có | Đánh giá và phần còn thiếu |
| --- | --- | --- |
| Kiến trúc Electron/React/Python | Main–preload–renderer tách lớp; engine cô lập tiến trình; nhiều thuật toán thuần ở shared | Hướng kiến trúc phù hợp. Ranh giới vận hành chưa đồng đều giữa AutoShort và các tab độc lập. |
| AutoShort orchestration | Coordinator, item scope, drain, queue, checkpoint, telemetry, resource manager | Tiến bộ rõ về khả năng quan sát/cleanup. Cần R4/R5 trước khi tăng song song. Mặc định vẫn một item, không overlap/prefetch, transport conservative `legacy-disk`. |
| Dubbing/translation | Source identity/schema, audio cache, đo duration, predictor, rephrase, source-anchored plan | R1 là mâu thuẫn chính sách nghiêm trọng. Giữ đủ cue ID/text không chứng minh bản dịch đúng nghĩa hoặc TTS đọc đủ từng từ. |
| OCR/timed blur | Visual timeline, kiểm tra geometry, mask, capability negotiation, transport streaming, planar RGB | Test nền tảng tốt; giữ nguyên RGB trước maskedmerge. Cần R2/R6; tốc độ/chất lượng OCR thật phụ thuộc binary, profile và vùng quét. |
| STTN | Model được pin trong source; runner có timeout/output bound; xử lý video/audio có kiểm thử thật | 26 test pass với đủ phụ thuộc. Inference tests dùng model/adapter thử, không chứng minh chất lượng model STTN trên corpus thật. Release engine còn thiếu trong luồng chuẩn. |
| Separation | Model/manifest checks, offline pipeline, provider fallback, preset và mixing contract | 13 test Python và các TS suite pass. Báo cáo qualification có trong repo; không xác nhận lại các số GPU/chất lượng cũ trong lượt này. R3 còn chặn độ tin cậy cài mới. |
| ASS/font/burn | Font checksum, đo/layout, hình học chuẩn hóa, smoke render cả 3 style | Render FFmpeg thật pass, số frame hash phân biệt style như kỳ vọng. Chưa đánh giá mắt người mọi font/ngôn ngữ/kích thước. |
| Downloader/Douyin | Queue, cookie workflow, metadata/manifests, thư viện kênh | Douyin có R7. Không xác nhận anti-bot/cookie hoặc tải live. Python mặc định thiếu môi trường test Douyin. |
| Renderer/editor/voice/enhance | Giao diện đủ các tab, preload có types, giữ tab mounted để bảo toàn tác vụ, cleanup listener ở các luồng đã đọc | Chỉ review code/build, chưa click GUI. Các tab cùng sống cần được test chạy đồng thời; Video2X GPU và voice server chưa chạy thật. |
| Bảo mật/IPC | contextIsolation, nodeIntegration=false, CSP, chặn mở cửa sổ mới, lọc URL ngoài | `sandbox:false`, thiếu allowlist navigation/sender ở main window cần hardening; chưa có exploit được chứng minh. Typed IPC không thay thế kiểm tra nguồn gửi/runtime validation. |
| Lưu trữ/khôi phục | Item workDir, cache, checkpoint, path checks, log/telemetry redaction | Cần test hủy/đầy đĩa/crash xuyên toàn hệ thống. Douyin và audioPreview dùng spawn trực tiếp ngoài registry processTree; không suy ra toàn bộ helper đều được shutdown barrier quản lý. |
| Release/vận hành | Pin inputs, checksum, native probe, atomic install, CI, metadata gate | R3/R8/R9 là khoảng trống. Updater hiện là no-op; CI app chỉ có Windows. macOS vẫn cần acceptance riêng. |

**Khả năng bảo trì:** `autoshort.ts` 2.743 dòng, coordinator 1.055, `burn.ts` 1.877, `index.ts` 1.085; UI AutoShort 2.544, VideoEditor 1.603. Độ lớn không tự nó là lỗi, nhưng policy, adapter và trạng thái UI cùng tập trung khiến thay đổi khó kiểm soát. Nên tách dần theo trách nhiệm sau khi khóa hành vi bằng test; không cần viết lại toàn hệ thống.

**Tài liệu:** có atlas/ADR hữu ích nhưng một phần chưa được Git theo dõi. Các diễn giải “mọi đường dẫn đều an toàn”, “mọi helper đều được theo dõi”, trần tempo và auto-update cần đối chiếu lại code. Không coi sơ đồ hoặc ô checklist Accepted là bằng chứng chạy thực tế.

## 3. Kiểm chứng đã chạy

Môi trường shell: Windows; Node 24.19.0, npm 11.17.0, Python mặc định 3.14.7. STTN kiểm tra bổ sung bằng Python 3.12.14 trong `.venv-build`, PyAV 15.1.0, Torch 2.7.1+cu118. CI app đang khai báo Node 20.19.1; build local chưa xác nhận đồng nhất hoàn toàn với CI.

| Lệnh / kiểm tra | Kết quả thực tế |
| --- | --- |
| `npm.cmd run typecheck` | PASS, cả node và web |
| `npm.cmd run test:local-runtime` | PASS **418/418**, 29 test files; 0 fail/cancel/skip |
| `npm.cmd run test:ocr-engine` | PASS **31/31** |
| `npm.cmd run test:separator-engine` | PASS **13/13** |
| `npm.cmd run test:sttn-engine` với Python mặc định | Exit 0, 26 tests nhưng **17 skipped** |
| STTN unittest bằng `.venv-build/Scripts/python.exe`, có `STTN_TEST_FFMPEG` | PASS **26/26**, **0 skipped** |
| `npm.cmd run fonts:verify` | PASS, 4 fonts, 12,90 MiB |
| `npm.cmd run test:subtitles` ban đầu | Logic pass, render skipped vì FFmpeg không nằm trên PATH |
| Smoke subtitles với managed FFmpeg thêm vào PATH của process kiểm tra | PASS, render thật: standard/reveal/highlight = **2/10/24** unique frame hashes |
| `npm.cmd run build -- --outDir F:/Son/tool/TediaPros/out/review-20260907` | PASS main/preload/renderer; cảnh báo dynamic+static imports không tạo chunk riêng |
| `npm.cmd run release:verify` | PASS metadata/version **0.1.22**; không phải xác minh installer |
| `npm.cmd run release:verify-runtime` | FAIL: thiếu runtime-manifest trong artifacts cục bộ |
| `npm.cmd audit --json` | Exit 1: 13 high + 1 critical package entries |
| `npm.cmd audit --omit=dev --json` | PASS: 0 vulnerabilities trong dependency subset này |
| `python engines/douyin-engine/run.py --help` | FAIL do Python mặc định thiếu `yaml`; không chứng minh packaged binary hỏng |
| `python -m pytest --version` | Không có pytest trong Python mặc định; chưa chạy suite Douyin |
| `repro-core.mjs` | Tái hiện R2/R4/R5; exit 0 nghĩa là xác nhận lỗi còn tồn tại |
| `repro-standalone.mjs` | Tái hiện R6/R7; engine giả lập, không gọi dịch vụ thật |
| Package verifier với root không tồn tại | Exit 0/PASS sai, xác nhận R9 |
| GET hai URL manifest mặc định + GitHub release API | Cả ba trả HTTP 404 không xác thực |

Log/probe nằm trong [evidence](F:/Son/tool/TediaPros/docs/reviews/2026-09-07-system-review/evidence). Các `.log` bị `.gitignore` bỏ qua: đang là bằng chứng local, chưa được commit. Script tái hiện gọi module hiện hành; phần cố tình xác nhận lỗi được chú thích để không nhầm thành regression test đã sửa.

Không chạy synthesis/translation tính phí, benchmark tải server, tải model/binary lớn, publish, hay thay đổi cấu hình người dùng. Chưa chạy một AutoShort E2E thật qua ASR → dịch server → TTS → STTN/separation → MP4 trên snapshot này; suite có tên `e2e-autoshort` hiện chủ yếu kiểm tra logic với dữ liệu tổng hợp.

## 4. Thứ tự thực hiện đề xuất

1. **Khóa tính đúng:** sửa R1/R2; thống nhất code, test và ADR về tempo/gap; yêu cầu output hợp lệ trước trạng thái thành công ở R6/R7.
2. **Khóa vòng đời:** sửa R4/R5; test abort trong khi đang đợi I/O và khi child chưa close; mở rộng theo dõi helper cho tab độc lập. Giữ mặc định conservative trong lúc này.
3. **Khóa phát hành:** xử lý R3/R8/R9; hoàn thiện runtime/model artifacts, nâng toolchain, acceptance trên userData trống và offline restart. Không coi build app pass là máy mới dùng được.
4. **Đo trước khi tối ưu:** dùng telemetry hiện có đo riêng queue-wait/OCR/ASR/translate/TTS/DSP/STTN/burn, peak scratch/RAM/VRAM, số retry/cache hit và tỷ lệ job thành công. So sánh cùng video/cấu hình/runtime, lấy median/p95; không đặt KPI tốc độ từ unit test.
5. **Bổ sung acceptance người dùng:** test GUI bật nhiều tab, hủy rồi chạy lại, thiếu runtime, ổ đĩa thấp, đường dẫn Unicode/junction, đổi server/model, resume sau restart; sau đó mới mở overlap/prefetch và hai item theo benchmark.

Các thay đổi trên là đề xuất xử lý sau review. Báo cáo này không triển khai chúng và không xác nhận sẵn sàng production.
