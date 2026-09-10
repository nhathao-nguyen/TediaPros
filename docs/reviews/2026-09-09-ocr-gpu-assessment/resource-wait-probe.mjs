// Diagnostic only: exercise the real scheduler without starting media/providers.
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundled = await build({
  entryPoints: ['src/main/autoShortResourceManager.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false
})
const { AutoShortResourceManager } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
)
const manager = new AutoShortResourceManager()
const ocr = await manager.acquire(['local-cpu-heavy', 'local-gpu-heavy'])
let separation
let server
const waitingSeparation = manager.acquire(['local-gpu-heavy', 'local-cpu-heavy'])
  .then((lease) => { separation = lease })
const waitingServer = manager.acquire(['server-inference'])
  .then((lease) => { server = lease })

await new Promise(setImmediate)
assert.equal(manager.getAllocated('server-inference'), 0)
assert.equal(server, undefined)
assert.equal(separation, undefined)
console.log(JSON.stringify({
  phase: 'OCR holds CPU+GPU resources',
  eventLoopResponsive: true,
  separationWaiting: !separation,
  serverWaiting: !server,
  serverSlotAllocated: manager.getAllocated('server-inference')
}))

ocr.release()
await Promise.all([waitingSeparation, waitingServer])
assert.ok(separation && server)
console.log(JSON.stringify({
  phase: 'OCR released resources',
  separationAcquired: !!separation,
  serverAcquired: !!server
}))
separation.release()
server.release()
for (const resource of ['local-cpu-heavy', 'local-gpu-heavy', 'server-inference']) {
  assert.equal(manager.getAllocated(resource), 0)
}
