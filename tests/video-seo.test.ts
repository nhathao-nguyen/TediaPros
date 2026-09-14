import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  countYouTubeTagCharacters,
  formatVideoSeoCaption,
  formatVideoSeoMetadata,
  normalizeVideoSeoMetadata,
  parseVideoSeoMetadata,
  parseVideoSeoPreset,
  resolveVideoSeoConfig,
  serializeVideoSeoPreset,
  validateVideoSeoOptions
} from '../src/shared/videoSeo'
import { validateShortVideoSeoMetadata } from '../src/shared/videoSeoPolicy'
import shortVideoSeoEval from './fixtures/video-seo-short-eval.json'

test('short-form prompt evaluation fixture keeps twelve distinct executable review cases', () => {
  assert.equal(shortVideoSeoEval.version, 1)
  assert.equal(shortVideoSeoEval.cases.length, 12)
  assert.equal(new Set(shortVideoSeoEval.cases.map((entry) => entry.id)).size, 12)

  for (const entry of shortVideoSeoEval.cases) {
    assert.ok(entry.id.trim())
    assert.ok(entry.source.trim())
    assert.ok(entry.config.language)
    assert.ok(entry.editorialChecks.length > 0)
    assert.ok(entry.forbiddenClaims.length > 0)
  }

  const ids = new Set(shortVideoSeoEval.cases.map((entry) => entry.id))
  assert.ok(ids.has('source-prompt-injection'))
  assert.ok(ids.has('hostile-brand-voice'))
  assert.ok(ids.has('numbers-and-units'))
  assert.ok(ids.has('story-twist'))
  assert.ok(ids.has('safety-warning'))
  assert.ok(ids.has('japanese-native-style'))
  assert.ok(ids.has('insufficient-source'))
})

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
  const metadata = normalizeVideoSeoMetadata({
    title: 'Des outils faits maison',
    description: 'Une vidéo sur des outils fabriqués avec de l’acier.',
    tags: ['outils faits maison', 'travail des métaux']
  })
  assert.ok(metadata)
  const expected = ['#outilsfaitsmaison', '#travaildesmétaux']
  assert.deepEqual(metadata.hashtags, expected)
  assert.equal(formatVideoSeoMetadata(metadata).split('Hashtags:\n')[1], `${expected.join(' ')}\n`)
})

test('new metadata preserves an intentionally empty hashtag list', () => {
  const raw = {
    title: 'Nước biển và cây',
    description: 'Muối trong nước biển cản trở khả năng hút nước của cây.',
    tags: ['nước biển'],
    hashtags: [] as string[]
  }
  assert.deepEqual(parseVideoSeoMetadata(JSON.stringify(raw)).hashtags, [])
  assert.ok(formatVideoSeoMetadata(raw).endsWith('Hashtags:\n\n'))
  assert.deepEqual(normalizeVideoSeoMetadata({
    title: raw.title,
    description: raw.description,
    tags: raw.tags
  })?.hashtags, ['#nướcbiển'])
})

test('short-form caption combines description and hashtags without file labels or title', () => {
  const metadata = {
    title: 'Vì sao cây không hút nước biển?',
    description: 'Muối trong nước biển cản trở khả năng hút nước của cây.',
    tags: ['cây và nước biển'],
    hashtags: ['#CayVaNuocBien', '#KhoaHoc']
  }
  assert.equal(formatVideoSeoCaption(metadata),
    'Muối trong nước biển cản trở khả năng hút nước của cây.\n\n#CayVaNuocBien #KhoaHoc')
  assert.equal(formatVideoSeoCaption({ ...metadata, hashtags: [] }), metadata.description)
})

test('short metadata policy enforces per-length captions and bounded discovery fields', () => {
  const options = resolveVideoSeoConfig({ provider: 'local', language: 'vi' }).seo
  const base = { title: 'Một tiêu đề rõ ràng', description: 'a', tags: [] as string[], hashtags: [] as string[] }
  assert.doesNotThrow(() => validateShortVideoSeoMetadata({ ...base, description: 'a'.repeat(300) }, options))
  assert.throws(() => validateShortVideoSeoMetadata({ ...base, description: 'a'.repeat(301) }, options), /300/u)
  assert.doesNotThrow(() => validateShortVideoSeoMetadata({ ...base, tags: Array.from({ length: 8 }, (_, index) => `tag ${index}`) }, options))
  assert.throws(() => validateShortVideoSeoMetadata({ ...base, tags: Array.from({ length: 9 }, (_, index) => `tag ${index}`) }, options), /8/u)
  assert.doesNotThrow(() => validateShortVideoSeoMetadata({ ...base, hashtags: ['#mot', '#hai', '#ba'] }, options))
  assert.throws(() => validateShortVideoSeoMetadata({ ...base, hashtags: ['#mot', '#hai', '#ba', '#bon'] }, options), /3/u)

  const medium = { ...options, descriptionLength: 'medium' as const }
  const long = { ...options, descriptionLength: 'long' as const }
  assert.doesNotThrow(() => validateShortVideoSeoMetadata({ ...base, description: '🙂'.repeat(500) }, medium))
  assert.throws(() => validateShortVideoSeoMetadata({ ...base, description: '🙂'.repeat(501) }, medium), /500/u)
  assert.doesNotThrow(() => validateShortVideoSeoMetadata({ ...base, description: 'a'.repeat(800) }, long))
  assert.throws(() => validateShortVideoSeoMetadata({ ...base, description: 'a'.repeat(801) }, long), /800/u)
})

test('short metadata policy keeps hashtags out of title and caption', () => {
  const options = resolveVideoSeoConfig({ provider: 'local', language: 'vi' }).seo
  const base = { title: 'Một tiêu đề rõ ràng', description: 'Một caption rõ ràng.', tags: [] as string[], hashtags: [] as string[] }
  assert.throws(() => validateShortVideoSeoMetadata({ ...base, title: 'Mẹo trồng cây #vuon' }, options), /hashtag/u)
  assert.throws(() => validateShortVideoSeoMetadata({ ...base, description: 'Cách trồng cây #vuon.' }, options), /hashtag/u)
  assert.doesNotThrow(() => validateShortVideoSeoMetadata({ ...base, description: 'Ký hiệu # đứng riêng.' }, options))
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
  assert.throws(() => parseVideoSeoMetadata(JSON.stringify({ ...valid, ignored: true })))
  assert.throws(() => parseVideoSeoMetadata('{"title":"x","title":"y","description":"Một đoạn.","tags":[],"hashtags":[]}'))
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
