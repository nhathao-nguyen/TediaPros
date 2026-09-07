# Dependency và IPC Hardening Qualification

- **Ngày:** 2026-09-07
- **Trạng thái:** review boundary đã ghi; chưa nâng Electron/toolchain trong nhánh tối ưu

## Quyết định

Giữ nguyên dependency versions trong `package.json` và `package-lock.json` của
nhánh hiện tại. Thay đổi hiệu năng AutoShort không được trộn với upgrade
Electron, Vite, builder hoặc native runtime; như vậy một regression có thể quy
đúng nguyên nhân và rollback về behavior đã kiểm chứng.

Trước một đợt upgrade riêng, cần ghi advisory/release notes từ nguồn chính
thức, chốt target version cụ thể, cài lockfile sạch và chạy typecheck, toàn bộ
local runtime, Python engines, subtitle/font smoke, build, package verifier và
fresh-install runtime probe. `npm audit fix --force` không phải quy trình được
chấp nhận.

## IPC và navigation boundary

Các thay đổi trong lượt này không mở raw IPC event mới. Progress được coalesce
ở renderer theo item và terminal event flush ngay; các trường stage/cache vẫn đi
qua type hiện có. Main tiếp tục là nơi kiểm tra path, output và process. Các
IPC AutoShort cho chọn file/folder, rescan nhạc, readiness, dependency install,
start/cancel/cache clear, STTN preview và Whisper model/process đều kiểm tra
sender origin; navigation/redirect của cửa sổ app cũng bị chặn nếu ra ngoài
origin packaged/dev được cấu hình. IPC của các tính năng khác và khả năng bật
preload sandbox toàn diện vẫn cần qualification riêng trên renderer/dev origin
và packaged app URL thật.

## Evidence

`npm.cmd run typecheck`, `npm.cmd run build` và
`node scripts/run-local-runtime-tests.mjs ipc-origin-validation.test
release-tooling.test local-runtime.test` đã pass trong worktree. Chưa có
dependency upgrade, package mới hoặc advisory disposition mới trong nhánh này;
vì vậy không có claim rằng Electron/runtime đã được harden toàn diện.
