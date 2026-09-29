export type WhisperModelId = 'base' | 'small' | 'medium' | 'large-v3' | 'large-v3-turbo'

export interface WhisperModelSpec {
  id: WhisperModelId
  label: string
  note: string
  backend: 'faster-whisper'
  format: 'ctranslate2'
  languageFamily: 'multilingual'
  repoId: string
  revision: string
  filename: string
  downloadBytes: number
}

/** One shared catalog for AudioText and Auto Short. */
export const WHISPER_MODEL_CATALOG: Readonly<Record<WhisperModelId, WhisperModelSpec>> = {
  base: {
    id: 'base',
    label: 'Nhanh',
    note: 'Base · phù hợp bản nháp và máy cấu hình vừa',
    backend: 'faster-whisper',
    format: 'ctranslate2',
    languageFamily: 'multilingual',
    repoId: 'Systran/faster-whisper-base',
    revision: 'ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66',
    filename: 'model.bin',
    downloadBytes: 145_000_000
  },
  small: {
    id: 'small',
    label: 'Cân bằng — khuyên dùng',
    note: 'Small · cân bằng tốc độ và độ chính xác',
    backend: 'faster-whisper',
    format: 'ctranslate2',
    languageFamily: 'multilingual',
    repoId: 'Systran/faster-whisper-small',
    revision: '536b0662742c02347bc0e980a01041f333bce120',
    filename: 'model.bin',
    downloadBytes: 484_000_000
  },
  medium: {
    id: 'medium',
    label: 'Chính xác cao',
    note: 'Medium · chính xác hơn nhưng cần nhiều RAM/VRAM',
    backend: 'faster-whisper',
    format: 'ctranslate2',
    languageFamily: 'multilingual',
    repoId: 'Systran/faster-whisper-medium',
    revision: '08e178d48790749d25932bbc082711ddcfdfbc4f',
    filename: 'model.bin',
    downloadBytes: 1_530_000_000
  },
  'large-v3': {
    id: 'large-v3',
    label: 'Chính xác tối đa (Large v3)',
    note: 'Large v3 · chính xác nhất, khuyến nghị dùng GPU rời NVIDIA (~3.5GB VRAM)',
    backend: 'faster-whisper',
    format: 'ctranslate2',
    languageFamily: 'multilingual',
    repoId: 'Systran/faster-whisper-large-v3',
    revision: 'edaa852ec7e145841d8ffdb056a99866b5f0a478',
    filename: 'model.bin',
    downloadBytes: 3_145_762_253
  },
  'large-v3-turbo': {
    id: 'large-v3-turbo',
    label: 'Large v3 Turbo (Siêu nhanh)',
    note: 'Turbo · chính xác gần bằng Large v3 nhưng nhanh gấp 4 lần, tốn ít VRAM',
    backend: 'faster-whisper',
    format: 'ctranslate2',
    languageFamily: 'multilingual',
    repoId: 'mobiuslabsgmbh/faster-whisper-large-v3-turbo',
    revision: '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf',
    filename: 'model.bin',
    downloadBytes: 1_617_884_929
  }
}

export function isWhisperModelId(value: unknown): value is WhisperModelId {
  return value === 'base' || value === 'small' || value === 'medium' || value === 'large-v3' || value === 'large-v3-turbo'
}

/** Migrate persisted values from the old Whisper UI without prompting. */
export function normalizeWhisperModel(value: unknown): WhisperModelId {
  if (value === 'small' || value === 'medium' || value === 'base' || value === 'large-v3' || value === 'large-v3-turbo') return value
  if (value === 'tiny') return 'base'
  return 'base'
}
