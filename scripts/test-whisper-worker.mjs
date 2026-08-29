import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

function arg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

async function exists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function assertOutput(path) {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile() || info.size === 0) throw new Error(`Output worker thiếu/rỗng: ${path}`)
  if (path.toLowerCase().endsWith('.srt')) {
    const text = await readFile(path, 'utf8')
    const cues = text.trim().split(/\r?\n\r?\n/).filter((block) => /\d+\r?\n\d{2}:\d{2}:\d{2},\d{3} --> /.test(block))
    if (cues.length === 0) throw new Error(`SRT worker không parse được: ${path}`)
  }
}

const worker = resolve(
  arg('--worker') ||
    (process.env.TEDIAPROS_RUNTIME_DIR
      ? join(process.env.TEDIAPROS_RUNTIME_DIR, 'whisper-cpp', 'whisper-local-worker.exe')
      : process.env.APPDATA
        ? join(process.env.APPDATA, 'tedia-pros', 'runtime', 'whisper-cpp', 'whisper-local-worker.exe')
        : 'whisper-local-worker.exe')
)
const model = resolve(
  arg('--model') ||
    (process.env.TEDIAPROS_RUNTIME_DIR
      ? join(process.env.TEDIAPROS_RUNTIME_DIR, 'models', 'whisper-cpp', 'base', 'ggml-base.bin')
      : process.env.APPDATA
        ? join(process.env.APPDATA, 'tedia-pros', 'models', 'whisper-cpp', 'base', 'ggml-base.bin')
        : 'ggml-base.bin')
)
const input = resolve(arg('--input') || '')
const requestedOutput = arg('--output-dir')
const outputRoot = requestedOutput ? resolve(requestedOutput) : await mkdtemp(join(tmpdir(), 'tedia-whisper-worker-e2e-'))

if (!await exists(worker)) throw new Error(`Thiếu worker: ${worker}`)
if (!await exists(model)) throw new Error(`Thiếu model native: ${model}`)
if (!input || !await exists(input)) throw new Error('Cần --input trỏ tới audio/video thật.')

const child = spawn(worker, ['--daemon', '--model', model, '--device', 'cpu'], {
  cwd: dirname(worker),
  windowsHide: true,
  env: { ...process.env, PATH: `${dirname(worker)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}` },
  stdio: ['pipe', 'pipe', 'pipe']
})
let buffer = ''
const events = []
const waiters = []
let stderr = ''

function push(value) {
  events.push(value)
  for (const waiter of [...waiters]) {
    if (waiter.predicate(value)) {
      waiter.resolve(value)
      waiters.splice(waiters.indexOf(waiter), 1)
    }
  }
}

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  const lines = buffer.split(/\r?\n/)
  buffer = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    try { push(JSON.parse(line)) } catch { push({ type: 'invalid', line }) }
  }
})
child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-4000) })

function waitFor(predicate, timeoutMs = 120_000) {
  const existing = events.find(predicate)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => {
      const index = waiters.findIndex((item) => item.resolve === resolveWait)
      if (index >= 0) waiters.splice(index, 1)
      reject(new Error(`Timeout chờ worker; stderr: ${stderr}`))
    }, timeoutMs)
    waiters.push({
      predicate,
      resolve: (value) => { clearTimeout(timer); resolveWait(value) }
    })
  })
}

async function request(id, outputDir) {
  await waitFor((event) => event.type === 'ready' || event.type === 'error')
  child.stdin.write(JSON.stringify({
    type: 'transcribe', id, input, language: 'vi', task: 'transcribe',
    formats: ['srt', 'vtt', 'txt'], outputDir, model: 'base'
  }) + '\n')
  const done = await waitFor((event) => event.type === 'done' && event.id === id)
  if (!Array.isArray(done.outputs) || done.outputs.length === 0 || !done.alignmentPath) {
    throw new Error(`Worker done thiếu output/alignment: ${JSON.stringify(done)}`)
  }
  return done
}

try {
  const ready = await waitFor((event) => event.type === 'ready' || event.type === 'error')
  if (ready.type !== 'ready' || ready.loadCount !== 1 || ready.model !== 'base' || ready.device !== 'cpu') {
    throw new Error(`Worker ready không đúng: ${JSON.stringify(ready)}`)
  }
  const firstDir = join(outputRoot, 'one')
  const secondDir = join(outputRoot, 'two')
  const first = await request('e2e-1', firstDir)
  const second = await request('e2e-2', secondDir)
  for (const done of [first, second]) {
    for (const output of done.outputs) await assertOutput(output)
    await assertOutput(done.alignmentPath)
  }
  console.log(JSON.stringify({
    status: 'PASS',
    loadCount: ready.loadCount,
    doneCount: 2,
    firstOutputs: first.outputs,
    secondOutputs: second.outputs,
    outputRoot
  }, null, 2))
} finally {
  if (child.exitCode === null) {
    try { child.stdin.end() } catch { /* already closed */ }
    await Promise.race([
      new Promise((resolveWait) => child.once('close', resolveWait)),
      new Promise((resolveWait) => setTimeout(resolveWait, 2_000))
    ])
    if (child.exitCode === null) child.kill()
  }
}
