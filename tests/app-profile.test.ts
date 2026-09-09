import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveAppRuntimeProfile } from '../src/main/appProfile'

test('packaged app keeps the production profile and identity', () => {
  assert.deepEqual(resolveAppRuntimeProfile(true), {
    appName: 'tedia-pros',
    userDataDirectory: 'tedia-pros',
    windowTitle: 'TediaPros'
  })
})

test('source-run app uses an isolated development profile and identity', () => {
  assert.deepEqual(resolveAppRuntimeProfile(false), {
    appName: 'tedia-pros-dev',
    userDataDirectory: 'tedia-pros-dev',
    windowTitle: 'TediaPros (Dev)'
  })
})

test('development and packaged profiles cannot share their user-data directory', () => {
  const production = resolveAppRuntimeProfile(true)
  const development = resolveAppRuntimeProfile(false)
  assert.notEqual(production.appName, development.appName)
  assert.notEqual(production.userDataDirectory, development.userDataDirectory)
})
