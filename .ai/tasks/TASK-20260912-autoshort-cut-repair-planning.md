# TASK-20260912-AUTOSHORT-CUT-REPAIR-PLANNING: Kế hoạch sửa toàn bộ Cắt đoạn

- **Trạng thái:** Hoàn thành planning; implementation chưa bắt đầu.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-12.
- **Baseline:** `0d7fa21b911f1eb540140999f5c51dead6141c78`; giữ nguyên dirty work của overlay/performance/batch.

## 1. Mục Tiêu

Chuyển review 12 findings thành kế hoạch sửa có thể triển khai, bao gồm các yêu cầu Core từng bị bỏ sót. Giữ cắt trong AutoShort, ưu tiên lỗi gây sai output/resume và UI mất preview; không thu nhỏ thành MVP khác specs.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] Có master plan, ba subplan và spec bổ sung chốt schema/interfaces/UX/migration.
- [x] Mapping 12/12 findings → tasks → bằng chứng đóng.
- [x] Mapping R01–R18 Core → tasks; hold/suggestions giữ ngoài repair theo đợt gốc.
- [x] 16 tasks có dependencies, file/module, interface, regression/red-green, gate và bàn giao.
- [x] Có rollout/rollback, phân biệt no-cut legacy / timestamp-cut legacy / v2.
- [x] `npm.cmd run typecheck`: Node/Web PASS, exit 0 trên working tree khi lập kế hoạch.
- [x] Kiểm link nội bộ, code fences, whitespace, task IDs và coverage; không đánh dấu implementation đã pass.

## 3. Phạm Vi

- Trong phạm vi: đọc review/spec/code cần cho planning; viết tài liệu và kiểm tính nhất quán.
- Ngoài phạm vi: sửa source, chạy media/provider/GUI tests, tạo worktree/commit/merge/push, cài app, dọn dirty files của task khác.
- Các test commands và module mới trong plan là yêu cầu triển khai, không phải tests đã tồn tại hoặc đã chạy.

## 4. Quyết Định và Lý Do

- Schema đầy đủ dùng v2 vì timestamp-only v1 đã tồn tại; không đổi ý nghĩa v1 tại chỗ.
- Giữ lịch sử raw, draft/applied edit và immutable run snapshot riêng; sửa resumed item tạo new run, giữ output/receipt cũ.
- Frame/index/rational/sample schedule chung; preparation semantic key không dựa trên bytes Matroska ngẫu nhiên.
- UI scoped AutoShort, giữ video/transport quan sát được; exact join preview dùng cùng production executor.
- Segment provenance đi qua OCR/ASR/STTN/TTS và final publication; semantic review không được giả là đã chứng minh bằng unit tests.
- P00 giữ cut execution guard cho tới Z01; no-cut vẫn hoạt động. Đây là task tương lai trong plan, chưa bật/tắt capability của app hiện tại.

## 5. Tệp Thay Đổi

- `[NEW]` [Master plan](F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-12-autoshort-cut-repair.md).
- `[NEW]` [A — Editor/recovery](F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-12-autoshort-cut-repair-a-editor-recovery.md).
- `[NEW]` [B — Media](F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-12-autoshort-cut-repair-b-media.md).
- `[NEW]` [C — Pipeline](F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-12-autoshort-cut-repair-c-pipeline.md).
- `[NEW]` [Repair spec](F:/Son/tool/TediaPros/docs/superpowers/specs/2026-09-12-autoshort-cut-repair-design.md).
- `[NEW]` Task record này; typecheck log và document validation evidence dưới `.ai/tasks/2026-09-12-autoshort-cut-repair-planning/`.
- Không sửa spec/review lịch sử hoặc production source.

## 6. Kiểm Chứng

Lệnh thực tế: `npm.cmd run typecheck`; kiểm Git status/HEAD và source call sites; validator tài liệu kiểm links/task coverage/fences/whitespace. Node/Web typecheck PASS, không lỗi.

Self-review đã sửa: initial probe không còn đòi source digest chưa biết; schema v2 phân biệt timestamp v1; task Z01 không trùng mã requirement R01; publication tách retained cues ở edited time khỏi final cues/words ở output time; file artifact writer dùng `preserveAutoShortArtifacts` thực tế trong `autoshort.ts`.

Không chạy lại unit/media/UI suites vì chỉ thay tài liệu. Bằng chứng review trước được tham chiếu như lịch sử; không dùng nó để đóng bất kỳ task sửa lỗi nào.

## 7. Bàn Giao

Triển khai theo P00 → A01 → A02 → A03 → B01 → B02 → B03 → B04 → A04 → A05 → C01 → C02 → C03 → C04 → C05 → Z01. Trước khi viết code, kiểm current HEAD/dirty work và đưa tài liệu/evidence cần thiết vào worktree riêng bằng allowlist đã hash.

Mỗi task chỉ commit sau regression, scoped tests/typecheck và review evidence. Chỉ báo repair Core hoàn tất khi 12 findings và 18 Core requirements có bằng chứng đạt; Windows runtime/GUI, installed build, macOS và live provider có gates riêng, phần thiếu ghi NOT_VERIFIED.
