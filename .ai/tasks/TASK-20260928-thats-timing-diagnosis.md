# [TASK-20260928-thats-timing-diagnosis]: Chẩn đoán That's xuất hiện trước lời nói

- **Trạng thái:** Đã kiểm chứng nguyên nhân tại tầng ASR và cách lan truyền; chưa triển khai sửa sản phẩm.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-28

## 1. Mục Tiêu (Goal)

Giải thích vì sao người dùng nghe “That's impossible” khoảng giây 21 nhưng phụ đề “That's” xuất hiện ở giây 14, còn “impossible” ở giây 21, trên video `923923593724102`.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Tìm SRT đã xuất của đúng video và đối chiếu code hiện tại.
- [x] Tái hiện timestamp bất thường bằng engine local trên video gốc, lưu alignment thô.
- [x] Typecheck pass.
- [x] Chạy test layout hiện hữu, giải thích giới hạn của kết quả pass.
- [x] Phân biệt dữ liệu ASR, logic render và mốc lời nói do người dùng xác nhận.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- Điều tra, chạy lại ASR local vào thư mục bằng chứng mới, ghi nhận kết quả.
- Không sửa code sản phẩm, checkpoint, video/SRT đã xuất hoặc thay đổi chưa commit có sẵn.
- Chưa căn chỉnh lại âm thanh để xác định mốc chuẩn từng từ; chưa kiểm chứng nguyên nhân nội bộ của model/VAD.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

Không suy ra thời gian nói từ ảnh. Dùng thông tin nghe của người dùng và tái hiện độc lập đầu ra ASR. Không dịch cứng That's về sát impossible chỉ dựa vào ngữ nghĩa hoặc khoảng cách lớn: cần bằng chứng âm thanh để sửa alignment.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` Bản ghi này.
- `[NEW]` `.ai/tasks/2026-09-28-thats-timing-diagnosis/whisper-small-reproduction.srt`.
- `[NEW]` `.ai/tasks/2026-09-28-thats-timing-diagnosis/whisper-small-reproduction.alignment.json`.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Artifact đã xuất

`F:\New folder\Video [923923593724102] (15)\.autoshort-audit-c4e34c46-2cca-4e0a-b5f7-bef2242dbdb0-70e40641-12e6-48ff-8c47-74a900f01587\source.srt`:

- Cue 7: `00:00:14,460 --> 00:00:14,800`, `That's`.
- Cue 8: `00:00:21,840 --> 00:00:22,180`, `impossible`.

Snapshot tương ứng: `C:\Users\PC\AppData\Roaming\tedia-pros-dev\autoshort-batches-v1\c4e34c46-2cca-4e0a-b5f7-bef2242dbdb0\snapshot.json`.

### Tái hiện ASR độc lập

```powershell
& 'C:\Users\PC\AppData\Roaming\tedia-pros-dev\bin\whisper-engine\whisper-engine.exe' --input 'F:\Son\facebook\New folder\QUIET HOURS\Video [923923593724102].mp4' --output-dir 'F:\Son\tool\TediaPros\.ai\tasks\2026-09-28-thats-timing-diagnosis' --basename whisper-small-reproduction --model-path 'C:\Users\PC\AppData\Roaming\tedia-pros-dev\whisper-models\small' --language auto --task transcribe --formats srt --device cuda --cuda-dir 'C:\Users\PC\AppData\Roaming\tedia-pros-dev\bin\whisper-cuda'
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs subtitle-layout.test
```

- Engine exit 0; video duration 30.1139375s; language en; 3 segments.
- Segment 12.98–22.18: `Nothing without asking. That's impossible`.
- Word `That's`: 14.46–14.80, probability 0.977294921875.
- Word `impossible`: 21.84–22.18, probability 0.99169921875.
- Raw alignment lines 180–188 contain these word timestamps. The model output already has the problematic timing before TypeScript cue splitting or ASS generation.
- Typecheck: PASS node and web, exit 0.
- Layout tests: 9 PASS, 0 FAIL. Two existing tests explicitly accept That's at 14.46: the gap-splitting test around line 207 and single-word render test around line 241. These tests validate the current behavior, not acoustic correctness.

### Code xác nhận đường lan truyền

- `engines/whisper-engine/engine.py:266`: transcribe with VAD and word timestamps; lines 290–295 copy model word times to alignment JSON.
- `src/main/autoshort.ts:1096`: accepts words and marks timingQuality word; copies first/last word bounds to cue.
- `src/shared/autoShortAlignment.ts:295`: treats >=0.6s gap as a split boundary, then copies word starts/ends to new cues.
- `src/main/burn.ts:679`: single-word branch caps display duration across gaps but retains beat.start. This can stop a word lingering through silence, but cannot correct an early start supplied by ASR.

### Giới hạn

Không còn tìm thấy alignment thô của lần xuất cũ trong các vị trí checkpoint/audit đã kiểm tra; bằng chứng alignment là lần chạy độc lập mới. Tuy nhiên, timestamp tái hiện khớp chính xác source.srt đã xuất. Chưa kết luận VAD, nhạc nền hay nội bộ model là tác nhân cụ thể; chưa tự nghe/đo mốc chuẩn để đưa ra timing sửa ở mức mili-giây. Chưa build/install/render bản sửa.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Nếu triển khai sửa: phát hiện alignment đáng ngờ và xác minh/căn lại trên audio khu vực liên quan trước khi tách cue; giữ nguyên bằng chứng nguồn và ánh xạ cue. Regression cần mốc tham chiếu từ âm thanh, kiểm tra không có That's ở khoảng 14–20s khi lời nói thật bắt đầu khoảng 21s. Không dùng việc test chấp nhận timestamp 14.46 hoặc giới hạn thời gian hiển thị làm bằng chứng đã sửa lệch giọng.
