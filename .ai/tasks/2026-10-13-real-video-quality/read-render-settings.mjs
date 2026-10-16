import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const root = join(process.env.APPDATA, 'tedia-pros-dev/Local Storage/leveldb')
const keys = ['tblao.autoshort.videoAdjustments.v1', 'tblao.autoshort.videoEffects.v1', 'tblao.autoshort.videoSpeed',
  'tblao.autoshort.portraitBlur', 'tblao.autoshort.openingZoom', 'tblao.autoshort.openingFlash']
const selected = new Map()
function remember(key, value, sequence) {
  const wanted = keys.find(k => key.endsWith(k))
  if (!wanted || !value || selected.get(wanted)?.sequence >= sequence) return
  for (const text of [value.subarray(1).toString('utf8'), value.subarray(1).toString('utf16le')]) {
    try { const parsed = JSON.parse(text); selected.set(wanted, { sequence, value: parsed }); break } catch { }
  }
}
function batch(buffer) {
  if (buffer.length < 12) return
  const sequence = buffer.readBigUInt64LE(0); let offset = 12
  const length = () => { let value = 0, shift = 0; while (offset < buffer.length && shift < 35) { const b = buffer[offset++]; value += (b & 127) * 2 ** shift; if (!(b & 128)) return value; shift += 7 } throw Error('Incomplete varint') }
  const field = () => { const n = length(); if (n > buffer.length - offset) throw Error('Incomplete field'); const b = buffer.subarray(offset, offset + n); offset += n; return b }
  for (let i = 0; i < buffer.readUInt32LE(8); i++) {
    const type = buffer[offset++], key = field().toString('latin1'), value = type === 1 ? field() : undefined
    remember(key, value, sequence + BigInt(i))
  }
}
for (const file of (await readdir(root)).filter(name => /^\d+\.log$/.test(name))) {
  const data = await readFile(join(root, file)); let fragment = []
  for (let block = 0; block < data.length; block += 32768) {
    let offset = block; const end = Math.min(block + 32768, data.length)
    while (offset + 7 <= end) {
      const size = data.readUInt16LE(offset + 4), type = data[offset + 6]; offset += 7
      if (type === 0 && size === 0) break
      if (offset + size > end) break
      const part = data.subarray(offset, offset + size); offset += size
      try {
        if (type === 1) batch(part)
        else if (type === 2) fragment = [part]
        else if (type === 3) fragment.push(part)
        else if (type === 4) { fragment.push(part); batch(Buffer.concat(fragment)); fragment = [] }
      } catch { /* ignore incomplete historical records */ }
    }
  }
}
function varint(data, cursor) {
  let value = 0, shift = 0
  while (cursor.offset < data.length && shift < 56) { const b = data[cursor.offset++]; value += (b & 127) * 2 ** shift; if (!(b & 128)) return value; shift += 7 }
  throw Error('Invalid table varint')
}
function snappy(data) {
  const c = { offset: 0 }, size = varint(data, c)
  if (size > 2 * 1024 * 1024) throw Error('Oversized table block')
  const out = Buffer.alloc(size); let offset = 0
  while (c.offset < data.length && offset < size) {
    const tag = data[c.offset++], kind = tag & 3; let n, distance
    if (kind === 0) {
      n = tag >> 2
      if (n >= 60) { const bytes = n - 59; n = data.readUIntLE(c.offset, bytes); c.offset += bytes }
      n++; if (n > size - offset || n > data.length - c.offset) throw Error('Invalid literal')
      data.copy(out, offset, c.offset, c.offset + n); c.offset += n; offset += n
    } else {
      if (kind === 1) { n = ((tag >> 2) & 7) + 4; distance = ((tag & 224) << 3) + data[c.offset++] }
      else { n = (tag >> 2) + 1; const bytes = kind === 2 ? 2 : 4; distance = data.readUIntLE(c.offset, bytes); c.offset += bytes }
      if (distance <= 0 || distance > offset || n > size - offset) throw Error('Invalid backreference')
      for (let i = 0; i < n; i++, offset++) out[offset] = out[offset - distance]
    }
  }
  if (offset !== size) throw Error('Incomplete block')
  return out
}
function entries(data) {
  const restartCount = data.readUInt32LE(data.length - 4), end = data.length - 4 - restartCount * 4
  const c = { offset: 0 }; let previous = Buffer.alloc(0); const result = []
  while (c.offset < end) {
    const shared = varint(data, c), unshared = varint(data, c), length = varint(data, c)
    if (shared > previous.length || unshared + length > end - c.offset) throw Error('Invalid table entry')
    const key = Buffer.concat([previous.subarray(0, shared), data.subarray(c.offset, c.offset + unshared)])
    c.offset += unshared; const value = data.subarray(c.offset, c.offset + length); c.offset += length
    result.push([key, value]); previous = key
  }
  return result
}
for (const file of (await readdir(root)).filter(name => /^\d+\.ldb$/.test(name))) {
  try {
    const data = await readFile(join(root, file)); if (data.length < 48 || data.length > 2 * 1024 * 1024) continue
    if (data.readBigUInt64LE(data.length - 8) !== 0xdb4775248b80fb57n) continue
    const footer = { offset: data.length - 48 }; varint(data, footer); varint(data, footer)
    const block = (offset, size) => { const bytes = data.subarray(offset, offset + size); return data[offset + size] === 1 ? snappy(bytes) : bytes }
    const index = block(varint(data, footer), varint(data, footer))
    for (const [, handle] of entries(index)) {
      const c = { offset: 0 }, table = block(varint(handle, c), varint(handle, c))
      for (const [internal, value] of entries(table)) {
        if (internal.length < 8) continue
        const tag = internal.readBigUInt64LE(internal.length - 8)
        if ((tag & 255n) === 1n) remember(internal.subarray(0, -8).toString('latin1'), value, tag >> 8n)
      }
    }
  } catch { /* Ignore incomplete historical tables; never modify the live store. */ }
}
const render = Object.fromEntries([...selected].map(([key, { value }]) => [key, value]))
await writeFile('.ai/tasks/2026-10-13-real-video-quality/current-render-settings.json', JSON.stringify(render, null, 2))
console.log(JSON.stringify(render, null, 2))
