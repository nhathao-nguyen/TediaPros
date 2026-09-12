import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAutoShortCutFilter } from '../src/main/autoShortCutMedia'
import { compileAutoShortCutPlan } from '../src/shared/autoShortTemporalEdit'

test('cut filter trims video and audio with reset timestamps before concat', () => {
  const plan = compileAutoShortCutPlan({ schemaVersion: 1, revision: 1, mode: 'ripple-delete', removedRanges: [
    { id: 'middle', startUs: 2_000_000, endUs: 4_000_000 }
  ] }, 6_000_000)
  const graph = buildAutoShortCutFilter(plan, true)
  assert.match(graph, /trim=start=0\.000000:end=2\.000000,setpts=PTS-STARTPTS/)
  assert.match(graph, /atrim=start=4\.000000:end=6\.000000,asetpts=PTS-STARTPTS/)
  assert.match(graph, /concat=n=2:v=1:a=0\[vout\]/)
  assert.match(graph, /concat=n=2:v=0:a=1\[aout\]/)
})

test('cut filter omits audio graph for silent source', () => {
  const plan = compileAutoShortCutPlan({ schemaVersion: 1, revision: 1, mode: 'ripple-delete', removedRanges: [
    { id: 'head', startUs: 0, endUs: 1_000_000 }
  ] }, 3_000_000)
  const graph = buildAutoShortCutFilter(plan, false)
  assert.doesNotMatch(graph, /atrim|aout/)
})
