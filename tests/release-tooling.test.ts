import { access, mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyRuntimeReleaseDirectory } from '../scripts/verify-runtime-release.mjs'

function currentPlatform(): 'win32' | 'darwin' | 'linux' {
  return process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
}

function currentArch(): 'x64' | 'arm64' | 'ia32' {
  return process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64'
}

test('runtime release verifier rejects an asset without required files and capabilities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-release-contract-'))
  try {
    const bytes = Buffer.from('not-a-zip')
    await writeFile(join(root, 'video2x.zip'), bytes)
    await writeFile(join(root, 'runtime-manifest.json'), JSON.stringify({
      schemaVersion: 1,
      runtimeVersion: 'runtime-v2',
      platform: currentPlatform(),
      arch: currentArch(),
      assets: {
        video2x: {
          version: '6.4.0',
          platform: currentPlatform(),
          arch: currentArch(),
          asset: 'video2x.zip',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes: bytes.length,
          entrypoint: 'video2x.exe'
        }
      }
    }))
    const result = await verifyRuntimeReleaseDirectory(root)
    assert.equal(result.ok, false)
    assert.match(result.error, /files|capabilities|manifest/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runtime packer requires an explicit clean input directory and refuses an empty release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-runtime-pack-'))
  try {
    const result = spawnSync(process.execPath, [
      'scripts/pack-runtime-release.mjs',
      '--input-dir',
      root,
      '--output-dir',
      join(root, 'out')
    ], { encoding: 'utf8', cwd: process.cwd(), windowsHide: true })
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /input|asset|empty|runtime/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pinned engine dependency inputs do not reintroduce the retired Whisper backend', async () => {
  const { readFile } = await import('node:fs/promises')
  const whisperRequirements = await readFile(join(process.cwd(), 'engines', 'whisper-engine', 'requirements.txt'), 'utf8')
  const ocrRequirements = await readFile(join(process.cwd(), 'engines', 'ocr-engine', 'requirements.txt'), 'utf8')
  const douyinRequirements = await readFile(join(process.cwd(), 'engines', 'douyin-engine', 'requirements.txt'), 'utf8')
  const douyinProject = await readFile(join(process.cwd(), 'engines', 'douyin-engine', 'pyproject.toml'), 'utf8')
  const whisperSpec = await readFile(join(process.cwd(), 'engines', 'whisper-engine', 'whisper-engine.spec'), 'utf8')
  const ocrSpec = await readFile(join(process.cwd(), 'engines', 'ocr-engine', 'ocr-engine.spec'), 'utf8')
  const douyinSpec = await readFile(join(process.cwd(), 'engines', 'douyin-engine', 'dy-engine.spec'), 'utf8')
  for (const requirements of [whisperRequirements, ocrRequirements, douyinRequirements]) {
    assert.doesNotMatch(requirements, />=|<=|~=|\*/u)
    assert.match(requirements, /==/u)
  }
  assert.doesNotMatch(douyinProject, /openai-whisper|\[project\.optional-dependencies\][\s\S]*transcribe/iu)
  for (const spec of [whisperSpec, ocrSpec, douyinSpec]) assert.doesNotMatch(spec, /except\s+Exception\s*:\s*\n\s+pass/u)
})

test('PyInstaller specs resolve entrypoints and hooks from the spec directory, not the process CWD', async () => {
  const { readFile } = await import('node:fs/promises')
  const specs = [
    ['engines/whisper-engine/whisper-engine.spec', 'engine.py'],
    ['engines/ocr-engine/ocr-engine.spec', 'engine.py'],
    ['engines/douyin-engine/dy-engine.spec', 'run.py']
  ] as const
  for (const [file, entrypoint] of specs) {
    const source = await readFile(join(process.cwd(), file), 'utf8')
    assert.match(source, /^SPEC_DIR\s*=\s*Path\(SPECPATH\)\.resolve\(\)\s*$/mu, `${file} must use PyInstaller's absolute spec directory`)
    assert.doesNotMatch(source, /__file__/u, `${file} must not rely on __file__; PyInstaller does not define it in spec namespaces`)
    assert.match(source, new RegExp(`Analysis\\(\\s*\\[\\s*str\\(SPEC_DIR\\s*\\/\\s*['"]${entrypoint}['"]\\)`), `${file} must use an absolute entrypoint`)
    assert.doesNotMatch(source, new RegExp(`Analysis\\(\\s*\\[\\s*['"]${entrypoint}['"]`), `${file} still depends on CWD`)
  }
})

test('Douyin runtime source contains the storage package required by its CLI and downloader', async () => {
  const storageFiles = ['__init__.py', 'database.py', 'file_manager.py', 'metadata_handler.py']
  for (const file of storageFiles) {
    const path = join(process.cwd(), 'engines', 'douyin-engine', 'storage', file)
    const info = await stat(path).catch(() => null)
    assert.ok(info?.isFile(), `missing Douyin runtime source file: ${path}`)
  }
})

test('Windows runtime workflow stops when a native capability probe fails', async () => {
  const workflow = await readFile(join(process.cwd(), '.github', 'workflows', 'build-windows-runtime.yml'), 'utf8')
  const start = workflow.indexOf('Run native capability probes before packaging')
  const end = workflow.indexOf('Create and verify runtime-v3 manifest from clean artifacts', start)
  const probeStep = workflow.slice(start, end)
  assert.match(probeStep, /LASTEXITCODE\s*-ne\s*0[\s\S]{0,180}(throw|exit)/u)
})

test('Windows runtime workflow uses a headless-safe Video2X startup probe', async () => {
  const workflow = await readFile(join(process.cwd(), '.github', 'workflows', 'build-windows-runtime.yml'), 'utf8')
  const start = workflow.indexOf('Run native capability probes before packaging')
  const end = workflow.indexOf('Create and verify runtime-v3 manifest from clean artifacts', start)
  const probeStep = workflow.slice(start, end)
  assert.match(probeStep, /video2x\\video2x\.exe'\)\s+@\('--version'\)/u)
  assert.doesNotMatch(probeStep, /video2x\\video2x\.exe'\)\s+@\('-l'\)/u)
})

test('runtime input spec pins the Video2X archive with a SHA-256 digest', async () => {
  const inputSpec = JSON.parse(await readFile(join(process.cwd(), 'distribution', 'runtime-inputs.json'), 'utf8'))
  const video2x = inputSpec.assets?.video2x?.source
  assert.match(video2x?.sha256 || '', /^[a-f0-9]{64}$/iu)
  assert.doesNotMatch(video2x?.verification || '', /recorded in runtime-manifest/iu)
  const workflow = await readFile(join(process.cwd(), '.github', 'workflows', 'build-windows-runtime.yml'), 'utf8')
  assert.match(workflow, /assets\.video2x\.source\.sha256/u)
})

test('Windows runtime workflow stages pinned CUDA packages from an isolated target', async () => {
  const workflow = await readFile(join(process.cwd(), '.github', 'workflows', 'build-windows-runtime.yml'), 'utf8')
  assert.match(workflow, /nvidia-cuda-runtime-cu12/u)
  assert.match(workflow, /nvidia-cublas-cu12/u)
  assert.match(workflow, /nvidia-cudnn-cu12/u)
  assert.match(workflow, /--target\s+\$cudaPackageRoot/u)
  assert.match(workflow, /--no-deps[\s\S]{0,240}\$cudaRequirements/u)
  assert.match(workflow, /Get-Content[\s\S]{0,180}engines\\whisper-engine\\requirements\.txt/u)
  assert.match(workflow, /Pinned CUDA file missing/u)
})

test('Windows runtime workflow does not enable a pip cache that its no-cache builds cannot populate', async () => {
  const workflow = await readFile(join(process.cwd(), '.github', 'workflows', 'build-windows-runtime.yml'), 'utf8')
  assert.doesNotMatch(workflow, /^\s+cache:\s*pip\s*$/mu)
})

test('runtime archive safety policy rejects traversal and absolute entry names', async () => {
  const { isSafeRuntimeArchiveEntryPath } = await import('../src/main/runtimeInstaller')
  assert.equal(isSafeRuntimeArchiveEntryPath('bin/engine.exe'), true)
  for (const entry of ['../engine.exe', '..\\engine.exe', 'bin/../../engine.exe', '/absolute.exe', 'C:\\absolute.exe', 'bin//engine.exe']) {
    assert.equal(isSafeRuntimeArchiveEntryPath(entry), false, `unsafe archive entry accepted: ${entry}`)
  }
})

test('runtime archive validator reads real ZIP entries before extraction', async () => {
  if (process.platform !== 'win32') return
  const { extractZip, validateZipArchive } = await import('../src/main/deps')
  const root = await mkdtemp(join(tmpdir(), 'tedia-zip-safety-'))
  try {
    const source = join(root, 'engine.exe')
    const safeZip = join(root, 'safe.zip')
    await writeFile(source, 'safe')
    const psLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`
    const safeResult = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Compress-Archive -LiteralPath ${psLiteral(source)} -DestinationPath ${psLiteral(safeZip)} -Force`
    ], { encoding: 'utf8', windowsHide: true })
    assert.equal(safeResult.status, 0, safeResult.stderr)
    await validateZipArchive(safeZip)
    const extracted = join(root, 'extracted')
    await extractZip(safeZip, extracted)
    assert.equal(await readFile(join(extracted, 'engine.exe'), 'utf8'), 'safe')

    const unsafeZip = join(root, 'unsafe.zip')
    const unsafeResult = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::Open(${psLiteral(unsafeZip)}, [System.IO.Compression.ZipArchiveMode]::Create); try { $entry = $zip.CreateEntry("../escape.exe"); $stream = $entry.Open(); $stream.WriteByte(120); $stream.Dispose() } finally { $zip.Dispose() }`
    ], { encoding: 'utf8', windowsHide: true })
    assert.equal(unsafeResult.status, 0, unsafeResult.stderr)
    await assert.rejects(validateZipArchive(unsafeZip), /path không an toàn|unsafe|escape/iu)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runtime release verifier rejects unsafe ZIP entries before publishing', async () => {
  if (process.platform !== 'win32') return
  const { verifyRuntimeReleaseDirectory } = await import('../scripts/verify-runtime-release.mjs')
  const root = await mkdtemp(join(tmpdir(), 'tedia-release-zip-safety-'))
  try {
    const unsafeZip = join(root, 'engine.zip')
    const psLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`
    const createZip = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::Open(${psLiteral(unsafeZip)}, [System.IO.Compression.ZipArchiveMode]::Create); try { $safe = $zip.CreateEntry('engine.exe'); $safeStream = $safe.Open(); $safeStream.WriteByte(120); $safeStream.Dispose(); $bad = $zip.CreateEntry('../escape.exe'); $badStream = $bad.Open(); $badStream.WriteByte(120); $badStream.Dispose() } finally { $zip.Dispose() }`
    ], { encoding: 'utf8', windowsHide: true })
    assert.equal(createZip.status, 0, createZip.stderr)
    const bytes = await readFile(unsafeZip)
    const manifest = {
      schemaVersion: 1,
      runtimeVersion: 'runtime-v2',
      platform: 'win32',
      arch: 'x64',
      assets: {
        video2x: {
          version: '1.0.0',
          platform: 'win32',
          arch: 'x64',
          asset: 'engine.zip',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes: bytes.length,
          entrypoint: 'engine.exe',
          capabilities: ['probe'],
          files: ['engine.exe']
        }
      }
    }
    await writeFile(join(root, 'runtime-manifest.json'), JSON.stringify(manifest))
    await writeFile(join(root, 'runtime-provenance.json'), JSON.stringify({
      schemaVersion: 1,
      runtimeVersion: 'runtime-v2',
      platform: 'win32',
      arch: 'x64'
    }))
    const result = await verifyRuntimeReleaseDirectory(root)
    assert.equal(result.ok, false)
    assert.match(result.error, /unsafe|không an toàn|path/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows app release verification has an explicit Windows-only mode', async () => {
  const workflow = await readFile(join(process.cwd(), '.github', 'workflows', 'release-app.yml'), 'utf8')
  const verifier = await readFile(join(process.cwd(), 'scripts', 'verify-release-assets.mjs'), 'utf8')
  assert.match(workflow, /--windows-only/u)
  assert.match(verifier, /windows-only|windowsOnly/u)
  const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'))
  assert.match(packageJson.scripts['release:verify-assets'], /--windows-only/u)
})

test('app release publish job installs Node dependencies before verifying assets', async () => {
  const workflow = await readFile(join(process.cwd(), '.github', 'workflows', 'release-app.yml'), 'utf8')
  const publishJob = workflow.slice(workflow.indexOf('\n  publish:\n'))
  const setupIndex = publishJob.indexOf('uses: actions/setup-node@v4')
  const installIndex = publishJob.indexOf('run: npm ci', setupIndex)
  const verifyIndex = publishJob.indexOf('node scripts/verify-release-assets.mjs', installIndex)
  assert.ok(setupIndex >= 0, 'publish job must set up Node.js')
  assert.ok(installIndex > setupIndex, 'publish job must install Node dependencies')
  assert.ok(verifyIndex > installIndex, 'publish job must install dependencies before verifying assets')
})

test('release tooling has no developer-machine or destructive re-upload fallback', async () => {
  const { readFile } = await import('node:fs/promises')
  const packer = await readFile(join(process.cwd(), 'scripts', 'pack-runtime-release.mjs'), 'utf8')
  const publisher = await readFile(join(process.cwd(), 'scripts', 'publish-github-release.mjs'), 'utf8')
  const verifier = await readFile(join(process.cwd(), 'scripts', 'verify-runtime-release.mjs'), 'utf8')
  assert.doesNotMatch(packer, /where\.exe|findInPath|process\.env\.PATH/u)
  assert.doesNotMatch(publisher, /method:\s*['"]DELETE['"]/u)
  assert.doesNotMatch(verifier, /containsEntrypoint\s*=\s*true/u)
  assert.match(publisher, /runtime-v5/u)
  assert.match(publisher, /manifest\.runtimeVersion/u)
  assert.match(publisher, /different runtime version|runtimeVersion/u)
  assert.match(publisher, /draft:\s*true/u)
  assert.match(publisher, /method:\s*['"]PATCH['"]/u)
})

test('runtime packer archives every canonical kind and verifies the generated manifest', async () => {
  const { readFile } = await import('node:fs/promises')
  const { buildRuntimeRelease } = await import('../scripts/pack-runtime-release.mjs')
  const root = await mkdtemp(join(tmpdir(), 'tedia-runtime-pack-success-'))
  try {
    const inputSpecPath = join(root, 'runtime-inputs.json')
    const inputSpec = JSON.parse(await readFile(join(process.cwd(), 'distribution', 'runtime-inputs.json'), 'utf8'))
    inputSpec.assets['ffmpeg'].capabilities = ['version', 'ffprobe']
    await writeFile(inputSpecPath, JSON.stringify(inputSpec))
    for (const [kind, metadata] of Object.entries(inputSpec.assets)) {
      const dir = join(root, 'inputs', kind)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, metadata.entrypoint), Buffer.from(`clean-${kind}`))
    }
    const result = await buildRuntimeRelease({
      inputDir: join(root, 'inputs'),
      outputDir: join(root, 'release'),
      runtimeVersion: inputSpec.runtimeVersion,
      platform: inputSpec.platform,
      arch: inputSpec.arch,
      inputSpecPath
    })
    assert.equal(Object.keys(result.manifest.assets).length, 7)
    assert.equal((await readFile(join(root, 'release', 'runtime-provenance.json'), 'utf8')).includes('runtime-v5'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('packaged app verifier and builder configuration strictly exclude separator assets', async () => {
  const { findForbiddenFiles } = await import('../scripts/verify-packaged-app.mjs')
  const root = await mkdtemp(join(tmpdir(), 'tedia-sep-pkg-'))
  try {
    const forbiddenRelPaths = [
      'separator-engine.exe',
      join('separator-models', 'model.onnx'),
      'model.onnx',
      'separator-model-manifest.json',
      'separator-model-inputs.json',
      join('separator-benchmark-results', 'summary.json'),
      join('tests', 'fixtures', 'separator', 'test.wav')
    ]
    for (const rel of forbiddenRelPaths) {
      const full = join(root, rel)
      await mkdir(join(full, '..'), { recursive: true })
      await writeFile(full, 'fake')
    }

    const violations = await findForbiddenFiles(root)
    for (const rel of forbiddenRelPaths) {
      assert.ok(violations.some((v) => v.includes(rel)), `Must detect violation for ${rel}`)
    }

    // Builder configuration
    const builderYml = await readFile(join(process.cwd(), 'electron-builder.yml'), 'utf8')
    assert.match(builderYml, /!\*\*\/\*\.onnx/u)
    assert.match(builderYml, /!separator-models/u)
    assert.match(builderYml, /!separator-engine/u)
    assert.match(builderYml, /!separator-model-manifest\.json/u)
    assert.match(builderYml, /!separator-model-inputs\.json/u)
    assert.match(builderYml, /!separator-benchmark-results/u)
    assert.match(builderYml, /!tests\/fixtures\/separator/u)

    // Licensing notices
    const notices = await readFile(join(process.cwd(), 'THIRD-PARTY-NOTICES.txt'), 'utf8')
    const licenseView = await readFile(join(process.cwd(), 'src', 'renderer', 'src', 'components', 'License.tsx'), 'utf8')

    for (const text of [notices, licenseView]) {
      assert.match(text, /separator-fast-balanced-v1/u)
      assert.match(text, /separator-quality-v1/u)
      assert.match(text, /ONNX Runtime/iu)
      assert.match(text, /DirectML/iu)
      assert.match(text, /separator-engine|Ultimate Vocal Remover|MDX/iu)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

export const V4_SEPARATOR_BASELINE = {
  'separator-fast-balanced-v1': {
    id: 'separator-fast-balanced-v1',
    version: '1.0.0',
    source: {
      url: 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_3.onnx',
      revision: 'all_public_uvr_models',
      bytes: 63234907,
      sha256: '4b92b6a8f15d78a8f121d58cf5f5cc1b068868a867c2ce414d3f3e1a067e4e1a'
    },
    license: {
      codeSpdx: 'MIT',
      weightName: 'Open Model Redistribution Grant',
      weightUrl: 'https://github.com/Anjok07/ultimatevocalremovergui/blob/master/LICENSE',
      weightRedistributionApproved: true,
      attribution: 'UVR MDX-Net project and Kuielab contributors.'
    },
    model: {
      path: 'model.onnx',
      bytes: 63234907,
      sha256: '4b92b6a8f15d78a8f121d58cf5f5cc1b068868a867c2ce414d3f3e1a067e4e1a'
    },
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
    qualificationReport: 'docs/benchmarks/2026-09-04-separator-model-qualification.md'
  },
  'separator-quality-v1': {
    id: 'separator-quality-v1',
    version: '1.0.0',
    source: {
      url: 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_3.onnx',
      revision: 'all_public_uvr_models',
      bytes: 64894371,
      sha256: '6b9e38ef8ffaa49f1165ad5eb42a4dfd1c3a64731f8280f339cfdf5ec8749a93'
    },
    license: {
      codeSpdx: 'MIT',
      weightName: 'Open Model Redistribution Grant',
      weightUrl: 'https://github.com/Anjok07/ultimatevocalremovergui/blob/master/LICENSE',
      weightRedistributionApproved: true,
      attribution: 'UVR MDX-Net project and Kuielab contributors.'
    },
    model: {
      path: 'model.onnx',
      bytes: 64894371,
      sha256: '6b9e38ef8ffaa49f1165ad5eb42a4dfd1c3a64731f8280f339cfdf5ec8749a93'
    },
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
    qualificationReport: 'docs/benchmarks/2026-09-04-separator-model-qualification.md'
  }
} as const

test('Task 11.1: Separator model baseline deep-equals current catalog omitting runtimeChannel', async () => {
  const currentInputs = JSON.parse(await readFile(join(process.cwd(), 'distribution', 'separator-model-inputs.json'), 'utf8'))
  const { runtimeChannel: _, ...rest } = currentInputs
  assert.deepEqual(rest.models, V4_SEPARATOR_BASELINE)
})

test('Task 11.2: runtime-v5 default is used across all distribution configs, workflows, and packers', async () => {
  const distConfig = await readFile(join(process.cwd(), 'src', 'main', 'distributionConfig.ts'), 'utf8')
  assert.match(distConfig, /runtime-v5/u)

  const runtimeInputs = JSON.parse(await readFile(join(process.cwd(), 'distribution', 'runtime-inputs.json'), 'utf8'))
  assert.equal(runtimeInputs.runtimeVersion, 'runtime-v5')

  const separatorInputs = JSON.parse(await readFile(join(process.cwd(), 'distribution', 'separator-model-inputs.json'), 'utf8'))
  assert.equal(separatorInputs.runtimeChannel, 'runtime-v5')

  const workflow = await readFile(join(process.cwd(), '.github', 'workflows', 'build-windows-runtime.yml'), 'utf8')
  assert.match(workflow, /default:\s*runtime-v5/u)

  const publisher = await readFile(join(process.cwd(), 'scripts', 'publish-github-release.mjs'), 'utf8')
  assert.match(publisher, /DEFAULT_RUNTIME_CHANNEL\s*=\s*['"]runtime-v5['"]/u)

  const separatorPacker = await readFile(join(process.cwd(), 'scripts', 'pack-separator-model-release.mjs'), 'utf8')
  assert.match(separatorPacker, /runtimeVersion\s*\|\|\s*['"]runtime-v5['"]/u)
})

test('Task 11.3: OCR capability requires 1.2.0, ocr-local/1, and exact capabilities without duplicates', async () => {
  const runtimeInputs = JSON.parse(await readFile(join(process.cwd(), 'distribution', 'runtime-inputs.json'), 'utf8'))
  const ocr = runtimeInputs.assets['ocr-engine']
  assert.equal(ocr.version, '1.2.0')
  assert.equal(ocr.protocol, 'ocr-local/1')
  assert.deepEqual(ocr.capabilities, [
    'probe',
    'rapidocr',
    'directml-fallback',
    'visual-cues-v1',
    'visual-stream-full-v1',
    'visual-stream-roi-v1'
  ])
})

test('Task 11.4: FFmpeg ocr-mask-v1 packaging and proof verification test matrix', async () => {
  const { buildRuntimeRelease, deriveFfmpegOcrMaskProof } = await import('../scripts/pack-runtime-release.mjs')
  const { verifyRuntimeReleaseDirectory } = await import('../scripts/verify-runtime-release.mjs')

  const sampleCases = [
    { id: 'appear-disappear', passed: true },
    { id: 'terminal-black-frame', passed: true },
    { id: 'moving-resize', passed: true },
    { id: 'moving-resize-with-narration', passed: true }
  ]

  // Pure helper tests
  // 1. Success with native: true
  const proof = deriveFfmpegOcrMaskProof({
    probeResult: {
      healthy: true,
      features: ['ocr-mask-v1'],
      cases: sampleCases,
      ffmpegExecutableSha256: 'deadbeef'
    },
    expectedExecutableSha256: 'deadbeef',
    runtimeVersion: 'runtime-v5',
    platform: 'win32',
    arch: 'x64',
    asset: 'tediapros-ffmpeg-win32-x64.zip',
    entrypoint: 'ffmpeg.exe',
    isNative: true,
    now: () => '2026-09-05T12:00:00.000Z'
  })
  assert.equal(proof.schemaVersion, 1)
  assert.equal(proof.capability, 'ocr-mask-v1')
  assert.equal(proof.native, true)
  assert.equal(proof.passed, true)
  assert.equal(proof.executedAt, '2026-09-05T12:00:00.000Z')
  assert.equal(proof.ffmpegExecutableSha256, 'deadbeef')

  // 2. Pure helper: failed/missing case throws
  assert.throws(() => {
    deriveFfmpegOcrMaskProof({
      probeResult: {
        healthy: true,
        features: ['ocr-mask-v1'],
        cases: sampleCases.slice(0, 3)
      },
      expectedExecutableSha256: 'deadbeef',
      runtimeVersion: 'runtime-v5',
      platform: 'win32',
      arch: 'x64',
      asset: 'tediapros-ffmpeg-win32-x64.zip',
      entrypoint: 'ffmpeg.exe'
    })
  }, /all required test cases/i)

  // 3. Pure helper: hash mismatch throws
  assert.throws(() => {
    deriveFfmpegOcrMaskProof({
      probeResult: {
        healthy: true,
        features: ['ocr-mask-v1'],
        cases: sampleCases,
        ffmpegExecutableSha256: 'otherhash'
      },
      expectedExecutableSha256: 'deadbeef',
      runtimeVersion: 'runtime-v5',
      platform: 'win32',
      arch: 'x64',
      asset: 'tediapros-ffmpeg-win32-x64.zip',
      entrypoint: 'ffmpeg.exe'
    })
  }, /does not match expected/i)

  // Integration matrix
  const root = await mkdtemp(join(tmpdir(), 'tedia-task11-4-'))
  try {
    const baseSpec = JSON.parse(await readFile(join(process.cwd(), 'distribution', 'runtime-inputs.json'), 'utf8'))
    const inputsDir = join(root, 'inputs')
    for (const [kind, metadata] of Object.entries(baseSpec.assets) as [string, any][]) {
      const dir = join(inputsDir, kind)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, metadata.entrypoint), Buffer.from(`staged-${kind}`))
    }

    // Branch 1: no ocr-mask-v1 -> success, feature absent, proof absent
    const noOcrSpec = JSON.parse(JSON.stringify(baseSpec))
    noOcrSpec.assets['ffmpeg'].capabilities = ['version', 'ffprobe']
    const noOcrSpecPath = join(root, 'no-ocr-spec.json')
    await writeFile(noOcrSpecPath, JSON.stringify(noOcrSpec))
    let probeCalled = false
    const res1 = await buildRuntimeRelease({
      inputDir: inputsDir,
      outputDir: join(root, 'release-no-ocr'),
      runtimeVersion: 'runtime-v5',
      platform: 'win32',
      arch: 'x64',
      inputSpecPath: noOcrSpecPath,
      probeFfmpegOcrMask: async () => {
        probeCalled = true
        throw new Error('should not be called')
      }
    })
    assert.equal(probeCalled, false)
    assert.equal(res1.manifest.assets['ffmpeg'].capabilities.includes('ocr-mask-v1'), false)
    assert.equal(res1.manifest.provenance?.nativeCapabilityProofs?.ffmpegOcrMask, undefined)

    // Branch 2: requests feature + injected hook (non-native) -> pack fails release verification because native !== true
    const ocrSpec = JSON.parse(JSON.stringify(baseSpec))
    const ocrSpecPath = join(root, 'ocr-spec.json')
    await writeFile(ocrSpecPath, JSON.stringify(ocrSpec))

    await assert.rejects(async () => {
      await buildRuntimeRelease({
        inputDir: inputsDir,
        outputDir: join(root, 'release-hook-reject'),
        runtimeVersion: 'runtime-v5',
        platform: 'win32',
        arch: 'x64',
        inputSpecPath: ocrSpecPath,
        probeFfmpegOcrMask: async (execPath) => {
          const { createHash } = await import('node:crypto')
          const { readFile } = await import('node:fs/promises')
          const hash = createHash('sha256').update(await readFile(execPath)).digest('hex')
          return {
            healthy: true,
            features: ['ocr-mask-v1'],
            cases: sampleCases,
            ffmpegExecutableSha256: hash
          }
        }
      })
    }, /invalid metadata in ffmpegOcrMask proof|verification/i)

    // Branch 3: requests feature + hook returns failed/unhealthy -> pack rejects
    await assert.rejects(async () => {
      await buildRuntimeRelease({
        inputDir: inputsDir,
        outputDir: join(root, 'release-failed-case'),
        runtimeVersion: 'runtime-v5',
        platform: 'win32',
        arch: 'x64',
        inputSpecPath: ocrSpecPath,
        probeFfmpegOcrMask: async () => ({
          healthy: false,
          features: [],
          message: 'ffmpeg failed'
        })
      })
    }, /FFmpeg OCR mask probe failed/i)

    // Branch 4: requests feature + hook returns hash mismatch -> pack rejects
    await assert.rejects(async () => {
      await buildRuntimeRelease({
        inputDir: inputsDir,
        outputDir: join(root, 'release-hash-mismatch'),
        runtimeVersion: 'runtime-v5',
        platform: 'win32',
        arch: 'x64',
        inputSpecPath: ocrSpecPath,
        probeFfmpegOcrMask: async () => ({
          healthy: true,
          features: ['ocr-mask-v1'],
          cases: sampleCases,
          ffmpegExecutableSha256: '0000000000000000000000000000000000000000000000000000000000000000'
        })
      })
    }, /does not match expected/i)

    // Branch 5: tamper test on verified release
    // Manually create a release directory with invalid proof and verify verification rejects
    const testDir = join(root, 'release-no-ocr')
    const manifestPath = join(testDir, 'runtime-manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    // Tampers: add stray proof when ocr-mask-v1 is absent
    manifest.provenance.nativeCapabilityProofs = {
      ffmpegOcrMask: {
        schemaVersion: 1,
        capability: 'ocr-mask-v1',
        native: true,
        passed: true,
        runtimeVersion: 'runtime-v5',
        platform: 'win32',
        arch: 'x64',
        asset: manifest.assets['ffmpeg'].asset,
        entrypoint: 'ffmpeg.exe',
        ffmpegExecutableSha256: 'somehash',
        executedAt: new Date().toISOString(),
        cases: sampleCases
      }
    }
    await writeFile(manifestPath, JSON.stringify(manifest))
    const verif = await verifyRuntimeReleaseDirectory(testDir)
    assert.equal(verif.ok, false)
    assert.match(verif.error, /stray ffmpegOcrMask proof|does not match/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('native FFmpeg OCR-mask probe reports the four proof cases to the packer', async (t) => {
  const ffmpegPath = process.env.APPDATA
    ? join(process.env.APPDATA, 'tedia-pros', 'bin', 'ffmpeg', 'ffmpeg.exe')
    : ''
  if (!ffmpegPath || !(await access(ffmpegPath).then(() => true).catch(() => false))) {
    t.skip('managed FFmpeg is not installed on this machine')
    return
  }

  const { runNativeFfmpegOcrMaskProbe } = await import('../scripts/pack-runtime-release.mjs')
  const result = await runNativeFfmpegOcrMaskProbe(ffmpegPath)
  assert.equal(result.healthy, true)
  assert.deepEqual(result.cases, [
    { id: 'appear-disappear', passed: true },
    { id: 'terminal-black-frame', passed: true },
    { id: 'moving-resize', passed: true },
    { id: 'moving-resize-with-narration', passed: true }
  ])
})
