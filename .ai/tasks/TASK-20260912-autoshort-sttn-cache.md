# AutoShort STTN retry cache

## Vấn đề

Stage `sttn` đã có trong ArtifactCache nhưng coordinator không dùng. Batch đo ngày 2026-09-11 mất trung bình khoảng 10,7 phút STTN cho mỗi video thành công; retry sau lỗi TTS/render vì vậy lặp lại công việc GPU đắt tiền.

## Thay đổi

- Key cache gồm source SHA-256, canonical OCR visual timeline, geometry, STTN model revision/SHA-256, protocol, provider mode và `maxFrames`.
- Chỉ `put` sau khi runner trả output đã kiểm tra; cache tự kiểm checksum trước mỗi `get`.
- Cache hit giữ `ArtifactLease` đến sau render/scope drain rồi mới release.
- Source thay đổi tạo key khác. Cache lỗi hoặc hết quota chỉ thành miss, không làm hỏng job.

## Kiểm chứng

- `sttn-pipeline.test`: hai lượt cùng evidence chỉ gọi removal một lần; đổi source gọi lại engine; render đọc được cache; lease được release.
- `autoshort-artifact-cache.test`: checksum, concurrent writer, pin/prune/clear đều PASS.
- `npm run typecheck`: PASS.

Đây là cải thiện retry/resume và warm-cache. Chưa đo first-run nhanh hơn; cold STTN vẫn giữ nguyên chất lượng và chi phí.
