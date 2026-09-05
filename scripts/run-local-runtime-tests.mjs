import { build } from 'esbuild'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const outDir = join(tmpdir(), 'tedia-local-runtime-tests')
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'local-runtime.test.cjs')

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

const knownTests = [
  'local-runtime.test',
  'canonical-runtime-migration.test',
  'e2e-autoshort.test',
  'release-tooling.test',
  'dubbing-plan.test',
  'separator-contract.test',
  'separator-runtime.test',
  'separator-pipeline.test',
  'autoshort-ocr-contract.test',
  'canonical-display-geometry.test',
  'ocr-visual-timeline.test',
  'autoshort-ocr-runtime.test',
  'ocr-mask.test',
  'autoshort-ocr-burn.test',
  'video-title.test',
  'burn-video-title.test',
  'autoshort-video-title.test'
]

const requestedTests = process.argv.slice(2).map((name) => name.replace(/\.(ts|js)$/, ''))
const selectedTests = requestedTests.length > 0 ? requestedTests : knownTests
for (const testName of selectedTests) {
  if (!knownTests.includes(testName)) throw new Error(`Unknown local-runtime test: ${testName}`)
}

await build({
  entryPoints: selectedTests.map((testName) => `tests/${testName}.ts`),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outdir: outDir,
  sourcemap: false,
  plugins: [electronMockPlugin]
})

const results = selectedTests.map((testName) =>
  spawnSync(process.execPath, ['--test', join(outDir, `${testName}.js`)], { stdio: 'inherit' })
)
if (results.some((result) => result.status !== 0)) process.exit(1)
