import type { CSSProperties, JSX } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_AI_SERVER_URL,
  DICH_LANGS,
  type AutoShortConfig,
  type AutoShortBackgroundMusicConfig,
  type AutoShortBackgroundMusicMode,
  type AutoShortDependencyProgress,
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
  type WhisperDevice
} from '../../../shared/types'
import { createAutoShortMusicAssignments } from '../../../shared/autoShortBackgroundMusic'
import { localMediaSource } from '../lib/localMedia'
import { useTabOutputDir } from '../lib/outputDir'
import { usePersistedState } from '../lib/persist'
import { fitVideoInBounds } from '../lib/videoGeometry'
import { useVideoTransport } from '../hooks/useVideoTransport'
import RegionBox, { type Region } from './RegionBox'

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

function defaultSubtitleRegion(width: number, height: number): Region {
  const portrait = height > width
  return {
    x0: Math.round(width * 0.08),
    x1: Math.round(width * 0.92),
    y0: Math.round(height * (portrait ? 0.78 : 0.80)),
    y1: Math.round(height * (portrait ? 0.90 : 0.92))
  }
}

function defaultOcrRegion(width: number, height: number): Region {
  const portrait = height > width
  return {
    x0: 0,
    x1: width,
    y0: Math.round(height * (portrait ? 0.72 : 0.74)),
    y1: Math.round(height * (portrait ? 0.92 : 0.94))
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
  const [tasks, setTasks] = useState<AutoShortTaskItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedTask = useMemo(() => {
    return tasks.find((t) => t.id === selectedId) || tasks[0] || null
  }, [tasks, selectedId])

  // Tab công cụ Inspector
  const [tool, setTool] = useState<EditorTool>('subtitle')

  // Trạng thái Video Preview & Bounding Box
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stageShellRef = useRef<HTMLDivElement | null>(null)
  const previewPanelRef = useRef<HTMLElement | null>(null)

  const [videoH, setVideoH] = useState(0)
  const [videoW, setVideoW] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [boxH, setBoxH] = useState(0)
  const [boxW, setBoxW] = useState(0)
  const [previewStageSize, setPreviewStageSize] = useState<PreviewStageSize>({ width: 0, height: 0 })
  const [isStageFullscreen, setIsStageFullscreen] = useState(false)

  // Transport hook
  const transport = useVideoTransport(videoRef, selectedTask?.filePath || null)

  // Subtitle Region & Styles
  const [subtitleRegion, setSubtitleRegion] = useState<Region | undefined>()
  // OCR source region is independent from the output subtitle safe-area.
  const [ocrRegion, setOcrRegion] = useState<Region | undefined>()
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
  const [translateProvider, setTranslateProvider] = usePersistedState<DichProvider>(
    'tblao.autoshort.transProvider',
    'local'
  )
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [keyTesting, setKeyTesting] = useState(false)
  const [keyFeedback, setKeyFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [showKeyText, setShowKeyText] = useState(false)

  // Blur Regions
  const [blurEnabled, setBlurEnabled] = useState(true)
  const [blurRegions, setBlurRegions] = useState<BlurRegion[]>([])
  const [activeBlurId, setActiveBlurId] = useState<string | null>(null)

  // TTS AI Voice
  const [ttsEnabled, setTtsEnabled] = usePersistedState('tblao.autoshort.ttsEnabled', true)
  const [ttsServerUrl, setTtsServerUrl] = usePersistedState('tblao.ai.serverUrl', DEFAULT_AI_SERVER_URL)
  const [ttsModel, setTtsModel] = usePersistedState('tblao.autoshort.ttsModel', 'tts-vietnamese')
  const [ttsVoice, setTtsVoice] = usePersistedState('tblao.autoshort.ttsVoice', 'Minh Đức')
  const [ttsSpeed, setTtsSpeed] = usePersistedState('tblao.autoshort.ttsSpeed', 1.0)
  const [clonedVoices] = usePersistedState<ClonedVoice[]>('tblao.tts.clonedVoices', [])
  const [serverOnline, setServerOnline] = useState<boolean | null>(null)
  const [ttsModels, setTtsModels] = useState<TtsModelInfo[]>([])
  const [voiceOverMode, setVoiceOverMode] = usePersistedState('tblao.autoshort.voiceOverMode', false)
  const [audioMode, setAudioMode] = usePersistedState<'replace' | 'mix'>('tblao.autoshort.audioMode', 'replace')
  const [originalAudioVolume, setOriginalAudioVolume] = usePersistedState('tblao.autoshort.origVol', 20)
  const [backgroundMusicEnabled, setBackgroundMusicEnabled] = usePersistedState('tblao.autoshort.bgMusic.enabled', false)
  const [backgroundMusicFolder, setBackgroundMusicFolder] = usePersistedState('tblao.autoshort.bgMusic.folder', '')
  const [backgroundMusicMode, setBackgroundMusicMode] = usePersistedState<AutoShortBackgroundMusicMode>('tblao.autoshort.bgMusic.mode', 'single')
  const [backgroundMusicVolume, setBackgroundMusicVolume] = usePersistedState('tblao.autoshort.bgMusic.volume', 15)
  const [backgroundMusicSingleTrack, setBackgroundMusicSingleTrack] = usePersistedState('tblao.autoshort.bgMusic.singleTrack', '')
  const [backgroundMusicTracks, setBackgroundMusicTracks] = useState<AutoShortMusicTrack[]>([])
  const [backgroundMusicAssignments, setBackgroundMusicAssignments] = useState<Record<string, string>>({})
  const [backgroundMusicError, setBackgroundMusicError] = useState<string | null>(null)

  const selectedModelInfo = ttsModels.find((m) => m.id === ttsModel) || ttsModels[0]
  const modelVoices = selectedModelInfo?.voices || []
  const defaultVoice = selectedModelInfo?.default_voice || (modelVoices[0] || 'default')

  useEffect(() => {
    let active = true
    if (!backgroundMusicFolder) return
    void window.api.autoShortListMusicTracks(backgroundMusicFolder).then((result) => {
      if (!active) return
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
      if (active) setBackgroundMusicError('Không thể quét folder nhạc.')
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
            setTtsModels(availableTts)
            const matching = availableTts.find((m) => m.id === ttsModel)
            if (!matching && availableTts.length > 0) {
              const fallback = availableTts.find((m) => m.available !== false) || availableTts[0]
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
  }, [ttsServerUrl])

  // Batch Execution State
  const [isRunning, setIsRunning] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
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

  const applyItemResult = useCallback((event: AutoShortEvent): void => {
    if (event.type === 'item-progress') {
      setTasks((prev) => prev.map((item) => item.id === event.itemId ? {
        ...item,
        status: event.itemStatus,
        percent: event.itemPercent,
        currentStepMessage: event.itemMessage,
        outputPath: event.outputPath || item.outputPath,
        error: event.error || item.error
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
        currentStepMessage: result.status === 'done' ? 'Hoàn tất xuất video' : result.error || (result.status === 'cancelled' ? 'Đã hủy tác vụ' : 'Xử lý thất bại'),
        outputPath: result.outputPath || item.outputPath,
        artifactDir: result.artifactDir || item.artifactDir,
        error: result.error,
        extractedCueCount: result.extractedCueCount,
        translatedCueCount: result.translatedCueCount,
        generatedVoiceCount: result.generatedVoiceCount,
        voice: result.voice
      } : item))
      return
    }
    if (event.type !== 'batch-done') return
    setOverallProgress({
      current: event.totalCount,
      total: event.totalCount,
      message: event.cancelledCount > 0
        ? `Đã dừng: ${event.completedCount}/${event.totalCount} video hoàn tất`
        : `Đã xử lý ${event.completedCount}/${event.totalCount} video`
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

  // Check TTS server health and load capabilities
  useEffect(() => {
    let active = true
    const check = async (): Promise<void> => {
      try {
        const h = await window.api.ttsCheckHealth(ttsServerUrl)
        if (active) setServerOnline(h.ok)
        if (h.ok) {
          const mRes = await window.api.ttsGetModels(ttsServerUrl)
          if (active && mRes.ok && mRes.models.length > 0) {
            setTtsModels(mRes.models)
          }
        }
      } catch {
        if (active) setServerOnline(false)
      }
    }
    void check()
    const timer = setInterval(() => {
      void check()
    }, 10000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [ttsServerUrl])

  useEffect(() => {
    if (!selectedModelInfo) return
    if (!ttsVoice.startsWith('clone:') && !modelVoices.includes(ttsVoice) && ttsVoice !== defaultVoice) {
      setTtsVoice(defaultVoice)
    }
  }, [selectedModelInfo?.id])

  // Lắng nghe event discriminated union của job hiện tại.
  useEffect(() => {
    const unsub = window.api.onAutoShortEvent((event: AutoShortEvent) => {
      if (activeJobId && event.jobId !== activeJobId) return
      applyItemResult(event)
    })
    return unsub
  }, [activeJobId, applyItemResult])

  const refreshAutoShortReadiness = useCallback(async (): Promise<AutoShortReadiness | null> => {
    try {
      const next = await window.api.autoShortGetReadiness({ subtitleMethod, whisperModel: selectedWhisperModel, whisperDevice })
      setReadiness(next)
      return next
    } catch {
      setReadiness(null)
      return null
    }
  }, [selectedWhisperModel, subtitleMethod, whisperDevice])

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

    const fitted = fitVideoInBounds(videoW, videoH, availableW, availableH)
    if (fitted) {
      setPreviewStageSize(fitted)
      setBoxW(fitted.width)
      setBoxH(fitted.height)
    }
  }, [videoH, videoW])

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
    if (selectedId === id) setSelectedId(null)
  }

  const clearAllTasks = (): void => {
    setTasks([])
    setSelectedId(null)
    setVideoW(0)
    setVideoH(0)
  }

  const chooseBackgroundMusicFolder = async (): Promise<void> => {
    const result = await window.api.autoShortSelectMusicFolder()
    if (!result.ok) {
      if (result.error !== 'Đã hủy chọn folder nhạc.') setBackgroundMusicError(result.error)
      return
    }
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
    const w = videoW > 0 ? videoW : 1280
    const h = videoH > 0 ? videoH : 720
    const portrait = h > w
    const color = PALETTE[blurRegions.length % PALETTE.length]
    const newBox: BlurRegion = {
      id: crypto.randomUUID(),
      x0: Math.round(w * 0.05),
      y0: Math.round(h * (portrait ? 0.78 : 0.80)),
      x1: Math.round(w * 0.95),
      y1: Math.round(h * (portrait ? 0.92 : 0.94)),
      color
    }
    setBlurRegions((prev) => [...prev, newBox])
    setActiveBlurId(newBox.id)
    setBlurEnabled(true)
    setTool('blur')
  }

  const updateBlurRegion = (r: BlurRegion): void => {
    const w = videoW > 0 ? videoW : 1280
    const h = videoH > 0 ? videoH : 720
    const clamped: BlurRegion = {
      ...r,
      x0: Math.max(0, Math.min(w, r.x0)),
      y0: Math.max(0, Math.min(h, r.y0)),
      x1: Math.max(0, Math.min(w, r.x1)),
      y1: Math.max(0, Math.min(h, r.y1))
    }
    setBlurRegions((prev) => prev.map((b) => (b.id === r.id ? clamped : b)))
  }

  const removeBlurRegion = (id: string): void => {
    setBlurRegions((prev) => prev.filter((b) => b.id !== id))
    if (activeBlurId === id) setActiveBlurId(null)
  }

  const updateSubRegionClamped = (r: Region): void => {
    const w = videoW > 0 ? videoW : 1280
    const h = videoH > 0 ? videoH : 720
    setSubtitleRegion({
      x0: Math.max(0, Math.min(w, r.x0)),
      y0: Math.max(0, Math.min(h, r.y0)),
      x1: Math.max(0, Math.min(w, r.x1)),
      y1: Math.max(0, Math.min(h, r.y1))
    })
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
  const startBatch = async (): Promise<void> => {
    if (tasks.length === 0 || isRunning) return
    let backgroundMusicConfig: AutoShortBackgroundMusicConfig | undefined
    if (ttsEnabled && audioMode === 'replace' && backgroundMusicEnabled) {
      const assignmentResult = createAutoShortMusicAssignments({
        mode: backgroundMusicMode,
        itemIds: tasks.map((task) => task.id),
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

    const status = await refreshAutoShortReadiness()
    if (!status || !status.ready) {
      setDependencyError(status?.message || 'Không thể kiểm tra dependency Auto Short.')
      setShowDependencyModal(true)
      return
    }

    setIsRunning(true)
    setOverallProgress({ current: 0, total: tasks.length, message: 'Đang khởi động tiến trình hàng loạt…' })

    setTasks((prev) =>
      prev.map((t) => ({
        ...t,
        status: 'queued',
        percent: 0,
        currentStepMessage: 'Đang trong hàng đợi…'
      }))
    )

    const w = videoW > 0 ? videoW : 1280
    const h = videoH > 0 ? videoH : 720
    const sub = subtitleRegion || defaultSubtitleRegion(w, h)
    const ocr = ocrRegion || defaultOcrRegion(w, h)

    const clampedSub = {
      x0: Math.max(0, Math.min(w, Math.round(sub.x0))),
      y0: Math.max(0, Math.min(h, Math.round(sub.y0))),
      x1: Math.max(0, Math.min(w, Math.round(sub.x1))),
      y1: Math.max(0, Math.min(h, Math.round(sub.y1)))
    }

    const clampedBlurs = blurRegions.map((b) => ({
      ...b,
      x0: Math.max(0, Math.min(w, Math.round(b.x0))),
      y0: Math.max(0, Math.min(h, Math.round(b.y0))),
      x1: Math.max(0, Math.min(w, Math.round(b.x1))),
      y1: Math.max(0, Math.min(h, Math.round(b.y1)))
    }))

    const activeClonedVoice = clonedVoices.find((cv) => `clone:${cv.id}` === ttsVoice || cv.id === ttsVoice)
    const toNormalized = (region: Region) => ({
      x0: Math.max(0, Math.min(1, region.x0 / w)),
      y0: Math.max(0, Math.min(1, region.y0 / h)),
      x1: Math.max(0, Math.min(1, region.x1 / w)),
      y1: Math.max(0, Math.min(1, region.y1 / h))
    })

    const config: AutoShortConfig = {
      subtitleMethod,
      whisperModel: selectedWhisperModel,
      whisperDevice,
      whisperLanguage: whisperLanguage.trim() || 'auto',
      ocrRegion: toNormalized({
        x0: Math.max(0, Math.min(w, Math.round(ocr.x0))),
        y0: Math.max(0, Math.min(h, Math.round(ocr.y0))),
        x1: Math.max(0, Math.min(w, Math.round(ocr.x1))),
        y1: Math.max(0, Math.min(h, Math.round(ocr.y1)))
      }),
      blurRegions: clampedBlurs.map((region) => ({ ...toNormalized(region), id: region.id, color: region.color })),
      lamMo: blurEnabled,
      subRegion: toNormalized(clampedSub),
      fontId: fontId === 'auto' ? null : fontId,
      textColor,
      outlineColor,
      outlinePx,
      bgEnabled,
      bgColor,
      bgOpacity,
      subtitleDisplayStyle: (subtitleMethod !== 'ocr' && translateTarget === 'none' && !ttsEnabled) ? displayStyle : 'standard',
      subtitleFontSize: fontSize > 0 ? fontSize : undefined,
      subtitleFontScale: fontSize > 0 ? fontSize / h : undefined,
      highlightColor,
      subtitleHighlightPop: highlightPop,
      subtitleLayoutProfile: layoutProfile,
      subtitleAutoOptimize: autoOptimize,
      outlineScale: outlinePx / h,
      translateTarget,
      translateProvider,
      translateServerUrl: ttsServerUrl,
      ttsEnabled,
      ttsServerUrl,
      ttsModel,
      ttsVoice: activeClonedVoice ? activeClonedVoice.name : ttsVoice,
      ttsRefAudioPath: activeClonedVoice ? activeClonedVoice.referenceAudioPath : undefined,
      ttsRefTranscript: activeClonedVoice ? activeClonedVoice.referenceTranscript : undefined,
      ttsLanguage: translateTarget !== 'none' ? translateTarget : whisperLanguage.trim() || undefined,
      ttsSpeed,
      voiceOverMode,
      audioMode,
      originalAudioVolume,
      backgroundMusic: backgroundMusicConfig,
      outputDir
    }

    const started = await window.api.autoShortStart({
      config,
      items: tasks.map((task) => ({ id: task.id, filePath: task.filePath }))
    })
    if (!started.ok) {
      setIsRunning(false)
      setOverallProgress((prev) => ({ ...prev, message: started.error }))
      return
    }
    setActiveJobId(started.jobId)
  }

  const cancelBatch = async (): Promise<void> => {
    if (!activeJobId) return
    const result = await window.api.autoShortCancel(activeJobId)
    if (!result.ok) {
      setOverallProgress((prev) => ({ ...prev, message: result.error || 'Không thể dừng tác vụ' }))
    }
  }

  const chooseOutputDir = async (): Promise<void> => {
    const dir = await window.api.chooseFolder()
    if (dir) setOutputDir(dir)
  }

  const installDependencies = async (): Promise<void> => {
    setDependencyInstalling(true)
    setDependencyError(null)
    setDependencyProgress({})
    try {
      const result = await window.api.autoShortInstallDependencies({ subtitleMethod, whisperModel: selectedWhisperModel, whisperDevice })
      if (!result.ok) throw new Error(result.error || 'Không thể chuẩn bị dependency.')
      const next = await refreshAutoShortReadiness()
      if (!next?.ready) throw new Error(next?.message || 'Dependency chưa sẵn sàng sau khi tải.')
      setShowDependencyModal(false)
      // Tự động tiếp tục chạy flow Auto Short vừa bấm trước đó
      void startBatch()
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
          className="editor-canvas-panel"
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

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
              <div
                className="ocr-video editor-stage-video"
                style={
                  videoW > 0 && videoH > 0
                    ? ({
                      aspectRatio: `${videoW} / ${videoH}`,
                      width: previewStageSize.width > 0 ? `${previewStageSize.width}px` : undefined,
                      height: previewStageSize.height > 0 ? `${previewStageSize.height}px` : undefined,
                      overflow: 'hidden'
                    } as CSSProperties)
                    : undefined
                }
              >
                <video
                  ref={videoRef}
                  crossOrigin="anonymous"
                  src={localMediaSource(selectedTask.filePath)}
                  onLoadedMetadata={(e) => {
                    const target = e.currentTarget
                    const w = target.videoWidth || 1280
                    const h = target.videoHeight || 720
                    setVideoW(w)
                    setVideoH(h)
                    if (Number.isFinite(target.duration)) setVideoDuration(target.duration)
                    if (!subtitleRegion) setSubtitleRegion(defaultSubtitleRegion(w, h))
                    if (!ocrRegion) setOcrRegion(defaultOcrRegion(w, h))
                    measureStage()
                  }}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onClick={() => void transport.togglePlayback()}
                  style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill' }}
                />

                {videoH > 0 && previewStageSize.width > 0 && (
                  <RegionBox
                    regions={blurEnabled ? blurRegions : []}
                    activeId={activeBlurId}
                    setActiveId={setActiveBlurId}
                    updateRegion={updateBlurRegion}
                    removeRegion={removeBlurRegion}
                    blurInteractive={tool === 'blur'}
                    hienSubBox={true}
                    subInteractive={tool === 'subtitle'}
                    subRegion={subtitleRegion || defaultSubtitleRegion(videoW, videoH)}
                    setSubRegion={updateSubRegionClamped}
                    hienOcrBox={subtitleMethod === 'ocr' || subtitleMethod === 'whisper-ocr'}
                    ocrRegion={ocrRegion || defaultOcrRegion(videoW, videoH)}
                    setOcrRegion={(region) => {
                      const w = videoW > 0 ? videoW : 1280
                      const h = videoH > 0 ? videoH : 720
                      setOcrRegion({
                        x0: Math.max(0, Math.min(w, region.x0)),
                        y0: Math.max(0, Math.min(h, region.y0)),
                        x1: Math.max(0, Math.min(w, region.x1)),
                        y1: Math.max(0, Math.min(h, region.y1))
                      })
                    }}
                    videoH={videoH}
                    videoW={videoW}
                    boxH={boxH}
                    boxW={boxW}
                    xemMo={blurEnabled && tool === 'blur'}
                    showBlurEffect={blurEnabled}
                    previewFontFamily={previewFontFamily || undefined}
                    subtitleText="Mẫu chữ xuất ra"
                    subtitleDisplayStyle={displayStyle}
                    subtitleFontSize={fontSize > 0 ? fontSize : undefined}
                    highlightColor={highlightColor}
                    highlightPop={highlightPop}
                    textColor={textColor}
                    outlineColor={outlineColor}
                    outlinePx={outlinePx}
                    bgEnabled={bgEnabled}
                    bgColor={bgColor}
                    bgOpacity={bgOpacity}
                    showSafeArea={showSafeArea}
                  />
                )}
              </div>
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
            <fieldset disabled={isRunning} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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

                  {translateTarget !== 'none' && (
                    <>
                      <label className="field editor-field">
                        <span>Bộ dịch AI</span>
                        <select
                          value={translateProvider}
                          onChange={(e) => setTranslateProvider(e.target.value as DichProvider)}
                        >
                          <option value="local">AI nội bộ (TTS-Server)</option>
                          <option value="gemini">Google Gemini AI</option>
                          <option value="openai">OpenAI (ChatGPT)</option>
                        </select>
                      </label>

                      <div className="autoshort-key-card">
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
                    <span>Cỡ chữ · {fontSize === 0 ? 'Tự động theo khung' : `${fontSize}px`}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input
                        type="range"
                        min={0}
                        max={80}
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
                    <span>Độ dày viền · {outlinePx}px</span>
                    <input
                      type="range"
                      min={0}
                      max={8}
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
                      <strong>Vùng làm mờ</strong>
                      <small>Kéo vùng màu trên video để che phụ đề hoặc logo cũ.</small>
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

                  <button className="btn editor-wide-action" onClick={addBlurRegion} type="button">
                    + Thêm vùng làm mờ
                  </button>

                  <div className="blur-list">
                    {blurRegions.length === 0 ? (
                      <div className="muted small" style={{ padding: '12px 0', textAlign: 'center' }}>
                        Chưa có vùng làm mờ nào. Nhấp "+ Thêm vùng làm mờ" để tạo vùng che.
                      </div>
                    ) : (
                      blurRegions.map((region, index) => (
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
                    </div>
                  </label>

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

                  {audioMode === 'replace' && (
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
                            {task.error && <div className="queue-item-msg" style={{ color: 'var(--danger)' }}>{task.error}</div>}
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

        {isRunning ? (
          <button className="btn danger" onClick={() => void cancelBatch()} type="button">
            ⛔ Dừng xử lý
          </button>
        ) : (
          <button
            className="btn primary"
            onClick={() => void startBatch()}
            disabled={tasks.length === 0}
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
