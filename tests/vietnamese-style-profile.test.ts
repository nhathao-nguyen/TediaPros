import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VI_NARRATIVE_NEUTRAL_PROFILE_VERSION,
  selectViExamples,
  vietnameseNarrativeInstruction
} from '../src/main/translation/viStyleProfile'

test('Vietnamese style profile only selects approved development examples and keeps a bounded domain preference', () => {
  const base = { source: 'source', target: 'đích', approved: true }
  const selected = selectViExamples([
    { ...base, id: 'held-out', domain: 'kitchen', split: 'held-out' },
    { ...base, id: 'other', domain: 'general', split: 'development' },
    { ...base, id: 'domain-b', domain: 'kitchen', split: 'development' },
    { ...base, id: 'domain-a', domain: 'kitchen', split: 'development' },
    { ...base, id: 'unapproved', domain: 'kitchen', split: 'development', approved: false }
  ], 'kitchen')
  assert.deepEqual(selected.map((example) => example.id), ['domain-a', 'domain-b', 'other'])
})

test('Vietnamese style instruction is versioned and asks for concise natural phrasing without allowing omissions', () => {
  const instruction = vietnameseNarrativeInstruction()
  assert.match(instruction, new RegExp(`style_profile=${VI_NARRATIVE_NEUTRAL_PROFILE_VERSION}`, 'u'))
  assert.match(instruction, /concise/u)
  assert.match(instruction, /never omit/u)
})
