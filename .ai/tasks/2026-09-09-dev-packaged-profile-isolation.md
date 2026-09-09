# APP-PROFILE-ISOLATION-20260909: Tách profile dev và Windows local

- **Trạng thái:** Đã kiểm chứng cục bộ
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-09

## 1. Mục tiêu

Cho phép chạy `npm run dev` cùng lúc với bản Windows local mà không dùng chung
single-instance identity hoặc dữ liệu trong `userData`.

## 2. Quyết định

- Bản đóng gói giữ app name `tedia-pros`, cửa sổ `TediaPros` và profile
  `%APPDATA%\tedia-pros`.
- Bản chạy từ source tự dùng app name `tedia-pros-dev`, cửa sổ `TediaPros
  (Dev)` và profile `%APPDATA%\tedia-pros-dev`.
- Cờ `TEDIA_PROS_ALLOW_DEV_MULTI_INSTANCE=1` vẫn là escape hatch cho nhiều
  instance dev, nhưng không cần dùng để chạy dev cùng bản đóng gói.

## 3. Tệp thay đổi

- `[NEW]` `src/main/appProfile.ts`
- `[MODIFY]` `src/main/index.ts`
- `[NEW]` `tests/app-profile.test.ts`
- `[MODIFY]` `scripts/run-local-runtime-tests.mjs`

## 4. Kiểm chứng

```text
cmd.exe /d /c "npm.cmd run typecheck"                 PASS
node scripts/run-local-runtime-tests.mjs app-profile.test  PASS (3/3)
cmd.exe /d /c "npm.cmd run package:win"               PASS
```

Installer mới:

- `F:\Son\tool\TediaPros\dist\TediaPros-0.1.23-setup.exe`
- SHA-256: `D1554F2840DD0D4061A96105C7F1509F8E4277D2386FDBDB8285D8D72F4F9E88`

## 5. Lưu ý vận hành

- Hai bản vẫn có thể cùng gọi một local translation/TTS server ở port `8000`;
  profile tách riêng không tạo thêm server. Nếu cùng chạy AutoShort, request
  vẫn chia sẻ tài nguyên của server đó.
- Không đặt `TEDIA_PROS_ALLOW_DEV_MULTI_INSTANCE=1` nếu chỉ muốn chạy một dev
  instance; các dev instance với cùng profile `tedia-pros-dev` vẫn chia sẻ dữ
  liệu dev.
