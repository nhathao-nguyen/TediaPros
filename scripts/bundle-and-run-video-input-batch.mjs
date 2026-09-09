import { build } from 'esbuild'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(process.cwd())
const staging = join(root, '.runner-staging')
const entry = join(root, 'scripts', 'run-video-input-batch.ts')
const bundle = join(staging, 'video-input-batch.cjs')
if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: bundle,
  sourcemap: false,
  external: ['electron']
})

const electronBinary = process.platform === 'win32'
  ? join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : join(root, 'node_modules', 'electron', 'dist', 'electron')
if (!existsSync(electronBinary)) throw new Error(`Không tìm thấy Electron runtime: ${electronBinary}`)

const childEnv = { ...process.env }
delete childEnv.ELECTRON_RUN_AS_NODE
const child = spawn(electronBinary, [bundle, ...process.argv.slice(2)], {
  cwd: root,
  env: childEnv,
  stdio: 'inherit',
  windowsHide: false
})
child.on('error', (error) => {
  console.error(`[runner] ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[runner] Electron exited by ${signal}`)
    process.exitCode = 1
  } else {
    process.exitCode = code ?? 1
  }
})
