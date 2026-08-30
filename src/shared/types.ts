// Kieu du lieu dung chung giua main <-> preload <-> renderer

import type { CookieSite } from './sites'
import type { YtDlpErrorCode } from './ytdlpErrors'
export type { CookieSite, SiteId } from './sites'
export type { YtDlpErrorCode } from './ytdlpErrors'

export type LogLevel = 'info' | 'warn' | 'error'
export interface LogEntry {
  time: string // ISO
  level: LogLevel
  msg: string
}

export type RendererIssueKind = 'error' | 'unhandled-rejection' | 'react'
export interface RendererIssueReport {
  kind: RendererIssueKind
  time: string
  message: string
  stack?: string | null
  componentStack?: string | null
}

export interface SupportReport {
  generatedAt: string
  text: string
  logCount: number
  rendererIssueCount: number
  includesPreviousCrash: boolean
  privacyNotice: string
}

export interface DepStatus {
  ytdlp: boolean
  ffmpeg: boolean
  platform: NodeJS.Platform
}

export interface YtDlpCapabilityStatus {
  installed: boolean
  source: 'managed' | 'path' | null
  version: string | null
  impersonationAvailable: boolean
  impersonateTargets: string[]
}

export type SetupPhase = 'checking' | 'downloading-ytdlp' | 'downloading-ffmpeg' | 'extracting' | 'done' | 'error'

export interface SetupProgress {
  phase: SetupPhase
  message: string
  percent: number // 0..100, -1 neu khong xac dinh
}

export interface VideoFormat {
  format_id: string
  ext: string
  resolution: string | null
  height: number | null
  fps: number | null
  vcodec: string | null
  acodec: string | null
  filesize: number | null
  filesizeApprox: number | null
  tbr: number | null // total bitrate
  note: string | null
}

export interface VideoInfo {
  id: string
  title: string
  uploader: string | null
  duration: number | null // giay
  durationString: string | null
  thumbnail: string | null
  webpageUrl: string
  isPlaylist: boolean
  playlistCount: number | null
  formats: VideoFormat[]
  heights: number[] // cac do phan giai san co (video), giam dan
}

export interface PlaylistEntry {
  id: string
  title: string
  url: string
  uploader: string | null
  duration: number | null
  durationString: string | null
  isPlaylist?: boolean // entry nay ban than la playlist con (vd tab kenh: Videos/Shorts)
  count?: number | null // so video trong playlist con (neu biet)
}

export interface PlaylistProbe {
  isPlaylist: boolean
  title: string | null
  count: number
  entries: PlaylistEntry[]
}

export type DownloadKind = 'video' | 'audio'

export interface DownloadRequest {
  url: string
  /** ID video do yt-dlp tra ve; chi dung de doi chieu fallback file dau ra. */
  mediaId: string | null
  kind: DownloadKind
  height: number | null // do phan giai mong muon cho video (null = tot nhat)
  audioFormat: string // vd 'mp3'
  outputDir: string
  embedThumbnail: boolean
  embedMetadata: boolean
  /** Main process tu chon dung file cookie theo ten mien cua URL. */
  useCookies: boolean
  /** Neu true, file video khong phai H.264 se duoc FFmpeg chuyen sang H.264/MP4. */
  ensureH264: boolean
  formatId: string | null // bo chon dinh dang tuy chon (vd '137+bestaudio'); null = dung kind/height
  // --- P1 nang cao ---
  container: string // dinh dang file video khi ghep: mp4/mkv/webm
  outputTemplate: string // mau ten file yt-dlp (vd '%(title)s [%(id)s].%(ext)s')
  writeSubs: boolean // tai phu de
  autoSubs: boolean // ke ca phu de tu dong (ASR)
  subLangs: string // ngon ngu phu de, vd 'vi,en'
  embedSubs: boolean // nhung phu de vao video
  useArchive: boolean // bo qua file da tai (download archive)
  forceOverwrite: boolean // ghi de file trung
  proxy: string | null // proxy vuot khoa vung, vd 'socks5://127.0.0.1:1080' (null = khong dung)
}

export interface ProxyTestResult {
  ok: boolean
  message: string
}

// Tu cap nhat app
export interface UpdateStatus {
  state: 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
  /** macOS: chỉ thông báo và mở DMG để người dùng cài thủ công. */
  manual?: boolean
}

// ---- Douyin ----
export type DyMode = 'all' | 'batch' | 'new' // kieu tai (chi cho link kenh)

export interface DouyinRequest {
  url: string
  outputDir: string
  isChannel: boolean // link kenh/user (co Kieu tai) hay video don
  mode: DyMode
  batchSize: number // so video moi dot cho mode 'batch'
  music: boolean
  cover: boolean
  avatar: boolean
  metaJson: boolean
  folderstyle: boolean // true = moi video 1 thu muc con; false = don het vao outputDir
  proxy: string | null
}

export interface DouyinResult {
  id: string
  ok: boolean
  total: number
  success: number
  failed: number
  skipped: number
  error: string | null
}

export interface DouyinProgress {
  id: string
  status: 'preparing' | 'downloading' | 'finished' | 'error'
  line: string | null
  lastFile: string | null // ten video vua tai xong
  success: number
}

export interface DyEngineStatus {
  has: boolean
  /** Kept for compatibility with older renderer code; local assets never poll remotely. */
  needsUpdate?: boolean
}

export interface DyCookieStatus {
  has: boolean
  count: number
}

export interface DyChannel {
  url: string
  name: string
  lastRun: string // ISO
  count: number // tong so video da tai tu kenh
}

// ---- Audio -> Text (whisper) ----
export type WhisperTask = 'transcribe' | 'translate'

export type WhisperDevice = 'cpu' | 'cuda'

export interface WhisperRequest {
  input: string // duong dan file audio/video
  outputDir: string
  model: string // 'base' | 'small' | 'medium'
  language: string // 'auto' | 'vi' | 'en' ...
  task: WhisperTask
  formats: string[] // ['srt','txt','vtt']
  device: WhisperDevice // 'cuda' neu user bat GPU va da co goi tang toc
  diarize: boolean // nhan dien ai noi luc nao (gan nhan [SPEAKER_xx])
  speakers: number // so nguoi noi (0 = tu doan)
}

export interface WhisperCudaStatus {
  has: boolean // da tai + giai nen goi tang toc CUDA chua
  needsUpdate?: boolean
  healthy?: boolean
  message?: string
}

export interface WhisperProgress {
  id: string
  status: 'preparing' | 'transcribing' | 'finished' | 'error'
  percent: number // 0..100, -1 neu chua biet
  language: string | null
  line: string | null // doan text vua nhan / thong bao
}

export interface WhisperResult {
  id: string
  ok: boolean
  outputs: string[] // duong dan cac file .srt/.txt/.vtt
  segments: number
  speakers: number // so nguoi noi nhan dien duoc (0 neu khong bat diarize)
  error: string | null
  /** Language reported by the local engine; null means the engine did not report one. */
  language?: string | null
  /** Device requested by the caller and the device reported by the engine. */
  requestedDevice?: WhisperDevice
  effectiveDevice?: WhisperDevice
  engineVersion?: string | null
  alignmentPath?: string | null
  coverage?: number | null
}

export interface WhisperWorkerStats {
  workerStartCount: number
  modelLoadCount: number
  processedRequestCount: number
  currentModel: string | null
  currentDevice: WhisperDevice | null
  effectiveDevice: WhisperDevice | null
}

export interface WhisperEngineStatus {
  has: boolean
  needsUpdate?: boolean
  healthy?: boolean
  version?: string | null
  protocol?: string | null
  engine?: string | null
  features?: string[]
  message?: string
}

export interface WhisperModelStatus {
  id: string
  repoId: string
  installed: boolean
  complete: boolean
  downloadBytes: number
  path: string | null
  message?: string
  backend?: string
  format?: string
  valid?: boolean
  source?: 'current' | 'legacy' | 'resources' | 'none'
  sha256?: string | null
  incompatible?: boolean
}

// ---- Tab Dich man hinh (doc chu chay tren video) ----
export interface OcrEngineStatus {
  has: boolean
  needsUpdate?: boolean
  healthy?: boolean
  protocol?: string | null
  version?: string | null
  message?: string
}
export interface OcrProgress {
  percent: number // -1 = chua tinh duoc (dang tach khung)
  text: string
}
export interface Region {
  y0: number // mep TREN, tinh theo PIXEL CUA VIDEO GOC
  y1: number // mep DUOI
  x0: number // mep TRAI
  x1: number // mep PHAI
}

export interface BlurRegion {
  id: string
  x0: number
  x1: number
  y0: number
  y1: number
  color?: string
}

export interface OcrResult {
  ok: boolean
  output?: string
  outputs?: string[]
  count?: number
  error?: string
  // Dai chu goc (pixel video) — buoc ghep video dung de che phu de cung san co.
  bandTop?: number | null
  bandBot?: number | null
}

// ---- Ghep phu de vao video (buoc phu cua tab Dich man hinh) ----
/** Font dong goi de burn phu de (tu resources/fonts/catalog.json). */
export interface BurnFontEntry {
  id: string
  label: string
  file: string
  /** Ten noi bo dung trong ASS Style Fontname. */
  family: string
  group: string
  /** Nguon font de UI phan biet font di kem app va font nguoi dung tu them. */
  source?: 'bundled' | 'custom'
  /** False khi manifest con entry nhung tep vat ly khong dung duoc. UI khong nen hien entry nay. */
  available?: boolean
  /** URL tblao:// de @font-face preview trong renderer (main gan khi list). */
  previewUrl?: string
}

export interface BurnFontPreviewData {
  id: string
  family: string
  data: ArrayBuffer
}

export interface BurnFontMutationResult {
  ok: boolean
  fonts?: BurnFontEntry[]
  error?: string
}

export type SubtitleDisplayStyle = 'standard' | 'word-reveal' | 'word-highlight'

export type SubtitleLayoutProfile = 'readable' | 'social' | 'vertical'
export type SubtitleCueHealthLevel = 'good' | 'warning' | 'error'
export type SubtitleCueIssueCode =
  | 'split'
  | 'too-fast'
  | 'too-short'
  | 'overflow'
  | 'too-many-lines'

export interface SubtitleLayoutOptions {
  profile: SubtitleLayoutProfile
  autoOptimize: boolean
  videoWidth: number
  videoHeight: number
  boxWidth: number
  boxHeight: number
  fontSize: number
  boxPadding: number
}

export interface SubtitleCueIssue {
  code: SubtitleCueIssueCode
  level: SubtitleCueHealthLevel
  message: string
}

/**
 * Mot phan hien thi da duoc lap bo cuc. Nhieu segment co the cung tro ve mot
 * cue SRT nguon; preview va ASS bat buoc dung nguyen lines/timing nay.
 */
export interface RenderedSubtitleSegment extends SubtitleCue {
  sourceCueId: string
  segmentIndex: number
  lines: string[]
  lineWidths: number[]
  charactersPerSecond: number
  issues: SubtitleCueIssue[]
}

export interface SubtitleCueHealth {
  cueId: string
  level: SubtitleCueHealthLevel
  lineCount: number
  charactersPerSecond: number
  duration: number
  segmentCount: number
  issues: SubtitleCueIssue[]
}

export interface SubtitleRenderSummary {
  cueCount: number
  segmentCount: number
  splitCueCount: number
  warningCueCount: number
  errorCueCount: number
}

export interface SubtitleRenderPlan {
  segments: RenderedSubtitleSegment[]
  cueHealth: SubtitleCueHealth[]
  summary: SubtitleRenderSummary
  options: SubtitleLayoutOptions
}

export interface SubtitleLayoutRequest {
  path: string
  videoWidth: number
  videoHeight: number
  subRegion?: { x0: number; y0: number; x1: number; y1: number }
  fontId?: string | null
  bgEnabled?: boolean
  profile?: SubtitleLayoutProfile
  autoOptimize?: boolean
}

/** Cue da chuan hoa cho preview; start/end luon tinh bang giay. */
export interface SubtitleCue {
  id: string
  start: number
  end: number
  text: string
  sourceIndex: number
}

export interface SubtitleFilePreview {
  cues: SubtitleCue[]
  duration: number
  warnings: string[]
  error?: string
}

export interface BurnReq {
  video: string
  srt?: string | null
  outputDir: string
  /** Optional deterministic file name chosen by a batch job. */
  outputName?: string
  mode: 'burn' | 'soft'
  bandTop?: number | null
  bandBot?: number | null
  bandLeft?: number | null
  bandRight?: number | null
  blurRegions?: BlurRegion[]
  lamMo?: boolean
  subRegion?: { x0: number; y0: number; x1: number; y1: number }
  catSrt?: boolean
  batAmThanh?: boolean
  amThanhFile?: string | null
  amLuongGoc?: number
  fontId?: string | null
  textColor?: string
  outlineColor?: string
  outlinePx?: number
  bgEnabled?: boolean
  bgColor?: string
  bgOpacity?: number
  subtitleDisplayStyle?: SubtitleDisplayStyle
  highlightColor?: string
  subtitleHighlightPop?: boolean
  subtitleLayoutProfile?: SubtitleLayoutProfile
  subtitleAutoOptimize?: boolean
  subtitleFontSize?: number
  /** Optional ASR/TTS word timing for effects. Burn falls back per cue when it
   * cannot match this timing to the laid-out subtitle text exactly. */
  wordTimings?: Array<{ start: number; end: number; words: TimedWord[] }>
  requireWordTimings?: boolean
  /** Persisted relative to the preview height so mixed batches keep the same visual scale. */
  subtitleFontScale?: number
  outlineScale?: number
}

export interface BurnProgress {
  percent: number
}

export interface BurnResult {
  ok: boolean
  output?: string
  error?: string
}

/** Nha cung cap dich phu de bang AI. */
export type DichProvider = 'gemini' | 'openai' | 'local'

export interface GeminiStatus {
  ok: boolean
  message: string
}

export type DichKeyStatus = GeminiStatus

export interface SrtBlock {
  time: string
  text: string
  /** Stable identity used only inside translation adapters; not serialized to SRT. */
  id?: string
  sourceIndex?: number
  start?: number
  end?: number
  duration?: number
}

export const DEFAULT_AI_SERVER_URL = 'http://127.0.0.1:8000'

export const DICH_LANGS = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'Tiếng Anh' },
  { code: 'zh', label: 'Tiếng Trung' },
  { code: 'ja', label: 'Tiếng Nhật' },
  { code: 'ko', label: 'Tiếng Hàn' },
  { code: 'fr', label: 'Tiếng Pháp' },
  { code: 'de', label: 'Tiếng Đức' },
  { code: 'es', label: 'Tây Ban Nha' },
  { code: 'it', label: 'Tiếng Ý' },
  { code: 'ru', label: 'Tiếng Nga' },
  { code: 'pt', label: 'Bồ Đào Nha' },
  { code: 'ar', label: 'Tiếng Ả Rập' },
  { code: 'hi', label: 'Tiếng Hindi' },
  { code: 'th', label: 'Tiếng Thái' },
  { code: 'id', label: 'Indonesia' },
  { code: 'ms', label: 'Mã Lai' }
] as const

export interface GpuInfo {
  hasNvidia: boolean
  name: string | null
  driverVersion: string | null
  cudaVersion: string | null
  cudaMajor: number | null
  canAccelerate: boolean
  reason: string | null
}

export type DownloadStatus =
  | 'preparing'
  | 'downloading'
  | 'postprocessing'
  | 'converting'
  | 'finished'
  | 'error'

export interface DownloadProgress {
  id: string
  status: DownloadStatus
  percent: number
  downloadedBytes: number | null
  totalBytes: number | null
  speed: number | null
  eta: number | null
  line: string | null
}

export interface DownloadResult {
  id: string
  ok: boolean
  file: string | null
  error: string | null
  skipped?: boolean
  errorCode?: YtDlpErrorCode | null
}

// ---- Cookie dang nhap (Playwright) ----

export interface CookieDepStatus {
  python: boolean
  playwright: boolean
  chromium: boolean
}

export interface CookieStatus {
  has: boolean
  count: number
  domain: string | null
  expiredCount: number
}

export interface SiteCookieStatus extends CookieStatus {
  site: CookieSite
  loggedIn: boolean
  missingLoginMarkers: string[]
}

export type CookieInstallPhase =
  | 'checking'
  | 'installing-playwright'
  | 'installing-chromium'
  | 'done'
  | 'error'

export interface CookieInstallProgress {
  phase: CookieInstallPhase
  message: string
}

export type CookieCapturePhase = 'launching' | 'ready' | 'saved' | 'error'

export interface CookieCaptureEvent {
  phase: CookieCapturePhase
  message: string
  count?: number
}

export interface SiteCookieCaptureEvent extends CookieCaptureEvent {
  site: CookieSite
}

export interface CookieCaptureResult {
  ok: boolean
  count: number
  domain?: string | null
  path?: string | null
  error: string | null
}

// ---- Video2X (nang cap video) ----
export type Video2xProcessor = 'libplacebo' | 'realesrgan' | 'realcugan' | 'rife'
export type Video2xMode = 'filter' | 'interpolate'

export interface Video2xTaskConfig {
  deviceIndex: number
  mode: Video2xMode
  processor: Video2xProcessor
  scalingFactor: number | null
  width: number | null
  height: number | null
  noiseLevel: number
  libplaceboShader: string
  realesrganModel: string
  realcuganModel: string
  rifeModel: string
  frameRateMul: number
  sceneThresh: number
  codec: string
  copyAudio: boolean
  copySubtitle: boolean
  crf: number | null
  encoderPreset: string | null
}

export interface Video2xEngineStatus {
  has: boolean
  needsUpdate?: boolean
  supported: boolean
  healthy?: boolean
  version?: string | null
  message?: string
}

export interface Video2xDevice {
  index: number
  name: string
}

export interface Video2xProgress {
  percent: number
  fps: number
  frame: number
  totalFrames: number
  elapsedSec: number
  remainingSec: number
  message?: string
}

export interface Video2xRunRequest {
  input: string
  output: string
  config: Video2xTaskConfig
}

export interface Video2xRunResult {
  ok: boolean
  output?: string
  error?: string
}

// ---- TTS Server (Voice) ----
export interface TtsServerHealth {
  ok: boolean
  status?: string
  gpu?: string
  vram?: string
  details?: Record<string, any>
  error?: string
}

export interface TtsModelInfo {
  id: string
  name?: string
  provider?: string
  logical_model?: string
  available?: boolean
  languages?: string[]
  default_voice?: string
  voices?: string[]
  supports_voice_clone?: boolean
  supports_named_voice?: boolean
  supported_options?: string[]
  default_options?: Record<string, any>
}

export interface TtsSpeechRequest {
  serverUrl?: string
  apiKey?: string
  text: string
  language: string
  model?: string
  voice?: string
  speed?: number
  options?: Record<string, any>
}

export interface TtsCloneRequest {
  serverUrl?: string
  apiKey?: string
  text: string
  language: string
  model?: string
  voice?: string
  speed?: number
  referenceAudioPath: string
  referenceTranscript?: string
  options?: Record<string, any>
}

export interface TtsGenerateResult {
  ok: boolean
  audioBase64?: string
  audioMimeType?: string
  savedPath?: string
  characters?: number
  durationMs?: number
  generationMs?: number
  credits?: number
  model?: string
  provider?: string
  voice?: string
  speed?: number
  error?: string
}

export interface ClonedVoice {
  id: string
  name: string
  referenceAudioPath: string
  referenceTranscript?: string
  language?: string
  model?: string
  createdAt: string
}

// ==================== AUTO SHORT ====================

export type AutoShortSubtitleMethod = 'whisper' | 'ocr' | 'whisper-ocr'

export interface AutoShortRegion {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Tọa độ vùng Auto Short được chuẩn hóa theo kích thước video (0..1). */
export interface AutoShortNormalizedRegion {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface AutoShortQueueItemInput {
  id: string
  filePath: string
}

export interface AutoShortBlurRegion extends AutoShortNormalizedRegion {
  id: string
  color?: string
}

export interface AutoShortConfig {
  subtitleMethod: AutoShortSubtitleMethod
  whisperModel: string
  whisperDevice?: WhisperDevice
  whisperLanguage?: string
  /** Vùng phụ đề nguồn dùng cho OCR, tọa độ chuẩn hóa 0..1. */
  ocrRegion?: AutoShortNormalizedRegion | null
  blurRegions: AutoShortBlurRegion[]
  lamMo: boolean
  /** Vùng phụ đề đầu ra, tọa độ chuẩn hóa 0..1. */
  subRegion?: AutoShortNormalizedRegion | null
  fontId?: string | null
  textColor?: string
  outlineColor?: string
  outlinePx?: number
  bgEnabled?: boolean
  bgColor?: string
  bgOpacity?: number
  subtitleDisplayStyle?: SubtitleDisplayStyle
  subtitleFontSize?: number
  highlightColor?: string
  subtitleHighlightPop?: boolean
  subtitleLayoutProfile?: SubtitleLayoutProfile
  subtitleAutoOptimize?: boolean
  /** Values normalized by the preview display height; optional for old saved settings. */
  subtitleFontScale?: number
  outlineScale?: number
  translateTarget: string
  translateProvider: DichProvider
  translateServerUrl?: string
  ttsEnabled: boolean
  ttsServerUrl?: string
  ttsModel?: string
  ttsVoice?: string
  ttsLanguage?: string
  ttsSpeed?: number
  ttsOptions?: Record<string, unknown>
  ttsRefAudioPath?: string
  ttsRefTranscript?: string
  voiceOverMode: boolean
  audioMode: 'replace' | 'mix'
  originalAudioVolume: number
  outputDir: string
}

export interface TimedWord {
  text: string
  start: number
  end: number
  probability?: number | null
}

export interface AlignedCue {
  id: string
  start: number
  end: number
  text: string
  source: 'whisper' | 'ocr' | 'fused'
  confidence?: number | null
  timingQuality: 'word' | 'cue' | 'ocr'
  words?: TimedWord[]
}

export type AutoShortDependencyId = 'whisper-engine' | 'whisper-model' | 'whisper-cuda' | 'ocr-engine'

export interface AutoShortDependencyStatus {
  id: AutoShortDependencyId
  label: string
  required: boolean
  ready: boolean
  downloadBytes?: number
  message?: string
}

export interface AutoShortReadiness {
  ready: boolean
  method: AutoShortSubtitleMethod
  requestedDevice: WhisperDevice | null
  effectiveDevice: WhisperDevice | null
  dependencies: AutoShortDependencyStatus[]
  model?: WhisperModelStatus
  message?: string
}

export interface AutoShortDependencyProgress {
  id: AutoShortDependencyId
  phase: 'downloading' | 'installing' | 'verifying' | 'done' | 'error'
  percent: number
  receivedBytes?: number
  totalBytes?: number
  message: string
}

export interface AutoShortStartRequest {
  config: AutoShortConfig
  items: AutoShortQueueItemInput[]
}

export type AutoShortStartResult =
  | { ok: true; jobId: string }
  | { ok: false; error: string }

export type AutoShortItemStatus =
  | 'idle'
  | 'queued'
  | 'extracting_sub'
  | 'translating'
  | 'generating_tts'
  | 'stitching_audio'
  | 'rendering_video'
  | 'done'
  | 'error'
  | 'cancelled'

export interface AutoShortTaskItem {
  id: string
  filePath: string
  fileName: string
  duration?: number
  status: AutoShortItemStatus
  percent: number
  currentStepMessage?: string
  outputPath?: string
  artifactDir?: string
  error?: string
  extractedCueCount?: number
  translatedCueCount?: number
  generatedVoiceCount?: number
  voice?: string
}

export interface AutoShortProgress {
  type: 'item-progress'
  jobId: string
  taskId: string
  itemId: string
  itemStatus: AutoShortItemStatus
  itemPercent: number
  itemMessage: string
  batchIndex: number
  batchTotal: number
  outputPath?: string
  artifactDir?: string
  error?: string
}

export interface AutoShortItemResult {
  itemId: string
  filePath: string
  status: Extract<AutoShortItemStatus, 'done' | 'error' | 'cancelled'>
  outputPath?: string
  artifactDir?: string
  error?: string
  extractedCueCount?: number
  translatedCueCount?: number
  generatedVoiceCount?: number
  voice?: string
}

export type AutoShortEvent =
  | AutoShortProgress
  | ({
    type: 'item-done'
    jobId: string
    itemId: string
    batchIndex: number
    batchTotal: number
    result: AutoShortItemResult & { status: 'done' }
  })
  | ({
    type: 'item-error'
    jobId: string
    itemId: string
    batchIndex: number
    batchTotal: number
    result: AutoShortItemResult & { status: 'error' }
  })
  | ({
    type: 'item-cancelled'
    jobId: string
    itemId: string
    batchIndex: number
    batchTotal: number
    result: AutoShortItemResult & { status: 'cancelled' }
  })
  | ({
    type: 'batch-done'
    jobId: string
    completedCount: number
    errorCount: number
    cancelledCount: number
    totalCount: number
    results: AutoShortItemResult[]
  })

export interface AutoShortBatchResult {
  ok: boolean
  completedCount: number
  totalCount: number
  error?: string
}

