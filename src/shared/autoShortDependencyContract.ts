import type { AutoShortConfig, AutoShortDependencyConfig } from './types'
import { isAutoShortSeparationPreset } from './autoShortSeparation'

export function parseAutoShortDependencyConfig(raw: unknown): AutoShortDependencyConfig {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Yêu cầu kiểm tra dependency Auto Short không hợp lệ.')
    }
    const r = raw as Record<string, unknown>
    if (typeof r.subtitleMethod !== 'string' || typeof r.whisperModel !== 'string') {
      throw new Error('Yêu cầu kiểm tra dependency Auto Short không hợp lệ.')
    }
    if (r.audioMode !== undefined && r.audioMode !== 'replace' && r.audioMode !== 'mix' && r.audioMode !== 'separate-vocals') {
      throw new Error('Chế độ âm thanh không hợp lệ.')
    }
    if (r.separationPreset !== undefined && !isAutoShortSeparationPreset(r.separationPreset)) {
      throw new Error('Chất lượng tách thoại không hợp lệ.')
    }
    if (r.blurMode !== undefined && r.blurMode !== 'manual' && r.blurMode !== 'ocr-auto' && r.blurMode !== 'sttn' && r.blurMode !== 'sttn-region') {
      throw new Error('Chế độ làm mờ không hợp lệ.')
    }
    if (r.ocrBlurProfile !== undefined && r.ocrBlurProfile !== 'accurate' && r.ocrBlurProfile !== 'fast') {
      throw new Error('Hồ sơ quét OCR không hợp lệ.')
    }
    if (
      'modelUrl' in r ||
      'modelPath' in r ||
      'enginePath' in r ||
      'providerOverride' in r ||
      'provider' in r ||
      'timedOcrBlurMask' in r ||
      'maskPath' in r ||
      'visualTimeline' in r ||
      'visualCuesPath' in r
    ) {
      throw new Error('Yêu cầu chứa tham số không được phép.')
    }
    return {
      subtitleMethod: r.subtitleMethod as AutoShortConfig['subtitleMethod'],
      whisperModel: r.whisperModel as AutoShortConfig['whisperModel'],
      whisperDevice: (r.whisperDevice as AutoShortConfig['whisperDevice']) || 'cpu',
      lamMo: typeof r.lamMo === 'boolean' ? r.lamMo : false,
      blurMode: (r.blurMode as AutoShortConfig['blurMode']) || 'manual',
      ocrBlurProfile: (r.ocrBlurProfile as AutoShortConfig['ocrBlurProfile']) || 'accurate',
      audioMode: (r.audioMode as AutoShortConfig['audioMode']) || 'replace',
      separationPreset: r.separationPreset as AutoShortConfig['separationPreset']
    }
  }

