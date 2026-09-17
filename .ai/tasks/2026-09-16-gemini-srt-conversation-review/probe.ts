import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { validateAutoShortContentQuality, validateSourceRepairNumericPreservation } from '../../../src/main/autoShortContentQuality'
import { buildSourceSpeechUnitPlan } from '../../../src/main/translation/speechUnitPlanner'

// Offline review probe only: no provider, TTS, user configuration or source file writes.
const path = 'C:/Users/PC/Downloads/cuoc_tro_chuyen_dich_phu_de.md'
const document = readFileSync(path, 'utf8')
const blocks = [...document.matchAll(/```srt\s*\r?\n([\s\S]*?)```/gu)].map((match) => match[1]!)
if (blocks.length !== 2) throw new Error(`Expected two SRT blocks, found ${blocks.length}`)
const seconds = (timestamp: string): number => {
  const [hours, minutes, sec] = timestamp.replace(',', '.').split(':').map(Number)
  return hours! * 3600 + minutes! * 60 + sec!
}
const parse = (srt: string) => srt.trim().split(/\r?\n\s*\r?\n/u).map((block, index) => {
  const lines = block.trim().split(/\r?\n/u)
  const timing = lines[1]!.match(/^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})$/u)
  if (!timing) throw new Error(`Bad timestamp at block ${index + 1}`)
  return { id: lines[0]!, sourceIndex: index, start: seconds(timing[1]!), end: seconds(timing[2]!), text: lines.slice(2).join(' '), rawTimestamp: lines[1]! }
})
const source = parse(blocks[0]!)
const target = parse(blocks[1]!)
const targetById = new Map(target.map((cue) => [cue.id, cue]))
const sourceDigest = createHash('sha256').update(blocks[0]!).digest('hex')
const plan = buildSourceSpeechUnitPlan({ sourceDigest, videoDuration: source.at(-1)!.end + 0.12, cues: source })
const checkPair = (sourceText: string, targetText: string) => {
  const cue = { id: 'probe', start: 0, end: 5, text: sourceText }
  return {
    sourceText, targetText,
    quality: validateAutoShortContentQuality({ sourceCues: [cue], targetCues: [{ ...cue, text: targetText }] }),
    sourceRepairNumericGate: validateSourceRepairNumericPreservation(sourceText, targetText)
  }
}
console.log(JSON.stringify({
  scope: 'offline code probe; text-only; no measured TTS; video duration inferred from SRT end plus 120ms for grouping only',
  documentSha256: createHash('sha256').update(document).digest('hex'),
  sourceCount: source.length,
  targetCount: target.length,
  sourceUniqueIds: new Set(source.map((cue) => cue.id)).size,
  targetUniqueIds: targetById.size,
  exactIdAndTimestampMatches: source.filter((cue) => targetById.get(cue.id)?.rawTimestamp === cue.rawTimestamp).length,
  nonemptyTargetCount: target.filter((cue) => cue.text.trim()).length,
  sourceEndSeconds: source.at(-1)!.end,
  speechUnitCount: plan.units.length,
  inspectedCues: ['11', '12', '19', '20', '21', '24', '39', '54', '63', '68'].map((id) => {
    const cue = source.find((entry) => entry.id === id)!
    const translated = targetById.get(id)!
    return { id, source: cue.text, target: translated.text, spanSeconds: Number((cue.end - cue.start).toFixed(3)), whitespaceUnits: translated.text.split(/\s+/u).length,
      speechUnitMembers: plan.units.find((unit) => unit.memberCueIds.includes(id))?.memberCueIds }
  }),
  sampleQuality: validateAutoShortContentQuality({ sourceCues: source, targetCues: target }),
  targetedProbes: [
    checkPair('它能承受10斤。', 'Nó chịu được 10 cân.'),
    checkPair('它能承受10斤。', 'Nó chịu được 5 kg.'),
    checkPair('加入2勺盐。', 'Thêm 2 thìa đường.'),
    checkPair('加入2勺盐。', 'Thêm 2 thìa muối.'),
    checkPair('加入2勺盐。', 'Thêm hai thìa muối.'),
    checkPair('加入 2 勺盐。', 'Thêm 2 thìa muối.'),
    checkPair('价格39.6。', 'Giá 39,6 tệ.')
  ]
}, null, 2))
