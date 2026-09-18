import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { EdgeTtsScheduler, EDGE_TTS_DEFAULT_SPACING_MS } from '../src/main/edgeTtsScheduler'
import { fetchEdgeVoices, generateEdgeTTS, type EdgeVoiceDefinition } from '../src/main/edgeTts'
import { EDGE_TTS_ENDPOINT_ID } from '../src/main/edgeTtsIdentity'
import {
  addVoiceMeasurement,
  createVoiceMeasurementProfile,
  saveVoiceMeasurementProfile,
  voiceMeasurementProfileKey,
  voiceMeasurementProfileSummary,
  type VoiceMeasurementProfile
} from '../src/main/dubbing/voiceMeasurements'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function percentile(values: readonly number[], ratio: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]
}

type CalibrationVoice = EdgeVoiceDefinition & { role: 'production_candidate' | 'control' }

const FALLBACK_VOICES: CalibrationVoice[] = [
  { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My (vi-VN)', gender: 'female', language: 'vi', locale: 'vi-VN', role: 'production_candidate' },
  { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh (vi-VN)', gender: 'male', language: 'vi', locale: 'vi-VN', role: 'production_candidate' },
  { id: 'en-US-JennyNeural', name: 'Jenny (en-US)', gender: 'female', language: 'en', locale: 'en-US', role: 'control' },
  { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao (zh-CN)', gender: 'female', language: 'zh', locale: 'zh-CN', role: 'control' },
  { id: 'ja-JP-NanamiNeural', name: 'Nanami (ja-JP)', gender: 'female', language: 'ja', locale: 'ja-JP', role: 'control' }
]

const TEXT_BANK: Record<string, string[]> = {
  vi: [
    'Xin chào, video này có 12 giây.',
    'Tốc độ đọc phải tự nhiên và rõ ràng.',
    'Ngày 16 tháng 9 năm 2026, lúc 8 giờ 30 phút.',
    'Giá giảm còn 125 nghìn đồng, áp dụng đến thứ sáu.',
    'Nếu mạng chậm, hãy thử lại sau khoảng 3 phút.',
    'CPU đạt 72%, còn bộ nhớ trống là 4,5 GB.',
    'Tên sản phẩm là TediaPros, phiên bản 2.0.',
    'Đừng bỏ qua dấu hỏi, dấu chấm và các con số.'
  ],
  en: [
    'Hello, this video is 12 seconds long.',
    'The reading speed should sound natural and clear.',
    'On September 16, 2026, at 8:30 in the morning.',
    'The price is reduced to 125 dollars until Friday.',
    'If the network is slow, try again in about 3 minutes.',
    'CPU usage is 72%, with 4.5 GB of memory available.',
    'The product is called TediaPros, version 2.0.',
    'Keep the question mark, the period, and all numbers.'
  ],
  zh: [
    '你好，这段视频长十二秒。',
    '阅读速度应该自然、清晰。',
    '日期是二零二六年九月十六日，时间是早上八点半。',
    '价格降到一百二十五元，截止到星期五。',
    '如果网络很慢，请在三分钟后重试。',
    'CPU 使用率为百分之七十二，还有四点五 GB 内存。',
    '产品名称是 TediaPros，版本为二点零。',
    '请保留问号、句号和所有数字。'
  ],
  ja: [
    'こんにちは、この動画は12秒です。',
    '読み上げの速度は自然で明瞭にしてください。',
    '2026年9月16日の午前8時30分です。',
    '価格は125円に下がり、金曜日まで有効です。',
    'ネットワークが遅い場合は、約3分後に再試行してください。',
    'CPU使用率は72パーセントで、空きメモリは4.5 GBです。',
    '製品名はTediaPros、バージョンは2.0です。',
    '疑問符、句点、数字をすべて残してください。'
  ]
}

function chooseVoices(catalog: readonly EdgeVoiceDefinition[]): CalibrationVoice[] {
  const byId = new Map(catalog.map((voice) => [voice.id, voice]))
  return FALLBACK_VOICES.map((fallback) => ({ ...fallback, ...(byId.get(fallback.id) || {}) }))
}

async function main(): Promise<void> {
  if (process.env.TEDIAPROS_EDGE_TTS_LIVE !== '1') {
    throw new Error('Refusing live Edge-TTS requests. Set TEDIAPROS_EDGE_TTS_LIVE=1 explicitly.')
  }
  const ffmpegPath = resolve(argument('--ffmpeg') || '')
  const outputPath = resolve(argument('--output') || '')
  const requestedSamples = Number(argument('--samples-per-voice') || '8')
  const spacingMs = Number(argument('--spacing-ms') || String(EDGE_TTS_DEFAULT_SPACING_MS))
  if (!argument('--output')) throw new Error('Thiếu --output')
  if (!(await stat(ffmpegPath).catch(() => null))?.isFile()) throw new Error('--ffmpeg phải là managed FFmpeg tồn tại')
  if (!Number.isSafeInteger(requestedSamples) || requestedSamples < 1 || requestedSamples > 50) throw new Error('--samples-per-voice phải trong 1..50')
  if (!Number.isSafeInteger(spacingMs) || spacingMs < 1_000 || spacingMs > 10_000) throw new Error('--spacing-ms phải trong 1000..10000')

  const catalog = await fetchEdgeVoices({ forceRefresh: true })
  const voices = chooseVoices(catalog.voices)
  const allVoices = [...new Map([...catalog.voices, ...voices].map((voice) => [voice.id, voice])).values()]
  const scheduler = new EdgeTtsScheduler({ concurrency: 1, spacingMs })
  const profileRoot = `${outputPath}/profiles`
  const audioRoot = `${outputPath}/audio`
  await mkdir(outputPath, { recursive: true })
  const profiles = new Map<string, VoiceMeasurementProfile>()
  const samples: Array<Record<string, unknown>> = []
  const startedAt = Date.now()
  let stopReason: string | undefined

  for (const voice of voices) {
    const bank = TEXT_BANK[voice.language] || TEXT_BANK.vi
    const profileKey = voiceMeasurementProfileKey({
      endpoint: EDGE_TTS_ENDPOINT_ID,
      model: 'edge-tts',
      voice: voice.id,
      language: voice.locale,
      options: {},
    })
    let profile = createVoiceMeasurementProfile({
      profileKey,
      provider: 'edge-tts',
      model: 'edge-tts',
      voice: voice.id,
      locale: voice.locale
    })
    const voiceDir = `${audioRoot}/${voice.id}`
    await mkdir(voiceDir, { recursive: true })
    for (let index = 0; index < Math.min(requestedSamples, bank.length); index += 1) {
      const text = bank[index]
      const target = `${voiceDir}/${String(index + 1).padStart(2, '0')}.wav`
      const sampleStarted = Date.now()
      const result = await generateEdgeTTS({
        text,
        language: voice.locale,
        model: 'edge-tts',
        voice: voice.id,
        speed: 1
      }, undefined, target, { scheduler, voices: allVoices, resolveFfmpeg: async () => ffmpegPath })
      const failureCodes = result.requestSpans?.flatMap((span) => span.edgeFailureCode ? [span.edgeFailureCode] : []) || []
      const fileInfo = result.ok ? await stat(target).catch(() => null) : null
      const audioFingerprint = fileInfo?.isFile()
        ? createHash('sha256').update(await readFile(target)).digest('hex')
        : undefined
      if (result.ok && result.durationMs && audioFingerprint) {
        addVoiceMeasurement(profile, {
          profileKey,
          provider: 'edge-tts',
          model: 'edge-tts',
          voice: voice.id,
          locale: voice.locale,
          text,
          durationNaturalMs: result.durationMs,
          durationSource: 'probed-trimmed-audio',
          speed: 1,
          audioFingerprint,
          origin: 'voice-tab',
          cacheHit: false
        })
      }
      samples.push({
        voice: voice.id,
        locale: voice.locale,
        role: voice.role,
        index: index + 1,
        text,
        ok: result.ok,
        durationMs: result.durationMs,
        generationMs: result.generationMs,
        bytes: fileInfo?.size,
        failureCodes,
        error: result.ok ? undefined : result.error,
        wallMs: Date.now() - sampleStarted
      })
      if (failureCodes.includes('access_denied') || failureCodes.includes('rate_limited') || failureCodes.includes('circuit_open')) {
        stopReason = failureCodes.includes('access_denied') ? 'access_denied' : failureCodes.includes('rate_limited') ? 'rate_limited' : 'circuit_open'
        break
      }
    }
    await saveVoiceMeasurementProfile(profileRoot, profile)
    profiles.set(voice.id, profile)
    if (stopReason) break
  }

  const voiceReports = voices.map((voice) => {
    const profile = profiles.get(voice.id)
    const completed = samples.filter((sample) => sample.voice === voice.id && sample.ok === true)
    const durations = completed.map((sample) => Number(sample.durationMs) / 1000).filter((value) => Number.isFinite(value) && value > 0)
    return {
      id: voice.id,
      name: voice.name,
      locale: voice.locale,
      gender: voice.gender,
      role: voice.role,
      profile: profile ? voiceMeasurementProfileSummary(profile) : null,
      pilotStatus: profile && profile.eligibleSampleCount >= 1 ? 'advisory' : 'cold',
      qualificationStatus: 'not_qualified',
      sampleCount: completed.length,
      durationP50Sec: percentile(durations, 0.5),
      durationP95Sec: percentile(durations, 0.95)
    }
  })
  const report = {
    schemaVersion: 1,
    kind: 'edge-tts-voice-calibration',
    checkedAtUtc: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    catalog: { ok: catalog.ok, source: catalog.source, checkedAtUtc: catalog.checkedAtUtc, voiceCount: catalog.voices.length, error: catalog.error },
    ffmpegPath,
    spacingMs,
    samplesPerVoiceRequested: requestedSamples,
    stopReason,
    policy: {
      pilot: 'advisory-only',
      fullQualification: 'requires 200 calibration + 100 held-out distinct samples from at least 10 videos (or 300 total)',
      productionVoiceCount: voiceReports.filter((voice) => voice.role === 'production_candidate').length,
      controlVoiceCount: voiceReports.filter((voice) => voice.role === 'control').length
    },
    voices: voiceReports,
    sampleCount: samples.length,
    successCount: samples.filter((sample) => sample.ok === true).length,
    failureCount: samples.filter((sample) => sample.ok !== true).length,
    samples
  }
  await writeFile(`${outputPath}/voice-calibration-report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ outputPath, voiceCount: voiceReports.length, sampleCount: samples.length, successCount: report.successCount, failureCount: report.failureCount, stopReason, elapsedMs: report.elapsedMs })}\n`)
  if (report.failureCount > 0 || stopReason) process.exitCode = 1
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
