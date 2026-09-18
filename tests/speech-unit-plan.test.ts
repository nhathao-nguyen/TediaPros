import assert from 'node:assert/strict'
import test from 'node:test'
import { validateSourcePartition } from '../src/shared/speechUnitPlan'

test('a frozen speech plan preserves source order, coverage and source hard boundaries', () => {
  assert.deepEqual(validateSourcePartition(['a', 'b', 'c'], [['a', 'b'], ['c']], ['b']), [])
  assert.ok(validateSourcePartition(['a', 'b'], [['b', 'a']], []).includes('coverage-or-order'))
  assert.ok(validateSourcePartition(['a', 'b'], [['a', 'a']], []).includes('coverage-or-order'))
  assert.ok(validateSourcePartition(['a', 'b'], [['a', 'b']], ['a']).includes('crossed-hard-boundary'))
})
