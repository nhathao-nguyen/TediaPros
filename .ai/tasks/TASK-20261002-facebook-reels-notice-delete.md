# TASK-20261002-facebook-reels-notice-delete: Xóa thông báo Reels

- **Trạng thái:** Đã kiểm chứng local
- **Người thực hiện:** Codex
- **Thời gian:** 2026-10-02

## 1. Mục Tiêu

Thêm xóa từng thông báo và xóa tất cả theo yêu cầu người dùng, giữ video và trạng thái theo dõi/chống trùng.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] Nút Xóa trên từng thông báo và Xóa tất cả trong panel.
- [x] Giữ thông báo running; không cản progress/finalization.
- [x] Xóa lưu bền qua restart, không reset claim ngày hoặc lịch sử video.
- [x] Typed IPC, trusted sender và validation bounded IDs.
- [x] Typecheck, tests liên quan và build pass.

## 3. Phạm Vi

Chỉ thay đổi xóa thông báo; giới hạn giữ 100 thông báo và cơ chế theo dõi giữ nguyên. Không xóa thông báo thật của người dùng trong quá trình kiểm tra; UI dùng fixture synthetic.

## 4. Quyết Định

Xóa theo snapshot IDs (tối đa 100), nên thông báo xuất hiện đồng thời được giữ lại. Store từ chối toàn bộ request nếu chứa ID đang running. Claim ngày nằm trên watch; lịch sử video ở library riêng. Không cần migration store.

## 5. Tệp Thay Đổi

- `src/main/facebookReelsMonitorStore.ts`, `facebookReelsMonitor.ts`, `index.ts`: serialized delete và IPC guarded.
- `src/preload/index.ts`: typed delete API.
- `src/renderer/src/components/ReelsNotifications.tsx`: nút xóa và giữ running, khóa nút khi đang xóa.
- `src/renderer/src/styles/reelsNotifications.css`: CSS thông báo riêng, không phụ thuộc stylesheet thư viện kênh; giới hạn chiều cao và cuộn nội dung dài.
- `tests/facebook-reels-monitor.test.ts`, `tests/fixtures/facebook-reels-ui.tsx`: regression và preview.
- `docs/facebook-reels-monitor.md`: hướng dẫn và retention.

## 6. Kiểm Chứng

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs facebook-reels-monitor.test
npm.cmd run build
```

- Typecheck: PASS node/web.
- Tests: 16 pass, 0 fail, gồm 3 regression mới về persistence/history/claims, active concurrent notice và invalid payload/idempotence.
- Build: PASS.
- UI synthetic 1298×807: xóa một thông báo và xóa tất cả → danh sách trống, badge biến mất. Screenshot nút mới: `.ai/qa/facebook-reels-library/delete-notices.png`.
- UI 1298×500 mở danh sách video: overflowY=auto, clientHeight=358, scrollHeight=425; xác nhận cuộn khi dài. Reset viewport sau QA.

## 7. Bàn Giao

Chưa package/install. Mở lại bản app dùng preload/Main đã build để nạp IPC mới. Xóa thông báo không tự chạy lại kênh trong ngày đó; kiểm tra ngay là thao tác riêng.
