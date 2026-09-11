import { spawn, type ChildProcess } from 'node:child_process'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { mkdir, copyFile, readFile, writeFile, stat, rm, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolveFfmpeg } from './deps'
import { appendPortraitFrame } from './portraitFrame'
import {
  escapeFfmpegFilterPath,
  readBurnFontPreview,
  resolveBurnFont,
  type ResolvedBurnFont
} from './fonts'
import { createTextMeasurer } from './fontMeasure'
import { debugRaw, logInfo } from './logger'
import {
  type CanonicalDisplayGeometry,
  canonicalBurnDisplayFilter,
  parseCanonicalMediaMetadata
} from './canonicalDisplayGeometry'
import type {
  BlurRegion,
  BurnFontEntry,
  BurnReq,
  BurnProgress,
  BurnResult,
  SubtitleLayoutProfile
} from '../shared/types'
import { subtitleFontSizeForBox, wrapWidthFromBox } from '../shared/subWrap'
import { hasVideoAdjustments, normalizeVideoAdjustments, videoAdjustmentFilter } from '../shared/videoAdjustments'
import {
  formatAssTimestamp,
  parseSrt,
  serializeSrt,
  subtitleDuration,
  trimSubtitleCues,
  type SubtitleCue
} from '../shared/subtitles'
import {
  createSubtitleEffectTimeline,
  normalizeSubtitleDisplayStyle,
  planSubtitleWordOverlays,
  renderAssBaseLineWithHiddenBeat,
  renderAssWordHighlight,
  renderAssWordPopLineOverlay,
  renderAssWordReveal,
  renderAssWordRevealAt,
  safeSubtitlePopScale,
  supportsFixedSubtitleWordPop,
  type SubtitleDisplayStyle
} from '../shared/subtitleEffects'
import { planSubtitleLayout } from '../shared/subtitleLayout'
import { AUDIO_MIX_DROPOUT_TRANSITION_SECONDS, originalAudioGain } from '../shared/audioMix'
import { resolveSubtitlePlanFont } from './subtitlePlanner'
import { terminateProcessTree, trackChildProcess } from './processTree'
import {
  blurSigmaForDisplayHeight,
  ocrBlurSigmaForDisplayHeight,
  planBurnInputs,
  type BurnInputPlan
} from './burnInputPlanner'
import type { TimedOcrBlurMask } from './ocrMask'
import { assertContainedRegularFile } from './safeContainedPath'
import { randomUUID } from 'node:crypto'
import {
  buildVideoSeoInputDigest,
  generateVideoSeoMetadata,
  prepareVideoSeoMetadata,
  type PreparedVideoSeoMetadata,
  reserveVideoTitleOutputDir,
  validateVideoTitleConfig,
  writeVideoSeoMetadata
} from './videoTitle'
import { formatVideoSeoMetadata } from '../shared/videoSeo'

/** Parse #RGB / #RRGGBB -> { r,g,b } hoac null. */
function parseHexColor(hex: string | undefined | null): { r: number; g: number; b: number } | null {
  if (!hex) return null
  const s = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(s)) return null
  const full =
    s.length === 3
      ? s
          .split('')
          .map((c) => c + c)
          .join('')
      : s
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  }
}

/**
 * ASS mau &HAABBGGRR — alpha: 00 = dam, FF = trong suot.
 * opacityPct 0–100 (100 = dam nhat).
 */
export function hexToAssColour(hex: string | undefined | null, opacityPct = 100): string {
  const c = parseHexColor(hex) ?? { r: 255, g: 255, b: 255 }
  const op = Math.max(0, Math.min(100, opacityPct))
  const aa = Math.round(255 * (1 - op / 100))
  const hex2 = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase()
  return `&H${hex2(aa)}${hex2(c.b)}${hex2(c.g)}${hex2(c.r)}&`
}


interface SubStyle {
  textColor: string
  outlineColor: string
  outlinePx: number
  bgEnabled: boolean
  bgColor: string
  bgOpacity: number
}

function styleFromReq(req: BurnReq, fallbackVien: number): SubStyle {
  const outlinePx = Math.max(
    0,
    Math.min(
      8,
      req.outlinePx != null
        ? Math.round(req.outlinePx * 2) / 2
        : Math.min(8, fallbackVien)
    )
  )
  return {
    textColor: parseHexColor(req.textColor) ? req.textColor! : '#ffffff',
    outlineColor: parseHexColor(req.outlineColor) ? req.outlineColor! : '#000000',
    outlinePx,
    bgEnabled: Boolean(req.bgEnabled),
    bgColor: parseHexColor(req.bgColor) ? req.bgColor! : '#000000',
    bgOpacity: Math.max(0, Math.min(100, req.bgOpacity ?? 60))
  }
}

let child: ChildProcess | null = null
let daHuy = false
let burnInFlight = false
let burnAbortController: AbortController | null = null
const burnChildren = new Set<ChildProcess>()

function spawnBurnChild<T extends ChildProcess>(process: T): T {
  burnChildren.add(process)
  const forget = (): void => { burnChildren.delete(process) }
  process.once('close', forget)
  process.once('error', forget)
  return trackChildProcess(process)
}

/** Huy giua chung: giet ffmpeg. child.kill() thoat ma null -> hieu la huy, khong loi. */
export function cancelBurn(): void {
  daHuy = true
  burnAbortController?.abort()
  for (const process of [...burnChildren]) terminateProcessTree(process)
  terminateProcessTree(child)
  child = null
}

function duongFfprobe(ffmpeg: string): string {
  return join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
}

export interface Meta {
  w: number
  h: number
  giay: number
  hasAudio: boolean
  geometry?: CanonicalDisplayGeometry
  videoDurationSeconds?: number | null
  containerDurationSeconds?: number
  /** Actual per-stream durations; giay remains the container duration. */
  videoDuration?: number
  audioDuration?: number
  frameRate?: number
  rotation?: number
  sampleAspectRatio?: string
  videoStart?: number
  audioStart?: number
}

function evenDimension(value: number, fallback: number): number {
  const rounded = Math.max(2, Math.round(value || fallback))
  return rounded % 2 === 0 ? rounded : rounded - 1
}

/**
 * FFmpeg's default autorotation happens before a filter graph.  This filter
 * therefore operates in the same display-space as the subtitle planner:
 * rotation has already been applied, then non-square pixels are converted to
 * square pixels and timestamps are rebased only when the source starts late.
 */
export function canonicalDisplayVideoFilter(meta: Meta): string | null {
  if (meta.geometry) {
    return canonicalBurnDisplayFilter(meta.geometry)
  }
  const sar = meta.sampleAspectRatio || '1:1'
  const [sarNumRaw, sarDenRaw] = sar.split(':').map(Number)
  const sarNum = Number.isFinite(sarNumRaw) && sarNumRaw > 0 ? sarNumRaw : 1
  const sarDen = Number.isFinite(sarDenRaw) && sarDenRaw > 0 ? sarDenRaw : 1
  const needsSarNormalization = Math.abs(sarNum / sarDen - 1) > 0.0001
  const needsPtsNormalization = Math.abs(meta.videoStart || 0) > 0.0001
  if (!needsSarNormalization && !needsPtsNormalization) return null

  const filters: string[] = []
  if (needsPtsNormalization) filters.push('setpts=PTS-STARTPTS')
  if (needsSarNormalization) {
    filters.push(
      `scale=${evenDimension(meta.w, 1280)}:${evenDimension(meta.h, 720)}:flags=lanczos`,
      'setsar=1'
    )
  }
  return filters.join(',')
}

/** Lay kich thuoc + thoi luong video (de tinh co chu, le, phan tram tien do). */
async function doVideo(ffprobe: string, video: string): Promise<Meta> {
  return new Promise((resolve) => {
    const p = spawnBurnChild(spawn(
      ffprobe,
      [
        '-v', 'error',
        '-show_entries', 'stream=index,codec_type,width,height,start_time,duration,r_frame_rate,sample_aspect_ratio:stream_tags=rotate:stream_side_data=rotation',
        '-show_entries', 'format=duration,start_time',
        '-of', 'json',
        video
      ],
      { windowsHide: true }
    ))
      let out = ''
      p.stdout.on('data', (d: Buffer) => (out += d.toString()))
      p.on('close', () => {
        try {
          const parsed = JSON.parse(out)
          resolve(parseCanonicalMediaMetadata(parsed))
        } catch {
          resolve({ w: 0, h: 0, giay: 0, hasAudio: false, videoDurationSeconds: null, containerDurationSeconds: 0 })
        }
      })
    p.on('error', () => resolve({ w: 0, h: 0, giay: 0, hasAudio: false, videoDurationSeconds: null, containerDurationSeconds: 0 }))
  })
}

export interface BoCuc {
  che: boolean // co che phu de goc khong
  y: number // mep tren dai che (pixel)
  bh: number // chieu cao dai che
  x: number // mep trai dai che (pixel)
  bw: number // chieu rong dai che
  sigma: number // do manh blur (gaussian)
  fontSize: number // co chu (PIXEL VIDEO — nho .ass co PlayResY = chieu cao video)
  vien: number // do day vien
  marginV: number // le duoi (pixel video)
  tamY: number | null // null = khong co khung sub (user khong keo) => dung marginV mac dinh
}

/**
 * Bo tham so bo cuc — video NGANG va DOC dung 2 bo KHAC NHAU.
 * Vi sao phai tach: video doc (9:16) co chieu cao rat lon nhung khung hep, ma
 * thang co chu lai tinh theo chieu cao -> 3.5%/4.5%/5.5% cua 1920 deu vuot xa
 * muc be rong cho phep, bi chan het ve cung MOT so (user doi Vua/Lon/Rat lon ma
 * chu khong nhuc nhich). Voi video doc phai lay moc theo BE RONG.
 */
interface ThamSo {
  theoCao: boolean // moc tinh co chu: chieu cao (ngang) hay be rong (doc)
  tuDong: number // co chu tu dong khi KHONG co khung mo
  thang: Record<'nho' | 'vua' | 'lon' | 'ratlon', number>
  min: number
  max: number
  le: number // le trai/phai (ti le be rong)
}
// Ngang: GIU NGUYEN so cu (dang chay tot, khong dung vao).
const NGANG: ThamSo = {
  theoCao: true,
  tuDong: 0.042,
  thang: { nho: 0.025, vua: 0.035, lon: 0.045, ratlon: 0.055 },
  min: 0.02,
  max: 0.055,
  le: 0.04
}
// Doc: moc theo be rong, chu to hon va cho phep 2-3 dong (kieu TikTok/Reels).
// Thang trai deu tu min den max nen khong con canh 3 muc ra cung mot co.
const DOC: ThamSo = {
  theoCao: false,
  tuDong: 0.045,
  thang: { nho: 0.035, vua: 0.045, lon: 0.055, ratlon: 0.065 },
  min: 0.035,
  max: 0.065,
  le: 0.05
}

/**
 * Tinh bo cuc dot chu tu kich thuoc video + dai chu goc.
 * Che phu de goc kieu BLUR (kinh mo, giong CapCut) — do that dep hon thanh den
 * cung. Huong video (ngang/doc) lay tu ffprobe -> chon bo tham so tuong ung.
 * Dai mo giu DUNG khung user keo; chu can giua quanh tam dai do va duoc phep
 * tran ra ngoai.
 */
export function boCuc(
  meta: Meta,
  subRegion?: { x0: number; y0: number; x1: number; y1: number } | null,
  lamMo?: boolean,
  customFontSize?: number | null
): BoCuc {
  const co = meta.h > 0 ? meta.h : 720
  const rong = meta.w > 0 ? meta.w : 1280
  const ts = rong < co ? DOC : NGANG
  const marginV = Math.round(co * 0.04)

  // Video doc dung be rong lam moc; video ngang dung chieu cao.
  const fontScaleBase = ts.theoCao ? co : rong
  let fontSize = customFontSize && customFontSize > 0 ? customFontSize : Math.round(fontScaleBase * ts.tuDong)
  let y = 0
  let bh = 0
  let x = 0
  let bw = rong
  let tamY: number | null = null

  if (subRegion && subRegion.y1 > subRegion.y0 && subRegion.x1 > subRegion.x0) {
    y = Math.max(0, subRegion.y0)
    bh = Math.min(co - y, subRegion.y1 - subRegion.y0)
    x = Math.max(0, subRegion.x0)
    bw = Math.min(rong - x, subRegion.x1 - subRegion.x0)

    fontSize = customFontSize && customFontSize > 0 ? customFontSize : subtitleFontSizeForBox({
      boxWidth: bw,
      boxHeight: bh,
      videoWidth: rong,
      videoHeight: co
    })
    tamY = Math.round(y + bh / 2)
  }

  y -= y % 2
  bh -= bh % 2
  if (bh < 2) bh = 2
  if (y + bh > co) bh = Math.max(2, co - y - ((co - y) % 2))

  x -= x % 2
  bw -= bw % 2
  if (bw < 2) bw = 2
  if (x + bw > rong) bw = Math.max(2, rong - x - ((rong - x) % 2))

  const vien = Math.max(1, Math.round(fontSize * 0.12))
  return {
    che: !!lamMo,
    y,
    bh,
    x,
    bw,
    sigma: Math.max(8, Math.round(co * 0.03)),
    fontSize,
    vien,
    marginV,
    tamY
  }
}

/**
 * Alias giu tuong thich cho code cu. Parser chuan nam trong shared/subtitles va
 * luon tra moc thoi gian dang so de preview va burn khong the dien giai khac nhau.
 */
export function docSrt(srtRaw: string): SubtitleCue[] {
  return parseSrt(srtRaw).cues
}

export async function probeBurnMedia(video: string): Promise<Meta> {
  if (!isAbsolute(video)) throw new Error('Đường dẫn video không hợp lệ.')
  const info = await stat(video)
  if (!info.isFile() || info.size <= 0) throw new Error('Không thể đọc video đã chọn.')
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw new Error('Chưa tìm thấy FFmpeg để kiểm tra âm thanh video.')
  return doVideo(duongFfprobe(ffmpeg), video)
}

/** Chon font dong goi theo script; null giu fallback he thong cho script chua co trong pack. */
function resolveAutomaticSubtitleFont(cues: readonly SubtitleCue[]): ResolvedBurnFont | null {
  return resolveSubtitlePlanFont(cues, 'auto')
}

/**
 * Thoi diem KET THUC cua cau cuoi trong file .srt (giay). Dung de canh bao user
 * khi ho chon nham file phu de lech han so voi video.
 */
export async function srtGiay(duong: string): Promise<number> {
  try {
    const cues = docSrt(await readFile(duong, 'utf8'))
    return subtitleDuration(cues)
  } catch {
    return 0
  }
}

/**
 * Cat .srt cho vua thoi luong video: bo han cau bat dau sau khi video da het,
 * va keo mep cuoi cua cau VAT NGANG ve dung luc video ket thuc.
 *
 * !! TU CAT chu KHONG dung co san cua ffmpeg — da do that ca hai deu sai:
 *    - `-shortest`: LAM MAT HAN cau vat ngang (cau 2s->10s tren video 3s cho ra
 *      luong phu de rong tuot, mat ca doan dang le phai hien tu giay 2 den 3).
 *    - `-t` / `-to`: khong dung gi toi luong phu de (van de nguyen 10s).
 */
export function catSrtTheoVideo(cues: SubtitleCue[], giayVideo: number): string {
  return serializeSrt(trimSubtitleCues(cues, giayVideo))
}

/**
 * .srt -> .ass, ĐẶT PlayResX/Y = KICH THUOC VIDEO. Vi sao KHONG dung filter
 * `subtitles=...:force_style`: no doc .srt voi PlayResY mac dinh (~288) nen
 * FontSize/MarginV (tinh theo pixel video) bi phong ~2.5x va DAT SAI CHO -> chu
 * khong nam trong dai mo. Da do that. Voi PlayRes = video thi moi so la pixel that.
 */
import { readFileSync } from 'node:fs'

/**
 * Doc file srt tu dong nhan dien encoding (UTF-8, UTF-16LE/BE, EUC-KR cho chu Han)
 */
export function docFileSrt(duong: string): string {
  const buf = readFileSync(duong)
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return buf.toString('utf16le')
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    try {
      return new TextDecoder('utf-16be').decode(buf)
    } catch {
      return buf.toString('utf16le')
    }
  }
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.toString('utf8').slice(1)
  }

  const utf8Str = buf.toString('utf8')
  if (utf8Str.includes('\uFFFD')) {
    try {
      return new TextDecoder('euc-kr').decode(buf)
    } catch {
      return buf.toString('latin1')
    }
  }
  return utf8Str
}





export interface AssSubtitleOptions {
  displayStyle?: SubtitleDisplayStyle
  highlightColor?: string
  highlightPop?: boolean
  layoutProfile?: SubtitleLayoutProfile
  autoOptimize?: boolean
  wordTimings?: BurnReq['wordTimings']
  /** AutoShort sets this so an effect is never synthesized from character
   * count when a cue has no trustworthy ASR/TTS word alignment. */
  requireWordTimings?: boolean
}

export function taoAss(
  cues: SubtitleCue[],
  meta: Meta,
  bc: BoCuc,
  fontOverride?: string | null,
  style?: SubStyle | null,
  pickedFont: BurnFontEntry | null = null,
  effectOptions: AssSubtitleOptions = {}
): string {
  const w = meta.w > 0 ? meta.w : 1280
  const h = meta.h > 0 ? meta.h : 720

  const marginL = bc.x > 0 ? bc.x : Math.round(w * 0.08)
  const marginR = bc.x > 0 && bc.bw > 0 ? Math.max(0, w - (bc.x + bc.bw)) : Math.round(w * 0.08)
  const boxWidth = w - marginL - marginR

  // A selected subtitle region is anchored at its visual centre. This is the
  // same reference point used by the interactive preview, so 1/2/3 lines do
  // not jump upward from the blur band as they did with bottom alignment.
  const marginV = bc.tamY != null ? Math.max(0, h - (bc.y + bc.bh)) : bc.marginV

  // Tu dong phat hien font theo ngon ngu (mau ca file). Wrap xuong dong: theo TUNG cue.
  const textSample = cues.map((c) => c.text).join('')
  let fontName = 'Arial'
  const isJapanese = /[\u3040-\u309f\u30a0-\u30ff]/.test(textSample)
  const isChinese = /[\u4e00-\u9fa5]/.test(textSample)

  if (fontOverride && fontOverride.trim()) {
    fontName = fontOverride.trim()
  } else if (isJapanese) {
    // Tieng Nhat (uu tien nhan dien truoc do tieng Nhat co chua chu Kanji trung voi tieng Trung)
    fontName = 'MS Gothic'
  } else if (/[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(textSample)) {
    // Tieng Han
    fontName = 'Malgun Gothic'
  } else if (isChinese) {
    // Tieng Trung (Gian/Phon the)
    fontName = 'Microsoft YaHei'
  } else if (/[\u0e00-\u0e7f]/.test(textSample)) {
    // Tieng Thai
    fontName = 'Leelawadee UI'
  } else if (/[\u0900-\u097f]/.test(textSample)) {
    // Tieng An (Devanagari/Hindi...)
    fontName = 'Nirmala UI'
  } else if (/[\u0600-\u06ff]/.test(textSample)) {
    // Tieng A Rap
    fontName = 'Segoe UI'
  }

  // Wrap theo px chieu ngang khung (tru pad neu co nen)
  const bgOn = Boolean(style?.bgEnabled)
  const boxPad = Math.max(8, Math.round(bc.fontSize * 0.26))
  const measure = createTextMeasurer(bc.fontSize, fontName, pickedFont)
  const renderPlan = planSubtitleLayout(
    cues,
    {
      profile: effectOptions.layoutProfile ?? 'readable',
      autoOptimize: effectOptions.autoOptimize !== false,
      videoWidth: w,
      videoHeight: h,
      boxWidth,
      boxHeight: bc.tamY != null ? bc.bh : Math.max(bc.fontSize * 2.5, h * 0.2),
      fontSize: bc.fontSize,
      boxPadding: bgOn ? boxPad : 0
    },
    measure
  )

  const primary = hexToAssColour(style?.textColor ?? '#ffffff', 100)
  const displayStyle = normalizeSubtitleDisplayStyle(effectOptions.displayStyle)
  const secondary =
    displayStyle === 'word-reveal'
      ? hexToAssColour(style?.textColor ?? '#ffffff', 0)
      : '&H00000000&'
  const highlight = hexToAssColour(effectOptions.highlightColor ?? '#FFD166', 100)
  const highlightPop = effectOptions.highlightPop !== false
  const outline = hexToAssColour(style?.outlineColor ?? '#000000', 100)
  const outlineW = style != null ? style.outlinePx : bc.vien
  const back = bgOn
    ? hexToAssColour(style!.bgColor, style!.bgOpacity)
    : '&H00000000&'
  // blur nhe de mem goc hop (ASS khong co border-radius that)
  const boxBlur = Math.max(2, Math.min(5, bc.fontSize * 0.055))

  // D = chu + vien; Box = chi hop nen (chu trong suot), ôm sát khi xuống dòng
  const styleText =
    `Style: D,${fontName},${bc.fontSize},${primary},${secondary},${outline},&H00000000&,` +
    `0,0,0,0,100,100,0,0,1,${outlineW},0,${bc.tamY != null ? 5 : 2},${marginL},${marginR},${marginV},1`
  // BorderStyle=3: mau hop = OutlineColour (khong phai BackColour)
  const styleBox =
    `Style: Box,${fontName},${bc.fontSize},&HFF000000&,&H00000000&,${back},&H00000000&,` +
    `0,0,0,0,100,100,0,0,3,${boxPad},0,${bc.tamY != null ? 5 : 2},${marginL},${marginR},${marginV},1`

  const assNumber = (value: number): string =>
    (Math.round(value * 100) / 100).toString()
  const lineHeight = bc.fontSize * 1.2
  const textCenterX = marginL + boxWidth / 2
  const textCenterY = bc.tamY ?? h - marginV
  const anchorPosition = bc.tamY != null
    ? `\\an5\\pos(${assNumber(textCenterX)},${assNumber(textCenterY)})`
    : ''
  const fixedLinePosition = (lineIndex: number, lineCount: number): string => {
    const y = textCenterY + (lineIndex - (lineCount - 1) / 2) * lineHeight
    return `\\an5\\pos(${assNumber(textCenterX)},${assNumber(y)})`
  }

  const events = renderPlan.segments.flatMap((cue) => {
    // Breakpoints and timing already come from the shared render plan.
    const textFormatted = cue.lines.join('\\N')
    const a = formatAssTimestamp(cue.start)
    const b = formatAssTimestamp(cue.end)
    const layer = bgOn ? 1 : 0
    const boxEvent = bgOn
      ? [`Dialogue: 0,${a},${b},Box,,0,0,0,,{${anchorPosition}\\blur${boxBlur.toFixed(1)}}${textFormatted}`]
      : []

    if (displayStyle === 'standard') {
      return [...boxEvent, `Dialogue: ${layer},${a},${b},D,,0,0,0,,{${anchorPosition}}${textFormatted}`]
    }

    const suppliedWords = effectOptions.wordTimings
      ?.filter((entry) => entry.end > cue.start + 0.001 && entry.start < cue.end - 0.001)
      .flatMap((entry) => entry.words.filter((word) => word.end > cue.start + 0.001 && word.start < cue.end - 0.001))
    const timeline = createSubtitleEffectTimeline({
      ...cue,
      text: textFormatted.replace(/\\N/g, '\n')
    }, { wordTimings: suppliedWords })
    if (timeline.beats.length === 0 || (effectOptions.requireWordTimings && timeline.timingSource !== 'provided')) {
      return [...boxEvent, `Dialogue: ${layer},${a},${b},D,,0,0,0,,{${anchorPosition}}${textFormatted}`]
    }

    if (displayStyle === 'word-reveal') {
      if (timeline.timingSource === 'provided') {
        return [
          ...boxEvent,
          ...timeline.beats.map((beat, beatIndex) => {
            const nextStart = timeline.beats[beatIndex + 1]?.start ?? cue.end
            return `Dialogue: ${layer},${formatAssTimestamp(beat.start)},${formatAssTimestamp(nextStart)},D,,0,0,0,,` +
              `{${anchorPosition}}${renderAssWordRevealAt(timeline, beat.index)}`
          })
        ]
      }
      return [
        ...boxEvent,
        `Dialogue: ${layer},${a},${b},D,,0,0,0,,{${anchorPosition}}${renderAssWordReveal(timeline)}`
      ]
    }

    // Colour-only highlight never changes glyph advances, so it is safe for
    // every script. RTL/context-shaped scripts currently use this same stable
    // fallback until their word coordinates can be shaped exactly like libass.
    const fixedPopSupported =
      highlightPop && supportsFixedSubtitleWordPop(timeline.tokens.map((token) => token.text).join(''))
    if (!fixedPopSupported) {
      return [
        ...boxEvent,
        ...timeline.beats.map(
          (beat) =>
            `Dialogue: ${layer},${formatAssTimestamp(beat.start)},${formatAssTimestamp(beat.end)},D,,0,0,0,,` +
            `{${anchorPosition}}` + renderAssWordHighlight(timeline, beat.index, primary, highlight, { enabled: false })
        )
      ]
    }

    const overlayPlan = planSubtitleWordOverlays(timeline, measure, cue.lineWidths)
    const lineCount = overlayPlan.lines.length
    const fixedBoxEvents = bgOn
      ? overlayPlan.lines.map(
          (line) =>
            `Dialogue: 0,${a},${b},Box,,0,0,0,,{${fixedLinePosition(line.lineIndex, lineCount)}\\blur${boxBlur.toFixed(1)}}${line.text}`
        )
      : []
    const fixedBaseEvents = timeline.beats.flatMap((beat) =>
      overlayPlan.lines.map(
        (line) =>
          `Dialogue: ${layer},${formatAssTimestamp(beat.start)},${formatAssTimestamp(beat.end)},D,,0,0,0,,` +
          `{${fixedLinePosition(line.lineIndex, lineCount)}}` +
          renderAssBaseLineWithHiddenBeat(timeline, line.lineIndex, beat.index)
      )
    )
    const overlayEvents = timeline.beats.flatMap((beat) => {
      const popScale = safeSubtitlePopScale(
        timeline,
        beat.index,
        wrapWidthFromBox(boxWidth, bgOn ? boxPad : 0),
        measure,
        cue.lineWidths
      )
      return overlayPlan.words
        .filter((word) => word.beatIndex === beat.index)
        .map((word) => {
          const y = textCenterY + (word.lineIndex - (lineCount - 1) / 2) * lineHeight
          return (
            `Dialogue: ${layer + 1},${formatAssTimestamp(beat.start)},${formatAssTimestamp(beat.end)},D,,0,0,0,,` +
            `{\\an5\\pos(${assNumber(textCenterX)},${assNumber(y)})}` +
            renderAssWordPopLineOverlay(timeline, word.lineIndex, word.tokenIndex, beat, highlight, {
              enabled: true,
              peakScale: popScale
            })
          )
        })
    })

    return [...fixedBoxEvents, ...fixedBaseEvents, ...overlayEvents]
  })

  const styleLines = bgOn ? [styleBox, styleText] : [styleText]

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    // Planner da chot diem xuong dong; libass khong duoc tu wrap lan hai khi pop.
    'WrapStyle: 2',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styleLines,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    ''
  ].join('\n')
}

export interface AudioFilterResult {
  filter: string | null
  mapArgs: string[]
}

export function buildAudioFilter(
  meta: Meta,
  narrationAudioIndex: number | null,
  batAmThanh: boolean,
  audioVolume: number
): AudioFilterResult {
  if (!batAmThanh) {
    return {
      filter: null,
      mapArgs: ['-map', '0:a?']
    }
  }

  const durationSec = meta.videoDurationSeconds ?? meta.videoDuration ?? meta.giay
  const outputDuration = Math.max(0.1, durationSec).toFixed(3)

  if (meta.hasAudio) {
    const volRatio = originalAudioGain(audioVolume)
    if (narrationAudioIndex != null) {
      if (volRatio <= 0.0001) {
        // REPLACE mode: Completely bypass original audio stream; direct narration track
        const filter = `[${narrationAudioIndex}:a]asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,volume=1.0,apad=whole_dur=${outputDuration},atrim=duration=${outputDuration},alimiter=limit=-1dB:attack=5:release=50:level=false[a_mix]`
        return { filter, mapArgs: ['-map', '[a_mix]'] }
      } else {
        // MIX mode: Dynamic ducking narration over background audio + limiter
        const filter = `[0:a]asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,volume=${volRatio}[bg];[${narrationAudioIndex}:a]asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,volume=1.0,asplit=2[narr_sc][narr_mix];[bg][narr_sc]sidechaincompress=threshold=0.06:ratio=4:attack=15:release=200[ducked_bg];[ducked_bg][narr_mix]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0[a_sum];[a_sum]alimiter=limit=-1dB:attack=5:release=50,apad=whole_dur=${outputDuration},atrim=duration=${outputDuration}[a_mix]`
        return { filter, mapArgs: ['-map', '[a_mix]'] }
      }
    } else {
      // Không nhạc nền + có âm thanh gốc -> Chỉ chỉnh âm lượng gốc
      const filter = `[0:a]asetpts=PTS-STARTPTS,volume=${volRatio},apad=whole_dur=${outputDuration},atrim=duration=${outputDuration}[a_mix]`
      return { filter, mapArgs: ['-map', '[a_mix]'] }
    }
  } else {
    // Video gốc câm (không âm thanh)
    if (narrationAudioIndex != null) {
      const filter = `[${narrationAudioIndex}:a]asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,apad=whole_dur=${outputDuration},atrim=duration=${outputDuration},alimiter=limit=-1dB:attack=5:release=50:level=false[a_mix]`
      return { filter, mapArgs: ['-map', '[a_mix]'] }
    } else {
      // Không nhạc nền -> Không cần âm thanh
      return { filter: null, mapArgs: [] }
    }
  }
}

/**
 * Cac tham so filter cho ffmpeg. Supports N blur regions using split=N+1 stream architecture.
 */
export function taoFilterComplex(
  meta: Meta,
  regions: BlurRegion[],
  lamMo: boolean,
  coAss: boolean,
  assName: string,
  batAmThanh = false,
  hasAudioFile = false,
  audioVolume = 100,
  fontsDir: string | null = null,
  portraitBlur = false,
  videoAdjustments = normalizeVideoAdjustments(undefined)
): string[] {
  const sigma = blurSigmaForDisplayHeight(meta.h)
  const validRegions = lamMo ? regions.filter((r) => r.x1 > r.x0 && r.y1 > r.y0) : []
  const lines: string[] = []
  const canonicalFilter = canonicalDisplayVideoFilter(meta)
  const videoAdjustmentActive = hasVideoAdjustments(videoAdjustments)
  const hasVideoFilters = validRegions.length > 0 || coAss || Boolean(canonicalFilter) || portraitBlur || videoAdjustmentActive
  let videoInput = '0:v'
  if (canonicalFilter) {
    lines.push(`[0:v]${canonicalFilter}[display]`)
    videoInput = 'display'
  }
  const assFilter =
    fontsDir && coAss
      ? `ass=${assName}:fontsdir=${escapeFfmpegFilterPath(fontsDir)}`
      : `ass=${assName}`
  const finishVideo = (input: string): void => {
    const adjustmentFilter = videoAdjustmentFilter(meta, videoAdjustments)
    const adjustedInput = adjustmentFilter ? 'adjusted' : input
    if (adjustmentFilter) lines.push(`[${input}]${adjustmentFilter}[adjusted]`)
    if (portraitBlur) appendPortraitFrame(lines, adjustedInput, meta.w, meta.h, coAss ? assFilter : undefined)
    else lines.push(`[${adjustedInput}]${coAss ? assFilter : 'null'}[out]`)
  }

  if (hasVideoFilters) {
    const N = validRegions.length
    const w = meta.w > 0 ? meta.w : 1280
    const h = meta.h > 0 ? meta.h : 720

    if (N > 0) {
      // 1. Split luong goc in canonical display-space thành (N + 1) luong doc lap
      const splitLabels = Array.from({ length: N }, (_, i) => `[c${i}]`).join('')
      lines.push(`[${videoInput}]split=${N + 1}[main]${splitLabels}`)

      // 2. Crop va gblur doc lap cho tung vung tu luong [c${i}]
      for (let i = 0; i < N; i++) {
        const r = validRegions[i]
        let x = Math.max(0, r.x0)
        let bw = Math.min(w - x, r.x1 - r.x0)
        let y = Math.max(0, r.y0)
        let bh = Math.min(h - y, r.y1 - r.y0)

        x -= x % 2
        bw -= bw % 2
        if (bw < 2) bw = 2
        if (x + bw > w) bw = Math.max(2, w - x - ((w - x) % 2))

        y -= y % 2
        bh -= bh % 2
        if (bh < 2) bh = 2
        if (y + bh > h) bh = Math.max(2, h - y - ((h - y) % 2))

        lines.push(`[c${i}]crop=${bw}:${bh}:${x}:${y},gblur=sigma=${sigma}:steps=3[b${i}]`)
      }

      // 3. Overlay noi tiep lan luot cac vung mo len luong [main]
      let prev = 'main'
      for (let i = 0; i < N; i++) {
        const r = validRegions[i]
        let x = Math.max(0, r.x0)
        let y = Math.max(0, r.y0)
        x -= x % 2
        y -= y % 2

        const outLbl = i === N - 1 && !coAss && !portraitBlur && !videoAdjustmentActive ? '[out]' : `[v${i + 1}]`
        lines.push(`[${prev}][b${i}]overlay=${x}:${y}${outLbl}`)
        prev = `v${i + 1}`
      }

      // 4. Ghep phu de neu co
      if (coAss || portraitBlur || videoAdjustmentActive) {
        finishVideo(prev)
      }
    } else {
      // Chi co ass, khong co blur
      finishVideo(videoInput)
    }
  }

  // Phối trộn âm thanh
  const audio = buildAudioFilter(meta, hasAudioFile ? 1 : null, batAmThanh, audioVolume)
  if (hasVideoFilters) {
    if (audio.filter) lines.push(audio.filter)
    return ['-filter_complex', lines.join(';'), '-map', '[out]', ...audio.mapArgs]
  } else {
    if (audio.filter) {
      return ['-filter_complex', audio.filter, '-map', '0:v', ...audio.mapArgs]
    }
    return []
  }
}

/**
 * Filter complex for automatic OCR mask blur.
 */
export function taoFilterComplexAutomatic(
  meta: Meta,
  plan: BurnInputPlan,
  coAss: boolean,
  assName: string,
  batAmThanh = false,
  audioVolume = 100,
  fontsDir: string | null = null,
  portraitBlur = false,
  videoAdjustments = normalizeVideoAdjustments(undefined)
): string[] {
  if (plan.maskVideoIndex == null) {
    throw new Error('Cần có mask index cho automatic filter complex.')
  }
  const sigma = ocrBlurSigmaForDisplayHeight(meta.h)
  const lines: string[] = []
  const canonicalFilter = canonicalDisplayVideoFilter(meta)
  if (canonicalFilter) {
    lines.push(`[0:v]${canonicalFilter},format=gbrp[display]`)
  } else {
    // maskedmerge is not reliable on the source video's subsampled YUV
    // planes: a white mask can leave a low-contrast copy of the glyph behind.
    // Use planar RGB for the blend, then let the selected encoder convert back
    // to the delivery pixel format.
    lines.push('[0:v]null,format=gbrp[display]')
  }

  lines.push('[display]split=2[base][blur_source]')
  // Six passes keep fine glyph edges from surviving the privacy blur, while
  // the mask still limits the effect to OCR-recognized regions.
  lines.push(`[blur_source]gblur=sigma=${sigma}:steps=6[blurred]`)
  lines.push(`[${plan.maskVideoIndex}:v]format=gray,settb=AVTB,setpts=PTS-STARTPTS[mask]`)

  const durationSec = meta.videoDurationSeconds ?? meta.videoDuration ?? meta.giay
  const durationStr = Math.max(0.1, durationSec).toFixed(3)
  lines.push(`[base][blurred][mask]maskedmerge,trim=duration=${durationStr}[masked]`)

  const adjustmentFilter = videoAdjustmentFilter(meta, videoAdjustments)
  const adjustedInput = adjustmentFilter ? 'adjusted' : 'masked'
  if (adjustmentFilter) lines.push(`[masked]${adjustmentFilter}[adjusted]`)

  if (portraitBlur) {
    const assFilter = fontsDir
      ? `ass=${assName}:fontsdir=${escapeFfmpegFilterPath(fontsDir)}`
      : `ass=${assName}`
    appendPortraitFrame(lines, adjustedInput, meta.w, meta.h, coAss ? assFilter : undefined)
  } else if (coAss) {
    const assFilter = fontsDir
      ? `ass=${assName}:fontsdir=${escapeFfmpegFilterPath(fontsDir)}`
      : `ass=${assName}`
    lines.push(`[${adjustedInput}]${assFilter}[out]`)
  } else {
    lines.push(`[${adjustedInput}]null[out]`)
  }

  const audio = buildAudioFilter(meta, plan.narrationAudioIndex, batAmThanh, audioVolume)
  if (audio.filter) {
    lines.push(audio.filter)
  }
  return ['-filter_complex', lines.join(';'), '-map', '[out]', ...audio.mapArgs]
}

/** Chay 1 lan ffmpeg, bao tien do theo `time=` tren stderr. */
async function chay(
  ff: string,
  args: string[],
  cwd: string,
  meta: Meta,
  onProgress: (p: BurnProgress) => void,
  signal?: AbortSignal
): Promise<number | null> {
  if (daHuy || signal?.aborted) return null
  return new Promise((resolve) => {
    const p = spawnBurnChild(spawn(ff, args, { cwd, windowsHide: true, shell: false }))
    child = p
    let errTail = ''
    const onAbort = () => {
      terminateProcessTree(p)
      resolve(null)
    }
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }
    p.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      const lines = s.split(/\r?\n/)
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        
        // Neu chua thong tin thoi gian thi cap nhat tien do
        const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(trimmed)
        if (m && meta.giay > 0) {
          const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
          onProgress({ percent: Math.min(99, Math.round((sec / meta.giay) * 100)) })
        }
        
        // Log chan doan loi font/ass tu FFmpeg
        const lower = trimmed.toLowerCase()
        if (
          lower.includes('ass') ||
          lower.includes('font') ||
          lower.includes('error') ||
          lower.includes('warning') ||
          lower.includes('failed')
        ) {
          logInfo(`[ffmpeg] ${trimmed}`)
        }
      }
      const last = s.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
      if (last) errTail = last
    })
    p.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      debugRaw('burn spawn', err)
      if (child === p) child = null
      burnChildren.delete(p)
      resolve(-1)
    })
    p.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      if (child === p) child = null
      burnChildren.delete(p)
      if (code !== 0 && errTail) debugRaw('burn close', errTail)
      resolve(code)
    })
  })
}

async function duLon(f: string): Promise<boolean> {
  try {
    return (await stat(f)).size > 4096 // nvenc hong -> file 0 byte / vai byte
  } catch {
    return false
  }
}

function burnOutputName(req: BurnReq): string {
  const sourceName = basename(req.video).replace(/\.[^.]+$/, '')
  return req.outputName?.trim() || `${sourceName}${req.mode === 'burn' ? '-phude' : '-phude-mem'}.mp4`
}

export interface RunBurnSubtitleLowerOptions {
  outputPath: string
  plan: BurnInputPlan
  timedMask?: TimedOcrBlurMask | null
  ffmpegPath?: string
  ffprobePath?: string
  signal?: AbortSignal
  cwd?: string
}

/**
 * Main-only lower rendering function.
 */
export async function runBurnSubtitleLower(
  req: BurnReq,
  options: RunBurnSubtitleLowerOptions,
  onProgress: (p: BurnProgress) => void
): Promise<BurnResult> {
  const ff = options.ffmpegPath || (await resolveFfmpeg())
  if (!ff) return { ok: false, error: 'Thiếu ffmpeg. Hãy chạy lại bước cài đặt.' }

  const hasSrt = Boolean(req.srt && req.srt.trim())
  const regions = req.blurRegions || []
  const hasBlur = Boolean(req.lamMo && regions.length > 0)
  const hasTimedMask = Boolean(options.timedMask)
  const hasAudioFile = Boolean(req.batAmThanh && req.amThanhFile)

  if (!hasSrt && !hasBlur && !hasTimedMask && !req.batAmThanh && !req.portraitBlur && !hasVideoAdjustments(req.videoAdjustments)) {
    return { ok: false, error: 'Vui lòng chọn ít nhất 1 vùng làm mờ, tải lên tệp phụ đề hoặc bật cấu hình âm thanh.' }
  }

  const output = options.outputPath
  const tam = options.cwd || join(tmpdir(), 'tblao-burn')
  await mkdir(tam, { recursive: true })
  const srtTam = join(tam, `sub-${randomUUID()}.srt`)
  const duongAss = join(tam, `sub-${randomUUID()}.ass`)
  const assBaseName = basename(duongAss)

  if (hasSrt && req.srt) {
    await copyFile(req.srt, srtTam)
  }

  try {
    const ffprobe = options.ffprobePath || duongFfprobe(ff)
    const meta = await doVideo(ffprobe, req.video)
    let bc: BoCuc | null = null
    let resolvedFont = resolveBurnFont(req.fontId)
    let picked = resolvedFont?.entry ?? null
    let fontsDir = resolvedFont?.fontsDir ?? null
    let subStyle: SubStyle | null = null

    if (hasSrt) {
      const srtRaw = docFileSrt(srtTam)
      const cues = docSrt(srtRaw)
      if (cues.length === 0) {
        return { ok: false, error: 'File phụ đề không có câu nào với mốc thời gian hợp lệ.' }
      }
      const effectReq = req as BurnReq & {
        subtitleDisplayStyle?: SubtitleDisplayStyle
        highlightColor?: string
        subtitleHighlightPop?: boolean
      }
      const explicitFontId = req.fontId?.trim()
      if (explicitFontId && explicitFontId !== 'auto' && !resolvedFont) {
        return {
          ok: false,
          error: 'Font phụ đề đã chọn không còn khả dụng. Hãy chọn lại font.'
        }
      }
      if (!resolvedFont) {
        resolvedFont = resolveAutomaticSubtitleFont(cues)
        picked = resolvedFont?.entry ?? null
        fontsDir = resolvedFont?.fontsDir ?? null
      }
      if (resolvedFont) {
        try {
          await readBurnFontPreview(resolvedFont.entry.id)
        } catch {
          return {
            ok: false,
            error: 'File font phụ đề đã thay đổi hoặc không còn tồn tại. Hãy chọn lại font.'
          }
        }
      }
      logInfo(`Dịch màn hình: đọc được ${cues.length} câu phụ đề.`)
      bc = boCuc(meta, req.subRegion, req.lamMo, req.subtitleFontSize)
      subStyle = styleFromReq(req, bc.vien)
      await writeFile(
        duongAss,
        taoAss(cues, meta, bc, picked?.family ?? null, subStyle, picked, {
          displayStyle: effectReq.subtitleDisplayStyle,
          highlightColor: effectReq.highlightColor,
          highlightPop: effectReq.subtitleHighlightPop,
          layoutProfile: effectReq.subtitleLayoutProfile,
          autoOptimize: effectReq.subtitleAutoOptimize,
          wordTimings: effectReq.wordTimings,
          requireWordTimings: effectReq.requireWordTimings
        }),
        'utf8'
      )
      if (picked) {
        logInfo(`Dịch màn hình: font phụ đề «${picked.label}» (${picked.family}).`)
      }
    }

    let filterArgs: string[] = []
    if (hasTimedMask) {
      filterArgs = taoFilterComplexAutomatic(
        meta,
        options.plan,
        hasSrt,
        assBaseName,
        req.batAmThanh ?? false,
        req.amLuongGoc ?? 100,
        fontsDir,
        req.portraitBlur === true,
        req.videoAdjustments
      )
    } else {
      filterArgs = taoFilterComplex(
        meta,
        regions,
        req.lamMo ?? false,
        hasSrt,
        assBaseName,
        req.batAmThanh ?? false,
        hasAudioFile,
        req.amLuongGoc ?? 100,
        fontsDir,
        req.portraitBlur === true,
        req.videoAdjustments
      )
    }

    logInfo(`Dịch màn hình: đang xử lý video ${basename(req.video)}…`)
    if (filterArgs.length > 0) {
      debugRaw('burn filter_complex', filterArgs.join(' '))
    }

    const encoders: Array<{ ten: string; gpu: boolean; args: string[] }> = [
      { ten: 'h264_nvenc', gpu: true, args: ['-c:v', 'h264_nvenc', '-pix_fmt', 'yuv420p', '-preset', 'p4', '-cq', '23'] },
      { ten: 'h264_amf', gpu: true, args: ['-c:v', 'h264_amf', '-pix_fmt', 'yuv420p', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23'] },
      { ten: 'h264_qsv', gpu: true, args: ['-c:v', 'h264_qsv', '-pix_fmt', 'yuv420p', '-global_quality', '23'] },
      { ten: 'libx264', gpu: false, args: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20'] }
    ]

    for (const enc of encoders) {
      if (daHuy || options.signal?.aborted) break

      const inputArgs = ['-y', ...options.plan.inputArgs]
      const dungFilterAudio = req.batAmThanh && (meta.hasAudio || hasAudioFile)
      const audioCodecArgs = dungFilterAudio ? ['-c:a', 'aac'] : ['-c:a', 'copy']

      const args = filterArgs.length > 0
        ? [...inputArgs, ...filterArgs, ...enc.args, ...audioCodecArgs, output]
        : [...inputArgs, ...enc.args, ...audioCodecArgs, output]

      const code = await chay(ff, args, tam, meta, onProgress, options.signal)
      if (daHuy || options.signal?.aborted) {
        return { ok: false, error: 'Đã huỷ.' }
      }
      if (code === 0 && (await duLon(output))) {
        logInfo(`Dịch màn hình: xử lý video xong${enc.gpu ? ' (tăng tốc GPU)' : ''}.`)
        return { ok: true, output }
      }
    }

    return { ok: false, error: 'Xử lý video thất bại.' }
  } finally {
    if (hasSrt) {
      await rm(srtTam, { force: true }).catch(() => {})
      await rm(duongAss, { force: true }).catch(() => {})
    }
  }
}

/**
 * Ghep phu de / Lam mo video.
 */
async function runBurnSubtitle(
  req: BurnReq,
  onProgress: (p: BurnProgress) => void
): Promise<BurnResult> {
  const ff = await resolveFfmpeg()
  if (!ff) return { ok: false, error: 'Thiếu ffmpeg. Hãy chạy lại bước cài đặt.' }

  const hasSrt = Boolean(req.srt && req.srt.trim())
  const regions = req.blurRegions || []
  const hasBlur = Boolean(req.lamMo && regions.length > 0)
  const hasAudioFile = Boolean(req.batAmThanh && req.amThanhFile)

  if (!hasSrt && !hasBlur && !req.batAmThanh && !req.portraitBlur && !hasVideoAdjustments(req.videoAdjustments)) {
    return { ok: false, error: 'Vui lòng chọn ít nhất 1 vùng làm mờ, tải lên tệp phụ đề hoặc bật cấu hình âm thanh.' }
  }

  const output = join(req.outputDir, burnOutputName(req))

  const tam = join(tmpdir(), 'tblao-burn')
  await mkdir(tam, { recursive: true })
  const srtTam = join(tam, 'sub.srt')

  if (hasSrt && req.srt) {
    await copyFile(req.srt, srtTam)
  }

  if ((req.portraitBlur || hasVideoAdjustments(req.videoAdjustments)) && req.mode === 'soft') {
    return { ok: false, error: 'Chỉnh hình ảnh cần chế độ xuất video có xử lý hình ảnh.' }
  }
  if (hasSrt && req.mode === 'soft') {
    logInfo(`Dịch màn hình: gắn phụ đề rời vào ${basename(req.video)}…`)
    
    const args = ['-y', '-i', req.video, '-i', 'sub.srt']
    if (hasAudioFile) {
      args.push('-i', req.amThanhFile!)
    }

    const meta = await doVideo(duongFfprobe(ff), req.video)
    if (req.catSrt && meta.giay > 0) {
      const cues = docSrt(docFileSrt(srtTam))
      await writeFile(srtTam, catSrtTheoVideo(cues, meta.giay), 'utf8')
      logInfo('Dịch màn hình: đã cắt phụ đề cho vừa độ dài video.')
    }

    if (req.batAmThanh) {
      const outputDuration = Math.max(0.1, meta.giay).toFixed(3)
      if (meta.hasAudio) {
        const vol = originalAudioGain(req.amLuongGoc ?? 100)
        if (hasAudioFile) {
          if (vol <= 0.0001) {
            // REPLACE mode
            args.push(
              '-filter_complex', `[2:a]asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,volume=1.0,apad=whole_dur=${outputDuration},atrim=duration=${outputDuration},alimiter=limit=-1dB:attack=5:release=50:level=false[a_mix]`,
              '-map', '0:v', '-map', '1:s', '-map', '[a_mix]',
              '-c:v', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie',
              '-c:a', 'aac'
            )
          } else {
            // MIX mode
            args.push(
              '-filter_complex', `[0:a]asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,volume=${vol}[a0];[2:a]asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,volume=1.0[a1];[a0][a1]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0[a_sum];[a_sum]alimiter=limit=-1dB:attack=5:release=50,apad=whole_dur=${outputDuration},atrim=duration=${outputDuration}[a_mix]`,
              '-map', '0:v', '-map', '1:s', '-map', '[a_mix]',
              '-c:v', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie',
              '-c:a', 'aac'
            )
          }
        } else {
          // Chỉ chỉnh âm lượng gốc
          args.push(
            '-filter_complex', `[0:a]asetpts=PTS-STARTPTS,volume=${vol},apad=whole_dur=${outputDuration},atrim=duration=${outputDuration}[a_mix]`,
            '-map', '0:v', '-map', '1:s', '-map', '[a_mix]',
            '-c:v', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie',
            '-c:a', 'aac'
          )
        }
      } else {
        // Video gốc câm
        if (hasAudioFile) {
          args.push(
            '-filter_complex', `[2:a]asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,apad=whole_dur=${outputDuration},atrim=duration=${outputDuration},alimiter=limit=-1dB:attack=5:release=50:level=false[a_mix]`,
            '-map', '0:v', '-map', '1:s', '-map', '[a_mix]',
            '-c:v', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie',
            '-c:a', 'aac'
          )
        } else {
          args.push(
            '-map', '0:v', '-map', '1:s',
            '-c:v', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie'
          )
        }
      }
    } else {
      args.push(
        '-c', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie'
      )
    }

    args.push(output)

    const code = await chay(ff, args, tam, meta, onProgress)
    if (hasSrt) await rm(srtTam, { force: true })
    if (daHuy) return { ok: false, error: 'Đã huỷ.' }
    if (code === 0 && (await duLon(output))) {
      logInfo('Dịch màn hình: gắn phụ đề rời xong.')
      return { ok: true, output }
    }
    return { ok: false, error: 'Ghép phụ đề thất bại.' }
  }

  // Hard burn path:
  const plan = planBurnInputs({
    sourceVideo: req.video,
    narrationAudio: hasAudioFile ? req.amThanhFile! : undefined
  })

  return runBurnSubtitleLower(
    req,
    {
      outputPath: output,
      plan,
      cwd: tam
    },
    onProgress
  )
}

export async function validateRenderedMedia(
  filePath: string,
  expected: {
    durationSeconds: number
    frameRate?: number
    requireAudio: boolean
    durationToleranceFrames: number
  },
  ffmpegPath: string,
  ffprobePath: string,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) throw new Error('Đã huỷ.')

  const fileStat = await stat(filePath)
  if (fileStat.size <= 4096) {
    throw new Error(`File video quá nhỏ hoặc rỗng (${fileStat.size} bytes).`)
  }

  // 1. Decode test: ffmpeg -v error -i <filePath> -map 0:v:0 -f null -
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Đã huỷ.'))
    const p = spawnBurnChild(
      spawn(
        ffmpegPath,
        ['-v', 'error', '-i', filePath, '-map', '0:v:0', '-f', 'null', '-'],
        { windowsHide: true, shell: false }
      )
    )
    let stderr = ''
    const onAbort = () => {
      terminateProcessTree(p)
      reject(new Error('Đã huỷ.'))
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    p.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-1000)
    })
    p.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      burnChildren.delete(p)
      if (code === 0) resolve()
      else reject(new Error(`Giải mã video kiểm tra thất bại (code ${code}): ${stderr}`))
    })
    p.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      burnChildren.delete(p)
      reject(new Error(`Không thể chạy kiểm tra giải mã video: ${err.message}`))
    })
  })

  if (signal?.aborted) throw new Error('Đã huỷ.')

  // 2. FFprobe inspection
  const probeData = await new Promise<{ streams: any[]; format: any }>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Đã huỷ.'))
    const p = spawnBurnChild(
      spawn(
        ffprobePath,
        [
          '-v', 'error',
          '-show_entries', 'stream=index,codec_type,duration,r_frame_rate',
          '-show_entries', 'format=duration',
          '-of', 'json',
          filePath
        ],
        { windowsHide: true, shell: false }
      )
    )
    let stdout = ''
    let stderr = ''
    const onAbort = () => {
      terminateProcessTree(p)
      reject(new Error('Đã huỷ.'))
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    p.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    p.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    p.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      burnChildren.delete(p)
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout))
        } catch (e: any) {
          reject(new Error(`Không thể phân tích dữ liệu ffprobe: ${e.message}`))
        }
      } else {
        reject(new Error(`Kiểm tra thông tin video thất bại (code ${code}): ${stderr}`))
      }
    })
    p.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      burnChildren.delete(p)
      reject(new Error(`Không thể chạy ffprobe: ${err.message}`))
    })
  })

  // Validate streams
  const videoStreams = probeData.streams?.filter((s) => s.codec_type === 'video') ?? []
  if (videoStreams.length !== 1) {
    throw new Error(`Video xuất phải có đúng 1 luồng video, phát hiện ${videoStreams.length} luồng.`)
  }

  if (expected.requireAudio) {
    const audioStreams = probeData.streams?.filter((s) => s.codec_type === 'audio') ?? []
    if (audioStreams.length < 1) {
      throw new Error('Video xuất thiếu luồng âm thanh theo yêu cầu.')
    }
  }

  // Duration tolerance check
  const vStream = videoStreams[0]
  const probedDuration = Number(vStream.duration) || Number(probeData.format?.duration) || 0
  if (probedDuration <= 0) {
    throw new Error('Không thể xác định thời lượng video xuất.')
  }

  const durationTolerance = expected.frameRate && expected.frameRate > 0
    ? expected.durationToleranceFrames / expected.frameRate
    : 0.10
  if (Math.abs(probedDuration - expected.durationSeconds) > durationTolerance) {
    throw new Error(`Thời lượng video xuất (${probedDuration.toFixed(3)}s) lệch quá mức so với dự kiến (${expected.durationSeconds.toFixed(3)}s).`)
  }

  // Frame rate check
  if (expected.frameRate && expected.frameRate > 0 && vStream.r_frame_rate) {
    const [num, den] = vStream.r_frame_rate.split('/').map(Number)
    if (num && den && den > 0) {
      const actualFps = num / den
      if (Math.abs(actualFps - expected.frameRate) > 0.1) {
        throw new Error(`Tốc độ khung hình (${actualFps.toFixed(2)} fps) lệch quá mức so với dự kiến (${expected.frameRate.toFixed(2)} fps).`)
      }
    }
  }
}

export interface AutoShortBurnExecutionOptions {
  timedOcrBlurMask?: TimedOcrBlurMask | null
  ffmpegPath: string
  ffprobePath: string
  finalOutputPath: string
  itemWorkDir: string
  expectedMedia: {
    durationSeconds: number
    frameRate?: number
    requireAudio: boolean
    durationToleranceFrames: number
  }
  signal: AbortSignal
}

export async function burnAutoShort(
  request: Omit<BurnReq, 'outputDir' | 'outputName'>,
  options: AutoShortBurnExecutionOptions,
  onProgress: (progress: BurnProgress) => void
): Promise<BurnResult> {
  if (options.signal?.aborted) {
    throw new Error('Đã huỷ.')
  }

  if (request.mode !== 'burn') {
    throw new Error('Chế độ xuất video không hợp lệ.')
  }

  if (!isAbsolute(options.finalOutputPath) || !options.finalOutputPath.endsWith('.mp4')) {
    throw new Error('Đường dẫn file đầu ra phải là đường dẫn tuyệt đối với đuôi .mp4.')
  }

  const finalDir = dirname(options.finalOutputPath)
  const finalDirStat = await stat(finalDir)
  if (!finalDirStat.isDirectory()) {
    throw new Error('Thư mục lưu file đầu ra không tồn tại.')
  }

  // Pre-existing final check (no-clobber)
  try {
    await stat(options.finalOutputPath)
    throw new Error(`File đích đã tồn tại: ${options.finalOutputPath}`)
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err
  }

  // Reject simultaneous timed mask and active manual rectangles
  const hasManualRects = Boolean(
    request.lamMo &&
    request.blurRegions &&
    request.blurRegions.some((r) => r.x1 > r.x0 && r.y1 > r.y0)
  )
  if (options.timedOcrBlurMask && (hasManualRects || (request.blurRegions && request.blurRegions.length > 0))) {
    throw new Error('Không thể kết hợp mặt nạ OCR tự động và vùng làm mờ thủ công.')
  }

  if (!isAbsolute(options.itemWorkDir)) {
    throw new Error('Thư mục làm việc phải là đường dẫn tuyệt đối.')
  }
  const workDirStat = await stat(options.itemWorkDir)
  if (!workDirStat.isDirectory()) {
    throw new Error('Thư mục làm việc không tồn tại.')
  }

  if (options.timedOcrBlurMask) {
    await assertContainedRegularFile(options.timedOcrBlurMask.path, options.itemWorkDir, 'Mặt nạ OCR')
  }

  if (burnInFlight) {
    throw new Error('Một video khác đang được xuất. Hãy chờ hoàn tất hoặc dừng tác vụ đó.')
  }

  burnInFlight = true
  const finalStem = basename(options.finalOutputPath, '.mp4')
  const partialName = `.${finalStem}.${randomUUID()}.partial.mp4`
  const partialPath = join(finalDir, partialName)
  const titleController = new AbortController()
  const forwardTitleAbort = (): void => {
    if (!titleController.signal.aborted) titleController.abort(options.signal.reason)
  }
  if (options.signal.aborted) forwardTitleAbort()
  else options.signal.addEventListener('abort', forwardTitleAbort, { once: true })
  let preparedTitlePromise: Promise<PreparedVideoSeoMetadata | undefined> | undefined
  let published = false

  try {
    if (options.signal?.aborted) throw new Error('Đã huỷ.')

    const plan = planBurnInputs({
      sourceVideo: request.video,
      narrationAudio: request.batAmThanh && request.amThanhFile ? request.amThanhFile : undefined,
      timedMask: options.timedOcrBlurMask?.path
    })

    const renderReq: BurnReq = {
      ...request,
      outputDir: finalDir,
      outputName: partialName
    }

    // The final spoken SRT is known before rendering starts. Prepare the
    // optional title in parallel, but only commit it after the MP4 passes the
    // existing decode/probe gate below. If the render fails, the scope aborts
    // this request and the promise is drained in finally.
    if (renderReq.videoTitle && renderReq.srt) {
      try {
        const titleCues = trimSubtitleCues(
          docSrt(docFileSrt(renderReq.srt)),
          options.expectedMedia.durationSeconds
        )
        if (titleCues.length > 0) {
          preparedTitlePromise = prepareVideoSeoMetadata(titleCues, renderReq.videoTitle, titleController.signal)
            .catch(() => undefined)
        }
      } catch {
        // Title is optional; the render must continue even if its input SRT
        // cannot be read here. completeBurnVideoTitle will report the same
        // condition after publication.
      }
    }

    const renderRes = await runBurnSubtitleLower(
      renderReq,
      {
        outputPath: partialPath,
        plan,
        timedMask: options.timedOcrBlurMask,
        ffmpegPath: options.ffmpegPath,
        ffprobePath: options.ffprobePath,
        signal: options.signal,
        cwd: options.itemWorkDir
      },
      onProgress
    )

    if (!renderRes.ok) {
      throw new Error(renderRes.error || 'Xử lý video thất bại.')
    }

    if (options.signal?.aborted) throw new Error('Đã huỷ.')

    // Media pre-promotion validation
    await validateRenderedMedia(
      partialPath,
      options.expectedMedia,
      options.ffmpegPath,
      options.ffprobePath,
      options.signal
    )

    if (options.signal?.aborted) throw new Error('Đã huỷ.')

    // Re-verify final path still does not exist before atomic rename
    try {
      await stat(options.finalOutputPath)
      throw new Error(`File đích đã tồn tại: ${options.finalOutputPath}`)
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }

    await rename(partialPath, options.finalOutputPath)
    published = true

    // Auto Short renders through this lower-level path instead of
    // burnSubtitle(), so it must explicitly run the optional title stage
    // after the MP4 has been atomically published.
    return await completeBurnVideoTitle(
      { ok: true, output: options.finalOutputPath },
      renderReq,
      onProgress,
      options.signal,
      {
        probe: (video) => doVideo(options.ffprobePath, video),
        prepared: preparedTitlePromise
      }
    )
  } finally {
    if (!published) titleController.abort(new Error('Render thất bại trước khi commit title.'))
    await preparedTitlePromise?.catch(() => {})
    options.signal.removeEventListener('abort', forwardTitleAbort)
    burnInFlight = false
    try {
      await rm(partialPath, { force: true })
    } catch {
      // ignore
    }
  }
}

type BurnValidation = { ok: true; req: BurnReq } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') && isAbsolute(value)
}

function validateRegion(value: unknown, label: string): string | null {
  if (!isRecord(value)) return `${label} không hợp lệ.`
  const coordinates = ['x0', 'y0', 'x1', 'y1'] as const
  for (const key of coordinates) {
    const coordinate = value[key]
    if (typeof coordinate !== 'number' || !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1_000_000) {
      return `${label} có tọa độ không hợp lệ.`
    }
  }
  if ((value.x1 as number) <= (value.x0 as number) || (value.y1 as number) <= (value.y0 as number)) {
    return `${label} phải có chiều rộng và chiều cao lớn hơn 0.`
  }
  return null
}

export async function validateBurnRequest(raw: unknown): Promise<BurnValidation> {
  if (!isRecord(raw)) return { ok: false, error: 'Yêu cầu xuất video không hợp lệ.' }

  const sensitiveKeys = ['timedOcrBlurMask', 'maskPath', 'visualCuesPath', 'visualTimeline']
  for (const key of sensitiveKeys) {
    if (key in raw) {
      return { ok: false, error: `Tham số ${key} không được phép gửi qua yêu cầu render.` }
    }
  }

  if (raw.mode !== 'burn' && raw.mode !== 'soft') {
    return { ok: false, error: 'Chế độ xuất video không hợp lệ.' }
  }
  if (!validAbsolutePath(raw.video) || !validAbsolutePath(raw.outputDir)) {
    return { ok: false, error: 'Đường dẫn video hoặc thư mục lưu không hợp lệ.' }
  }

  try {
    const [videoInfo, outputInfo] = await Promise.all([stat(raw.video), stat(raw.outputDir)])
    if (!videoInfo.isFile() || videoInfo.size <= 0) {
      return { ok: false, error: 'Video nguồn không tồn tại hoặc không hợp lệ.' }
    }
    if (!outputInfo.isDirectory()) {
      return { ok: false, error: 'Thư mục lưu video không còn tồn tại.' }
    }
  } catch {
    return { ok: false, error: 'Không thể mở video nguồn hoặc thư mục lưu đã chọn.' }
  }

  if (raw.srt != null && typeof raw.srt !== 'string') {
    return { ok: false, error: 'Đường dẫn phụ đề không hợp lệ.' }
  }
  const subtitlePath = typeof raw.srt === 'string' ? raw.srt.trim() : ''
  if (subtitlePath) {
    if (!validAbsolutePath(subtitlePath)) return { ok: false, error: 'Đường dẫn phụ đề không hợp lệ.' }
    try {
      const subtitleInfo = await stat(subtitlePath)
      if (!subtitleInfo.isFile() || subtitleInfo.size <= 0 || subtitleInfo.size > 20 * 1024 * 1024) {
        return { ok: false, error: 'File phụ đề không hợp lệ hoặc lớn hơn 20 MB.' }
      }
    } catch {
      return { ok: false, error: 'File phụ đề không còn tồn tại.' }
    }
  }

  if (raw.videoTitle != null) {
    const titleConfigError = validateVideoTitleConfig(raw.videoTitle)
    if (titleConfigError) return { ok: false, error: titleConfigError }
    if (!subtitlePath) {
      return { ok: false, error: 'Cần chọn file SRT để AI tạo tiêu đề cho video.' }
    }
    try {
      if (docSrt(docFileSrt(subtitlePath)).length === 0) {
        return { ok: false, error: 'File SRT chưa có nội dung hợp lệ để AI tạo tiêu đề.' }
      }
    } catch {
      return { ok: false, error: 'Không thể đọc file SRT để AI tạo tiêu đề.' }
    }
  }

  if (raw.amThanhFile != null && typeof raw.amThanhFile !== 'string') {
    return { ok: false, error: 'Đường dẫn âm thanh không hợp lệ.' }
  }
  const audioPath = typeof raw.amThanhFile === 'string' ? raw.amThanhFile.trim() : ''
  if (raw.batAmThanh === true && audioPath) {
    if (!validAbsolutePath(audioPath)) return { ok: false, error: 'Đường dẫn âm thanh không hợp lệ.' }
    try {
      const audioInfo = await stat(audioPath)
      if (!audioInfo.isFile() || audioInfo.size <= 0) {
        return { ok: false, error: 'File âm thanh không hợp lệ.' }
      }
    } catch {
      return { ok: false, error: 'File âm thanh không còn tồn tại.' }
    }
  }

  if (raw.blurRegions != null) {
    if (!Array.isArray(raw.blurRegions) || raw.blurRegions.length > 32) {
      return { ok: false, error: 'Danh sách vùng làm mờ không hợp lệ hoặc quá nhiều.' }
    }
    for (const [index, region] of raw.blurRegions.entries()) {
      const error = validateRegion(region, `Vùng làm mờ ${index + 1}`)
      if (error) return { ok: false, error }
    }
  }
  if (raw.subRegion != null) {
    const error = validateRegion(raw.subRegion, 'Khung phụ đề')
    if (error) return { ok: false, error }
  }
  if (raw.videoAdjustments != null) {
    if (!isRecord(raw.videoAdjustments)) return { ok: false, error: 'Cấu hình chỉnh hình ảnh không hợp lệ.' }
    try {
      normalizeVideoAdjustments(raw.videoAdjustments)
    } catch {
      return { ok: false, error: 'Cấu hình chỉnh hình ảnh không hợp lệ.' }
    }
  }

  const booleans = [
    'portraitBlur',
    'lamMo',
    'catSrt',
    'batAmThanh',
    'bgEnabled',
    'subtitleAutoOptimize',
    'subtitleHighlightPop',
    'requireWordTimings'
  ] as const
  for (const key of booleans) {
    if (raw[key] != null && typeof raw[key] !== 'boolean') {
      return { ok: false, error: `Giá trị ${key} không hợp lệ.` }
    }
  }
  const boundedNumbers: Array<[keyof BurnReq, number, number]> = [
    ['amLuongGoc', 0, 100],
    ['outlinePx', 0, 8],
    ['bgOpacity', 0, 100],
    ['subtitleFontSize', 1, 500],
    ['subtitleFontScale', 0.1, 10],
    ['outlineScale', 0, 10],
    ['bandTop', 0, 10000],
    ['bandBot', 0, 10000],
    ['bandLeft', 0, 10000],
    ['bandRight', 0, 10000]
  ]
  for (const [key, minimum, maximum] of boundedNumbers) {
    const value = raw[key]
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum)) {
      return { ok: false, error: `Giá trị ${String(key)} không hợp lệ.` }
    }
  }
  if (
    raw.subtitleDisplayStyle != null &&
    raw.subtitleDisplayStyle !== 'standard' &&
    raw.subtitleDisplayStyle !== 'word-reveal' &&
    raw.subtitleDisplayStyle !== 'word-highlight'
  ) {
    return { ok: false, error: 'Kiểu hiển thị phụ đề không hợp lệ.' }
  }
  if (
    raw.subtitleLayoutProfile != null &&
    raw.subtitleLayoutProfile !== 'readable' &&
    raw.subtitleLayoutProfile !== 'social' &&
    raw.subtitleLayoutProfile !== 'vertical'
  ) {
    return { ok: false, error: 'Cau hinh toi uu phu de khong hop le.' }
  }
  if (raw.fontId != null && (typeof raw.fontId !== 'string' || raw.fontId.length > 100)) {
    return { ok: false, error: 'Font phụ đề không hợp lệ.' }
  }
  if (raw.wordTimings != null) {
    if (!Array.isArray(raw.wordTimings) || raw.wordTimings.length > 20_000) {
      return { ok: false, error: 'Word timing phụ đề không hợp lệ.' }
    }
    for (const timing of raw.wordTimings) {
      if (!isRecord(timing) || !Array.isArray(timing.words) || timing.words.length > 500 ||
        !Number.isFinite(timing.start) || !Number.isFinite(timing.end) || Number(timing.end) <= Number(timing.start)) {
        return { ok: false, error: 'Word timing phụ đề không hợp lệ.' }
      }
      if (timing.words.some((word) => !isRecord(word) || typeof word.text !== 'string' ||
        !Number.isFinite(word.start) || !Number.isFinite(word.end) || Number(word.end) <= Number(word.start))) {
        return { ok: false, error: 'Từ trong word timing không hợp lệ.' }
      }
    }
  }
  if (raw.outputName != null &&
    (typeof raw.outputName !== 'string' || raw.outputName.length > 200 ||
      raw.outputName !== basename(raw.outputName) || raw.outputName.includes('\0') ||
      raw.outputName === '.' || raw.outputName === '..' || /[<>:"/\\|?*]/.test(raw.outputName))) {
    return { ok: false, error: 'Tên file đầu ra không hợp lệ.' }
  }

  const req: BurnReq = {
    video: raw.video as string,
    srt: subtitlePath || null,
    outputDir: raw.outputDir as string,
    mode: raw.mode as 'burn' | 'soft',
    ...(raw.outputName != null ? { outputName: raw.outputName as string } : {}),
    ...(raw.bandTop != null ? { bandTop: raw.bandTop as number } : {}),
    ...(raw.bandBot != null ? { bandBot: raw.bandBot as number } : {}),
    ...(raw.bandLeft != null ? { bandLeft: raw.bandLeft as number } : {}),
    ...(raw.bandRight != null ? { bandRight: raw.bandRight as number } : {}),
    ...(raw.blurRegions != null ? { blurRegions: raw.blurRegions as BlurRegion[] } : {}),
    ...(raw.portraitBlur != null ? { portraitBlur: raw.portraitBlur as boolean } : {}),
    videoAdjustments: normalizeVideoAdjustments(raw.videoAdjustments as any),
    ...(raw.lamMo != null ? { lamMo: raw.lamMo as boolean } : {}),
    ...(raw.subRegion != null ? { subRegion: raw.subRegion as any } : {}),
    ...(raw.catSrt != null ? { catSrt: raw.catSrt as boolean } : {}),
    ...(raw.batAmThanh != null ? { batAmThanh: raw.batAmThanh as boolean } : {}),
    amThanhFile: audioPath || null,
    ...(raw.amLuongGoc != null ? { amLuongGoc: raw.amLuongGoc as number } : {}),
    ...(raw.fontId != null ? { fontId: raw.fontId as string } : {}),
    ...(raw.textColor != null ? { textColor: raw.textColor as string } : {}),
    ...(raw.outlineColor != null ? { outlineColor: raw.outlineColor as string } : {}),
    ...(raw.outlinePx != null ? { outlinePx: raw.outlinePx as number } : {}),
    ...(raw.bgEnabled != null ? { bgEnabled: raw.bgEnabled as boolean } : {}),
    ...(raw.bgColor != null ? { bgColor: raw.bgColor as string } : {}),
    ...(raw.bgOpacity != null ? { bgOpacity: raw.bgOpacity as number } : {}),
    ...(raw.subtitleDisplayStyle != null ? { subtitleDisplayStyle: raw.subtitleDisplayStyle as SubtitleDisplayStyle } : {}),
    ...(raw.highlightColor != null ? { highlightColor: raw.highlightColor as string } : {}),
    ...(raw.subtitleHighlightPop != null ? { subtitleHighlightPop: raw.subtitleHighlightPop as boolean } : {}),
    ...(raw.subtitleLayoutProfile != null ? { subtitleLayoutProfile: raw.subtitleLayoutProfile as SubtitleLayoutProfile } : {}),
    ...(raw.subtitleAutoOptimize != null ? { subtitleAutoOptimize: raw.subtitleAutoOptimize as boolean } : {}),
    ...(raw.subtitleFontSize != null ? { subtitleFontSize: raw.subtitleFontSize as number } : {}),
    ...(raw.wordTimings != null ? { wordTimings: raw.wordTimings as any } : {}),
    ...(raw.requireWordTimings != null ? { requireWordTimings: raw.requireWordTimings as boolean } : {}),
    ...(raw.subtitleFontScale != null ? { subtitleFontScale: raw.subtitleFontScale as number } : {}),
    ...(raw.outlineScale != null ? { outlineScale: raw.outlineScale as number } : {}),
    ...(raw.videoTitle != null ? { videoTitle: raw.videoTitle as any } : {})
  }

  return {
    ok: true,
    req
  }
}

interface BurnVideoTitleDependencies {
  probe: typeof probeBurnMedia
  readSubtitle: typeof docFileSrt
  generate: typeof generateVideoSeoMetadata
  write: typeof writeVideoSeoMetadata
  prepared?: PreparedVideoSeoMetadata | Promise<PreparedVideoSeoMetadata | undefined>
}

/** Complete an already rendered video without losing it if the optional title fails. */
export async function completeBurnVideoTitle(
  result: BurnResult,
  req: BurnReq,
  onProgress: (p: BurnProgress) => void,
  signal: AbortSignal,
  dependencies: Partial<BurnVideoTitleDependencies> = {}
): Promise<BurnResult> {
  if (!result.ok || !result.output || !req.videoTitle) return result
  const io: BurnVideoTitleDependencies = {
    probe: probeBurnMedia,
    readSubtitle: docFileSrt,
    generate: generateVideoSeoMetadata,
    write: writeVideoSeoMetadata,
    ...dependencies
  }
  let stage: 'subtitle' | 'generate' | 'write' = 'subtitle'
  try {
    signal.throwIfAborted()
    onProgress({ percent: 99, message: 'Video đã render xong, AI đang hoàn thiện tiêu đề từ SRT…' })
    const outputMeta = await io.probe(result.output)
    signal.throwIfAborted()
    // Soft subtitles can extend container duration beyond the actual video stream.
    const duration = [outputMeta.videoDurationSeconds, outputMeta.videoDuration, outputMeta.giay]
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    if (duration == null || !req.srt) {
      return { ...result, titleError: 'Video đã xuất thành công nhưng chưa xác định được nội dung SRT theo thời lượng video để tạo tiêu đề.' }
    }
    const cues = trimSubtitleCues(docSrt(io.readSubtitle(req.srt)), duration)
    if (cues.length === 0) {
      return { ...result, titleError: 'Video đã xuất thành công nhưng SRT không có nội dung trong thời lượng video để tạo tiêu đề.' }
    }
    const prepared = io.prepared
      ? await Promise.resolve(io.prepared).catch(() => undefined)
      : undefined
    const actualDigest = buildVideoSeoInputDigest(cues, req.videoTitle)
    let metadata
    if (prepared?.inputDigest === actualDigest && prepared.metadata) {
      metadata = prepared.metadata
    } else if (prepared?.inputDigest === actualDigest && prepared.error) {
      return { ...result, titleError: prepared.error }
    } else {
      // A duration/probe difference invalidates the prepared request. Reuse
      // the existing generator once with the exact post-probe cue window.
      stage = 'generate'
      metadata = await io.generate(cues, req.videoTitle, signal)
    }
    signal.throwIfAborted()
    formatVideoSeoMetadata(metadata)
    stage = 'write'
    const titlePath = await io.write(result.output, metadata, req.outputDir)
    return { ...result, title: metadata.title, titlePath, seoMetadata: metadata }
  } catch {
    if (signal.aborted) {
      return { ...result, titleError: 'Video đã xuất thành công. Đã dừng tạo tiêu đề; chưa lưu tieude.txt.' }
    }
    const titleError = stage === 'write'
      ? 'Video đã xuất thành công nhưng không lưu được tieude.txt. Hãy kiểm tra quyền ghi và file tiêu đề đã có trong thư mục video.'
      : stage === 'generate'
        ? 'Video đã xuất thành công nhưng AI chưa tạo được tiêu đề. Hãy kiểm tra cấu hình AI và kết nối rồi thử lại.'
        : 'Video đã xuất thành công nhưng không đọc được SRT hoặc thời lượng video để tạo tiêu đề.'
    return { ...result, titleError }
  }
}

/** Chặn hai yêu cầu dùng chung tiến trình/temp workspace làm hỏng kết quả của nhau. */
export async function burnSubtitle(
  req: BurnReq,
  onProgress: (p: BurnProgress) => void
): Promise<BurnResult> {
  if (burnInFlight) {
    return { ok: false, error: 'Một video khác đang được xuất. Hãy chờ hoàn tất hoặc dừng tác vụ đó.' }
  }
  burnInFlight = true
  daHuy = false
  const controller = new AbortController()
  burnAbortController = controller
  try {
    const validation = await validateBurnRequest(req as unknown)
    if (validation.ok === false) return { ok: false, error: validation.error }
    if (controller.signal.aborted) return { ok: false, error: 'Đã huỷ.' }
    let renderReq = validation.req
    if (renderReq.videoTitle) {
      try {
        const outputDir = await reserveVideoTitleOutputDir(renderReq.outputDir, burnOutputName(renderReq))
        renderReq = { ...renderReq, outputDir }
      } catch {
        return { ok: false, error: 'Không tạo được thư mục riêng để lưu video và tieude.txt. Hãy kiểm tra thư mục lưu đã chọn.' }
      }
      if (controller.signal.aborted) return { ok: false, error: 'Đã huỷ.' }
    }
    const result = await runBurnSubtitle(renderReq, onProgress)
    return await completeBurnVideoTitle(result, renderReq, onProgress, controller.signal)
  } finally {
    burnAbortController = null
    burnInFlight = false
  }
}
