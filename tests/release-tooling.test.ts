import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
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

test('release tooling has no developer-machine or destructive re-upload fallback', async () => {
  const { readFile } = await import('node:fs/promises')
  const packer = await readFile(join(process.cwd(), 'scripts', 'pack-runtime-release.mjs'), 'utf8')
  const publisher = await readFile(join(process.cwd(), 'scripts', 'publish-github-release.mjs'), 'utf8')
  const verifier = await readFile(join(process.cwd(), 'scripts', 'verify-runtime-release.mjs'), 'utf8')
  assert.doesNotMatch(packer, /where\.exe|findInPath|process\.env\.PATH/u)
  assert.doesNotMatch(publisher, /method:\s*['"]DELETE['"]/u)
  assert.doesNotMatch(verifier, /containsEntrypoint\s*=\s*true/u)
  assert.match(publisher, /runtime-v2/u)
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
    assert.equal(Object.keys(result.manifest.assets).length, 6)
    assert.equal((await readFile(join(root, 'release', 'runtime-provenance.json'), 'utf8')).includes('runtime-v2'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
