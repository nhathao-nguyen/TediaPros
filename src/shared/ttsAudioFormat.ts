export type TtsAudioMime = 'audio/wav' | 'audio/mpeg'

export function ttsAudioFormat(mime?: string): { mime: TtsAudioMime; extension: 'wav' | 'mp3' } {
  if (mime === undefined || mime === 'audio/wav' || mime === 'audio/x-wav') {
    return { mime: 'audio/wav', extension: 'wav' }
  }
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') {
    return { mime: 'audio/mpeg', extension: 'mp3' }
  }
  throw new Error(`Định dạng âm thanh TTS không được hỗ trợ: ${mime}`)
}

export function normalizeTtsAudioOutputPath(path: string, mime?: string): string {
  const { extension } = ttsAudioFormat(mime)
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const dot = path.lastIndexOf('.')
  const stem = dot > separator ? path.slice(0, dot) : path
  return `${stem}.${extension}`
}

export function assertTtsAudioHeader(bytes: Uint8Array, mime?: string): void {
  const format = ttsAudioFormat(mime)
  const wav = bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45
  const id3 = bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33
  const mp3Frame = bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
  if ((format.extension === 'wav' && !wav) || (format.extension === 'mp3' && !id3 && !mp3Frame)) {
    throw new Error(`Dữ liệu không khớp định dạng ${format.mime}`)
  }
}
