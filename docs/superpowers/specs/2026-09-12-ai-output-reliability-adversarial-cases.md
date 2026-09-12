# AI Output Reliability — 60 tình huống kiểm chứng

Revision 2, 2026-09-12. Client implementation đã hoàn tất và được kiểm chứng bằng full local-runtime suite; xem [implementation handoff](../../../.ai/tasks/2026-09-12-ai-output-reliability/implementation.md). C01–C60 vẫn là catalog qualification: các row có regression trực tiếp được ghi nhận ở handoff, còn live provider, gateway, crash/power-loss và platform matrix giữ trạng thái UNKNOWN cho đến khi có bằng chứng đúng môi trường. Không suy diễn một suite mock pass thành xác nhận toàn bộ 60 row.

[Spec](2026-09-12-ai-output-reliability-design.md) · [Plan](../plans/2026-09-12-ai-output-reliability.md) · [Review findings](../../../.ai/tasks/2026-09-12-ai-output-reliability-review/review.md).

Mỗi row là một scenario có thể triển khai nhiều fixtures. Severity cho biết hậu quả nếu implementation không giữ expected outcome; không phải phát hiện production bug. P1 là nguy cơ dữ liệu sai, request không dừng hoặc mất file; P2 là compatibility/diagnostics/quality cần giải quyết trước rollout profile liên quan.

Implementation phải bổ sung test file/title, seed nếu dùng generator, command/log, runtime/platform/profile và outcome observed. Không đánh dấu TEST_CONFIRMED từ đọc code hoặc từ test chỉ kiểm tra prompt string.

## A. Parser, Unicode và contract

Owner chính P1; suite đích ai-output.test, video-seo.test, translation-response.test.

| ID | Severity | Trigger / input | Expected outcome | AC |
|---|---|---|---|---|
| C01 | P1 | JSON hợp lệ với escaped quotes/backslash/newline, emoji và surrogate pair | Accept đúng contract, text giữ nguyên sau normalization cho phép; không double-unescape | AC04, AC18 |
| C02 | P1 | `title` trùng key hoặc `title` và `\u0074itle`; duplicate sâu trong item | Reject duplicate trước JSON.parse làm mất key; không chọn last-wins | AC04 |
| C03 | P1 | Outer title chưa đóng, fence/inner object giống ảnh; tail bị che/thiếu | Reject, không extract inner object; một repair từ source, video không mất | AC01 |
| C04 | P1 | Một root valid kèm root khác wrong-schema, array root, scalar hoặc broken tail | Reject ambiguous; không lọc candidate theo schema rồi lấy cái còn lại | AC04 |
| C05 | P2 | Bare JSON, complete fence, một metadata object trong prose an toàn | Profile-compatible accept; strict path không tự nới; recorded clean/unwrapped/extracted | AC04 |
| C06 | P1 | Body chunked không Content-Length; compressed body hoặc nesting vượt limit; 100000 empty tags | Dừng đọc/parse trong bound spec 4.12, cancel reader, không allocate mảng vô hạn/ghi partial | AC18 |
| C07 | P1 | JSON chứa escaped lone surrogate hoặc UTF-8 bị cắt giữa byte sequence | Reject malformed text; không silently thay U+FFFD rồi accept | AC18 |
| C08 | P2 | Arabic/Indic có ZWJ/ZWNJ, emoji family, dấu tổ hợp; ID nhìn giống nhau nhưng khác code point | Giữ text có nghĩa; ID exact-match, không Unicode folding để alias | AC05, AC18, AC19 |
| C09 | P1 | Extra/prototype fields, null/wrong types/t-text conflict; AI mới hoặc persisted legacy thiếu hashtags | Strict AI reject/repair, legacy migrate riêng; malformed legacy trả null, không crash UI; không prototype merge/coercion | AC04, AC09, AC18 |
| C10 | P2 | JSON tutorial có `{safe}`, quotes hoặc từ JSON trong title/source; source là fragment | Không blanket contamination reject; phân loại structural vs heuristic theo evidence | AC07, AC19 |

## B. Transport, completion và capability

Owner P2; suite đích ai-output-provider-contract.test, translation-transport.test; live qualification riêng cho capability.

| ID | Severity | Trigger / input | Expected outcome | AC |
|---|---|---|---|---|
| C11 | P1 | Đã nhận một JSON hoàn chỉnh rồi socket lỗi/content-length mismatch | Incomplete transport, reject; không chuyển thành completion unknown để accept | AC03, AC16 |
| C12 | P1 | JSON đủ mọi field + length/MAX_TOKENS hoặc filtered/refused flag | Không publish hoặc checkpoint accepted; không gọi format repair để bypass refusal | AC03, AC16 |
| C13 | P2 | Body đọc xong, envelope hợp lệ, provider không công bố finish reason | Explicit unknown profile policy; structure pass không thành model-complete claim | AC03 |
| C14 | P1 | HTTP 200 HTML/error object/SSE khi request non-stream | Protocol error; không lấy JSON bên trong HTML/error làm answer | AC16 |
| C15 | P1 | Hai choices khác nhau; reasoning/thought/tool call cạnh text JSON | Chỉ final answer theo adapter contract; ambiguous candidates reject, không concatenate | AC16 |
| C16 | P1 | Stream terminal thiếu/lặp/mâu thuẫn; keepalive vô tận, split UTF-8 chunks | Supported-stream state machine terminal/UTF-8 đúng; keepalive không kéo dài timeout/tiến triển | AC14, AC16 |
| C17 | P2 | Schema-feature unsupported xác định so với invalid-schema 400/422 | Downgrade chỉ unsupported một lần; invalid schema thành config error có reason | AC02, AC17 |
| C18 | P1 | 401, repeated 429/5xx với Retry-After NaN/negative/overflow/HTTP date xa | Đúng error class, bounded abortable wait/retry, không hold lease trong backoff | AC08, AC17 |
| C19 | P1 | Endpoint/model revision đổi; schema support được cache từ request trước | Invalidate capability identity; không dùng profile qualified cũ cho model mới | AC02, AC20 |
| C20 | P2 | HTTP 200 và JSON đẹp nhưng gateway bỏ schema, hardcode stop | Evidence chưa verified; qualification không khẳng định constrained decoding/end-to-end stop | AC02, AC03, AC20 |

## C. Recovery, source và accepted state

Owner P3/P4; suite đích ai-output-recovery.test, translation-orchestrator.test, translation-budget.test, translation-response.test, video-title.test.

| ID | Severity | Trigger / input | Expected outcome | AC |
|---|---|---|---|---|
| C21 | P1 | Metadata malformed lần đầu, repair đúng; hoặc repair tiếp tục sai bằng text khác | Tối đa một content repair, accept chỉ khi đủ gate; text khác không cấp thêm vòng | AC01, AC08, AC17 |
| C22 | P1 | Translation thiếu một ID, các items còn lại clean | Persist đúng missing-only subset; request missing ID kèm source group/context | AC06 |
| C23 | P1 | Thiếu ID cùng duplicate ID/unknown hard error/unparsed continuation | Không accept subset của response hỏng; recovery không reuse items chưa đủ gate | AC06 |
| C24 | P1 | Initial→schema downgrade→repair→transport retries→credential failover | Mỗi wire attempt được accounting, finite allowlist/counters; không nhân retry ẩn qua wrappers | AC08, AC17 |
| C25 | P1 | Summary đủ schema nhưng không giảm context; lặp round, part index giống nhau | Rank giảm hoặc terminal no-progress; identity gồm round + exact chunk digest | AC17 |
| C26 | P1 | IDs reorder/numeric ID lạ/alias không bijective; source giống nhau nhiều cue | Exact mapping, không positional/content matching; timestamp/order của nguồn được giữ | AC05 |
| C27 | P1 | Missing-only chain rồi split/rephrase cố merge ngược; singleton phản hồi lỗi đổi chữ liên tục | Recovery DAG có rank giảm, repair slots tiêu hao; terminal không dựa mỗi raw fingerprint | AC08, AC17 |
| C28 | P1 | Source ID trùng, timestamp NaN/Infinity, reversed interval, invalid config | Source preflight error trước provider; không JSON.stringify thành null rồi gọi AI | AC18 |
| C29 | P1 | Response id-lines có physical continuation; JSON text có escaped newline hợp lệ | id-lines lỗi không drop continuation; JSON giữ multiline theo subtitle contract | AC04, AC05 |
| C30 | P2 | Source rỗng/chỉ whitespace/không đủ chủ đề hoặc summary một part hỏng | Không bịa metadata, không bỏ part; insufficient-source hoặc repair/terminal đúng task | AC07, AC17, AC19 |

## D. Cancellation, concurrency và late callbacks

Owner P2/P3/P4; suite đích ai-output-lifecycle.test, autoshort-resource-manager.test, autoshort-title-overlap.test.

| ID | Severity | Trigger / input | Expected outcome | AC |
|---|---|---|---|---|
| C31 | P1 | Attempt A timeout, B/generation mới thành công, A đến muộn | A không ghi accepted/progress/checkpoint/output hoặc xóa file của B | AC13 |
| C32 | P1 | Cancel lúc chờ lease, lúc đọc body, lúc backoff, trước parse | Task settles hữu hạn, abort propagated, không dispatch mới do callback race | AC08, AC14 |
| C33 | P1 | Provider bỏ qua AbortSignal, Promise.race đã settle nhưng server còn xử lý | Local endpoint unavailable cho dispatch mới; UI kết thúc task, endpoint khác không bị chặn | AC14 |
| C34 | P1 | Hai cửa sổ/process manual retry cùng checkpoint/output target | Một writer owner/fencing token, duplicate callback idempotent, stale owner bị chặn | AC13, AC20 |
| C35 | P1 | Hai video giống transcript/config nhưng khác target; config đổi khi request in-flight | Operation identity và artifact binding riêng; không cross-publish dù content digest giống | AC10, AC13 |
| C36 | P1 | Key/model discovery hoặc error handler hoàn thành sau cancellation; duplicate terminal callback | Không reset state/lease/accounting, không hồi sinh generation đã terminal | AC13, AC14, AC17 |
| C37 | P1 | Cancel trước atomic commit và ngay sau commit | Trước: bỏ temp owned; sau: giữ final valid, committed outcome không bị đổi thành xóa file | AC11, AC15 |
| C38 | P1 | Video bị thay/xóa hoặc final target xuất hiện giữa validation và commit | Revalidate video/path/generation, conflict/no-replace; không ghi lên file khác | AC11, AC13, AC15 |
| C39 | P1 | Crash khiến lock cũ còn lại; process cũ còn sống nhưng TTL hết | Không reclaim chỉ theo TTL; xác minh owner liveness hoặc yêu cầu recovery, không dual-writer | AC13, AC15, AC20 |
| C40 | P1 | Local stop/status API không có hoặc không thể xác nhận idle | Hạn chế được báo UNKNOWN; không sleep rồi force-dispatch/reset server dùng chung | AC14 |

## E. Filesystem, checkpoint và restart

Owner P3/P4; suite đích ai-output-publication.test, translation-resume.test, translation-identity.test; platform qualification riêng.

| ID | Severity | Trigger / input | Expected outcome | AC |
|---|---|---|---|---|
| C41 | P1 | Short write/ENOSPC/EPERM/EACCES khi temp, flush, commit, receipt | Video giữ nguyên; final không dở dang, owned-temp cleanup, error phân loại | AC11, AC15 |
| C42 | P1 | Crash trước commit; crash sau commit trước receipt; restart | Reconcile prepared manifest/hash; không ghi đè final hợp lệ hoặc xóa file không rõ owner | AC15, AC20 |
| C43 | P1 | Filesystem/network share không hỗ trợ primitive atomic no-replace hoặc disconnect giữa chừng | Unsupported/error giữ video, không fallback direct-final-write/overwrite rename | AC15 |
| C44 | P1 | Symlink/junction đổi parent sau check; output filename có Unicode/path special chars | Containment/handle strategy fail safe; không write/delete ngoài root; platform limitations ghi rõ | AC11, AC15 |
| C45 | P1 | Checkpoint valid outer key nhưng nested batches/map/counters sai, duplicate fields | Reject deep validation; không resume dữ liệu giả, giữ evidence/file cũ | AC06, AC20 |
| C46 | P1 | Checkpoint truncated/oversized/future schema, read permission error | Bounded parse; corruption recovery khác I/O error; không app crash hoặc delete-on-error | AC18, AC20 |
| C47 | P1 | Crash sau charge-before-dispatch hoặc sau server nhận trước lưu response | In-flight unknown/counters bền vững; không reset request budget, không hứa exactly-once server | AC17, AC20 |
| C48 | P1 | Parser/schema mới bật nhưng cache key vẫn version cũ; rollback code độc lập cache | Version gate cùng commit; namespace phù hợp, không reuse old unsafe accepted | AC10, AC20 |
| C49 | P2 | Model alias giữ nguyên nhưng model thực/revision đổi hoặc chưa biết | Identity dùng resolved evidence; unknown revision không durable reuse cross-session mặc định | AC10, AC20 |
| C50 | P1 | Checkpoint/path cùng tên nhưng source/group/cue time khác dưới mức rounding digest | Không collide semantic identity; canonical timestamp precision được test, owner/source mismatch reject | AC05, AC10, AC20 |

## F. Nội dung, diagnostics và lỗi kết hợp

Owner P5/P6; suite đích video-seo.test, translation-multilingual.test, translation-language.test, translation-qualification.test và các suite tích hợp mới.

| ID | Severity | Trigger / input | Expected outcome | AC |
|---|---|---|---|---|
| C51 | P1 | JSON/IDs đầy đủ nhưng nội dung cue 2 chuyển sang cue 1; title escaped full JSON | Protocol errors chắc chắn chặn; semantic suspicion có evidence/repair, không gọi schema pass là semantic pass | AC07, AC19 |
| C52 | P2 | Source fragment chưa dấu chấm, source=target locale, lặp từ có nghĩa | Không hard reject bằng incomplete/source-echo heuristic máy móc | AC07, AC19 |
| C53 | P1 | Repair sửa format nhưng đổi số/tên/phủ định hoặc tạo facts mới | Không replace candidate chỉ vì parse pass; giữ/recompute protected checks và đúng disposition | AC07, AC19 |
| C54 | P2 | SEO tóm tắt bỏ con số không liên quan; số/đơn vị tương đương ngôn ngữ | Không bắt lặp mọi token nguồn; validate claims được đưa ra, ghi heuristic uncertainty | AC19 |
| C55 | P1 | Source/glossary/brand voice/raw repair chứa lệnh đổi schema/path, giả ID markers | Nội dung là data; không override task contract/expected IDs/path, không tool execution | AC05, AC07, AC18 |
| C56 | P2 | ASR sai tên/facts hoặc language verifier chưa hỗ trợ | Quality unknown/warning rõ ràng; không tự chữa facts/drop cue/đổi grouping vật lý | AC07, AC19 |
| C57 | P1 | Provider echo key trong error; debug write/redaction lỗi; evidence vượt cap | Redact trước log, bounded omission, không recursive logging/retry; video/result không bị phá | AC12 |
| C58 | P1 | Nhiều item debug cùng đầy đĩa, request timeout và late response tới khi cleanup | Shared disk reservation; stale response không tái tạo temp sau cleanup, không ảnh hưởng item khác | AC12, AC13, AC14 |
| C59 | P1 | Metadata valid sau repair, commit thành công, receipt fail rồi cancel/restart | Final valid được giữ/reconcile; không rerender/xóa video hoặc retry AI vô ích | AC11, AC15, AC20 |
| C60 | P2 | Client mock pass nhưng live profile chưa chạy; một clean sample pass, model upgrade sau đó | Qualification report giữ UNKNOWN ở phần thiếu evidence; không auto-enable verified/profile cũ | AC02, AC12, AC20 |

## Cách nghiệm thu ma trận

- Mỗi case phải assert state/output/request count/ownership phù hợp, không chỉ assert error string.
- C03 là synthetic-from-screenshot, không giả làm raw provider capture; giữ ảnh tham chiếu trong provenance.
- C06/C07/C16 dùng chunk boundaries và limit boundaries; C31–C47 dùng deferred promises/fault injection ở từng điểm I/O để kiểm tra thứ tự thắng/thua.
- C08/C10/C52/C54 là positive controls bắt buộc. Không tối ưu rejection rate bằng cách reject mọi input khác ASCII hoặc mọi warning.
- C33/C40/C43/C44 có platform/live dependency. Fake test có thể chứng minh client fail-safe; không chứng minh server ngừng compute hay filesystem hỗ trợ atomic commit.
- Kết quả thực thi phải ghi observed status và limitations; mọi claim AC pass trỏ tới test/live evidence tương ứng.
