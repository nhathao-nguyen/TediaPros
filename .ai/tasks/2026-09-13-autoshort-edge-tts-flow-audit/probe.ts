import { performance } from 'node:perf_hooks'
import { collectEdgeAudio, createMsEdgeTtsTransport } from '../../../src/main/edgeTtsTransport'

const transport = createMsEdgeTtsTransport()
const voice = 'vi-VN-HoaiMyNeural'

async function synthesize(label: string, text: string): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  const started = performance.now()
  try {
    const session = await transport.open({ text, voice }, controller.signal)
    const audio = await collectEdgeAudio(session, controller.signal)
    return {
      label,
      ok: true,
      elapsedMs: Math.round(performance.now() - started),
      bytes: audio.length
    }
  } catch (error) {
    return {
      label,
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  const sequential: Array<Record<string, unknown>> = []
  for (let index = 0; index < 6; index++) {
    sequential.push(await synthesize(`sequential-${index + 1}`, `Đây là câu kiểm tra tổng hợp số ${index + 1} của TediaPros.`))
  }

  const concurrent = await Promise.all([
    synthesize('concurrent-1', 'TediaPros đang kiểm tra hai yêu cầu tổng hợp đồng thời.'),
    synthesize('concurrent-2', 'Đây là yêu cầu đồng thời thứ hai dùng nội dung thử nghiệm.')
  ])

  const results = [...sequential, ...concurrent]
  const succeeded = results.filter((item) => item.ok === true)
  const elapsed = succeeded.map((item) => Number(item.elapsedMs)).sort((left, right) => left - right)
  const output = {
    checkedAtUtc: new Date().toISOString(),
    provider: 'edge-tts',
    adapter: 'msedge-tts@2.0.7',
    voice,
    total: results.length,
    passed: succeeded.length,
    failed: results.length - succeeded.length,
    minMs: elapsed[0] ?? null,
    medianMs: elapsed.length ? elapsed[Math.floor((elapsed.length - 1) / 2)] : null,
    maxMs: elapsed.at(-1) ?? null,
    results
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
}

void main()
