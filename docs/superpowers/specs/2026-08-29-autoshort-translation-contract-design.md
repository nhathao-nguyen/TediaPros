# Auto Short Translation Contract Design

**Date:** 2026-08-29
**Status:** Draft for implementation in the current task

## Problem

Auto Short currently extracts cues, sends each provider a locally numbered batch, and then restores source timing by array position. The translation request does not carry a stable source cue identity, an explicit source-language hint, or adjacent cue context. The local provider also derives the source language with a narrow script heuristic and contains a target-specific Han-character repair. TTS language selection has a Vietnamese fallback even when the source/target configuration does not request Vietnamese. These behaviors can produce plausible-looking output while silently losing cue identity, context, or the selected language.

The current packaged UI run also exposed a separate observability defect: a preflight failure is reduced to the generic user-facing label `lỗi không xác định`, so the failing stage cannot be identified from the UI or the safe application log.

## Goals

- Carry source-language intent and detected language from Whisper through Auto Short translation and TTS without hardcoding a source, target, phrase, provider, or endpoint.
- Give every provider the same stable cue contract: global cue id/index, source text, source/target language codes, and bounded read-only neighboring context.
- Validate provider responses against stable cue identities, reject duplicate/missing/unknown cues, preserve source cue order and timestamps locally, and never let provider output alter timing.
- Keep the original source SRT, translated SRT, TTS-timed SRT, TTS timeline, and final video available as an auditable artifact set for a run.
- Make preflight and item failures identify the sanitized stage and reason without exposing credentials or raw remote responses.
- Preserve the renderer → preload/IPC → main/worker → local service → FFmpeg layering and legacy config compatibility.

## Non-goals

- No changes to `tts-server`, its repository, UI, models, database, or runtime.
- No new cloud provider, endpoint, model, voice, or language catalog.
- No phrase-specific repair table or language-specific output rewrite.
- No fabricated word timings for TTS audio.

## Contract

The shared translation request is represented by a main-process-only context object:

```ts
interface TranslationContext {
  sourceLanguage: string | null
  targetLanguage: string
  cues: Array<{
    id: string
    sourceIndex: number
    text: string
    contextBefore: string[]
    contextAfter: string[]
  }>
}
```

`sourceLanguage` is the explicit configured Whisper language when present, otherwise Whisper's detected language when the engine reports one, otherwise `null`/`auto`. OCR-only and mixed extraction must not infer a language from a script-specific repair rule. `targetLanguage` is always the selected Auto Short target. Neighbor context is bounded and is supplied only to improve interpretation; only the current cue ids may appear in the response.

Provider adapters receive the same context shape. Their wire payload may remain provider-specific, but each adapter must include:

- source and target language codes;
- a stable `id`/`sourceIndex` for every current cue;
- current cue text and bounded neighboring context;
- an instruction to return exactly one translation per current cue and no context-only cue.

The response parser accepts only the documented structured response for that adapter and returns `{ id, text }[]`. It rejects duplicate ids, unknown ids, missing ids, empty text, and count mismatches. Auto Short reconstructs the output by source cue id/order and copies `start`, `end`, and source metadata from the input SRT. A provider cannot reorder, stretch, or shorten timing.

## Language and TTS resolution

- The UI exposes an explicit source-language setting with an `auto` option and the existing supported language catalog.
- The selected source setting is serialized as `whisperLanguage` through the existing Auto Short config contract.
- Whisper returns its engine-reported detected language in `WhisperResult`; the Auto Short main flow retains it for translation/TTS resolution.
- TTS language is resolved in this order: explicit `ttsLanguage`, selected translation target when translation is enabled, detected/configured source language, then a model-declared default if the selected model exposes one. If no concrete language is available, preflight returns a clear configuration error instead of guessing.
- No `vi` fallback is used in the main flow. Existing Vietnamese model/voice values remain UI defaults only where they are already persisted and explicitly selected; changing source/target must update the request language.

## Artifact retention and diagnostics

Each successful or failed item copies the run's non-secret audit files to an item-specific directory under the selected output directory. The set includes source SRT, translated SRT when requested, timed SRT when TTS is enabled, a JSON TTS timeline/voice summary, and a sanitized run manifest containing cue counts, source/target language resolution, provider/model identifiers, and output paths. Raw API keys, authorization headers, cookies, and response bodies are excluded. Temporary synthesis clips remain private to the temp work directory unless needed to diagnose a failed run.

Preflight errors retain a stage label (`output`, `dependencies`, `translation`, `tts-health`, `tts-model`, or `language`) and a bounded sanitized message. UI status uses this label rather than collapsing every non-network error into the same generic string.

## Verification

- Red tests cover explicit source propagation, generic language-aware prompt/context construction, stable cue-id response validation, no language-specific Han repair, and no Vietnamese TTS fallback.
- Green tests cover local/OpenAI/Gemini adapter request construction and source-time reconstruction.
- Typecheck, local runtime tests, subtitle smoke, and production build must pass.
- Source, rebuilt `out/`, package resources, and the launched Auto Short runtime must be compared after the build.
- A fresh Computer Use run must use a new isolated output directory, prove the UI selection and queue, show extraction → translation → TTS → render progress, and produce a final H.264/AAC video plus the complete artifact set. Every source/target cue must be compared for count, stable identity, timing, and text presence. Subjective listening quality remains explicitly unverified unless listened to.
