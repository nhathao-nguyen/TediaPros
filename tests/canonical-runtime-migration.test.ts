import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { app } from 'electron'
import {
  resolveRuntimeExecutable,
  runtimeKindDir,
  runtimeSearchRoots
} from '../src/main/runtimeResolver'
import { validateRuntimeDistributionManifest } from '../src/main/runtimeManifest'
import { isWhisperVersionEvent } from '../src/main/engineProtocol'
import { isCompleteWhisperModel } from '../src/main/modelStore'
import { WHISPER_MODEL_CATALOG } from '../src/main/modelCatalog'

test('canonical runtime directories keep FFmpeg in its own managed directory', () => {
  assert.equal(runtimeKindDir('ffmpeg'), join(app.getPath('userData'), 'bin', 'ffmpeg'))
  assert.equal(runtimeKindDir('whisper-engine'), join(app.getPath('userData'), 'bin', 'whisper-engine'))
})

test('production runtime resolution does not search developer or legacy roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-runtime-isolation-'))
  const previous = process.env.TEDIAPROS_RUNTIME_DIR
  process.env.TEDIAPROS_RUNTIME_DIR = root
  try {
    const legacy = join(root, 'whisper-engine')
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, 'whisper-engine.exe'), 'developer placeholder')
    assert.deepEqual(runtimeSearchRoots('whisper-engine'), [join(app.getPath('userData'), 'bin', 'whisper-engine')])
    assert.equal(await resolveRuntimeExecutable('whisper-engine', ['whisper-engine.exe']), null)
  } finally {
    if (previous === undefined) delete process.env.TEDIAPROS_RUNTIME_DIR
    else process.env.TEDIAPROS_RUNTIME_DIR = previous
  }
})

test('runtime manifest rejects an empty asset set', () => {
  const result = validateRuntimeDistributionManifest({
    schemaVersion: 1,
    runtimeVersion: 'runtime-v2',
    platform: 'win32',
    arch: 'x64',
    assets: {}
  })
  assert.equal(result.ok, false)
})

test('runtime manifest rejects assets for a different platform or architecture', () => {
  const result = validateRuntimeDistributionManifest({
    schemaVersion: 1,
    runtimeVersion: 'runtime-v2',
    platform: 'win32',
    arch: 'x64',
    assets: {
      'whisper-engine': {
        version: '2.0.0',
        platform: 'darwin',
        arch: 'arm64',
        asset: 'whisper-engine-macos.zip',
        sha256: 'a'.repeat(64),
        entrypoint: 'whisper-engine/whisper-engine'
      }
    }
  })
  assert.equal(result.ok, false)
})

test('runtime manifest requires an explicit required-file list', () => {
  const result = validateRuntimeDistributionManifest({
    schemaVersion: 1,
    runtimeVersion: 'runtime-v2',
    platform: 'win32',
    arch: 'x64',
    assets: {
      'whisper-engine': {
        version: '2.0.0',
        platform: 'win32',
        arch: 'x64',
        asset: 'whisper-engine-win.zip',
        sha256: 'a'.repeat(64),
        entrypoint: 'whisper-engine.exe'
      }
    }
  })
  assert.equal(result.ok, false)
})

test('runtime manifest requires at least one declared capability', () => {
  const result = validateRuntimeDistributionManifest({
    schemaVersion: 1,
    runtimeVersion: 'runtime-v2',
    platform: 'win32',
    arch: 'x64',
    assets: {
      'whisper-engine': {
        version: '2.0.0',
        platform: 'win32',
        arch: 'x64',
        asset: 'whisper-engine-win.zip',
        sha256: 'a'.repeat(64),
        bytes: 1,
        entrypoint: 'whisper-engine.exe',
        files: ['whisper-engine.exe'],
        capabilities: []
      }
    }
  })
  assert.equal(result.ok, false)
})

test('Whisper version validation rejects legacy whisper.cpp protocol and backend', () => {
  assert.equal(isWhisperVersionEvent({
    type: 'version',
    protocol: 'whisper-local/1',
    engine: 'whisper.cpp',
    version: '1.9.3'
  }), false)
})

test('CUDA capability probe requires the canonical Faster-Whisper protocol', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'runtimeProbes.ts'), 'utf8')
  const start = source.indexOf('async function probeCuda')
  const end = source.indexOf('async function probeOcr', start)
  const cudaProbe = source.slice(start, end)
  assert.match(cudaProbe, /value\.protocol === 'whisper-engine\/1'/u)
  assert.match(cudaProbe, /value\.engine === 'faster-whisper'/u)
})

test('media pipelines never fall back to system FFmpeg or FFprobe', async () => {
  const autoshort = await readFile(join(process.cwd(), 'src', 'main', 'autoshort.ts'), 'utf8')
  const ytdlp = await readFile(join(process.cwd(), 'src', 'main', 'ytdlp.ts'), 'utf8')
  assert.doesNotMatch(autoshort, /resolveFfmpeg\(\)\)\s*\|\|\s*['"]ffmpeg/u)
  assert.doesNotMatch(ytdlp, /if\s*\(ffmpeg\s*===\s*['"]ffmpeg['"]\)/u)
  assert.doesNotMatch(ytdlp, /return\s+['"]ffprobe['"]/u)
})

test('a model with only model.bin is not a complete Faster-Whisper model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-model-completeness-'))
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'model.bin'), 'model')
  assert.equal(await isCompleteWhisperModel(root, 'base'), false)
})

test('a model manifest must use the catalog pinned revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-model-pinned-revision-'))
  const payloads = {
    'model.bin': 'model',
    'config.json': '{}',
    'tokenizer.json': '{}',
    'vocabulary.json': '{}'
  }
  const files = []
  for (const [path, contents] of Object.entries(payloads)) {
    await writeFile(join(root, path), contents)
    files.push({
      path,
      bytes: Buffer.byteLength(contents),
      sha256: createHash('sha256').update(contents).digest('hex')
    })
  }
  await writeFile(join(root, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'base',
    repoId: WHISPER_MODEL_CATALOG.base.repoId,
    revision: 'b'.repeat(40),
    backend: 'faster-whisper',
    format: 'ctranslate2',
    files,
    languageFamily: 'multilingual',
    engineProtocol: 'whisper-engine/1'
  }))
  assert.notEqual(WHISPER_MODEL_CATALOG.base.revision, 'b'.repeat(40))
  assert.equal(await isCompleteWhisperModel(root, 'base'), false)
  await rm(root, { recursive: true, force: true })
})

test('runtime installer promotes only a checksum-verified and probed staging tree', async () => {
  const { downloadRuntimeEngineFromManifest } = await import('../src/main/runtimeInstaller')
  const target = runtimeKindDir('video2x')
  await rm(target, { recursive: true, force: true })
  const archive = Buffer.from('runtime-archive-fixture')
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64'
  const manifest = {
    schemaVersion: 1,
    runtimeVersion: 'runtime-v2',
    platform,
    arch,
    assets: {
      video2x: {
        version: '6.4.0', platform, arch, asset: 'video2x.zip',
        sha256: createHash('sha256').update(archive).digest('hex'), bytes: archive.length,
        entrypoint: 'video2x.exe', capabilities: ['list-devices'], files: ['video2x.exe']
      }
    }
  }
  let request = 0
  const result = await downloadRuntimeEngineFromManifest('video2x', () => {}, {
    fetch: async () => request++ === 0
      ? new Response(JSON.stringify(manifest), { status: 200 })
      : new Response(archive, { status: 200 }),
    extract: async (_archive, destination) => {
      await writeFile(join(destination, 'video2x.exe'), 'verified runtime')
    },
    probe: async () => ({ healthy: true, version: '6.4.0' }),
    now: () => '2026-08-30T00:00:00.000Z'
  })
  assert.equal(result, true)
  assert.equal(await readFile(join(target, 'video2x.exe'), 'utf8'), 'verified runtime')
  assert.equal(await readFile(join(app.getPath('userData'), 'runtime-state', 'installed-runtime.json'), 'utf8').then((raw) => JSON.parse(raw).video2x.version), '6.4.0')
  assert.equal(await readFile(`${target}.staging\video2x.zip`, 'utf8').catch(() => null), null)
  await rm(target, { recursive: true, force: true })
})

test('runtime installer leaves the active tree untouched when the real probe fails', async () => {
  const { downloadRuntimeEngineFromManifest } = await import('../src/main/runtimeInstaller')
  const target = runtimeKindDir('video2x')
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'version.txt'), 'old-runtime')
  const archive = Buffer.from('runtime-archive-fixture')
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64'
  const manifest = {
    schemaVersion: 1, runtimeVersion: 'runtime-v2', platform, arch,
    assets: { video2x: {
      version: '6.4.0', platform, arch, asset: 'video2x.zip',
      sha256: createHash('sha256').update(archive).digest('hex'), bytes: archive.length,
      entrypoint: 'video2x.exe', capabilities: ['list-devices'], files: ['video2x.exe']
    } }
  }
  let request = 0
  await assert.rejects(downloadRuntimeEngineFromManifest('video2x', () => {}, {
    fetch: async () => request++ === 0
      ? new Response(JSON.stringify(manifest), { status: 200 })
      : new Response(archive, { status: 200 }),
    extract: async (_archive, destination) => { await writeFile(join(destination, 'video2x.exe'), 'new-runtime') },
    probe: async () => ({ healthy: false, message: 'probe failed' })
  }))
  assert.equal(await readFile(join(target, 'version.txt'), 'utf8'), 'old-runtime')
  await rm(target, { recursive: true, force: true })
})
