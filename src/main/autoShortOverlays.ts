import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import { normalizeAutoShortOverlays, overlayTextGeometry, type AutoShortOverlayImageAsset, type AutoShortOverlays } from '../shared/autoShortOverlays'
import { formatAssTimestamp } from '../shared/subtitles'
import { createTextMeasurer } from './fontMeasure'
import { resolveSubtitlePlanFont } from './subtitlePlanner'
import { escapeFfmpegFilterPath, readBurnFontPreview } from './fonts'
import opentype from 'opentype.js'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export async function readAutoShortOverlayImage(path: string, expectedSha256?: string) {
  if (!/\.(png|jpe?g)$/i.test(path) || path.split(/[\\/]/).includes('..')) throw new Error('Chỉ hỗ trợ ảnh PNG/JPG.')
  const safe = await assertContainedRegularFile(path, dirname(path), 'Ảnh chèn')
  const info = await stat(safe)
  if (info.size <= 0 || info.size > MAX_IMAGE_BYTES) throw new Error('Ảnh chèn phải có dung lượng từ 1 byte đến 20 MB.')
  const bytes = await readFile(safe)
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Ảnh chèn vượt quá 20 MB.')
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (!png && !jpeg) throw new Error('File ảnh chèn không phải PNG/JPG hợp lệ.')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (expectedSha256 && sha256 !== expectedSha256) throw new Error('Ảnh chèn đã thay đổi. Hãy chọn lại ảnh trước khi chạy AutoShort.')
  return { bytes, asset: { path: safe, sha256 } satisfies AutoShortOverlayImageAsset, extension: png ? '.png' : '.jpg' }
}

export interface PreparedAutoShortOverlays {
  image?: { path: string; inputIndex: number; width: number; x: number; y: number; opacity: number }
  textFilter?: string
}

/** Escape literal user text so ASS overrides and newline escapes cannot execute. */
export function escapeOverlayAssText(text: string): string {
  return text.replace(/\\/g, '\\\u2060').replace(/\{/g, '\\{').replace(/\}/g, '\\}')
}

export function overlayAssDocument(width: number, height: number, duration: number,
  text: NonNullable<AutoShortOverlays['text']>, family: string,
  measure: (value: string, size: number) => number, assEmScale = 1): string {
  const geometry = overlayTextGeometry(width, height, text, measure)
  const alpha = Math.round(255 * (1 - text.opacity)).toString(16).padStart(2, '0')
  const rgb = text.color.slice(1)
  const color = `&H${alpha}${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`
  const font = family.replace(/[,\r\n]/g, '')
  const assFontSize = geometry.size * assEmScale
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Overlay,${font},${assFontSize.toFixed(3)},${color},${color},&H${alpha}000000,&HFF000000,0,0,0,0,100,100,0,0,1,${geometry.padding.toFixed(3)},0,7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,${formatAssTimestamp(Math.ceil(duration * 100) / 100)},Overlay,,0,0,0,,{\\an7\\pos(${geometry.x.toFixed(3)},${geometry.y.toFixed(3)})}${escapeOverlayAssText(text.value)}\n`
}

export async function prepareAutoShortOverlays(raw: AutoShortOverlays | undefined, options: {
  workDir: string; width: number; height: number; duration: number; nextInputIndex: number; fontId?: string | null
}, files: string[]): Promise<PreparedAutoShortOverlays | undefined> {
  const config = normalizeAutoShortOverlays(raw)
  if (!config) return undefined
  const prepared: PreparedAutoShortOverlays = {}
  if (config.image) {
    const source = await readAutoShortOverlayImage(config.image.path, config.image.sha256)
    const path = join(options.workDir, `overlay-${randomUUID()}${source.extension}`)
    await assertContainedParentDirectory(path, options.workDir, 'Ảnh chèn tạm')
    files.push(path)
    await writeFile(path, source.bytes, { flag: 'wx' })
    prepared.image = { ...config.image, path, inputIndex: options.nextInputIndex }
  }
  if (config.text) {
    const cues = [{ id: 'overlay', sourceIndex: 1, start: 0, end: options.duration, text: config.text.value }]
    const font = resolveSubtitlePlanFont(cues, options.fontId)
    let assEmScale = 1
    if (font) {
      const verified = await readBurnFontPreview(font.entry.id)
      const parsed = opentype.parse(verified.data)
      // libass ass_font.c:set_font_metrics uses OS/2 Win height, CSS uses em.
      // Without this conversion Noto Sans exports at only 66% of preview size.
      const os2 = parsed.tables.os2
      const winHeight = os2 ? os2.usWinAscent + os2.usWinDescent : 0
      const fontHeight = winHeight > 0 ? winHeight : parsed.ascender - parsed.descender
      if (!(parsed.unitsPerEm > 0) || !(fontHeight > 0)) throw new Error('Font chữ chèn có kích thước không hợp lệ.')
      assEmScale = fontHeight / parsed.unitsPerEm
    }
    const family = font?.entry.family || 'Arial'
    const measure = (value: string, size: number) => createTextMeasurer(size, family, font?.entry ?? null)(value)
    const path = join(options.workDir, `overlay-${randomUUID()}.ass`)
    await assertContainedParentDirectory(path, options.workDir, 'Chữ chèn tạm')
    files.push(path)
    await writeFile(path, overlayAssDocument(options.width, options.height, options.duration, config.text, family, measure, assEmScale), { flag: 'wx' })
    prepared.textFilter = `ass=${basename(path)}${font?.fontsDir ? `:fontsdir=${escapeFfmpegFilterPath(font.fontsDir)}` : ''}`
  }
  return prepared
}

/** Append decorations AFTER source adjustment, OCR removal, subtitles and portrait frame. */
export function appendAutoShortOverlays(lines: string[], width: number, height: number, prepared?: PreparedAutoShortOverlays): void {
  if (!prepared?.image && !prepared?.textFilter) return
  const last = lines.length - 1
  if (!lines[last]?.endsWith('[out]')) throw new Error('Thiếu đầu ra video để chèn ảnh/chữ.')
  lines[last] = lines[last].slice(0, -5) + '[overlay_base]'
  let input = 'overlay_base'
  if (prepared.image) {
    const image = prepared.image
    lines.push(`[${image.inputIndex}:v]format=rgba,scale=w=${Math.max(1, Math.floor(width * image.width))}:h=${Math.max(1, Math.floor(height * 0.8))}:force_original_aspect_ratio=decrease,setsar=1,colorchannelmixer=aa=${image.opacity}[overlay_image]`)
    lines.push(`[${input}][overlay_image]overlay=x='round((W-w)*${image.x})':y='round((H-h)*${image.y})':eof_action=repeat:repeatlast=1:shortest=0:format=auto[overlay_composed]`)
    input = 'overlay_composed'
  }
  lines.push(`[${input}]${prepared.textFilter || 'null'}[out]`)
}
