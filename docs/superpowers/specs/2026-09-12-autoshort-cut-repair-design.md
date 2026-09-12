# Bổ sung thiết kế sửa Cắt đoạn AutoShort

- Trạng thái: PLANNED — chưa triển khai, chưa có gate nào được đánh dấu đạt bởi tài liệu này.
- Baseline: `0d7fa21b911f1eb540140999f5c51dead6141c78`; working tree có overlay và các task khác chưa commit.
- Yêu cầu: sửa toàn bộ [12 findings](../../../.ai/tasks/2026-09-12-autoshort-cut-review/REVIEW.md) và hoàn thành Core của [spec gốc](2026-09-12-autoshort-temporal-cut-design.md).
- Kế hoạch điều phối: [Cut repair plan](../plans/2026-09-12-autoshort-cut-repair.md).

## 1. Phạm vi và quyết định

Giữ Cắt đoạn trong AutoShort. Sửa engine, UI, persistence và integration đến mức Core T01–T11 đạt; không đổi Core thành một MVP nhỏ hơn. Hold-frame và suggestions/transcript selection là Extension A/B của spec gốc, không triển khai trong repair này. Các requirement R06 thuộc Core vẫn phải kiểm không trộn semantics giữ tiếng/rút ngắn hình; R19 nằm ngoài repair.

Ba miền thời gian giữ nguyên: source → edited → output. Source là video presentation timeline với epoch của frame đầu; audio offset được biểu diễn tương đối cùng epoch. Edit theo frame boundaries, interval half-open. Nhập thời gian resolve đến boundary đầu tiên có presentation time >= input; UI hiển thị giá trị thực trước Apply. Nếu hai đầu resolve về cùng boundary thì báo không có frame để bỏ; không tự mở rộng một frame. EOF là sentinel, không decode như frame.

Thứ tự cung cấp: sửa bố cục/validation và phục hồi no-cut sớm; cut export/resume chỉ được mở khi engine và gates Core đạt. Entry point sửa vẫn xem/khôi phục được edit đã lưu trong thời gian capability bị khóa. Đây là guard cho lỗi đã xác nhận, không xóa dữ liệu hoặc tắt toàn AutoShort.

## 2. Schema mới và tương thích

Implementation đã dùng `AutoShortTemporalEdit` schema 1 cho timestamp-only; do đó thiết kế đầy đủ phải dùng **schema 2**, không tái định nghĩa dữ liệu schema 1. `AutoShortTemporalEditV2` ở dưới thay tên schema 1 được đề xuất nhưng chưa triển khai trong mục 6.2 spec gốc. Store mới `autoshort-edits-v2`, journal writes mới `autoshort-batches-v2`; reader liệt kê cả v1/v2, không ghi đè v1.

Phân loại dữ liệu tồn tại:

| Dữ liệu | Reader/khôi phục | Điều cấm |
|---|---|---|
| v1 trước `0d7fa21`, không cắt | So config bằng đúng digest cũ; giữ receipt cũ; có thể resume theo đường no-cut legacy | Không bắt khớp digest wrapper mới |
| v1 của `0d7fa21`, không cắt | Chấp nhận đúng công thức wrapper của phiên bản đó sau validation no-cut; checkpoint lookup thử hai fingerprint no-cut đã biết | Không chấp nhận hash tùy ý hoặc sửa receipt để khớp |
| v1 timestamp cut của `0d7fa21` | Giữ original; import thành draft v2 qua frame resolver, hiện mọi thay đổi snap; Apply tạo run mới | Không tự coi bản import là đã exact-frame; không resume cut cũ bằng executor mới rồi reuse success cũ |
| v2 | Snapshot config/edit immutable; revision/CAS cho editing; resume đúng snapshot | Không lấy config/cut UI mutable; không sửa succeeded item |
| Unknown/corrupt | Dùng backup chỉ khi checksum/schema hợp lệ; outcome rõ, giữ dữ liệu | Không ignore edit, không overwrite bằng bản rỗng |

Old cut output nếu có vẫn hiện với provenance legacy; không đóng dấu thành công v2. New run liên kết `originJobId/originItemId`, có job/output directory mới. Legacy v1 không có config snapshot: chỉ migrate no-cut khi config người dùng cung cấp khớp digest và nguồn khớp hash. Succeeded receipts không được đổi schema/digest. Downgrade reader cũ không thấy journal v2; không sao chép cut job v2 về namespace v1.

## 3. Contract dùng chung cho ba subplan

Các kiểu/hàm dưới đây là **PROPOSED**, phải tạo ở task ghi bên cạnh trước khi dùng. Shared không import Node/DOM. Chữ số ticks truyền IPC/JSON là string; phép tính trong Main/shared pure dùng BigInt/rational, chỉ đổi sang Number khi đã kiểm safe và để hiển thị.

```ts
// src/shared/autoShortCutContract.ts — A02; index populated by B01
export type CutIdentity = {
  itemId: string; sourceDigest: string; frameIndexRevision: string
}
export type CutRequestIdentity = CutIdentity & { requestId: string; editRevision: number }
export type CutTime = { num: string; den: string } // seconds, reduced rational; den > 0
export type FrameBoundary = {
  presentationIndex: number; ptsTicks: string
  timeBase: { num: number; den: number }; eof: boolean
}
export type FrameCutRange = { id: string; start: FrameBoundary; end: FrameBoundary }
export type CutReviewResolution = {
  cueId: string; segmentId: string; evidenceDigest: string; editDigest: string
  action: 'edit-retained-text' | 'keep-intentional-cut'; text?: string
}
export type AutoShortTemporalEditV2 = CutIdentity & {
  schemaVersion: 2; editId: string; revision: number; mode: 'ripple-delete'
  policyVersion: 'cut-v2'; removedRanges: FrameCutRange[]
  reviewResolutions: CutReviewResolution[]
}
export type CutEditContent = {
  operations: FrameCutRange[]; reviewResolutions: CutReviewResolution[]
}
export type CutEditDocument = CutIdentity & {
  schemaVersion: 2; editId: string; revision: number
  draft: CutEditContent; applied?: AutoShortTemporalEditV2
}
export type CutHistory = {
  past: CutEditContent[]; present: CutEditContent; future: CutEditContent[]
}
export type CutHistoryAction =
  | { type: 'replace'; content: CutEditContent }
  | { type: 'undo' } | { type: 'redo' }
export type CutRunIntent = 'resolve-draft' | 'new-run' | 'resume' | 'start'
export type CutExecutionIdentity = {
  sourceDigest: string; editDigest: string; executorRevision: string
  runtimeDigest: string; mediaPolicyDigest: string
}
```

`FrameBoundary` phải được Main đối chiếu với index/source token: có kiểu đúng không đủ chứng minh boundary là thật. Không trust plan/filter/output path từ Renderer. `removedRanges` là canonical union; operations trong draft/history không bị union tại storage layer. IDs raw unique; keep IDs được sinh từ cặp source frame boundaries, độc lập số thứ tự raw gesture. Không đưa ID/revision/history vào semantic edit digest.

```ts
// src/shared/autoShortCutPlan.ts — B02
export type CutKeepSegment = {
  segmentId: string; sourceStart: FrameBoundary; sourceEnd: FrameBoundary
  editedStart: CutTime; editedEnd: CutTime
  outputSampleStart?: string; outputSampleEnd?: string
}
export type CutExecutionPlan = {
  identity: CutExecutionIdentity; source: CutIdentity
  sourceDuration: CutTime; editedDuration: CutTime; videoEpoch: CutTime
  audio?: { sampleRate: number; channels: number; startRelativeToVideo: CutTime }
  keepSegments: CutKeepSegment[]
  joins: { leftSegmentId: string; rightSegmentId: string; editedAt: CutTime }[]
}
// src/main/autoShortCutPreparation.ts — B03/B04, internal Main only
export type PreparedCutSource = {
  plan: CutExecutionPlan; masterPath: string; artifactSha256: string
  preparationKey: string; manifestPath: string
}
// src/shared/autoShortCutCues.ts — C01/C02
export type CutDerivedCue = {
  id: string; segmentId: string; sourceCueIds: string[]
  sourceSpans: { start: CutTime; end: CutTime }[]
  start: number; end: number; text: string // edited seconds for existing cue adapters
  textProvenance: 'recognized' | 'word-aligned' | 'user-edited' | 'unresolved'
  evidenceDigest: string; review: 'clear' | 'required' | 'resolved'
}
export type CutReviewIssue = {
  cueId: string; segmentId: string; evidenceDigest: string
  reason: 'partial-word' | 'uncertain-text' | 'source-overlap'
}
```

`PreparedCutSource` không materialize mọi segment file cùng lúc. C01 mở segment view theo nhu cầu, tối đa số worker/lease hiện hữu; đóng view sau consumer. Master, index và cached artifacts có lease/lifecycle riêng. Cue giữ source evidence; khi chưa có full-source transcript, source spans lấy từ retained recognition và không tự bịa sourceCueIds (cho phép mảng rỗng với recognized evidence).

### Các interface chính và nơi triển khai

| Hàm / API | Contract | Task |
|---|---|---|
| `parseCutSeconds` | `(raw: string): {ok:true; seconds:number} \| {ok:false; error:string}` | A01 |
| `normalizeFrameCutRanges` | `(ranges: readonly FrameCutRange[]): FrameCutRange[]` | A02 |
| `reduceCutHistory` | `(state: CutHistory, action: CutHistoryAction): CutHistory` | A02 |
| `chooseCutRunIntent` | `({hasDraft, snapshotChanged, hasResume}: {hasDraft:boolean; snapshotChanged:boolean; hasResume:boolean}): CutRunIntent` | A02/A05 |
| `legacyNoCutDigests` | `(config: AutoShortConfig): readonly string[]` (Main, two known formulas only) | A03 |
| `createCutEditStore` | `(root: string): {get(editId:string):Promise<CutEditDocument|null>; save(doc:CutEditDocument, expectedRevision:number|null):Promise<void>}` | A04 |
| `preparationIdentityKey` | `(identity: CutExecutionIdentity): string` (Main hash) | B04 |
| `autoShortProbeFrames` | `{requestId:string; itemId:string; editRevision:number; sourcePath:string; expectedSourceDigest?:string; frameIndexRevision?:string; cursor?:string; limit:number}` → authoritative identity + index page/capability; pagination bắt buộc gửi digest/revision đã nhận | B01 |
| `autoShortResolveCutBoundary` | matching identity + `{sourcePath:string; seconds:number}` → matching identity + actual boundary/snapped time | B01 |
| `autoShortGetCutWaveform` | matching identity + `{startSeconds:number; endSeconds:number; bins:number}` → matching identity + min/max envelope hoặc no-audio | B01 |
| `compileFrameCutPlan` | `(input:{edit:AutoShortTemporalEditV2; index:CutFrameIndex; identity:CutExecutionIdentity}): CutExecutionPlan` | B02 |
| `prepareCutSource` | `(input:{sourcePath:string; plan:CutExecutionPlan; workDir:string; signal:AbortSignal}): Promise<PreparedCutSource>` | B03/B04 |
| `autoShortGetEdit` | `{editId:string; itemId:string}` → `CutEditDocument|null` | A04 |
| `autoShortSaveEdit` | `{document:CutEditDocument; expectedRevision:number|null; intent:'draft'|'apply'}` → saved document or typed conflict | A04 |
| `projectCutCues` | `(source:readonly AlignedCue[], plan:CutExecutionPlan): CutDerivedCue[]` | C02 |
| `assessCutCue` | `(cue:CutDerivedCue, evidence:{partialWord:boolean; textReliable:boolean; intersectsRemoved:boolean}): CutReviewIssue[]` | C02 |
| `resolveCutCueReview` | `(cue:CutDerivedCue, issue:CutReviewIssue, resolution:CutReviewResolution): CutDerivedCue` | C02 |
| `composeCutDubbingMap` | `(plan:CutExecutionPlan, map:DubbingTimeMap): CutOutputMap` | C03 |
| `autoShortPreviewCut` | matching identity + `{editId:string; target:'draft'|'applied'; joinIndex:number; mode:'cut-only'|'sttn'}` → matching identity + owned media token/progress | C04 |
| `autoShortCancelCutPreview` | `{requestId:string; itemId:string}` → cancellation outcome after child exit | C04 |
| `validateCutPublication` | `(input:CutPublicationInput): Promise<CutPublicationResult>` | C05 |

`CutFrameIndex` được định nghĩa B01; `CutOutputMap` C03; `CutPublicationInput/Result` C05. Request/result union ở `autoShortCutContract.ts` phải discriminated `ok` và mã lỗi spec mục 10, giữ identity cả khi failure. Không thêm thông tin path/engine vào copy giao diện trừ khi giúp xử lý lỗi. `autoShortResume` giữ legacy request; thêm overload v2 không nhận config mutable: `{schemaVersion:2, jobId, expectedRevision}`. Credentials được resolve lại hiện tại, output-affecting non-secret config lấy snapshot.

`textProvenance:'unresolved'` chỉ dành cho fragment chờ review với text rỗng/không đủ bằng chứng. Nó không được gửi vào dịch/TTS/SEO như text đã được nhận dạng. Preview draft phải đọc document đã autosave đúng revision; không nhận mutable draft khác revision hoặc áp dụng nó vào journal.

## 4. Tương tác UI được chốt cho repair

```text
Header: Bản xem trước                         [Chọn video] [+] [⋯]
                                  [Cắt đoạn] [9:16] [Chỉnh hình]
┌──────────────────────── Video ──────────────────────────┐
│      Nguồn / Sau cắt; trạng thái đang tạo preview        │
└────────────────────────────────────────────────────────┘
Play/pause · source clock · edited clock · volume
Timeline: thumbnails; vùng bỏ có nhãn; playhead; zoom
Đầu [time] [Đặt đầu]    Cuối [time] [Đặt cuối]  [Bỏ đoạn]
[Bỏ trước] [Bỏ sau] [Bỏ frame]     [Undo] [Redo]
Danh sách khoảng: chiều cao giới hạn, cuộn trong danh sách
Chưa áp dụng / Đã áp dụng · còn 32s         [Hủy nháp] [Áp dụng]
```

Header và tool groups wrap theo nhóm; không để một nút đứng một hàng do mỗi control tự flex-wrap. Chỉ dùng một hành động chính cho mỗi context. Dùng input/control tokens hiện có, không thêm bộ màu riêng. `.autoshort-page` scope CSS; Video Editor không bị thay bố cục. Khi panel hẹp, chi tiết/danh sách mở trong inspector, giữ video và transport quan sát được. Tại panel 696×596 phải còn stage >=240px; tại panel 440px tối thiểu stage >=200px, tools/list dùng vùng cuộn. Đây là target thiết kế sẽ kiểm bằng ảnh thực, không ép tổng content vượt viewport để đạt số đo.

Draft autosave có trạng thái Đang lưu/Đã lưu/Lỗi lưu. Đổi video giữ nháp riêng; Escape hủy gesture đang thao tác, không xóa applied edit. Apply phải lưu bền vững trước enqueue. Có draft khi Start → hai hành động cụ thể “Áp dụng rồi chạy” / “Bỏ nháp, chạy bản đã áp dụng”, và quay lại sửa; không tự chọn theo timeout. Sửa một resumed item đổi CTA thành “Chạy bản chỉnh sửa”, giữ origin link và output cũ; không gọi resume với cut mới trên UI nhưng snapshot cũ.

Preview nguồn xem được cả vùng bỏ. Preview sau cắt lấy executor production, nhãn cut-only/STTN/final rõ; nguồn/edit đổi thì token cũ bị loại. Frame step qua index/decoder Main, không cộng `1/fps` vào HTML video currentTime. History tối đa 200 transactions/item; tối đa 1.000 raw ranges và 2 MiB/edit, báo vượt giới hạn thay vì tự truncate.

## 5. Engine và nguồn media

Frame index giữ PTS/time base thực và EOF; không convert nguồn về FPS cố định trước chọn. GOP dependencies được decode nhưng không vào output/AI context. Schedule audio lấy cùng rational timeline và audio epoch; vị trí sample tính từ absolute output boundary. Ví dụ audio lead 0,5s, giữ `[0,2)` + `[4,6)` → master 4s, có 0,5s im lặng nguồn ở đầu; tiếng không bị kéo lên t=0. Silence chỉ đại diện vùng source vốn không có sample, không vá drift của executor.

Bộ cắt dùng filter graph file và chunk tối đa 64 keep segments/lần, thực thi theo resource lease. B03 phải so pixel/frame/audio oracle để chọn container/codec từ capability probe của managed runtime; ưu tiên FFV1 và PCM đúng sample format/rate, thử container giữ time base cần thiết. Không hỗ trợ format/timestamp thì trả lỗi capability; không ép 8-bit/30fps/16-bit hoặc nới tolerance để chạy. Kết quả lựa chọn nằm trong mediaPolicyDigest. Gate HDR/rotation/SAR được đo riêng, không gắn nhãn lossless tổng quát từ tên codec.

Quota dùng volume thật của temp/cache/output, cả maxActiveItems 1 và 2; tính theo duration, dimensions, bit depth/channels và overhead đo được, cập nhật bytes còn viết. Preview/index cũng có quota/CPU lease; không tăng concurrency GPU/server hiện tại. Source SHA kiểm mutation trước/sau read và publication; không dùng size/mtime làm bằng chứng content. Cache semantic key tách khỏi container checksum, snapshot revision tách khỏi semantic identity.

## 6. Nghiệm thu

Giữ chính xác các giới hạn spec: hard tempo 1.80x, protected gap 0.50s theo EOF policy; extension 60%, slowdown 20%; prepared PCM error <=1 sample; final marker A/V <=20ms sau codec delay; duration sai tối đa 1 output-frame tick hợp lệ. Không thay request/recovery budget hiện hành.

UI phải kiểm thật ở cửa sổ 1040px và rộng, panel 696px/440px, DPI100/125/150, danh sách dài/lỗi/fullscreen, chuột và bàn phím. Target cached interaction P95<=100ms; first-page thumbnails 1080p local<=3s trên baseline hardware ghi nhận. Số đo performance không phải cam kết cho mọi codec/máy.

Traceability repair dùng ID task **P00/A01–A05/B01–B04/C01–C05/Z01**, findings dùng **F01–F12 trong review**, fixture gốc dùng **GF01–GF19** để tránh nhầm F01 đồng bộ của review với F01 bảo vệ nguồn của plan cũ. Requirement gốc vẫn **R01–R19**. GF06 chỉ phần delete semantics; GF19 và hold ngoài Core. Complete chỉ khi đủ sửa F01–F12 và R01–R18 Core, không tính số unit pass thay cho media/GUI quality.
