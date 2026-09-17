import fs from 'node:fs'
import path from 'node:path'

const p = path.join(process.env.APPDATA, 'tedia-pros', 'autoshort-batches-v1', '6dbe0367-2943-44be-9730-02fd6375d9fb', 'snapshot.json')
if (fs.existsSync(p)) {
  const data = JSON.parse(fs.readFileSync(p, 'utf8'))
  const snap = data.snapshot || {}
  console.log('Snapshot keys:', Object.keys(snap))
  const items = snap.items || []
  console.log('Items count:', items.length)
  for (let i = 0; i < 10; i++) {
    const item = items[i]
    console.log(`${i + 1}. exists=${fs.existsSync(item.inputPath)} | ${item.inputPath}`)
  }
} else {
  console.log('File does not exist:', p)
}
