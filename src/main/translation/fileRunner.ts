import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { parseSrt, serializeSrt, type SubtitleCue } from '../../shared/subtitles'
import { translationGuidanceError, type TranslationAssessment, type TranslationInput, type TranslationItem } from '../../shared/translation'
import type { TranslationBudgetSnapshot } from './budget'
import { mapTranslationsStrict } from './response'
import { assessTranslationLanguage } from './language'
import { createInvalidSourceAssessment, translateWithAdapter, type TranslationAdapter } from './orchestrator'

export interface TranslationFileRunnerOptions {
  sourceLanguage?: string | null
  mode?: 'subtitle' | 'dubbing'
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
  onBatch?: (items: readonly TranslationItem[], batchIndex: number) => Promise<void> | void
  onBudget?: (snapshot: TranslationBudgetSnapshot) => Promise<void> | void
  resumeItems?: readonly TranslationItem[]
  restoredBudget?: TranslationBudgetSnapshot
  translationGuidance?: import('../../shared/translation').TranslationGuidance
}

export interface TranslationFileRunnerResult {
  ok: boolean
  error?: string
  count?: number
  assessment?: Awaited<ReturnType<typeof translateWithAdapter>>['assessment']
  budget?: TranslationBudgetSnapshot
  modelIdentity?: string
}

function mergeLanguageAssessment(
  base: TranslationAssessment,
  input: TranslationInput,
  items: readonly TranslationItem[]
): TranslationAssessment {
  const language = assessTranslationLanguage(input, items)
  const issues = [...base.issues, ...language.issues].filter((item, index, all) => all.findIndex((candidate) =>
    candidate.code === item.code && candidate.message === item.message && candidate.cueIds.join(',') === item.cueIds.join(',')) === index)
  return {
    ...base,
    disposition: base.disposition === 'needs-review'
      ? 'needs-review'
      : issues.length > 0 ? 'with-warnings' : 'validated',
    issues,
    languageEvidence: language.languageEvidence
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Translation cancelled.')
}

function toTranslationCue(cue: SubtitleCue, index: number): TranslationInput['cues'][number] {
  return {
    id: cue.id.trim(),
    sourceIndex: Number.isInteger(cue.sourceIndex) ? cue.sourceIndex : index,
    start: cue.start,
    end: cue.end,
    text: cue.text,
    groupId: `cue-${Number.isInteger(cue.sourceIndex) ? cue.sourceIndex : index}`
  }
}

/** Run the bounded provider-neutral scheduler against an SRT file. */
export async function translateFileWithAdapter(
  inputPath: string,
  outputPath: string,
  targetLocale: string,
  adapter: TranslationAdapter,
  options: TranslationFileRunnerOptions = {}
): Promise<TranslationFileRunnerResult> {
  try {
    throwIfAborted(options.signal)
    const guidanceError = translationGuidanceError(options.translationGuidance)
    if (guidanceError) throw new Error(guidanceError)
    const parsed = parseSrt(await readFile(inputPath, 'utf8'))
    if (parsed.warnings.length > 0) throw new Error(`SRT nguồn có dòng không hợp lệ: ${parsed.warnings[0]?.message || 'parser warning'}`)
    const source = parsed.cues.filter((cue) => cue.text.trim())
    if (source.length === 0) throw new Error('File phụ đề trống hoặc không đúng định dạng SRT.')
    const sourceIds = new Set(source.map((cue) => cue.id.trim()))
    const reusableById = new Map<string, TranslationItem>()
    for (const item of options.resumeItems || []) {
      const id = item.id.trim()
      const text = item.text.trim()
      if (id && text && sourceIds.has(id) && !reusableById.has(id)) reusableById.set(id, { id, text })
    }
    const reusable = source.map((cue) => reusableById.get(cue.id.trim())).filter((item): item is TranslationItem => Boolean(item))
    const pending = source.filter((cue) => !reusableById.has(cue.id.trim()))
    const full = source.map(toTranslationCue)
    const fullInput: TranslationInput = {
      sourceLanguage: options.sourceLanguage?.trim() || 'auto',
      targetLocale: targetLocale.trim(),
      mode: options.mode || 'subtitle',
      cues: full,
      contextBefore: [],
      contextAfter: [],
      glossary: options.translationGuidance?.glossary.map(entry => ({ ...entry })) || [],
      synopsis: options.translationGuidance?.synopsis
    }
    if (pending.length === 0) {
      options.onProgress?.(source.length, source.length)
      const mapped = mapTranslationsStrict(source, reusable)
      const assessment = mergeLanguageAssessment({
        version: 'translation-assessment-v2',
        disposition: 'validated',
        issues: [],
        languageEvidence: 'unknown'
      }, fullInput, reusable)
      const temporary = `${outputPath}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, serializeSrt(mapped), 'utf8')
        await rename(temporary, outputPath)
      } finally {
        await rm(temporary, { force: true }).catch(() => {})
      }
      return { ok: true, count: mapped.length, assessment, modelIdentity: adapter.capability.modelIdentity }
    }

    const acceptedIds = new Set(reusable.map((item) => item.id))
    let batchIndex = 0
    const run = await translateWithAdapter(fullInput, adapter, options.signal || new AbortController().signal, {
      restoredBudget: options.restoredBudget,
      resumeItems: reusable,
      beforeDispatch: options.onBudget,
      onBatch: async (_batchId, result, budget) => {
        await options.onBudget?.(budget)
        for (const item of result.items) acceptedIds.add(item.id)
        options.onProgress?.(acceptedIds.size, source.length)
        await options.onBatch?.(result.items, batchIndex++)
      }
    })
    throwIfAborted(options.signal)
    if (run.assessment.disposition === 'needs-review') {
      const firstIssue = run.assessment.issues.find((item) => item.severity === 'error')
      return {
        ok: false,
        error: firstIssue?.message || 'Bản dịch không vượt qua kiểm tra.',
        assessment: run.assessment,
        budget: run.budget,
        modelIdentity: run.modelIdentity
      }
    }
    const byId = new Map<string, TranslationItem>(reusable.map((item) => [item.id, item]))
    for (const item of run.items) byId.set(item.id, item)
    const merged = source.map((cue) => byId.get(cue.id.trim())).filter((item): item is TranslationItem => Boolean(item))
    if (merged.length !== source.length) return { ok: false, error: 'Bản dịch không đủ cue nguồn.', assessment: run.assessment, budget: run.budget, modelIdentity: run.modelIdentity }
    const mapped = mapTranslationsStrict(source, merged)
    const assessment = mergeLanguageAssessment(run.assessment, fullInput, merged)
    const temporary = `${outputPath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, serializeSrt(mapped), 'utf8')
      await rename(temporary, outputPath)
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
    return { ok: true, count: mapped.length, assessment, budget: run.budget, modelIdentity: run.modelIdentity }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const structured = error && typeof error === 'object'
      ? error as { translationAssessment?: TranslationAssessment; translationBudget?: TranslationBudgetSnapshot; modelIdentity?: string }
      : undefined
    if (structured?.translationAssessment) {
      return {
        ok: false,
        error: message,
        assessment: structured.translationAssessment,
        ...(structured.translationBudget ? { budget: structured.translationBudget } : {}),
        ...(structured.modelIdentity ? { modelIdentity: structured.modelIdentity } : {})
      }
    }
    if (/SRT nguồn|File phụ đề trống|không đúng định dạng SRT/iu.test(message)) {
      return { ok: false, error: message, assessment: createInvalidSourceAssessment(message) }
    }
    return { ok: false, error: message }
  }
}
