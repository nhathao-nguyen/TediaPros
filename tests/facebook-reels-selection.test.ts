import assert from 'node:assert/strict'
import { test } from 'node:test'
import { facebookReelEntry } from '../src/shared/facebookReels'
import { mergeReelsSelection, reelsSelectionWindow, reelsPage, filterReelsEntries, filterReelsExportRows, reelsSelectionCounts, loadMissingReelsCaptions } from '../src/renderer/src/lib/facebookReels'
import type { FacebookReelsExportRow } from '../src/shared/facebookReels'

test('metadata updates preserve selection, full caption and unrelated titles', () => {
  const caption = 'Đây là caption dài '.repeat(30)
  const rows = [ { ...facebookReelEntry('111111'), checked: false, playlistTitle: 'Creator' },
    { ...facebookReelEntry('222222', 'Correct', 'graphql'), checked: true, playlistTitle: 'Creator' } ]
  const next = mergeReelsSelection(rows, [facebookReelEntry('111111', caption, 'ytdlp'), facebookReelEntry('333333')], 'Creator')
  assert.equal(next[0].checked, false)
  assert.equal(next[0].facebook?.caption, caption.trim())
  assert.equal(next[1].title, 'Correct')
  assert.equal(next[2].checked, true)
  assert.equal(next.length, 3)
})

test('failed metadata remains explicitly marked without replacing a caption', () => {
  const row = { ...facebookReelEntry('111111'), checked: true, playlistTitle: 'Creator' }
  const update = { ...row, facebook: { ...row.facebook!, status: 'error' as const } }
  assert.equal(mergeReelsSelection([row], [update], 'Creator')[0].facebook?.status, 'error')
})

test('an empty partial list renders no undefined rows and permits showing the summary', () => {
  assert.deepEqual(reelsSelectionWindow([], 1, 1), { from: 0, to: 0, rows: [], hidden: 0 })
})

test('every result including rows beyond 500 is reachable by pagination, with stable source indices', () => {
  const entries = Array.from({ length: 1203 }, (_, i) => i)
  const pages = Array.from({ length: 25 }, (_, i) => reelsPage(entries, i + 1).rows).flat()
  assert.deepEqual(pages.map(r => r.e), entries)
  assert.equal(pages.at(-1)?.i, 1202)
  assert.equal(reelsPage(entries.slice(0, 2), 25).page, 1)
  assert.deepEqual(reelsPage([], 9).rows, [])
})

test('selection search finds full captions without changing checked state or original index', () => {
  const entries = [
    { ...facebookReelEntry('111111', 'First line\n' + 'Story '.repeat(200) + 'needle'), checked: false, playlistTitle: 'Creator' },
    { ...facebookReelEntry('222222', 'Other caption'), checked: true, playlistTitle: 'Creator' }
  ]
  const filtered = filterReelsEntries(entries, 'NEEDLE')
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].i, 0)
  assert.equal(filtered[0].e.checked, false)
  assert.equal(entries[1].checked, true)
})

test('result filters find article text and errors, and treat disabled video as intentional', () => {
  const base: FacebookReelsExportRow = { index: 1, id: '111111', reelUrl: 'https://www.facebook.com/reel/111111/',
    title: 'First', caption: 'Full caption', targetUrl: 'https://example.com/story', foundIn: 'comment',
    articleTitle: 'Article', content: 'Text '.repeat(300) + 'Ending phrase', captionPath: 'caption.txt',
    articlePath: 'article.txt', videoPath: null, captionStatus: 'success', articleStatus: 'success', videoStatus: 'disabled', errors: [] }
  const problem = { ...base, id: '222222', index: 2, articleStatus: 'error' as const, errors: ['Website timed out'] }
  assert.deepEqual(filterReelsExportRows([base, problem], '', 'issues').map(r => r.id), ['222222'])
  assert.equal(filterReelsExportRows([base], 'ending phrase', 'all')[0].content, base.content)
  assert.equal(filterReelsExportRows([problem], 'timed out', 'all').length, 1)
  assert.equal(filterReelsExportRows([base], '', 'video').length, 0)
})

test('mixed selections count only Facebook entries for export while retaining ordinary queue choices', () => {
  const facebook = { ...facebookReelEntry('111111', 'Caption'), checked: true, playlistTitle: 'Facebook' }
  const ordinary = { ...facebookReelEntry('222222', 'Ordinary'), facebook: undefined, checked: true, playlistTitle: 'Other playlist' }
  assert.deepEqual(reelsSelectionCounts([facebook, ordinary]), { checked: 2, reels: 1, other: 1 })
  assert.deepEqual(reelsSelectionCounts([{ ...facebook, checked: false }, ordinary]), { checked: 1, reels: 0, other: 1 })
})

test('automatic caption loading covers more than 1000 missing IDs and preserves existing captions', async () => {
  const entries = [facebookReelEntry('111111', 'Existing full caption', 'graphql'),
    ...Array.from({ length: 1003 }, (_, i) => facebookReelEntry(String(500000 + i)))]
  const batches: string[][] = []
  const rows = await loadMissingReelsCaptions(entries, async ids => {
    batches.push(ids)
    return ids.map(id => facebookReelEntry(id, `Caption ${id}`, 'ytdlp'))
  }, () => false)
  assert.deepEqual(batches.map(ids => ids.length), [1000, 3])
  assert.equal(rows.length, entries.length)
  assert.equal(rows[0].facebook?.caption, 'Existing full caption')
  assert.equal(rows.at(-1)?.facebook?.caption, 'Caption 501002')
})

test('automatic caption loading returns completed data when stopped and ignores ordinary playlist entries', async () => {
  const entries = Array.from({ length: 1002 }, (_, i) => facebookReelEntry(String(500000 + i)))
  entries.push({ ...facebookReelEntry('999999'), facebook: undefined })
  let stopped = false, calls = 0
  const rows = await loadMissingReelsCaptions(entries, async ids => {
    calls++; stopped = true
    return ids.map(id => facebookReelEntry(id, `Caption ${id}`, 'ytdlp'))
  }, () => stopped)
  assert.equal(calls, 1)
  assert.equal(rows[999].facebook?.status, 'verified')
  assert.equal(rows[1000].facebook?.caption, null)
  assert.equal(rows.at(-1)?.facebook, undefined)
})
