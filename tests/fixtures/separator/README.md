# Separator Private Corpus & Qualification Fixtures

This directory contains private test fixtures and candidate manifests for local separator model qualification.

## Security & Exclusion Policy

- Audio media, models, and manifests in `tests/fixtures/separator/private/` and `tests/fixtures/separator/generated/` are private test assets and **MUST NEVER** be committed to Git or bundled into release packages.
- All benchmark results are stored under `separator-benchmark-results/` which is also excluded by `.gitignore`.

## Private Corpus Layout

When setting up a private evaluation set, place files as follows:

```text
tests/fixtures/separator/private/
  manifest.json
  candidates.json
  clips/
    speech_music_01.wav
    speech_transient_sfx_01.wav
    multiple_speakers_01.wav
    singing_01.wav
    silence_01.wav
    compressed_social_video_01.wav
    stability_10min.wav
```

### Manifest Schema (`manifest.json`)
The manifest defines internal test cases across key categories:
- `speech_music`: Speech over music bed
- `speech_transient_sfx`: Speech over transient sound effects
- `multiple_speakers`: Multiple simultaneous speakers / conversations
- `singing`: Singing vocals over instrumental
- `silence`: Ambient silence / noise floor
- `compressed_social_video`: Low-bitrate compressed audio from social platforms
- Short clips (~5-15s), 2-minute clips, and 10-minute stability tests.
