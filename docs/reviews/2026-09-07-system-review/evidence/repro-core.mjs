// Bounded review probes: current production modules, synthetic inputs only.
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, symlink, unlink, realpath } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'

const root = process.cwd()
async function moduleAt(path) {
  const result = await build({ entryPoints: [resolve(root, path)], bundle: true,
    platform: 'node', format: 'esm', write: false })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const evidence = resolve(root, 'docs/reviews/2026-09-07-system-review/evidence')
const fixtures = await mkdtemp(join(evidence, 'containment-fixture-'))
const allowed = join(fixtures, 'allowed')
const outside = join(fixtures, 'outside')
await mkdir(allowed)
await mkdir(outside)
const junction = join(allowed, 'redirect')
const { assertContainedParentDirectory } = await moduleAt('src/main/safeContainedPath.ts')
try {
  await symlink(outside, junction, 'junction')
  let accepted = false
  try { await assertContainedParentDirectory(join(junction, 'output.bin'), allowed, 'review'); accepted = true } catch {}
  const realParent = await realpath(junction)
  assert.equal(accepted, true, 'Finding no longer reproduces: review containment implementation')
  assert.ok(relative(allowed, realParent).startsWith('..'))
  console.log(JSON.stringify({ finding: 'parent-containment', accepted, parentOutsideAllowedRoot: true }))
} finally {
  // Unlink only the junction created above; never traverse/delete its target.
  await unlink(junction).catch(() => {})
}

const { AutoShortDiskBudgetLedger } = await moduleAt('src/main/autoShortDiskBudget.ts')
let finishFree
const ledger = new AutoShortDiskBudgetLedger({ safetyHeadroomBytes: 0,
  getFreeBytes: () => new Promise(resolve => { finishFree = resolve }) })
const firstAbort = new AbortController()
const secondAbort = new AbortController()
const first = ledger.reserve('F:', 100, firstAbort.signal).then(() => 'resolved', e => e.code)
let secondState = 'pending'
const second = ledger.reserve('F:', 100, secondAbort.signal).then(r => { secondState = 'resolved'; r.release() }, () => { secondState = 'rejected' })
firstAbort.abort()
finishFree(1000)
await tick(); await tick()
assert.equal(await first, 'ABORT_ERR')
assert.equal(ledger.getReservedBytes('F:'), 100)
assert.equal(secondState, 'pending')
console.log(JSON.stringify({ finding: 'disk-abort-race', first: 'ABORT_ERR', orphanReservedBytes: ledger.getReservedBytes('F:'), secondState }))
secondAbort.abort(); await second

const { AutoShortResourceManager } = await moduleAt('src/main/autoShortResourceManager.ts')
const manager = new AutoShortResourceManager({ 'local-gpu-heavy': 1 })
const cancelA = new AbortController()
let finishA, active = 0, peak = 0
const a = manager.withLease(['local-gpu-heavy'], cancelA.signal, async () => {
  active++; peak = Math.max(peak, active)
  await new Promise(resolve => { finishA = resolve })
  active--
})
await tick()
const b = manager.withLease(['local-gpu-heavy'], undefined, async () => {
  active++; peak = Math.max(peak, active); active--
})
cancelA.abort()
await tick()
finishA(); await Promise.all([a, b])
assert.equal(peak, 2)
console.log(JSON.stringify({ finding: 'resource-abort-overlap', configuredGpuCapacity: 1, peakConcurrentActions: peak }))
