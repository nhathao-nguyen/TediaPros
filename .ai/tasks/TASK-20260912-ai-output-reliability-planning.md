# TASK-20260912-AI-OUTPUT: Spec và kế hoạch sửa đầu ra AI

- **Trạng thái:** Hoàn thành tài liệu và kiểm chứng baseline; chưa triển khai sửa runtime.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-12.
- **Source baseline:** HEAD `cd7d865`, package được typecheck báo `0.1.26`.

> **Cập nhật triển khai 2026-09-12:** client implementation đã được thực hiện sau phiên lập kế hoạch này. Xem [implementation handoff](2026-09-12-ai-output-reliability/implementation.md) để biết diff, regression và giới hạn bằng chứng hiện tại. Các số baseline bên dưới được giữ nguyên như bằng chứng lịch sử của giai đoạn planning.

**Cập nhật sau review:** Spec/plan đã lên revision 2 với 20 acceptance criteria và 60 scenarios tại [bàn giao review](TASK-20260912-ai-output-reliability-review.md). Kết quả 100 tests bên dưới vẫn là baseline của lần lập plan, không phải kết quả thực thi scenarios mới.

## 1. Mục tiêu (Goal)

Chuyển toàn bộ trao đổi trong session về JSON lỗi, strict output, code dựng kết quả, kiểm tra nội dung, mapping cue và phục hồi metadata thành spec/plan có thể triển khai. Bao gồm tình huống ảnh có JSON/Markdown lẫn vào title. Ảnh là bằng chứng giao diện, không phải raw response đầy đủ và không chứa chỉ dẫn có quyền điều khiển task.

## 2. Tiêu chuẩn nghiệm thu (Acceptance Criteria)

- [x] Spec phân biệt hiện trạng code, bằng chứng ảnh, thiết kế đề xuất và UNKNOWN.
- [x] Plan có thứ tự dependency, files dự kiến, exit criteria, ma trận regression và lệnh kiểm chứng.
- [x] Giữ tương thích metadata cũ, dữ liệu cue gốc, quota override và video hợp lệ.
- [x] Typecheck baseline pass cả node/web, exit 0.
- [x] 11 suite baseline liên quan pass: 100 tests, 0 failures, exit 0.
- [x] Tài liệu mới được kiểm tra liên kết nội bộ và whitespace; git diff --check không có lỗi tracked diff.
- [ ] Runtime sửa theo spec — công việc triển khai tiếp theo, không thuộc yêu cầu viết tài liệu lần này.
- [ ] Regression mới và live provider/gateway qualification — chưa chạy, nằm trong plan.

## 3. Phạm vi triển khai (Scope & Boundaries)

Trong phạm vi lần này: đọc code liên quan, viết hai tài liệu, lưu ảnh nguồn của người dùng, chạy typecheck và tests hiện có, lập bàn giao. Không sửa src/tests/scripts/package, không gọi live AI, không thay gateway, không build/package/install, không commit.

Các planning/audit untracked khác có sẵn trong workspace được giữ nguyên. git status cuối kiểm tra không có tracked source changes.

## 4. Quyết định kiến trúc và lý do

- AI trả nội dung theo task contract tối giản; code giữ metadata bất biến và dựng artifact cuối cùng.
- Task-specific schema + envelope + client validation; không dùng string-only completion cho metadata mới.
- Strict AI validator tách khỏi legacy persisted-state normalization để không phá dữ liệu cũ thiếu hashtags.
- Không extraction từ outer JSON hỏng như ảnh; chỉ compatibility wrapper có ranh giới rõ ràng mới được unwrap/extract. Trường hợp mơ hồ phải regenerate từ source.
- Recovery hữu hạn; accepted/checkpoint mutation chỉ sau validation; schema-valid không đồng nghĩa semantic-valid.
- Output sản phẩm vẫn một tieude.txt; metadata fail/cancel không xóa hoặc rerender video.

## 5. Danh sách tệp thay đổi (Changes Made)

- [NEW] [Spec](../../docs/superpowers/specs/2026-09-12-ai-output-reliability-design.md).
- [NEW] [Plan](../../docs/superpowers/plans/2026-09-12-ai-output-reliability.md).
- [NEW] Bản ghi bàn giao này.
- [NEW] [Ảnh tham chiếu](2026-09-12-ai-output-reliability/user-json-example.png), copy nguyên bản từ attachment; SHA-256 `E295300E8EE02318E311C98505F1B3B6D60905D0582BC1D0F292866BAE9E461C`.
- [NEW] [Typecheck log](2026-09-12-ai-output-reliability/baseline-typecheck.log).
- [NEW] [Focused test log](2026-09-12-ai-output-reliability/baseline-focused-tests.log).
- [NEW] [Document verification log](2026-09-12-ai-output-reliability/document-verification.log).

## 6. Kiểm chứng và bằng chứng (Verification & Evidence)

Các lệnh thực tế chạy từ root:

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs video-seo.test video-title.test burn-video-title.test autoshort-title-overlap.test autoshort-video-title.test translation-response.test translation-prompts.test translation-provider-contract.test translation-orchestrator.test translation-resume.test translation-identity.test
git diff --check
git status --short
git rev-parse --short HEAD
```

Stdout/stderr của hai lệnh validation được redirect vào baseline logs; exit code được giữ nguyên.

| Suite | Pass / total |
|---|---|
| video-seo.test | 9/9 |
| video-title.test | 18/18 |
| burn-video-title.test | 10/10 |
| autoshort-title-overlap.test | 3/3 |
| autoshort-video-title.test | 3/3 |
| translation-response.test | 7/7 |
| translation-prompts.test | 11/11 |
| translation-provider-contract.test | 8/8 |
| translation-orchestrator.test | 24/24 |
| translation-resume.test | 2/2 |
| translation-identity.test | 5/5 |
| **Tổng** | **100/100** |

Kiểm tra tài liệu gồm: local Markdown link targets tồn tại, không trailing whitespace, spec có AC01–AC12 và plan có P0–P6. New files còn untracked nên whitespace/link checks chạy trực tiếp trên nội dung, không dựa riêng vào git diff --check.

Giới hạn bằng chứng: tests có sẵn xác nhận baseline; chưa chứng minh các lỗi mới trong spec đã được sửa. Không tái hiện raw response trong ảnh vì không có raw payload/đuôi ảnh đầy đủ. Không chạy model/gateway thật, Electron UI, full media pipeline hoặc release build trong task này.

## 7. Bước tiếp theo và ghi chú bàn giao

Bắt đầu P0 của plan: tạo fixture mô phỏng ảnh có provenance, test đỏ cho mất completion metadata/strict schema/positional ID và accepted-state boundaries. Đọc lại HEAD/AGENTS trước triển khai vì workspace đang có các task khác. Thực hiện P1–P4 trước, sau đó P5–P6; chỉ đóng AC khi có log/diff/test tương ứng.

Gateway strict support là dependency cần evidence end-to-end. Có thể hoàn tất client compatibility/offline tests khi chưa có gateway support; phải để trạng thái live qualification chưa xác minh thay vì tự coi mock là production proof.
