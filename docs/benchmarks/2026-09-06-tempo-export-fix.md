# AutoShort: tempo export validation repair

## Observed failure

The 57-cue video failed at 2026-09-06T07:12:09Z after TTS completed.
The first error was `tempo 1.506x vượt policy`; measured tempos reached 2.805x.
V2 synthesis fits original PCM before the next source anchor and records the
measured total acceleration. The final validator still applied the legacy
1.45 + 0.05 ceiling, rejecting results the synthesizer intentionally produced.

## Change

The V2 adapter marks units with `timingPolicy: source-anchored-v2`.
For these units, validation checks finite positive measurements, agreement
between natural/final audio duration and tempo, and agreement between final
duration and the voice window. Existing hard-end, source, subtitle, video-end,
and overlap validation remains active. Legacy units retain the tempo ceiling.
Fast V2 speech produces a quality warning in the log and `tts-timeline.json`.
No synthesis tempo, source text, server configuration, or audio filter changed.

## Verification

- Regression first failed with `tempo 2.525x vượt policy`, then passed.
- Invalid tempo, inconsistent durations, overlaps and video overflow still fail.
- Full local runtime suite: 411 passed, 0 failed, across 29 test files.
- Node and renderer typecheck passed; main/preload/renderer production build passed.
- Real cached WAV + FFmpeg acceptance passed, including measured 2.5397x audio
  with a quality warning and successful export validation. Evidence:
  `release-artifacts/dubbing-tempo-bZJRyv/result.json`.
- Workspace dev app restarted with the updated main bundle.

This fixes the contradictory export gate. It does not establish natural voice
quality at high acceleration or successful export of the complete original video.
The original video has not been rerun end to end as part of this repair.
