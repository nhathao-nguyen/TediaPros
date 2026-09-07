# AUTOSHORT-OPT-PLAN: Kế hoạch cải thiện toàn diện

- **Trạng thái:** Hoàn thành planning; 23 task triển khai chưa thực hiện.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-07

## 1. Mục Tiêu

Chuyển review hệ thống và khảo sát Auto Short thành kế hoạch tối ưu tốc độ, hiệu năng và chất lượng có phụ thuộc, acceptance và rollback.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] Có thiết kế, master và bốn gói chứa 23 task.
- [x] Bao phủ R1–R9 và các đề xuất stream/prefetch/overlap/cache/title/worker/server/GUI/quality/release.
- [x] Phân biệt tối ưu tương đương, sửa quality có chủ đích và nhánh chưa qualification.
- [x] Typecheck node/web pass trong lượt planning.
- [x] Tự rà coverage, dependency, liên kết tài liệu và interface cache dùng giữa các gói.

## 3. Phạm Vi

Chỉ tạo tài liệu kế hoạch. Không sửa source/config/dependency, không benchmark live, không build/cài runtime mới, không commit/push hoặc publish. Giữ tệp untracked từ trước.

## 4. Quyết Định

Sửa tính đúng và lifecycle trước tăng concurrency. Một item cho các tối ưu đầu; stream-full và prefetch opt-in trước default. Cache có quota/pin/integrity, server/worker phải qua qualification. Release gate bao gồm toàn bộ tính năng thực sự được đưa vào bản cài.

## 5. Tệp Tạo

- [Thiết kế](F:/Son/tool/TediaPros/docs/superpowers/specs/2026-09-07-autoshort-optimization-design.md)
- [Master plan](F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-07-autoshort-optimization-master.md)
- [Gói A](F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-07-autoshort-a-foundation.md)
- [Gói B](F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-07-autoshort-b-latency.md)
- [Gói C](F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-07-autoshort-c-reuse.md)
- [Gói D](F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-07-autoshort-d-quality-release.md)
- Bản ghi bàn giao này.

## 6. Kiểm Chứng

`npm.cmd run typecheck`: exit 0, node/web PASS. `git diff --check`: PASS; không có tracked source diff. Kiểm tra liên kết local trong sáu tài liệu chính: không thiếu. Đếm gói A/B/C/D: 7/4/5/7 task, tổng23. Không chạy lại suite runtime vì chỉ thêm planning; kết quả kiểm thử các lượt review trước được ghi rõ là evidence trước đó.

## 7. Bàn Giao

Bắt đầu bằng T01 đo baseline và các sửa lỗi T02/T03/T04/T07; T05/T06 theo dependency. Đọc spec cùng task tương ứng. Khi thực thi mới tạo branch/worktree cô lập theo hướng dẫn áp dụng, cập nhật status từng task bằng evidence thật. Không dùng tài liệu này để suy diễn quyền thay server, tải lớn hoặc phát hành.
