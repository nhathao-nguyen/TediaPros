import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = mkdtempSync(join(tmpdir(), 'tedia-gemini-ab-'))
const outfile = join(root, 'worker.cjs')
const electronMockPlugin = {
  name: 'electron-mock',
  setup(buildInstance) {
    buildInstance.onResolve({ filter: /^electron$/ }, (args) => ({ path: args.path, namespace: 'electron-mock' }))
    buildInstance.onLoad({ filter: /.*/, namespace: 'electron-mock' }, () => ({
      contents: `
        const os = require('node:os');
        const userData = process.env.TEDIAPROS_USER_DATA || 'C:/Users/PC/AppData/Roaming/tedia-pros';
        module.exports = {
          app: {
            getPath: (name) => name === 'userData' ? userData : name === 'temp' ? os.tmpdir() : userData,
            setPath: () => {}, setName: () => {}, getAppPath: () => process.cwd(), isPackaged: false,
            isReady: () => true, whenReady: async () => {}, getName: () => 'tedia-pros', getVersion: () => '0.1.26'
          },
          safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
          dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
          BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} }, shell: { openExternal: async () => {} }, protocol: { handle: () => {} }
        };
      `,
      loader: 'js'
    }))
  }
}

try {
  await build({
    entryPoints: ['scripts/run-gemini-ab-corpus-worker.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    plugins: [electronMockPlugin]
  })
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: 'inherit',
    windowsHide: true
  })
  process.exitCode = result.status ?? 1
} finally {
  rmSync(root, { recursive: true, force: true })
}
