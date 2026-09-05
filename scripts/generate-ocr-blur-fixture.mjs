import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const LOCKED_FONT_HASH = 'bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d'

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex').toLowerCase()
}

function parseArgs(argv) {
  const values = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`)
    const key = arg.slice(2)
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
    values[key] = value
    i += 1
  }
  const allowed = new Set(['output-dir', 'ffmpeg', 'ffprobe', 'font'])
  for (const k of Object.keys(values)) {
    if (!allowed.has(k)) throw new Error(`Unknown argument: --${k}`)
  }
  for (const req of ['output-dir', 'ffmpeg', 'ffprobe', 'font']) {
    if (!values[req]) throw new Error(`Missing required argument: --${req}`)
  }
  return values
}

async function validateExecutable(filePath, label) {
  if (!isAbsolute(filePath)) throw new Error(`${label} must be an absolute path: ${filePath}`)
  const st = await stat(filePath).catch(() => null)
  if (!st || !st.isFile()) throw new Error(`${label} must be a regular file: ${filePath}`)
}

export async function generateOcrBlurFixture({ outputDir, ffmpeg, ffprobe, font }) {
  const outRoot = resolve(outputDir)
  const ffmpegExe = resolve(ffmpeg)
  const ffprobeExe = resolve(ffprobe)
  const fontFile = resolve(font)

  await validateExecutable(ffmpegExe, 'FFmpeg')
  await validateExecutable(ffprobeExe, 'FFprobe')
  await validateExecutable(fontFile, 'Font')

  const fontHash = await sha256File(fontFile)
  if (fontHash !== LOCKED_FONT_HASH) {
    throw new Error(`Font SHA-256 mismatch: expected ${LOCKED_FONT_HASH}, got ${fontHash}`)
  }

  // Reject an existing non-empty output directory
  const existingStat = await stat(outRoot).catch(() => null)
  if (existingStat) {
    if (!existingStat.isDirectory()) throw new Error(`Output path is not a directory: ${outRoot}`)
    const files = await readdir(outRoot)
    if (files.length > 0) throw new Error(`Output directory is not empty: ${outRoot}`)
  } else {
    await mkdir(outRoot, { recursive: true })
  }

  const sourceVideoPath = join(outRoot, 'source.mp4')
  const narrationWavPath = join(outRoot, 'narration.wav')
  const subAssPath = join(outRoot, 'sub.ass')
  const timelineJsonPath = join(outRoot, 'timeline.json')
  const samplesJsonPath = join(outRoot, 'samples.json')
  const fixtureJsonPath = join(outRoot, 'fixture.json')

  // 1. Generate narration.wav (6.000 s mono 48 kHz 997 Hz sine)
  await execFileAsync(ffmpegExe, [
    '-f', 'lavfi', '-i', 'sine=frequency=997:sample_rate=48000:duration=6',
    '-c:a', 'pcm_s16le',
    '-y', narrationWavPath
  ], { timeout: 60_000, windowsHide: true })

  // 2. Generate sub.ass
  // Text during [2.500, 3.500): Yellow text "RENDERED AFTER BLUR" plus 8x8 cyan registration square at (640,520)
  const assContent = `[Script Info]
Title: OCR Blur Fixture Subtitle
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans,48,&H0000FFFF,&H00000000,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,2,0,2,20,20,50,1
Style: Marker,Noto Sans,10,&H00FFFF00,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 1,0:00:02.50,0:00:03.50,Default,,0,0,0,,{\\pos(640,540)}RENDERED AFTER BLUR
Dialogue: 1,0:00:02.50,0:00:03.50,Marker,,0,0,0,,{\\pos(640,520)\\p1}m 0 0 l 8 0 l 8 8 l 0 8{\\p0}
`
  await writeFile(subAssPath, assContent, 'utf8')

  // 3. Generate source.mp4:
  // Base canvas: 1280x720, 30 fps, 6.000s
  // Target backdrop: 6x6 alternating checkerboard under entire OCR region (64,80) to (960,680) -> width 896, height 600
  // Control: animated checkerboard at (980,470)-(1180,620) -> width 200, height 150
  // Audio: mono 48 kHz sine at 1500 Hz
  // Texts with drawtext at intervals:
  // [0.500, 1.500): ALPHA 123 at (120, 500)
  // [1.500, 2.250): ALPHA 123 at (180, 480)
  // [2.250, 3.250): LONGER TEXT 456 at (100, 480)
  // [3.250, 4.000): TOP 789 at (120, 420) and BOTTOM 012 at (300, 545)
  // [4.750, 5.500): FINAL 345 at (160, 500)
  const escapedFont = fontFile.replace(/\\/g, '/').replace(/:/g, '\\:')

  const filterGraph = [
    'color=c=0x202020:s=1280x720:r=30:d=6[bg]',
    'color=c=0x404040:s=896x600:r=30:d=6,drawgrid=w=6:h=6:t=3:c=0x808080[chk_ocr]',
    'color=c=0x303030:s=200x150:r=30:d=6,drawgrid=w=10:h=10:t=5:c=0x909090[chk_ctl]',
    '[bg][chk_ocr]overlay=64:80[v1]',
    '[v1][chk_ctl]overlay=980:470[v2]',
    `[v2]drawtext=fontfile='${escapedFont}':text='ALPHA 123':fontsize=52:fontcolor=white:x=120:y=500:enable='between(t,0.5,1.5)'[v3]`,
    `[v3]drawtext=fontfile='${escapedFont}':text='ALPHA 123':fontsize=58:fontcolor=white:x=180:y=480:enable='between(t,1.5,2.25)'[v4]`,
    `[v4]drawtext=fontfile='${escapedFont}':text='LONGER TEXT 456':fontsize=55:fontcolor=white:x=100:y=480:enable='between(t,2.25,3.25)'[v5]`,
    `[v5]drawtext=fontfile='${escapedFont}':text='TOP 789':fontsize=48:fontcolor=white:x=120:y=420:enable='between(t,3.25,4.0)'[v6]`,
    `[v6]drawtext=fontfile='${escapedFont}':text='BOTTOM 012':fontsize=50:fontcolor=white:x=300:y=545:enable='between(t,3.25,4.0)'[v7]`,
    `[v7]drawtext=fontfile='${escapedFont}':text='FINAL 345':fontsize=54:fontcolor=white:x=160:y=500:enable='between(t,4.75,5.5)'[vout]`
  ].join(';')

  await execFileAsync(ffmpegExe, [
    '-f', 'lavfi', '-i', 'sine=frequency=1500:sample_rate=48000:duration=6',
    '-filter_complex', filterGraph,
    '-map', '[vout]',
    '-map', '0:a',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '10', '-g', '30', '-bf', '0', '-pix_fmt', 'yuv420p',
    '-fps_mode', 'cfr', '-r', '30', '-t', '6',
    '-c:a', 'aac', '-b:a', '128k',
    '-y', sourceVideoPath
  ], { timeout: 60_000, windowsHide: true })

  // Verify source video rate/fps with ffprobe
  const probeOutput = await execFileAsync(ffprobeExe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate,nb_frames,duration,width,height',
    '-of', 'json',
    sourceVideoPath
  ], { timeout: 15_000, windowsHide: true })

  const probed = JSON.parse(probeOutput.stdout)
  const vStream = probed.streams?.[0]
  if (!vStream || vStream.width !== 1280 || vStream.height !== 720 || vStream.r_frame_rate !== '30/1') {
    throw new Error(`Generated video does not match 1280x720 30 fps: ${JSON.stringify(vStream)}`)
  }

  // 4. Generate timeline.json
  const timelineData = {
    schemaVersion: 1,
    protocol: 'ocr-visual-cues/1',
    video: {
      width: 1280,
      height: 720,
      durationSeconds: 6.0,
      sampleFps: 8,
      frameCount: 48,
      geometryFingerprint: '0'.repeat(64)
    },
    profile: 'accurate',
    scanRegion: { x0: 64, y0: 80, x1: 960, y1: 680 },
    segments: [
      {
        id: 'seg-1',
        startFrame: 4,
        endFrameExclusive: 12,
        start: 0.5,
        end: 1.5,
        text: 'ALPHA 123',
        confidence: 0.99,
        boxes: [{ text: 'ALPHA 123', confidence: 0.99, x0: 120, y0: 500, x1: 430, y1: 570 }]
      },
      {
        id: 'seg-2',
        startFrame: 12,
        endFrameExclusive: 18,
        start: 1.5,
        end: 2.25,
        text: 'ALPHA 123',
        confidence: 0.99,
        boxes: [{ text: 'ALPHA 123', confidence: 0.99, x0: 180, y0: 480, x1: 520, y1: 558 }]
      },
      {
        id: 'seg-3',
        startFrame: 18,
        endFrameExclusive: 26,
        start: 2.25,
        end: 3.25,
        text: 'LONGER TEXT 456',
        confidence: 0.99,
        boxes: [{ text: 'LONGER TEXT 456', confidence: 0.99, x0: 100, y0: 480, x1: 650, y1: 562 }]
      },
      {
        id: 'seg-4',
        startFrame: 26,
        endFrameExclusive: 32,
        start: 3.25,
        end: 4.0,
        text: 'TOP 789\nBOTTOM 012',
        confidence: 0.99,
        boxes: [
          { text: 'TOP 789', confidence: 0.99, x0: 120, y0: 420, x1: 390, y1: 480 },
          { text: 'BOTTOM 012', confidence: 0.99, x0: 300, y0: 545, x1: 650, y1: 615 }
        ]
      },
      {
        id: 'seg-5',
        startFrame: 38,
        endFrameExclusive: 44,
        start: 4.75,
        end: 5.5,
        text: 'FINAL 345',
        confidence: 0.99,
        boxes: [{ text: 'FINAL 345', confidence: 0.99, x0: 160, y0: 500, x1: 500, y1: 575 }]
      }
    ]
  }
  await writeFile(timelineJsonPath, `${JSON.stringify(timelineData, null, 2)}\n`, 'utf8')

  // 5. Generate samples.json
  const samplesData = {
    schemaVersion: 1,
    windows: {
      insideActive1: { startSec: 0.75, endSec: 1.25, x0: 140, y0: 510, x1: 400, y1: 560 },
      insideActive2: { startSec: 1.75, endSec: 2.00, x0: 200, y0: 490, x1: 500, y1: 545 },
      insideActive3: { startSec: 2.50, endSec: 3.00, x0: 120, y0: 490, x1: 600, y1: 550 },
      clearedInterval: { startSec: 4.10, endSec: 4.60, x0: 100, y0: 400, x1: 650, y1: 620 },
      outsideControl: { startSec: 0.50, endSec: 5.50, x0: 980, y0: 470, x1: 1180, y1: 620 },
      finalTail: { startSec: 5.65, endSec: 5.95, x0: 64, y0: 80, x1: 960, y1: 680 },
      subtitleLayer: { startSec: 2.75, endSec: 3.25, x0: 630, y0: 510, x1: 650, y1: 530 }
    }
  }
  await writeFile(samplesJsonPath, `${JSON.stringify(samplesData, null, 2)}\n`, 'utf8')

  // 6. Calculate decoded framemd5 of source video
  const frameMd5Output = await execFileAsync(ffmpegExe, [
    '-i', sourceVideoPath,
    '-f', 'framemd5',
    '-'
  ], { timeout: 30_000, windowsHide: true })

  // 7. Generate fixture.json
  const fixtureData = {
    schemaVersion: 1,
    canvas: { width: 1280, height: 720, fps: 30, durationSeconds: 6.0 },
    font: { hash: LOCKED_FONT_HASH, file: 'NotoSans.ttf' },
    audio: {
      sourceSineHz: 1500,
      narrationSineHz: 997,
      sampleRate: 48000
    },
    ocrRegion: { x0: 64, y0: 80, x1: 960, y1: 680 },
    controlRegion: { x0: 980, y0: 470, x1: 1180, y1: 620 },
    files: {
      sourceVideo: { file: 'source.mp4', sha256: await sha256File(sourceVideoPath) },
      narrationWav: { file: 'narration.wav', sha256: await sha256File(narrationWavPath) },
      subAss: { file: 'sub.ass', sha256: await sha256File(subAssPath) },
      timelineJson: { file: 'timeline.json', sha256: await sha256File(timelineJsonPath) },
      samplesJson: { file: 'samples.json', sha256: await sha256File(samplesJsonPath) }
    },
    sourceFrameMd5: frameMd5Output.stdout.trim()
  }
  await writeFile(fixtureJsonPath, `${JSON.stringify(fixtureData, null, 2)}\n`, 'utf8')

  return { fixtureDir: outRoot, fixtureData }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const res = await generateOcrBlurFixture({
    outputDir: args['output-dir'],
    ffmpeg: args['ffmpeg'],
    ffprobe: args['ffprobe'],
    font: args['font']
  })
  console.log(`[Fixture] Generated deterministic OCR blur fixture at ${res.fixtureDir}`)
}

let isDirectRun = false
try {
  const selfPath = resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  isDirectRun = Boolean(process.argv[1] && resolve(process.argv[1]) === selfPath)
} catch {
  isDirectRun = false
}

if (isDirectRun) {
  main().catch((err) => {
    console.error(`[Fixture Error] ${err.message}`)
    process.exit(1)
  })
}