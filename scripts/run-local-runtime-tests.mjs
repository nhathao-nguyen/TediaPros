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
            getPath: () => os.tmpdir(),
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

await build({
  entryPoints: [
    'tests/local-runtime.test.ts',
    'tests/canonical-runtime-migration.test.ts',
    'tests/autoshort-comprehensive-windows.test.ts',
    'tests/e2e-autoshort.test.ts',
    'tests/release-tooling.test.ts',
    'tests/dubbing-plan.test.ts'
  ],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outdir: outDir,
  sourcemap: false,
  plugins: [electronMockPlugin]
})

const result1 = spawnSync(process.execPath, ['--test', join(outDir, 'local-runtime.test.js')], { stdio: 'inherit' })
const result2 = spawnSync(process.execPath, ['--test', join(outDir, 'canonical-runtime-migration.test.js')], { stdio: 'inherit' })
const result3 = spawnSync(process.execPath, ['--test', join(outDir, 'autoshort-comprehensive-windows.test.js')], { stdio: 'inherit' })
const result4 = spawnSync(process.execPath, ['--test', join(outDir, 'e2e-autoshort.test.js')], { stdio: 'inherit' })
const result5 = spawnSync(process.execPath, ['--test', join(outDir, 'release-tooling.test.js')], { stdio: 'inherit' })
const result6 = spawnSync(process.execPath, ['--test', join(outDir, 'dubbing-plan.test.js')], { stdio: 'inherit' })

if (result1.status !== 0 || result2.status !== 0 || result3.status !== 0 || result4.status !== 0 || result5.status !== 0 || result6.status !== 0) {
  process.exit(1)
}
