import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSemanticEvidence } from '../src/main/translation/semanticEvidence'
import { decideQuality } from '../src/main/translation/qualityDecision'

test('verified semantic evidence rejects a changed object despite fluency benefits', () => {
  const finding = normalizeSemanticEvidence({
    origin: 'deterministic', evidence: 'verified', code: 'object-changed',
    sourceCueIds: ['cue-7'], sourceSpans: ['source: the safety valve']
  })

  assert.equal(decideQuality([finding]), 'reject')
})

test('suspect semantic evidence requires review', () => {
  const finding = normalizeSemanticEvidence({
    origin: 'deterministic', evidence: 'suspect', code: 'possible-negation-loss',
    sourceCueIds: ['cue-3'], sourceSpans: ['source: do not']
  })

  assert.equal(decideQuality([finding]), 'review')
})

test('style suspicion and advisory semantic evidence remain eligible', () => {
  const advisory = normalizeSemanticEvidence({
    origin: 'deterministic', evidence: 'advisory', code: 'paraphrase-note',
    sourceCueIds: ['cue-1'], sourceSpans: []
  })

  assert.equal(decideQuality([
    advisory,
    { kind: 'style', evidence: 'suspect', code: 'less-fluent', sourceCueIds: ['cue-1'], sourceSpans: [] }
  ]), 'eligible')
})

test('provider evidence is capped at suspect while deterministic evidence stays verified', () => {
  const provider = normalizeSemanticEvidence({
    origin: 'provider', evidence: 'verified', code: 'provider-object-change',
    sourceCueIds: ['cue-2', '', 'cue-2', 'cue-4'],
    sourceSpans: ['source: valve', '', 'source: valve']
  })
  const deterministic = normalizeSemanticEvidence({
    origin: 'deterministic', evidence: 'verified', code: 'deterministic-object-change',
    sourceCueIds: ['cue-5'], sourceSpans: ['source: pump']
  })

  assert.deepEqual(provider, {
    kind: 'semantic', evidence: 'suspect', code: 'provider-object-change',
    sourceCueIds: ['cue-2', 'cue-4'], sourceSpans: ['source: valve']
  })
  assert.equal(deterministic.evidence, 'verified')
})

test('structural evidence rejects regardless of its evidence label', () => {
  for (const evidence of ['verified', 'suspect', 'advisory'] as const) {
    assert.equal(decideQuality([{
      kind: 'structural', evidence, code: 'missing-cue',
      sourceCueIds: ['cue-9'], sourceSpans: []
    }]), 'reject', evidence)
  }
})

test('structural and verified semantic findings override suspect semantic review', () => {
  const suspect = normalizeSemanticEvidence({
    origin: 'provider', evidence: 'verified', code: 'provider-suspect',
    sourceCueIds: ['cue-10'], sourceSpans: ['source: object']
  })

  assert.equal(decideQuality([suspect, {
    kind: 'structural', evidence: 'advisory', code: 'duplicate-cue',
    sourceCueIds: ['cue-10'], sourceSpans: []
  }]), 'reject')
  assert.equal(decideQuality([suspect, normalizeSemanticEvidence({
    origin: 'deterministic', evidence: 'verified', code: 'verified-object-change',
    sourceCueIds: ['cue-11'], sourceSpans: ['source: object']
  })]), 'reject')
})
