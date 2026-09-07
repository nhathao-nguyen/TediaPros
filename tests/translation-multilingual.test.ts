import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DICH_LANGS, type SubtitleCue } from '../src/shared/types'
import { assessContentQuality } from '../src/main/autoShortContentQuality'
import { assessTranslationLanguage } from '../src/main/translation/language'
import { parseTranslationResponse } from '../src/main/translation/response'
import { buildTranslationMessages } from '../src/main/translation/prompts'
import type { TranslationInput } from '../src/shared/translation'

interface FixtureCase {
  id: string
  sourceLocale: string
  targetLocale: string
  source: string
  reference: string
  expected: 'valid' | 'warning' | 'needs-review'
  tags: string[]
}

const fixturePath = join(process.cwd(), 'tests', 'fixtures', 'translation-multilingual', 'cases.json')

function cue(id: string, text: string): SubtitleCue {
  return { id, start: 0, end: 2, text, sourceIndex: 0 }
}

function translationInput(entry: FixtureCase): TranslationInput {
  return {
    sourceLanguage: entry.sourceLocale,
    targetLocale: entry.targetLocale,
    mode: 'subtitle',
    cues: [{ id: 'c1', sourceIndex: 0, start: 0, end: 2, groupId: 'g1', text: entry.source }],
    contextBefore: [],
    contextAfter: [],
    glossary: []
  }
}

test('multilingual fixture has explicit review labels and no missing fields', async () => {
  const cases = JSON.parse(await readFile(fixturePath, 'utf8')) as FixtureCase[]
  assert.equal(cases.length, 4)
  for (const entry of cases) {
    assert.match(entry.sourceLocale, /^[A-Za-z-]+$/u)
    assert.match(entry.targetLocale, /^[A-Za-z-]+$/u)
    assert.ok(entry.source.trim())
    assert.ok(entry.reference.trim())
    assert.ok(entry.tags.length > 0)
  }
})

test('cross-script and numeric fixtures never become structural failures', async () => {
  const cases = JSON.parse(await readFile(fixturePath, 'utf8')) as FixtureCase[]
  for (const entry of cases.filter((item) => item.expected !== 'needs-review')) {
    const input = translationInput(entry)
    const content = assessContentQuality([cue('c1', entry.source)], [cue('c1', entry.reference)])
    assert.ok(content.issues.every((issue) => issue.severity === 'warning'), entry.id)
    const language = assessTranslationLanguage(input, [{ id: 'c1', text: entry.reference }])
    assert.notEqual(language.languageEvidence, 'matched', entry.id)
  }
})

test('malformed continuation is retained as an explicit parser review issue', () => {
  const result = parseTranslationResponse('[c1] First part\nsecond part', 'id-lines', ['c1'], false)
  assert.equal(result.complete, false)
  assert.ok(result.issues.some((issue) => issue.code === 'unparsed-content'))
  assert.deepEqual(result.items, [{ id: 'c1', text: 'First part' }])
})

test('prompt contract resolves every configured UI locale without auto target', () => {
  for (const language of DICH_LANGS) {
    const input: TranslationInput = {
      sourceLanguage: 'vi',
      targetLocale: language.code,
      mode: 'subtitle',
      cues: [{ id: 'c1', sourceIndex: 0, start: 0, end: 1, groupId: 'g1', text: 'Một câu kiểm thử.' }],
      contextBefore: [],
      contextAfter: [],
      glossary: []
    }
    const system = buildTranslationMessages(input, 'json-items')[0].content
    assert.match(system, new RegExp(`target_locale=${language.code}`, 'u'))
    assert.doesNotMatch(system, /target_language=auto/iu)
  }
})
