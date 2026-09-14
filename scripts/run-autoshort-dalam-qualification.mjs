import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = mkdtempSync(join(tmpdir(), 'tedia-dalam-live-'))
const outfile = join(root, 'worker.cjs')

try {
  await build({
    entryPoints: ['scripts/autoshort-dalam-qualification-worker.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron']
  })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(electronPath, [outfile, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    windowsHide: true
  })
  process.exitCode = result.status ?? 1
} finally {
  rmSync(root, { recursive: true, force: true })
}
