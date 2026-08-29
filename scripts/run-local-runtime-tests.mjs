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
            getVersion: () => '0.1.20'
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
  entryPoints: ['tests/local-runtime.test.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: outFile,
  sourcemap: false,
  plugins: [electronMockPlugin]
})

const result = spawnSync(process.execPath, ['--test', outFile], { stdio: 'inherit' })
process.exit(result.status ?? 1)
