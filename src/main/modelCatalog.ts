export type WhisperModelId = 'base' | 'small' | 'medium'

export interface WhisperModelSpec {
  id: WhisperModelId
  label: string
  note: string
  backend: 'whisper.cpp'
  format: 'ggml'
  languageFamily: 'multilingual'
  filename: string
  downloadBytes: number
}

/** One shared catalog for AudioText and Auto Short. */
export const WHISPER_MODEL_CATALOG: Readonly<Record<WhisperModelId, WhisperModelSpec>> = {
  base: {
    id: 'base',
    label: 'Nhanh',
    note: 'Base · phù hợp bản nháp và máy cấu hình vừa',
    backend: 'whisper.cpp',
    format: 'ggml',
    languageFamily: 'multilingual',
    filename: 'ggml-base.bin',
    downloadBytes: 145_000_000
  },
  small: {
    id: 'small',
    label: 'Cân bằng — khuyên dùng',
    note: 'Small · cân bằng tốc độ và độ chính xác',
    backend: 'whisper.cpp',
    format: 'ggml',
    languageFamily: 'multilingual',
    filename: 'ggml-small.bin',
    downloadBytes: 484_000_000
  },
  medium: {
    id: 'medium',
    label: 'Chính xác cao',
    note: 'Medium · chính xác hơn nhưng cần nhiều RAM/VRAM',
    backend: 'whisper.cpp',
    format: 'ggml',
    languageFamily: 'multilingual',
    filename: 'ggml-medium.bin',
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
