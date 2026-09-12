# Auto Short OCR Subtitle Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Chỉ triển khai khi người dùng yêu cầu thực thi kế hoạch.

**Goal:** Tự chọn một vị trí đặt phụ đề mới cho từng video dựa trên vùng có chữ thường xuyên và kích thước chữ lớn trong kết quả OCR, chỉ bên trong vùng quét do người dùng chọn.

**Architecture:** Tái sử dụng visual OCR timeline của từng item; một hàm thuần đánh giá các vùng chữ và trả về quyết định đặt phụ đề hoặc dùng vị trí thủ công dự phòng. Coordinator áp dụng quyết định riêng cho lần burn của item sau khi nhánh OCR/làm mờ hoàn tất, không sửa cấu hình chung của batch.

**Tech Stack:** Electron, React, TypeScript, node:test, visual OCR timeline hiện có, FFmpeg/ASS và normalized display geometry hiện có; không thêm model, dịch vụ AI hoặc thư viện runtime.

**Spec:** [Quyết định đã duyệt và thiết kế chi tiết trong tài liệu này](#quyet-dinh-da-duyet). Ngày 2026-09-11, người dùng duyệt hướng tự đặt phụ đề theo OCR và yêu cầu rõ: vùng OCR vẫn do người dùng chọn, không quét toàn khung tự động.

**Trạng thái:** IMPLEMENTED_AND_TEST_VERIFIED ngày 2026-09-11. Các ngưỡng v1 đã có unit/integration coverage và UI harness; chưa đánh giá chất lượng trên batch 100 video thực tế.

## Global Constraints

- Chỉ Auto Short; không mở rộng sang Video Editor.
- Giữ nguyên `config.ocrRegion` do người dùng chọn. Không tự mở rộng, thay thế bằng toàn khung hoặc quét lần hai khi chọn vùng thất bại.
- OCR chỉ biết chữ bên trong ROI; chữ ngoài ROI không tham gia xếp hạng và không được tính năng này tự động làm mờ.
- Một cấu hình ROI normalized dùng cho batch; vùng đặt phụ đề tự chọn được tính riêng cho từng item theo display geometry của item đó.
- Giữ nguyên cue ID, nội dung, timestamp, dịch, lồng tiếng, tempo và chính sách recovery hiện có.
- Không đổi mask hiện có thành hình chữ nhật lớn phủ toàn bộ vùng đặt phụ đề. Blur vẫn bám box và thời gian OCR; ASS được ghép sau blur/STTN.
- Giữ Planar RGB trước `maskedmerge`, đường dẫn an toàn, typed IPC và cleanup của item scope.
- Không đổi LICENSE/NOTICE hoặc thêm tải model/binary.
- Các file hiện đang có thay đổi chưa commit, kể cả coordinator, renderer, types, burn, runner và tài liệu. Khi thực thi phải đọc lại diff, giữ nguyên công việc đó, không reset/checkout/rewrite hàng loạt.
- Kế hoạch này chỉ tạo tài liệu; không commit hoặc triển khai mã nguồn trong lượt lập kế hoạch.

<a id="quyet-dinh-da-duyet"></a>
## 1. Quyết định đã duyệt

Luồng đích:

```text
Người dùng chọn ROI OCR + vị trí phụ đề dự phòng
  → OCR từng video trong đúng ROI đó
  → gom vùng chữ và đo thời gian/kích thước từ timeline đã có
  → chọn vùng đạt đồng thời hai tiêu chí
  → làm mờ/xóa chữ theo flow hiện có
  → burn phụ đề mới tại vùng tự chọn của video
```

- Không yêu cầu người dùng chia nhóm 100 video nếu ROI họ chọn đã bao phủ được các vị trí phụ đề cần xử lý.
- Ưu tiên vùng có nội dung chữ thay đổi để giảm nhầm logo/tiêu đề cố định. Đây là heuristic, không bảo đảm nhận diện đúng mọi logo động hoặc bảng chữ.
- Giữ một vị trí ổn định suốt video. Phụ đề chạy theo vị trí từng cue/cảnh nằm ngoài phạm vi v1.
- Khi không có vùng thắng rõ cả hai tiêu chí, dùng `subRegion` thủ công và ghi rõ lý do. Không chọn bừa một vùng bằng điểm cộng bù trừ.
- Không có visual timeline vì OCR/làm mờ lỗi: giữ lỗi và cơ chế xử lý hiện tại. Fallback vị trí không được biến lỗi OCR/STTN thành một video thành công giả.

## 2. Bằng chứng hiện trạng — CODE_CONFIRMED

| Vị trí | Vai trò đã đọc trong checkout hiện tại |
| --- | --- |
| `src/shared/ocrVisualTimeline.ts`: `OcrVisualBox`, `OcrVisualSegment`, `OcrVisualTimeline` | Có text, confidence, tọa độ box, start/end và scanRegion; đủ làm đầu vào phân tích. |
| `src/main/autoShortItemCoordinator.ts`: `getVisualOcr`, `runVisualBranch` | Một promise OCR dùng chung trong item; có nhánh chạy chồng với audio, cache visual timeline và mask riêng. |
| `src/main/autoShortItemCoordinator.ts`: sau `visualOutcome`, trước `deps.burn` | Có `visualResultForAudit.timeline`; điểm tích hợp không cần gọi OCR lại. Hiện `subRegion` vẫn lấy từ config chung. |
| `src/shared/autoShortRegionGeometry.ts` | Helper normalized/pixel đang có trong thay đổi cục bộ; phải tái sử dụng và kiểm tra lại khi thực thi. |
| `src/main/burn.ts`: `boCuc`, chuỗi `maskedmerge` rồi `ass` | Có layout/font theo vùng; blur chữ gốc trước khi ghép phụ đề mới. |
| `src/shared/autoShortContract.ts`, `src/shared/types.ts` | Batch có một config và danh sách item; cần thêm field optional tương thích ngược. |
| `src/renderer/src/components/AutoShort.tsx` | OCR ROI và subtitle region là state normalized riêng; có các chế độ manual/OCR-auto/STTN. |

Không có bằng chứng chạy batch 100 video cho tính năng mới; không được ghi TEST_CONFIRMED cho thuật toán chưa viết.

## 3. Hành vi UI và hợp đồng v1

- Thêm `subtitlePlacementMode?: 'manual' | 'ocr-dominant'` vào `AutoShortConfig`. Thiếu field mặc định `manual`, bảo toàn config cũ.
- Trong tab Phụ đề thêm lựa chọn **Tự đặt vị trí theo OCR**. Gợi ý: **Chọn vị trí riêng cho từng video, chỉ trong vùng OCR bạn đã khoanh. Không xác định được thì dùng khung phụ đề bạn đặt.**
- V1 chỉ cho bật khi `lamMo === true` và `blurMode` là `ocr-auto` hoặc `sttn`, vì đây là hai nhánh đã có visual OCR và xử lý chữ gốc.
- Khi người dùng tắt làm mờ hoặc chọn manual blur, lưu lựa chọn mong muốn nhưng request hiệu lực gửi `manual`; UI nói rõ tính năng cần Tự động OCR hoặc STTN. API nhận request mâu thuẫn thì trả lỗi cấu hình, không tự tạo lượt OCR mới.
- `ocr-dominant` yêu cầu cả `ocrRegion` và `subRegion` hợp lệ: ROI dùng tìm kiếm; `subRegion` là phương án dự phòng.
- Preview trước khi chạy tiếp tục cho chỉnh khung dự phòng; ghi **Vị trí tự động được xác định sau bước OCR**. Không vẽ một kết quả giả trước khi OCR xong, không mở thêm bước pre-scan.
- Không ghi đè `setOcrRegion`, `setSubtitleRegion` hoặc config chung bằng quyết định của item. Đổi video xem trước không thay đổi ROI batch.
- Khi render, progress hiện **Đặt phụ đề theo vùng OCR** hoặc **Dùng vị trí phụ đề dự phòng**. Audit chứa metrics và reason, không chứa văn bản OCR hay đường dẫn nguồn mới.

## 4. Thuật toán v1 — quy tắc triển khai cụ thể

### 4.1. Đầu vào và gom vùng

1. Chỉ nhận timeline đã qua `validateOcrVisualTimeline`. Dùng hệ tọa độ display của timeline, không lấy kích thước video đang preview.
2. Giới hạn phân tích theo `scanRegion` của timeline. Box ngoài ROI phải bị loại hoặc clip trước khi tính; không dùng một box ngoài ROI làm bằng chứng để mở rộng ROI.
3. Mỗi segment: sắp box theo y rồi x. Gom các box cùng dòng khi phần giao theo y đạt ít nhất 50% chiều cao nhỏ hơn. Lưu chiều cao dòng, không dùng tổng diện tích box làm cỡ chữ.
4. Gom dòng kề nhau thành block tối đa hai dòng nếu khoảng trống theo y không quá 0.8 lần chiều cao dòng điển hình và phần giao theo x đạt ít nhất 50% chiều rộng nhỏ hơn. Lưu text của block theo thứ tự đọc.
5. Theo dõi block qua các segment bằng đáy block và tâm x: sai khác đáy không quá 0.75 lần chiều cao dòng; sai khác tâm x không quá 1.5 lần chiều cao dòng; tỷ lệ chiều cao dòng trong [0.67, 1.5]. Chọn track gần nhất; hòa thì theo thứ tự tọa độ. Một/two-line có thể dùng chung track khi đáy ổn định.
6. Cập nhật đại diện track bằng trung vị có trọng số thời gian; không nối chuỗi các vùng đi khắp màn hình bằng phép union lặp lại. Nếu dữ liệu phân mảnh tạo trên 128 track thì trả `too-many-candidates`, không tăng giới hạn hoặc giữ vô hạn state.

### 4.2. Tần suất, kích thước và lọc chữ cố định

- `visibleSeconds`: tổng độ dài hợp của các khoảng thời gian track có chữ. Nhiều box/cùng segment không được cộng thời gian nhiều lần.
- `coverage = visibleSeconds / timeline.video.durationSeconds`; không tính từ số cue hoặc số box.
- `typicalLineHeight`: trung vị chiều cao dòng có trọng số thời gian, chia cho chiều cao display. Một câu dài hoặc một title khổng lồ thoáng qua không tự trở thành vùng chữ lớn nhất.
- Chuẩn hóa text để so sánh: Unicode NFKC, lowercase, trim, gộp whitespace, bỏ dấu câu/khoảng trắng khi tính độ giống. Không sửa text trong timeline/SRT.
- Hai trạng thái text chỉ tính là khác rõ khi edit-distance chuẩn hóa lớn hơn 0.20; mỗi trạng thái phải tồn tại tổng cộng ít nhất 0.5 giây. Dùng tối đa 32 mẫu text đại diện/track, chỉ trong bộ nhớ và không ghi audit.
- Vùng đủ điều kiện cần coverage ít nhất 0.25, có ít nhất hai trạng thái text khác rõ, và confidence trung bình có trọng số thời gian ít nhất 0.75. Không đạt thì loại khỏi tập ứng viên.
- Giới hạn xử lý thuật toán: không mở media, không gọi model, không sinh frame; có kiểm tra abort trước/sau bước tính. Khi thực thi, đo chi phí trên timeline lớn, dùng thống kê/histogram theo track thay vì so sánh mọi box với toàn bộ lịch sử. Không chặn hủy lâu bằng một vòng lặp đồng bộ lớn: cung cấp điểm nhường giữa các chunk nếu benchmark cho thấy cần thiết.

### 4.3. Phải đạt đồng thời hai điều kiện

Trong các vùng đủ điều kiện, tính `maxCoverage` và `maxHeight`:

```ts
const eligibleWinners = candidates.filter((c) =>
  c.coverage >= 0.90 * maxCoverage &&
  c.typicalLineHeight >= 0.90 * maxHeight
)
// Không có vùng hoặc có nhiều vùng đạt gần ngang nhau: fallback.
// Chỉ một vùng thỏa cả hai: selected.
```

Biên 10% là dung sai nhiễu OCR đề xuất v1. Nếu vùng thường xuyên nhất có chữ nhỏ, còn vùng chữ lớn nhất ít xuất hiện, và không có vùng đạt cả hai, fallback `criteria-conflict`. Nhiều vùng cùng đạt thì fallback `ambiguous`. Không dùng điểm tổng để vùng rất lớn bù cho xuất hiện rất ít.

### 4.4. Tạo vùng đặt phụ đề

- Lấy tâm x/y có trọng số thời gian của vùng thắng. Envelope dùng phân vị 5% cho cạnh trái/trên và 95% cho cạnh phải/dưới để giảm box lỗi.
- Thêm biên 0.5 lần chiều cao dòng điển hình quanh envelope. Kích thước mong muốn là max giữa envelope có biên và kích thước khung phụ đề thủ công đã đổi sang display pixels; mục đích giữ đủ chỗ cho bản dịch dài.
- Giới hạn kích thước theo ROI, dịch hình chữ nhật vào ROI mà không thay ROI. Nếu việc giới hạn làm chiều rộng dưới 80% hoặc chiều cao dưới 80% kích thước mong muốn, fallback `region-too-small`; không tự giảm font thủ công cực nhỏ để ép vừa.
- Kết quả auto luôn nằm trong ROI và display bounds, có diện tích dương. Dùng helper normalized/pixel hiện có; làm tròn tại ranh giới render, không đổi đơn vị theo preview.
- Dùng font, màu, viền và bộ layout ASS hiện có. Cỡ chữ OCR là tiêu chí chọn vùng, không tự sao chép thành cỡ font đầu ra.
- Fallback dùng đúng `subRegion` thủ công; nó có thể ngoài ROI vì đó là vị trí người dùng chủ động đặt. Không mở rộng ROI theo fallback.
- Không thay nội dung, timing hoặc xóa các vùng blur khác. Chữ gốc trong các vùng khác của ROI vẫn được xử lý theo mask hiện có.
- Dubbing có retime: chọn vùng bằng timeline nguồn trước retime; vị trí không đổi theo thời gian. Giữ retime video/mask hiện có và SRT đầu ra hiện có.

## 5. Bản đồ tệp và interfaces

| Tệp | Thay đổi khi thực thi |
| --- | --- |
| `src/shared/types.ts` | Thêm type mode và field config optional. |
| `src/shared/autoShortContract.ts` | Migration/default và validation mode + điều kiện ROI/blur/fallback. |
| `src/shared/autoShortSubtitlePlacement.ts` (mới) | Hàm thuần gom vùng, tính metrics, quyết định và region. Không import Node/React. |
| `src/main/autoShortItemCoordinator.ts` | Resolve từ timeline item ngay sau visual branch, truyền region riêng vào burn, progress/audit. |
| `src/main/autoShortAudit.ts` | Type metadata tổng hợp placement, không nới trường text/path hiện có. |
| `src/renderer/src/components/AutoShort.tsx` | Toggle, chú thích preview, mode hiệu lực trong request. |
| `tests/autoshort-subtitle-placement.test.ts` (mới) | Fixture và unit test thuật toán. |
| `tests/autoshort-ocr-contract.test.ts` | Tương thích cũ, validation cấu hình. |
| `tests/autoshort-ocr-pipeline.test.ts` | Tái sử dụng OCR, per-item isolation, fallback, audit, cancellation. |
| `tests/autoshort-ocr-burn.test.ts` | Vùng đưa vào ASS và thứ tự blur/ASS. |
| `scripts/test-autoshort-ocr-placement.mjs` (mới) | Kiểm tra hành vi UI bằng harness cùng cách với script region-resolution hiện có. |
| `scripts/run-local-runtime-tests.mjs` | Đăng ký suite mới; giữ các chỉnh sửa cục bộ. |
| `docs/domain.md`, `docs/project-atlas/modules/autoshort.md` | Mô tả tính năng và giới hạn ROI/fallback. |
| `.ai/tasks/TASK-20260911-autoshort-ocr-subtitle-placement-implementation.md` (mới khi thực thi) | Bàn giao implementation có kết quả lệnh thực tế. |

Hợp đồng helper dự kiến (mọi tên dưới đây phải nhất quán giữa test/coordinator/audit):

```ts
export type AutoShortSubtitlePlacementMode = 'manual' | 'ocr-dominant'
export type SubtitlePlacementReason =
  | 'manual' | 'selected' | 'no-candidate' | 'criteria-conflict'
  | 'ambiguous' | 'region-too-small' | 'too-many-candidates'

export interface SubtitlePlacementDecision {
  version: 1
  mode: AutoShortSubtitlePlacementMode
  reason: SubtitlePlacementReason
  region: AutoShortNormalizedRegion | null
  candidateCount: number
  coverage?: number
  typicalLineHeight?: number
}

export function resolveAutoShortSubtitlePlacement(input: {
  mode: AutoShortSubtitlePlacementMode
  timeline: OcrVisualTimeline | null
  fallbackRegion: AutoShortNormalizedRegion | null
}): SubtitlePlacementDecision
```

Mode manual trả fallback nguyên giá trị, không phân tích timeline. Mode auto thiếu timeline ở helper trả `no-candidate`; coordinator chỉ gọi auto sau visual branch thành công, không dùng hành vi helper để nuốt lỗi branch. `region` null chỉ cho nhánh manual cũ không có subRegion; config auto phải có fallback hợp lệ.

## 6. Các bước thực thi

### Task 1 — Hợp đồng và lựa chọn vùng thuần

**Files:** types, contract, helper mới, hai suite contract/placement và runner trong bảng trên.

**Consumes:** `OcrVisualTimeline`, `AutoShortNormalizedRegion`, các helper geometry hiện có.
**Produces:** `subtitlePlacementMode`, `resolveAutoShortSubtitlePlacement`, `SubtitlePlacementDecision` đúng chữ ký mục 5.

- [ ] Đọc AGENTS root/shared, diff hiện tại và kế hoạch region-resolution; không sửa helper geometry ngoài nhu cầu đã có.
- [ ] Thêm fixture timeline thực sự hợp lệ và test thất bại trước implementation. Mẫu test cơ bản có thể chép nguyên vào suite mới:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import type { OcrVisualTimeline } from '../src/shared/ocrVisualTimeline'
import { resolveAutoShortSubtitlePlacement } from '../src/shared/autoShortSubtitlePlacement'

function placementTimeline(): OcrVisualTimeline {
  return {
    schemaVersion: 1, protocol: 'ocr-visual-cues/1', profile: 'accurate',
    video: { width: 1000, height: 1000, durationSeconds: 10,
      sampleFps: 8, frameCount: 80, geometryFingerprint: 'f'.repeat(64) },
    scanRegion: { x0: 100, y0: 400, x1: 900, y1: 900 },
    segments: ['Xin chào mọi người', 'Hôm nay trời rất đẹp'].map((text, i) => ({
      id: `seg-${i}`, startFrame: i * 32, endFrameExclusive: (i + 1) * 32,
      start: i * 4, end: (i + 1) * 4, text, confidence: 0.95,
      boxes: [{ x0: 250, y0: 700, x1: 750, y1: 740, text, confidence: 0.95 }]
    }))
  }
}

test('auto chọn chữ thay đổi trong ROI và không sửa timeline', () => {
  const timeline = placementTimeline()
  const original = structuredClone(timeline)
  const result = resolveAutoShortSubtitlePlacement({
    mode: 'ocr-dominant', timeline,
    fallbackRegion: { x0: 0.2, y0: 0.45, x1: 0.8, y1: 0.55 }
  })
  assert.equal(result.reason, 'selected')
  assert.equal(result.coverage, 0.8)
  assert.ok(result.region)
  assert.ok(result.region.y0 > 0.55)
  assert.ok(result.region.x0 >= 0.1 && result.region.x1 <= 0.9)
  assert.ok(result.region.y0 >= 0.4 && result.region.y1 <= 0.9)
  assert.deepEqual(timeline, original)
})
```

- [ ] Thêm các fixture biến thể theo ma trận mục 7; dùng assert region/reason/coverage và kiểm tra bất biến timeline, không chỉ snapshot tên hàm.
- [ ] Đăng ký `autoshort-subtitle-placement.test` trong `knownTests`; chạy `node scripts/run-local-runtime-tests.mjs autoshort-subtitle-placement.test autoshort-ocr-contract.test`, xác nhận thất bại đúng vì field/helper chưa có.
- [ ] Triển khai helper theo mục 4, export types ở mục 5 và xử lý default trong contract:

```ts
// Trong migrateLegacyConfig:
subtitlePlacementMode: raw.subtitlePlacementMode === undefined
  ? 'manual' : raw.subtitlePlacementMode
// Trong validation: chỉ nhận manual/ocr-dominant.
// Với ocr-dominant: yêu cầu lamMo, blurMode OCR-auto/STTN,
// ocrRegion và subRegion đều hợp lệ bằng validator region hiện có.
```

- [ ] Chạy lại hai suite đến khi pass; thêm golden fixture cho vị trí chữ trên/giữa/dưới và tỷ lệ ngang/dọc. Ghi kết quả cùng phiên bản ngưỡng.

### Task 2 — Tích hợp từng item, tái sử dụng OCR và audit

**Files:** coordinator, audit, pipeline test, burn test.

**Consumes:** helper và config từ Task 1; `visualResultForAudit.timeline` đã validated.
**Produces:** `deps.burn` nhận vùng của chính item; audit có `subtitlePlacement: SubtitlePlacementDecision` và progress dùng message hiện có.

- [ ] Viết test qua `createAutoShortItemProcessor` và dependency injection hiện có: hai item cùng config/ROI nhưng timeline chữ ở hai y khác nhau; capture `burn` request và assert vùng khác nhau, config gốc không đổi. Dùng fixture/mocks hiện có trong suite, không gọi model thật.
- [ ] Capture `runVisualOcr` call count và scanRegion; bật auto phải giữ đúng ROI và số lần OCR như mode manual trong cùng cấu hình OCR-auto, kể cả cache hit/nhánh Whisper chạy chồng.
- [ ] Chạy `node scripts/run-local-runtime-tests.mjs autoshort-ocr-pipeline.test autoshort-ocr-burn.test`, xác nhận test mới thất bại đúng trước sửa.
- [ ] Sau nhánh `visualOutcome` thành công, trước retime/render, thêm:

```ts
const subtitlePlacement = resolveAutoShortSubtitlePlacement({
  mode: config.subtitlePlacementMode ?? 'manual',
  timeline: visualResultForAudit?.timeline ?? null,
  fallbackRegion: config.subRegion ?? null
})
const resolvedSubtitleRegion = normalizedToPixels(subtitlePlacement.region, geometry)
// Trong deps.burn request:
// subRegion: resolvedSubtitleRegion
// Trong metadata truyền preserveAutoShortArtifacts:
// subtitlePlacement
```

- [ ] Bỏ biến `subtitleRegion` cũ nếu không còn dùng; không refactor coordinator. Bổ sung message placement vào progress rendering; không phát lại các stage đã kết thúc.
- [ ] Giữ OCR cache key: mode đặt phụ đề không thay đổi dữ liệu OCR. Tính lại quyết định mỗi lần chuẩn bị render, không lưu decision trong checkpoint dịch/TTS và không thêm mode vào fingerprint nguồn chỉ để vô hiệu hóa OCR/dịch. Nếu executor phát hiện output render cache, key đó phải gồm mode, phiên bản thuật toán và region đã chọn.
- [ ] Audit chỉ chứa enum, region và metrics tổng hợp theo interface; audit ghi lỗi vẫn dùng catch hiện có, không làm mất video hợp lệ. Giữ timeline text trong memory phục vụ heuristic, không thêm vào audit placement.
- [ ] Test lỗi OCR, lỗi STTN, hủy lúc visual branch đang chạy, retime dubbing, mask retime, fallback không mở lại OCR, và manual không đổi region. Chạy lại hai suite đến khi pass.

### Task 3 — Điều khiển Auto Short và kiểm chứng render

**Files:** AutoShort.tsx, script UI mới, burn test, tài liệu domain/module và task handoff implementation.

**Consumes:** field contract và hành vi Task 2.
**Produces:** một toggle có nhãn rõ và request hiệu lực đúng; video xuất có vùng phụ đề theo OCR đã chọn.

- [ ] Viết test hành vi bằng harness tương tự `scripts/test-autoshort-region-resolution.mjs`: chặn typed IPC để capture request. Thao tác toggle, chuyển video A/B khác độ phân giải, bật/tắt OCR-auto/STTN/manual và assert ROI không đổi, mode gửi đúng. Không dùng tìm chuỗi source làm bằng chứng UI.
- [ ] Thêm persisted state cho lựa chọn `subtitlePlacementMode`, mặc định manual. Mode gửi đi:

```ts
const effectiveSubtitlePlacementMode = automaticProcessing
  ? subtitlePlacementMode : 'manual'
// startBatch config: subtitlePlacementMode: effectiveSubtitlePlacementMode
```

- [ ] Thêm toggle/copy theo mục 3; preview luôn đánh dấu khung hiện tại là dự phòng khi auto được bật. Không đổi RegionBox hoặc thêm API OCR preview.
- [ ] Chạy `node scripts/test-autoshort-ocr-placement.mjs`; xác nhận request và hành vi trên component thật, ghi screenshot khi cần kiểm tra nhãn. Nếu harness cần app dev, dùng đúng cách khởi động đã có, không giết dev session khác.
- [ ] Render fixture ngắn có vùng chữ gốc đã biết; kiểm tra mask trước ASS, phụ đề mới không bị blur và region đầu ra nằm đúng vị trí. Dùng `autoshort-ocr-burn.test` cho regression tự động; dùng frame trích thực tế để xác nhận hình ảnh.
- [ ] Chạy `npm.cmd run typecheck`, các suite mục 8 và `npm.cmd run test:subtitles`. Chỉ ghi PASS sau khi đọc exit/output.
- [ ] Cập nhật domain/module và task handoff; ghi ngưỡng v1, giới hạn logo động, ROI không đổi, lý do fallback. Chỉ commit các hunk thuộc tính năng nếu có yêu cầu commit; không stage toàn bộ file đang có thay đổi của công việc khác.

## 7. Ma trận nghiệm thu

| Ca | Kết quả bắt buộc |
| --- | --- |
| Chữ thay đổi, lớn, có mặt 80% video, nằm trong ROI | Chọn vùng đó, không chọn fallback. |
| Logo cố định suốt clip và phụ đề thay đổi | Logo không đạt text-variation; vùng phụ đề được xét bằng cả hai tiêu chí. |
| Logo OCR nhiễu 1 ký tự, title lớn lóe ngắn | Nhiễu nhỏ không đủ chứng minh text thay đổi; title ngắn không thắng chỉ nhờ kích thước. |
| Vùng nhiều chữ nhất theo thời gian khác vùng chữ lớn nhất | Không có giao hai tập đạt ngưỡng thì `criteria-conflict`. |
| Hai vùng cùng đạt gần ngang nhau | `ambiguous`; dùng đúng fallback. |
| Một câu duy nhất, OCR yếu hoặc coverage thấp | `no-candidate`; giữ fallback, không quét lại. |
| Nhiều box cùng segment; segment bị chia nhỏ nhưng hình không đổi | Coverage và kết quả không tăng giả vì số box/segment. |
| Chữ lớn ngoài ROI | Không tham gia chọn vùng, không mở rộng scan/mask. |
| 1080p/2160p, ngang/dọc, rotation/SAR và portraitBlur | Cùng bố cục nguồn cho normalized decision tương đương; không nhầm tọa độ canvas đầu ra. |
| Bản dịch dài và khung hẹp | Wrap/font theo layout hiện có, không drop chữ; vùng quá nhỏ cho geometry yêu cầu thì fallback. |
| 100 item với các vùng khác nhau trong ROI chung | Mỗi item có quyết định riêng; không rò state giữa item, không tăng số call OCR. |
| Cache OCR hit và miss | Cùng timeline cho cùng decision; cache hit không gọi OCR lại chỉ vì mode placement. |
| Whisper chạy chồng OCR, STTN và dubbing retime | Chờ visual branch đúng điểm; không thêm scan; thứ tự mask/ASS và retime giữ đúng. |
| Tắt toggle hoặc config cũ | Hành vi region cũ được bảo toàn. |
| Hủy / OCR lỗi / STTN lỗi | Giữ cancellation/failure; không burn thành công nhờ fallback vị trí. |

Batch 100 item ở unit/integration dùng synthetic/mocked media để kiểm chứng isolation/call count. Không gọi đó là chất lượng đã đạt trên 100 video thật.

## 8. Lệnh kiểm chứng và phân biệt bằng chứng

Các lệnh dự kiến khi thực thi, chạy từ repo root:

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-subtitle-placement.test autoshort-ocr-contract.test autoshort-ocr-pipeline.test autoshort-ocr-burn.test ocr-visual-timeline.test autoshort-region-geometry.test
node scripts/test-autoshort-ocr-placement.mjs
npm.cmd run test:subtitles
git diff --check
```

- Unit/integration PASS chứng minh logic, ROI, cache và contract; không chứng minh nhận diện đúng mọi video ngoài thực tế.
- Kiểm tra video thực tế sau implementation: chọn 6–10 clip có vị trí chữ khác nhau trong ROI người dùng chọn, có logo/title/two-line. Ghi region chọn, reason, độ phủ, kích thước điển hình và xem frame đầu/giữa/cuối đoạn có chữ. Không âm thầm đổi ngưỡng để riêng từng clip pass.
- Các ngưỡng chỉ được điều chỉnh có lý do và có fixture phản ánh ca sai; giữ quy tắc AND, không mở ROI, không quét lại.
- Báo thời gian tính placement và số call OCR; không hứa phần trăm tăng tốc trước khi đo. Lợi ích đích là giảm thao tác chỉnh vị trí cho batch.

## 9. Kiểm chứng lượt lập kế hoạch

- `npm.cmd run typecheck`: PASS, node và web, exit 0 ngày 2026-09-11 trên working tree hiện có. Đây là baseline, không phải kiểm thử tính năng mới.
- Đã đối chiếu types, contract, coordinator, UI, geometry, audit và thứ tự burn hiện có. Chưa thay đổi mã nguồn runtime.
- Tự rà yêu cầu: vùng người dùng chọn được khóa ở mục 1/3/4 và test mục 7; hai tiêu chí AND ở mục 4.3; fallback ở mục 3/4; mỗi item ở Task 2; UI ở Task 3.
- Triển khai theo thứ tự Task 1 → Task 2 → Task 3. Bắt đầu bằng đọc lại working tree để hòa hợp các thay đổi đang diễn ra.
