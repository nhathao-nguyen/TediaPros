# Đối chiếu branch workflow-capcut-youtube và thiết kế tích hợp Edge-TTS

Ngày khảo sát: 2026-09-12. Trạng thái: **đã khảo sát, thiết kế đề xuất; chưa triển khai**.

## 1. Kết luận

Checkout hiện tại không thiếu toàn bộ workflow của branch. Git xác nhận phần lịch sử đến `079387a507f9fe15b62c51cf719003110bcadd6b` đã có trong `main`, qua merge `645a9ea7163db705c212a8a1cf9d0cb18ce7b909`. Phần chưa có chỉ là commit `1d61ef744384208382de3903b73b2953d45553ab` bổ sung Microsoft Edge-TTS.

Đề xuất **port có chọn lọc Edge-TTS vào kiến trúc hiện tại**, giữ Local TTS làm mặc định và giữ nguyên toàn bộ các cải tiến AutoShort sau điểm chung. Không lấy nguyên các file AutoShort/Voice cũ để thay thế file hiện tại.

## 2. Snapshot và phương pháp

| Đối tượng | Giá trị xác minh |
|---|---|
| Repository | `F:\Son\tool\TediaPros` |
| Checkout | `main`, HEAD `cd7d86552fb40ce10656346e52cdea914a39bac0` |
| Package hiện tại | `0.1.26` |
| Remote | `https://github.com/nhathao-nguyen/TediaPros.git` |
| Branch đích | `fix/workflow-capcut-youtube` |
| Remote tip đã fetch và đối soát bằng ls-remote | `1d61ef744384208382de3903b73b2953d45553ab` |
| Merge base | `079387a507f9fe15b62c51cf719003110bcadd6b` |
| Commit riêng mỗi phía | `main`: 90; branch đích: 1 |
| Incoming delta từ merge base | 11 file; +1789 / -403 dòng |
| Working tree khi khảo sát | 27 tracked file sửa, cùng nhiều untracked file thuộc các công việc khác |

Git fetch và git show đọc nội dung thực tế của remote; trang branch qua web tool không truy cập được. Không suy luận tính năng từ tên branch. Dùng diff ba chấm để xác định incoming delta, không lấy diff hai đầu làm danh sách tính năng còn thiếu. Mô phỏng bằng `git merge-tree --write-tree --name-only HEAD 1d61ef7`: không thay checkout/index; chỉ tạo Git tree phục vụ phân tích.

Mô phỏng này chỉ áp dụng cho **committed HEAD**, không bao gồm dirty changes. Các thay đổi dịch/SEO đang nằm trong `gemini.ts`, `openai.ts`, `localTranslate.ts`, `translation/*`, `videoTitle.ts`, `videoSeo.ts`, test runner và tài liệu phải được giữ nguyên. Trước triển khai cần chọn base mới sau khi những thay đổi đó được chủ công việc chốt; không tự stash/reset/stage chúng.

## 3. Ma trận thiếu / đã có

| Khả năng | Project hiện tại | Incoming branch | Đánh giá |
|---|---|---|---|
| Source-anchored dubbing, duration-aware translation, split nhóm quá dài | Đã có lịch sử branch và nhiều cải tiến tiếp theo | Có từ trước commit Edge | CODE_CONFIRMED: không cần nhập lại |
| Local TTS, named voice, clone, denoise/capability filtering | Có | Có từ nền cũ | Giữ implementation hiện tại |
| Edge-TTS provider | Không có module/dependency/provider discriminator trong source | Có `edgeTts.ts`, dispatch trong `generateSpeech` | Thiếu thực sự |
| Danh sách giọng Edge | Chưa có | 35 giọng seed, 14 mã ngôn ngữ, 17 locale; tải danh sách động và fallback seed | Port catalog + validation |
| Voice tab chọn Local/Edge, preview, pitch, lưu MP3 | Chưa có selector Edge | Có thay đổi UI | Port vào UI hiện tại, sửa metadata audio |
| AutoShort chọn Edge, bỏ kiểm tra Local TTS khi dùng Edge | Chưa có | Có wiring | Cần thích nghi preflight, cache v2, telemetry, resume |
| Batch Edge chạy song song 4 worker, tối đa 8 | Chưa có helper Edge | Có helper `generateEdgeTTSBatch` | CODE_CONFIRMED: helper chỉ khai báo/re-export; không có caller trong source branch |
| Word/sentence boundaries từ Edge | Chưa có | Adapter không đọc metadata stream | Không đưa vào phạm vi phiên bản đầu |
| CapCut/YouTube mới trong delta | Có downloader YouTube và SEO riêng trong project | Incoming commit không sửa module CapCut, downloader hay SEO | Không có bằng chứng về tính năng CapCut/YouTube mới cần nhập |
| Tách vocals, OCR timed blur/GPU, STTN cache, batch resume, temporal cut, overlay | Có implementation/commit mới hơn merge base | Không phải phần mới của branch | Giữ nền hiện tại; không rollback về branch |

Chú thích: CODE_CONFIRMED nghĩa là đọc được implementation, không chứng minh chất lượng/live availability. Tài liệu `architecture.md` và `dubbing/AGENTS.md` có nhắc Edge dù source chưa có: các dòng đó là **DOCUMENTED_ONLY** đối với Edge.

## 4. Inventory toàn bộ incoming delta

| File | Nội dung incoming | Cách tích hợp |
|---|---|---|
| `package.json` | Thêm `msedge-tts: ^2.0.7` | Chốt version đã qualification, không đổi version app trong bước port |
| `package-lock.json` | Dependency tree mới, một số dev flags chuyển runtime | Regenerate trên base hiện tại; không thay nguyên lock cũ |
| `src/main/edgeTts.ts` | Catalog, model capabilities, streaming MP3, batch helper | Tham khảo; tách catalog và sửa transport lifecycle trước dùng |
| `src/main/tts.ts` | Re-export, dispatch Edge trước Local | Giữ requestSpans, leases, clone retry, filtering hiện tại |
| `src/main/index.ts` | IPC `tts:getEdgeVoices` | Thêm typed result, giữ origin validation hiện tại |
| `src/preload/index.ts` | `ttsGetEdgeVoices` | Đồng bộ signature với shared type |
| `src/shared/types.ts` | `TtsProvider`, `EdgeVoiceDefinition`, provider trong request/config | Optional field, default Local tại runtime |
| `src/shared/autoShortContract.ts` | Allowlist provider | Thêm kiểm tra tổ hợp voice/model/options/clone |
| `src/main/autoshort.ts` | Dispatch, preflight, provider cache identity | Port vào cache v2 và synthesis adapter hiện tại |
| `src/renderer/src/components/AutoShort.tsx` | Selector provider, danh sách giọng, request config | Giữ cut/overlays/ROI/music/separation; tách persisted Edge voice |
| `src/renderer/src/components/Voice.tsx` | Selector, Edge preview/pitch/export; thay đổi form và save-key UI | Port phần Edge; không nhập thay đổi save-key không liên quan |

Coverage: phân loại đủ 11/11 file incoming. Đọc sâu adapter, các contract/dispatch hunks, UI state/request/export và các điểm tích hợp hiện tại; lockfile đối chiếu dependency delta, không coi đó là audit mọi dependency transitive. Không tuyên bố đã đọc toàn bộ repository.

## 5. Findings cần xử lý trước khi tích hợp

### F1 — Hủy/timeout chỉ resolve kết quả, chưa thu hồi kết nối (P1)

`edgeTts.ts:448-552` trong incoming: `cleanup()` chỉ gỡ timer/listener của signal. `MsEdgeTTS` và audio stream không được đóng; listener data tiếp tục push buffer. Timeout trong lúc `setMetadata` chưa xong vẫn có thể để continuation mở stream. Abort khi handler close đang chờ ghi file còn có thể để lại file sau khi caller đã nhận kết quả hủy.

Yêu cầu: lifecycle một lần kết thúc; dispose transport/stream; chặn continuation sau abort; ghi temp rồi publish sau kiểm tra signal; xóa partial. Giới hạn byte và deadline phải được code sở hữu, không nhận tùy ý từ renderer.

### F2 — Văn bản chưa escape trước SSML (P1)

Incoming truyền `text` trực tiếp vào `tts.toStream`. Tài liệu chính thức của thư viện yêu cầu escape/sanitize input. Đây là khoảng trống tại adapter, cần xác nhận hành vi bản package được pin bằng test với `&`, `<`, `>`, dấu nháy và chuỗi thẻ `prosody`. Không được làm thay đổi văn bản người dùng muốn đọc. Nguồn: [MsEdgeTTS README](https://github.com/Migushthe2nd/MsEdgeTTS#example-usage).

### F3 — State và default có thể chọn sai giọng (P1)

AutoShort incoming mặc định provider `edge-tts` nhưng tái sử dụng `tblao.autoshort.ttsVoice` của Local. Effect đọc Local capabilities vẫn có thể gọi `setTtsVoice`. Fallback trong request/UI chỉ xét tiếng Anh; mọi ngôn ngữ khác rơi về Hoài My nếu thiếu voice. Dynamic catalog không đi cùng dynamic model languages: model capabilities chỉ lấy seed. Đây là các đường code gây sai routing/không hỗ trợ đúng catalog, chưa chạy UI live để đo tần suất.

Yêu cầu: giữ Local mặc định; key Edge voice riêng; resolver locale/ngôn ngữ từ một catalog; không mặc định tiếng Việt khi ngôn ngữ khác chưa được hỗ trợ; bỏ voice clone khỏi Edge và báo lỗi khi caller cố gửi clone.

### F4 — Edge readiness chưa được kiểm chứng (P2)

Incoming UI hiển thị trạng thái online cố định; preflight gán `available: true` mà không có probe mạng. Catalog fallback chỉ giúp chọn giọng, không tạo audio offline. Phải có trạng thái chưa kiểm tra/đang kiểm tra/có kết nối/lỗi và timestamp; listing thành công cũng không phải bằng chứng synthesis chắc chắn thành công.

### F5 — Container và duration metadata chưa chặt (P2)

Adapter chọn MP3 nhưng AutoShort caller truyền tên `.wav`. Pipeline hiện tại có kiểm tra header và trim/probe bằng FFmpeg, nên chưa đủ bằng chứng kết luận sẽ crash; vẫn phải chuẩn hóa container/extension tại boundary. `durationMs` incoming tính theo bytes/12000, không phải duration đã probe. Voice history fallback hardcode `audio/wav`; hàm Main lưu audio vẫn chỉ lọc WAV. UI dùng provider hiện đang chọn để suy ra đuôi file có thể sai nếu người dùng đổi provider sau khi generate.

Yêu cầu: Voice preview/export lấy MIME/format từ chính result; AutoShort nhận PCM WAV đã probe trước cache publication. Thời lượng dùng để fit luôn từ probe thực tế.

### F6 — Option và trần tốc độ có thể lệch chính sách (P1 cho AutoShort)

Incoming khai báo hỗ trợ `volume` nhưng không truyền volume vào prosody. `rate` explicit chưa có numeric/range validation; speed có thể tới 2.0. Phiên bản đầu AutoShort phải synthesis ở rate 1.0, không nhận explicit rate/pitch/volume; giữ DSP tempo tối đa 1.80x như hiện tại. Voice độc lập có thể có speed/pitch riêng được validate, không dùng tùy chọn đó để vượt trần dubbing.

### F7 — Chưa có tests cho Edge và chưa tích hợp batch helper (P2)

Incoming không sửa/thêm test. `git grep generateEdgeTTSBatch` chỉ ra declaration và re-export. Không có bằng chứng tăng tốc batch thực tế, không đưa lời hứa “hàng chục câu trong vài giây” vào sản phẩm. Giữ scheduling hiện tại ở phiên bản đầu; concurrency riêng là tối ưu sau qualification.

### F8 — Cache/resume và telemetry mới cần bảo toàn (P1)

Nền hiện tại dùng TTS cache v2 single-flight, content hash của clone reference, model revision, duration profiles và batch/checkpoint identities. Incoming viết trên nền cũ. Thêm provider không được đưa Edge audio vào cache Local hoặc làm job cũ mất khả năng resume do tự thêm default field vào config persisted. Edge phải có request spans tương tự Local, không đưa API key/URL token vào log.

## 6. Mô phỏng xung đột và lựa chọn

`merge-tree` trả exit 1 và content conflict tại 5 file: `autoshort.ts`, `tts.ts`, `AutoShort.tsx`, `Voice.tsx`, `autoShortContract.ts`. Các file còn lại auto-merge được về text; điều đó không chứng minh tích hợp đúng về hành vi.

| Phương án | Đánh đổi | Kết luận |
|---|---|---|
| Port riêng Edge-TTS | Commit gọn theo contract/adapter/UI/pipeline, thêm tests và sửa findings; cần kiểm tra từng hunk | **Khuyến nghị** |
| Cherry-pick `1d61ef7` rồi sửa | Giữ provenance tự động nhưng vẫn mang UI cũ và cùng vùng xung đột; không tự giải quyết regression | Chỉ hợp lý nếu cần giữ commit gốc |
| Merge toàn branch | Giữ ancestry; hiện chỉ thêm một commit nhưng phải giải quyết 5 conflict và review toàn bộ | Không có lợi thế chức năng so với port ở snapshot này |

Port sẽ ghi SHA nguồn trong commit/task; Git vẫn có thể báo incoming commit chưa là ancestor dù tính năng đã tương đương. Không tạo merge giả để che điều đó.

## 7. Thiết kế được đề xuất

- Shared: `TtsProvider = 'local-tts' | 'edge-tts'`; thiếu provider được hiểu là Local lúc sử dụng. Không tự thêm field vào config legacy trước hashing.
- Catalog: `src/shared/edgeTtsContract.ts` sở hữu seed, voice resolver và validation thuần; Main load catalog động, trả typed result kèm nguồn live/fallback và lỗi. UI tái sử dụng catalog, không nhân đôi danh sách hardcode.
- Main: `edgeTts.ts` adapter orchestration; `edgeTtsTransport.ts` bọc package và sở hữu socket/stream lifecycle; `edgeTtsAudio.ts` chuẩn hóa audio, probe và cleanup. Local implementation không bị thay thế.
- Voice: thêm provider, voice/language/pitch/speed của Edge; dùng result MIME trong preview/history/save. Catalog fetch chỉ khi cần Edge. Local clone/form/API key vẫn hoạt động như hiện tại.
- AutoShort: provider chỉ thay phần capabilities và TTS adapter. Translation preflight Local vẫn chạy nếu translation provider là Local, kể cả TTS là Edge. Toàn bộ cue IDs, source grouping, đo audio, rephrase, split, protected gaps, cut, OCR, STTN, nhạc nền và publishing giữ nguyên.
- Identity: Edge dùng endpoint namespace `edge-tts:msedge-tts:2.0.7` cùng resolved voice/options/model revision. Nếu package qualification chọn version khác thì đổi namespace theo exact version đó. Local giữ công thức cũ. Checkpoint/config digest mang Edge provider/voice; không mở rộng legacy fallback cho Edge/cut jobs.
- AutoShort Edge audio: rate 1.0; output WAV PCM mono 24 kHz đã probe. Voice preview giữ MP3 với `audio/mpeg`. Không lấy bitrate estimate làm timing truth.
- Giới hạn triển khai đề xuất: tối đa 60 giây/request, 16 MiB audio/request và 20.000 Unicode code points cho Voice text; AbortSignal vẫn có hiệu lực ngay. Đây là giới hạn mới của transport Edge, không bật lại ngân sách tổng dịch/recovery đang tạm tắt.
- Không voice clone cho Edge; không tự chuyển provider khi lỗi; không tự bật 4–8 worker của helper branch.

## 8. Bằng chứng và giới hạn

**TEST_CONFIRMED trên working tree hiện tại (chưa có Edge):**

- `npm.cmd run typecheck`: node + web PASS, exit 0.
- `node scripts/run-local-runtime-tests.mjs dubbing-plan.test dubbing-duration-profile.test autoshort-tts-cache.test autoshort-tts-pipeline.test autoshort-batch-resume.test autoshort-ui-contract.test`: 74 tests PASS, 0 fail (49 + 8 + 4 + 6 + 3 + 4).
- Đây là baseline của source hiện tại bao gồm dirty changes; không phải kết quả test branch remote hoặc bản port tương lai.

**UNKNOWN:** live Edge synthesis, giới hạn dịch vụ thực tế, chất lượng giọng từng ngôn ngữ, hiệu năng, Windows packaged app và macOS. Chưa cài package vào project, chưa gửi nội dung người dùng tới Edge. `npm view msedge-tts@2.0.7` xác nhận metadata package version, MIT, Node >=16 và dependency list; không phải qualification runtime. README thư viện cũng ghi Read Aloud có yêu cầu user agent; cần kiểm tra đúng package được pin khi triển khai.

Evidence nằm tại `.ai/tasks/2026-09-12-workflow-branch-integration/`: `incoming.patch`, `incoming-files.txt`, `divergence.txt`, `merge-tree.txt`, `status-before.txt`, `dirty-tracked-sha256.txt`, `baseline-tests.log`.

Kế hoạch triển khai: [2026-09-12-workflow-edge-tts-integration.md](../plans/2026-09-12-workflow-edge-tts-integration.md).
