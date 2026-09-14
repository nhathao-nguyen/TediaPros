# Thiết kế sửa Gemini Gateway và dịch hai lượt

Ngày: 2026-09-14. Trạng thái: đề xuất để triển khai; tài liệu này không xác nhận code đã được sửa.

## 1. Mục tiêu và bằng chứng

Chọn đúng Gemini 3.1 Pro qua CreateMediaTool, trả metadata trung thực, giảm lỗi định dạng mà không đoán nội dung, giữ dịch/khôi phục và review độc lập trong hai lượt bình thường.

Bằng chứng gốc: [investigation.md](../../../.ai/tasks/2026-09-14-gateway-root-cause/investigation.md), [evidence.json](../../../.ai/tasks/2026-09-14-gateway-root-cause/evidence.json).

- LIVE_CONFIRMED: code hiện tại gửi chuỗi ngẫu nhiên ở vị trí model ID trong header; Google ghi `3.8 Flash` mặc dù yêu cầu `gemini-advanced`.
- LIVE_CONFIRMED: chỉ thay model ID trong header, prompt nhỏ trả `3.1 Pro`. Prompt gọn 6.624 byte trả đủ 113 ID trong 68,5 giây.
- LIVE_CONFIRMED: cùng prompt gọn qua routing cũ vẫn lỗi; nguyên prompt 38.367 byte với header Pro hết deadline 4 phút của harness.
- UNKNOWN: nguyên nhân nội bộ Google tạo generic error; tác động của từng chỉ dẫn riêng lẻ; độ chính xác ngữ nghĩa của bản dịch thử; tỷ lệ thành công lâu dài. Không gọi các giả thuyết này là lỗi context đã xác nhận.

## 2. Phương án và quyết định

| Phương án | Lợi ích | Hạn chế | Quyết định |
|---|---|---|---|
| Chỉ đổi hash model cố định | Vá routing nhỏ, dễ kiểm tra | Hash/quyền tài khoản có thể đổi; metadata và parser vẫn sai | Chỉ dùng làm đối chứng, không làm thiết kế lâu dài |
| Model catalog theo tài khoản + xác minh phản hồi + JSON normalization giới hạn + prompt hai lượt gọn | Sửa lỗi có bằng chứng, bảo toàn chất lượng và số lượt | Phải cập nhật hợp đồng cả hai repo | Chọn |
| JSON repair rộng + chia nhỏ cue + tăng retry | Có thể che lỗi cú pháp trước mắt | Có thể mất nghĩa, thêm lượt, vẫn chạy sai model | Loại |

CreateMediaTool tiếp tục sở hữu cookie/session, protocol Gemini Web, model routing, quan sát model/completion và retry transport/JSON. TediaPros sở hữu source ledger, prompt, schema nghiệp vụ, cue ID/timestamp, chất lượng ngữ nghĩa, checkpoint, TTS và UI. Không mang cookie vào Electron.

## 3. Quy tắc xuyên suốt

- Giữ alias người dùng `gemini-advanced` với đích yêu cầu `Gemini 3.1 Pro`. Không tự chuyển sang Flash hoặc bản Pro khác khi không tìm thấy đích. Không coi từ `advanced` trong HTML là bằng chứng quyền/model.
- Lấy model ID và thuộc tính header từ catalog của tài khoản qua RPC; dữ liệu phải được kiểm chứng bằng fixture và live ở thời điểm triển khai. Hash `e6fa609c3fa255c0` chỉ là bằng chứng ngày 2026-09-14, không là fallback âm thầm.
- Mỗi generation của TediaPros phải có observed model ID khớp route đã chọn. Label là thông tin hiển thị bổ sung, không dùng so khớp chuỗi mơ hồ để thay thế ID.
- Cues không đổi ID, thứ tự nguồn, timestamp hoặc số lượng. Code dựng lại output theo ID. Không tách batch vì lỗi routing/JSON.
- Hai lượt bình thường: restore-translate, independent-review. Chuẩn hóa JSON và đọc capabilities không tiêu thụ generation.
- Giữ trần 3 generation attempt tại gateway cho mỗi logical stage, provider bên trong 1 attempt. Luồng hai stage có tối đa 6 generation attempt khi phục hồi lỗi đủ điều kiện; đây là trần retry hiện có, không khôi phục ngân sách toàn video đã tạm tắt. Lượt bấm thử lại của người dùng là lần chạy mới, phải hiển thị riêng.
- Không tăng tempo 1.80x, bỏ thoại, sửa vocal separation/blur/render, đổi provider, hoặc tự publish. Metadata lỗi không làm mất video đã render.
- Hủy tác vụ vẫn được truyền xuống HTTP. Timeout/đứt kết nối có trạng thái upstream chưa rõ không được tự gọi chồng một generation mới.

## 4. Model catalog và bằng chứng completion

Catalog lưu snapshot bất biến theo session nội bộ: ID upstream, display name, aliases, model number, capacity/capacity field, availability và catalog generation. Refresh mỗi 15 phút hoặc khi session thay đổi; cache session này không được dùng cho session khác. Refresh đồng thời dùng một flight, request đang chạy giữ snapshot ban đầu. RPC lỗi chỉ cho dùng snapshot cùng session chưa hết 15 phút; không có snapshot hợp lệ thì báo `model-catalog-unavailable`.

Mọi trường chọn model của header/body phải được tạo từ một `ModelRoute`, không chỉ thay slot hash. Không đưa UUID vào slot model. Nonce/request ID vẫn ở đúng trường riêng.

Parser giữ model ID/label của candidate đã chọn, candidate/response identity và trạng thái completion theo profile protocol đã kiểm chứng. Không ghép snapshot của hai candidate, không dùng frame trước lỗi cuối làm output thành công. Trường unknown hoặc marker chưa được chứng minh phải là `unknown`, không tự gán `stop`. HTTP EOF đơn thuần không chứng minh hoàn tất. Payload[39], payload[42] và candidate[8] là các vị trí đã quan sát trong mẫu hiện tại; phải kiểm tra cả biến thể sparse-field trước khi chuẩn hóa thành contract.

Giới hạn đề xuất cho đường structured text: raw HTTP body 16 MiB; text JSON 1 MiB; depth 32; tổng member 10.000. Đọc max+1 byte để phát hiện vượt giới hạn; UTF-8 sai bị từ chối. Không áp giới hạn text này cho binary media/download riêng. TediaPros tiếp tục áp giới hạn chặt hơn theo số cue qua parser sẵn có.

## 5. Contract v2 giữa hai dự án

Thêm `gateway_contract_version: 2` vào capabilities. Giữ các trường cũ để client khác đọc được; `model_selection` đổi thành `observed-id-required` cho đường đã hỗ trợ, không tiếp tục công bố `exact` vô điều kiện.

TediaPros gửi phần mở rộng `gateway_requirements` trên từng request:

```json
{"gateway_requirements":{"contract_version":2,"require_verified_model":true,"require_complete_response":true}}
```

Client generic/media cũ không gửi phần này tiếp tục luồng tương thích hiện tại; metadata phải trung thực ở mọi đường. TediaPros mới gặp gateway v1 báo cần cập nhật, không fallback âm thầm.

Metadata thành công v2:

```json
{
  "gateway_contract_version": 2,
  "requested_model": "gemini-advanced",
  "resolved_model": "gemini-advanced",
  "observed_model": "3.1 Pro",
  "observed_model_id": "e6fa609c3fa255c0",
  "model_verification": "matched",
  "route_fingerprint": "sha256-of-non-secret-route-fields",
  "completion_state": "complete",
  "completion_evidence": "observed-terminal-frame-v1",
  "normalization": ["strip-bom", "unwrap-json-fence"],
  "logical_request_id": "uuid",
  "upstream_attempts": 1,
  "upstream_retry_reasons": [],
  "usage_known": false
}
```

`resolved_model` là alias đã resolve, không phải bằng chứng upstream. `route_fingerprint` chỉ hash ID model/thuộc tính route/protocol version; không chứa cookie, token, account identifier. TediaPros kiểm tra version, matched, observed ID, completion_state trước nội dung. `finish_reason=stop` không được dùng thay các gate này.

Error v2 vẫn giữ `error.message/type`, thêm `error.code` và `gateway_metadata` có logical request ID, upstream_attempts, stage-independent retry reasons và bằng chứng đã có. Không log nguyên URL xác thực. Error codes: `model-unavailable`, `model-catalog-unavailable`, `model-mismatch`, `model-unverified`, `upstream-transient`, `upstream-incomplete`, `upstream-timeout`, `invalid-json`, `ambiguous-json`, `duplicate-key`, `response-limit`, `authentication-required`, `cancelled`.

## 6. JSON normalization được phép

Gateway chuẩn hóa khi request có response_format, sau gate model/completion và trước strict parse. Chỉ nhận một object root. Không cho schema bị coi là native constrained decoding.

| Input | Kết quả |
|---|---|
| JSON object sạch | Nhận nếu strict parse và các gate qua |
| Một BOM đầu chuỗi, JSON whitespace ở ngoài | Bỏ đúng lớp này; kiểm tra lại byte limit |
| Một fence hoàn chỉnh `json` hoặc fence trống, bao toàn bộ object, ngoài fence chỉ JSON whitespace | Bỏ đúng một fence, parse lại |
| Fence thiếu đóng, nhiều fence, prose trước/sau, nhiều object, array root | Từ chối |
| Key trùng sau decode, kể cả escaped key; Unicode/UTF-8 lỗi | Từ chối trước khi dựng map |
| Thiếu ngoặc/nháy, trailing comma, single quote, smart quote, object lặp trong string | Không vá; từ chối |
| Object hợp lệ nhưng thiếu/lạ/trùng ID, giá trị rỗng/sai kiểu | TediaPros từ chối qua schema/cue gate |

Không dùng thư viện JSON repair tổng quát, regex lấy `{...}` đầu tiên/cuối cùng, nối các response, hoặc suy cue bằng vị trí. Không normalize nội dung string. `normalization[]` cho biết thao tác đã thực hiện. Không cần generation để unwrap.

TediaPros đã có strict parser, BOM và `allowFence` opt-in. Tái sử dụng, giữ `allowProseObject=false`; không đổi default parser chung của title/SEO. Gateway trả canonical object; defense phía client vẫn parse độc lập.

## 7. Prompt hai lượt và lưu bản nháp

Tạo builder riêng cho gateway, không tiếp tục replace chuỗi instruction từ prompt provider khác. Payload gồm source language, target locale, optional glossary/synopsis, toàn bộ `{id,text}` và source group chỉ khi thực sự cần ngữ cảnh. ID chỉ xuất hiện trong ledger, không lặp thêm danh sách expected_ids. Timestamp, duration, word quota và mức tempo không gửi trong hai lượt dịch; timing đo sau ở TTS. Prompt dùng một contract JSON gọn, không nhắc schema lặp nhiều nơi.

Draft: phục hồi lỗi ASR khi ngữ cảnh hỗ trợ; giữ tên/số/đơn vị/phủ định; thuật ngữ nhất quán; văn nói đúng locale; không thêm factual claim/hook/CTA; bảo toàn nghĩa theo ID. Câu chưa hoàn tất có thể tiếp tục qua cue. Không tự sửa tên lạ thành thương hiệu quen. Giữ dấu câu tự nhiên tại ranh giới đúng.

Review: session mới, nhận đầy đủ source và draft cùng glossary/locale; độc lập kiểm tra omission/addition, ID-to-meaning, số/đơn vị/phủ định, thuật ngữ, ASR restoration, cách nói địa phương và dấu câu. Trả toàn bộ final `translations` một lần. Không yêu cầu chain-of-thought, chấm điểm dài hoặc đoạn giải thích trong wire contract.

Mục tiêu prompt trên fixture 113 cue: draft <=12 KiB, review <= draft + candidate JSON +4 KiB; đây là regression gate trên fixture, không cắt dữ liệu video khác để đạt trần. Prompt compact thử nghiệm không được copy thẳng làm production vì chưa đạt punctuation/semantic gate.

Sau draft đủ model/completion/schema/ID gate, lưu candidate riêng dưới item scope với trạng thái `draft-validated`; nó không là bản dịch final và không được chạy TTS. Khi review lỗi và người dùng bấm retry, chỉ resume review nếu toàn bộ source digest, target locale, glossary/synopsis, prompt versions, parser version và route_fingerprint khớp, kèm kiểm tra SHA/byte limit và 113 ID. Nếu không khớp, tạo draft mới. Không lưu draft chỉ vì HTTP 200.

Không dùng bản dịch cache cũ chỉ có alias model làm bằng chứng Pro. Thêm namespace identity gateway v2 để cache cũ thành miss có lý do; giữ ASR/checkpoint nguồn và video đã render. Không xóa cache toàn bộ.

## 8. Retry, số request và lỗi hiển thị

Gateway sở hữu duy nhất retry generation transport/JSON. Provider bên trong luôn attempt_limit=1 khi structured. Invalid JSON được phản hồi bằng error code ngắn trong lần retry đã có, không chép raw output lỗi vào prompt. Retry dùng generation mới và reset conversation metadata.

Retry được phép trong cap3: generic upstream transient, HTTP 5xx đã nhận xong, JSON syntax/shape sai sau completed response. Delay giữ backoff hiện có 1s, 2s; HTTP 429 chỉ retry khi Retry-After hợp lệ và còn nằm trong deadline request. Model/auth/cancel/limit/unknown-completion/timeout không tự retry; mismatch có thể refresh catalog bằng RPC nhưng không tự generation thêm. Semantic thiếu ID/sai nghĩa tại TediaPros không tạo một lớp retry 3 lần nữa; giữ needs-review hoặc dùng retry người dùng với lý do rõ ràng.

| Tình huống | Generation |
|---|---:|
| Draft + review thành công ngay | 2 |
| JSON bọc fence, chuẩn hóa thành công | Vẫn 2 |
| Draft dùng 2 attempt, review 1 | 3 |
| Mỗi stage dùng hết cap3 và thành công | 6 |
| Review thất bại, retry dùng lại draft hợp lệ | Chỉ stage review được gọi lại, hiển thị số thực tế |
| GET capabilities | 0 |
| Người dùng bấm xác minh model khi chưa có cache | 1, tách khỏi số lượt video |

Chặn tầng queue/coordinator tự retry item với lỗi gateway thuộc nhóm đã exhausted hoặc permanent; không để retry cuối batch nhân trần mà UI không thể hiện. Chỉ nút retry rõ ràng mở lần chạy mới cho nhóm lỗi này. Hủy/timeout phải đóng lease trước khi nhận lần chạy tiếp theo.

## 9. Kiểm tra model và UI

GET capabilities luôn read-only, không generation. Thêm POST `/openai/v1/gateway/verify-model` nhận `{model,force:false}`. Trả verification state, observed ID/label, verifiedAtUtc, expiresAtUtc, verificationGenerationRequests. Probe đúng một generation, không JSON retry; timeout/cancel trả trạng thái chưa xác minh. Cache RAM 15 phút theo session+route; refresh credential, catalog route đổi hoặc mismatch sẽ invalidate. Coalesce concurrent verify. Các generation thành công cũng cập nhật verification cache; không probe thêm mỗi video.

Nút kiểm tra dùng API qua Main/typed IPC. Hiển thị riêng: kết nối được/chưa xác minh; Pro đã xác minh kèm thời điểm; trả model khác; model không khả dụng; cần cập nhật gateway/cookie. UI không gọi model list thành kiểm chứng inference.

Hàng đợi hiển thị tên stage, thông báo Việt ngắn, nút xem chi tiết với logical request ID và count. Lỗi provider không sinh hàng trăm `missing-id` để đổ cho cue; danh sách cue chỉ hiện cho lỗi nội dung đã thực sự kiểm tra. Badge mặc định `2 lượt dịch/review`; số phát sinh hiển thị riêng. Shared/renderer giữ isomorphic và typed IPC.

## 10. Nghiệm thu và phát hành

Offline: fixtures model catalog/response giữ trường cần thiết, loại token/cookie/session/location; strict JSON parity Go/TS; retry-count, cancellation, two-pass review, draft resume, cache identity và UI integration. Không coi mock pass là live pass.

Live theo thứ tự: một probe Pro; một 113-cue draft+review; một Volvo draft+review; review thủ công những đoạn ASR/tên/số/phủ định và văn phong. Tổng kế hoạch smoke ban đầu 5 logical generation; actual retry count có thể cao hơn và phải ghi. Không chạy thêm hàng loạt để chọn chỉ kết quả đẹp. Chỉ chạy render/TTS video 113 cue một lần sau gates, tái dùng checkpoint đã hợp lệ để tránh dịch thêm.

Đạt nghiệm thu khi từng response text thành công xác nhận đúng Pro/completion; JSON đúng đủ IDs; video113 và Volvo qua hai lượt review và các lỗi nghĩa được kiểm tra; zero over-tempo/drop; không tăng request vì normalization/preflight; UI thể hiện lỗi thật. Nếu upstream không cho xác minh model/protocol, đánh dấu live gate chưa đạt, không fallback hay công bố thành công.

Triển khai gateway trước, TediaPros sau; build xong mới dừng process đã xác định chính xác và khởi động một gateway trên port4982. Kiểm tra port/process/binary và capabilities v2. Rollback về phiên bản cũ phải làm TediaPros chặn gateway v1, không tiếp tục chạy sai Pro. Không tạo dãy server.pre-*.exe; lưu commit/build hash và tối đa một artifact rollback ở thư mục release có tên rõ ràng.
