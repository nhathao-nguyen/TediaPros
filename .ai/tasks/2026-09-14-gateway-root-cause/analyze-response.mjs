import { readFileSync, writeFileSync } from 'node:fs'
const file = process.argv[2]
const frames = []
for (const line of readFileSync(file, 'utf8').split('\n')) {
  let root
  try { root = JSON.parse(line) } catch { continue }
  for (const item of root) {
    if (typeof item?.[2] !== 'string') continue
    let payload
    try { payload = JSON.parse(item[2]) } catch { continue }
    const candidate = payload?.[4]?.[0]
    const text = candidate?.[1]?.[0]
    if (typeof text !== 'string') continue
    let parsed
    try { parsed = JSON.parse(text) } catch {}
    frames.push({ bytes: Buffer.byteLength(text), jsonValid: !!parsed,
      cues: Object.keys(parsed?.translations || {}).length,
      modelId: payload[39], modelLabel: payload[42], state: candidate[8],
      suffix: text.slice(-150), prefix: text.slice(0,100) })
  }
}
const result = { frames: frames.length, models: [...new Set(frames.map(f=>f.modelLabel))],
  completeJsonFrames: frames.filter(f=>f.jsonValid).length,
  first: frames[0], last: frames.at(-1), finalFrames: frames.slice(-5) }
writeFileSync(file.replace('upstream-response.txt','analysis.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
