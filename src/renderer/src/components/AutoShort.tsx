import type { JSX } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_AI_SERVER_URL,
  DICH_LANGS,
  type AutoShortAudioMode,
  type AutoShortSeparationPreset,
  type AutoShortBlurMode,
  type AutoShortOcrBlurProfile,
  type AutoShortSubtitlePlacementMode,
  type AutoShortConfig,
  type AutoShortBlurRegion,
  type AutoShortNormalizedRegion,
  type AutoShortBackgroundMusicConfig,
  type AutoShortBackgroundMusicMode,
  type AutoShortDependencyProgress,
  type AutoShortSttnPreviewProgress,
  type AutoShortReadiness,
  type AutoShortEvent,
  type AutoShortSubtitleMethod,
  type AutoShortTaskItem,
  type AutoShortMusicTrack,
  type BlurRegion,
  type BurnFontEntry,
  type ClonedVoice,
  type DichProvider,
  type SubtitleDisplayStyle,
  type SubtitleLayoutProfile,
  type TtsModelInfo,
  type VideoSeoOptions,
  type VideoAdjustments,
  type TtsProvider,
  type EdgeVoiceDefinition,
  type WhisperDevice
} from '../../../shared/types'
import { DEFAULT_VIDEO_SEO_OPTIONS } from '../../../shared/videoSeo'
import { translationGuidanceError, type TranslationGuidance } from '../../../shared/translation'
import { isAutomaticOcrProcessing, isSttnRemoval, normalizeAutoShortBlurMode, normalizeAutoShortOcrBlurProfile } from '../../../shared/autoShortOcrBlur'
import { effectiveAutoShortSubtitlePlacementMode } from '../../../shared/autoShortSubtitlePlacement'
import { createAutoShortMusicAssignments } from '../../../shared/autoShortBackgroundMusic'
import { localMediaSource } from '../lib/localMedia'
import { useTabOutputDir } from '../lib/outputDir'
import { usePersistedState } from '../lib/persist'
import { fitVideoInBounds } from '../lib/videoGeometry'
import { portraitFrame } from '../../../shared/portraitFrame'
import { PortraitBlurButton, PortraitFramePreview } from './PortraitFramePreview'
import VideoAdjustmentsControl from './VideoAdjustmentsControl'
import { DEFAULT_VIDEO_ADJUSTMENTS, normalizeVideoAdjustments, videoAdjustmentPreviewStyle } from '../../../shared/videoAdjustments'
import { useVideoTransport } from '../hooks/useVideoTransport'
import { runLatestAutoShortMusicFolderRequest } from '../lib/latestAutoShortMusicFolderRequest'
import { createAutoShortProgressCoalescer } from '../lib/autoshortProgressCoalescer'
import { resumeCandidateIds, type BatchSnapshot } from '../../../shared/autoShortBatchJournal'
import {
  autoShortNormalizedRegionToPixels,
  clampAutoShortNormalizedRegion,
  pixelRegionToAutoShortNormalized,
  referencePixelsFromVideoHeight,
  videoPixelsFromReferenceHeight
} from '../../../shared/autoShortRegionGeometry'
import RegionBox, { type Region } from './RegionBox'
import VideoTitleSettings from './VideoTitleSettings'
import GeminiKeys from './GeminiKeys'
import VideoSeoResult from './VideoSeoResult'
import AutoShortCutPanel from './AutoShortCutPanel'
import AutoShortOverlayControl from './AutoShortOverlayControl'
import AutoShortOverlayPreview from './AutoShortOverlayPreview'
import { normalizeAutoShortOverlays, type AutoShortOverlays } from '../../../shared/autoShortOverlays'
import { MICROSECONDS_PER_SECOND } from '../../../shared/autoShortTemporalEdit'
import { compatibleEdgeVoices, resolveEdgeVoice } from '../../../shared/edgeTtsContract'

const PALETTE = [
  '#e8a13c',
  '#3b82f6',
  '#10b981',
  '#ec4899',
  '#8b5cf6',
  '#f59e0b',
  '#06b6d4',
  '#a855f7'
]

const TRANSLATE_LANGS = [
  { code: 'none', label: 'Không dịch (Giữ nguyên)' },
  ...DICH_LANGS
]

const SOURCE_LANGS = [
  { code: 'auto', label: 'Tự động (Whisper)' },
  ...DICH_LANGS
]

const SEPARATION_MESSAGES = {
  extracting: 'Đang trích audio',
  separating: 'Đang tách thoại',
  cpuRetry: 'Đang thử lại bằng CPU',
  mixing: 'Đang trộn TTS'
} as const

const baseName = (path: string): string => path.split(/[\\/]/).pop() || path

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const minutes = Math.floor(safe / 60)
  const secs = Math.floor(safe % 60)
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return 'dung lượng chưa xác định'
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  return `${Math.ceil(bytes / 1_000_000)} MB`
}

function normalizeTtsLanguageCode(code: string): string {
  const value = code.trim().toLowerCase().split(/[-_]/u)[0]
  const aliases: Record<string, string> = {
    vie: 'vi',
    zho: 'zh',
    chi: 'zh',
    eng: 'en',
    jpn: 'ja',
    kor: 'ko',
    fra: 'fr',
    fre: 'fr',
    deu: 'de',
    ger: 'de',
    spa: 'es',
    rus: 'ru'
  }
  return aliases[value] || value
}

function parseTranslationGuidance(synopsis: string, glossaryText: string): { value?: TranslationGuidance; error?: string } {
  const glossary: TranslationGuidance['glossary'] = []
  for (const [index, rawLine] of glossaryText.split(/\r?\n/u).entries()) {
    const line = rawLine.trim()
    if (!line) continue
    const match = line.match(/^(.+?)\s*(?:=>|=)\s*(.+)$/u)
    if (!match) return { error: `Glossary dòng ${index + 1} cần có dạng: từ nguồn = bản dịch.` }
    glossary.push({ source: match[1]!.trim(), target: match[2]!.trim() })
  }
  const value: TranslationGuidance = { synopsis: synopsis.trim() || undefined, glossary }
  return translationGuidanceError(value) ? { error: translationGuidanceError(value)! } : { value }
}

const SUBTITLE_STYLE_REFERENCE_HEIGHT = 1920

function defaultSubtitleRegion(width: number, height: number): AutoShortNormalizedRegion {
  const portrait = height > width
  return {
    x0: 0.08,
    x1: 0.92,
    y0: portrait ? 0.78 : 0.80,
    y1: portrait ? 0.90 : 0.92
  }
}

function defaultOcrRegion(width: number, height: number): AutoShortNormalizedRegion {
  const portrait = height > width
  return {
    x0: 0,
    x1: 1,
    y0: portrait ? 0.72 : 0.74,
    y1: portrait ? 0.92 : 0.94
  }
}

interface PreviewStageSize {
  width: number
  height: number
}

type EditorTool = 'subtitle' | 'blur' | 'audio' | 'queue'
type FontLoadState = 'idle' | 'loading' | 'ready' | 'error'

export default function AutoShort(): JSX.Element {
  const [outputDir, setOutputDir] = useTabOutputDir('tblao.outputDir.autoshort')

  // Danh sách video hàng đợi
  const [tasks, setTasks] = usePersistedState<AutoShortTaskItem[]>('tblao.autoshort.tasks', [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedTask = useMemo(() => {
    return tasks.find((t) => t.id === selectedId) || tasks[0] || null
  }, [tasks, selectedId])
  // Preview remains the selected source; the exported artifact is verified and
  // opened explicitly after render instead of silently replacing the preview.
  const previewPath = selectedTask?.filePath || null

  // Tab công cụ Inspector
  const [tool, setTool] = useState<EditorTool>('subtitle')

  // Trạng thái Video Preview & Bounding Box
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stageShellRef = useRef<HTMLDivElement | null>(null)
  const previewPanelRef = useRef<HTMLElement | null>(null)
  const previewPathRef = useRef<string | null>(previewPath)

  const [videoH, setVideoH] = useState(0)
  const [portraitBlur, setPortraitBlur] = usePersistedState('tblao.autoshort.portraitBlur', false)
  const [overlaySettings, setOverlaySettings] = usePersistedState<AutoShortOverlays>('tblao.autoshort.overlays.v1', {})
  const overlayState = useMemo(() => {
    try { return { value: normalizeAutoShortOverlays(overlaySettings, true) || {}, error: '' } }
    catch { return { value: {} as AutoShortOverlays, error: 'Cấu hình ảnh/chữ đã lưu không hợp lệ. Bấm bỏ toàn bộ ảnh/chữ rồi chọn lại.' } }
  }, [overlaySettings])
  const [videoAdjustments, setVideoAdjustments] = usePersistedState<VideoAdjustments>(
    'tblao.autoshort.videoAdjustments.v1',
    { ...DEFAULT_VIDEO_ADJUSTMENTS }
  )
  const normalizedVideoAdjustments = useMemo(() => {
    try {
      return normalizeVideoAdjustments(videoAdjustments)
    } catch {
      return { ...DEFAULT_VIDEO_ADJUSTMENTS }
    }
  }, [videoAdjustments])
  const adjustmentPreviewStyle = useMemo(
    () => videoAdjustmentPreviewStyle(normalizedVideoAdjustments),
    [normalizedVideoAdjustments]
  )
  const [videoW, setVideoW] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [boxH, setBoxH] = useState(0)
  const [boxW, setBoxW] = useState(0)
  const [previewStageSize, setPreviewStageSize] = useState<PreviewStageSize>({ width: 0, height: 0 })
  const [isStageFullscreen, setIsStageFullscreen] = useState(false)
  const [showCutPanel, setShowCutPanel] = useState(false)

  // Transport hook
  const transport = useVideoTransport(videoRef, previewPath)

  // Subtitle Region & Styles
  const [subtitleRegion, setSubtitleRegion] = useState<AutoShortNormalizedRegion | undefined>()
  // OCR source region is independent from the output subtitle safe-area.
  const [ocrRegion, setOcrRegion] = useState<AutoShortNormalizedRegion | undefined>()
  const [fontId, setFontId] = usePersistedState('tblao.autoshort.fontId', 'auto')
  const [fonts, setFonts] = useState<BurnFontEntry[]>([])
  const [fontsLoaded, setFontsLoaded] = useState(false)
  const [previewFontFamily, setPreviewFontFamily] = useState('')
  const [fontLoadState, setFontLoadState] = useState<FontLoadState>('idle')
  const [fontMessage, setFontMessage] = useState('')
  const [fontSize, setFontSize] = usePersistedState<number>('tblao.autoshort.fontSize', 0)
  const [textColor, setTextColor] = usePersistedState('tblao.autoshort.textColor', '#ffffff')
  const [outlineColor, setOutlineColor] = usePersistedState('tblao.autoshort.outlineColor', '#000000')
  const [outlinePx, setOutlinePx] = usePersistedState('tblao.autoshort.outlinePx', 2)
  const [subtitleStyleScaleVersion, setSubtitleStyleScaleVersion] = usePersistedState(
    'tblao.autoshort.subtitleStyleScaleVersion',
    1
  )
  const [bgEnabled, setBgEnabled] = usePersistedState('tblao.autoshort.bgEnabled', false)
  const [bgColor, setBgColor] = usePersistedState('tblao.autoshort.bgColor', '#000000')
  const [bgOpacity, setBgOpacity] = usePersistedState('tblao.autoshort.bgOpacity', 60)
  const [displayStyle, setDisplayStyle] = usePersistedState<SubtitleDisplayStyle>(
    'tblao.autoshort.displayStyle',
    'standard'
  )
  const [highlightColor, setHighlightColor] = usePersistedState('tblao.autoshort.highlightColor', '#43e7d5')
  const [highlightPop, setHighlightPop] = usePersistedState('tblao.autoshort.highlightPop', true)
  const [layoutProfile, setLayoutProfile] = usePersistedState<SubtitleLayoutProfile>(
    'tblao.autoshort.layoutProfile',
    'readable'
  )
  const [autoOptimize, setAutoOptimize] = usePersistedState('tblao.autoshort.autoOptimize', true)
  const [showSafeArea, setShowSafeArea] = usePersistedState('tblao.autoshort.showSafeArea', true)

  // Subtitle Extraction & AI Translation
  const [subtitleMethod, setSubtitleMethod] = usePersistedState<AutoShortSubtitleMethod>(
    'tblao.autoshort.method',
    'whisper'
  )
  const [whisperDevice, setWhisperDevice] = usePersistedState<WhisperDevice>('tblao.autoshort.whisperDevice', 'cpu')
  const [whisperModel, setWhisperModel] = usePersistedState('tblao.autoshort.whModel', 'base')
  const selectedWhisperModel = whisperModel === 'small' || whisperModel === 'medium' ? whisperModel : 'base'
  const [whisperLanguage, setWhisperLanguage] = usePersistedState('tblao.autoshort.whisperLanguage', 'auto')
  const [translateTarget, setTranslateTarget] = usePersistedState('tblao.autoshort.transLang', 'none')
  const [titleEnabled, setTitleEnabled] = usePersistedState('tblao.autoshort.videoTitle', false)
  const [titleProvider, setTitleProvider] = usePersistedState<DichProvider>('tblao.videoTitle.provider', 'gemini')
  const [titleServerUrl, setTitleServerUrl] = usePersistedState('tblao.videoTitle.serverUrl', DEFAULT_AI_SERVER_URL)
  const [titleLanguage, setTitleLanguage] = usePersistedState('tblao.autoshort.videoSeoLanguage', 'auto')
  const [titleSeoOptions, setTitleSeoOptions] = usePersistedState<VideoSeoOptions>('tblao.videoSeo.options.v1', { ...DEFAULT_VIDEO_SEO_OPTIONS })
  const [translateProvider, setTranslateProvider] = usePersistedState<DichProvider>(
    'tblao.autoshort.transProvider',
    'local'
  )
  const [translationSynopsis, setTranslationSynopsis] = usePersistedState('tblao.autoshort.translationSynopsis', '')
  const [translationGlossaryText, setTranslationGlossaryText] = usePersistedState('tblao.autoshort.translationGlossary', '')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [keyTesting, setKeyTesting] = useState(false)
  const [keyFeedback, setKeyFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [showKeyText, setShowKeyText] = useState(false)

  // Blur Regions
  const [blurEnabled, setBlurEnabled] = useState(true)
  const [blurModeRaw, setBlurModeRaw] = usePersistedState<AutoShortBlurMode>(
    'tblao.autoshort.blurMode',
    'manual'
  )
  const [ocrBlurProfileRaw, setOcrBlurProfileRaw] = usePersistedState<AutoShortOcrBlurProfile>(
    'tblao.autoshort.ocrBlurProfile',
    'accurate'
  )
  const [subtitlePlacementMode, setSubtitlePlacementMode] = usePersistedState<AutoShortSubtitlePlacementMode>(
    'tblao.autoshort.subtitlePlacementMode',
    'manual'
  )
  const blurMode = normalizeAutoShortBlurMode(blurModeRaw)
  const ocrBlurProfile = normalizeAutoShortOcrBlurProfile(ocrBlurProfileRaw)

  useEffect(() => {
    if (blurModeRaw !== blurMode) setBlurModeRaw(blurMode)
    if (ocrBlurProfileRaw !== ocrBlurProfile) setOcrBlurProfileRaw(ocrBlurProfile)
  }, [blurMode, blurModeRaw, ocrBlurProfile, ocrBlurProfileRaw, setBlurModeRaw, setOcrBlurProfileRaw])

  const [blurRegions, setBlurRegions] = useState<AutoShortBlurRegion[]>([])
  const [activeBlurId, setActiveBlurId] = useState<string | null>(null)

  const automaticProcessing = isAutomaticOcrProcessing({ lamMo: blurEnabled, blurMode })
  const effectiveSubtitlePlacementMode = effectiveAutoShortSubtitlePlacementMode(
    subtitlePlacementMode,
    automaticProcessing
  )
  const sttnRemoval = isSttnRemoval({ lamMo: blurEnabled, blurMode })
  const subtitleUsesOcr = subtitleMethod === 'ocr' || subtitleMethod === 'whisper-ocr'
  const subtitlePixelRegion = useMemo(
    () => subtitleRegion ? autoShortNormalizedRegionToPixels(subtitleRegion, videoW, videoH) : null,
    [subtitleRegion, videoH, videoW]
  )
  const ocrPixelRegion = useMemo(
    () => ocrRegion ? autoShortNormalizedRegionToPixels(ocrRegion, videoW, videoH) : null,
    [ocrRegion, videoH, videoW]
  )
  const blurPixelRegions = useMemo<BlurRegion[]>(
    () => blurRegions.flatMap((region) => {
      const pixels = autoShortNormalizedRegionToPixels(region, videoW, videoH)
      return pixels ? [{ ...pixels, id: region.id, color: region.color }] : []
    }),
    [blurRegions, videoH, videoW]
  )
  const visibleManualBlurRegions = blurEnabled && blurMode === 'manual' ? blurPixelRegions : []
  const showOcrScanRegion = subtitleUsesOcr || automaticProcessing

  useLayoutEffect(() => {
    previewPathRef.current = previewPath
    setVideoW(0)
    setVideoH(0)
    setVideoDuration(0)
    setCurrentTime(0)
    setPreviewStageSize({ width: 0, height: 0 })
  }, [previewPath])

  useEffect(() => {
    if (videoH <= 0 || subtitleStyleScaleVersion >= 2) return
    setFontSize((current) => current > 0
      ? Math.round(referencePixelsFromVideoHeight(current, videoH, SUBTITLE_STYLE_REFERENCE_HEIGHT))
      : current)
    setOutlinePx((current) => Math.round(
      referencePixelsFromVideoHeight(current, videoH, SUBTITLE_STYLE_REFERENCE_HEIGHT) * 2
    ) / 2)
    setSubtitleStyleScaleVersion(2)
  }, [
    setFontSize,
    setOutlinePx,
    setSubtitleStyleScaleVersion,
    subtitleStyleScaleVersion,
    videoH
  ])


  // TTS AI Voice
  const [ttsEnabled, setTtsEnabled] = usePersistedState('tblao.autoshort.ttsEnabled', true)
  const [ttsProvider, setTtsProvider] = usePersistedState<TtsProvider>('tblao.autoshort.ttsProvider', 'local-tts')
  const [ttsServerUrl, setTtsServerUrl] = usePersistedState('tblao.ai.serverUrl', DEFAULT_AI_SERVER_URL)
  const [ttsModel, setTtsModel] = usePersistedState('tblao.autoshort.ttsModel', '')
  const [ttsVoice, setTtsVoice] = usePersistedState('tblao.autoshort.ttsVoice', '')
  const [edgeVoice, setEdgeVoice] = usePersistedState('tblao.autoshort.edgeVoice', 'vi-VN-HoaiMyNeural')
  const [ttsSpeed, setTtsSpeed] = usePersistedState('tblao.autoshort.ttsSpeed', 1.0)
  const [paceMode, setPaceMode] = usePersistedState<'source-adaptive' | 'fixed'>('tblao.autoshort.paceMode', 'source-adaptive')
  const [clonedVoices] = usePersistedState<ClonedVoice[]>('tblao.tts.clonedVoices', [])
  const [serverOnline, setServerOnline] = useState<boolean | null>(null)
  const [ttsModels, setTtsModels] = useState<TtsModelInfo[]>([])
  const [voiceOverMode, setVoiceOverMode] = usePersistedState('tblao.autoshort.voiceOverMode', false)
  const [audioMode, setAudioMode] = usePersistedState<AutoShortAudioMode>('tblao.autoshort.audioMode', 'replace')
  const [separationPreset, setSeparationPreset] = usePersistedState<AutoShortSeparationPreset>('tblao.autoshort.separationPreset', 'balanced')
  const [originalAudioVolume, setOriginalAudioVolume] = usePersistedState('tblao.autoshort.origVol', 20)
  const [backgroundMusicEnabled, setBackgroundMusicEnabled] = usePersistedState('tblao.autoshort.bgMusic.enabled', false)
  const [backgroundMusicFolder, setBackgroundMusicFolder] = usePersistedState('tblao.autoshort.bgMusic.folder', '')
  const [backgroundMusicMode, setBackgroundMusicMode] = usePersistedState<AutoShortBackgroundMusicMode>('tblao.autoshort.bgMusic.mode', 'single')
  const [backgroundMusicVolume, setBackgroundMusicVolume] = usePersistedState('tblao.autoshort.bgMusic.volume', 15)
  const [backgroundMusicSingleTrack, setBackgroundMusicSingleTrack] = usePersistedState('tblao.autoshort.bgMusic.singleTrack', '')
  const [backgroundMusicTracks, setBackgroundMusicTracks] = useState<AutoShortMusicTrack[]>([])
  const [backgroundMusicAssignments, setBackgroundMusicAssignments] = useState<Record<string, string>>({})
  const [backgroundMusicError, setBackgroundMusicError] = useState<string | null>(null)
  const backgroundMusicScanTokenRef = useRef(0)
  const backgroundMusicScanFolderRef = useRef('')
  const [edgeVoices, setEdgeVoices] = useState<EdgeVoiceDefinition[]>([])
  const [edgeCatalogSource, setEdgeCatalogSource] = useState<'checking' | 'live' | 'fallback'>('checking')
  const [edgeCatalogError, setEdgeCatalogError] = useState<string | null>(null)

  useEffect(() => {
    if (ttsProvider !== 'edge-tts') return
    let isCancelled = false
    setEdgeCatalogSource('checking')
    setEdgeCatalogError(null)
    window.api
      .ttsGetEdgeVoices()
      .then((catalog) => {
        if (!isCancelled && catalog.voices.length > 0) {
          setEdgeVoices(catalog.voices)
          setEdgeCatalogSource(catalog.source)
          setEdgeCatalogError(catalog.error || null)
        }
      })
      .catch((reason: unknown) => {
        if (!isCancelled) {
          setEdgeCatalogSource('fallback')
          setEdgeCatalogError(reason instanceof Error ? reason.message : String(reason))
        }
      })
    return () => {
      isCancelled = true
    }
  }, [ttsProvider])

  useEffect(() => {
    if (ttsProvider !== 'edge-tts' || edgeVoices.length === 0) return
    const language = translateTarget !== 'none' ? translateTarget : whisperLanguage.trim()
    if (!language || language === 'auto') return
    try {
      resolveEdgeVoice(edgeVoices, language, edgeVoice)
    } catch {
      try {
        setEdgeVoice(resolveEdgeVoice(edgeVoices, language).id)
      } catch {
        // Preflight surfaces unsupported languages before starting the batch.
      }
    }
  }, [edgeVoice, edgeVoices, setEdgeVoice, translateTarget, ttsProvider, whisperLanguage])
  const edgeLanguage = translateTarget !== 'none' ? translateTarget : whisperLanguage.trim()
  const selectableEdgeVoices = edgeLanguage && edgeLanguage !== 'auto'
    ? compatibleEdgeVoices(edgeVoices, edgeLanguage)
    : edgeVoices

  const selectedModelInfo = ttsModels.find((m) => m.id === ttsModel) || ttsModels[0]
  const modelVoices = selectedModelInfo?.voices || []
  const defaultVoice = selectedModelInfo?.default_voice || (modelVoices[0] || 'default')

  useEffect(() => {
    if (!ttsEnabled && audioMode === 'separate-vocals') {
      setAudioMode('replace')
    }
  }, [ttsEnabled, audioMode, setAudioMode])

  useEffect(() => {
    let active = true
    const folderPath = backgroundMusicFolder
    const scanToken = ++backgroundMusicScanTokenRef.current
    backgroundMusicScanFolderRef.current = folderPath
    if (!folderPath) return
    void window.api.autoShortListMusicTracks(folderPath).then((result) => {
      if (!active || backgroundMusicScanTokenRef.current !== scanToken || backgroundMusicScanFolderRef.current !== folderPath) return
      if (result.ok) {
        setBackgroundMusicTracks(result.tracks)
        setBackgroundMusicError(result.tracks.length === 0 ? 'Folder nhạc không có file âm thanh được hỗ trợ.' : null)
        if (!result.tracks.some((track) => track.path === backgroundMusicSingleTrack)) {
          setBackgroundMusicSingleTrack(result.tracks[0]?.path || '')
        }
      } else {
        setBackgroundMusicTracks([])
        setBackgroundMusicError(result.error)
      }
    }).catch(() => {
      if (!active || backgroundMusicScanTokenRef.current !== scanToken || backgroundMusicScanFolderRef.current !== folderPath) return
      setBackgroundMusicError('Không thể quét folder nhạc.')
    })
    return () => {
      active = false
    }
  }, [backgroundMusicFolder])

  useEffect(() => {
    const taskIds = new Set(tasks.map((task) => task.id))
    setBackgroundMusicAssignments((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => taskIds.has(id)))
      return Object.keys(next).length === Object.keys(current).length ? current : next
    })
  }, [tasks])

  // Dynamic AI server connection & model capability loading
  useEffect(() => {
    let isCancelled = false
    const loadAiCapabilities = async (): Promise<void> => {
      const cleanUrl = (ttsServerUrl || DEFAULT_AI_SERVER_URL).trim()
      if (!cleanUrl) {
        setServerOnline(false)
        setTtsModels([])
        return
      }
      try {
        const health = await window.api.ttsCheckHealth(cleanUrl)
        if (isCancelled) return
        setServerOnline(health.ok)
        if (health.ok) {
          const res = await window.api.ttsGetModels(cleanUrl)
          if (isCancelled) return
          if (res.ok && res.models.length > 0) {
            const availableTts = res.models.filter(
              (m) =>
                m.provider !== 'ollama' &&
                (m.languages?.length ||
                  m.voices?.length ||
                  m.supports_named_voice ||
                  m.supports_voice_clone ||
                  m.id.startsWith('tts') ||
                  m.provider === 'vieneu' ||
                  m.provider === 'chatterbox' ||
                  m.logical_model?.startsWith('tts'))
            )
            const requestedLanguage = normalizeTtsLanguageCode(
              translateTarget !== 'none' ? translateTarget : whisperLanguage
            )
            const compatibleTts = requestedLanguage && requestedLanguage !== 'auto'
              ? availableTts.filter((model) => {
                const languages = model.languages || []
                return languages.length === 0 || languages.some((language) => normalizeTtsLanguageCode(language) === requestedLanguage)
              })
              : availableTts
            const selectableTts = compatibleTts.length > 0 ? compatibleTts : availableTts
            setTtsModels(selectableTts)
            const matching = selectableTts.find((m) => m.id === ttsModel)
            if (!matching && selectableTts.length > 0) {
              const fallback = selectableTts.find((m) => m.available !== false) || selectableTts[0]
              setTtsModel(fallback.id)
              const fallbackVoice = fallback.default_voice || fallback.voices?.[0] || 'default'
              if (!ttsVoice.startsWith('clone:')) {
                setTtsVoice(fallbackVoice)
              }
            }
          }
        } else {
          setTtsModels([])
        }
      } catch {
        if (!isCancelled) {
          setServerOnline(false)
          setTtsModels([])
        }
      }
    }
    void loadAiCapabilities()
    return () => {
      isCancelled = true
    }
  }, [ttsServerUrl, translateTarget, whisperLanguage])

  // Batch Execution State
  const [isRunning, setIsRunning] = useState(false)
  // An explicit translation retry is scoped to the items the user prepared;
  // it must never silently reset and re-run already completed videos.
  const [retryPendingIdList, setRetryPendingIdList] = usePersistedState<string[]>('tblao.autoshort.retryPendingIds', [])
  const retryPendingIds = useMemo(() => new Set(retryPendingIdList), [retryPendingIdList])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [resumeSnapshot, setResumeSnapshot] = useState<BatchSnapshot | null>(null)
  const [overallProgress, setOverallProgress] = useState<{ current: number; total: number; message: string }>({
    current: 0,
    total: 0,
    message: ''
  })
  const [readiness, setReadiness] = useState<AutoShortReadiness | null>(null)
  const [showDependencyModal, setShowDependencyModal] = useState(false)
  const [dependencyInstalling, setDependencyInstalling] = useState(false)
  const [dependencyError, setDependencyError] = useState<string | null>(null)
  const [dependencyProgress, setDependencyProgress] = useState<Record<string, AutoShortDependencyProgress>>({})
  const [dependencyAction, setDependencyAction] = useState<'batch' | 'preview'>('batch')
  const [sttnPreviewRunning, setSttnPreviewRunning] = useState(false)
  const sttnPreviewToken = useRef(0)
  const [sttnPreviewProgress, setSttnPreviewProgress] = useState<AutoShortSttnPreviewProgress | null>(null)
  const [sttnPreviewPath, setSttnPreviewPath] = useState<string | null>(null)

  useEffect(() => {
    ++sttnPreviewToken.current
    setSttnPreviewPath(null)
    if (!sttnPreviewRunning) return
    setSttnPreviewRunning(false)
    setSttnPreviewProgress({ percent: 0, message: 'Đã hủy xem thử STTN vì đã đổi video.' })
    void window.api.autoShortCancelSttnPreview().catch(() => undefined)
  }, [previewPath])
  const [cacheAction, setCacheAction] = useState(false)

  useEffect(() => {
    let disposed = false
    void window.api.autoShortGetBatch().then((result) => {
      if (disposed || !result.ok || !result.snapshot) return
      const candidateIds = new Set(resumeCandidateIds(result.snapshot))
      if (candidateIds.size === 0) return
      setResumeSnapshot(result.snapshot)
      setTasks((current) => {
        const byId = new Map(current.map((item) => [item.id, item]))
        return result.snapshot!.items.sort((left, right) => left.ordinal - right.ordinal).map((record) => {
          const existing = byId.get(record.itemId)
          if (existing) return { ...existing, temporalEdit: record.temporalEdit }
          const fileName = record.inputPath.split(/[\\/]/u).pop() || record.inputPath
          return {
            id: record.itemId,
            filePath: record.inputPath,
            fileName,
            temporalEdit: record.temporalEdit,
            status: record.state === 'succeeded' ? 'done' : record.state === 'cancelled' ? 'cancelled' : record.state === 'failed' || record.state === 'needs-review' ? 'error' : 'queued',
            percent: record.state === 'succeeded' ? 100 : 0,
            outputPath: record.outputReceipt?.path,
            error: record.failure?.message,
            currentStepMessage: candidateIds.has(record.itemId) ? 'Có thể tiếp tục từ checkpoint.' : undefined
          }
        })
      })
      setOverallProgress((current) => ({ ...current, message: `Đã tìm thấy batch dở dang: còn ${candidateIds.size} video.` }))
    }).catch(() => undefined)
    return () => { disposed = true }
  }, [])

  const applyItemResult = useCallback((event: AutoShortEvent): void => {
    if (event.type === 'item-progress') {
      setTasks((prev) => prev.map((item) => item.id === event.itemId ? {
        ...item,
        status: event.itemStatus,
        percent: event.itemStatus === 'done' ? 100 : Math.max(item.percent || 0, event.itemPercent),
        currentStepMessage: event.stageInfo?.waitReason ? `${event.itemMessage} (${event.stageInfo.waitReason})` : event.itemMessage,
        outputPath: event.outputPath || item.outputPath,
        error: event.itemStatus === 'queued' ? undefined : event.error || item.error,
        translationAssessment: event.translationAssessment || item.translationAssessment,
        translationIdentity: event.translationIdentity || item.translationIdentity
      } : item))
      setOverallProgress({
        current: event.batchIndex,
        total: event.batchTotal,
        message: `[${event.batchIndex}/${event.batchTotal}] ${event.itemMessage}`
      })
      return
    }
    if (event.type === 'item-done' || event.type === 'item-error' || event.type === 'item-cancelled') {
      const result = event.result
      setTasks((prev) => prev.map((item) => item.id === result.itemId ? {
        ...item,
        status: result.status,
        percent: result.status === 'done' ? 100 : item.percent,
        currentStepMessage: result.status === 'done'
          ? result.titleError ? 'Video đã xuất, chưa tạo được tiêu đề' : result.titlePath ? 'Đã xuất video và tieude.txt' : 'Hoàn tất xuất video'
          : result.error || (result.status === 'cancelled' ? 'Đã hủy tác vụ' : 'Xử lý thất bại'),
        outputPath: result.outputPath || item.outputPath,
        artifactDir: result.artifactDir || item.artifactDir,
        error: result.error,
        extractedCueCount: result.extractedCueCount,
        translatedCueCount: result.translatedCueCount,
        generatedVoiceCount: result.generatedVoiceCount,
        voice: result.voice,
        title: result.title,
        titlePath: result.titlePath,
        titleError: result.titleError,
        seoMetadata: result.seoMetadata,
        translationAssessment: result.translationAssessment,
        translationIdentity: result.translationIdentity,
        recovery: result.recovery
      } : item))
      return
    }
    if (event.type !== 'batch-done') return
    setOverallProgress({
      current: event.totalCount,
      total: event.totalCount,
      message: event.cancelledCount > 0
        ? `Đã dừng: ${event.completedCount}/${event.totalCount} video hoàn tất`
        : `Đã xử lý ${event.completedCount}/${event.totalCount} video${event.needsReviewCount ? ` · ${event.needsReviewCount} cần kiểm tra` : ''}`
    })
    setIsRunning(false)
    setActiveJobId(null)
  }, [])

  // Load font list
  const refreshFonts = async (): Promise<void> => {
    try {
      const list = await window.api.listBurnFonts()
      setFonts(list)
    } catch {
      setFontLoadState('error')
    } finally {
      setFontsLoaded(true)
    }
  }

  useEffect(() => {
    void refreshFonts()
  }, [])

  // A renderer restart cannot have a live job attached. Mark interrupted
  // transient states idle while preserving done/error/review evidence stored
  // in localStorage; an explicitly persisted retry selection remains queued.
  useEffect(() => {
    const transient = new Set<AutoShortTaskItem['status']>([
      'queued', 'extracting_sub', 'removing_subtitles', 'translating',
      'separating_audio', 'generating_tts', 'stitching_audio',
      'rendering_video'
    ])
    setTasks((prev) => {
      let changed = false
      const next = prev.map((task) => {
        if (!transient.has(task.status)) return task
        changed = true
        return { ...task, status: 'idle' as const, currentStepMessage: 'Sẵn sàng (phiên trước đã dừng).' }
      })
      return changed ? next : prev
    })
  }, [])

  // Check stored API key
  useEffect(() => {
    let active = true
    setApiKeyInput('')
    setKeyFeedback(null)
    void window.api.translateHasKey(translateProvider).then((has) => {
      if (active) setHasStoredKey(has)
    })
    return () => {
      active = false
    }
  }, [translateProvider])

  useEffect(() => {
    if (!selectedModelInfo) return
    if (!ttsVoice.startsWith('clone:') && !modelVoices.includes(ttsVoice) && ttsVoice !== defaultVoice) {
      setTtsVoice(defaultVoice)
    }
  }, [selectedModelInfo?.id])

  // Lắng nghe event discriminated union của job hiện tại.
  useEffect(() => {
    const coalescer = createAutoShortProgressCoalescer((event) => applyItemResult(event), 10)
    const unsub = window.api.onAutoShortEvent((event: AutoShortEvent) => {
      if (!activeJobId || event.jobId !== activeJobId) return
      coalescer.push(event)
    })
    return () => {
      coalescer.dispose()
      unsub()
    }
  }, [activeJobId, applyItemResult])

  const refreshAutoShortReadiness = useCallback(async (preview = false): Promise<AutoShortReadiness | null> => {
    try {
      const next = await window.api.autoShortGetReadiness({
        subtitleMethod: preview ? 'ocr' : subtitleMethod,
        whisperModel: selectedWhisperModel,
        whisperDevice,
        lamMo: blurEnabled,
        blurMode,
        ocrBlurProfile,
        audioMode: preview ? 'replace' : audioMode,
        separationPreset
      })
      setReadiness(next)
      return next
    } catch {
      setReadiness(null)
      return null
    }
  }, [selectedWhisperModel, subtitleMethod, whisperDevice, blurEnabled, blurMode, ocrBlurProfile, audioMode, separationPreset])

  useEffect(() => {
    let active = true
    void refreshAutoShortReadiness().then((status) => {
      if (active && status) {
        setReadiness(status)
      }
    })
    return () => {
      active = false
    }
  }, [refreshAutoShortReadiness])

  useEffect(() => {
    return window.api.onAutoShortDependencyProgress((progress) => {
      setDependencyProgress((previous) => ({ ...previous, [progress.id]: progress }))
    })
  }, [])

  useEffect(() => window.api.onAutoShortSttnPreviewProgress(setSttnPreviewProgress), [])

  // Font family preview loader
  useEffect(() => {
    let cancelled = false
    if (!fontsLoaded) return

    const match = fonts.find((font) => font.id === fontId && font.available !== false)
    if (fontId !== 'auto' && !match) {
      setPreviewFontFamily('')
      setFontLoadState('error')
      setFontMessage('Font đã chọn không khả dụng.')
      return
    }

    if (!match) {
      setPreviewFontFamily('')
      setFontLoadState('ready')
      setFontMessage('Tự động chọn font theo ngôn ngữ phụ đề.')
      return
    }

    setFontLoadState('loading')
    setFontMessage(`Đang tải font ${match.label}…`)

    void window.api
      .loadBurnFontData(match.id)
      .then(async (preview) => {
        if (cancelled) return
        if (!preview) {
          setFontLoadState('error')
          setFontMessage(`Không thể nạp bản xem trước của font ${match.label}.`)
          return
        }

        const familyName = `tblao-font-${match.id}`
        const face = new FontFace(familyName, preview.data)
        await face.load()
        if (cancelled) return
        document.fonts.add(face)
        setPreviewFontFamily(familyName)
        setFontLoadState('ready')
        setFontMessage(`Đang dùng: ${match.label}`)
      })
      .catch(() => {
        if (!cancelled) {
          setFontLoadState('error')
          setFontMessage(`Lỗi khi nạp font ${match.label}.`)
        }
      })

    return () => {
      cancelled = true
    }
  }, [fontId, fonts, fontsLoaded])

  const groupedFonts = useMemo(() => {
    const map = new Map<string, BurnFontEntry[]>()
    for (const font of fonts) {
      if (font.available === false) continue
      const list = map.get(font.group) || []
      list.push(font)
      map.set(font.group, list)
    }
    return Array.from(map.entries())
  }, [fonts])

  // Measure video preview stage accurately
  const measureStage = useCallback(() => {
    const shell = stageShellRef.current
    if (!shell || videoW <= 0 || videoH <= 0) return

    const shellStyle = window.getComputedStyle(shell)
    const padX = (parseFloat(shellStyle.paddingLeft) || 0) + (parseFloat(shellStyle.paddingRight) || 0)
    const padY = (parseFloat(shellStyle.paddingTop) || 0) + (parseFloat(shellStyle.paddingBottom) || 0)
    const availableW = Math.max(0, shell.clientWidth - padX)
    const availableH = Math.max(0, shell.clientHeight - padY)

    if (availableW <= 0 || availableH <= 0) return

    const frame = portraitBlur ? portraitFrame(videoW, videoH) : null
    const fitted = fitVideoInBounds(frame?.width ?? videoW, frame?.height ?? videoH, availableW, availableH)
    if (fitted) {
      setPreviewStageSize(fitted)
      setBoxW(frame ? fitted.width * frame.contentWidth / frame.width : fitted.width)
      setBoxH(frame ? fitted.height * frame.contentHeight / frame.height : fitted.height)
    }
  }, [videoH, videoW, portraitBlur])

  useLayoutEffect(() => {
    const shell = stageShellRef.current
    if (!shell) return
    measureStage()
    const observer = new ResizeObserver(() => measureStage())
    observer.observe(shell)
    window.addEventListener('resize', measureStage)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureStage)
    }
  }, [measureStage])

  // Handlers for Video Management
  const addVideoFiles = async (): Promise<void> => {
    try {
      const res = await window.api.autoShortSelectVideos()
      if (res && res.ok && Array.isArray(res.paths) && res.paths.length > 0) {
        addPaths(res.paths)
      } else if (Array.isArray(res) && res.length > 0) {
        addPaths(res)
      }
    } catch {
      // Fallback
    }
  }

  const addPaths = (paths: string[]): void => {
    const validPaths = paths.filter((p) => typeof p === 'string' && p.trim().length > 0)
    if (validPaths.length === 0) return

    const newTasks: AutoShortTaskItem[] = validPaths.map((fp) => ({
      id: crypto.randomUUID(),
      filePath: fp,
      fileName: baseName(fp),
      status: 'idle',
      percent: 0,
      currentStepMessage: 'Sẵn sàng'
    }))

    setTasks((prev) => {
      const existing = new Set(prev.map((t) => t.filePath))
      const unique = newTasks.filter((t) => !existing.has(t.filePath))
      const combined = [...prev, ...unique]
      if (!selectedId && combined.length > 0 && combined[0]) {
        setSelectedId(combined[0].id)
      }
      return combined
    })
  }

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files)
    const paths = files
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
    if (paths.length > 0) {
      addPaths(paths)
    }
  }

  const removeTask = (id: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    setTasks((prev) => prev.filter((t) => t.id !== id))
    setRetryPendingIdList((prev) => prev.filter((itemId) => itemId !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const clearAllTasks = (): void => {
    setTasks([])
    setRetryPendingIdList([])
    setSelectedId(null)
    setVideoW(0)
    setVideoH(0)
  }

  const clearAutoShortCache = async (): Promise<void> => {
    if (isRunning || cacheAction) return
    if (!window.confirm('Xóa các kết quả Auto Short có thể tái sử dụng? Video đầu ra và file đang xử lý sẽ được giữ nguyên.')) return
    setCacheAction(true)
    try {
      const result = await window.api.autoShortClearCache()
      if (!result.ok) alert(result.error || 'Không thể xóa cache Auto Short.')
    } catch {
      alert('Không thể xóa cache Auto Short.')
    } finally {
      setCacheAction(false)
    }
  }

  const chooseBackgroundMusicFolder = async (): Promise<void> => {
    let result
    try {
      result = await runLatestAutoShortMusicFolderRequest(
        backgroundMusicScanTokenRef,
        () => window.api.autoShortSelectMusicFolder()
      )
    } catch {
      setBackgroundMusicError('Không thể mở trình chọn folder nhạc.')
      return
    }
    if (!result) return
    if (!result.ok) {
      if (result.error !== 'Đã hủy chọn folder nhạc.') setBackgroundMusicError(result.error)
      return
    }
    backgroundMusicScanFolderRef.current = result.folderPath
    setBackgroundMusicFolder(result.folderPath)
    setBackgroundMusicTracks(result.tracks)
    setBackgroundMusicError(result.tracks.length === 0 ? 'Folder nhạc không có file âm thanh được hỗ trợ.' : null)
    if (!result.tracks.some((track) => track.path === backgroundMusicSingleTrack)) {
      setBackgroundMusicSingleTrack(result.tracks[0]?.path || '')
    }
    setBackgroundMusicAssignments({})
  }

  // Blur Box Helpers
  const addBlurRegion = (): void => {
    if (videoW <= 0 || videoH <= 0) return
    const portrait = videoH > videoW
    const color = PALETTE[blurRegions.length % PALETTE.length]
    const newBox: AutoShortBlurRegion = {
      id: crypto.randomUUID(),
      x0: 0.05,
      y0: portrait ? 0.78 : 0.80,
      x1: 0.95,
      y1: portrait ? 0.92 : 0.94,
      color
    }
    setBlurRegions((prev) => [...prev, newBox])
    setActiveBlurId(newBox.id)
    setBlurEnabled(true)
    setTool('blur')
  }

  const updateBlurRegion = (r: BlurRegion): void => {
    const normalized = pixelRegionToAutoShortNormalized(r, videoW, videoH)
    if (!normalized) return
    setBlurRegions((prev) => prev.map((b) => (
      b.id === r.id ? { ...normalized, id: b.id, color: b.color } : b
    )))
  }

  const removeBlurRegion = (id: string): void => {
    setBlurRegions((prev) => prev.filter((b) => b.id !== id))
    if (activeBlurId === id) setActiveBlurId(null)
  }

  const updateSubRegionClamped = (r: Region): void => {
    const normalized = pixelRegionToAutoShortNormalized(r, videoW, videoH)
    if (normalized) setSubtitleRegion(normalized)
  }

  const updateOcrRegionClamped = (r: Region): void => {
    const normalized = pixelRegionToAutoShortNormalized(r, videoW, videoH)
    if (normalized) setOcrRegion(normalized)
  }

  // API Key handlers
  const handleSaveAndTestKey = async (): Promise<void> => {
    setKeyTesting(true)
    setKeyFeedback(null)
    try {
      if (apiKeyInput.trim()) {
        await window.api.translateSaveKey(translateProvider, apiKeyInput.trim())
      }
      const res = await window.api.translateCheckKey(
        translateProvider,
        apiKeyInput.trim(),
        translateProvider === 'local' ? ttsServerUrl : undefined,
        translateTarget,
        whisperLanguage
      )
      setKeyFeedback(res)
      if (res.ok) {
        setHasStoredKey(true)
        setApiKeyInput('')
      }
    } catch {
      setKeyFeedback({ ok: false, message: 'Lỗi khi kiểm tra kết nối API Key' })
    } finally {
      setKeyTesting(false)
    }
  }

  const handleClearKey = async (): Promise<void> => {
    await window.api.translateSaveKey(translateProvider, '')
    setHasStoredKey(false)
    setApiKeyInput('')
    setKeyFeedback(null)
  }

  // Fullscreen Stage toggle
  const toggleStageFullscreen = async (): Promise<void> => {
    const panel = previewPanelRef.current
    if (!panel) return
    if (document.fullscreenElement === panel) {
      await document.exitFullscreen()
      setIsStageFullscreen(false)
    } else {
      await panel.requestFullscreen()
      setIsStageFullscreen(true)
    }
  }

  // Khởi động chạy hàng loạt Auto Short
  const startBatch = async (resume?: BatchSnapshot): Promise<void> => {
    if (tasks.length === 0 || isRunning || sttnPreviewRunning) return
    const resumeIds = resume ? new Set(resumeCandidateIds(resume)) : null
    const retryOnly = !resumeIds && retryPendingIds.size > 0
    const runnableTasks = resumeIds
      ? tasks.filter((task) => resumeIds.has(task.id))
      : retryOnly
      ? tasks.filter((task) => retryPendingIds.has(task.id))
      : tasks
    if (runnableTasks.length === 0) {
      setRetryPendingIdList([])
      return
    }
    const guidance = parseTranslationGuidance(translationSynopsis, translationGlossaryText)
    if (translateTarget !== 'none' && guidance.error) {
      alert(guidance.error)
      return
    }
    setDependencyAction('batch')
    let backgroundMusicConfig: AutoShortBackgroundMusicConfig | undefined
    if (ttsEnabled && audioMode === 'replace' && backgroundMusicEnabled) {
      const assignmentResult = createAutoShortMusicAssignments({
        mode: backgroundMusicMode,
        itemIds: runnableTasks.map((task) => task.id),
        trackPaths: backgroundMusicTracks.map((track) => track.path),
        selectedTrackPath: backgroundMusicSingleTrack,
        perVideoAssignments: backgroundMusicAssignments
      })
      if (!assignmentResult.ok) {
        alert(assignmentResult.error)
        return
      }
      backgroundMusicConfig = {
        folderPath: backgroundMusicFolder,
        mode: backgroundMusicMode,
        volume: backgroundMusicVolume,
        assignments: assignmentResult.assignments
      }
    }
    if (!outputDir) {
      alert('Vui lòng chọn thư mục lưu video đầu ra.')
      return
    }

    const sub = subtitleRegion && clampAutoShortNormalizedRegion(subtitleRegion)
    const ocr = ocrRegion && clampAutoShortNormalizedRegion(ocrRegion)
    if (!sub || !ocr) {
      alert('Chưa đọc xong kích thước video xem trước. Vui lòng chờ video hiển thị rồi thử lại.')
      return
    }
    const normalizedBlurs = blurRegions.flatMap((region) => {
      const normalized = clampAutoShortNormalizedRegion(region)
      return normalized ? [{ ...normalized, id: region.id, color: region.color }] : []
    })

    const status = await refreshAutoShortReadiness()
    if (!status || !status.ready) {
      setDependencyError(status?.message || 'Không thể kiểm tra dependency Auto Short.')
      setShowDependencyModal(true)
      return
    }

    setIsRunning(true)
    setOverallProgress({ current: 0, total: runnableTasks.length, message: retryOnly ? 'Đang khởi động lượt thử lại…' : 'Đang khởi động tiến trình hàng loạt…' })

    const runnableIds = new Set(runnableTasks.map((task) => task.id))
    setTasks((prev) => prev.map((t) => runnableIds.has(t.id) ? ({
      ...t,
      status: 'queued',
      percent: 0,
      outputPath: undefined,
      artifactDir: undefined,
      error: undefined,
      title: undefined,
      titlePath: undefined,
      titleError: undefined,
      seoMetadata: undefined,
      translationAssessment: undefined,
      translationIdentity: undefined,
      currentStepMessage: 'Đang trong hàng đợi…'
    }) : t))

    const activeClonedVoice = clonedVoices.find((cv) => `clone:${cv.id}` === ttsVoice || cv.id === ttsVoice)

    const config: AutoShortConfig = {
      portraitBlur,
      videoAdjustments: normalizedVideoAdjustments,
      ...(overlayState.error || overlayState.value.image || overlayState.value.text
        ? { overlays: overlayState.error ? overlaySettings : overlayState.value } : {}),
      subtitleMethod,
      whisperModel: selectedWhisperModel,
      whisperDevice,
      whisperLanguage: whisperLanguage.trim() || 'auto',
      ocrRegion: ocr,
      blurRegions: normalizedBlurs,
      lamMo: blurEnabled,
      blurMode,
      ocrBlurProfile,
      subRegion: sub,
      subtitlePlacementMode: effectiveSubtitlePlacementMode,
      fontId: fontId === 'auto' ? null : fontId,
      textColor,
      outlineColor,
      outlinePx: Math.min(8, outlinePx),
      bgEnabled,
      bgColor,
      bgOpacity,
      subtitleDisplayStyle: (subtitleMethod !== 'ocr' && translateTarget === 'none' && !ttsEnabled) ? displayStyle : 'standard',
      subtitleFontSize: fontSize > 0 ? fontSize : undefined,
      subtitleFontScale: fontSize > 0 ? fontSize / SUBTITLE_STYLE_REFERENCE_HEIGHT : undefined,
      highlightColor,
      subtitleHighlightPop: highlightPop,
      subtitleLayoutProfile: layoutProfile,
      subtitleAutoOptimize: autoOptimize,
      outlineScale: outlinePx / SUBTITLE_STYLE_REFERENCE_HEIGHT,
      translateTarget,
      translateProvider,
      translateServerUrl: ttsServerUrl,
      translationGuidance: translateTarget !== 'none' ? guidance.value : undefined,
      videoTitle: titleEnabled ? {
        provider: titleProvider,
        language: titleLanguage,
        serverUrl: titleProvider === 'local' ? titleServerUrl : undefined,
        seo: titleSeoOptions
      } : undefined,
      ttsEnabled,
      ...(ttsProvider === 'edge-tts' ? { ttsProvider } : {}),
      ttsServerUrl: ttsProvider === 'local-tts' ? ttsServerUrl : undefined,
      ttsModel: ttsProvider === 'edge-tts' ? 'edge-tts' : ttsModel,
      ttsVoice: ttsProvider === 'edge-tts'
        ? edgeVoice
        : (activeClonedVoice ? activeClonedVoice.name : ttsVoice),
      ttsRefAudioPath: ttsProvider === 'local-tts' && activeClonedVoice ? activeClonedVoice.referenceAudioPath : undefined,
      ttsRefTranscript: ttsProvider === 'local-tts' && activeClonedVoice ? activeClonedVoice.referenceTranscript : undefined,
      ttsLanguage: translateTarget !== 'none' ? translateTarget : whisperLanguage.trim() || undefined,
      ttsSpeed,
      paceMode,
      voiceOverMode,
      audioMode,
      separationPreset: audioMode === 'separate-vocals' ? separationPreset : undefined,
      originalAudioVolume,
      backgroundMusic: backgroundMusicConfig,
      outputDir
    }

    const started = resume
      ? await window.api.autoShortResume({ jobId: resume.jobId, expectedRevision: resume.revision, config })
      : await window.api.autoShortStart({
        config,
        items: runnableTasks.map((task) => ({ id: task.id, filePath: task.filePath,
          ...(task.temporalEdit ? { temporalEdit: task.temporalEdit } : {}) }))
      })
    if (!started.ok) {
      setIsRunning(false)
      setOverallProgress((prev) => ({ ...prev, message: started.error }))
      return
    }
    setRetryPendingIdList([])
    setResumeSnapshot(null)
    setActiveJobId(started.jobId)
  }

  const cancelBatch = async (): Promise<void> => {
    if (!activeJobId) return
    const result = await window.api.autoShortCancel(activeJobId)
    if (!result.ok) {
      setOverallProgress((prev) => ({ ...prev, message: result.error || 'Không thể dừng tác vụ' }))
    }
  }

  const prepareTranslationRetry = async (task: AutoShortTaskItem): Promise<void> => {
    if (isRunning || !task.translationIdentity) return
    const result = await window.api.autoShortRetryTranslation({
      itemId: task.id,
      expectedIdentity: task.translationIdentity
    })
    if (!result.ok) {
      setTasks((prev) => prev.map((item) => item.id === task.id ? {
        ...item,
        currentStepMessage: result.error || 'Không thể chuẩn bị lượt thử lại bản dịch.'
      } : item))
      return
    }
    setTasks((prev) => prev.map((item) => item.id === task.id ? {
      ...item,
      status: 'queued',
      percent: 0,
      error: undefined,
      translationAssessment: undefined,
      currentStepMessage: `Đã chuẩn bị lượt thử lại bản dịch #${result.generation ?? 1}; bấm Bắt đầu chạy lại để gọi provider.`
    } : item))
    setRetryPendingIdList((prev) => prev.includes(task.id) ? prev : [...prev, task.id])
  }

  const chooseOutputDir = async (): Promise<void> => {
    const dir = await window.api.chooseFolder()
    if (dir) setOutputDir(dir)
  }

  const startSttnPreview = async (): Promise<void> => {
    if (!selectedTask || !sttnRemoval || isRunning || sttnPreviewRunning) return
    const videoPathSnapshot = selectedTask.filePath
    const scan = ocrRegion && clampAutoShortNormalizedRegion(ocrRegion)
    if (!scan || videoW <= 0 || videoH <= 0) {
      alert('Chưa đọc xong kích thước video xem trước. Vui lòng chờ video hiển thị rồi thử lại.')
      return
    }
    const token = ++sttnPreviewToken.current
    setDependencyAction('preview')
    setSttnPreviewRunning(true)
    setSttnPreviewPath(null)
    setSttnPreviewProgress({ percent: 0, message: 'Đang kiểm tra thành phần STTN…' })
    try {
      const status = await refreshAutoShortReadiness(true)
      if (token !== sttnPreviewToken.current) return
      if (previewPathRef.current !== videoPathSnapshot) return
      if (!status?.ready) {
        setDependencyError(status?.message || 'Không thể kiểm tra thành phần STTN.')
        setShowDependencyModal(true)
        return
      }
      const result = await window.api.autoShortSttnPreview({
        videoPath: videoPathSnapshot,
        previewSeconds: 5,
        ...(selectedTask.temporalEdit ? { temporalEdit: selectedTask.temporalEdit } : {}),
        config: {
          subtitleMethod: 'ocr', whisperModel: selectedWhisperModel, whisperDevice,
          lamMo: true, blurMode: 'sttn', ocrBlurProfile: 'accurate', blurRegions: [],
          ocrRegion: scan,
          translateTarget: 'none', translateProvider: 'local', ttsEnabled: false,
          voiceOverMode: false, audioMode: 'replace', originalAudioVolume: 1,
          outputDir: outputDir || videoPathSnapshot.replace(/[^\\/]+$/, '')
        }
      })
      if (token !== sttnPreviewToken.current) return
      if (previewPathRef.current !== videoPathSnapshot) return
      if (!result.ok) throw new Error(result.error)
      setSttnPreviewPath(result.outputPath)
      setSttnPreviewProgress({ percent: 100, message: `Xem thử hoàn tất · ${result.provider.toUpperCase()} · ${(result.elapsedMs / 1000).toFixed(1)} giây xử lý` })
      await window.api.openPath(result.outputPath)
    } catch (error) {
      if (token === sttnPreviewToken.current) setSttnPreviewProgress({ percent: 0, message: error instanceof Error ? error.message : 'Không thể tạo bản xem thử STTN.' })
    } finally {
      if (token === sttnPreviewToken.current) setSttnPreviewRunning(false)
    }
  }

  const installDependencies = async (): Promise<void> => {
    setDependencyInstalling(true)
    setDependencyError(null)
    setDependencyProgress({})
    try {
      const result = await window.api.autoShortInstallDependencies({
        subtitleMethod: dependencyAction === 'preview' ? 'ocr' : subtitleMethod,
        whisperModel: selectedWhisperModel,
        whisperDevice,
        lamMo: blurEnabled,
        blurMode,
        ocrBlurProfile,
        audioMode: dependencyAction === 'preview' ? 'replace' : audioMode,
        separationPreset
      })
      if (!result.ok) throw new Error(result.error || 'Không thể chuẩn bị dependency.')
      const next = await refreshAutoShortReadiness(dependencyAction === 'preview')
      if (!next?.ready) throw new Error(next?.message || 'Dependency chưa sẵn sàng sau khi tải.')
      setShowDependencyModal(false)
      // Tự động tiếp tục chạy flow Auto Short vừa bấm trước đó
      if (dependencyAction === 'preview') void startSttnPreview()
      else void startBatch()
    } catch (error) {
      setDependencyError(error instanceof Error ? error.message : 'Không thể chuẩn bị dependency.')
    } finally {
      setDependencyInstalling(false)
    }
  }

  const cancelDependencyInstall = async (): Promise<void> => {
    await window.api.autoShortCancelDependencyInstall()
    setDependencyError('Đã yêu cầu hủy. Lượt tải đang chạy sẽ dừng ở điểm an toàn gần nhất.')
  }

  return (
    <div className="video-editor autoshort-page" style={{ gridTemplateRows: 'minmax(0, 1fr) auto' }}>
      {/* KHU VỰC CHÍNH: 2 CỘT (TRÁI: BẢN XEM TRƯỚC, PHẢI: INSPECTOR) */}
      <div className="editor-workspace">

        {/* ========================================================================= */}
        {/* CỘT TRÁI: BẢN XEM TRƯỚC VIDEO (CHUẨN 3 HÀNG GRID, TỰ ĐỘNG SCALE VỪA VẶN) */}
        {/* ========================================================================= */}
        <section
          ref={previewPanelRef}
          className={`editor-canvas-panel${showCutPanel && selectedTask ? ' has-cut-panel' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          {/* Header xem trước */}
          <div className="editor-stage-head">
            <div>
              <span className="editor-eyebrow">BẢN XEM TRƯỚC</span>
              <span className="editor-timecode">
                {formatTime(currentTime)} / {formatTime(videoDuration)}
              </span>
            </div>

            <div className="editor-preview-actions">
              <button className={`btn sm ${showCutPanel ? 'primary' : 'ghost'}`} type="button" disabled={!selectedTask || isRunning}
                onClick={() => setShowCutPanel((current) => !current)}>Cắt đoạn</button>
              <PortraitBlurButton enabled={portraitBlur} onChange={setPortraitBlur} disabled={isRunning} />
              <VideoAdjustmentsControl value={normalizedVideoAdjustments} onChange={setVideoAdjustments} disabled={isRunning} />
              <AutoShortOverlayControl value={overlayState.value} onChange={setOverlaySettings} disabled={isRunning} configError={overlayState.error} />
              {tasks.length > 0 && (
                <select
                  value={selectedTask?.id || ''}
                  onChange={(e) => setSelectedId(e.target.value)}
                  style={{
                    padding: '3px 8px',
                    fontSize: '12px',
                    background: 'var(--panel-2)',
                    color: 'var(--text)',
                    border: '1px solid var(--control-border)',
                    borderRadius: '6px',
                    maxWidth: '180px'
                  }}
                  title="Chọn video để xem trước"
                >
                  {tasks.map((t, idx) => (
                    <option key={t.id} value={t.id}>
                      {idx + 1}. {t.fileName}
                    </option>
                  ))}
                </select>
              )}

              <button
                className="btn sm primary"
                onClick={() => void addVideoFiles()}
                disabled={isRunning}
                type="button"
                style={{ padding: '4px 10px', fontSize: '12px' }}
              >
                + Thêm video
              </button>

              {tasks.length > 0 && (
                <button
                  className="btn sm ghost"
                  onClick={clearAllTasks}
                  disabled={isRunning}
                  type="button"
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                  title="Xóa tất cả video"
                >
                  Xóa
                </button>
              )}
            </div>
          </div>

          {/* Sân khấu video + Bounding box RegionBox */}
          <div ref={stageShellRef} className="editor-stage-shell">
            {selectedTask ? (
              <PortraitFramePreview
                enabled={portraitBlur}
                videoRef={videoRef}
                source={previewPath}
                videoWidth={videoW}
                videoHeight={videoH}
                width={previewStageSize.width}
                height={previewStageSize.height}
                adjustments={normalizedVideoAdjustments}
                overlay={<AutoShortOverlayPreview value={overlayState.value} width={previewStageSize.width}
                  height={previewStageSize.height} fontFamily={previewFontFamily} fontId={fontId} />}
              >
                <video
                  ref={videoRef}
                  crossOrigin="anonymous"
                  src={previewPath ? localMediaSource(previewPath) : undefined}
                  onLoadedMetadata={(e) => {
                    const target = e.currentTarget
                    const expectedSource = previewPath ? localMediaSource(previewPath) : null
                    if (!expectedSource || target.getAttribute('src') !== expectedSource) return
                    const w = target.videoWidth
                    const h = target.videoHeight
                    if (w <= 0 || h <= 0) return
                    setVideoW(w)
                    setVideoH(h)
                    if (Number.isFinite(target.duration)) setVideoDuration(target.duration)
                    setSubtitleRegion((current) => current ?? defaultSubtitleRegion(w, h))
                    setOcrRegion((current) => current ?? defaultOcrRegion(w, h))
                    measureStage()
                  }}
                  onError={(e) => {
                    const target = e.currentTarget
                    const expectedSource = previewPath ? localMediaSource(previewPath) : null
                    if (expectedSource && target.getAttribute('src') === expectedSource) {
                      setVideoW(0)
                      setVideoH(0)
                    }
                  }}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onClick={() => void transport.togglePlayback()}
                  style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill', ...adjustmentPreviewStyle }}
                />

                {videoH > 0 && previewStageSize.width > 0 && (
                  <RegionBox
                    key={previewPath}
                    regions={visibleManualBlurRegions}
                    activeId={activeBlurId}
                    setActiveId={setActiveBlurId}
                    updateRegion={updateBlurRegion}
                    removeRegion={removeBlurRegion}
                    blurInteractive={tool === 'blur' && blurMode === 'manual'}
                    hienSubBox={true}
                    subInteractive={tool === 'subtitle'}
                    subRegion={subtitlePixelRegion || undefined}
                    setSubRegion={updateSubRegionClamped}
                    hienOcrBox={showOcrScanRegion}
                    ocrInteractive={(tool === 'blur' && automaticProcessing) || (tool === 'subtitle' && subtitleUsesOcr)}
                    ocrRegion={ocrPixelRegion || undefined}
                    setOcrRegion={updateOcrRegionClamped}
                    videoH={videoH}
                    videoW={videoW}
                    boxH={boxH}
                    boxW={boxW}
                    xemMo={blurEnabled && tool === 'blur'}
                    showBlurEffect={blurEnabled}
                    previewFontFamily={previewFontFamily || undefined}
                    subtitleText="Mẫu chữ xuất ra"
                    subtitleDisplayStyle={displayStyle}
                    subtitleFontSize={fontSize > 0
                      ? videoPixelsFromReferenceHeight(fontSize, videoH, SUBTITLE_STYLE_REFERENCE_HEIGHT)
                      : undefined}
                    scaleSubtitleToVideo={portraitBlur}
                    highlightColor={highlightColor}
                    highlightPop={highlightPop}
                    textColor={textColor}
                    outlineColor={outlineColor}
                    outlinePx={videoPixelsFromReferenceHeight(outlinePx, videoH, SUBTITLE_STYLE_REFERENCE_HEIGHT)}
                    bgEnabled={bgEnabled}
                    bgColor={bgColor}
                    bgOpacity={bgOpacity}
                    showSafeArea={showSafeArea}
                    previewZoom={normalizedVideoAdjustments.zoom}
                  />
                )}
              </PortraitFramePreview>
            ) : (
              <button
                className="editor-empty-stage"
                onClick={() => void addVideoFiles()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                type="button"
              >
                <span className="editor-empty-mark">▶</span>
                <strong>Chọn hoặc kéo thả video vào đây</strong>
                <small>Hỗ trợ thêm nhiều video để xử lý hàng loạt tự động.</small>
              </button>
            )}
          </div>

          {/* Thanh điều khiển Playback / Tua video */}
          <div className="cue-rail" aria-label="Điều khiển video">
            <div className="cue-transport">
              <button
                type="button"
                className="cue-transport-button cue-play-toggle"
                onClick={() => void transport.togglePlayback()}
                title={transport.isPlaying ? 'Tạm dừng' : 'Phát'}
              >
                <span>{transport.isPlaying ? '❚❚' : '▶'}</span>
              </button>
              <span className="cue-transport-time">{formatTime(currentTime)}</span>

              <div
                className="cue-rail-track"
                onClick={(e) => {
                  if (!videoDuration || videoDuration <= 0) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                  transport.seekTo(pct * videoDuration)
                }}
                title="Nhấp vào thanh để tua video"
              >
                <span
                  className="cue-playhead"
                  style={{ left: `${videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0}%` }}
                />
              </div>

              <span className="cue-transport-time">{formatTime(videoDuration)}</span>
              <button
                type="button"
                className="cue-transport-button cue-mute-toggle"
                onClick={transport.toggleMuted}
                title={transport.muted || transport.volume === 0 ? 'Bật tiếng' : 'Tắt tiếng'}
              >
                <span>{transport.muted || transport.volume === 0 ? '🔇' : '🔊'}</span>
              </button>
              <input
                className="cue-volume"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={transport.muted ? 0 : transport.volume}
                onChange={(e) => transport.changeVolume(Number(e.target.value))}
                title={`Âm lượng ${Math.round((transport.muted ? 0 : transport.volume) * 100)}%`}
              />
              <select
                className="cue-playback-rate"
                value={transport.playbackRate}
                onChange={(e) => transport.changePlaybackRate(Number(e.target.value))}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                  <option key={r} value={r}>{r}×</option>
                ))}
              </select>
              <button
                type="button"
                className="cue-transport-button cue-fullscreen-toggle"
                onClick={() => void toggleStageFullscreen()}
                title="Toàn màn hình"
              >
                <span>{isStageFullscreen ? '×' : '⛶'}</span>
              </button>
            </div>
          </div>

          {showCutPanel && selectedTask && (
            <AutoShortCutPanel
              key={selectedTask.id}
              edit={selectedTask.temporalEdit?.schemaVersion === 1 ? selectedTask.temporalEdit : undefined}
              durationSeconds={videoDuration}
              currentTimeSeconds={currentTime}
              disabled={isRunning}
              onSeek={transport.seekTo}
              onChange={(temporalEdit) => {
                setResumeSnapshot(null)
                setTasks((current) => current.map((task) => task.id === selectedTask.id
                  ? { ...task, temporalEdit, currentStepMessage: temporalEdit?.removedRanges.length
                    ? `Đã chọn bỏ ${temporalEdit.removedRanges.length} đoạn`
                    : 'Sẵn sàng' }
                  : task))
              }}
            />
          )}
        </section>

        {/* ========================================================================= */}
        {/* CỘT PHẢI: CẤU HÌNH BIÊN TẬP (INSPECTOR: PHỤ ĐỀ / LÀM MỜ / LỒNG TIẾNG / HÀNG ĐỢI) */}
        {/* ========================================================================= */}
        <aside className="editor-inspector" style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Tab Bar chuyển đổi công cụ */}
          <div className="editor-tools" role="tablist">
            <button
              className={tool === 'subtitle' ? 'active' : ''}
              onClick={() => setTool('subtitle')}
              role="tab"
              type="button"
            >
              Phụ đề
            </button>
            <button
              className={tool === 'blur' ? 'active' : ''}
              onClick={() => setTool('blur')}
              role="tab"
              type="button"
            >
              Làm mờ
            </button>
            <button
              className={tool === 'audio' ? 'active' : ''}
              onClick={() => setTool('audio')}
              role="tab"
              type="button"
            >
              Lồng tiếng
            </button>
            <button
              className={tool === 'queue' ? 'active' : ''}
              onClick={() => setTool('queue')}
              role="tab"
              type="button"
            >
              Hàng đợi ({tasks.length})
            </button>
          </div>

          <div className="editor-inspector-scroll">
            <fieldset disabled={isRunning || sttnPreviewRunning} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              {/* ------------------------------------------------------------- */}
              {/* TAB 1: PHỤ ĐỀ                                                 */}
              {/* ------------------------------------------------------------- */}
              {tool === 'subtitle' && (
                <>
                  {/* 1. Trích xuất phụ đề */}
                  <div className="editor-section-head">
                    <div>
                      <strong>Nhận diện phụ đề</strong>
                      <small>Tự động trích xuất lời thoại từ âm thanh hoặc hình ảnh video.</small>
                    </div>
                  </div>

                  <div className="subtitle-style-options">
                    {(
                      [
                        ['whisper', '🎙️ Whisper', 'Nhận diện âm thanh chuẩn xác'],
                        ['ocr', '🔍 OCR (Đọc chữ video)', 'Quét trực tiếp chữ trên khung hình'],
                        ['whisper-ocr', '✨ Whisper + OCR', 'Kết hợp nhận diện âm thanh & hình ảnh']
                      ] as const
                    ).map(([value, label, note]) => (
                      <label
                        key={value}
                        className={`subtitle-style-option ${subtitleMethod === value ? 'active' : ''}`}
                      >
                        <input
                          type="radio"
                          name="auto-sub-method"
                          value={value}
                          checked={subtitleMethod === value}
                          onChange={() => setSubtitleMethod(value)}
                        />
                        <span className="subtitle-style-signal" aria-hidden="true" />
                        <span>
                          <strong>{label}</strong>
                          <small>{note}</small>
                        </span>
                      </label>
                    ))}
                  </div>

                  {subtitleMethod !== 'ocr' && (
                    <label className="field editor-field" style={{ marginTop: 6 }}>
                      <span>Mô hình Whisper</span>
                      <select value={selectedWhisperModel} onChange={(e) => setWhisperModel(e.target.value)}>
                        <option value="base">Base (Cân bằng · Khuyên dùng)</option>
                        <option value="small">Small (Chính xác hơn)</option>
                        <option value="medium">Medium (Chính xác cao)</option>
                      </select>
                    </label>
                  )}

                  {subtitleMethod !== 'ocr' && (
                    <label className="field editor-field" style={{ marginTop: 6 }}>
                      <span>Thiết bị Whisper</span>
                      <select value={whisperDevice} onChange={(e) => setWhisperDevice(e.target.value as WhisperDevice)}>
                        <option value="cpu">CPU (tương thích)</option>
                        <option value="cuda">CUDA (GPU NVIDIA)</option>
                      </select>
                    </label>
                  )}

                  <div className="editor-section-divider" style={{ margin: '14px 0', borderBottom: '1px solid var(--border)' }} />

                  {/* 2. Dịch phụ đề AI */}
                  <div className="editor-section-head">
                    <div>
                      <strong>Dịch phụ đề AI</strong>
                      <small>Tự động dịch nội dung phụ đề sang ngôn ngữ đích.</small>
                    </div>
                  </div>

                  <label className="field editor-field">
                    <span>Ngôn ngữ đích</span>
                    <select value={translateTarget} onChange={(e) => setTranslateTarget(e.target.value)}>
                      {TRANSLATE_LANGS.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field editor-field">
                    <span>Ngôn ngữ nguồn</span>
                    <select value={whisperLanguage} onChange={(e) => setWhisperLanguage(e.target.value)}>
                      {SOURCE_LANGS.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                    <small className="muted">Dùng cho nhận diện, dịch và chọn ngôn ngữ TTS khi không có ngôn ngữ đích.</small>
                  </label>

                  <VideoTitleSettings enabled={titleEnabled} onEnabledChange={setTitleEnabled}
                    language={titleLanguage} onLanguageChange={setTitleLanguage}
                    provider={titleProvider} onProviderChange={setTitleProvider}
                    serverUrl={titleServerUrl} onServerUrlChange={setTitleServerUrl}
                    seo={titleSeoOptions} onSeoChange={setTitleSeoOptions} disabled={isRunning} />

                  {translateTarget !== 'none' && (
                    <>
                      <label className="field editor-field">
                        <span>AI dịch phụ đề</span>
                        <select
                          value={translateProvider}
                          onChange={(e) => setTranslateProvider(e.target.value as DichProvider)}
                        >
                          <option value="local">AI nội bộ (TTS-Server)</option>
                          <option value="gemini">Google Gemini AI</option>
                          <option value="openai">OpenAI (ChatGPT)</option>
                        </select>
                      </label>

                      {translateProvider === 'local' && <label className="field editor-field">
                        <span>Địa chỉ server AI</span>
                        <input type="url" value={ttsServerUrl} disabled={isRunning}
                          onChange={(event) => setTtsServerUrl(event.target.value)}
                          placeholder={DEFAULT_AI_SERVER_URL} />
                      </label>}

                      <details className="autoshort-key-card">
                        <summary>Ngữ cảnh và glossary (tùy chọn)</summary>
                        <label className="field editor-field">
                          <span>Mô tả ngắn nội dung</span>
                          <textarea value={translationSynopsis} disabled={isRunning} maxLength={2000} rows={3}
                            onChange={(event) => setTranslationSynopsis(event.target.value)}
                            placeholder="Ví dụ: video hướng dẫn an toàn khi dùng máy cắt." />
                        </label>
                        <label className="field editor-field">
                          <span>Glossary — mỗi dòng: từ nguồn = bản dịch</span>
                          <textarea value={translationGlossaryText} disabled={isRunning} rows={4}
                            onChange={(event) => setTranslationGlossaryText(event.target.value)}
                            placeholder={'安全阀 = van an toàn\n小王 = Tiểu Vương'} />
                        </label>
                        <small className="muted">Tối đa 50 thuật ngữ; ngữ cảnh chỉ hỗ trợ dịch và không tạo thêm cue.</small>
                      </details>

                      <div className="autoshort-key-card">
                        {translateProvider === 'gemini' ? <GeminiKeys disabled={isRunning} onChanged={setHasStoredKey} /> : <>
                        <div className="autoshort-key-header">
                          <span className="muted small">
                            {translateProvider === 'local'
                              ? 'Khóa API AI nội bộ'
                              : `Khóa API ${translateProvider.toUpperCase()}`}
                          </span>
                          <span className={`autoshort-key-badge ${hasStoredKey ? 'saved' : ''}`}>
                            {hasStoredKey ? '✓ Đã lưu trên máy' : 'Chưa lưu'}
                          </span>
                        </div>

                        <div className="autoshort-key-input-row">
                          <div className="autoshort-key-input-wrap">
                            <input
                              type={showKeyText ? 'text' : 'password'}
                              placeholder={
                                hasStoredKey
                                  ? '•••••••••••• (Đã lưu key, nhập mới để đổi)'
                                  : translateProvider === 'local'
                                    ? 'Nhập API Key (để trống nếu server không yêu cầu)'
                                    : 'Dán API Key vào đây…'
                              }
                              value={apiKeyInput}
                              onChange={(e) => setApiKeyInput(e.target.value)}
                            />
                            <button
                              type="button"
                              className="autoshort-key-toggle-btn"
                              onClick={() => setShowKeyText(!showKeyText)}
                              title={showKeyText ? 'Ẩn key' : 'Hiện key'}
                            >
                              {showKeyText ? (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                                  <line x1="1" y1="1" x2="23" y2="23" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              )}
                            </button>
                          </div>

                          <button
                            type="button"
                            className="btn primary autoshort-key-btn-save"
                            disabled={keyTesting || (!apiKeyInput.trim() && !hasStoredKey && translateProvider !== 'local')}
                            onClick={() => void handleSaveAndTestKey()}
                          >
                            {keyTesting ? '⏳…' : 'Lưu'}
                          </button>

                          {hasStoredKey && (
                            <button
                              type="button"
                              className="btn ghost danger autoshort-key-btn-del"
                              onClick={() => void handleClearKey()}
                              title="Xóa key đã lưu"
                            >
                              Xóa
                            </button>
                          )}
                        </div>

                        {keyFeedback && (
                          <div className={`autoshort-key-feedback ${keyFeedback.ok ? 'success' : 'error'}`}>
                            {keyFeedback.ok ? '✓ ' : '✕ '}
                            {keyFeedback.message}
                          </div>
                        )}
                        </>}
                      </div>
                    </>
                  )}

                  <div className="editor-section-divider" style={{ margin: '14px 0', borderBottom: '1px solid var(--border)' }} />

                  {/* 3. Kiểu phụ đề */}
                  <div className="editor-section-head">
                    <div>
                      <strong>Kiểu hiển thị phụ đề</strong>
                      <small>Áp dụng đồng thời cho xem trước và video xuất.</small>
                    </div>
                    <label className="editor-switch">
                      <input type="checkbox" checked readOnly disabled />
                      <span>Luôn burn khi xuất</span>
                    </label>
                  </div>

                  <div className="subtitle-layout-card">
                    <div className="subtitle-layout-head">
                      <div>
                        <strong>Tự đặt vị trí theo OCR</strong>
                        <small>
                          Chọn vị trí riêng cho từng video trong vùng OCR bạn đã khoanh. Không xác định được thì dùng khung phụ đề hiện tại.
                        </small>
                      </div>
                      <label
                        className="editor-switch"
                        title={!automaticProcessing ? 'Cần bật Tự động OCR hoặc Xóa phụ đề AI (STTN).' : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={subtitlePlacementMode === 'ocr-dominant'}
                          disabled={!automaticProcessing}
                          onChange={(event) => setSubtitlePlacementMode(event.target.checked ? 'ocr-dominant' : 'manual')}
                        />
                        <span>{subtitlePlacementMode === 'ocr-dominant' ? 'Bật' : 'Tắt'}</span>
                      </label>
                    </div>
                    {subtitlePlacementMode === 'ocr-dominant' && (
                      <small className="muted">
                        Khung trên bản xem trước là vị trí dự phòng. Vị trí tự động được xác định sau bước OCR.
                      </small>
                    )}
                    {!automaticProcessing && (
                      <small className="muted">Cần bật Tự động OCR hoặc Xóa phụ đề AI (STTN) trong tab Làm mờ.</small>
                    )}
                  </div>

                  {(() => {
                    const supportsWordEffects = subtitleMethod !== 'ocr' && translateTarget === 'none' && !ttsEnabled
                    const wordEffectDisabledReason = ttsEnabled
                      ? 'Không khả dụng khi bật Lồng tiếng AI (TTS chưa hỗ trợ word timestamps)'
                      : translateTarget !== 'none'
                        ? 'Không khả dụng khi Dịch phụ đề (chưa có alignment từ cho bản dịch)'
                        : subtitleMethod === 'ocr'
                          ? 'Không khả dụng với OCR hình ảnh (OCR chỉ đọc theo khung hình)'
                          : ''

                    return (
                      <>
                        <div className="subtitle-style-options">
                          {(
                            [
                              ['standard', 'Hiển thị cả câu', 'Ổn định và dễ đọc', true],
                              ['word-reveal', 'Hiện lần lượt từng từ', 'Từ đã hiện được giữ lại', supportsWordEffects],
                              ['word-highlight', 'Làm nổi bật từ đang đọc', 'Toàn câu luôn hiển thị', supportsWordEffects]
                            ] as const
                          ).map(([value, label, note, available]) => {
                            const isSelected = (supportsWordEffects ? displayStyle : 'standard') === value
                            return (
                              <label
                                key={value}
                                className={`subtitle-style-option ${isSelected ? 'active' : ''} ${!available ? 'disabled' : ''}`}
                                title={!available ? wordEffectDisabledReason : undefined}
                                style={!available ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                              >
                                <input
                                  type="radio"
                                  name="subtitle-display-style"
                                  value={value}
                                  checked={isSelected}
                                  disabled={!available}
                                  onChange={() => available && setDisplayStyle(value)}
                                />
                                <span className="subtitle-style-signal" aria-hidden="true" />
                                <span>
                                  <strong>{label} {!available && <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--muted)' }}>(Chưa khả dụng)</span>}</strong>
                                  <small>{!available ? wordEffectDisabledReason : note}</small>
                                </span>
                              </label>
                            )
                          })}
                        </div>
                        {!supportsWordEffects && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>
                            ℹ️ {wordEffectDisabledReason}
                          </div>
                        )}
                      </>
                    )
                  })()}

                  {displayStyle === 'word-highlight' && (
                    <div className="highlight-effect-controls">
                      <label className="field editor-field">
                        <span>Màu từ đang đọc</span>
                        <input
                          type="color"
                          value={highlightColor}
                          onChange={(e) => setHighlightColor(e.target.value)}
                        />
                      </label>
                      <div className="highlight-pop-control">
                        <div>
                          <strong>Nhấn nhẹ từ đang đọc</strong>
                          <small>Phóng nhẹ rồi trở về, không làm xô dòng chữ.</small>
                        </div>
                        <label className="editor-switch">
                          <input
                            type="checkbox"
                            checked={highlightPop}
                            onChange={(e) => setHighlightPop(e.target.checked)}
                          />
                          <span>{highlightPop ? 'Bật' : 'Tắt'}</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* 4. Tự tối ưu & Font chữ */}
                  <div className="subtitle-layout-card">
                    <div className="subtitle-layout-head">
                      <div>
                        <strong>Tự tối ưu phụ đề</strong>
                        <small>Giữ chữ gọn trong khung mà không sửa file SRT gốc.</small>
                      </div>
                      <label className="editor-switch">
                        <input
                          type="checkbox"
                          checked={autoOptimize}
                          onChange={(e) => setAutoOptimize(e.target.checked)}
                        />
                        <span>{autoOptimize ? 'Bật' : 'Tắt'}</span>
                      </label>
                    </div>
                    <label className="field editor-field">
                      <span>Nhịp hiển thị</span>
                      <select
                        value={layoutProfile}
                        onChange={(e) => setLayoutProfile(e.target.value as SubtitleLayoutProfile)}
                      >
                        <option value="readable">Dễ đọc · tối đa 2 dòng</option>
                        <option value="social">Social · nhịp nhanh</option>
                        <option value="vertical">Video dọc · tối đa 2 dòng</option>
                      </select>
                    </label>
                    <label className="gk-check editor-check subtitle-safe-toggle">
                      <input
                        type="checkbox"
                        checked={showSafeArea}
                        onChange={(e) => setShowSafeArea(e.target.checked)}
                      />
                      <span>Hiện vùng an toàn trên bản xem trước</span>
                    </label>
                  </div>

                  <div className="editor-section-divider" style={{ margin: '14px 0', borderBottom: '1px solid var(--border)' }} />

                  <label className="field editor-field">
                    <span>Font chữ</span>
                    <select value={fontId} onChange={(e) => setFontId(e.target.value)}>
                      <option value="auto">Tự động theo nội dung</option>
                      {groupedFonts.map(([group, entries]) => (
                        <optgroup key={group} label={group}>
                          {entries.map((font) => (
                            <option key={font.id} value={font.id}>
                              {font.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <div className={`font-preview-status ${fontLoadState}`}>
                    <span className="font-preview-dot" />
                    <span>{fontMessage || 'Chọn font để xem trực tiếp trên video.'}</span>
                  </div>

                  <label className="field editor-field">
                    <span>Cỡ chữ · {fontSize === 0 ? 'Tự động theo khung' : `${fontSize}px tại 1080×1920`}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input
                        type="range"
                        min={0}
                        max={160}
                        step={2}
                        value={fontSize}
                        onChange={(e) => setFontSize(Number(e.target.value))}
                        style={{ flex: 1 }}
                      />
                      {fontSize > 0 && (
                        <button
                          type="button"
                          className="btn sm ghost"
                          onClick={() => setFontSize(0)}
                          style={{ padding: '2px 8px', fontSize: '11px', whiteSpace: 'nowrap' }}
                          title="Đặt lại cỡ chữ tự động theo kích thước khung phụ đề"
                        >
                          Tự động
                        </button>
                      )}
                    </div>
                  </label>

                  <div className="editor-color-grid">
                    <label className="field editor-field">
                      <span>Màu chữ</span>
                      <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} />
                    </label>
                    <label className="field editor-field">
                      <span>Màu viền</span>
                      <input type="color" value={outlineColor} onChange={(e) => setOutlineColor(e.target.value)} />
                    </label>
                  </div>
                  <label className="field editor-field">
                    <span>Độ dày viền · {outlinePx}px tại 1080×1920</span>
                    <input
                      type="range"
                      min={0}
                      max={32}
                      step={0.5}
                      value={outlinePx}
                      onChange={(e) => setOutlinePx(Number(e.target.value))}
                    />
                  </label>

                  <label className="gk-check editor-check">
                    <input
                      type="checkbox"
                      checked={bgEnabled}
                      onChange={(e) => setBgEnabled(e.target.checked)}
                    />
                    <span>Thêm nền sau chữ</span>
                  </label>
                  {bgEnabled && (
                    <div className="editor-color-grid">
                      <label className="field editor-field">
                        <span>Màu nền</span>
                        <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
                      </label>
                      <label className="field editor-field">
                        <span>Độ đậm · {bgOpacity}%</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={bgOpacity}
                          onChange={(e) => setBgOpacity(Number(e.target.value))}
                        />
                      </label>
                    </div>
                  )}
                </>
              )}

              {/* ------------------------------------------------------------- */}
              {/* TAB 2: LÀM MỜ (BLUR)                                          */}
              {/* ------------------------------------------------------------- */}
              {tool === 'blur' && (
                <>
                  <div className="editor-section-head">
                    <div>
                      <strong>Xử lý phụ đề gốc</strong>
                      <small>Chọn làm mờ hoặc dùng AI xóa chữ trong vùng OCR.</small>
                    </div>
                    <label className="editor-switch">
                      <input
                        type="checkbox"
                        checked={blurEnabled}
                        onChange={(e) => setBlurEnabled(e.target.checked)}
                      />
                      <span>{blurEnabled ? 'Bật' : 'Tắt'}</span>
                    </label>
                  </div>

                  <div className="autoshort-blur-mode-group" role="radiogroup" aria-label="Chế độ làm mờ">
                    <label className={`autoshort-blur-mode-option ${blurMode === 'manual' ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="autoshort-blur-mode"
                        value="manual"
                        checked={blurMode === 'manual'}
                        onChange={() => setBlurModeRaw('manual')}
                      />
                      <span>Thủ công</span>
                    </label>
                    <label className={`autoshort-blur-mode-option ${blurMode === 'ocr-auto' ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="autoshort-blur-mode"
                        value="ocr-auto"
                        checked={blurMode === 'ocr-auto'}
                        onChange={() => setBlurModeRaw('ocr-auto')}
                      />
                      <span>Tự động OCR</span>
                    </label>
                    <label className={`autoshort-blur-mode-option ${blurMode === 'sttn' ? 'selected' : ''}`}>
                      <input type="radio" name="autoshort-blur-mode" value="sttn"
                        checked={blurMode === 'sttn'} onChange={() => setBlurModeRaw('sttn')} />
                      <span>Xóa phụ đề AI (STTN)</span>
                    </label>
                  </div>

                  {blurMode === 'sttn' ? (
                    <div className="autoshort-ocr-blur-settings">
                      <div className="autoshort-ocr-blur-explain">
                        <p>STTN dùng các khung hình lân cận để phục hồi nền tại vị trí chữ. Luôn quét OCR Chính xác để xác định vị trí và thời gian xuất hiện.</p>
                        <p>Kéo vùng nét đứt bao phủ chữ gốc cần xóa. Phụ đề nguồn được nhận diện trước khi xóa để tiếp tục dịch, tạo tiêu đề và lồng tiếng.</p>
                        <p>Engine và model STTN được tải riêng khi cần; bản CUDA cần khoảng 4,5 GiB dung lượng cài đặt, cộng thêm chỗ trống xử lý video. Hãy xem thử 5 giây đầu để đánh giá nền và chuyển động trước khi chạy toàn bộ.</p>
                        {readiness?.dependencies.find(item => item.id === 'sttn-engine')?.message &&
                          <p>{readiness.dependencies.find(item => item.id === 'sttn-engine')?.message}</p>}
                      </div>
                      <button className="btn editor-wide-action" type="button"
                        disabled={!sttnRemoval || !selectedTask || sttnPreviewRunning || dependencyInstalling}
                        onClick={() => void startSttnPreview()}>Xem thử STTN · 5 giây đầu</button>
                      {sttnPreviewProgress && <div className="muted small" role="status">
                        {sttnPreviewRunning ? `${Math.round(sttnPreviewProgress.percent)}% · ` : ''}{sttnPreviewProgress.message}
                      </div>}
                      {sttnPreviewPath && <button className="btn ghost sm" type="button"
                        onClick={() => void window.api.openPath(sttnPreviewPath)}>Mở bản xem thử</button>}
                    </div>
                  ) : blurMode === 'ocr-auto' ? (
                    <div className="autoshort-ocr-blur-settings">
                      <div className="autoshort-ocr-profile-group" role="radiogroup" aria-label="Cấu hình quét OCR">
                        <label className={`autoshort-ocr-profile-card ${ocrBlurProfile === 'accurate' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="autoshort-ocr-profile"
                            value="accurate"
                            checked={ocrBlurProfile === 'accurate'}
                            onChange={() => setOcrBlurProfileRaw('accurate')}
                          />
                          <div className="autoshort-ocr-profile-content">
                            <strong>Chính xác — khuyên dùng</strong>
                            <small>Quét toàn diện từng khung hình, nhận diện viền chữ đầy đủ nhất.</small>
                          </div>
                        </label>
                        <label className={`autoshort-ocr-profile-card ${ocrBlurProfile === 'fast' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="autoshort-ocr-profile"
                            value="fast"
                            checked={ocrBlurProfile === 'fast'}
                            onChange={() => setOcrBlurProfileRaw('fast')}
                          />
                          <div className="autoshort-ocr-profile-content">
                            <strong>Nhanh</strong>
                            <small>Giảm tần suất mẫu khung để tăng tốc độ xử lý hàng loạt.</small>
                          </div>
                        </label>
                      </div>

                      <div className="autoshort-ocr-blur-explain">
                        <p>Mọi chữ OCR phát hiện trong vùng nét đứt sẽ được làm mờ mạnh, đúng thời gian xuất hiện, cộng biên an toàn 1 khung OCR. Ứng dụng tự render ngay sau khi quét.</p>
                        <p>Chữ nằm ngoài vùng nét đứt (ví dụ ở phía trên khung) sẽ không bị làm mờ; hãy kéo giãn vùng OCR bao phủ toàn bộ chữ gốc cần xoá.</p>
                        <p>Mỗi video mới được lưu trong một thư mục riêng, gồm video đầu ra và thư mục audit.</p>
                        <p>Không phát hiện vùng chữ hợp lệ sẽ dừng video này.</p>
                        {ocrBlurProfile === 'fast' && (
                          <p className="autoshort-ocr-blur-warn">Chế độ Nhanh có thể bỏ sót chữ rất nhỏ hoặc xuất hiện quá ngắn.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <button className="btn editor-wide-action" onClick={addBlurRegion} type="button">
                        + Thêm vùng làm mờ
                      </button>

                      <div className="blur-list">
                        {blurPixelRegions.length === 0 ? (
                          <div className="muted small" style={{ padding: '12px 0', textAlign: 'center' }}>
                            Chưa có vùng làm mờ nào. Nhấp "+ Thêm vùng làm mờ" để tạo vùng che.
                          </div>
                        ) : (
                          blurPixelRegions.map((region, index) => (
                            <button
                              key={region.id}
                              className={`blur-item ${activeBlurId === region.id ? 'active' : ''}`}
                              onClick={() => setActiveBlurId(region.id)}
                              type="button"
                            >
                              <span className="blur-color-badge" style={{ background: region.color || PALETTE[0] }} />
                              <span className="blur-toado">
                                <b>Vùng {index + 1}</b>
                                <span className="blur-coords">{region.x0},{region.y0} → {region.x1},{region.y1}</span>
                              </span>
                              <span
                                className="blur-del-btn"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeBlurRegion(region.id)
                                }}
                                title="Xóa vùng này"
                              >
                                ×
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* ------------------------------------------------------------- */}
              {/* TAB 3: LỒNG TIẾNG (AI VOICE TTS)                              */}
              {/* ------------------------------------------------------------- */}
              {tool === 'audio' && (
                <>
                  <div className="editor-section-head">
                    <div>
                      <strong>Lồng tiếng AI</strong>
                      <small>Tự động sinh giọng đọc AI khớp chính xác timeline video.</small>
                    </div>
                    <label className="editor-switch">
                      <input
                        type="checkbox"
                        checked={ttsEnabled}
                        onChange={(e) => setTtsEnabled(e.target.checked)}
                      />
                      <span>{ttsEnabled ? 'Bật' : 'Tắt'}</span>
                    </label>
                  </div>

                  <label className="field editor-field">
                    <span>Động cơ giọng đọc (TTS Provider)</span>
                    <div className="radio-pill-group" style={{ marginTop: 6 }}>
                      <label className={`radio-pill ${ttsProvider === 'edge-tts' ? 'active' : ''}`}>
                        <input
                          type="radio"
                          name="ttsProvider"
                          value="edge-tts"
                          checked={ttsProvider === 'edge-tts'}
                          onChange={() => setTtsProvider('edge-tts')}
                        />
                        <span>Microsoft Edge-TTS (Trực tuyến)</span>
                      </label>
                      <label className={`radio-pill ${ttsProvider === 'local-tts' ? 'active' : ''}`}>
                        <input
                          type="radio"
                          name="ttsProvider"
                          value="local-tts"
                          checked={ttsProvider === 'local-tts'}
                          onChange={() => setTtsProvider('local-tts')}
                        />
                        <span>Local AI Server (Chatterbox / TTS-Server)</span>
                      </label>
                    </div>
                  </label>

                  {ttsProvider === 'edge-tts' ? (
                    <>
                      <div className="server-status-pill" style={{ margin: '6px 0' }}>
                        <span className={`status-dot ${edgeCatalogSource === 'live' ? 'online' : ''}`} />
                        <span className="small">
                          Động cơ: <strong>Microsoft Edge Read Aloud API</strong> ({edgeCatalogSource === 'live' ? 'Catalog trực tuyến' : edgeCatalogSource === 'checking' ? 'Đang kiểm tra kết nối…' : 'Catalog dự phòng, chưa xác nhận kết nối'})
                        </span>
                        {edgeCatalogError && <span className="muted small">{edgeCatalogError}</span>}
                      </div>

                      <label className="field editor-field">
                        <span>Giọng đọc Edge-TTS</span>
                        <select
                          value={edgeVoice}
                          onChange={(e) => setEdgeVoice(e.target.value)}
                        >
                          {selectableEdgeVoices.length > 0 ? (
                            selectableEdgeVoices.map((voice) => (
                              <option key={voice.id} value={voice.id}>
                                {voice.name} · {voice.locale}
                              </option>
                            ))
                          ) : (
                            <option value={edgeVoice} disabled>
                              {edgeCatalogSource === 'checking' ? 'Đang tải catalog giọng…' : 'Không có giọng phù hợp với ngôn ngữ đã chọn'}
                            </option>
                          )}
                        </select>
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="field editor-field">
                        <span>Địa chỉ server AI (dịch/TTS)</span>
                        <input
                          type="url"
                          value={ttsServerUrl}
                          onChange={(e) => setTtsServerUrl(e.target.value)}
                          placeholder="http://127.0.0.1:8000"
                        />
                      </label>

                      <div className="server-status-pill" style={{ margin: '6px 0' }}>
                        <span className={`status-dot ${serverOnline ? 'online' : 'offline'}`} />
                        <span className="small">
                          Server AI: <code>{ttsServerUrl}</code> ({serverOnline ? 'Sẵn sàng' : 'Chưa kết nối'})
                        </span>
                      </div>

                      <label className="field editor-field">
                        <span>Mô hình giọng đọc</span>
                        <select
                          value={selectedModelInfo?.id || ttsModel}
                          disabled={ttsModels.length === 0}
                          onChange={(e) => {
                            const next = e.target.value
                            setTtsModel(next)
                            const nextInfo = ttsModels.find((m) => m.id === next)
                            if (nextInfo && !ttsVoice.startsWith('clone:')) {
                              setTtsVoice(nextInfo.default_voice || (nextInfo.voices && nextInfo.voices[0]) || 'default')
                            }
                          }}
                        >
                          {ttsModels.length > 0 ? (
                            ttsModels.map((m) => (
                              <option key={m.id} value={m.id} disabled={m.available === false}>
                                {m.name || m.id}{m.available === false ? ' (không khả dụng)' : ''}
                              </option>
                            ))
                          ) : (
                            <option value="" disabled>
                              {serverOnline === false ? 'Server AI chưa kết nối' : 'Đang tải danh sách mô hình…'}
                            </option>
                          )}
                        </select>
                      </label>

                      <label className="field editor-field">
                        <span>Giọng đọc</span>
                        <select value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)}>
                          {modelVoices.length > 0 ? (
                            <optgroup label={`Giọng mẫu (${selectedModelInfo?.name || selectedModelInfo?.id || 'Mô hình'})`}>
                              {modelVoices.map((v) => (
                                <option key={v} value={v}>
                                  {v}
                                </option>
                              ))}
                            </optgroup>
                          ) : (
                            <optgroup label="Giọng mẫu chuẩn">
                              <option value={selectedModelInfo?.default_voice || 'default'}>
                                {selectedModelInfo?.default_voice || 'default'} (Mặc định)
                              </option>
                            </optgroup>
                          )}

                          {clonedVoices.length > 0 && (
                            <optgroup label={`✨ Giọng Clone đã lưu (${clonedVoices.length})`}>
                              {clonedVoices.map((cv) => (
                                <option key={cv.id} value={`clone:${cv.id}`}>
                                  ✨ {cv.name} ({cv.language || 'vi'} · Clone)
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </label>
                    </>
                  )}

                  <label className="field editor-field">
                    <span>Tốc độ đọc · {ttsSpeed.toFixed(2)}x</span>
                    <input
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.05}
                      value={ttsSpeed}
                      onChange={(e) => setTtsSpeed(parseFloat(e.target.value))}
                    />
                  </label>

                  <label className="field editor-field">
                    <span>Nhịp đọc theo video</span>
                    <select value={paceMode} onChange={(e) => setPaceMode(e.target.value as 'source-adaptive' | 'fixed')}>
                      <option value="source-adaptive">Tự bám nhịp nguồn (khuyến nghị)</option>
                      <option value="fixed">Cố định theo tốc độ đã chọn</option>
                    </select>
                    <small className="muted">
                      Tự bám nhịp giữ mốc đầu câu và điều chỉnh nhẹ theo từng khoảng trống, không đổi tốc độ video.
                    </small>
                  </label>

                  <div className="editor-section-divider" style={{ margin: '14px 0', borderBottom: '1px solid var(--border)' }} />

                  <label className="field editor-field">
                    <span>Chế độ âm thanh xuất</span>
                    <div className="radio-pill-group" style={{ marginTop: 6 }}>
                      <label className={`radio-pill ${audioMode === 'replace' ? 'active' : ''}`}>
                        <input
                          type="radio"
                          name="audioMode"
                          value="replace"
                          checked={audioMode === 'replace'}
                          onChange={() => setAudioMode('replace')}
                        />
                        <span>Thay thế toàn bộ âm thanh gốc</span>
                      </label>
                      <label className={`radio-pill ${audioMode === 'mix' ? 'active' : ''}`}>
                        <input
                          type="radio"
                          name="audioMode"
                          value="mix"
                          checked={audioMode === 'mix'}
                          onChange={() => setAudioMode('mix')}
                        />
                        <span>Trộn với âm thanh / nhạc nền gốc</span>
                      </label>
                      <label className={`radio-pill ${audioMode === 'separate-vocals' ? 'active' : ''} ${!ttsEnabled ? 'disabled' : ''}`}>
                        <input
                          type="radio"
                          name="audioMode"
                          value="separate-vocals"
                          disabled={!ttsEnabled}
                          checked={audioMode === 'separate-vocals'}
                          onChange={() => setAudioMode('separate-vocals')}
                        />
                        <span>Tách thoại gốc, giữ nhạc & SFX</span>
                      </label>
                    </div>
                    {!ttsEnabled && (
                      <small className="muted" style={{ display: 'block', marginTop: 4 }}>
                        Tách thoại yêu cầu bật Lồng tiếng AI (TTS).
                      </small>
                    )}
                  </label>

                  {audioMode === 'separate-vocals' && (
                    <div className="autoshort-separation-panel" style={{ marginTop: 10 }}>
                      <div className="editor-section-head">
                        <div>
                          <strong>Tách thoại gốc, giữ nhạc & SFX</strong>
                          <small>Tách bỏ giọng nói gốc, giữ lại nhạc nền và hiệu ứng âm thanh để lồng tiếng AI đè lên.</small>
                        </div>
                        <span className="separation-provider-badge">
                          {readiness?.separation?.effectiveProvider === 'directml'
                            ? 'DirectML · NVIDIA/AMD/Intel'
                            : 'CPU fallback'}
                        </span>
                      </div>

                      <div className="separation-presets-grid" style={{ marginTop: 8 }}>
                        {(() => {
                          const preset = separationPreset
                          return (
                            <>
                              <div
                                role="button"
                                tabIndex={0}
                                className={`separation-preset-card ${preset === 'fast' ? 'selected' : ''}`}
                                onClick={() => setSeparationPreset('fast')}
                                onKeyDown={(e) => {
                                  if (e.key === ' ' || e.key === 'Enter') {
                                    e.preventDefault()
                                    setSeparationPreset('fast')
                                  }
                                }}
                              >
                                <div className="preset-card-head">
                                  <span className="preset-card-name">Nhanh</span>
                                  <input
                                    type="radio"
                                    name="separationPreset"
                                    value="fast"
                                    checked={preset === 'fast'}
                                    onChange={() => setSeparationPreset('fast')}
                                  />
                                </div>
                                <p className="preset-card-desc">Model gọn nhẹ, tốc độ tách nhanh nhất.</p>
                              </div>

                              <div
                                role="button"
                                tabIndex={0}
                                className={`separation-preset-card ${preset === 'balanced' ? 'selected' : ''}`}
                                onClick={() => setSeparationPreset('balanced')}
                                onKeyDown={(e) => {
                                  if (e.key === ' ' || e.key === 'Enter') {
                                    e.preventDefault()
                                    setSeparationPreset('balanced')
                                  }
                                }}
                              >
                                <div className="preset-card-head">
                                  <span className="preset-card-name">Cân bằng — khuyên dùng</span>
                                  <input
                                    type="radio"
                                    name="separationPreset"
                                    value="balanced"
                                    checked={preset === 'balanced'}
                                    onChange={() => setSeparationPreset('balanced')}
                                  />
                                </div>
                                <p className="preset-card-desc">Model gọn nhẹ, cân bằng tối ưu giữa chất lượng và thời gian xử lý.</p>
                              </div>

                              <div
                                role="button"
                                tabIndex={0}
                                className={`separation-preset-card ${preset === 'quality' ? 'selected' : ''}`}
                                onClick={() => setSeparationPreset('quality')}
                                onKeyDown={(e) => {
                                  if (e.key === ' ' || e.key === 'Enter') {
                                    e.preventDefault()
                                    setSeparationPreset('quality')
                                  }
                                }}
                              >
                                <div className="preset-card-head">
                                  <span className="preset-card-name">Chất lượng cao</span>
                                  <input
                                    type="radio"
                                    name="separationPreset"
                                    value="quality"
                                    checked={preset === 'quality'}
                                    onChange={() => setSeparationPreset('quality')}
                                  />
                                </div>
                                <p className="preset-card-desc">Model chuyên sâu, tách sạch chi tiết hơn, thời gian xử lý lâu hơn.</p>
                              </div>
                            </>
                          )
                        })()}
                      </div>

                      <div className="separation-status-bar" style={{ marginTop: 10 }}>
                        <div className="separation-status-item">
                          <span className="label">Trạng thái: </span>
                          <span className="value">
                            {(() => {
                              const sepDep = readiness?.dependencies?.find((d) => d.id === 'separator-model' || d.id === 'separator-engine')
                              const prog = dependencyProgress['separator-model'] || dependencyProgress['separator-engine']
                              if (prog && prog.phase === 'downloading') {
                                return `Đang tải (${prog.percent}%)`
                              }
                              if (readiness?.separation?.offlineReady) {
                                return 'Sẵn sàng'
                              }
                              if (sepDep && !sepDep.ready) {
                                const bytes = sepDep.downloadBytes ? ` (${(sepDep.downloadBytes / (1024 * 1024)).toFixed(1)} MB)` : ''
                                return `Chưa cài${bytes}`
                              }
                              return 'Sẵn sàng'
                            })()}
                          </span>
                        </div>
                        <div className="separation-status-item">
                          <span className="label">Tăng tốc: </span>
                          <span className="value">
                            {readiness?.separation?.effectiveProvider === 'directml'
                              ? 'DirectML · NVIDIA/AMD/Intel'
                              : 'CPU fallback'}
                          </span>
                        </div>
                      </div>
                      <small className="muted" style={{ display: 'block', marginTop: 6 }}>
                        Sau khi cài model có thể xử lý offline
                      </small>
                    </div>
                  )}

                  {audioMode === 'mix' && (
                    <label className="field editor-field" style={{ marginTop: 8 }}>
                      <span>Âm lượng âm thanh gốc · {originalAudioVolume}%</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={originalAudioVolume}
                        onChange={(e) => setOriginalAudioVolume(Number(e.target.value))}
                      />
                    </label>
                  )}

                  {ttsEnabled && audioMode === 'replace' && (
                    <div className="autoshort-music-panel">
                      <div className="editor-section-head">
                        <div>
                          <strong>Nhạc background</strong>
                          <small>Phát lặp, tự giảm âm lượng khi có giọng đọc AI.</small>
                        </div>
                        <label className="editor-switch">
                          <input
                            type="checkbox"
                            checked={backgroundMusicEnabled}
                            onChange={(event) => setBackgroundMusicEnabled(event.target.checked)}
                          />
                          <span>{backgroundMusicEnabled ? 'Bật' : 'Tắt'}</span>
                        </label>
                      </div>

                      {backgroundMusicEnabled && (
                        <>
                          <div className="autoshort-music-folder-row">
                            <span className="small" title={backgroundMusicFolder}>
                              {backgroundMusicFolder || 'Chưa chọn folder nhạc'}
                            </span>
                            <button className="btn ghost sm" type="button" onClick={() => void chooseBackgroundMusicFolder()}>
                              Chọn folder
                            </button>
                          </div>
                          {backgroundMusicError && <div className="small" style={{ color: 'var(--danger)' }}>{backgroundMusicError}</div>}

                          <div className="radio-pill-group">
                            <label className={`radio-pill ${backgroundMusicMode === 'single' ? 'active' : ''}`}>
                              <input type="radio" name="backgroundMusicMode" value="single" checked={backgroundMusicMode === 'single'} onChange={() => setBackgroundMusicMode('single')} />
                              <span>Một bài cho tất cả</span>
                            </label>
                            <label className={`radio-pill ${backgroundMusicMode === 'random' ? 'active' : ''}`}>
                              <input type="radio" name="backgroundMusicMode" value="random" checked={backgroundMusicMode === 'random'} onChange={() => setBackgroundMusicMode('random')} />
                              <span>Ngẫu nhiên theo video</span>
                            </label>
                            <label className={`radio-pill ${backgroundMusicMode === 'per-video' ? 'active' : ''}`}>
                              <input type="radio" name="backgroundMusicMode" value="per-video" checked={backgroundMusicMode === 'per-video'} onChange={() => setBackgroundMusicMode('per-video')} />
                              <span>Chọn riêng từng video</span>
                            </label>
                          </div>

                          {backgroundMusicMode === 'single' && (
                            <label className="field editor-field">
                              <span>Bài nhạc dùng cho tất cả video</span>
                              <select value={backgroundMusicSingleTrack} onChange={(event) => setBackgroundMusicSingleTrack(event.target.value)}>
                                <option value="">Chọn bài nhạc…</option>
                                {backgroundMusicTracks.map((track) => <option key={track.path} value={track.path}>{track.name}</option>)}
                              </select>
                            </label>
                          )}

                          {backgroundMusicMode === 'random' && (
                            <div className="muted small">Mỗi video được gán ngẫu nhiên một bài trước khi bắt đầu chạy.</div>
                          )}

                          {backgroundMusicMode === 'per-video' && (
                            <div className="autoshort-music-assignments">
                              {tasks.map((task) => (
                                <label className="autoshort-music-assignment" key={task.id}>
                                  <span title={task.fileName}>{task.fileName}</span>
                                  <select
                                    value={backgroundMusicAssignments[task.id] || ''}
                                    onChange={(event) => setBackgroundMusicAssignments((current) => ({ ...current, [task.id]: event.target.value }))}
                                  >
                                    <option value="">Chọn bài nhạc…</option>
                                    {backgroundMusicTracks.map((track) => <option key={track.path} value={track.path}>{track.name}</option>)}
                                  </select>
                                </label>
                              ))}
                            </div>
                          )}

                          <label className="field editor-field">
                            <span>Âm lượng nhạc background · {backgroundMusicVolume}%</span>
                            <input type="range" min={0} max={100} value={backgroundMusicVolume} onChange={(event) => setBackgroundMusicVolume(Number(event.target.value))} />
                          </label>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ------------------------------------------------------------- */}
              {/* TAB 4: HÀNG ĐỢI XỬ LÝ (QUEUE)                                 */}
              {/* ------------------------------------------------------------- */}
              {tool === 'queue' && (
                <>
                  <div className="editor-section-head">
                    <div>
                      <strong>Hàng đợi video ({tasks.length})</strong>
                      <small>Theo dõi trạng thái và tiến độ chi tiết từng video.</small>
                    </div>
                    <button className="btn sm primary" onClick={() => void addVideoFiles()} disabled={isRunning} type="button">
                      + Thêm
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    {tasks.length === 0 ? (
                      <div className="muted small" style={{ textAlign: 'center', padding: '30px 10px' }}>
                        Chưa có video nào trong danh sách. Bấm <b>"+ Thêm"</b> để nạp video.
                      </div>
                    ) : (
                      tasks.map((task, idx) => (
                        <div
                          key={task.id}
                          className={`autoshort-queue-item ${selectedTask?.id === task.id ? 'selected' : ''}`}
                          onClick={() => setSelectedId(task.id)}
                          style={{ padding: '10px 12px' }}
                        >
                          <span className="queue-item-index">{idx + 1}</span>
                          <div className="queue-item-info">
                            <div className="queue-item-name">{task.fileName}</div>
                            <div className="queue-item-msg muted small">
                              {task.currentStepMessage || 'Sẵn sàng'}
                              {task.percent > 0 && ` (${task.percent}%)`}
                            </div>
                            {task.temporalEdit?.removedRanges.length ? (
                              <div className="queue-item-msg small">Cắt: {task.temporalEdit.removedRanges.length} đoạn{task.temporalEdit.schemaVersion === 1
                                ? ` · bỏ ${(task.temporalEdit.removedRanges.reduce((sum, range) => sum + range.endUs - range.startUs, 0) / MICROSECONDS_PER_SECOND).toFixed(2)} giây`
                                : ' · theo ranh giới frame'}</div>
                            ) : null}
                            {task.error && <div className="queue-item-msg" style={{ color: 'var(--danger)' }}>{task.error}</div>}
                            {task.recovery && task.status === 'error' && (
                              <div className="queue-item-msg small" style={{ color: 'var(--danger)' }}>
                                Phục hồi thời lượng lượt {task.recovery.attempt}/2
                                {task.recovery.cueId ? ` · ${task.recovery.cueId}` : ''}
                                {task.recovery.missingSeconds != null ? ` · thiếu ${task.recovery.missingSeconds.toFixed(2)} giây` : ''}
                                {task.recovery.requiredPercent != null ? ` · cần ${task.recovery.requiredPercent.toFixed(1)}%` : ''}
                              </div>
                            )}
                            {task.seoMetadata
                              ? <VideoSeoResult metadata={task.seoMetadata} titlePath={task.titlePath} />
                              : task.title && <div className="queue-item-msg small" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>Tiêu đề: {task.title}</div>}
                            {task.titleError && <div className="queue-item-msg small" role="status" style={{ color: 'var(--danger)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                              Chưa có tieude.txt: {task.titleError}
                            </div>}
                            {task.translationAssessment?.disposition === 'needs-review' && task.translationAssessment.issues.length > 0 && (
                              <details className="queue-item-msg small" style={{ color: 'var(--danger)' }}>
                                <summary>
                                  Cần kiểm tra bản dịch
                                </summary>
                                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                                  {task.translationAssessment.issues.slice(0, 8).map((issue, issueIndex) => (
                                    <li key={`${issue.code}-${issueIndex}`}>{issue.cueIds.length > 0 ? `${issue.cueIds.join(', ')}: ` : ''}{issue.message}</li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            {task.translationAssessment?.disposition === 'needs-review' && task.translationIdentity && (
                              <button
                                type="button"
                                className="btn ghost sm"
                                disabled={isRunning}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void prepareTranslationRetry(task)
                                }}
                              >
                                Chuẩn bị thử lại dịch
                              </button>
                            )}
                            {task.titlePath && !task.seoMetadata && <button type="button" className="btn ghost sm"
                              onClick={(event) => { event.stopPropagation(); void window.api.openPath(task.titlePath!) }}>
                              Mở tieude.txt
                            </button>}
                            {task.status === 'done' && (
                              <div className="queue-item-msg small" style={{ color: 'var(--success)' }}>
                                OCR {task.extractedCueCount ?? 0} cue · Dịch {task.translatedCueCount ?? 0} cue · TTS {task.generatedVoiceCount ?? 0} cue · Voice {task.voice || 'không xác định'} · Render FFmpeg hoàn tất
                              </div>
                            )}
                            {task.outputPath && (
                              <button
                                type="button"
                                className="btn ghost sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void window.api.openPath(task.outputPath || '')
                                }}
                              >
                                Mở output
                              </button>
                            )}
                            {task.percent > 0 && task.percent < 100 && (
                              <div className="queue-item-progress-bar">
                                <div className="queue-item-progress-fill" style={{ width: `${task.percent}%` }} />
                              </div>
                            )}
                          </div>
                          <div className="queue-item-actions">
                            <span className={`status-pill ${task.status === 'done' ? 'done' : task.status === 'error' ? 'error' : task.status === 'idle' ? 'idle' : 'working'}`}>
                              {task.status === 'idle'
                                ? 'Sẵn sàng'
                                : task.status === 'queued'
                                  ? 'Chờ'
                                  : task.status === 'done'
                                    ? 'Hoàn tất'
                                    : task.status === 'error'
                                      ? 'Lỗi'
                                      : 'Đang chạy'}
                            </span>
                            <button
                              className="btn ghost sm icon-btn"
                              disabled={isRunning}
                              onClick={(e) => removeTask(task.id, e)}
                              title="Xóa video này"
                              type="button"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {tasks.length > 0 && (
                    <button
                      className="btn ghost danger sm"
                      onClick={clearAllTasks}
                      disabled={isRunning}
                      type="button"
                      style={{ marginTop: 12, width: '100%' }}
                    >
                      Xóa tất cả video
                    </button>
                  )}
                  <button
                    className="btn ghost sm"
                    onClick={() => void clearAutoShortCache()}
                    disabled={isRunning || cacheAction}
                    type="button"
                    style={{ marginTop: 8, width: '100%' }}
                  >
                    {cacheAction ? 'Đang xóa cache…' : 'Xóa cache kết quả tái sử dụng'}
                  </button>
                </>
              )}
            </fieldset>
          </div>
        </aside>
      </div>

      {/* ========================================================================= */}
      {/* THANH XUẤT VIDEO (FOOTER EXPORT BAR)                                     */}
      {/* ========================================================================= */}
      <footer className="editor-exportbar">
        <div className="editor-export-state" style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="muted small">Lưu tại:</span>
            <span className="small" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={outputDir}>
              {outputDir || 'Chưa chọn thư mục'}
            </span>
            <button className="btn ghost sm" onClick={() => void chooseOutputDir()} disabled={isRunning} type="button">
              Đổi thư mục
            </button>
          </div>

          <div style={{ flex: 1, minWidth: 0, paddingLeft: 14, borderLeft: '1px solid var(--border)' }}>
            {isRunning ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span className="small" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                  {overallProgress.message || 'Đang xử lý video…'}
                </span>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 999, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      background: 'var(--progress-gradient)',
                      width: `${overallProgress.total > 0 ? (overallProgress.current / overallProgress.total) * 100 : 0}%`,
                      transition: 'width 0.2s ease'
                    }}
                  />
                </div>
              </div>
            ) : (
              <span className="muted small">
                {tasks.length > 0
                  ? `Sẵn sàng xử lý tự động ${tasks.length} video hàng loạt theo cấu hình đã chọn.`
                  : 'Hãy thêm video vào danh sách để bắt đầu tạo Auto Short.'}
              </span>
            )}
          </div>
        </div>

        {sttnPreviewRunning ? (
          <button className="btn danger" type="button" onClick={() => {
            ++sttnPreviewToken.current
            setSttnPreviewProgress({ percent: 0, message: 'Đang hủy xem thử STTN…' })
            void window.api.autoShortCancelSttnPreview().catch((error: unknown) => {
              setSttnPreviewProgress({ percent: 0, message: error instanceof Error ? error.message : 'Không thể hủy xem thử.' })
            })
          }}>Hủy xem thử STTN</button>
        ) : isRunning ? (
          <button className="btn danger" onClick={() => void cancelBatch()} type="button">
            ⛔ Dừng xử lý
          </button>
        ) : resumeSnapshot && resumeCandidateIds(resumeSnapshot).length > 0 ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" type="button" onClick={() => setResumeSnapshot(null)}>
              Bỏ checkpoint
            </button>
            <button
              className="btn primary"
              onClick={() => void startBatch(resumeSnapshot)}
              disabled={sttnPreviewRunning || dependencyInstalling}
              style={{ fontWeight: 700, padding: '10px 22px' }}
              type="button"
            >
              ▶ Tiếp tục {resumeCandidateIds(resumeSnapshot).length} video
            </button>
          </div>
        ) : (
          <button
            className="btn primary"
            onClick={() => void startBatch()}
            disabled={tasks.length === 0 || sttnPreviewRunning || dependencyInstalling}
            style={{ fontWeight: 700, padding: '10px 22px' }}
            type="button"
          >
            ⚡ Bắt đầu chạy Auto Short
          </button>
        )}
      </footer>

      {showDependencyModal && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!dependencyInstalling) setShowDependencyModal(false)
          }}
        >
          <div className="modal" style={{ maxWidth: 560 }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>Chuẩn bị Auto Short</h3>
              {!dependencyInstalling && (
                <button className="btn ghost sm" type="button" onClick={() => setShowDependencyModal(false)}>Đóng</button>
              )}
            </div>
            <div className="modal-list" style={{ display: 'grid', gap: 10 }}>
              <p className="muted small" style={{ margin: 0 }}>
                {readiness?.message || 'Kiểm tra engine và model trước khi chạy. Auto Short sẽ không tải ngầm trong lúc render video.'}
              </p>
              {(readiness?.stageCapabilities || []).length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                  <strong>Khả năng theo từng bước</strong>
                  <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                    {readiness?.stageCapabilities?.map((stage) => {
                      const state = stage.support === 'supported' && stage.qualified
                        ? 'Sẵn sàng'
                        : stage.support === 'unsupported'
                          ? 'Chưa hỗ trợ'
                          : 'Chưa đủ bằng chứng'
                      const label = stage.required ? `${stage.stage} · bắt buộc` : stage.stage
                      return (
                        <div key={stage.stage} className="muted small" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          <span>{label}</span>
                          <span>{state}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {(readiness?.dependencies || []).map((item) => {
                const progress = dependencyProgress[item.id]
                return (
                  <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <strong>{item.ready ? '✓ ' : '○ '}{item.label}</strong>
                      <span className="muted small">{item.ready ? 'Sẵn sàng' : formatBytes(item.downloadBytes)}</span>
                    </div>
                    {(progress?.message || item.message) && (
                      <div className="muted small" style={{ marginTop: 4 }}>{progress?.message || item.message}</div>
                    )}
                    {progress && progress.percent >= 0 && progress.phase !== 'done' && (
                      <div style={{ height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 999, overflow: 'hidden', marginTop: 8 }}>
                        <div style={{ height: '100%', width: `${progress.percent}%`, background: 'var(--progress-gradient)' }} />
                      </div>
                    )}
                  </div>
                )
              })}
              {dependencyError && <div className="small" style={{ color: 'var(--danger)' }}>{dependencyError}</div>}
            </div>
            <div className="modal-foot">
              {dependencyInstalling ? (
                <button className="btn danger" type="button" onClick={() => void cancelDependencyInstall()}>Hủy tải</button>
              ) : (
                <button className="btn primary" type="button" onClick={() => void installDependencies()}>Tải thành phần cần thiết</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
