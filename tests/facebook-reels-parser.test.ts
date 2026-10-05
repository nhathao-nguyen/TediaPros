import assert from 'node:assert/strict'
import { test } from 'node:test'
import { facebookReelsSource, facebookReelEntry, mergeFacebookReel } from '../src/shared/facebookReels'
import { parseFacebookReelsPayload } from '../src/main/facebookReelsParser'

const source = facebookReelsSource('https://www.facebook.com/profile.php?id=123456789')!
// Minimized from ProfileCometAppCollectionReelsRendererPaginationQuery observed 2026-10-02.
// Removed tracking, delivery URLs and cursor contents; IDs and captions are synthetic.
function payload(owner = '123456789', hasNext = true) {
  return { data: { node: { id: 'collection:target', aggregated_fb_shorts: {
    edges: [{ profile_reel_node: { id: 'wrapper', node: { id: 'story:one',
      video: { id: '111111', owner: { id: owner } }, message: { text: 'Caption chính xác\nDòng đầy đủ thứ hai' },
      attachments: [{ media: { id: '111111', owner: { id: owner, name: 'Creator' } } }]
    } } }], page_info: { has_next_page: hasNext, end_cursor: 'opaque:test' }
  } } } }
}

test('extracts observed profile collection schema using video ID, not the story/wrapper ID', () => {
  const p = parseFacebookReelsPayload(JSON.stringify(payload()), { source })
  assert.deepEqual(p.entries.map(e => e.id), ['111111'])
  assert.equal(p.entries[0].facebook?.caption, 'Caption chính xác\nDòng đầy đủ thứ hai')
  assert.equal(p.entries[0].title, 'Caption chính xác')
  assert.deepEqual(p.collectionIds, ['collection:target'])
  assert.equal(p.connections[0].hasNextPage, true)
})

test('does not accept a longer caption from a recommended Reel with a different ID', () => {
  const raw = { data: { video: { id: '111111', creation_story: { message: { text: 'Target' } } },
    recommendations: [{ id: '222222', creation_story: { message: { text: 'Longer recommended caption that is wrong' } } }] } }
  const p = parseFacebookReelsPayload(JSON.stringify(raw), { source, knownIds: new Set(['111111']) })
  assert.deepEqual(p.entries.map(e => [e.id, e.title]), [['111111', 'Target']])
})

test('unknown or foreign collection cannot claim end-of-list', () => {
  const wrong = parseFacebookReelsPayload(JSON.stringify(payload('987654321', false)), { source })
  assert.equal(wrong.entries.length, 0)
  assert.equal(wrong.connections.length, 0)
  const empty = payload(); empty.data.node.aggregated_fb_shorts.edges = []
  empty.data.node.aggregated_fb_shorts.page_info.has_next_page = false
  assert.equal(parseFacebookReelsPayload(JSON.stringify(empty), { source }).connections.length, 0)
  const known = parseFacebookReelsPayload(JSON.stringify(empty), { source, collectionIds: new Set(['collection:target']) })
  assert.equal(known.connections[0].hasNextPage, false)
})

test('reads anti-JSON prefix and NDJSON chunks without combining captions across IDs', () => {
  const p = parseFacebookReelsPayload('for (;;);' + JSON.stringify(payload()) + '\n' +
    JSON.stringify({ data: { video: { id: '333333', creation_story: { message: { text: 'Another caption' } } } } }),
    { source, knownIds: new Set(['333333']) })
  assert.deepEqual(p.entries.map(e => e.id).sort(), ['111111', '333333'])
})

test('rejects malformed/oversized payload and retains Unicode caption longer than 90 chars', () => {
  assert.equal(parseFacebookReelsPayload('{broken', { source }).malformed, true)
  assert.equal(parseFacebookReelsPayload(' '.repeat(4 * 1024 * 1024 + 1), { source }).malformed, true)
  const long = 'Đúng nội dung 🎬 '.repeat(100)
  const entry = facebookReelEntry('111111', long, 'graphql')
  assert.equal(entry.facebook?.caption, long.trim())
  assert.equal(entry.title, long.trim())
})

test('verified caption upgrades a provisional label only for the same Reel ID', () => {
  const old = facebookReelEntry('111111', 'Card text', 'dom')
  const verified = facebookReelEntry('111111', 'Correct', 'graphql')
  assert.equal(mergeFacebookReel(old, verified).title, 'Correct')
  assert.equal(mergeFacebookReel(verified, old).title, 'Correct')
  assert.equal(mergeFacebookReel(old, facebookReelEntry('222222', 'Wrong', 'graphql')).title, 'Card text')
})

test('a DOM-known recommendation from a foreign owner cannot become a verified source Reel', () => {
  const p = parseFacebookReelsPayload(JSON.stringify({ own: payload('123456789', false), recommendation: {
    id: '222222', owner: { id: '987654321' }, creation_story: { message: { text: 'Foreign caption' } }
  } }), { source, knownIds: new Set(['111111','222222']) })
  assert.deepEqual(p.entries.map(e => e.id), ['111111'])
  assert.equal(p.entries[0].facebook?.sourceVerified, true)
})
