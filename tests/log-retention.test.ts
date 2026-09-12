import assert from 'node:assert/strict'
import test from 'node:test'
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { archiveSessionLogSync, pruneSessionLogs } from '../src/main/logRetention'
import { clearLogs, initializeLogSessionSync, logFilePath, logInfo } from '../src/main/logger'

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await access(path)
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  throw new Error(`Log file was not written: ${path}`)
}

test('archiving a completed session preserves its bytes under a unique session id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-log-archive-'))
  const active = join(root, 'tblao.log')
  try {
    await writeFile(active, 'session evidence\n', 'utf8')
    const archived = archiveSessionLogSync({ rootDir: root, activePath: active, sessionId: 'session-01' })
    assert.equal(await readFile(archived, 'utf8'), 'session evidence\n')
    assert.deepEqual(await readdir(root), ['tblao-session-session-01.log'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('retention removes expired and oldest archives without deleting an active log', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-log-retention-'))
  const active = join(root, 'tblao.log')
  const expired = join(root, 'tblao-session-expired.log')
  const older = join(root, 'tblao-session-older.log')
  const newer = join(root, 'tblao-session-newer.log')
  const nowMs = Date.parse('2026-09-12T12:00:00Z')
  try {
    await writeFile(active, 'A'.repeat(80), 'utf8')
    await writeFile(expired, 'E'.repeat(20), 'utf8')
    await writeFile(older, 'O'.repeat(60), 'utf8')
    await writeFile(newer, 'N'.repeat(60), 'utf8')
    const { utimes } = await import('node:fs/promises')
    await utimes(expired, new Date(nowMs - 8 * 86_400_000), new Date(nowMs - 8 * 86_400_000))
    await utimes(older, new Date(nowMs - 2_000), new Date(nowMs - 2_000))
    await utimes(newer, new Date(nowMs - 1_000), new Date(nowMs - 1_000))

    const result = await pruneSessionLogs({
      rootDir: root,
      activeFiles: [active],
      nowMs,
      maxAgeMs: 7 * 86_400_000,
      maxBytes: 140
    })

    assert.deepEqual(result, { removedFiles: 2, removedBytes: 80 })
    assert.equal((await stat(active)).size, 80)
    assert.deepEqual((await readdir(root)).sort(), ['tblao-session-newer.log', 'tblao.log'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('logger writes a durable per-session file and only explicit clear removes it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-live-log-'))
  const previousRoot = process.env.TEDIAPROS_TEST_USER_DATA
  process.env.TEDIAPROS_TEST_USER_DATA = root
  try {
    initializeLogSessionSync()
    logInfo('durable session evidence')
    const path = logFilePath()
    await waitForFile(path)
    assert.match(await readFile(path, 'utf8'), /durable session evidence/u)
    clearLogs()
    await assert.rejects(access(path))
  } finally {
    process.env.TEDIAPROS_TEST_USER_DATA = previousRoot
    await rm(root, { recursive: true, force: true })
  }
})
