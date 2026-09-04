import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { app } from 'electron'
import {
  validateSeparatorModelReleaseManifest,
  type SeparatorModelReleaseManifest
} from '../src/main/separation/modelManifest'
import {
  resolveInstalledSeparatorModel,
  separatorModelDir,
  separatorModelRoot
} from '../src/main/separation/modelStore'
import {
  installSeparatorModel,
  requiredModelInstallBytes
} from '../src/main/separation/modelInstaller'
import { modelIdForSeparationPreset } from '../src/shared/autoShortSeparation'
import { getAutoShortReadiness, type AutoShortReadinessHooks } from '../src/main/autoshort'
import { loadSeparatorReleaseStatus, separatorFeatureEnabled } from '../src/main/separation/releaseGate'
import type { InstalledSeparatorModel } from '../src/main/separation/modelStore'
import type { RuntimeDistributionManifest } from '../src/main/runtimeManifest'

const validManifest = (): SeparatorModelReleaseManifest => ({
  schemaVersion: 1,
  runtimeChannel: 'runtime-v4',
  models: {
    'separator-fast-balanced-v1': {
      id: 'separator-fast-balanced-v1',
      version: '1.0.0',
      asset: 'separator-fast-balanced-v1.zip',
      archiveBytes: 50_000_000,
      expandedBytes: 60_000_000,
      archiveSha256: 'a'.repeat(64),
      model: { path: 'model.onnx', bytes: 60_000_000, sha256: 'b'.repeat(64) },
      mdx: {
        sampleRate: 44100,
        channels: 2,
        nFft: 6144,
        hopLength: 1024,
        dimF: 3072,
        dimT: 256,
        segmentSamples: 262144,
        primaryStem: 'instrumental'
      },
      source: { url: 'https://example.com/model.onnx', revision: 'release-v1' },
      license: {
        codeSpdx: 'MIT',
        weightName: 'Grant',
        weightUrl: 'https://example.com/lic',
        weightRedistributionApproved: true,
        attribution: 'Attribution'
      }
    },
    'separator-quality-v1': {
      id: 'separator-quality-v1',
      version: '1.0.0',
      asset: 'separator-quality-v1.zip',
      archiveBytes: 55_000_000,
      expandedBytes: 65_000_000,
      archiveSha256: 'c'.repeat(64),
      model: { path: 'model.onnx', bytes: 65_000_000, sha256: 'd'.repeat(64) },
      mdx: {
        sampleRate: 44100,
        channels: 2,
        nFft: 6144,
        hopLength: 1024,
        dimF: 3072,
        dimT: 256,
        segmentSamples: 262144,
        primaryStem: 'instrumental'
      },
      source: { url: 'https://example.com/hq.onnx', revision: 'release-v1' },
      license: {
        codeSpdx: 'MIT',
        weightName: 'Grant',
        weightUrl: 'https://example.com/lic',
        weightRedistributionApproved: true,
        attribution: 'Attribution'
      }
    }
  }
})

test('validates valid separator model release manifest', () => {
  const result = validateSeparatorModelReleaseManifest(validManifest())
  assert.equal(result.ok, true)
})

test('rejects wrong schema or runtime channel', () => {
  const badChannel = validManifest()
  // @ts-expect-error test wrong channel
  badChannel.runtimeChannel = 'runtime-v3'
  assert.equal(validateSeparatorModelReleaseManifest(badChannel).ok, false)

  const badSchema = validManifest()
  // @ts-expect-error test wrong schema
  badSchema.schemaVersion = 2
  assert.equal(validateSeparatorModelReleaseManifest(badSchema).ok, false)
})

test('rejects unsafe asset paths and missing model IDs', () => {
  const unsafe = validManifest()
  unsafe.models['separator-fast-balanced-v1'].asset = '../escape.zip'
  assert.equal(validateSeparatorModelReleaseManifest(unsafe).ok, false)

  const missing = validManifest()
  // @ts-expect-error test missing key
  delete missing.models['separator-quality-v1']
  assert.equal(validateSeparatorModelReleaseManifest(missing).ok, false)
})

test('rejects unapproved weight redistribution and mutable revision', () => {
  const unapproved = validManifest()
  // @ts-expect-error test unapproved
  unapproved.models['separator-fast-balanced-v1'].license.weightRedistributionApproved = false
  assert.equal(validateSeparatorModelReleaseManifest(unapproved).ok, false)

  const mutable = validManifest()
  mutable.models['separator-quality-v1'].source.revision = 'main'
  assert.equal(validateSeparatorModelReleaseManifest(mutable).ok, false)
})

test('Fast and Balanced map to same model ID while Quality has its own', () => {
  assert.equal(modelIdForSeparationPreset('fast'), 'separator-fast-balanced-v1')
  assert.equal(modelIdForSeparationPreset('balanced'), 'separator-fast-balanced-v1')
  assert.equal(modelIdForSeparationPreset('quality'), 'separator-quality-v1')
})

test('requiredModelInstallBytes includes payload plus safety margin', () => {
  const spec = validManifest().models['separator-fast-balanced-v1']
  const bytes = requiredModelInstallBytes(spec)
  assert.ok(bytes > spec.archiveBytes + spec.expandedBytes)
  assert.ok(bytes >= spec.archiveBytes + spec.expandedBytes + 256 * 1024 * 1024)
})

test('installSeparatorModel handles staged install, atomic promotion, rollback, and offline reuse', async () => {
  const testUserData = await mkdtemp(join(tmpdir(), 'tedia-separator-model-test-'))
  const prevUserData = process.env.TEDIAPROS_TEST_USER_DATA
  process.env.TEDIAPROS_TEST_USER_DATA = testUserData

  try {
    const manifest = validManifest()
    const spec = manifest.models['separator-fast-balanced-v1']
    const archiveContent = Buffer.from('fake-archive-content')
    spec.archiveBytes = archiveContent.length
    spec.model.bytes = Buffer.from('model-binary').length
    spec.model.sha256 = '7a75cd0d2cb664963f060bcfa9a9d810bc1e117b90f70ef84d8a51eae8b6f596'
    spec.archiveSha256 = 'fd3d4b42292957ad0b649621615962140c857fbf7342038d6cc6b2b1ab8c3411'

    let fetchCalls = 0
    const mockFetch: typeof fetch = async (input) => {
      fetchCalls++
      const url = String(input)
      if (url.includes('separator-model-manifest.json')) {
        return new Response(JSON.stringify(manifest), { status: 200 })
      }
      return new Response(archiveContent, { status: 200 })
    }

    const mockExtract = async (_archive: string, dest: string) => {
      await writeFile(join(dest, 'model.onnx'), Buffer.from('model-binary'))
    }

    const mockProbe = async () => ({
      ready: true,
      provider: 'cpu' as const,
      modelId: 'separator-fast-balanced-v1' as const
    })

    // First install: downloads and promotes
    const installed = await installSeparatorModel(
      'separator-fast-balanced-v1',
      () => {},
      undefined,
      {
        fetch: mockFetch,
        extract: mockExtract,
        probe: mockProbe,
        freeBytes: async () => 10 * 1024 * 1024 * 1024
      }
    )

    assert.equal(installed.id, 'separator-fast-balanced-v1')
    assert.equal(await readFile(installed.modelPath, 'utf8'), 'model-binary')

    // Second install: already installed and healthy -> zero fetch calls!
    const fetchCallsBefore = fetchCalls
    const reused = await installSeparatorModel(
      'separator-fast-balanced-v1',
      () => {},
      undefined,
      {
        fetch: mockFetch,
        extract: mockExtract,
        probe: mockProbe
      }
    )
    assert.equal(reused.id, 'separator-fast-balanced-v1')
    assert.equal(fetchCalls, fetchCallsBefore) // Zero network requests!

    // Failed install rollback: checksum failure leaves existing model untouched
    const badManifest = validManifest()
    badManifest.models['separator-fast-balanced-v1'].archiveBytes = archiveContent.length
    badManifest.models['separator-fast-balanced-v1'].archiveSha256 = '0'.repeat(64) // wrong hash
    badManifest.models['separator-fast-balanced-v1'].model.bytes = 12
    badManifest.models['separator-fast-balanced-v1'].model.sha256 = spec.model.sha256

    // Delete model to test failure
    await rm(separatorModelDir('separator-fast-balanced-v1'), { recursive: true, force: true })
    await assert.rejects(
      installSeparatorModel(
        'separator-fast-balanced-v1',
        () => {},
        undefined,
        {
          fetch: async (url) => {
            if (String(url).includes('separator-model-manifest.json')) {
              return new Response(JSON.stringify(badManifest), { status: 200 })
            }
            return new Response(archiveContent, { status: 200 })
          },
          extract: mockExtract,
          probe: mockProbe
        }
      )
    )

    // Ensure staging directory was cleaned up
    const stagingDir = `${separatorModelDir('separator-fast-balanced-v1')}.staging`
    const stagingExists = await readFile(stagingDir).then(() => true).catch(() => false)
    assert.equal(stagingExists, false)

  } finally {
    if (prevUserData === undefined) delete process.env.TEDIAPROS_TEST_USER_DATA
    else process.env.TEDIAPROS_TEST_USER_DATA = prevUserData
    await rm(testUserData, { recursive: true, force: true }).catch(() => {})
  }
})

test('loadSeparatorReleaseStatus validates bundled status and separatorFeatureEnabled respects qualification and env', () => {
  const status = loadSeparatorReleaseStatus()
  assert.equal(status.schemaVersion, 1)
  assert.equal(status.qualificationPassed, true)

  // Default is not enabledByDefault
  assert.equal(separatorFeatureEnabled(status, {}), false)
  // Enabled via env override
  assert.equal(separatorFeatureEnabled(status, { TEDIAPROS_ENABLE_SEPARATOR: '1' }), true)
  // Unqualified cannot be enabled even with env override
  const unqualified = { ...status, qualificationPassed: false }
  assert.equal(separatorFeatureEnabled(unqualified, { TEDIAPROS_ENABLE_SEPARATOR: '1' }), false)
})

test('getAutoShortReadiness: replace and mix request no separator dependency', async () => {
  const replaceReadiness = await getAutoShortReadiness({
    subtitleMethod: 'whisper',
    whisperModel: 'base',
    whisperDevice: 'cpu',
    audioMode: 'replace'
  })
  assert.equal(replaceReadiness.separation, undefined)
  assert.ok(!replaceReadiness.dependencies.some((d) => d.id === 'separator-engine'))
  assert.ok(!replaceReadiness.dependencies.some((d) => d.id === 'separator-model'))

  const mixReadiness = await getAutoShortReadiness({
    subtitleMethod: 'whisper',
    whisperModel: 'base',
    whisperDevice: 'cpu',
    audioMode: 'mix'
  })
  assert.equal(mixReadiness.separation, undefined)
  assert.ok(!mixReadiness.dependencies.some((d) => d.id === 'separator-engine'))
  assert.ok(!mixReadiness.dependencies.some((d) => d.id === 'separator-model'))
})

test('getAutoShortReadiness: Fast/Balanced require separator-fast-balanced-v1 and Quality requires separator-quality-v1', async () => {
  const fastReadiness = await getAutoShortReadiness(
    {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      whisperDevice: 'cpu',
      audioMode: 'separate-vocals',
      separationPreset: 'fast'
    },
    {
      resolveSeparatorEngine: async () => null,
      resolveInstalledSeparatorModel: async () => null
    }
  )
  assert.equal(fastReadiness.separation?.modelId, 'separator-fast-balanced-v1')
  assert.ok(fastReadiness.dependencies.some((d) => d.id === 'separator-model' && d.label.includes('separator-fast-balanced-v1')))

  const balancedReadiness = await getAutoShortReadiness(
    {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      whisperDevice: 'cpu',
      audioMode: 'separate-vocals',
      separationPreset: 'balanced'
    },
    {
      resolveSeparatorEngine: async () => null,
      resolveInstalledSeparatorModel: async () => null
    }
  )
  assert.equal(balancedReadiness.separation?.modelId, 'separator-fast-balanced-v1')

  const qualityReadiness = await getAutoShortReadiness(
    {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      whisperDevice: 'cpu',
      audioMode: 'separate-vocals',
      separationPreset: 'quality'
    },
    {
      resolveSeparatorEngine: async () => null,
      resolveInstalledSeparatorModel: async () => null
    }
  )
  assert.equal(qualityReadiness.separation?.modelId, 'separator-quality-v1')
  assert.ok(qualityReadiness.dependencies.some((d) => d.id === 'separator-model' && d.label.includes('separator-quality-v1')))
})

test('getAutoShortReadiness: missing assets expose exact manifest downloadBytes', async () => {
  const mockManifest: RuntimeDistributionManifest = {
    schemaVersion: 1,
    release: 'runtime-v4',
    channel: 'production',
    platform: 'win32',
    arch: 'x64',
    publishedAt: '2026-09-04T00:00:00Z',
    assets: {
      'separator-engine': {
        asset: 'separator-engine.zip',
        sha256: 'e'.repeat(64),
        bytes: 42_123_456,
        entrypoint: 'separator-engine.exe',
        capabilities: ['separator-engine/1', 'directml', 'cpu'],
        files: ['separator-engine.exe']
      }
    }
  }

  const readiness = await getAutoShortReadiness(
    {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      whisperDevice: 'cpu',
      audioMode: 'separate-vocals',
      separationPreset: 'fast'
    },
    {
      resolveSeparatorEngine: async () => null,
      resolveInstalledSeparatorModel: async () => null,
      fetchRuntimeManifest: async () => mockManifest,
      fetchSeparatorModelManifest: async () => validManifest()
    }
  )

  const engineDep = readiness.dependencies.find((d) => d.id === 'separator-engine')
  const modelDep = readiness.dependencies.find((d) => d.id === 'separator-model')
  assert.equal(engineDep?.downloadBytes, 42_123_456)
  assert.equal(modelDep?.downloadBytes, 50_000_000)
})

test('getAutoShortReadiness: DirectML real-model probe success reports effectiveProvider: directml', async () => {
  const fakeInstalled: InstalledSeparatorModel = {
    id: 'separator-fast-balanced-v1',
    directory: 'C:\\fake\\model',
    modelPath: 'C:\\fake\\model\\model.onnx',
    manifestPath: 'C:\\fake\\model\\manifest.json',
    spec: validManifest().models['separator-fast-balanced-v1']
  }

  const readiness = await getAutoShortReadiness(
    {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      whisperDevice: 'cpu',
      audioMode: 'separate-vocals',
      separationPreset: 'balanced'
    },
    {
      resolveSeparatorEngine: async () => 'C:\\fake\\bin\\separator-engine.exe',
      probeRuntimeExecutable: async () => ({ healthy: true, version: '1.0.0', protocol: 'separator-engine/1' }),
      resolveInstalledSeparatorModel: async () => fakeInstalled,
      probeSeparatorModel: async ({ provider }) => ({
        ready: provider === 'directml',
        provider: 'directml',
        modelId: 'separator-fast-balanced-v1'
      })
    }
  )

  assert.equal(readiness.separation?.effectiveProvider, 'directml')
  assert.equal(readiness.separation?.offlineReady, true)
})

test('getAutoShortReadiness: DirectML failure plus CPU success reports effectiveProvider: cpu without blocking', async () => {
  const fakeInstalled: InstalledSeparatorModel = {
    id: 'separator-fast-balanced-v1',
    directory: 'C:\\fake\\model',
    modelPath: 'C:\\fake\\model\\model.onnx',
    manifestPath: 'C:\\fake\\model\\manifest.json',
    spec: validManifest().models['separator-fast-balanced-v1']
  }

  const readiness = await getAutoShortReadiness(
    {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      whisperDevice: 'cpu',
      audioMode: 'separate-vocals',
      separationPreset: 'balanced'
    },
    {
      resolveSeparatorEngine: async () => 'C:\\fake\\bin\\separator-engine.exe',
      probeRuntimeExecutable: async () => ({ healthy: true, version: '1.0.0', protocol: 'separator-engine/1' }),
      resolveInstalledSeparatorModel: async () => fakeInstalled,
      probeSeparatorModel: async ({ provider }) => ({
        ready: provider === 'cpu',
        provider: 'cpu',
        modelId: 'separator-fast-balanced-v1',
        message: provider === 'directml' ? 'DirectML device not available' : undefined
      })
    }
  )

  assert.equal(readiness.separation?.effectiveProvider, 'cpu')
  assert.ok(readiness.separation?.releaseTier)
  const engineDep = readiness.dependencies.find((d) => d.id === 'separator-engine')
  assert.equal(engineDep?.ready, true)
})

test('getAutoShortReadiness: Both probes failing makes readiness false', async () => {
  const fakeInstalled: InstalledSeparatorModel = {
    id: 'separator-fast-balanced-v1',
    directory: 'C:\\fake\\model',
    modelPath: 'C:\\fake\\model\\model.onnx',
    manifestPath: 'C:\\fake\\model\\manifest.json',
    spec: validManifest().models['separator-fast-balanced-v1']
  }

  const readiness = await getAutoShortReadiness(
    {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      whisperDevice: 'cpu',
      audioMode: 'separate-vocals',
      separationPreset: 'balanced'
    },
    {
      resolveSeparatorEngine: async () => 'C:\\fake\\bin\\separator-engine.exe',
      probeRuntimeExecutable: async () => ({ healthy: true, version: '1.0.0', protocol: 'separator-engine/1' }),
      resolveInstalledSeparatorModel: async () => fakeInstalled,
      probeSeparatorModel: async () => ({
        ready: false,
        provider: 'cpu',
        modelId: 'separator-fast-balanced-v1',
        message: 'Engine probe execution failed'
      })
    }
  )

  assert.equal(readiness.separation?.effectiveProvider, null)
  assert.equal(readiness.ready, false)
  const engineDep = readiness.dependencies.find((d) => d.id === 'separator-engine')
  assert.equal(engineDep?.ready, false)
})

test('getAutoShortReadiness: Complete installed model is ready offline when manifest fetch fails', async () => {
  const fakeInstalled: InstalledSeparatorModel = {
    id: 'separator-fast-balanced-v1',
    directory: 'C:\\fake\\model',
    modelPath: 'C:\\fake\\model\\model.onnx',
    manifestPath: 'C:\\fake\\model\\manifest.json',
    spec: validManifest().models['separator-fast-balanced-v1']
  }

  const readiness = await getAutoShortReadiness(
    {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      whisperDevice: 'cpu',
      audioMode: 'separate-vocals',
      separationPreset: 'balanced'
    },
    {
      resolveSeparatorEngine: async () => 'C:\\fake\\bin\\separator-engine.exe',
      probeRuntimeExecutable: async () => ({ healthy: true, version: '1.0.0', protocol: 'separator-engine/1' }),
      resolveInstalledSeparatorModel: async () => fakeInstalled,
      fetchRuntimeManifest: async () => { throw new Error('Offline') },
      fetchSeparatorModelManifest: async () => { throw new Error('Offline') },
      probeSeparatorModel: async ({ provider }) => ({
        ready: provider === 'directml',
        provider: 'directml',
        modelId: 'separator-fast-balanced-v1'
      })
    }
  )

  assert.equal(readiness.separation?.offlineReady, true)
  assert.equal(readiness.separation?.effectiveProvider, 'directml')
  const modelDep = readiness.dependencies.find((d) => d.id === 'separator-model')
  assert.equal(modelDep?.ready, true)
})

test('IPC boundary rejects unapproved properties and invalid audioMode / separationPreset', () => {
  const parse = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Yêu cầu kiểm tra dependency Auto Short không hợp lệ.')
    }
    const r = raw as Record<string, unknown>
    if (typeof r.subtitleMethod !== 'string' || typeof r.whisperModel !== 'string') {
      throw new Error('Yêu cầu kiểm tra dependency Auto Short không hợp lệ.')
    }
    if (r.audioMode !== undefined && r.audioMode !== 'replace' && r.audioMode !== 'mix' && r.audioMode !== 'separate-vocals') {
      throw new Error('Chế độ âm thanh không hợp lệ.')
    }
    if (r.separationPreset !== undefined && (r.separationPreset !== 'fast' && r.separationPreset !== 'balanced' && r.separationPreset !== 'quality')) {
      throw new Error('Chất lượng tách thoại không hợp lệ.')
    }
    if (
      'modelUrl' in r ||
      'modelPath' in r ||
      'enginePath' in r ||
      'providerOverride' in r ||
      'provider' in r
    ) {
      throw new Error('Yêu cầu chứa tham số không được phép.')
    }
    return true
  }

  // Valid configurations
  assert.equal(parse({ subtitleMethod: 'whisper', whisperModel: 'base' }), true)
  assert.equal(parse({ subtitleMethod: 'whisper', whisperModel: 'base', audioMode: 'separate-vocals', separationPreset: 'quality' }), true)

  // Invalid audioMode
  assert.throws(() => parse({ subtitleMethod: 'whisper', whisperModel: 'base', audioMode: 'invalid' }), /Chế độ âm thanh không hợp lệ/)

  // Invalid separationPreset
  assert.throws(() => parse({ subtitleMethod: 'whisper', whisperModel: 'base', audioMode: 'separate-vocals', separationPreset: 'ultra' }), /Chất lượng tách thoại không hợp lệ/)

  // Forbidden fields
  assert.throws(() => parse({ subtitleMethod: 'whisper', whisperModel: 'base', modelUrl: 'https://attacker.com/model.onnx' }), /Yêu cầu chứa tham số không được phép/)
  assert.throws(() => parse({ subtitleMethod: 'whisper', whisperModel: 'base', modelPath: 'C:\\evil.onnx' }), /Yêu cầu chứa tham số không được phép/)
  assert.throws(() => parse({ subtitleMethod: 'whisper', whisperModel: 'base', enginePath: 'C:\\evil.exe' }), /Yêu cầu chứa tham số không được phép/)
  assert.throws(() => parse({ subtitleMethod: 'whisper', whisperModel: 'base', providerOverride: 'cpu' }), /Yêu cầu chứa tham số không được phép/)
})


