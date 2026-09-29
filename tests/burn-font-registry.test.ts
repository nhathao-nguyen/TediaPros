import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listBurnFonts, findBurnFont, resolveBurnFont } from '../src/main/fonts'

test('listBurnFonts includes bundled fonts including Anton', () => {
  const fonts = listBurnFonts()
  const ids = fonts.map((f) => f.id)
  assert.ok(ids.includes('noto-sans'))
  assert.ok(ids.includes('roboto'))
  assert.ok(ids.includes('anton-regular'))
  assert.ok(ids.includes('be-vietnam-pro'))
  assert.ok(ids.includes('oswald'))
  assert.ok(ids.includes('inter'))
  assert.ok(ids.includes('lobster'))

  const beVietnam = fonts.find((f) => f.id === 'be-vietnam-pro')
  assert.equal(beVietnam?.label, 'Be Vietnam Pro')
  assert.equal(beVietnam?.family, 'Be Vietnam Pro')
  assert.equal(beVietnam?.available, true)

  const anton = fonts.find((f) => f.id === 'anton-regular')
  assert.equal(anton?.label, 'Anton')
  assert.equal(anton?.family, 'Anton')
  assert.equal(anton?.available, true)
})

test('findBurnFont and resolveBurnFont resolve both anton and anton-regular aliases', () => {
  const byRegular = findBurnFont('anton-regular')
  const byAlias = findBurnFont('anton')

  assert.ok(byRegular)
  assert.ok(byAlias)
  assert.equal(byRegular.id, 'anton-regular')
  assert.equal(byAlias.id, 'anton-regular')

  const resolved = resolveBurnFont('anton')
  assert.ok(resolved)
  assert.equal(resolved.entry.family, 'Anton')
  assert.ok(resolved.filePath.endsWith('Anton-Regular.ttf'))
})
