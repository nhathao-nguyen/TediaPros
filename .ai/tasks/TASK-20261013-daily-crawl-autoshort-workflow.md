# TASK-20261013-DAILY-CRAWL-AUTOSHORT-WORKFLOW: Cào bài/chapter và AutoShort theo ngày

- **Trạng thái:** Đã triển khai và kiểm chứng local; chờ nghiệm thu Facebook/provider thật.
- **Người thực hiện:** Antigravity / ENI (triển khai ban đầu), Codex (review và sửa lỗi).
- **Thời gian:** 2026-10-13

## 1. Mục Tiêu (Goal)

Phát hiện Reel mới, tải MP4, lưu caption, thu thập bài/chapter được xác minh và chuyển MP4 vào AutoShort theo cấu hình hiện tại. Dữ liệu nằm dưới `[Kênh]/YYYY-MM-DD/` với ngày cào thực tế theo giờ Việt Nam. Trạng thái từng bước được giữ để retry và khôi phục sau gián đoạn.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Folder ngày và các file dùng containment guard; ghi JSON/TXT/XLSX nguyên tử.
- [x] Caption và Excel được xuất cả khi tắt article/render; bảng cùng ngày giữ các Reel đã xuất từ lượt trước.
- [x] Chapter cùng truyện có số chương thật, TXT riêng và trạng thái complete/partial + stopReason.
- [x] Batch AutoShort ghi đúng done/error/cancelled và output receipt; hủy đúng job, chờ pipeline kết thúc.
- [x] Danh sách thông báo 100 video không giới hạn công việc; chia batch tối đa 500.
- [x] Ledger phục hồi các stage chưa xong mà không tải lại MP4; đối soát biên nhận core sau crash trước khi render lại.
- [x] Snapshot đồng bộ khi chỉnh toggle, không cần chạy tay; lựa chọn tắt giữ nguyên sau chuyển tab. Thiếu/sai/lỗi lưu snapshot chặn render.
- [x] Typecheck node/web và build thành công; regression local và hidden Electron UI smoke pass.
- [x] Native FFmpeg integration pass với real mask writer và burnAutoShort, không còn skip fixture.
- [ ] Nghiệm thu một kênh Facebook thật, truyện có tổng chương đã biết và provider ASR/dịch/TTS thật qua workflow đầy đủ.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

Workflow monitor, cấu hình và typed preload IPC; xuất bài/chapter/Excel, trạng thái và phục hồi từng stage; shared config validator và UI AutoShort. Không sửa thuật toán dubbing, Planar RGB, licensing hoặc các thay đổi hiệu ứng video đang có trong worktree.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

Xem [ADR 016](../../docs/adr/016-durable-daily-reels-workflow.md).

- Lịch claim vẫn một lượt mỗi ngày; folder dùng ngày cào thực tế. Restart không tự replay claim trong ngày; manual check hoặc lượt hẹn kế tiếp xử lý pending.
- Ledger `[Kênh]/.reels-workflow.json` tách khỏi download history và notice cap. ID/account digest gắn công việc; giữ day/stem và path ổn định. Không lưu cookie/key.
- JSON/TXT/XLSX temp + rename, guard cả leaf và parent; file symlink hoặc directory không được ghi đè.
- Snapshot Main dùng envelope v1 hoặc đọc legacy JSON, runtime validate bằng shared contract. Invalid edits được ghi thành snapshot bị chặn; lỗi ghi cũng chặn việc dùng snapshot cũ trong phiên hiện tại.
- AutoShort dùng cùng builder với chạy tay, giữ per-video output/audit dưới autoshort và ghi path thật; không ép MP4 thành layout phẳng.
- Kênh mới mặc định bật article/render. Kênh cũ giữ lựa chọn đã lưu và false cho render flag cũ chưa tồn tại.
- Cào chapter theo định danh URL truyện và liên kết tuần tự; bỏ chọn chapter bằng suy đoán category/AI. Lỗi/gap/link mơ hồ/trùng nội dung/bắt đầu sau chương 1/25 trang/60 giây được báo partial.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/main/facebookReelsDailyWorkflow.ts`: điều phối stage và retry.
- `[NEW]` `src/main/reelsWorkflowStore.ts`: ledger, folder và workbook cả ngày; shared atomic writer.
- `[NEW]` `src/main/reelsAutoShortRunner.ts`: hủy job được sở hữu, kết quả và callback lưu receipt.
- `[NEW/MODIFY]` `src/main/autoShortWorkflowConfig.ts`: serialize/validate/persist snapshot, không tự bật cấu hình mặc định.
- `[MODIFY]` `src/main/facebookReelsMonitor.ts`, `facebookReelsMonitorRuntime.ts`, `facebookReelsMonitorStore.ts`: nối workflow, lấy caption/link bình luận tác giả bằng detail browser, phục hồi core receipts, số đếm chính xác.
- `[MODIFY]` `src/main/facebookArticle.ts`, `facebookReelsExporter.ts`: chapter identity/completion, số chương, trạng thái partial và xuất nguyên tử.
- `[MODIFY]` `src/shared/autoShortContract.ts`, `facebookReelsMonitor.ts`: reuse config validator, kết quả monitor typed.
- `[MODIFY]` `src/main/index.ts`, `src/preload/index.ts`: trả lỗi lưu thật, typed config/guidance error IPC.
- `[MODIFY]` `src/renderer/src/components/AutoShort.tsx`, `FacebookReelsLibrary.tsx`: builder chung, auto-sync, persist vùng/toggle, defaults và thông báo lỗi.
- `[NEW]` `tests/reels-daily-workflow.test.ts`, `scripts/smoke-reels-workflow-config-ui.mjs`; đăng ký test trong runner.
- `[NEW/MODIFY]` ADR 016, `docs/facebook-reels-monitor.md` và task này.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Các lệnh chạy từ repository root:

```powershell
npm.cmd run typecheck
npm.cmd run build
node scripts/run-local-runtime-tests.mjs reels-daily-workflow.test facebook-reels-monitor.test facebook-reels-export.test facebook-reels-lifecycle.test facebook-reel-details.test facebook-reels-library.test autoshort-ocr-contract.test
$env:TEDIAPROS_TEST_FFMPEG = (Get-Command ffmpeg).Source
node scripts/run-local-runtime-tests.mjs autoshort-ocr-pipeline.test
node scripts/smoke-reels-workflow-config-ui.mjs
```

Kết quả: typecheck/build exit 0; 91 regression tests + 12 native pipeline tests pass, 0 fail, 0 skip. Regression workflow mới có 15 ca, bao gồm hơn 100 Reel, mixed results, retry, restart, Excel lỗi/merge, caption khi tắt article, snapshot lỗi/legacy, cancelAndWait và chapter partial. FFmpeg fixture dùng binary WinGet có sẵn; ASR/OCR/provider trong integration vẫn là fixture, không phải provider acceptance.

Bằng chứng trong [2026-10-13-daily-workflow-proof](2026-10-13-daily-workflow-proof/): `regression.log`, `native-pipeline.log`, `typecheck.log`, `build.log`, `config-ui-proof.json`, `config-ui.png`. UI proof: 0 job start, ba toggle false/none sau remount, không có renderer error.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Thử live một kênh/tài khoản được phép trong ứng dụng chạy code mới; xác nhận số chapter, output MP4/FFprobe/decode, cancel và restart/retry. Local tests/UI/native FFmpeg không chứng minh Facebook hoặc provider thật.
- Chưa build installer/cập nhật ứng dụng đã cài, commit, push hoặc release trong task này.
- Ledger giới hạn 10.000 mục/32 MB; đổi thư mục kênh không tự di chuyển ledger. Downloads trước khi có ledger không được tự suy đoán receipt cho các stage đã chạy.
- Preset riêng theo watch và nhạc gán theo ID video thủ công chưa hỗ trợ; báo lỗi rõ. Nhạc một bài/ngẫu nhiên được remap sang video mới.
- Bài/chapter là artifact export. AutoShort vẫn lấy audio/OCR từ MP4, không dùng nội dung truyện làm đầu vào narration.
