import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(
  process.argv[2] ||
    process.env.TEDIAPROS_RUNTIME_DIR ||
    (process.env.APPDATA ? join(process.env.APPDATA, 'tedia-pros', 'runtime') : 'runtime-staging')
)

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

let manifestPath = join(root, 'runtime-manifest.json')
if (!(await exists(manifestPath))) {
  manifestPath = join(root, 'manifest.json')
}

if (!(await exists(manifestPath))) {
  throw new Error(`Thiếu manifest asset runtime/local: ${manifestPath}`)
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const assets = manifest.assets || manifest.engines

if (!assets || typeof assets !== 'object') {
  throw new Error('Manifest asset không hợp lệ hoặc thiếu mục assets/engines.')
}

for (const [kind, entry] of Object.entries(assets)) {
  if (!entry || !entry.sha256 || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    throw new Error(`Manifest ${kind} thiếu SHA-256 hợp lệ.`)
  }
  const entrypoint = entry.path || join(kind, entry.entrypoint || '')
  const path = join(root, entrypoint)
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) throw new Error(`Thiếu file entrypoint asset ${kind}: ${path}`)
  if (entry.bytes != null && info.size !== entry.bytes) throw new Error(`Sai kích thước asset ${kind}.`)
  const actual = await sha256(path)
  if (actual.toLowerCase() !== entry.sha256.toLowerCase()) throw new Error(`Sai SHA-256 asset ${kind}.`)
  console.log(`PASS ${kind}: ${path} (${info.size} bytes, ${actual})`)
}

console.log(`PASS asset manifest: ${manifestPath}`)
