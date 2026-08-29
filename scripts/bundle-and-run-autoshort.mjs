import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const outFile = join(process.cwd(), 'out', 'run-autoshort-pipeline.cjs')

await build({
  entryPoints: ['scripts/run-autoshort-pipeline.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: outFile,
  sourcemap: false,
  external: ['electron']
})

console.log('Build completed, starting Electron process...')
const electronExe = join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electronExe, [outFile], { stdio: 'inherit' })

child.on('close', (code) => {
  console.log(`Electron process exited with code ${code}`)
  process.exit(code ?? 0)
})
