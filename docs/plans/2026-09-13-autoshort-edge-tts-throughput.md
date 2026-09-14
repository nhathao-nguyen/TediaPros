# Kế hoạch cải thiện tốc độ và độ bền Edge TTS trong AutoShort

> **Trạng thái triển khai 2026-09-14:** M0-M3 đã có phần lõi trong code: failure classification, telemetry attempt, scheduler toàn Main, retry/circuit/cooldown lưu bền, preparation queue 2 worker/lookahead 4, preset UI 1/2, progress chờ dịch vụ và resume không đổi content digest. Offline corpus 500 unit đã pass. M4 live: 50 concurrency 1 đạt 50/50 nhưng cần 11 retry; 100 concurrency 2 dừng ở 97 sample với một lỗi `transient_network` sau ba attempt. Gate không đạt nên không chạy 500 hoặc hai video DALAM; preset 1 vẫn là mặc định. Xem `.ai/tasks/2026-09-14-edge-tts-throughput/verification.md`.

Ngày: 2026-09-13. Baseline: `main@0c743aa`.
Trạng thái: **PROPOSED — mới lập kế hoạch, chưa triển khai hoặc nghiệm thu tải lớn.**

## 1. Mục tiêu và giới hạn bằng chứng

Xử lý một video có 400–500 đơn vị tổng hợp bằng hàng đợi hữu hạn, phục hồi khi mất mạng và tiếp tục từ cache. Tăng tốc phần tổng hợp độc lập, giữ chất lượng lời đọc và thứ tự timeline. Không gửi 500 request cùng lúc.

- CODE_CONFIRMED: mặc định một video hoạt động, `prefetchTts=false`; nhánh visual đã có overlap với nhánh âm thanh. Xem `src/main/autoShortExecutionPolicy.ts`, `src/main/autoShortItemCoordinator.ts`.
- CODE_CONFIRMED: cache v2 đã có single-flight và atomic publication; trim PCM có artifact cache. Tái sử dụng các cơ chế này, không tạo cache song song thứ hai.
- CODE_CONFIRMED: Edge mở client/socket riêng mỗi cache miss; decode và probe trước publish. Trim có lease `local-audio-dsp`, nhưng decode/probe trong `edgeTts.ts` chưa dùng lease này.
- CODE_CONFIRMED: vòng measured pass ở `dubbing/synthesis.ts` có phụ thuộc câu trước. Bật prefetch hiện có không tương đương worker pool TTS.
- CODE_CONFIRMED: adapter hiện trả lỗi transport, chưa có scheduler Edge toàn app, typed retry và circuit breaker. Preflight live thất bại có thể dừng cả batch trước item đầu.
- HISTORICAL_LIVE_PROBE: 8/8 câu thử ngắn thành công, gồm 6 tuần tự và 2 đồng thời; median transport 1.304 giây. Probe này không đo decode/trim/render và không chứng minh 500 request ổn định. Bằng chứng: `.ai/tasks/2026-09-13-autoshort-edge-tts-flow-audit/probe.json`.
- UNKNOWN: thông lượng Edge bền vững theo voice, mạng, thời điểm; tỷ lệ lỗi ở 500 request; mức cải thiện end-to-end. Không lấy quota Azure làm quota Edge.

Số cue nguồn, speech unit, cache miss và network attempt là bốn đại lượng riêng. Rephrase/rescue có thể làm tổng attempt vượt 500 dù chỉ có 500 unit; thống kê phải phản ánh đúng.

## 2. Các quyết định đề xuất

1. Dùng async worker pool trong Electron Main cho I/O; chưa cần Node worker thread chỉ để chờ mạng.
2. Scheduler Edge dùng chung trong một Main process, áp dụng AutoShort, Voice preview và preflight. Không tuyên bố giới hạn toàn máy/IP nếu nhiều instance/profile hoặc ứng dụng khác cùng gọi Edge.
3. Cache lookup/single-flight nằm trước admission mạng. Chỉ producer của cache miss lấy slot, tránh waiter giữ slot rồi chờ chính producer.
4. Tách giới hạn request đồng thời, nhịp bắt đầu request và số tiến trình audio. Không tăng số video/GPU job để tăng tốc một video.
5. Chuẩn bị natural audio song song, commit kết quả đo/predictor/overflow và final timeline theo thứ tự cue. Rephrase chỉ bắt đầu sau measured pass hợp lệ; rescue ban đầu giữ tuần tự.
6. Transport retry khác quality retry/rescue. Mỗi attempt có ID và lý do; không lồng retry ở nhiều tầng hoặc gọi lại cả video cho một lỗi socket.
7. Giữ source cue ID/timestamp, semantic grouping hiện tại, provider/voice đã chọn, tốc độ tổng hợp AutoShort 1.0x, tempo tối đa 1.80x và protected gap 0.50s. Không nới chính sách kéo dài hình; ADR 005 đã có phần thay thế 60% mỗi đoạn, không phục hồi nhầm ngưỡng lịch sử 40%.
8. Không khôi phục tổng ngân sách dịch đang tạm tắt. Retry hữu hạn dưới đây chỉ áp dụng lỗi vận chuyển Edge, độc lập với chính sách translation/rephrase.

## 3. Cấu hình khởi điểm cho thử nghiệm

Các số sau là tham số đề xuất để đo, không phải quota Microsoft hay bảo đảm không bị throttle.

| Tham số | Baseline/rollout | Thử nghiệm đầu |
|---|---|---|
| Video hoạt động | 1 | 1 |
| Edge request đang truyền | 1 | 2 |
| Khoảng cách tối thiểu giữa các lần bắt đầu | 1.000 ms | 1.000 ms, burst capacity 1 |
| Cửa sổ unit chuẩn bị ahead | 2 | 4, tối đa `2 × concurrency` |
| Audio DSP đồng thời | 1 | 1; thử 2 riêng sau khi đo |
| Attempt mạng cho một logical request | 1 | tối đa 3, gồm lần đầu + 2 retry |
| Deadline một attempt hoạt động | 60 giây hiện có | 60 giây, gồm network/decode/probe/publish |
| Audio nhận cho một attempt | 16 MiB hiện có | 16 MiB |

Chờ queue/cooldown phải có progress và hủy được, không bị tính nhầm thành network timeout. Deadline attempt bắt đầu sau admission. Sau khi socket đã đóng, có thể trả slot mạng trước decode; cửa sổ chuẩn bị hữu hạn và reservation đĩa ngăn tích tụ MP3/WAV.

Mọi attempt retry và synthesis preflight dùng cùng rate gate. Catalog HTTP dùng cùng cooldown/breaker và admission để tránh burst, có metric riêng. Sau idle không tích lũy token cho một burst lớn.

## 4. Lộ trình triển khai

### M0 — Đo baseline và chuẩn hóa lỗi

- Bổ sung typed failure gồm `cancelled`, `rate_limited`, `access_denied`, `timeout`, `transient_network`, `provider_5xx`, `invalid_input`, `audio_validation`, `local_media`, `disk`.
- Thu HTTP status và Retry-After nếu transport/library thực sự cung cấp; socket không có status thì để unknown, không suy từ mọi timeout thành throttle. Kiểm tra adapter library có expose handshake headers trước khi thiết kế recovery.
- Telemetry tách queue wait, rate wait, network/first-byte, decode, probe, trim, cache copy, retry wait, timeline fit; thêm job/item/cue/request ID, attempt index và request reason (initial/rescue/probe).
- Đo riêng unique unit, cache hit/miss, transport attempts, ký tự, audio seconds, throughput, p50/p95, concurrency đỉnh, CPU/RAM và scratch bytes. Thành công phải nghĩa là audio đã validate, không chỉ nhận bytes.
- Không log endpoint query token, API key hoặc toàn bộ lời thoại vào metric. Cập nhật sanitizer/aggregator cùng shared type để trường mới không bị mất.
- Baseline đo concurrency 1 trên corpus cố định, tách cold cache/warm cache và transport-only/full-audio/full-video.

Tệp trọng tâm: `edgeTtsTransport.ts`, `edgeTts.ts`, `src/shared/types.ts`, `autoShortTelemetry.ts`, `autoshort.ts`. Gate: phân loại đúng lỗi giả lập, telemetry còn đủ trên cả success/error/cancel; typecheck và test liên quan pass.

### M1 — Scheduler toàn app và phục hồi transport

- Tạo `src/main/edgeTtsScheduler.ts` và `edgeTtsRecovery.ts`; Main sở hữu policy, renderer chỉ chọn preset hợp lệ. Mọi đường Edge phải đi qua scheduler, kể cả preflight trực tiếp gọi transport.
- Queue công bằng giữa caller, không ưu tiên Voice vô hạn làm AutoShort đói slot. Không dùng FIFO chung của GPU/server-inference để chờ cooldown Edge, vì một request chưa sẵn sàng có thể chặn tài nguyên không liên quan.
- Mỗi waiter hủy độc lập; producer cache chỉ hủy khi hết waiter. Chỉ trả slot khi socket/process đã quiesce, không trả sớm chỉ vì nhận AbortSignal.
- Backoff giả lập khởi điểm 2 và 4 giây cộng jitter. Với 429, cooldown dùng thời gian lớn hơn giữa backoff và Retry-After hợp lệ; không retry sớm hơn provider yêu cầu. Delay dài phải hiện rõ trên UI và hủy được.
- Retry chỉ timeout mạng, lỗi kết nối tạm thời và 5xx phù hợp. Cancel, invalid input, lỗi quyền, thiếu FFmpeg, disk và validation không dùng transport retry. Lỗi chất lượng audio tiếp tục qua recovery hiện có.
- Khi 429: dừng dispatch trong cooldown, hạ concurrency về 1. Khi 403: khóa dispatch Edge, giữ trạng thái có thể tiếp tục sau khi người dùng xử lý; không tự retry hàng loạt, đổi IP/token hoặc lách chặn.
- Khi 3 attempt transport liên tiếp thất bại toàn scheduler: mở circuit, cooldown khởi điểm 30 giây; chỉ một half-open probe. Tối đa 2 probe thất bại cho đợt lỗi rồi kết thúc ở trạng thái chờ người dùng tiếp tục, không ngủ/retry vô hạn.
- 403 không half-open tự động. Tôn trọng cooldown 429 lâu hơn thời gian breaker; lưu `nextEligibleAt` và lý do để restart không vô tình xóa thời gian chờ. Restart vẫn theo quy trình resume có thao tác người dùng.
- Breaker áp dụng Edge toàn batch/caller, tránh mỗi video tiêu hết timeout rồi chuyển sang video kế tiếp gặp cùng outage. Ghi trạng thái interrupted/recoverable theo journal hiện có, kiểm tra transition hợp lệ; thêm type/migration nếu cần.

Gate: dùng fake clock test 429, Retry-After delta/date, 403, 5xx, cancel trong queue/backoff, fair scheduling và không rò slot. M1 chạy concurrency 1 trước; chưa tăng số request song song.

### M2 — Chuẩn bị audio song song, timeline theo thứ tự

- Tạo `src/main/dubbing/preparationQueue.ts`, worker pool áp dụng Edge; Local/clone giữ đường chạy cũ.
- Refactor natural preparation để chỉ sinh/validate/trim/đo audio và trả immutable result. Không mutate predictor, cue, overflow queue hoặc source ledger từ callback hoàn thành ngoài thứ tự.
- Bắt đầu với 2 worker và lookahead 4 unit. Scheduler mạng vẫn là giới hạn cuối cùng trên toàn app; 2 worker không có nghĩa mỗi video được thêm 2 socket riêng ngoài global cap.
- Vòng consume chờ cue kế tiếp theo source order; cập nhật predictor, classify overflow, reflow/finalization theo thứ tự như baseline. Kết quả out-of-order chỉ lưu path/metadata, không giữ toàn bộ buffer cho 500 cue.
- Structural split/rephrase thay plan hoặc text: tăng generation, hủy/thu hồi task cũ, chỉ reuse audio khi text/voice/identity đúng. Kết quả cũ đến muộn không được ghi vào plan mới. Cache hợp lệ với key cũ vẫn có thể giữ theo retention hiện có.
- Lỗi một cue: lưu audio các cue đã commit, drain/cancel phần đang hoạt động trước đóng scope; báo chính xác cue lỗi. Khôi phục chỉ synthesize cache miss, không mặc nhiên bỏ cache toàn item.
- Không chạy đồng thời legacy `prefetchTts` và preparation queue. Chọn một cơ chế duy nhất theo execution policy.
- Bao decode/probe Edge bằng lease audio hiện có để không vượt tải cùng trim/applyTempo. Không lấy cùng lease hai lần lồng nhau. Đưa các file tạm Edge vào disk reservation/scope; giữ nguyên full-decode validation.

Gate: fixture audio cố định cho output plan/timeline tương đương concurrency 1; out-of-order, split, cancel và cache waiter không làm mất/lặp cue; cap socket/process đúng. Chỉ mở preset 2 sau gate M1/M2 và thử nghiệm M4.

### M3 — Resume và giao diện vận hành

- UI AutoShort hiển thị số câu đã có audio, đang xử lý, đang chờ; lý do chờ dịch vụ và thời điểm thử lại. Tách trạng thái measured/rephrase/rescue/finalize để không hiển thị hoàn thành sớm.
- Preset đề xuất: `Ổn định (1)` và `Thử nghiệm (2)`. Main clamp giá trị, config cũ mặc định 1. Preset 4 chưa mở cho người dùng trước benchmark.
- Tiếp tục batch theo journal và digest input/config đã validate. Thay concurrency chỉ ảnh hưởng lịch chạy; đánh giá schema/digest để không làm invalid cache nội dung hoặc đổi timeline semantics. Nếu migration chưa chứng minh, giữ đường resume cũ an toàn.
- Phân biệt cache audio durable với scratch; chỉ dọn scratch scope. Không tự chạy lại item terminal, không ghi đè video đã render thành công.
- Tránh phát minh journal từng cue thứ hai nếu cache/manifest hiện có đủ để reconstruct. Ghi thêm ledger tối thiểu nếu cần và kiểm tra crash giữa write/commit/event.

Tệp: `autoShortExecutionPolicy.ts`, `src/shared/autoShortContract.ts`, shared types, preload, AutoShort UI, `autoShortItemCoordinator.ts`, queue/journal và `dubbing/cache.ts`.

Gate: cấu hình cũ đọc được; preview Voice cùng AutoShort không vượt global cap; Cancel nhanh, Resume chỉ gọi phần thiếu; progress không lùi hoặc bị đếm hai lần do retry.

### M4 — Nghiệm thu 50 → 100 → 500 request và chọn mặc định

1. Offline: 500 unit duy nhất, mock kết quả khác thứ tự; inject lỗi tại đầu/giữa/cuối, 429 liên tiếp, timeout, 403, audio hỏng, đầy đĩa, crash và cancel. Dùng fake time thay chờ thật hàng phút.
2. Live tổng hợp: 50 rồi 100 request qua full adapter (decode/probe), dùng nội dung thử có độ dài đa dạng. Nếu gặp 403/429 thì dừng tăng tải, giữ bằng chứng và cooldown; không tiếp tục thử cao hơn để tìm ngưỡng chặn.
3. Live 500: chỉ sau hai mốc trên; so sánh concurrency 1 và 2 trên cùng corpus/voice/mạng và cùng rate gate. Tách cold/warm cache, không ghi đè cache người dùng để giả cold run. Luân phiên thứ tự chạy để giảm nhiễu thời điểm.
4. Chạy ít nhất 3 lượt 500 nếu dịch vụ ổn định, báo raw failure lẫn recovered failure. 500 network requests trên script tổng hợp không thay thế kiểm tra video thật.
5. AutoShort video thật: bắt buộc chạy hai video người dùng chỉ định ở mục 4.1 bên dưới; mở rộng corpus cho speech unit dài/ngắn, overflow/rescue, nhiều ngôn ngữ. Đo tổng TTS và end-to-end gồm OCR/STTN/render. Nghe mẫu đầu/giữa/cuối và mọi cue phục hồi, kiểm tra đủ nghĩa, đồng bộ và không lặp lời.
6. Sau đó mới thử concurrency 3–4, thay một biến mỗi lần. Nhịp bắt đầu request cũng cần benchmark riêng; nếu rate gate là bottleneck, thêm worker sẽ không giúp.

Ngưỡng nghiệm thu đề xuất:

- 0 cue bị mất/lặp/sai ID trên fixture; source ledger giữ nguyên; tempo đo không vượt 1.80x và khoảng nghỉ đúng policy.
- Không vượt concurrency, lookahead và media cap; không có process/socket còn hoạt động sau cleanup. Mục tiêu Cancel p95 dưới 3 giây trên máy test, đo cả lúc backoff và FFmpeg chạy.
- 500/500 audio hợp lệ sau recovery trên từng lượt live đạt chuẩn; công bố cả retry ratio, không che lỗi bằng tỷ lệ cuối.
- Mục tiêu mở preset 2: median thời gian full TTS giảm ít nhất 25% so với baseline tương đương, không phát sinh 403/429 và retry ratio không quá 1% trên ba lượt nghiệm thu. Đây là gate đề xuất, không phải dự báo kết quả.
- Warm-cache rerun không gọi lại synthesis cho key hợp lệ, ngoài probe kết nối nếu preflight hiện hành yêu cầu. Có thể chạy lại probe/trim để validation; không hứa zero CPU.
- Không tăng bộ nhớ vô hạn theo số audio buffer; ghi peak RAM/process count/scratch bytes, reservation không vượt dung lượng cho phép. Không có scratch còn sót sau success/cancel.
- Video thật phải pass quality gate; output hash giữa hai lượt live có thể khác vì provider không bảo đảm deterministic. So sánh hash/plan chính xác chỉ trên fixture cố định; live đối chiếu coverage, timing và nghe nội dung.

Nếu không đạt tốc độ mục tiêu nhưng đúng đắn/recovery pass: giữ cải thiện độ bền và preset 1, báo bottleneck đo được. Không tự tăng tải để đạt KPI. Chưa có kết quả nào bảo đảm Edge luôn ổn định ở tương lai.

### 4.1. Bộ video thực tế do người dùng chỉ định: LauHaiSan/dalam

**LOCAL_METADATA_CONFIRMED — 2026-09-13:** đã liệt kê thư mục `F:\Son\doyuin\LauHaiSan\dalam`, đọc metadata bằng managed FFprobe và tính SHA-256. Có hai file MP4 trực tiếp trong thư mục, không có file phụ đề kèm theo ở cấp này. Chưa chạy ASR, dịch, TTS hoặc render cho đợt thử nghiệm này; metadata không phải bằng chứng full-decode hoặc chất lượng nghe/nhìn.

| Case | File nguồn đầy đủ | Duration | Video | Audio | Bytes |
|---|---|---|---|---|---|
| DALAM-01 | `F:\Son\doyuin\LauHaiSan\dalam\2025-04-08_大海退潮啦，海鲜就要现抓现吃_赶海_7490882160954461476.mp4` | 131.007007 s | H.264, 1080×1920, 30/1 fps | AAC, 44.1 kHz, stereo | 63,744,593 |
| DALAM-02 | `F:\Son\doyuin\LauHaiSan\dalam\2025-04-18_真正的海底捞自助，就要现抓现吃_赶海_7494584044865260852.mp4` | 169.110998 s | H.264, 1080×1920, 30/1 fps | AAC, 44.1 kHz, stereo | 95,645,656 |

SHA-256 nguồn:

- DALAM-01: `50140CA1D518F4DBE80D564BBABCE727790F066E619D31AA3D45CBCD4042E1EE`
- DALAM-02: `5CD216B7145AC65CD49AA1D8B2F3A758184CA4B7B2E2F5F166FA6DDA77A57BD9`

#### Chuẩn bị và kiểm soát biến thử nghiệm

- Kiểm tra hash nguồn trước chạy; không sửa/di chuyển file gốc. Mỗi lượt ghi output vào thư mục riêng do app reserve dưới thư mục benchmark riêng, bên ngoài `dalam`; không lấy 8 MP4 encoder benchmark cũ trong repo làm input hoặc ghi đè chúng.
- Xuất config snapshot hiện tại trước chạy: provider/voice, target language, dịch/model, OCR/STTN/ROI, audio mode, subtitle, encoder, phiên bản app/runtime và hardware. Không suy ngôn ngữ thoại từ tên file; nhận diện bằng ASR.
- Nhánh thử đầu đề xuất target `vi`, voice `vi-VN-HoaiMyNeural` để cùng voice với probe trước; đây là cấu hình đề xuất, chưa phải cấu hình UI đã xác minh. Giữ cùng target/voice và mọi tùy chọn nội dung giữa lượt A/B.
- ASR và dịch tạo checkpoint đã validate dùng chung cho phép đo TTS A/B; lưu hash checkpoint, số source cue, speech unit, ký tự và khoảng thời lượng. Tách riêng phép đo full-pipeline cold run, không ghi thời gian reuse ASR/dịch thành cold end-to-end.
- Chạy A/B với một video hoạt động, concurrency 1/2, cùng rate gate, cùng audio DSP cap. Mỗi lượt cold-TTS có cache namespace riêng; warm-TTS dùng đúng namespace của lượt tương ứng. Không xóa cache sinh hoạt của người dùng để tạo cold run.

#### Ma trận bắt buộc cho cả DALAM-01 và DALAM-02

| Lượt | Cách chạy | Mục đích/gate |
|---|---|---|
| A | Concurrency 1, cold TTS | Baseline full synthesis/decode/trim/fit/render |
| B | Concurrency 2, cold TTS | So sánh cùng checkpoint nội dung; đo TTS và end-to-end riêng |
| C | Warm TTS của B | Không gọi synthesis cho key hợp lệ; probe preflight thống kê riêng |
| D | Hủy khi đã commit một phần cue, rồi Resume | Tái dùng audio đã commit; không mất/lặp lời hoặc ghi đè output |
| E | Lỗi mạng giả lập tại adapter của test harness, rồi phục hồi | Backoff/circuit/progress đúng; không ngắt mạng hệ điều hành hoặc cố tạo throttle thật |

Lượt D/E chạy trong profile/harness thử nghiệm riêng và sau gate offline M1/M2. Ghi rõ lỗi được inject, không báo thành lỗi Microsoft thật. Nếu corpus không có overflow tự nhiên, coverage rescue dùng fixture riêng, không cố sửa bản dịch để gây lỗi cho video.

Sau các gate 50/100 của M4, chạy A/B luân phiên tối thiểu ba cặp mỗi video nếu dịch vụ ổn định; dừng tăng tải khi 403/429. Báo median full-TTS, p95 request latency, tổng attempts/retries, cache hit, thời gian từng stage, peak RAM/CPU/GPU/scratch, cancel/resume và kết quả kiểm tra audio/timeline. Hai video không mặc nhiên đủ coverage đa ngôn ngữ.

#### Phân biệt video thật với phép thử 500 request

Số cue/speech unit hiện là **UNKNOWN**, chỉ chốt sau ASR/grouping. Không chia vụn câu hoặc lặp video để gắn nhãn sai “500 request cho một video”. Nếu hai video tạo ít hơn 400–500 request, vẫn nghiệm thu end-to-end theo số thực tế và giữ corpus 500 request riêng tại M4. Retry, preflight và nhiều lượt A/B không được cộng thành 500 request độc lập của một lượt video.

#### Artifact cần lưu khi triển khai

Trong `.ai/tasks/<ngay-chay>-edge-tts-dalam-acceptance/`: manifest nguồn/hash, config snapshot đã bỏ secret, checkpoint identity, run matrix, metrics theo lượt, lỗi/recovery, bảng so sánh A/B và acceptance report. Media/output lớn lưu ở thư mục benchmark riêng đã resolve/kiểm tra containment; báo đường dẫn trong manifest, không tự đưa media vào Git. RAW provider text/translation nếu cần chẩn đoán chỉ giữ trong artifact cục bộ theo cơ chế hiện tại, không đưa vào telemetry chung.

Tiêu chí chất lượng: đủ coverage cue/ý nghĩa, không lặp narration, không cắt âm đầu/cuối, không vượt trần tempo, phụ đề/giọng/hình khớp timeline đã retime; nghe đầu/giữa/cuối và mọi cue rescue. Chỉ đánh dấu PASS khi có output media thật và biên bản kiểm tra, không dựa vào log hoàn thành riêng lẻ.

## 5. Kiểm thử và bàn giao khi triển khai

Các suite mới đề xuất: `edge-tts-scheduler.test`, `edge-tts-recovery.test`, `dubbing-preparation-queue.test`; đăng ký runner nếu runner dùng allowlist.

Các suite hiện có cần chạy theo module thực sự thay đổi:

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime -- edge-tts-contract.test edge-tts-adapter.test autoshort-edge-tts.test autoshort-tts-cache.test autoshort-tts-pipeline.test dubbing-plan.test autoshort-item-scope.test autoshort-resource-manager.test autoshort-queue-throughput.test autoshort-telemetry.test
```

Bổ sung regression journal/resume/IPC tương ứng với thay đổi thực tế. Test Local/clone xác nhận đường cũ không bị tăng concurrency. Khi đóng gói: build/package checks theo AGENTS; Windows live riêng, macOS không được coi đã qualified từ Windows.

Mỗi giai đoạn có commit và handoff riêng. ADR mới chỉ chốt khi triển khai quyết định kiến trúc; cập nhật `docs/edge-tts.md`, execution config và tài liệu tiến độ cùng lúc. Rollback bằng preset 1/feature flag, giữ cache identity nếu format không đổi; nếu format đổi cần version/migration, không xóa cache cũ hàng loạt.

## 6. Những tối ưu để sau khi có số đo

- Giảm subprocess decode/probe/trim dư thừa chỉ nếu profiling cho thấy đáng kể và có fixture chứng minh full-decode/trim/duration tương đương. Không bỏ validation để đạt tốc độ.
- Reuse WebSocket/client chỉ sau khi kiểm tra lifecycle/correlation của thư viện; không chia sẻ stream của một client giữa các request đồng thời.
- Gom speech unit chỉ khi audit chứng minh grouping đang sai/fragmented. Không ghép 500 cue thành một audio rồi chia theo tỷ lệ ký tự, vì phá alignment và ranh giới nguồn.
- Preflight: phục hồi transient failure ở M1; chưa bỏ catalog live/probe. Tái dùng readiness ngắn hạn là tối ưu độc lập cần test voice invalidation và offline resume.
- Azure/local provider mở rộng là công việc riêng; không tự đổi provider/voice giữa video khi Edge lỗi.

Thứ tự đề xuất: **M0 → M1 → M2 → M3 → M4**. Ưu tiên đầu tiên là telemetry + scheduler + recovery ở concurrency 1, sau đó mới đánh giá lợi ích concurrency 2.
