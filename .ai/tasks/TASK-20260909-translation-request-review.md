# TASK-20260909: Review một request/response dịch Local

- **Trạng thái:** Hoàn thành review; chưa triển khai sửa lỗi.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-09

## 1. Mục tiêu

Review mẫu request/response người dùng cung cấp: độ đầy đủ, chất lượng dịch, ngân sách context và hướng dẫn thời lượng dubbing. Đối chiếu mã hiện tại và tái hiện offline trường hợp câu cuối bị cụt.

Nguồn: `C:/Users/PC/.codex/attachments/bf7c64fc-1717-4847-a549-751a966ed103/pasted-text.txt`.
Request SHA-256 được ghi trong mẫu: `00c50e31c4385afefe0c807537dea51c031e24a00e80b06f0c13743d3bb47511`.
Đây là giá trị log cung cấp, không phải kết quả hash lại attachment.

## 2. Tiêu chuẩn nghiệm thu

- [x] Đếm cue và đối chiếu expected IDs.
- [x] Phân biệt dữ kiện trong log, kết quả đọc code, tái hiện offline và giả thuyết server.
- [x] Review các câu dịch có vấn đề và các dấu hiệu văn bản nguồn bị nhận dạng sai.
- [x] `npm run typecheck` pass.
- [x] Các test parser/orchestrator/planner hiện có pass; chạy thêm probe bằng mẫu thực.

## 3. Phạm vi

Review và tạo bản ghi bàn giao. Không thay đổi mã sản phẩm, test, cấu hình server hoặc nội dung dịch của tác vụ đang chạy. Không gọi dịch/TTS trên server thật. Không có audio/video gốc để xác minh tên loài hay sửa nguồn.

## 4. Phát hiện và quyết định

### P1: Response thiếu nội dung; câu cụt có thể sống sót qua recovery

LOG_CONFIRMED: Request yêu cầu 23 cue (0–22); response có 19 dòng (0–18). Cue 18 chỉ chứa `It's`. Thiếu `cue-19-34370`, `cue-20-35910`, `cue-21-37230`, `cue-22-38090`. Không trả dư cue context 23–24. HTTP 200 và `ok: true` không chứng minh dịch đủ.

CODE_CONFIRMED:

- `src/main/localTranslate.ts:215–223`: adapter chỉ suy ra `truncated` từ `finish_reason === 'length'`; không chuyển token usage cho orchestrator.
- `src/main/translation/response.ts:108–116`: kiểm tra ID và chuỗi không rỗng không phát hiện ngữ nghĩa bị cụt của `It's`.
- `src/main/translation/orchestrator.ts:343–385`: chấp nhận/persist các dòng parse được, sau đó yêu cầu riêng cue thiếu nếu parser chỉ báo missing-id.

TEST_CONFIRMED qua probe offline dùng `esbuild` bundle các export parser/orchestrator vào bộ nhớ:

1. Parse response thực với `truncated: false`: `complete: false`, chỉ có lỗi `missing-id` cho 4 ID; cue 18 vẫn nằm trong items.
2. Chạy orchestrator: lần đầu dùng response thực; lần hai dùng response giả lập chỉ cho 4 cue thiếu.
3. `onBatch` đầu tiên nhận 19 item, trong đó cue 18 là `It's`.
4. Request tiếp theo chỉ yêu cầu cue 19–22, không yêu cầu lại cue 18.
5. Kết quả trả về đủ 23 ID, `disposition: with-warnings`, cue 18 vẫn là `It's`; không có issue trỏ đến cue 18.

Giới hạn probe: response recovery là fixture, không phải request kế tiếp trong log; timestamps của hai context-after cue là fixture (attachment chỉ cho ID/text). Đây là bằng chứng hành vi offline của code hiện tại, chưa chứng minh tác vụ live đã xuất video chứa câu cụt.

Khuyến nghị: nhận biết truncation ngoài finish_reason; đưa câu cuối đáng ngờ vào recovery cùng các cue thiếu trước khi persist/chấp nhận. Không dùng tiêu chí thiếu dấu chấm làm quy tắc duy nhất vì subtitle fragment có thể hợp lệ.

### P1: Dấu hiệu chạm context 4096 và planner không biết giới hạn server

LOG_CONFIRMED: `prompt_tokens=3719`, `completion_tokens=377`, `total_tokens=4096`, request `max_tokens=2048`, response `finish_reason=stop`.

INFERRED: rất có thể server đang giới hạn tổng context ở 4096: `4096 - 3719 = 377`. Chưa xác minh cấu hình/backend server nên không kết luận chắc chắn server dùng llama.cpp hay finish_reason bị ghi sai.

CODE_CONFIRMED: Local capability khai báo `contextTokens: null` tại `localTranslate.ts:176`; `planner.ts:170–177` bỏ kiểm tra context khi giá trị null, còn fallback tại `planner.ts:203` dùng tối đa 24 cue và 20000 ký tự ước lượng.

Tham khảo cơ chế có thật: mã nguồn llama-cpp-python giới hạn max_tokens theo phần còn lại của n_ctx tại https://github.com/abetlen/llama-cpp-python/blob/main/llama_cpp/llama.py (nhánh main được đọc ngày 2026-09-09). Đây là đối chiếu cơ chế, không xác định backend của server người dùng.

Khuyến nghị: xác minh context/tokenizer thực, chia batch theo input + output dự kiến + khoảng dự phòng; làm tròn số thời lượng trong prompt và giảm lặp metadata. Tăng riêng max_tokens không giải quyết trường hợp hết context.

### P2: Nguồn có dấu hiệu sai chữ, tên loài chưa đủ tin cậy

- `妓的` ở cue 0 có thể là lỗi nhận dạng của `記得`.
- `可印肉少` ở cue 5 có thể là `殼硬肉少`; nếu đúng, bản dịch `But the meat is scarce.` mất ý vỏ cứng.
- `可僅應難處理` ở cue 10 có thể chứa `殼堅硬難處理`; cần đối chiếu nguồn trước khi sửa.
- `可實的` ở cue 11 nhiều khả năng là `可食的`: bản dịch `real crab meat` không thể hiện ý edible.
- `解解蟬` ở cue 12 nhiều khả năng là `解解饞`; response bỏ ý thỏa cơn thèm.
- Cue 9 `strong armed tight-grip crab` và cue 14 `giant illustrated crab` là các tên dịch máy đáng ngờ. Không xác nhận danh pháp khi thiếu video/nguồn chuẩn.
- Cue 15 `鮮甜味不足` được dịch `lacks overall sweetness`, làm mờ sắc thái vị tươi/ngọt ngon.

Các đề xuất sửa chữ là INFERRED, không phải transcript đã xác minh. Glossary và synopsis đang rỗng. Nên xác minh tên loài, lập glossary, và lưu dấu vết hiệu chỉnh nguồn trước khi dịch lại.

### P2: Khung thời lượng rất chật, wording chưa tối ưu

| Cue | Số từ output | Cửa sổ nói | Hard max natural ở trần 1.80x |
| --- | ---: | ---: | ---: |
| 0 | 10 | 1.42s | 2.556s |
| 2 | 5 | 0.38s | 0.684s |
| 5 | 5 | 0.38s | 0.684s |
| 14 | 5 | 0.72s | 1.296s |

Hai cue 2 và 5 có duration nguồn 0.88s nhưng bị dành 0.50s cho protected gap, còn 0.38s. Đọc 5 từ trong 0.684s tương đương khoảng 439 từ/phút trước tăng tốc. Đây là cảnh báo khả năng fit; chưa có WAV để kết luận tempo thực tế.

Tổng duration nguồn của 23 cue: 36.82s; tổng speaking windows: 27.12s; phần dành ra: 9.70s. Suggested max words là gợi ý, không phải lý do được phép bỏ ý hay tên riêng. Công thức target=window*1.10 và hard=window*1.80 nhất quán trong mẫu.

Prompt đã làm rõ exact IDs, dữ liệu không phải chỉ dẫn, context chỉ đọc, bảo toàn nghĩa và measured TTS quyết định fit. Cần giữ các yêu cầu này, đồng thời rà cách chia cue/gap và đo TTS thật.

## 5. Tệp thay đổi

- [NEW] `.ai/tasks/TASK-20260909-translation-request-review.md`.
- Không chỉnh mã sản phẩm hoặc test.

## 6. Kiểm chứng

Lệnh đã chạy từ repo root:

```powershell
cmd.exe /d /c "npm.cmd run typecheck"
cmd.exe /d /c "node scripts/run-local-runtime-tests.mjs translation-response.test translation-orchestrator.test translation-planner.test"
```

- Typecheck node/web: PASS, exit 0.
- Translation response: 7/7 PASS.
- Translation orchestrator: 18/18 PASS.
- Translation planner: 7/7 PASS.
- Probe offline bằng response thực: xác nhận câu cụt được giữ lại sau recovery giả lập.
- Test hiện có pass không phủ định lỗi tìm được; chưa có regression case cho mẫu `finish_reason=stop` + missing tail IDs + nonempty incomplete last cue.

## 7. Bàn giao

Ưu tiên sửa xử lý response bị cụt và persist trước; tiếp theo đồng bộ context capability/planner với server; sau đó chuẩn hóa nguồn/tên loài và đánh giá timing bằng TTS thật. Log người dùng chỉ chứa đầu request sequence 11, chưa có nội dung request/response tiếp theo để xác nhận recovery live.

## 8. Bổ sung sau khi người dùng cung cấp repo server

Repo: https://github.com/nhathao-nguyen/ai-server . Ngày kiểm tra 2026-09-09, remote chỉ quảng bá một branch `checkpoint/pre-improvements-20260826`, cũng là default branch. Commit đã đọc: `123fb0e1ef869f5e91fe8b72b0674ab2c51269df`, ngày 2026-08-29. Chưa xác minh máy server live đang chạy đúng commit này.

### Kết luận được nâng từ suy đoán lên bằng chứng code

- Backend trong repo là Ollama. `app/core/config.py:29–30` mặc định `127.0.0.1:11434`, model `qwen3.5:9b`. Đây là mặc định code, không phải giá trị môi trường live đã xác nhận.
- **P1, CODE_CONFIRMED:** `app/api/routes_chat.py:142` ghi cứng `finish_reason: stop` cho mọi response non-stream thành công. Vì vậy trường stop trong mẫu không thể dùng để phân biệt kết thúc tự nhiên và hết token nếu live chạy code này.
- `app/engines/ollama.py:54–61` giữ dữ liệu backend trong `LlmResult.raw`, bao gồm done_reason nếu Ollama trả về, nhưng route không sử dụng trường đó.
- `app/engines/ollama.py:141–158` chuyển đúng max_tokens thành `options.num_predict`, giữ nguyên messages, đặt think=false; không thiết lập num_ctx.
- Không tìm thấy cấu hình context cho LLM trong Settings, .env.example hoặc scripts. Không có hardcode 4096 cho LLM tại gateway; con số 4096 tìm được ở tts_options là giới hạn khác, không liên quan chat.
- Schema chat chỉ có các field đã khai báo và `extra=forbid` (`app/api/schemas.py:11–18`), vì vậy client không thể tự thêm num_ctx/options để cấu hình context thông qua endpoint hiện tại.
- Prompt riêng cho style=dubbing ở `/v1/translations` không tham gia đường `/v1/chat/completions` của mẫu này. System/user messages của TediaPros được chuyển nguyên vẹn sang Ollama.

### Probe offline xác minh gateway

Đã chạy Python 3.14.7, dùng AST lấy nguyên các hàm `_message_text`, `_llm_estimate`, `_chat_completions`, `OllamaProvider._payload` từ snapshot repo; compile và gọi với dependency doubles. Không cài framework, khởi động app, gọi HTTP, load model hoặc GPU. Đây là kiểm chứng hàm với mocks, không phải E2E/FastAPI.

Kết quả:

```json
{
  "request_forwarding": {
    "options": {"temperature": 0.2, "num_predict": 2048},
    "messages_unchanged": true,
    "think": false,
    "num_ctx_present": false
  },
  "finish_reason_cases": [
    {"upstream_done_reason": "length", "gateway_finish_reason": "stop"},
    {"upstream_done_reason": "stop", "gateway_finish_reason": "stop"}
  ],
  "usage_in_both_fixture_cases": {
    "prompt_tokens": 3719,
    "completion_tokens": 377,
    "total_tokens": 4096
  }
}
```

Các số usage và done_reason đầu vào là fixture để kiểm tra truyền dữ liệu; không phải response raw đã thu từ Ollama live. Assertions cho cả hai trường hợp và request forwarding đều pass. Git status của snapshot server vẫn sạch.

### Phần chưa thể xác nhận chỉ từ repo

Context thực 4096 vẫn là INFERRED: phép tính 3719+377 khớp 4096 và gateway không đặt num_ctx, nhưng chưa có Ollama version, model options, context allocation hoặc raw done_reason của request thực. Tài liệu Ollama hiện tại mô tả context mặc định phụ thuộc VRAM và cho phép kiểm tra context đang cấp bằng `ollama ps` / `GET /api/ps` khi model đang loaded:

- https://docs.ollama.com/api/chat
- https://docs.ollama.com/context-length
- https://docs.ollama.com/api/ps

Snapshot repo mặc định keep_alive=0, nên kiểm tra `/api/ps` sau khi model đã unload có thể trả danh sách rỗng; kết quả rỗng không chứng minh context bằng 0.

Hướng sửa được đề xuất: chuyển đúng done_reason của Ollama qua gateway thành finish_reason; bảo vệ recovery/persist phía client khi response nghi bị cụt; cấu hình và công bố context thực để planner chừa input+output+margin. Không chỉ nâng max_tokens hoặc chỉ đổi prompt. Chưa sửa source server/client và chưa chạy test suite server (môi trường hiện tại thiếu dependencies framework); kết quả test TediaPros ở mục 6 là từ lượt review trước, không phải kiểm chứng server.
