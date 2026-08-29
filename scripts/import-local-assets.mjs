import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, dirname, join, relative, resolve } from 'node:path'

const execFileAsync = promisify(execFile)
const platform = `${process.platform}-${process.arch}`
const destination = resolve('resources', 'local-assets')
const sourceArg = process.argv.indexOf('--source')
const source = sourceArg >= 0 ? process.argv[sourceArg + 1] : null

if (!source) {
  console.error('Usage: npm run assets:import -- --source <local-directory-or-zip>')
  process.exit(2)
}

async function exists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function findFile(root, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()))
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      const nested = await findFile(path, names)
      if (nested) return nested
    } else if (wanted.has(entry.name.toLowerCase())) {
      return path
    }
  }
  return null
}

async function expandSource(input) {
  const resolved = resolve(input)
  if (!(await exists(resolved))) throw new Error(`Không tìm thấy source asset: ${resolved}`)
  const info = await stat(resolved)
  if (info.isDirectory()) return resolved
  if (!resolved.toLowerCase().endsWith('.zip')) throw new Error('Source phải là thư mục đã giải nén hoặc file .zip.')
  const expanded = join(process.cwd(), '.asset-import-staging')
  await rm(expanded, { recursive: true, force: true })
  await mkdir(expanded, { recursive: true })
  if (process.platform === 'win32') {
    await execFileAsync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${resolved.replaceAll("'", "''")}' -DestinationPath '${expanded.replaceAll("'", "''")}' -Force`
    ])
  } else {
    await execFileAsync('unzip', ['-q', '-o', resolved, '-d', expanded])
  }
  return expanded
}

async function importKind(root, kind, names) {
  const file = await findFile(root, names)
  if (!file) return null
  const target = join(destination, kind)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await cp(dirname(file), target, { recursive: true })
  const imported = join(target, basename(file))
  const info = await stat(imported)
  return {
    path: relative(destination, imported).replaceAll('\\', '/'),
    sha256: await sha256(imported),
    bytes: info.size,
    version: 'imported-local',
    protocol: kind === 'ocr' ? 'ocr-local/1' : kind === 'whisper-cpp' ? 'whisper-local/1' : undefined
  }
}

async function main() {
  const root = await expandSource(source)
  await mkdir(destination, { recursive: true })
  const engines = {}
  const specs = [
    ['whisper-cpp', ['whisper-local-worker.exe', 'whisper-local-worker', 'whisper-server.exe', 'whisper-server']],
    ['ocr', ['ocr-engine.exe', 'ocr-engine']],
    ['video2x', ['video2x.exe', 'video2x']],
    ['ffmpeg', process.platform === 'win32' ? ['ffmpeg.exe'] : ['ffmpeg']],
    ['douyin', process.platform === 'win32' ? ['dy-engine.exe'] : ['dy-engine']]
  ]
  for (const [kind, names] of specs) {
    const entry = await importKind(root, kind, names)
    if (entry) engines[kind] = entry
  }
  if (Object.keys(engines).length === 0) throw new Error('Không tìm thấy asset engine được hỗ trợ trong source.')
  await writeFile(join(destination, 'manifest.json'), JSON.stringify({
    assetVersion: 'local-1',
    platform,
    engines
  }, null, 2) + '\n', 'utf8')
  console.log(`Imported ${Object.keys(engines).join(', ')} into ${destination}`)
  console.log('Whisper cũ/CTranslate2 không được import; chỉ whisper.cpp GGML/native bundle mới được chấp nhận.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
