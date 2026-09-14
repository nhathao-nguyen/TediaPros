import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const sourcePath = process.argv[2]
const outputPath = process.argv[3]
if (!sourcePath || !outputPath) throw new Error('Pass source.srt and output.srt.')

const temporary = await mkdtemp(join(tmpdir(), 'tedia-gemini-gateway-live-'))
try {
  const compiled = join(temporary, 'acceptance.cjs')
  const electronMockPlugin = {
    name: 'electron-mock',
    setup(buildInstance) {
      buildInstance.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'electron-mock' }))
      buildInstance.onLoad({ filter: /.*/, namespace: 'electron-mock' }, () => ({
        loader: 'js',
        contents: `const os=require('node:os');module.exports={app:{getPath:()=>os.tmpdir()}}`
      }))
    }
  }
  await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'ts',
      contents: `
import { readFileSync, writeFileSync } from 'node:fs'
import { parseSrt } from './src/shared/subtitles'
import { translateSrtWithGeminiGateway } from './src/main/geminiGateway'

const sourcePath = process.argv[2]
const outputPath = process.argv[3]
async function run() {
const nativeFetch = globalThis.fetch
let gatewayCall = 0
let upstreamAttempts = 0
globalThis.fetch = async (...args) => {
  const response = await nativeFetch(...args)
  const body = await response.text()
  gatewayCall += 1
  try { upstreamAttempts += Number(JSON.parse(body).gateway_metadata?.upstream_attempts || 0) } catch {}
  writeFileSync(outputPath + '.gateway-' + gatewayCall + '.json', body, 'utf8')
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}
const result = await translateSrtWithGeminiGateway(
  sourcePath,
  outputPath,
  'vi-VN',
  'http://127.0.0.1:4982/openai/v1',
  { sourceLanguage: 'zh', mode: 'dubbing', signal: AbortSignal.timeout(5 * 60_000) }
)
const cues = result.ok ? parseSrt(readFileSync(outputPath, 'utf8')).cues : []
const evidence = {
  evidence: 'Live CreateMediaTool gateway generation on 2026-09-14',
  ok: result.ok,
  error: result.error,
  count: result.count,
  disposition: result.assessment?.disposition,
  issueCodes: result.assessment?.issues.map(issue => issue.code),
  gatewayCalls: gatewayCall,
  upstreamAttempts,
  containsWooting: cues.some(cue => /Wooting/iu.test(cue.text)),
  containsPixelBranch: cues.some(cue => /(?:pixel|điểm ảnh).{0,20}(?:cành|nhánh)|(?:cành|nhánh).{0,20}(?:pixel|điểm ảnh)/iu.test(cue.text)),
  containsVolvo: cues.some(cue => /Volvo/iu.test(cue.text)),
  containsOak: cues.some(cue => /(?:cây|gỗ) sồi|sồi/iu.test(cue.text)),
  selected: cues.filter(cue => cue.start >= 43 || cue.end >= 50).map(cue => ({ id: cue.id, start: cue.start, text: cue.text }))
}
writeFileSync(outputPath + '.acceptance.json', JSON.stringify(evidence, null, 2), 'utf8')
console.log(JSON.stringify(evidence, null, 2))
if (!result.ok) process.exitCode = 2
}
run().catch(error => { console.error(error); process.exitCode = 1 })
`
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: compiled,
    logLevel: 'silent',
    plugins: [electronMockPlugin]
  })
  const result = spawnSync(process.execPath, [compiled, sourcePath, outputPath], { encoding: 'utf8', timeout: 330_000 })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  await rm(temporary, { recursive: true, force: true })
}
