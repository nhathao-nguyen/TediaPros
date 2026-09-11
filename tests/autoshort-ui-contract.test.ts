import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createAutoShortProgressCoalescer } from '../src/renderer/src/lib/autoshortProgressCoalescer'
import type { AutoShortEvent } from '../src/shared/types'

function progress(itemId: string, itemPercent: number): AutoShortEvent {
  return {
    type: 'item-progress',
    jobId: 'job-1',
    taskId: itemId,
    itemId,
    itemStatus: 'rendering_video',
    itemPercent,
    itemMessage: `progress-${itemPercent}`,
    batchIndex: itemId === 'a' ? 1 : 2,
    batchTotal: 2
  }
}

function done(itemId: string): AutoShortEvent {
  return {
    type: 'item-done',
    jobId: 'job-1',
    itemId,
    batchIndex: 1,
    batchTotal: 1,
    result: { itemId, filePath: `${itemId}.mp4`, status: 'done' }
  }
}

test('progress coalesces per item while retaining the newest event', async () => {
  const seen: AutoShortEvent[] = []
  const coalescer = createAutoShortProgressCoalescer((event) => seen.push(event), 20)
  coalescer.push(progress('a', 10))
  coalescer.push(progress('a', 20))
  coalescer.push(progress('b', 30))
  assert.equal(seen.length, 0)
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.deepEqual(seen.filter((event): event is Extract<AutoShortEvent, { type: 'item-progress' }> => event.type === 'item-progress').map((event) => [event.itemId, event.itemPercent]), [
    ['a', 20],
    ['b', 30]
  ])
  coalescer.dispose()
})

test('terminal events flush pending progress immediately and disposal flushes the remainder', () => {
  const seen: AutoShortEvent[] = []
  const coalescer = createAutoShortProgressCoalescer((event) => seen.push(event), 10)
  coalescer.push(progress('a', 80))
  coalescer.push(done('a'))
  assert.deepEqual(seen.map((event) => event.type), ['item-progress', 'item-done'])
  coalescer.push(progress('b', 15))
  coalescer.dispose()
  assert.deepEqual(seen.map((event) => event.type), ['item-progress', 'item-done', 'item-progress'])
  coalescer.push(progress('c', 1))
  assert.equal(seen.length, 3)
})

test('AutoShort exposes a typed cache clear action and keeps it disabled while running', async () => {
  const preload = await readFile(join(process.cwd(), 'src/preload/index.ts'), 'utf8')
  const component = await readFile(join(process.cwd(), 'src/renderer/src/components/AutoShort.tsx'), 'utf8')
  assert.match(preload, /autoShortClearCache\s*:\s*\(\): Promise<\{ ok: boolean; error\?: string \}>/u)
  assert.match(component, /window\.api\.autoShortClearCache\(\)/u)
  assert.match(component, /disabled=\{isRunning \|\| cacheAction\}/u)
})

test('both video workflows pass live locale and SEO options into metadata generation', async () => {
  const autoShort = await readFile(join(process.cwd(), 'src/renderer/src/components/AutoShort.tsx'), 'utf8')
  const editor = await readFile(join(process.cwd(), 'src/renderer/src/components/VideoEditor.tsx'), 'utf8')
  const settings = await readFile(join(process.cwd(), 'src/renderer/src/components/VideoTitleSettings.tsx'), 'utf8')
  for (const component of [autoShort, editor]) {
    assert.match(component, /seo:\s*titleSeoOptions/u)
    assert.match(component, /onSeoChange=\{setTitleSeoOptions\}/u)
    assert.match(component, /onProviderChange=\{setTitleProvider\}/u)
  }
  assert.match(autoShort, /language:\s*titleLanguage/u)
  assert.match(autoShort, /onLanguageChange=\{setTitleLanguage\}/u)
  assert.match(editor, /setBurnSeoMetadata\(result\.seoMetadata/u)
  const seoResult = await readFile(join(process.cwd(), 'src/renderer/src/components/VideoSeoResult.tsx'), 'utf8')
  assert.match(seoResult, /normalizeVideoSeoMetadata\(metadata\)/u)
  assert.match(seoResult, /hashtags\.join\(' '\)/u)
  assert.match(settings, /new Intl\.DisplayNames/u)
  assert.match(settings, /list=\{countryListId\}/u)
  assert.match(settings, /value="auto">Tự động theo locale/u)
})
