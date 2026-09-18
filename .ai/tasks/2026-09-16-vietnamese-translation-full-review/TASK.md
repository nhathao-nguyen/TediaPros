# VI-DUB-REVIEW-20260916: Review tổng thể cải tiến dịch/lồng tiếng

- **Trạng thái:** Hoàn thành review; các findings chưa được sửa.
- **Người thực hiện:** Codex, một agent.
- **Thời gian:** 2026-09-16.

## 1. Mục tiêu

Đối chiếu toàn bộ cải tiến dịch/lồng tiếng trong session với specs, consumer thật và test. Ưu tiên sai nghĩa, duration/grouping, replay và long-context. User yêu cầu review, không triển khai fix trong lượt này.

## 2. Tiêu chuẩn nghiệm thu

- [x] Có FILE_INVENTORY và COVERAGE với phạm vi/giới hạn rõ.
- [x] Findings có call-site và probe tái hiện, phân biệt active/latent.
- [x] `npm.cmd run typecheck`: PASS, node/web exit 0.
- [x] 21 regression suites: 210 PASS, 0 fail, 0 skip.
- [x] 8 diagnostic probes tái hiện findings; không diễn giải PASS là sản phẩm đã đúng.
- [x] Không sửa source sản phẩm/dirty work có sẵn hoặc gọi dịch vụ sinh nội dung thật.

## 3. Phạm vi và giới hạn

**Trong phạm vi:** T01–T07 implementation, evaluator, T00–T13 traceability, AutoShort coordinator, Gateway/planner/semantic/TTS/recovery/checkpoint contracts và tests liên quan.

**Ngoài phạm vi:** fix code, các dirty changes font/thumbnail/Douyin/OCR không liên quan, live AI/TTS, toàn bộ corpus/benchmark tiếng Việt, package/install, commit/push.

## 4. Quyết định

- Review current working tree, không reset hoặc yêu cầu clean repo.
- Giữ probes riêng trong task evidence vì assertion của chúng chứng minh defect hiện hữu.
- F02/F08 gắn nhãn latent; không biến helper-only proof thành production claim.
- Đính chính claim bàn giao T07: journal được tạo trong job nhưng bị mất tại coordinator adapter.

## 5. Tệp thêm mới

Tất cả trong `.ai/tasks/2026-09-16-vietnamese-translation-full-review/`: `REVIEW.md`, `COVERAGE.md`, `FILE_INVENTORY.md`, `TASK.md`, `review-probes.ts`, `run-review-probes.mjs`, `run-regressions.mjs`, `write-inventory.mjs`, `probe-results.txt`, `regression-results.txt`.

Không sửa production source, không xóa file.

## 6. Kiểm chứng

```powershell
npm.cmd run typecheck
node .ai/tasks/2026-09-16-vietnamese-translation-full-review/run-regressions.mjs
node .ai/tasks/2026-09-16-vietnamese-translation-full-review/run-review-probes.mjs
node .ai/tasks/2026-09-16-vietnamese-translation-full-review/write-inventory.mjs
```

Typecheck PASS; regression 210/210; diagnostic 8/8 tái hiện. Harness mocks generation/audio; suite TTS dùng loopback fixture, không dịch vụ thật. Temporary folders riêng dưới Windows Temp chỉ chứa bundle/profile và synthetic checkpoint, không dữ liệu người dùng.

Chưa full runtime toàn repo, live provider/media, human quality benchmark hoặc installed build. Xem log và COVERAGE.

## 7. Bàn giao

Hai P1: source-repair thiếu semantic gate, Gateway internal units thiếu mapping. Sau đó sửa journal wiring + accepted-result retention cùng nhau, frozen group/budget, truncated output recovery, multiset quantified objects và checkpoint helper trước khi nối consumer.

Chỉ bắt đầu sửa khi user yêu cầu tiếp tục triển khai. Không coi toàn bộ roadmap đã hoàn tất chỉ vì helper/unit tests pass.
