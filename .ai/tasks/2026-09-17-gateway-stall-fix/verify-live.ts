import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { runGatewayRestoration } from '../../../src/main/geminiGatewayRestoration'
import { requestGatewayOperation } from '../../../src/main/geminiGateway'
import { compactRestorationEvidence, type EvidenceItem } from '../../../src/main/translation/sourceRestoration'
import { recoverUnknownGatewayOperation } from '../../../src/main/gatewayManualRecovery'

async function main(): Promise<void> {
  const root = join(process.cwd(), '.ai/tasks/2026-09-17-gateway-stall-fix')
  await mkdir(root, { recursive: true })
  const payload = JSON.parse(await readFile('F:/Son/tool/CreateMediaTool/.state/operations/op-12d11c6c-ddaa-4f49-b208-93bf3328583a.payload.json', 'utf8'))
  const original = JSON.parse(payload.messages[1].content)
  const compact = { ...original, evidenceItems: compactRestorationEvidence(original.evidenceItems) }
  const sizing = { cueCount: original.cues.length, beforeEvidence: original.evidenceItems.length, afterEvidence: compact.evidenceItems.length,
    beforeChars: JSON.stringify(original).length, afterChars: JSON.stringify(compact).length }
  console.log(JSON.stringify(sizing))
  await writeFile(join(root, 'payload-sizing.json'), JSON.stringify(sizing, null, 2))
  if (!process.argv.includes('--live')) return
  const data = Buffer.from(payload.messages[1].attachments[0].data, 'base64')
  const audioEvidence = original.evidenceItems.find((item: EvidenceItem) => item.type === 'audio')
  const stageDir = join(root, 'live-stages')
  if (process.argv.includes('--recover')) {
    const lease = JSON.parse(await readFile(join(stageDir, 'restoration-draft-operation.json'), 'utf8'))
    await recoverUnknownGatewayOperation('http://127.0.0.1:4982/openai/v1', stageDir, {
      operationId: lease.operationId, stage: 'restoration-draft', reason: 'outcome-unknown', nextEligibleAtUtc: null
    })
  }
  if (process.argv.includes('--recover-text')) {
    const textStageDir = join(root, 'text-full-stage')
    const lease = JSON.parse(await readFile(join(textStageDir, 'metadata-operation.json'), 'utf8'))
    await recoverUnknownGatewayOperation('http://127.0.0.1:4982/openai/v1', textStageDir, {
      operationId: lease.operationId, stage: 'metadata', reason: 'outcome-unknown', nextEligibleAtUtc: null
    })
    if (!process.argv.includes('--run-after-recover')) return
  }
  if (process.argv.includes('--tiny')) {
    const started = Date.now()
    const execution = await requestGatewayOperation(
      'http://127.0.0.1:4982/openai/v1',
      [{ role: 'user', content: 'Return exactly {"translations":{"probe":"ok"}} and nothing else.' }],
      AbortSignal.timeout(4 * 60_000), 64, false, 'json-items',
      { draftDir: join(root, 'tiny-stage'), stage: 'metadata', httpTimeoutMs: 180_000, deferOnWaitingProvider: true }
    )
    const summary = { ok: true, elapsedSeconds: (Date.now() - started) / 1000, responseChars: execution.completion.raw.length }
    await execution.ack()
    await writeFile(join(root, 'tiny-summary.json'), JSON.stringify(summary, null, 2))
    console.log(JSON.stringify(summary))
    return
  }
  if (process.argv.includes('--text-full')) {
    const started = Date.now()
    const textMessages = payload.messages.map((message: { role: 'system' | 'user'; content: string }) => ({
      role: message.role,
      content: (message.role === 'user' ? JSON.stringify(compact) : message.content).replace(/audio-ocr/gu, 'ocr').replace(/audio\/OCR/gu, 'OCR')
    }))
    const execution = await requestGatewayOperation(
      'http://127.0.0.1:4982/openai/v1', textMessages,
      AbortSignal.timeout(4 * 60_000), 3_968, false, 'json-items',
      { draftDir: join(root, 'text-full-stage'), stage: 'metadata', httpTimeoutMs: 180_000,
        deferOnWaitingProvider: true,
        ...(process.argv.includes('--no-schema') ? {} : { responseFormat: payload.response_format }) }
    )
    const summary = { ok: true, elapsedSeconds: (Date.now() - started) / 1000, responseChars: execution.completion.raw.length }
    await execution.ack()
    await writeFile(join(root, 'text-full-summary.json'), JSON.stringify(summary, null, 2))
    console.log(JSON.stringify(summary))
    return
  }
  const started = Date.now()
  try {
    const result = await runGatewayRestoration({
      baseUrl: 'http://127.0.0.1:4982/openai/v1',
      sourceCues: original.cues,
      mediaDigest: '31e9b66009a8e03160e703822cf8bc1c0555111693e794b1757a6753149dcd3a',
      sourceLanguage: 'zh', targetLocale: 'vi', mode: 'dubbing', glossary: [],
      audio: { data, format: 'mp3', durationSeconds: audioEvidence.end, sampleRate: 16000, channels: 1,
        sha256: createHash('sha256').update(data).digest('hex') },
      ocrFrames: original.evidenceItems.filter((item: EvidenceItem) => item.type === 'ocr').map((item: EvidenceItem) => ({
        timestamp: item.start!, end: item.end, lines: [{ text: item.text, confidence: item.confidence, boundingBox: item.region }]
      })),
      signal: AbortSignal.timeout(8 * 60_000), draftDir: stageDir
    })
    await writeFile(join(root, 'live-result.json'), JSON.stringify(result, null, 2))
    const summary = { ok: true, elapsedSeconds: (Date.now() - started) / 1000, cues: result.translatedItems.length,
      sourceEdits: result.draft.sourceEdits.length, reviewStatus: result.review.status, metrics: result.metrics }
    await writeFile(join(root, 'live-summary.json'), JSON.stringify(summary, null, 2))
    console.log(JSON.stringify(summary))
  } catch (error) {
    const e = error as Error & { providerCode?: string; operationId?: string }
    const summary = { ok: false, elapsedSeconds: (Date.now() - started) / 1000, error: e.message, code: e.providerCode, operationId: e.operationId }
    await writeFile(join(root, 'live-summary.json'), JSON.stringify(summary, null, 2))
    console.log(JSON.stringify(summary))
    process.exitCode = 1
  }
}
void main()
