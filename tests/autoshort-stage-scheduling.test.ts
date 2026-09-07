import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

test('overlap policy starts visual processing after Whisper source evidence and before translation', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'autoShortItemCoordinator.ts'), 'utf8')
  const visualStart = source.indexOf('visualBranchOutcomePromise = scope.start((s) => runVisualBranch(s))')
  const whisperCompletion = source.indexOf('const whisper = await runWhisper()')
  const translationStage = source.indexOf("if (config.translateTarget !== 'none')")

  assert.ok(visualStart >= 0, 'visual overlap branch must remain explicit')
  assert.ok(whisperCompletion >= 0, 'Whisper extraction branch must remain explicit')
  assert.ok(translationStage >= 0, 'translation stage must remain explicit')
  assert.ok(visualStart > whisperCompletion, 'visual processing must wait for Whisper source cues')
  assert.ok(visualStart < translationStage, 'visual processing should overlap translation when enabled')
})
