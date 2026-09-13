# TASK-20260912: Tích hợp Edge-TTS an toàn vào Voice và AutoShort

- **Trạng thái:** Đã triển khai và kiểm chứng tự động; chờ nghiệm thu tương tác
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-12

## 1. Mục Tiêu

Hoàn thiện Edge-TTS vừa merge từ branch `fix/workflow-capcut-youtube`, giữ tương thích Local, dùng lại timing/cache/resume của AutoShort và loại bỏ các trạng thái sẵn sàng giả, lưu sai định dạng hoặc hủy tác vụ không đóng socket.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] Provider thiếu vẫn là Local; Edge voice tách khỏi Local voice.
- [x] Edge transport có deadline, abort/dispose, giới hạn text/audio, SSML escaping và cleanup cả scratch/final khi hủy.
- [x] Voice catalog IPC phân biệt live/fallback; MIME kết quả quyết định preview/history/save.
- [x] AutoShort preflight xác nhận catalog và synthesis WebSocket live; cache key gồm provider version/voice; MP3 được full-decode thành PCM WAV trước cache; synthesis provider ở 1x.
- [x] Typecheck, build, full local-runtime, live adapter smoke và đóng gói Windows pass.
- [x] Review hardening: đóng race cache rollback, chặn ghi đè đường dẫn đổi đuôi, hỗ trợ preflight `auto`, mở chọn ngôn ngữ Edge ở Voice và hủy catalog/WebSocket an toàn.

## 3. Phạm Vi Triển Khai

- **Trong phạm vi:** shared contract, Edge adapter, typed IPC, Voice/AutoShort UI, AutoShort validation/cache/preflight, tests và docs.
- **Ngoài phạm vi:** phát hành installer, qualification macOS ARM64, đổi chính sách tempo 1.80x.

## 4. Quyết Định Kiến Trúc

- Local là runtime default và config Local từ UI bỏ field provider để không đổi identity legacy.
- Catalog fallback chỉ là dữ liệu UI; preflight batch cần catalog live và synthesis WebSocket probe.
- `msedge-tts` được ghim `2.0.7`; cache namespace gắn version adapter.
- Voice giữ MP3 sau full decode/probe; AutoShort normalize PCM WAV trước khi cache publish.
- Catalog single-flight theo dõi từng waiter: hủy caller cuối mới abort HTTP; WebSocket ngừng nhận frame trước khi stream state bị hủy.

## 5. Danh Sách Tệp Thay Đổi

- `[NEW] src/shared/edgeTtsContract.ts`, `src/shared/ttsAudioFormat.ts`
- `[NEW] src/main/edgeTtsTransport.ts`, `src/main/edgeTtsIdentity.ts`
- `[MODIFY] src/main/edgeTts.ts`, `src/main/tts.ts`, `src/main/autoshort.ts`, typed IPC và hai UI.
- `[NEW] tests/edge-tts-contract.test.ts`, `tests/edge-tts-adapter.test.ts`, `tests/tts-audio-format.test.ts`, `tests/autoshort-edge-tts.test.ts`.
- `[NEW] docs/edge-tts.md` và evidence task.

## 6. Kiểm Chứng & Bằng Chứng

- `npm.cmd run fonts:prepare && npm.cmd run fonts:verify`: PASS, 4 font / 12.90 MiB.
- `npm.cmd run typecheck`: PASS, 0 lỗi.
- `npm.cmd run build`: PASS.
- `npm.cmd run test:local-runtime`: PASS sau khi chuẩn bị font, exit 0.
- Edge suites mới và regression liên quan kiểm tra locale, preflight `auto`, open/stream/decode/publish cancellation, catalog timeout/shared-waiter abort, WebSocket quiesce, MIME/header, chống ghi đè save, PCM cache rollback/resume, dynamic capability và origin gate IPC.
- Live Windows adapter smoke: catalog live 322 voice; `vi`, `en`, `es`, `ja` đều tổng hợp qua WebSocket, full-decode bằng managed FFmpeg và trả duration dương từ managed FFprobe. Xem `2026-09-12-edge-tts-integration/live-smoke.json`.
- Review cancellation gate: không còn finding Critical/Important; probe cache 100 lần trả 100 lỗi hủy và giữ lại 0 file cache.
- Windows package gate: NSIS `TediaPros-0.1.26-setup.exe` được tạo; packaged font verification và prohibited-runtime scan đều PASS.

### Giới hạn còn lại

- Chưa chạy live smoke và packaged installer trên macOS ARM64.
- Chưa chạy nghiệm thu tương tác Voice UI hoặc ma trận AutoShort live bằng video thật; các hành vi đó không được suy ra từ typecheck/unit test.
- `npm.cmd run release:verify`: PASS sau khi bổ sung release notes `v0.1.26`, sửa gate metadata đã chặn workflow `main` trước bước typecheck.
- `npm install` báo 14 vulnerability từ dependency tree hiện có; task không chạy auto-fix vì có thể tạo breaking changes ngoài phạm vi.

## 7. Bàn Giao

- Branch triển khai: `codex/integrate-edge-tts`, base `42f92a5da88ed407fd320686e1acc1c765f044c5`.
- Checkout chính và 8 MP4 benchmark local không bị thay đổi.
