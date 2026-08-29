import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] || 'resources/local-assets')

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

const manifestPath = join(root, 'manifest.json')
if (!(await exists(manifestPath))) throw new Error(`Thiếu manifest asset local: ${manifestPath}`)
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (typeof manifest.assetVersion !== 'string' || typeof manifest.platform !== 'string' || !manifest.engines) {
  throw new Error('Manifest asset local không hợp lệ.')
}

for (const [kind, entry] of Object.entries(manifest.engines)) {
  if (!entry || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    throw new Error(`Manifest ${kind} thiếu path/SHA-256 hợp lệ.`)
  }
  const path = join(root, entry.path)
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) throw new Error(`Thiếu file asset ${kind}: ${path}`)
  if (entry.bytes != null && info.size !== entry.bytes) throw new Error(`Sai kích thước asset ${kind}.`)
  const actual = await sha256(path)
  if (actual.toLowerCase() !== entry.sha256.toLowerCase()) throw new Error(`Sai SHA-256 asset ${kind}.`)
  if (entry.protocol && typeof entry.protocol !== 'string') throw new Error(`Protocol asset ${kind} không hợp lệ.`)
  console.log(`PASS ${kind}: ${path} (${info.size} bytes, ${actual})`)
}

console.log(`PASS local asset manifest: ${manifestPath}`)
