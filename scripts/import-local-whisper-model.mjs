import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, copyFile, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const allowed = new Set(['base', 'small', 'medium'])
const idIndex = process.argv.indexOf('--id')
const sourceIndex = process.argv.indexOf('--source')
const destinationIndex = process.argv.indexOf('--destination')
const id = idIndex >= 0 ? process.argv[idIndex + 1] : null
const source = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : null
const destination = resolve(destinationIndex >= 0 ? process.argv[destinationIndex + 1] : 'resources/models/whisper-cpp')

if (!id || !allowed.has(id) || !source) {
  console.error('Usage: npm run model:import -- --id <base|small|medium> --source <ggml-file> [--destination <root>]')
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

async function main() {
  const input = resolve(source)
  if (!(await exists(input))) throw new Error(`Không tìm thấy model: ${input}`)
  const info = await stat(input)
  if (!info.isFile() || info.size <= 0) throw new Error('Model source không phải file hợp lệ.')
  const targetDir = join(destination, id)
  const stagingDir = join(destination, `.${id}.partial`)
  await mkdir(destination, { recursive: true })
  await mkdir(stagingDir, { recursive: true })
  const filename = `ggml-${id}.bin`
  const target = join(stagingDir, filename)
  await copyFile(input, target)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(target)) hash.update(chunk)
  const manifest = {
    id,
    backend: 'whisper.cpp',
    format: 'ggml',
    filename,
    bytes: info.size,
    sha256: hash.digest('hex'),
    languageFamily: 'multilingual',
    engineProtocol: 'whisper-local/1'
  }
  await writeFile(join(stagingDir, 'manifest.json.partial'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  await rename(join(stagingDir, 'manifest.json.partial'), join(stagingDir, 'manifest.json'))
  await rename(stagingDir, targetDir)
  console.log(`Imported ${basename(input)} as ${id} into ${targetDir}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
