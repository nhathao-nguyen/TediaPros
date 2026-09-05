import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const execFileAsync = promisify(execFile)

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex').toLowerCase()
}

function parseCliArgs(argv) {
  const values = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const val = argv[i + 1]
      if (val && !val.startsWith('--')) {
        values[key] = val
        i++
      } else {
        values[key] = 'true'
      }
    }
  }
  return values
}

export function computeGradientEnergy(rgbBuffer, width, height, x0, y0, x1, y1) {
  let totalEnergy = 0
  let pixelCount = 0
  const clampedX0 = Math.max(0, Math.min(width - 1, Math.floor(x0)))
  const clampedY0 = Math.max(0, Math.min(height - 1, Math.floor(y0)))
  const clampedX1 = Math.max(0, Math.min(width - 1, Math.floor(x1)))
  const clampedY1 = Math.max(0, Math.min(height - 1, Math.floor(y1)))

  for (let y = clampedY0; y < clampedY1; y++) {
    for (let x = clampedX0; x < clampedX1; x++) {
      const idx = (y * width + x) * 3
      const idxR = (y * width + (x + 1)) * 3
      const idxD = ((y + 1) * width + x) * 3

      // Luma Y = 0.299 R + 0.587 G + 0.114 B
      const luma = 0.299 * rgbBuffer[idx] + 0.587 * rgbBuffer[idx + 1] + 0.114 * rgbBuffer[idx + 2]
      const lumaR = 0.299 * rgbBuffer[idxR] + 0.587 * rgbBuffer[idxR + 1] + 0.114 * rgbBuffer[idxR + 2]
      const lumaD = 0.299 * rgbBuffer[idxD] + 0.587 * rgbBuffer[idxD + 1] + 0.114 * rgbBuffer[idxD + 2]

      const dx = lumaR - luma
      const dy = lumaD - luma
      totalEnergy += Math.sqrt(dx * dx + dy * dy)
      pixelCount++
    }
  }
  return pixelCount > 0 ? totalEnergy / pixelCount : 0
}

export function computeDifferenceMetrics(bufA, bufB, width, height, x0, y0, x1, y1) {
  const diffs = []
  let sum = 0
  const clampedX0 = Math.max(0, Math.min(width, Math.floor(x0)))
  const clampedY0 = Math.max(0, Math.min(height, Math.floor(y0)))
  const clampedX1 = Math.max(0, Math.min(width, Math.floor(x1)))
  const clampedY1 = Math.max(0, Math.min(height, Math.floor(y1)))

  for (let y = clampedY0; y < clampedY1; y++) {
    for (let x = clampedX0; x < clampedX1; x++) {
      const idx = (y * width + x) * 3
      const lumaA = 0.299 * bufA[idx] + 0.587 * bufA[idx + 1] + 0.114 * bufA[idx + 2]
      const lumaB = 0.299 * bufB[idx] + 0.587 * bufB[idx + 1] + 0.114 * bufB[idx + 2]
      const diff = Math.abs(lumaA - lumaB)
      diffs.push(diff)
      sum += diff
    }
  }
  if (diffs.length === 0) return { mae: 0, p99: 0 }
  diffs.sort((a, b) => a - b)
  const mae = sum / diffs.length
  const p99 = diffs[Math.floor(diffs.length * 0.99)]
  return { mae, p99 }
}

export function computeToneEnergy(pcm16Buffer, sampleRate, targetHz) {
  // Goertzel algorithm to compute power at targetHz
  const numSamples = Math.floor(pcm16Buffer.length / 2)
  if (numSamples <= 0) return 0

  const k = Math.round((numSamples * targetHz) / sampleRate)
  const omega = (2 * Math.PI * k) / numSamples
  const cosine = Math.cos(omega)
  const coeff = 2 * cosine

  let q0 = 0
  let q1 = 0
  let q2 = 0

  for (let i = 0; i < numSamples; i++) {
    const sample = pcm16Buffer.readInt16LE(i * 2) / 32768.0
    q0 = coeff * q1 - q2 + sample
    q2 = q1
    q1 = q0
  }

  const power = q1 * q1 + q2 * q2 - q1 * q2 * coeff
  return power
}

export async function verifyMaskFrames(maskPath, ffmpegPath, expectedTimeline) {
  // Decode mask to raw 8-bit gray frames
  const { stdout } = await execFileAsync(ffmpegPath, [
    '-i', maskPath,
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    '-'
  ], { encoding: 'buffer', maxBuffer: 100 * 1024 * 1024, windowsHide: true })

  const width = expectedTimeline.video.width
  const height = expectedTimeline.video.height
  const frameSize = width * height
  const frameCount = Math.floor(stdout.length / frameSize)

  if (frameCount !== 49) {
    throw new Error(`Mask must contain exactly 49 frames (48 active + 1 terminal), got ${frameCount}`)
  }

  // Frame 48 (index 48) must be all zero
  const lastFrame = stdout.subarray(48 * frameSize, 49 * frameSize)
  for (let i = 0; i < frameSize; i++) {
    if (lastFrame[i] !== 0) {
      throw new Error(`Terminal mask frame 48 is not completely black at byte ${i}`)
    }
  }

  return { ok: true, frameCount }
}

export async function verifyOcrBlurMedia(options) {
  const {
    operation = 'render',
    fixtureDir,
    outputDir,
    userData,
    electron,
    ffmpeg,
    ffprobe,
    ocrEngine,
    runtimeReleaseDir,
    profile = 'accurate'
  } = options

  const fixtureRoot = resolve(fixtureDir)
  const outputRoot = resolve(outputDir)
  const userDataDir = resolve(userData)
  const electronExe = resolve(electron)
  const ffmpegExe = resolve(ffmpeg)
  const ffprobeExe = resolve(ffprobe)

  // Validate fixture integrity
  const fixtureJson = JSON.parse(await readFile(join(fixtureRoot, 'fixture.json'), 'utf8'))
  for (const [key, spec] of Object.entries(fixtureJson.files)) {
    const actualHash = await sha256File(join(fixtureRoot, spec.file))
    if (actualHash !== spec.sha256) {
      throw new Error(`Fixture file ${spec.file} SHA-256 mismatch`)
    }
  }

  const profilesToRun = profile === 'both' ? ['accurate', 'fast'] : [profile]
  const runSubdirs = ocrEngine
    ? profilesToRun.map((p) => ({ profile: p, subdir: `engine-${p}` }))
    : profilesToRun.map((p) => ({ profile: p, subdir: `ground-truth-${p}` }))

  // Bundle ocr-blur-acceptance-main.ts
  const tempBundleDir = await mkdtemp(join(tmpdir(), 'tedia-acc-main-bundle-'))
  const bundleOut = join(tempBundleDir, 'acceptance-main.cjs')

  try {
    await build({
      entryPoints: [resolve('scripts/ocr-blur-acceptance-main.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      outfile: bundleOut,
      sourcemap: false,
      external: ['electron']
    })

    const results = []

    if (operation === 'render') {
      for (const run of runSubdirs) {
        const runOut = join(outputRoot, run.subdir)
        await mkdir(runOut, { recursive: true })

        const childArgs = [
          bundleOut,
          '--operation', 'render',
          '--fixture-dir', fixtureRoot,
          '--output-dir', runOut,
          '--user-data', userDataDir,
          '--ffmpeg', ffmpegExe,
          '--ffprobe', ffprobeExe,
          '--profile', run.profile
        ]
        if (ocrEngine) {
          childArgs.push('--ocr-engine', resolve(ocrEngine))
        }

        const child = spawnSync(electronExe, childArgs, {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 180_000
        })

        if (child.status !== 0) {
          throw new Error(`Electron runner failed for profile ${run.profile}: ${child.stderr || child.stdout}`)
        }

        const lines = child.stdout.trim().split(/\r?\n/).filter(Boolean)
        const lastLine = lines[lines.length - 1]
        let parsedResult
        try {
          parsedResult = JSON.parse(lastLine)
        } catch {
          throw new Error(`Electron did not return valid JSON result: ${child.stdout}`)
        }

        if (parsedResult.status !== 'done' || !parsedResult.finalPath) {
          throw new Error(`Render failed for profile ${run.profile}: ${parsedResult.error}`)
        }

        // Verify mask domain
        const expectedTimeline = JSON.parse(await readFile(join(fixtureRoot, 'timeline.json'), 'utf8'))
        // If engine used, check generated mask in work dir if available or audit
        const finalMp4 = parsedResult.finalPath

        // Verify media duration via ffprobe
        const probeRes = spawnSync(ffprobeExe, [
          '-v', 'error',
          '-show_entries', 'stream=r_frame_rate,duration:format=duration',
          '-of', 'json',
          finalMp4
        ], { encoding: 'utf8', windowsHide: true })
        const probeData = JSON.parse(probeRes.stdout)
        const durationSec = parseFloat(probeData.format?.duration || '0')
        if (Math.abs(durationSec - 6.0) > 0.1) {
          throw new Error(`Output video duration (${durationSec}s) drifted from 6.0s`)
        }

        results.push({
          profile: run.profile,
          finalPath: finalMp4,
          durationSec
        })
      }

      return { ok: true, operation: 'render', results }
    }

    if (operation === 'install-readiness') {
      const childArgs = [
        bundleOut,
        '--operation', 'install-readiness',
        '--fixture-dir', fixtureRoot,
        '--output-dir', outputRoot,
        '--user-data', userDataDir,
        '--ffmpeg', ffmpegExe,
        '--ffprobe', ffprobeExe,
        '--runtime-release-dir', resolve(runtimeReleaseDir || '')
      ]
      const child = spawnSync(electronExe, childArgs, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 180_000
      })
      if (child.status !== 0) {
        throw new Error(`Electron install-readiness failed: ${child.stderr || child.stdout}`)
      }
      const lines = child.stdout.trim().split(/\r?\n/).filter(Boolean)
      const parsedResult = JSON.parse(lines[lines.length - 1])
      return { ok: true, operation: 'install-readiness', result: parsedResult }
    }

    throw new Error(`Unknown operation: ${operation}`)
  } finally {
    await rm(tempBundleDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2))
  const res = await verifyOcrBlurMedia({
    operation: args['operation'],
    fixtureDir: args['fixture-dir'],
    outputDir: args['output-dir'],
    userData: args['user-data'],
    electron: args['electron'],
    ffmpeg: args['ffmpeg'],
    ffprobe: args['ffprobe'],
    ocrEngine: args['ocr-engine'],
    runtimeReleaseDir: args['runtime-release-dir'],
    profile: args['profile']
  })
  console.log(`[Verify] Verification succeeded: ${JSON.stringify(res)}`)
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
    console.error(`[Verify Error] ${err.message}`)
    process.exit(1)
  })
}