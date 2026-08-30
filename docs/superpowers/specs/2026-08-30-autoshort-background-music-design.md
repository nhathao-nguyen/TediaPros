# Auto Short Background Music Design

## Goal

Extend Auto Short's **Thay thế toàn bộ âm thanh gốc** mode so the user can choose a background-music folder and assign music to the batch in one of three ways:

1. one selected track for every video;
2. a random track for each video;
3. an explicit track for each video.

The output must contain AI narration plus background music and must not contain the source video's original audio.

## Scope

- Background music is optional and is available only while AI narration is enabled and `audioMode` is `replace`.
- The folder catalog is non-recursive and accepts `mp3`, `wav`, `m4a`, `aac`, `flac`, `ogg`, and `opus` files.
- The background volume defaults to 15% and is adjustable from 0% through 100%.
- A short track loops until the video ends. A long track is trimmed to the video duration.
- AI narration remains at full gain. FFmpeg sidechain compression ducks the music while narration is active, followed by a limiter.
- The existing `mix` mode continues to mix narration with the source video's original audio and does not expose the new music controls.
- No new runtime dependency is added; the feature uses the FFmpeg runtime already required by Auto Short.

## User Interface

The Lồng tiếng inspector adds a **Nhạc background** switch below the output-audio mode. The controls appear only when `audioMode === 'replace'`.

When enabled, the panel contains:

- a read-only folder path and **Chọn folder nhạc** action;
- a mode selector with `Một bài cho tất cả`, `Ngẫu nhiên theo video`, and `Chọn riêng từng video`;
- one track selector for single mode;
- an explanatory count for random mode;
- one video-to-track selector per queue item for per-video mode;
- a background-volume slider with a default value of 15%.

The folder path, mode, single-track choice, enabled state, and volume are persisted. Per-video assignments remain tied to the current queue item IDs and are not persisted across app sessions.

Random choices are resolved once when the batch starts and are serialized as explicit assignments. A retry or resumed stage therefore uses the same track for the same item during that job.

## Shared Contract

`AutoShortConfig` gains an optional nested value:

```ts
export type AutoShortBackgroundMusicMode = 'single' | 'random' | 'per-video'

export interface AutoShortBackgroundMusicConfig {
  folderPath: string
  mode: AutoShortBackgroundMusicMode
  volume: number
  assignments: Record<string, string>
}

export interface AutoShortMusicTrack {
  name: string
  path: string
}
```

`backgroundMusic` is absent when the feature is disabled. When present, request validation requires:

- `audioMode === 'replace'`;
- `ttsEnabled === true`;
- an absolute folder path;
- a supported mode and a finite volume from 0 through 100;
- exactly one absolute assigned music path for every queue item ID;
- no assignment keys that are absent from the queue.

The main process additionally resolves the real folder and file paths, rejects missing files, unsupported extensions, nested/outside files, and files whose real parent is not the selected folder.

## Main-Process Flow

The main process exposes two narrow IPC operations:

- choose a music folder and return its supported direct-child tracks;
- rescan a previously persisted folder and return its supported direct-child tracks.

Before rendering each video, Auto Short looks up `config.backgroundMusic.assignments[item.id]` and verifies it again against the selected folder. After the existing TTS timeline WAV is produced, a focused background-audio compositor creates `tts-background-mix.wav`:

```text
looped music -> resample/stereo -> background gain --+
                                                       +-> sidechain duck -> amix -> limiter -> exact video duration
TTS timeline -> resample/stereo -> full gain ----------+
```

The compositor also supports a music-only result defensively, although normal UI use keeps TTS enabled. The resulting WAV replaces `stitchedAudioPath` in the existing `BurnReq`. `amLuongGoc` remains `0`, so `burn.ts` never includes the source video's audio stream.

The selected track name, assignment mode, and volume are written to the Auto Short audit manifest. The composed WAV is preserved as an audit artifact on success or failure when it exists.

## Failure Behaviour

The renderer blocks batch start with a Vietnamese message if the folder is empty, the single-track selection is missing, or a per-video assignment is missing. The main process remains authoritative and rejects stale, deleted, moved, unsupported, nested, or outside-folder files before FFmpeg starts.

Cancellation terminates the compositor child process through the existing `AbortSignal`. A compositor failure leaves no successful video output and flows through the existing Auto Short error/audit path.

## Verification

- Unit tests cover all three assignment modes, request-contract failures, non-recursive folder scanning, extension filtering, path containment, and FFmpeg argument/filter construction.
- Existing Auto Short local-runtime and E2E tests remain green.
- TypeScript node/web typechecks and the Electron Vite production build pass.
- Manual acceptance checks the three UI modes and a rendered replace-mode video whose probed audio duration matches the video, with narration audible, background music ducked, and source audio absent.
