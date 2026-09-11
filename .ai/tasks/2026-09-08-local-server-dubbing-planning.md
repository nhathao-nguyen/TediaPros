# TASK-20260908: Review chat Gemini và planning cải thiện local-server dubbing

- **Trạng thái:** Hoàn thành review và planning; chưa implement.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-08

## 1. Mục tiêu

Đọc chat Gemini người dùng cung cấp, xác minh các đề xuất đáng áp dụng qua nguồn gốc/code repo, đối chiếu working tree TediaPros và lập kế hoạch cải thiện giữ local server hiện tại.

## 2. Tiêu chuẩn nghiệm thu

- [x] Đọc đủ 8 lượt hỏi/đáp; ghi hạn chế đọc công thức render.
- [x] Phân biệt đề xuất phù hợp, cần sửa, không áp dụng; có nguồn code cụ thể.
- [x] Revalidate chính sách tempo 1.80x, quota tổng tắt, repair đã nối runtime, extension 40% hiện có.
- [x] Người dùng chọn giữ khả năng kéo dài video, ưu tiên giảm nhu cầu sử dụng.
- [x] Kế hoạch có phạm vi, dependencies, file, tests, migration/checkpoint, benchmark và rollout.
- [x] Typecheck baseline pass.
- [x] Tests baseline liên quan chạy và báo đúng pass/skip.

## 3. Phạm vi

Trong phạm vi: đọc chat và nguồn công khai, rà code liên quan, thêm tài liệu review/planning/handoff.

Ngoài phạm vi: implementation, deploy/cài model, đổi tempo/quota/retiming, benchmark TTS server thật và lip-sync. Không chỉnh các file runtime hay thay đổi có sẵn.

## 4. Quyết định

Không lấy bộ đếm âm tiết trong chat làm chuẩn; gợi ý độ dài theo voice được kiểm chứng và đo WAV là hướng phù hợp. Giữ source ledger, chi tiết nghĩa và fallback hiện tại. Không sao chép nhánh cắt đuôi audio ở repo tham khảo. Kết luận lượt trước về repair chưa được nối runtime đã lỗi thời; code hiện tại và tests xác nhận đường repair riêng đã tồn tại.

## 5. Tệp thêm

- [Review](../../docs/reviews/2026-09-08-gemini-dubbing-assessment.md)
- [Planning P0–P6](../../docs/superpowers/plans/2026-09-08-local-server-dubbing-improvements.md)
- Handoff này.

## 6. Kiểm chứng

Lệnh đã chạy từ repo root:

```powershell
cmd.exe /c "npm run typecheck"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs translation-prompts.test translation-budget.test translation-orchestrator.test dubbing-retime.test"
```

- Typecheck node + web: PASS, exit 0.
- translation-prompts: 7 pass.
- translation-budget: 9 pass; bao gồm default quota tắt và bounded compatibility.
- translation-orchestrator: 14 pass; gồm prompt repair, partial recovery và no-progress.
- dubbing-retime: 1 SKIP, không có real FFmpeg acceptance trong lần chạy này.
- Tổng lần chạy này: 30 pass, 1 skip, 0 fail. Đây là baseline của working tree hiện tại, không chứng minh các tính năng PLANNED đã tồn tại.
- Chưa chạy full runtime/build vì chỉ thêm tài liệu. Chưa probe server thật hoặc đo chất lượng nghe.

## 7. Bàn giao

Bắt đầu P0/P1; xác định server capability bằng dữ liệu thật trước structured output. P2 bổ sung context/glossary, P4 hiệu chuẩn duration feature/profile, P5 gate semantic candidate. Không bật lại quota tổng hoặc loại bỏ extension theo đề xuất trong chat. Repo đang dirty với nhiều công việc có trước; không reset, overwrite hay stage toàn bộ.
