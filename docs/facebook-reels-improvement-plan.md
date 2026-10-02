# Phương án cải tiến quét Facebook Reels cho TediaPros

- Ngày: 2026-10-02.
- Trạng thái: nghiên cứu ban đầu; discovery/caption và xuất bài viết đã được triển khai. Trạng thái hiện tại xem [hướng dẫn xuất](facebook-reels-export.md) và [ADR 012](adr/012-facebook-reels-scoped-discovery.md).
- Dự án tham khảo: `F:\Son\tool\fb-reels`, HEAD `2084a1e`.
- Dự án đích: `F:\Son\tool\TediaPros`, nhánh `SonVersion`, HEAD `5cdc777`, Electron cài tại workspace `34.5.8`.
- Ưu tiên người dùng đã chọn: **quét đủ Reels từ profile/fanpage và lấy tiêu đề chính xác**.

## 1. Mục tiêu và cách hiểu “đủ”

Người dùng dán link profile/fanpage hoặc tab Reels, theo dõi tiến trình quét, xem danh sách có tiêu đề đúng Reel rồi chọn đưa vào hàng đợi Downloader hiện có.

“Đủ” là toàn bộ Reels mà phiên truy cập hiện tại có thể nhìn thấy trong danh sách nguồn đã xác định. Không được dùng số lượng vừa thu thập làm bằng chứng rằng đã lấy toàn bộ tài khoản. Khi hết thời gian, không tiến triển, bị giới hạn, gặp checkpoint hoặc người dùng dừng, trả phần đã lấy cùng lý do; chỉ đánh dấu hoàn tất khi có bằng chứng hết danh sách nguồn.

Facebook có thể dùng caption thay cho một tiêu đề riêng. Tiêu đề hiển thị phải xuất phát từ metadata đúng Reel hoặc dòng nội dung thực của caption đúng Reel. Nếu thiếu dữ liệu thì ghi rõ chưa có tiêu đề; không tự sinh nội dung để lấp chỗ trống.

## 2. Điều thực sự học được từ fb-reels

| Thành phần | Hành vi xác nhận trong code | Áp dụng vào TediaPros |
| --- | --- | --- |
| Chuẩn hóa link | `normalize_reels_url` chuyển `profile.php?id=...` sang `sk=reels_tab`, chuyển slug sang `/reels/`. [Nguồn](F:/Son/tool/fb-reels/src/utils/url_helper.py:29) | Hỗ trợ link profile/fanpage nguyên bản, có phân loại trước khi chuẩn hóa. |
| Quét danh sách | `crawl_reels_from_tab` vẫn lấy anchor `/reel/` từ DOM, cuộn và chống trùng. Nhánh newest tối đa 40 lượt; oldest tối đa 150 lượt. [Nguồn](F:/Son/tool/fb-reels/src/core/fb_crawler.py:354) | Học cách cộng dồn ID và báo tiến trình; không coi đây là giải pháp lấy danh sách hoàn toàn bằng GraphQL. |
| Metadata từng Reel | `extract_single_reel` thử yt-dlp, đăng ký listener response GraphQL, rồi dùng DOM bổ sung. Listener được tháo trong finally. [Nguồn](F:/Son/tool/fb-reels/src/core/fb_crawler.py:495) | Kết hợp nhiều nguồn metadata có đối chiếu ID và có dọn listener. |
| Parser GraphQL | Đọc JSON từng dòng, tìm `creation_story.message.text`, chọn caption dài nhất trên toàn payload. [Nguồn](F:/Son/tool/fb-reels/src/core/graphql_parser.py:29) | Học cách đọc dữ liệu có cấu trúc; phải thay logic lựa chọn bằng kết quả gắn theo Reel ID. |
| Tiến trình và dừng | Callback quét, callback từng item và stop-check trong vòng quét/vòng xử lý Reel. [Nguồn](F:/Son/tool/fb-reels/src/core/fb_crawler.py:870) | Quét có job ID, progress và cancel; giữ phần kết quả đã thu thập. |
| Giảm tải | Chặn media/font bằng route filter; dùng profile trình duyệt lưu phiên. [Nguồn](F:/Son/tool/fb-reels/src/core/fb_crawler.py:893) | Chặn tài nguyên nặng trong session riêng của crawler, kiểm tra ảnh hưởng trước khi bật mặc định. |

Phạm vi nghiên cứu ban đầu chỉ gồm discovery/caption. Sau yêu cầu bổ sung, đã triển khai link bình luận, tách bài viết website và Excel/TXT bằng các service TypeScript riêng, dùng downloader/cookie sẵn có của TediaPros. CapCut/Whisper vẫn ngoài phạm vi.

### Các hạn chế của dự án tham khảo cần tránh

- **TEST_CONFIRMED, offline:** payload giả lập chứa caption Reel A và caption dài hơn của Reel đề xuất B khiến parser trả caption B. Hàm không nhận target Reel ID.
- **TEST_CONFIRMED, offline:** thêm tiền tố `for (;;);` vào JSON giả lập khiến parser trả caption rỗng. Đây là ca độ bền parser, chưa phải bằng chứng về payload Facebook hiện tại.
- **CODE_CONFIRMED:** vẫn còn nhiều `time.sleep`, selector theo ngôn ngữ và fallback lấy đoạn DOM dài nhất. Tài liệu kế hoạch ghi xóa hardcode không phản ánh đầy đủ code hiện tại.
- **CODE_CONFIRMED:** “oldest” đảo ngược các link thu được theo thứ tự DOM, không dùng timestamp đăng. Không sao chép thành cam kết sắp xếp thời gian chính xác.
- README nêu mức tiết kiệm tài nguyên và tài liệu cũ ghi test live. Các con số/claim đó chưa được đo lại trong phiên nghiên cứu này.

## 3. Khoảng trống của TediaPros hiện tại

| Vấn đề | Bằng chứng hiện tại | Hệ quả với ưu tiên người dùng |
| --- | --- | --- |
| Chỉ nhận link tab Reels | Hàm nhận diện không khớp profile/fanpage nguyên bản. [Nguồn](F:/Son/tool/TediaPros/src/main/facebookReels.ts:14) | Dán link tài khoản chưa tự đi vào crawler Reels. |
| Điều kiện nhận diện hostname thiếu ranh giới domain | Dùng `endsWith('facebook.com')`, chưa kiểm tra protocol. [Nguồn](F:/Son/tool/TediaPros/src/main/facebookReels.ts:18) | Probe offline xác nhận `notfacebook.com/.../reels/` và URL FTP Facebook được nhận. Có thể dùng lại quy tắc chính xác trong `shared/sites.ts`. |
| Cookie/proxy dùng chung session | Không sử dụng cờ `useCookies`; luôn nạp cookie, dùng partition đăng nhập cố định; chỉ setProxy khi có proxy. [Nguồn](F:/Son/tool/TediaPros/src/main/facebookReels.ts:58) | Phiên guest không đúng lựa chọn; proxy tác vụ trước có thể ảnh hưởng tác vụ sau. Probe với Electron mock xác nhận đường gọi này. |
| Dừng theo số vòng/nhịp cố định | 40 lượt cuộn, ngưỡng 250 entry, 1.400 ms mỗi nhịp, 4 nhịp không mới thì dừng. [Nguồn](F:/Son/tool/TediaPros/src/main/facebookReels.ts:143) | Có thể bỏ sót danh sách dài hoặc tải chậm; không thể kết luận hết danh sách. |
| Ngưỡng entry không chặn từng lần thêm | Kiểm tra 250 sau khi thêm toàn bộ batch. [Nguồn](F:/Son/tool/TediaPros/src/main/facebookReels.ts:228) | Probe mock trả batch 260 và kết quả chứa 260; cần cap đúng theo chế độ người dùng chọn. |
| Tiêu đề chỉ là suy đoán từ card | Ưu tiên img alt/aria/card text, cắt còn 90 ký tự; ID đã thấy không được nâng cấp dữ liệu. [Nguồn](F:/Son/tool/TediaPros/src/main/facebookReels.ts:170) | Tiêu đề có thể là chữ giao diện, số lượt xem hoặc đoạn thiếu; nội dung bị cắt ngay ở tầng dữ liệu. |
| Kết quả thiếu độ đầy đủ | `PlaylistProbe` chỉ có isPlaylist/title/count/entries. [Nguồn](F:/Son/tool/TediaPros/src/shared/types.ts:95) | UI không biết hết danh sách hay quét một phần. |
| Tiêu đề từ playlist đi thẳng vào queue | Item được tạo với `info: null`, `status: ready`, title lấy từ entry. [Nguồn](F:/Son/tool/TediaPros/src/renderer/src/components/Downloader.tsx:520) | Không có bước làm rõ tiêu đề trước khi hiển thị/đưa vào hàng đợi. |
| Quét thiếu progress/cancel | IPC playlist không có job ID; overlay chỉ hiện spinner. [IPC](F:/Son/tool/TediaPros/src/main/index.ts:544), [UI](F:/Son/tool/TediaPros/src/renderer/src/components/Downloader.tsx:1416) | Người dùng không biết đã lấy bao nhiêu hoặc dừng để dùng phần kết quả đã có. |
| Test chưa bao phủ crawler | 3 test hiện tại chỉ gọi `isFacebookReelsTabUrl`. [Nguồn](F:/Son/tool/TediaPros/tests/facebook-reels-crawler.test.ts:1) | Pass test không chứng minh danh sách đầy đủ hay tiêu đề đúng. |

Các probe Electron nói trên dùng module nguồn thực với BrowserWindow/session/timer giả lập. Chúng xác nhận logic trong code, không chứng minh tác động trong một phiên Facebook thật.

## 4. Ba hướng cải tiến

| Hướng | Ưu điểm | Đánh đổi |
| --- | --- | --- |
| **A. Củng cố DOM hiện tại** | Ít thay đổi, nhanh cải thiện session, tiến trình và normalize link. | DOM vẫn thiếu metadata có định danh và bằng chứng hết danh sách. Phù hợp làm bước nền. |
| **B. Electron + dữ liệu mạng có định danh + DOM dự phòng — đề xuất** | Tận dụng Electron hiện có, lấy caption từ payload có cấu trúc, giữ hàng đợi tải và cookie manager hiện tại. | Cần parser riêng, fixture có scope nguồn/ID và kiểm tra Facebook thật. Schema nội bộ vẫn có thể thay đổi. |
| **C. Thêm Python/Playwright sidecar từ fb-reels** | Gần với triển khai tham khảo và có lựa chọn Edge/Chrome. | Thêm runtime, browser, quản lý profile, đóng gói và tiến trình; parser tham khảo vẫn cần sửa. Chỉ cân nhắc nếu B có giới hạn được chứng minh bằng test live. |

Đề xuất thực hiện B qua các bước nhỏ, bắt đầu bằng A. Không sao chép toàn bộ crawler Python vào Electron.

Electron 34 có `webContents.debugger`, sự kiện message và `sendCommand` để giao tiếp CDP. Đây là cơ sở cho adapter theo dõi network bằng Electron, đã đối chiếu với types cài trong workspace và [tài liệu Electron 34.5.8](https://github.com/electron/electron/blob/v34.5.8/docs/api/debugger.md). Khả năng lấy đúng schema danh sách Reels là phần phải xác nhận live, không suy ra chỉ từ API Electron.

## 5. Thiết kế được đề xuất

### 5.1. Nhận diện nguồn và cô lập phiên

1. Phân loại rõ single Reel, tab Reels, profile/fanpage, feed Reels tổng và URL không hỗ trợ. Feed tổng `/reels/` không được hiển thị như toàn bộ một tài khoản.
2. Chỉ chuẩn hóa các dạng profile/fanpage nhận diện được; không tự nối `/reels/` vào URL group, post, share, video hoặc hostname khác. Link share/short chỉ xác định sau redirect hợp lệ và kiểm tra host cuối.
3. Mỗi crawl có partition tạm riêng, job ID và proxy cấu hình trước loadURL. Tác vụ không proxy phải dùng direct rõ ràng. Không thay proxy của partition đăng nhập dùng chung.
4. `useCookies=false` dùng session sạch. `true` nạp snapshot cookie Facebook qua cookie manager dưới khóa hiện có; không lưu giá trị cookie trong checkpoint/log. Không thêm hệ multi-account ở đợt đầu.
5. Giữ sandbox/contextIsolation/nodeIntegration policy hiện có. Hủy/đóng job tháo listener, destroy cửa sổ và dọn session tạm.

### 5.2. Thu thập danh sách có scope và tiến độ

- Đăng ký network observer trước khi vào trang. Đánh dấu response GraphQL từ hostname/path cho phép, lấy body sau loadingFinished và đọc JSON/NDJSON cùng các envelope đã có fixture.
- Dữ liệu network chỉ được thêm vào danh sách khi chứng minh thuộc connection/tab profile/fanpage đích. Không thu mọi ID hoặc mọi `creation_story` trong payload; recommendation/comment có thể nằm chung response.
- DOM vẫn cộng dồn `/reel/<id>` trong vùng danh sách nguồn, chuẩn hóa URL và chống trùng bằng ID. Nếu scope không xác định được thì giữ trạng thái chưa xác minh, không tự nhận uploader là tên trang cho mọi Reel.
- Chờ theo điều kiện: ID mới, response nguồn đang tải, thay đổi cursor/connection hoặc tín hiệu lỗi. Có pacing và deadline an toàn; không dùng số nhịp không mới như bằng chứng duy nhất rằng đã hết.
- Giữ giới hạn tài nguyên cấu hình được. Chạm ngưỡng số lượng, thời gian hoặc không tiến triển thì trả partial cùng stop reason. Có hai lựa chọn: lấy N Reel, hoặc quét đến hết danh sách khả dụng với khả năng tiếp tục từng lượt.
- Progress thông báo phase và số ID đã lấy. Tổng chưa biết thì hiển thị “Đã tìm thấy 137 Reels”, không dựng phần trăm hoặc tổng số tài khoản.
- `has_next_page=false` chỉ có giá trị khi gắn đúng connection nguồn và các batch liên quan đã xử lý xong. DOM-only có thể trả danh sách hữu ích, nhưng không tự gắn nhãn complete chỉ vì trang đứng yên.

Không hardcode/replay GraphQL doc_id, token hoặc cursor để tạo một client API riêng. Observer đọc dữ liệu trang đã tải. Parser cho connection danh sách là phần mới của TediaPros; fb-reels hiện chưa cung cấp phần này.

### 5.3. Tiêu đề đúng ID, caption giữ nguyên

- Kết quả trung gian tối thiểu: Reel ID, URL chuẩn, title, caption đầy đủ nếu có, uploader đã xác minh, nguồn dữ liệu và trạng thái metadata.
- Ưu tiên metadata có ID khớp: trường title riêng nếu có, hoặc caption đúng Reel từ network; yt-dlp metadata là nguồn bổ sung có đối chiếu `info.id`. DOM card là dự phòng cuối, giữ nhãn nguồn rõ ràng.
- Không chọn caption vì dài nhất trên toàn response/toàn trang. Nếu nhiều bản cho cùng ID, ưu tiên bản đầy đủ cùng nguồn/ngôn ngữ gốc đã xác minh; trường hợp xung đột giữ trạng thái cần kiểm tra.
- Caption và title là hai trường riêng. Không cắt caption ở main process để vừa bảng UI; UI dùng ellipsis và cho xem nội dung đầy đủ.
- Giữ caption đã xác minh trong danh sách trước. Theo sửa lỗi caption ngày 2026-10-02, app tự bổ sung riêng các Reel còn thiếu theo luồng serial có tiến trình/hủy và chia nhóm tối đa 1.000 ID, không gọi lại metadata của Reel đã có caption verified. Khi dừng, người dùng có thể lấy tiếp các mục thiếu đang chọn.
- Metadata lỗi ở một Reel không làm mất các ID còn lại. Placeholder dạng `Facebook Reel <id>` phải được đánh dấu chưa có tiêu đề và có thể thử lấy lại cho item đó.
- Cache theo ID, nguồn/tài khoản, ngữ cảnh phiên và phiên bản parser; tránh dùng kết quả phiên guest cho phiên đăng nhập như thể tương đương.

### 5.4. Hợp đồng IPC, UI và tiếp tục quét

- Thêm kiểu request/result/progress dành cho Facebook Reels trong shared; thêm API preload có kiểu cho crawl(jobId, request), cancel(jobId), progress và bổ sung metadata.
- Giữ getPlaylist hiện có cho các website khác và wrapper tương thích Facebook. `PlaylistProbe` có thể thêm summary tùy chọn: completion, stopReason, discoveredCount, warnings; không đổi nghĩa count thành tổng Reel của tài khoản.
- Trạng thái kết quả phân biệt complete, partial và cancelled. Login-required/checkpoint/rate-limit là mã nguyên nhân rõ ràng; không nuốt lỗi thành “hết danh sách”.
- UI quét hiển thị số Reel, cho dừng và sử dụng phần đã có; bảng có trạng thái tiêu đề và nút lấy lại metadata thiếu. Listener theo job ID và được cleanup khi unmount.
- Lưu checkpoint tối thiểu theo job/source: các ID đã thấy, metadata chuẩn hóa và cấu hình không chứa bí mật, bằng thao tác atomic dưới `safeContainedPath`.
- Tiếp tục mặc định mở lại nguồn và deduplicate với checkpoint. Cursor quan sát chỉ là hint trong phiên; không cam kết tiếp tục trực tiếp bằng cursor đã lưu và không lưu token/request body.

## 6. Trình tự triển khai và điều kiện nghiệm thu

| Đợt | Phạm vi chính | Điều kiện qua đợt |
| --- | --- | --- |
| **1. Sửa nền crawler** | Normalize/classify, host/protocol, session riêng, cookie/proxy đúng lựa chọn, giới hạn đúng, partial reason và cancel/progress. | Link profile/fanpage hợp lệ đi đúng luồng; guest không gọi nạp cookie; proxy không rò sang job khác; mọi điểm dừng được phân loại đúng. |
| **2. Metadata đúng Reel** | Observer Electron, parser thuần theo ID, merge có nguồn, caption riêng, yt-dlp bổ sung có xác minh ID. | Payload nhiều Reel không lấy nhầm caption; payload lỗi/prefix/chunk có fixture xử lý đúng; metadata thiếu không làm mất danh sách. |
| **3. Độ đầy đủ và UI** | Parser connection danh sách, đợi theo tiến triển, bằng chứng end-of-list, bảng tiến độ/tiêu đề, checkpoint/continue. | Danh sách >250 không bị báo đủ khi cắt; hủy giữ IDs; tiếp tục chống trùng; complete chỉ xuất hiện khi có bằng chứng nguồn. |
| **4. Xác nhận Facebook thật** | Profile ID, fanpage slug, nguồn dài, nguồn tải chậm và phiên guest/đăng nhập. | So sánh tập ID và caption với cùng nguồn/cùng phiên tại cùng thời điểm; báo rõ phần chưa thể xác minh. |

Đợt 1 và 2 tạo giá trị trước. Đợt 3 cần fixture network thật đã loại bí mật; nếu schema danh sách chưa xác định được thì giao bản DOM cải tiến với nhãn partial/unverified, không đặt mục tiêu nghiệm thu “đã lấy đủ” chỉ dựa vào tăng số vòng cuộn.

### Bản đồ tệp dự kiến khi triển khai

- `src/main/facebookReels.ts`: điều phối crawl, session/window lifecycle, kết quả hoàn tất/một phần.
- Module main riêng dự kiến: network observer, parser GraphQL thuần và metadata resolver; tách theo trách nhiệm, không nhập mã renderer.
- `src/shared/sites.ts` và helper URL/contract Facebook Reels: normalize/classify và kiểu thuần, không import Node/Electron.
- `src/main/ytdlp.ts`: trả description tùy chọn, đối chiếu metadata ID và nối resolver hiện có; giữ chính sách cookie/impersonation theo site.
- `src/main/cookies.ts`: snapshot được kiểm soát, chỉ thay đổi khi API hiện có chưa đủ; không tạo kho cookie thứ hai.
- `src/shared/types.ts`, `src/preload/index.ts`, `src/main/index.ts`: IPC typed, tương thích ngược và cancel theo đúng sender/job.
- `src/renderer/src/components/Downloader.tsx`: phân nhánh quét Facebook, tiến trình, partial summary và cập nhật title của item theo ID.
- `tests/facebook-reels-crawler.test.ts` cùng test parser/contract/lifecycle; đăng ký các suite mới trong runner.
- `docs/architecture.md`, `docs/domain.md`, ADR nếu thay đổi ranh giới crawler/session, và bản ghi task theo mẫu repo.

### Bộ kiểm tra cần có

1. URL profile ID/slug/tab/single Reel và các URL giả mạo host, protocol sai, group/post/share.
2. Batch trùng, ID mới qua nhiều lượt, DOM virtualization, danh sách >250, giới hạn N chặn đúng từng lần thêm.
3. Đang loading nhưng chưa có ID mới; response lỗi; mất debugger; DOM đứng yên; end-of-list đúng/sai scope.
4. Payload nhiều Reel, recommendation, caption rỗng/dài, Unicode, ngôn ngữ, JSON/NDJSON/prefix/base64 và chunk định danh theo fixture.
5. Hai job khác proxy/cookie, lỗi giữa chừng, hủy lúc loadURL/lấy body/chờ metadata; không còn cửa sổ/listener/tiến trình con thuộc job.
6. IPC không nhận progress/cancel của job thuộc sender khác; checkpoint sai path không được đọc/ghi; resume không tạo ID trùng.
7. Metadata yt-dlp trả ID khác phải bị từ chối; title từ danh sách được nâng cấp đúng queue item và caption vẫn nguyên vẹn.

Kiểm tra live cần có ma trận nguồn thực và tập ID đối chứng. Với nguồn nhỏ, đối chiếu toàn bộ ID/tiêu đề. Với nguồn dài, đối chiếu các trang đầu/giữa/cuối, coverage và bằng chứng hết connection; nếu không có tập đối chứng đầy đủ thì ghi coverage chưa xác minh, không suy ra 100%.

## 7. Kiểm chứng đã thực hiện trong phiên nghiên cứu

- `npm.cmd run typecheck` tại TediaPros: **PASS**, cả Node và Web, exit code 0.
- `node scripts/run-local-runtime-tests.mjs facebook-reels-crawler.test`: **PASS 3/3**. Giới hạn: chỉ test nhận diện URL.
- `python -B -m pytest -p no:cacheprovider -q tests/test_graphql_parser.py tests/test_url_helper.py` tại fb-reels: **PASS 16/16**. Đây là test offline.
- Probe nguồn TediaPros với Electron mock: xác nhận host/protocol nhận sai, profile chưa normalize, flag cookie không được dùng, proxy dùng chung không reset và batch vượt ngưỡng entry.
- Probe parser nguồn fb-reels: xác nhận chọn nhầm caption khi payload chứa nhiều Reel và chưa xử lý tiền tố JSON giả lập.
- Không chạy toàn bộ crawler Python: môi trường hiện tại thiếu trafilatura/pandas/bs4; không cài thêm dependencies cho nhiệm vụ nghiên cứu.
- Chưa đăng nhập, crawl hoặc tải Facebook thật trong phiên này. Chưa benchmark thời gian/RAM/băng thông. Không thay đổi mã nguồn sản phẩm hay cấu hình tài khoản.

Phương án này đã đủ để chọn phạm vi triển khai tiếp theo. Cam kết về schema Facebook hiện tại và độ đầy đủ phải được kiểm chứng ở đợt live sau khi có nguồn đối chứng.
