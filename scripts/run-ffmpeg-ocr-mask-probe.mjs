import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { createRequire } from 'node:module'

const args = process.argv.slice(2)
let ffmpegPath = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ffmpeg' && i + 1 < args.length) {
    ffmpegPath = args[i + 1]
    break
  }
}

if (!ffmpegPath) {
  console.error('Usage: node scripts/run-ffmpeg-ocr-mask-probe.mjs --ffmpeg <absolute-path-to-ffmpeg>')
  process.exit(1)
}

if (!isAbsolute(ffmpegPath)) {
  console.error('Error: --ffmpeg must be an absolute path')
  process.exit(1)
}

const tempDir = await mkdtemp(join(tmpdir(), 'tedia-ocr-mask-probe-cli-'))
const bundlePath = join(tempDir, 'probe-bundle.cjs')

const electronMockPlugin = {
  name: 'electron-mock',
  setup(buildInstance) {
    buildInstance.onResolve({ filter: /^electron$/ }, (args) => ({
      path: args.path,
      namespace: 'electron-mock-ns'
    }))
    buildInstance.onLoad({ filter: /.*/, namespace: 'electron-mock-ns' }, () => ({
      contents: `
        const os = require('node:os');
        module.exports = {
          app: {
            getPath: () => process.env.TEDIAPROS_TEST_USER_DATA || os.tmpdir(),
            isPackaged: false,
            getName: () => 'tedia-pros',
            getVersion: () => '0.1.22'
          },
          safeStorage: {
            isEncryptionAvailable: () => false,
            encryptString: (s) => Buffer.from(s),
            decryptString: (b) => b.toString()
          },
          dialog: {
            showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
            showSaveDialog: async () => ({ canceled: true })
          },
          BrowserWindow: class {},
          ipcMain: { handle: () => {}, on: () => {} },
          shell: { openExternal: async () => {} },
          protocol: { handle: () => {} }
        };
      `,
      loader: 'js'
    }))
  }
}

try {
  await build({
    entryPoints: ['src/main/ffmpegOcrMaskProbe.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: bundlePath,
    sourcemap: false,
    plugins: [electronMockPlugin]
  })

  const require = createRequire(import.meta.url)
  const { probeFfmpegOcrMaskCapability } = require(bundlePath)

  const result = await probeFfmpegOcrMaskCapability(ffmpegPath)
  console.log(JSON.stringify(result, null, 2))

  if (result.healthy && Array.isArray(result.features) && result.features.includes('ocr-mask-v1')) {
    process.exit(0)
  } else {
    process.exit(1)
  }
} catch (err) {
  console.error(JSON.stringify({
    healthy: false,
    features: [],
    probeSchemaVersion: 1,
    message: err?.message || String(err)
  }))
  process.exit(1)
} finally {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {})
}
