import { build } from 'esbuild'
import { mkdtemp, cp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const realUserData = 'C:/Users/PC/AppData/Roaming/tedia-pros'
const temp = await mkdtemp(join(tmpdir(), 'tedia-rephrase-live-'))
const evidence = resolve(process.env.TEDIA_LIVE_EVIDENCE || '.ai/tasks/2026-09-08-rephrase-live-evidence4')
try {
  await mkdir(evidence, { recursive: true })
  await cp(join(realUserData, 'Local Storage'), join(temp, 'Local Storage'), { recursive: true })
  await cp(join(realUserData, 'lk.bin'), join(temp, 'lk.bin'))
  await cp(join(realUserData, 'Local State'), join(temp, 'Local State'))
  const entry = join(temp, 'live.cjs')
  await build({ entryPoints: [resolve(process.env.TEDIA_LIVE_ENTRY || '.ai/tasks/2026-09-08-rephrase-live.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['electron'], outfile: entry, define: { __TBLAO_BUILD_COMMIT__: '"live-regression"' } })
  const env = { ...process.env, NODE_PATH: resolve('node_modules') }
  delete env.ELECTRON_RUN_AS_NODE
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [entry, temp, evidence, realUserData], { env, stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
} finally {
  if (!resolve(temp).startsWith(resolve(tmpdir()) + sep + 'tedia-rephrase-live-')) throw new Error('Unexpected temporary directory; no cleanup')
  await rm(temp, { recursive: true, force: true, maxRetries: 4 })
}
