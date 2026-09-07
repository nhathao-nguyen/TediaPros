import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

test('native preview and Douyin helpers register spawned children with the shutdown registry', async () => {
  const [preview, douyin] = await Promise.all([
    readFile(join(process.cwd(), 'src', 'main', 'audioPreview.ts'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'main', 'douyin.ts'), 'utf8')
  ])

  assert.match(preview, /import\s+\{[^}]*trackChildProcess[^}]*\}\s+from\s+'\.\/processTree'/u)
  assert.match(preview, /trackChildProcess\(spawn\(/u)
  assert.match(douyin, /import\s+\{[^}]*trackChildProcess[^}]*\}\s+from\s+'\.\/processTree'/u)
  assert.match(douyin, /trackChildProcess\(spawn\(/u)
})
