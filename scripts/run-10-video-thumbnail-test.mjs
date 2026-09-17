import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const outDir = mkdtempSync(join(tmpdir(), 'tedia-10-video-test-'))
const outFile = join(outDir, 'test-10-thumbnails-real.cjs')

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
        const path = require('node:path');
        module.exports = {
          app: {
            getPath: (name) => {
              if (name === 'userData') {
                return process.env.APPDATA ? path.join(process.env.APPDATA, 'tedia-pros') : os.tmpdir();
              }
              return os.tmpdir();
            },
            getAppPath: () => process.cwd(),
            isPackaged: false,
            getName: () => 'tedia-pros',
            getVersion: () => '0.1.26'
          },
          ipcMain: { handle: () => {}, on: () => {} },
          dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
          protocol: { handle: () => {} }
        };
      `,
      loader: 'js'
    }))
  }
}

async function main() {
  try {
    console.log('Đang biên dịch test script...')
    await build({
      entryPoints: ['scripts/test-10-thumbnails-real.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      outfile: outFile,
      plugins: [electronMockPlugin]
    })

    console.log('Khởi chạy kiểm thử trên 10 video...\n')
    const child = spawn(process.execPath, [outFile], {
      stdio: 'inherit',
      env: { ...process.env }
    })

    child.on('close', (code) => {
      try {
        rmSync(outDir, { recursive: true, force: true })
      } catch {}
      process.exit(code ?? 0)
    })
  } catch (err) {
    console.error('Lỗi khi biên dịch/chạy test:', err)
    try {
      rmSync(outDir, { recursive: true, force: true })
    } catch {}
    process.exit(1)
  }
}

main()
