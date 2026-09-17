# COVERAGE

## Ranh giới review

Phạm vi theo lịch sử session: dịch ngắn/tự nhiên/đủ ý, budget vật lý và token, Gemini Gateway 1M, giữ Local/Edge voice, implementation đã bàn T00–T13. Đây không phải review toàn bộ các thay đổi không liên quan trong dirty working tree.

`FILE_INVENTORY.md` liệt kê 63 file với SHA-256, số dòng và phương thức kiểm tra. “Executed” không đồng nghĩa đọc từng assertion; “focused” không đồng nghĩa đọc toàn bộ file lớn. Không suy từ 210 tests sang chứng minh chất lượng media thực tế.

## Ma trận yêu cầu

| Yêu cầu | Đã đối chiếu | Kết luận |
| --- | --- | --- |
| R01 immutable IDs/spans | Planner, adapter prompt, restore mapping, parser tests | F04 thiếu wire mapping internal units |
| R02 bảo toàn nghĩa/lời | Source repair, same-language guard, final captions | F03 semantic bypass; F07 false rejection |
| R03/R04 policy tempo/gap | Synthesis, grouping, time-map regressions | Trần vật lý được test; F06 budget trước TTS lệch grouping |
| R05 không Gemini voice | Gateway text paths và synthesis Local/Edge wiring | Không thấy thêm Gemini speech trong scope |
| R06 cancel/no-progress/accounting | Orchestrator, feedback, TTS cancellation tests | F01/F02/F05; không bật quota tổng |
| R07 an toàn hệ thống | Dirty-state preservation, existing typed boundaries/scope | Không sửa license/paths/engines; không audit mọi subsystem |
| R08 subtitle vs dubbing | Planner/prompt mode, locale/profile paths | Mode-specific code/test có; chưa corpus đa ngôn ngữ |
| R09 untrusted evidence | Prompt data delimiters, strict parser, semantic helper | Helper capping evidence có test, chưa source-span verifier hoàn chỉnh |
| R10 Gateway 1M | Capacity/preflight/output planner, mock full-ledger test | CODE_CONFIRMED floor; F04/F05; live counter/near-limit UNKNOWN |
| R11 identity | Source duration digest, cache/draft/checkpoint tests | Legacy paths có coverage; frozen-plan snapshot đầy đủ chưa có |
| R12/R13 transaction/resume | Call-sites, accepted retry, checkpoint round-trip | F02; F08 latent helper; full new revision state chưa có |
| R14 logs/metrics | Audit retention và offline evaluator | Full-ledger retention risk; human/live metrics chưa có |
| R15 UI/compatibility | Spec/task status và shared contract diffs | Không UI smoke, không Windows artifact verification |

## Các phép kiểm tra đã chạy

- `npm.cmd run typecheck`: node + web, exit 0.
- `run-regressions.mjs`: 21 suites, 210 pass, 0 fail, 0 skip; log đầy đủ `regression-results.txt`.
- `run-review-probes.mjs`: 8/8 tái hiện, không gọi provider/TTS thật; log `probe-results.txt`.
- Tìm call-sites toàn `src` để phân biệt consumer active và helper chỉ dùng trong test. F08 **không** đi qua checkpoint active của coordinator.

## Chưa kiểm tra

Không chạy lại toàn bộ runtime suite repo trong lượt read-only này. Không có audio thật/FFmpeg render, native listening, nguồn được người hiểu tiếng Trung chấm, benchmark chính xác token/RAM ở 1M, Gateway live, installed Windows smoke, CI remote. Không tuyên bố những gate này pass dựa vào kết quả của lượt trước.

Không đọc mọi file khác của repo, secrets, cookie store, media riêng tư hay lịch sử task không liên quan. Không benchmark hoặc so sánh với hệ thống nội bộ YouTube/Facebook.
