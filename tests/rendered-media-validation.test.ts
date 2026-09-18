import assert from 'node:assert/strict'
import test from 'node:test'
import { validateFrameRateMeasurement } from '../src/main/burn'

const vfrAverage = 20375 / 689

test('VFR validation compares output average FPS, not nominal FPS', () => {
  assert.doesNotThrow(() => validateFrameRateMeasurement(
    {
      frameRate: 30,
      averageFrameRate: vfrAverage,
      isVariableFrameRate: true
    },
    {
      nominalFrameRate: 30,
      averageFrameRate: vfrAverage
    }
  ))
})

test('VFR validation rejects an output whose average FPS drifts', () => {
  assert.throws(
    () => validateFrameRateMeasurement(
      {
        frameRate: 30,
        averageFrameRate: vfrAverage,
        isVariableFrameRate: true
      },
      {
        nominalFrameRate: 30,
        averageFrameRate: 28.4
      }
    ),
    /Tốc độ khung hình/u
  )
})

test('CFR validation still rejects a nominal and average FPS mismatch', () => {
  assert.throws(
    () => validateFrameRateMeasurement(
      {
        frameRate: 30,
        averageFrameRate: 30,
        isVariableFrameRate: false
      },
      {
        nominalFrameRate: 29.5,
        averageFrameRate: 29.5
      }
    ),
    /Tốc độ khung hình/u
  )
})

test('VFR validation does not fail when an old ffprobe omits average FPS', () => {
  assert.doesNotThrow(() => validateFrameRateMeasurement(
    {
      frameRate: 30,
      averageFrameRate: vfrAverage,
      isVariableFrameRate: true
    },
    { nominalFrameRate: 30 }
  ))
})
