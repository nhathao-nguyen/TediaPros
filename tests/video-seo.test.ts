import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  countYouTubeTagCharacters,
  formatVideoSeoMetadata,
  normalizeVideoSeoMetadata,
  parseVideoSeoMetadata,
  parseVideoSeoPreset,
  resolveVideoSeoConfig,
  serializeVideoSeoPreset,
  validateVideoSeoOptions
} from '../src/shared/videoSeo'

test('metadata becomes one title, one description paragraph, tags and hashtags', () => {
  const metadata = parseVideoSeoMetadata(JSON.stringify({
    title: 'Rễ cây hút nước như thế nào?',
    description: 'Rễ cây hút nước từ đất.\nVideo giải thích quá trình này.',
    tags: ['rễ cây', ' RỄ CÂY ', 'hút nước'],
    hashtags: ['#roots', '#freshwater']
  }))
  assert.deepEqual(metadata, {
    title: 'Rễ cây hút nước như thế nào?',
    description: 'Rễ cây hút nước từ đất. Video giải thích quá trình này.',
    tags: ['rễ cây', 'hút nước'],
    hashtags: ['#roots', '#freshwater']
  })
  assert.equal(formatVideoSeoMetadata(metadata),
    'Rễ cây hút nước như thế nào?\n\nDescription:\n' +
    'Rễ cây hút nước từ đất. Video giải thích quá trình này.\n\n' +
    'Tags:\nrễ cây, hút nước\n\n' +
    'Hashtags:\n#roots #freshwater\n')
})

test('legacy metadata without hashtags derives them from tags', () => {
  const metadata = parseVideoSeoMetadata(JSON.stringify({
    title: 'Des outils faits maison',
    description: 'Une vidéo sur des outils fabriqués avec de l’acier.',
    tags: ['outils faits maison', 'travail des métaux']
  }))
  const expected = ['#outilsfaitsmaison', '#travaildesmétaux']
  assert.deepEqual(metadata.hashtags, expected)
  assert.equal(formatVideoSeoMetadata(metadata).split('Hashtags:\n')[1], `${expected.join(' ')}\n`)
})

test('renderer boundary normalizes persisted legacy metadata without crashing', () => {
  const metadata = normalizeVideoSeoMetadata({
    title: 'Des outils faits maison',
    description: 'Une vidéo sur des outils fabriqués avec de l’acier.',
    tags: ['outils faits maison', 'travail des métaux']
  })
  assert.deepEqual(metadata?.hashtags, ['#outilsfaitsmaison', '#travaildesmétaux'])
  assert.equal(normalizeVideoSeoMetadata({ title: 'invalide' }), null)
})

test('metadata rejects malformed JSON, lists, forbidden characters and YouTube limits', () => {
  const valid = { title: 'x', description: 'Một đoạn.', tags: [] as string[], hashtags: [] as string[] }
  assert.throws(() => parseVideoSeoMetadata('plain text'))
  assert.throws(() => parseVideoSeoMetadata(JSON.stringify({ title: 'x' })))
  assert.throws(() => parseVideoSeoMetadata(JSON.stringify({ ...valid, title: 'x'.repeat(101) })))
  assert.throws(() => parseVideoSeoMetadata(JSON.stringify({ ...valid, description: '- ý một\n- ý hai' })))
  assert.throws(() => parseVideoSeoMetadata(JSON.stringify({ ...valid, description: '<b>Nội dung</b>' })))
  assert.throws(() => parseVideoSeoMetadata(JSON.stringify({ ...valid, tags: ['một, hai'] })))
  assert.throws(() => parseVideoSeoMetadata(JSON.stringify({ ...valid, hashtags: '#not-an-array' })))
  assert.throws(() => parseVideoSeoMetadata(JSON.stringify({ ...valid, tags: ['x'.repeat(501)] })))
  assert.doesNotThrow(() => parseVideoSeoMetadata(JSON.stringify({ ...valid, title: '🙂'.repeat(100) })))
  assert.doesNotThrow(() => parseVideoSeoMetadata(JSON.stringify({ ...valid, description: 'a'.repeat(5_000) })))
  assert.throws(() => parseVideoSeoMetadata(JSON.stringify({ ...valid, description: 'a'.repeat(5_001) })))
})

test('metadata extracts one valid JSON object from Gemini prose without accepting ambiguous output', () => {
  const valid = {
    title: 'Seven dangerous waters to avoid',
    description: 'The video explains why these waters are unsafe for swimming.',
    tags: ['water safety', 'dangerous currents'],
    hashtags: ['#WaterSafety']
  }
  const wrapped = [
    'Here is the requested metadata:',
    '```json',
    JSON.stringify({ ...valid, description: 'Avoid places described as {safe} when currents are strong.' }),
    '```',
    'I kept the output grounded in the supplied subtitles.'
  ].join('\n')
  assert.deepEqual(parseVideoSeoMetadata(wrapped), {
    ...valid,
    description: 'Avoid places described as {safe} when currents are strong.'
  })
  assert.throws(() => parseVideoSeoMetadata(`${JSON.stringify(valid)}\n${JSON.stringify(valid)}`), /JSON/u)
})

test('tag accounting follows YouTube comma and spaced-tag quote rules', () => {
  assert.equal(countYouTubeTagCharacters([]), 0)
  assert.equal(countYouTubeTagCharacters(['a b', 'c']), 7)
})

test('legacy config resolves SEO defaults while explicit locale wins', () => {
  const explicit = resolveVideoSeoConfig({ provider: 'local', language: 'pt-BR' }, 'en-US')
  assert.equal(explicit.language, 'pt-BR')
  assert.equal(explicit.seo.country, 'BR')
  assert.equal(explicit.seo.descriptionLength, 'short')
  assert.equal(explicit.seo.descriptionStyle, 'balanced')
  const automatic = resolveVideoSeoConfig({ provider: 'gemini', language: 'auto' }, 'en-US')
  assert.equal(automatic.language, 'en-US')
  assert.equal(automatic.seo.country, 'US')
})

test('SEO options reject invalid supplied values instead of silently defaulting', () => {
  assert.equal(validateVideoSeoOptions({ descriptionLength: 'tiny' }), 'Độ dài mô tả không hợp lệ.')
  assert.equal(validateVideoSeoOptions({ country: 'usa' }), 'Quốc gia SEO không hợp lệ.')
  assert.equal(validateVideoSeoOptions({ channelName: 123 }), 'Tên kênh không hợp lệ.')
})

test('market preset round-trips whitelisted settings and never accepts credentials', () => {
  const resolved = resolveVideoSeoConfig({
    provider: 'openai',
    language: 'en-GB',
    serverUrl: 'http://127.0.0.1:8000',
    seo: { country: 'GB', brandVoice: 'Direct and calm' }
  })
  const serialized = serializeVideoSeoPreset(resolved)
  assert.doesNotMatch(serialized, /"(?:apiKey|token|secret)"/iu)
  assert.deepEqual(parseVideoSeoPreset(serialized), resolved)
  assert.throws(() => parseVideoSeoPreset(JSON.stringify({ version: 1, apiKey: 'secret', ...resolved })))
  assert.throws(() => parseVideoSeoPreset(JSON.stringify({
    version: 1,
    provider: 'local',
    language: 'vi',
    serverUrl: 'https://user:secret@example.com',
    seo: resolved.seo
  })))
  assert.throws(() => parseVideoSeoPreset('{bad json'))
})
