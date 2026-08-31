# Auto Short: Source-Anchored Dubbing Design

## Goal

Make Auto Short use one source-anchored `DubbingPlan` as the contract between extraction, translation, TTS, subtitle generation, and FFmpeg rendering. The plan must preserve every source cue start, allow voice to use permitted gaps without entering the next cue's protected margin, and reject any cue that cannot fit without silently moving anchors or cutting speech.

## Scope and constraints

- Modify only `neeyut-blao`; do not edit or configure the `tts-server` repository.
- Keep the existing preview behavior and renderer/media pipeline. Add only pace selection and useful progress/metric information to the Auto Short UI.
- Default `paceMode` is `source-adaptive`; `fixed` uses the current user-selected `ttsSpeed`.
- `start` is copied from the source cue and is never derived from the previous clip's completion time.
- `preferredEnd` is the source cue end and is a soft preference. For every non-final cue, `hardEnd` is the next source cue start minus 500 ms. For the final cue, `hardEnd` is the video duration minus 120 ms.
- A non-positive or otherwise impossible source window produces a cue-specific error. No filename, language, phrase, or exception-specific timing policy is permitted.
- Semantic groups are translation context only. TTS and subtitle units retain every source cue anchor; a group must not become a single unanchored voice clip.
- Do not change video speed, extend video frames, reorder scenes, or crop phonemes or final speech tails.
- Do not add a TTS engine, model, or service. The predictor is local, lightweight, and has no network or model dependency.
- Do not write credentials to source, tests, logs, plans, manifests, screenshots, or reports. The supplied test key may only travel through the existing secure UI/configuration path during an authorized UI run.
- Do not commit, push, or package the installer in this implementation run.

## Architecture

`src/main/autoshort.ts` remains the job coordinator. Domain behavior moves into small modules under `src/main/dubbing/` with explicit inputs and outputs:

1. `plan.ts` owns the versioned `DubbingPlan` and cue identity. A plan cue contains source ID/text and timing, translated text, final spoken text, predicted duration and uncertainty, natural and actual audio durations, selected global pace, local adjustment, audio path, and subtitle cue(s).
2. `policy.ts` owns timing constants, source-window derivation, source-adaptive weighted-median selection, fixed-pace selection, local adjustment limits, and cue-level validation. The policy is pure and directly testable.
3. `durationPredictor.ts` owns grapheme count, `Intl.Segmenter` word count, number/abbreviation/pause features, non-negative ridge regression, uncertainty, and profile updates. A profile key includes endpoint, model, voice, language, options, and reference-audio fingerprint. At most three real job clips with varied lengths bootstrap a missing profile; these clips remain usable output audio.
4. `translation.ts` owns semantic-group context and stable per-cue response mapping. It may present a whole group and bounded neighboring context to the provider, but only current source cue IDs may be returned. One bounded text-adjustment round may request up to three alternatives for an over-budget cue.
5. `ttsCache.ts` owns versioned audio keys and cache validation. Every cache hit is probed as real audio before acceptance. The key includes final text and the complete effective voice configuration.
6. `synthesis.ts` owns the one-request-at-a-time TTS queue, conservative outer-silence handling, real-duration measurement, one global tempo application, bounded local adjustment, rephrase-at-most-once behavior, and reusable clip selection.
7. `subtitles.ts` owns ordinary TTS subtitle creation from `finalSpokenText` and the accepted cue-level audio window. It never invokes Whisper or fabricates word timestamps. Existing word effects remain available only on the no-TTS path.
8. `manifest.ts` owns sanitized `dubbing-plan.json`, `dubbing-units.json`, `final-spoken-text.json`, `timed.srt`, `tts-timeline.json`, and small metrics. Failure artifacts must remain useful without including raw authorization material.

The coordinator performs extraction, obtains one capability snapshot for the job, creates the plan, invokes translation, obtains the initial pace from prediction, bootstraps and locks the pace before processing the remainder, invokes synthesis, writes cue-level subtitles, validates the plan, renders, probes the actual output streams, and publishes success only after all gates pass.

## Timing and pacing behavior

The predictor first estimates every translated cue at standard TTS speed. In source-adaptive mode, the coordinator selects one weighted median of `predictedDuration / availableSourceWindow`, clamped initially to `0.9..1.25`, and locks it before the remaining cues are processed. In fixed mode, the selected baseline is the user's `ttsSpeed`. A local correction may differ from the locked baseline by at most 3 percentage points and adjacent cue changes are bounded by the same policy. If a cue needs more than the permitted local correction, text fitting/rephrase is attempted before TTS; if it still cannot fit, the cue fails explicitly.

Audio is requested from the server at standard speed for source-adaptive pacing and is locally adjusted once after its real duration is measured. Fixed mode respects the selected server speed and may use only the same bounded local correction. Short clips retain silence in the available gap. Long clips may use time through `hardEnd`, never the protected margin before the next source cue or the final video guard.

The first TTS response is authoritative for audio duration, not evidence that the predictor is fitted. After every accepted clip, the predictor records the measured post-trim duration and updates its residual metrics. If the first attempt is over the allowed window, the coordinator may request one supplemental response with up to three alternatives, synthesize at most one selected replacement, and use that replacement's text for both the plan and subtitles. There is no unbounded translate–TTS loop.

## Cache, checkpoint, and capability rules

Audio cache entries are versioned and keyed by final spoken text, endpoint, model, effective voice, language, effective server speed, options, and reference-audio identity/content fingerprint. A wrong model, voice, language, options, or reference audio cannot reuse an entry. Cache and output audio are still duration-probed and decode-checked.

Checkpoint fingerprints include input media identity and the relevant translation/configuration inputs. Old timing or plan data is never reapplied; every run derives fresh source windows and pacing. Source extraction or translation may be reused only when its fingerprint and cue identity are valid. Capability enumeration is performed once by the job and is not repeated by UI polling while that job is active.

## Output validation

The plan validator checks stable source IDs, source/target anchor equality, source-anchored starts, voice start/end bounds, protected next-cue gap, final video guard, no overlap, local/global pace limits, and normalized subtitle text equality with `finalSpokenText`. Ordinary TTS subtitle validation is cue-level; it does not claim word-level evidence.

FFprobe must read `duration` and `start_time` for each actual stream independently. Output success requires an existing file that decodes, contains the expected video/audio streams, preserves source duration within one 30 fps frame, preserves dimensions/FPS/codec expectations, and passes the plan timing checks. A video `format.duration` value must never be copied into the audio stream duration field.

## Verification plan

- Add behavioral tests for three source cues at 10/13/16 seconds, gap use to 13.2 seconds when the next cue starts at 14 seconds, early completion without moving the next start, locked global pace, predictor error, rephrase propagation, cache isolation, cancellation/timeout/corrupt audio, and zero Whisper calls after TTS in the ordinary subtitle path.
- Run baseline from clean `HEAD 5dd11dd` through the UI when the already-running authorized services and local runtime permit it. Preserve the current dirty worktree; do not reset it to make the baseline.
- Run `npm.cmd run typecheck`, `npm.cmd run test:local-runtime`, `npm.cmd run test:subtitles`, `npm.cmd run build`, and `git diff --check` after the final source change.
- Use Windows Computer Use for the built app: import `C:\Users\PC\Downloads\test\short-test.mp4`, select source auto-detection, Vietnamese translation, a capability-supported voice, run the job, open the actual output file, and inspect the whole video with focused checks at cue starts, scene transitions, long cues, and the final cue.
- Run separate copies at 1.25x and 0.8x in a new test output directory without modifying the supplied source.
- Report fit-on-first-TTS rate, rephrase count, predictor residual/error, pace changes, separate translation/TTS/audio-processing/render timings, and exact media probe evidence. If listening or any external-service gate cannot be verified, report `PARTIAL` or `BLOCKED` rather than claiming success.
