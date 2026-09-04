import type { AutoShortSeparationPreset, SeparatorModelId } from './types'

export interface SeparationPresetConfig {
  modelId: SeparatorModelId
  overlap: 0.10 | 0.25 | 0.50
  batch: 1
}

export const SEPARATION_PRESETS: Readonly<Record<AutoShortSeparationPreset, SeparationPresetConfig>> = {
  fast: { modelId: 'separator-fast-balanced-v1', overlap: 0.10, batch: 1 },
  balanced: { modelId: 'separator-fast-balanced-v1', overlap: 0.25, batch: 1 },
  quality: { modelId: 'separator-quality-v1', overlap: 0.50, batch: 1 }
}

export function separationPresetConfig(preset: AutoShortSeparationPreset): SeparationPresetConfig {
  return SEPARATION_PRESETS[preset]
}

export function modelIdForSeparationPreset(preset: AutoShortSeparationPreset): SeparatorModelId {
  return separationPresetConfig(preset).modelId
}

export function isAutoShortSeparationPreset(value: unknown): value is AutoShortSeparationPreset {
  return value === 'fast' || value === 'balanced' || value === 'quality'
}
