import assert from 'node:assert/strict'
import test from 'node:test'
import { validateDurationMeasurement, validateFrameRateMeasurement } from '../src/main/burn'

test('Duration validation accepts when video stream matches expected duration', () => {
  assert.doesNotThrow(() => validateDurationMeasurement(
    { durationSeconds: 15.042, frameRate: 24, durationToleranceFrames: 3 },
    { streamDuration: 15.042, containerDuration: 15.199 }
  ))
})

test('Duration validation accepts when container duration matches expected duration (audio tail case)', () => {
  assert.doesNotThrow(() => validateDurationMeasurement(
    { durationSeconds: 15.199, frameRate: 24, durationToleranceFrames: 3 },
    { streamDuration: 15.042, containerDuration: 15.199 }
  ))
})

test('Duration validation rejects when both stream and container drift beyond tolerance', () => {
  assert.throws(
    () => validateDurationMeasurement(
      { durationSeconds: 15.0, frameRate: 24, durationToleranceFrames: 3 },
      { streamDuration: 10.0, containerDuration: 10.1 }
    ),
    /Thời lượng video xuất \(10\.000s\) lệch quá mức so với dự kiến \(15\.000s\)\./u
  )
})

test('Duration validation throws when no valid duration is available', () => {
  assert.throws(
    () => validateDurationMeasurement(
      { durationSeconds: 15.0, frameRate: 24, durationToleranceFrames: 3 },
      { streamDuration: 0, containerDuration: null }
    ),
    /Không thể xác định thời lượng video xuất\./u
  )
})

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
