# Facebook Reels Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. The user authorized execution in the existing session with “Triển khai”.

**Goal:** Quét profile/fanpage Reels có tiến trình, kết quả một phần trung thực và tiêu đề gắn đúng ID.
**Architecture:** Giữ Electron và downloader hiện có. Tách URL/contract, parser có định danh, observer CDP, crawl controller và checkpoint; nối IPC typed vào Downloader.
**Tech Stack:** Electron 34.5.8, TypeScript, React, node:test, CDP Network.
**Spec:** `docs/facebook-reels-improvement-plan.md`.

## Global Constraints

- Giữ nguyên LICENSE/NOTICE và các thay đổi ngoài phạm vi.
- Cookie/proxy theo job; guest session sạch; không lưu cookie/token/raw request vào checkpoint.
- Không replay/hardcode doc_id; DOM đứng yên không chứng minh complete.
- Caption không bị cắt để vừa UI; metadata phải khớp Reel ID.
- IPC có kiểu, kiểm tra origin và quyền sở hữu job; checkpoint trong app userData, kiểm tra containment.
- Kiểm chứng Facebook live cần nguồn đối chứng; thiếu nguồn thì báo chưa xác minh live.

## Review Focus

- Recommendation có caption dài hơn không được thay caption của Reel mục tiêu.
- Payload has_next_page=false thuộc connection khác không được kết thúc crawl.
- Hủy khi loadURL/lấy body/metadata phải trả phần đã có và dọn tài nguyên.
- Tiếp tục nguồn khác hoặc context cookie/proxy khác không dùng nhầm checkpoint.
- UI nhận terminal/error phải xóa trạng thái busy và listener khi unmount.

### Task 1: URL, contract và dữ liệu theo ID

**Files:** `src/shared/facebookReels.ts`, `src/shared/types.ts`, `src/main/facebookReelsParser.ts`, `tests/facebook-reels-crawler.test.ts`, `tests/facebook-reels-parser.test.ts`, test runner.
**Interfaces:** `facebookReelsSource(url)` trả source canonical hoặc null; `parseFacebookReelsPayload(raw, source)` trả metadata theo ID và connection evidence có scope; `mergeFacebookReel` ưu tiên metadata đã xác minh.

- [x] Viết/run test URL giả mạo, profile chưa có tab, single/group/post; EXPECT FAIL với code hiện tại.
- [x] Viết/run parser tests caption nhiều ID, prefix/NDJSON, connection sai scope; EXPECT FAIL khi parser chưa có.
- [x] Implement helper thuần, contract optional tương thích ngược và parser giới hạn input/depth.
- [x] Run hai suite; EXPECT PASS.

### Task 2: Observer và crawl lifecycle

**Files:** `src/main/facebookReelsNetwork.ts`, `src/main/facebookReelsController.ts`, `src/main/facebookReels.ts`, `tests/facebook-reels-lifecycle.test.ts`.
**Interfaces:** observer nhận debugger/session page boundary; controller nhận `readPage/scroll/networkSnapshot/signal/onProgress`; result là PlaylistProbe có crawl summary.

- [x] Test >250 ID, loading chậm, duplicate, end đúng/sai scope, cap, cancellation, guest/proxy isolation; EXPECT FAIL.
- [x] Implement condition waiting/deadline, fresh session, network observer trước navigation và cleanup.
- [x] Run crawler/lifecycle/parser suites; EXPECT PASS.

### Task 3: Checkpoint, metadata và IPC

**Files:** `src/main/facebookReelsStore.ts`, `src/main/facebookReelsJobs.ts`, `src/main/ytdlp.ts`, `src/main/index.ts`, `src/preload/index.ts`, checkpoint/job tests.
**Interfaces:** job start/cancel theo owner; resume đọc checkpoint theo source/context; metadata nhận IDs đã có trong job, xác minh info.id, dùng signal.

- [x] Test sai owner, checkpoint khác context/path, malformed checkpoint, metadata sai ID, abort; EXPECT FAIL.
- [x] Implement bounded checkpoint atomic với containment và job registry; metadata resolver serial có cancel; IPC origin guard.
- [x] Run relevant suites và typecheck; EXPECT PASS.

### Task 4: Downloader flow

**Files:** `src/renderer/src/components/Downloader.tsx`, `src/renderer/src/lib/facebookReels.ts`, `src/renderer/src/styles/facebookReels.css`, UI state tests.
**Interfaces:** progress theo job; selection entries giữ caption/status; continue dùng checkpoint ID từ main; enrich selected chỉ thay entry cùng ID.

- [x] Test reducer/helper merge không mất checked/title của ID khác và terminal summary; EXPECT FAIL.
- [x] Implement FB branch, tiến trình/dừng, quét N/đến hết, partial/continue và lấy tiêu đề còn thiếu.
- [x] Run focused tests + typecheck; EXPECT PASS.

### Task 5: Verification, review và tài liệu

**Files:** architecture/domain/ADR crawler, task handoff.

- [x] Run full local-runtime suite, build và typecheck; ghi mọi failure, đối chiếu baseline.
- [x] Review toàn bộ diff bằng reviewer độc lập theo executing-plans; sửa finding quan trọng có regression test.
- [x] Kiểm tra live nếu có link đối chứng; không suy ra complete khi chỉ có dữ liệu DOM.
- [x] Cập nhật tài liệu và handoff, ghi các giới hạn thực tế; không package/install nếu người dùng chưa yêu cầu.
