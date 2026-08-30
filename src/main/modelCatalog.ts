export type WhisperModelId = 'base' | 'small' | 'medium'

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
  }
}

export function isWhisperModelId(value: unknown): value is WhisperModelId {
  return value === 'base' || value === 'small' || value === 'medium'
}

/** Migrate persisted values from the old Whisper UI without prompting. */
export function normalizeWhisperModel(value: unknown): WhisperModelId {
  if (value === 'small' || value === 'medium' || value === 'base') return value
  if (value === 'large-v3') return 'medium'
  if (value === 'tiny') return 'base'
  return 'base'
}
