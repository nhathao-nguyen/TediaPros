import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listBurnFonts, findBurnFont } from '../src/main/fonts'
import {
  clampFontWeight,
  getSupportedFontWeights,
  ALL_FONT_WEIGHT_OPTIONS
} from '../src/shared/fontWeights'

test('listBurnFonts includes minWeight and maxWeight metadata', () => {
  const fonts = listBurnFonts()

  const oswald = fonts.find((f) => f.id === 'oswald')
  assert.ok(oswald)
  assert.equal(oswald.minWeight, 200)
  assert.equal(oswald.maxWeight, 700)

  const inter = fonts.find((f) => f.id === 'inter')
  assert.ok(inter)
  assert.equal(inter.minWeight, 100)
  assert.equal(inter.maxWeight, 900)

  const anton = fonts.find((f) => f.id === 'anton-regular')
  assert.ok(anton)
  assert.equal(anton.minWeight, 400)
  assert.equal(anton.maxWeight, 400)

  const jetbrains = fonts.find((f) => f.id === 'jetbrains-mono')
  assert.ok(jetbrains)
  assert.equal(jetbrains.minWeight, 100)
  assert.equal(jetbrains.maxWeight, 800)
})

test('getSupportedFontWeights returns weights supported by Oswald (200 - 700)', () => {
  const oswald = findBurnFont('oswald')
  assert.ok(oswald)

  const weights = getSupportedFontWeights(oswald)
  const values = weights.map((w) => w.value)
  assert.deepEqual(values, [200, 300, 400, 500, 600, 700])
  assert.equal(values.includes(100), false)
  assert.equal(values.includes(800), false)
  assert.equal(values.includes(900), false)
})

test('getSupportedFontWeights returns full weights for Inter (100 - 900)', () => {
  const inter = findBurnFont('inter')
  assert.ok(inter)

  const weights = getSupportedFontWeights(inter)
  const values = weights.map((w) => w.value)
  assert.deepEqual(values, [100, 200, 300, 400, 500, 600, 700, 800, 900])
})

test('getSupportedFontWeights returns single weight 400 for Anton', () => {
  const anton = findBurnFont('anton-regular')
  assert.ok(anton)

  const weights = getSupportedFontWeights(anton)
  const values = weights.map((w) => w.value)
  assert.deepEqual(values, [400])
})

test('getSupportedFontWeights returns 100 - 800 for JetBrains Mono', () => {
  const jetbrains = findBurnFont('jetbrains-mono')
  assert.ok(jetbrains)

  const weights = getSupportedFontWeights(jetbrains)
  const values = weights.map((w) => w.value)
  assert.deepEqual(values, [100, 200, 300, 400, 500, 600, 700, 800])
})

test('getSupportedFontWeights falls back to all options when font is null or unconstrained', () => {
  const weights = getSupportedFontWeights(null)
  assert.equal(weights.length, ALL_FONT_WEIGHT_OPTIONS.length)
  assert.deepEqual(weights.map((w) => w.value), [100, 200, 300, 400, 500, 600, 700, 800, 900])
})

test('clampFontWeight correctly clamps weights outside supported range', () => {
  const oswald = findBurnFont('oswald')
  assert.ok(oswald)

  // 900 exceeds Oswald max (700) -> clamps to 700
  assert.equal(clampFontWeight(900, oswald), 700)
  // 800 exceeds Oswald max (700) -> clamps to 700
  assert.equal(clampFontWeight(800, oswald), 700)
  // 100 is below Oswald min (200) -> clamps to 200
  assert.equal(clampFontWeight(100, oswald), 200)
  // 600 is supported -> unchanged
  assert.equal(clampFontWeight(600, oswald), 600)

  const anton = findBurnFont('anton-regular')
  assert.ok(anton)
  // Any weight with Anton clamps to 400
  assert.equal(clampFontWeight(700, anton), 400)
  assert.equal(clampFontWeight(300, anton), 400)
  assert.equal(clampFontWeight(400, anton), 400)
})
