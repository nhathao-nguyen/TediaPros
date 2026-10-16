import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { app } from 'electron'
import { assertContainedRegularFile } from './safeContainedPath'

export function facebookAccountDigest(value?: string): string {
  return value ? createHash('sha256').update(value).digest('hex') : 'guest'
}
/** Called while the cookie manager holds its domain mutex. No jar or credential is retained. */
export async function facebookCookieAccount(file: string | null): Promise<string> {
  if (!file) return 'guest'
  const path = await assertContainedRegularFile(file, app.getPath('userData'), 'Facebook cookie context')
  const raw = await readFile(path, 'utf8')
  const account = raw.split(/\r?\n/).map(line => line.replace(/^#HttpOnly_/, '').split('\t')).find(parts =>
    parts[0]?.replace(/^\./, '') === 'facebook.com' && parts[5] === 'c_user' &&
    (Number(parts[4]) === 0 || Number(parts[4]) > Date.now() / 1000))?.[6]
  return facebookAccountDigest(account)
}
