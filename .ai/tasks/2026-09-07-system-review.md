# REVIEW-20260907: Review và đánh giá lại toàn bộ hệ thống TediaPros

- **Trạng thái:** Hoàn thành review; phát hiện chưa được sửa.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-07.

## 1. Mục tiêu

Đánh giá snapshot main `6291184eddc6df893ef13eaae68bdd1d27736812` trên các phân hệ chính; đưa ra findings có mức ưu tiên, nguyên nhân, bằng chứng và thứ tự xử lý.

## 2. Tiêu chuẩn nghiệm thu

- [x] Review kiến trúc, AutoShort/media, frontend/IPC, engines và release theo rủi ro.
- [x] Typecheck node/web pass.
- [x] Chạy và ghi lại bộ TS/Python/media smoke; phân biệt test pass, skip, lỗi môi trường và chưa kiểm tra.
- [x] Xác minh findings chính bằng module hiện hành và probe cô lập.
- [x] Báo cáo cùng tài liệu bàn giao; không sửa source sản phẩm.

## 3. Phạm vi

Trong phạm vi: đọc source/docs/CI, kiểm tra cục bộ, audit dependency và GET manifest công khai, viết báo cáo và probe. Ngoài phạm vi: sửa lỗi, gọi AI tính phí, tải assets lớn, GUI E2E, benchmark phần cứng thật, publish/commit/push.

## 4. Quyết định và lý do

Giữ nguyên workspace và artifacts có trước. Build kiểm tra vào `out/review-20260907`. Dùng Python build STTN sẵn có để hoàn tất 17 test bị skip trong Python mặc định. Dùng mock engine để tái hiện lỗi adapter OCR/Douyin mà không sử dụng media/cookie thật.

## 5. Tệp thay đổi

- [NEW] [Báo cáo](F:/Son/tool/TediaPros/docs/reviews/2026-09-07-system-review/REPORT.md).
- [NEW] [Probe core](F:/Son/tool/TediaPros/docs/reviews/2026-09-07-system-review/evidence/repro-core.mjs).
- [NEW] [Probe standalone](F:/Son/tool/TediaPros/docs/reviews/2026-09-07-system-review/evidence/repro-standalone.mjs).
- [NEW] Log/JSON bằng chứng trong thư mục evidence cùng báo cáo; log là local và bị Git ignore.
- [NEW] Bản ghi bàn giao này.

## 6. Kiểm chứng và bằng chứng

Các lệnh/kết quả chi tiết ở mục 3 của báo cáo. Kết quả cuối: typecheck pass, TS 418/418, OCR 31/31, separator 13/13, STTN đủ runtime 26/26; font verification, FFmpeg subtitle render và isolated build pass. Release metadata pass; runtime artifacts thiếu manifest; manifest công khai mặc định HTTP 404; full npm audit cảnh báo 14 package entries, omit-dev bằng 0. Python mặc định thiếu yaml/pytest nên chưa chạy Douyin suite.

Probe tái hiện xác nhận lỗi còn tồn tại; không phải kiểm chứng đã sửa. Chưa xác nhận full GUI/server E2E, clean install hoặc hardware quality/performance.

## 7. Bàn giao

9 findings: R1–R3 P1, R4–R9 P2. Ưu tiên tempo policy, containment và runtime release, sau đó lifecycle, trạng thái output và toolchain/package gate. Xem trigger và giới hạn evidence từng finding trước khi sửa. Không commit hoặc đồng bộ remote trong task review.
