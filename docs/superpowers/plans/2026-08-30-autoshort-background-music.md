# Auto Short Background Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional folder-based background music to Auto Short replace-audio output with single-track, random-per-video, and explicit-per-video assignment modes.

**Architecture:** Resolve every queue item's music assignment before the job starts, validate the folder and files again in the main process, then use a focused FFmpeg compositor to combine looped/trimmed music with the existing narration timeline. Feed that composed WAV through the existing replace-mode `BurnReq`, preserving the invariant that source video audio is excluded.

**Tech Stack:** Electron 34 IPC/preload bridge, React 19, TypeScript 5.7, Node `fs/promises`, FFmpeg, Node test runner bundled by esbuild.

**Spec:** `docs/superpowers/specs/2026-08-30-autoshort-background-music-design.md`

## Global Constraints

- Background music is optional and is exposed only for AI narration with `audioMode === 'replace'`.
- Support exactly `mp3`, `wav`, `m4a`, `aac`, `flac`, `ogg`, and `opus` direct children of the selected folder.
- Support exactly `single`, `random`, and `per-video` assignment modes.
- Resolve random assignments once before `autoShortStart`; transmit explicit item-ID-to-track-path assignments to the main process.
- Default background volume is 15%; narration stays at gain 1.0 and music uses sidechain ducking plus a final limiter.
- Loop short music and trim all composed audio to the probed video duration.
- Keep source-video audio excluded in replace mode and do not change existing mix-mode semantics.
- Preserve Windows Unicode/space paths by passing file paths as separate spawn arguments, never interpolating them into a shell command.
- Add no third-party dependency.
- Use test-first red-green-refactor cycles for every production-code change.

---

## File Structure

- Create `src/shared/autoShortBackgroundMusic.ts`: pure assignment planning shared by renderer and tests.
- Create `src/main/autoShortMusicLibrary.ts`: supported-extension catalog, non-recursive folder scan, and real-path containment checks.
- Create `src/main/autoShortBackgroundAudio.ts`: FFmpeg argument construction and cancellable compositor execution.
- Modify `src/shared/types.ts`: public background-music config, track, and library-result types.
- Modify `src/shared/autoShortContract.ts`: nested config validation plus exact queue-assignment coverage.
- Modify `src/main/index.ts`: music-folder selection and rescan IPC handlers.
- Modify `src/preload/index.ts`: typed renderer bridge for the two new IPC operations.
- Modify `src/main/autoshort.ts`: validate the assigned track, compose narration/music, pass the result to burn, and record audit metadata.
- Modify `src/renderer/src/components/AutoShort.tsx`: persisted controls, per-item selectors, preflight assignment resolution, and request wiring.
- Modify `src/renderer/src/styles/autoshort.css`: compact music panel and per-video assignment rows.
- Modify `tests/local-runtime.test.ts`: contract, assignment, library, filter graph, and renderer/main wiring regressions.

---

### Task 1: Define the shared config and assignment contract

**Files:**
- Create: `src/shared/autoShortBackgroundMusic.ts`
- Modify: `src/shared/types.ts:793-835`
- Modify: `src/shared/autoShortContract.ts:94-224`
- Test: `tests/local-runtime.test.ts`

**Interfaces:**
- Consumes: queue item IDs, catalog track paths, selected single path, and per-video selections.
- Produces: `AutoShortBackgroundMusicMode`, `AutoShortBackgroundMusicConfig`, `AutoShortMusicTrack`, `AutoShortMusicLibraryResult`, and `createAutoShortMusicAssignments(input)`.

- [ ] **Step 1: Add failing assignment-mode tests**

Add imports and focused tests to `tests/local-runtime.test.ts`:

```ts
import { createAutoShortMusicAssignments } from '../src/shared/autoShortBackgroundMusic'

test('AutoShort background music assigns one selected track to every queue item', () => {
  const result = createAutoShortMusicAssignments({
    mode: 'single',
    itemIds: ['video-1', 'video-2'],
    trackPaths: ['C:\\music\\one.mp3', 'C:\\music\\two.wav'],
    selectedTrackPath: 'C:\\music\\two.wav'
  })
  assert.deepEqual(result, {
    ok: true,
    assignments: { 'video-1': 'C:\\music\\two.wav', 'video-2': 'C:\\music\\two.wav' }
  })
})

test('AutoShort background music resolves random choices once into explicit assignments', () => {
  const values = [0.1, 0.9]
  const result = createAutoShortMusicAssignments({
    mode: 'random',
    itemIds: ['video-1', 'video-2'],
    trackPaths: ['C:\\music\\one.mp3', 'C:\\music\\two.wav'],
    random: () => values.shift() ?? 0
  })
  assert.deepEqual(result, {
    ok: true,
    assignments: { 'video-1': 'C:\\music\\one.mp3', 'video-2': 'C:\\music\\two.wav' }
  })
})

test('AutoShort background music requires one manual track per queue item', () => {
  const result = createAutoShortMusicAssignments({
    mode: 'per-video',
    itemIds: ['video-1', 'video-2'],
    trackPaths: ['C:\\music\\one.mp3'],
    perVideoAssignments: { 'video-1': 'C:\\music\\one.mp3' }
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /video-2|chưa chọn nhạc/iu)
})
```

- [ ] **Step 2: Run the focused suite and confirm red**

Run:

```powershell
npm run test:local-runtime
```

Expected: esbuild fails because `src/shared/autoShortBackgroundMusic.ts` does not exist.

- [ ] **Step 3: Implement the pure assignment planner and shared types**

Add these types to `src/shared/types.ts`:

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

export type AutoShortMusicLibraryResult =
  | { ok: true; folderPath: string; tracks: AutoShortMusicTrack[] }
  | { ok: false; tracks: []; error: string }
```

Add `backgroundMusic?: AutoShortBackgroundMusicConfig` beside the existing audio fields in `AutoShortConfig`.

Create the planner with a non-throwing result used directly by the UI:

```ts
import type { AutoShortBackgroundMusicMode } from './types'

export interface AutoShortMusicAssignmentInput {
  mode: AutoShortBackgroundMusicMode
  itemIds: readonly string[]
  trackPaths: readonly string[]
  selectedTrackPath?: string
  perVideoAssignments?: Readonly<Record<string, string>>
  random?: () => number
}

export type AutoShortMusicAssignmentResult =
  | { ok: true; assignments: Record<string, string> }
  | { ok: false; error: string }

export function createAutoShortMusicAssignments(
  input: AutoShortMusicAssignmentInput
): AutoShortMusicAssignmentResult {
  if (input.itemIds.length === 0) return { ok: false, error: 'Hàng đợi chưa có video.' }
  if (input.trackPaths.length === 0) return { ok: false, error: 'Folder nhạc không có file âm thanh được hỗ trợ.' }
  const allowed = new Set(input.trackPaths)
  const assignments: Record<string, string> = {}
  if (input.mode === 'single') {
    if (!input.selectedTrackPath || !allowed.has(input.selectedTrackPath)) {
      return { ok: false, error: 'Chưa chọn bài nhạc dùng cho tất cả video.' }
    }
    for (const id of input.itemIds) assignments[id] = input.selectedTrackPath
  } else if (input.mode === 'random') {
    const random = input.random || Math.random
    for (const id of input.itemIds) {
      const index = Math.min(input.trackPaths.length - 1, Math.max(0, Math.floor(random() * input.trackPaths.length)))
      assignments[id] = input.trackPaths[index]
    }
  } else {
    for (const id of input.itemIds) {
      const path = input.perVideoAssignments?.[id]
      if (!path || !allowed.has(path)) return { ok: false, error: `Video ${id} chưa chọn nhạc background.` }
      assignments[id] = path
    }
  }
  return { ok: true, assignments }
}
```

- [ ] **Step 4: Add failing request-contract tests**

Add a complete valid request factory and mutate only the behavior under test:

```ts
import type { AutoShortStartRequest } from '../src/shared/types'

const autoShortBackgroundRequest = (): AutoShortStartRequest => ({
  items: [
    { id: 'video-1', filePath: 'C:\\media\\one.mp4' },
    { id: 'video-2', filePath: 'C:\\media\\two.mp4' }
  ],
  config: {
    subtitleMethod: 'whisper',
    whisperModel: 'base',
    whisperDevice: 'cpu',
    blurRegions: [],
    lamMo: false,
    translateTarget: 'none',
    translateProvider: 'local',
    ttsEnabled: true,
    voiceOverMode: false,
    audioMode: 'replace',
    originalAudioVolume: 20,
    backgroundMusic: {
      folderPath: 'C:\\music',
      mode: 'per-video',
      volume: 15,
      assignments: {
        'video-1': 'C:\\music\\one.mp3',
        'video-2': 'C:\\music\\two.wav'
      }
    },
    outputDir: 'C:\\media\\out'
  }
})

test('AutoShort accepts exact background music assignments for replace mode', () => {
  assert.equal(validateAutoShortStartRequest(autoShortBackgroundRequest()).ok, true)
})

test('AutoShort rejects background music in source-audio mix mode', () => {
  const request = autoShortBackgroundRequest()
  request.config.audioMode = 'mix'
  const result = validateAutoShortStartRequest(request)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /thay thế toàn bộ âm thanh gốc/iu)
})

test('AutoShort rejects background music when AI narration is disabled', () => {
  const request = autoShortBackgroundRequest()
  request.config.ttsEnabled = false
  const result = validateAutoShortStartRequest(request)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /lồng tiếng AI/iu)
})

test('AutoShort rejects missing or unknown background assignment keys', () => {
  const request = autoShortBackgroundRequest()
  const assignments = request.config.backgroundMusic!.assignments
  delete assignments['video-2']
  assignments.unknown = 'C:\\music\\one.mp3'
  const result = validateAutoShortStartRequest(request)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /mỗi video|không thuộc hàng đợi/iu)
})
```

- [ ] **Step 5: Run the suite and confirm the new contract tests fail**

Run:

```powershell
npm run test:local-runtime
```

Expected: assignment planner tests pass; contract tests fail because `backgroundMusic` is not validated.

- [ ] **Step 6: Implement nested validation and exact assignment coverage**

In `validateConfigRecord`, validate the nested record, absolute paths, mode, volume, `ttsEnabled === true`, and the replace-only rule. In `validateAutoShortStartRequest`, after queue items are parsed, require an exact key set:

```ts
const backgroundMusic = config.backgroundMusic
if (backgroundMusic) {
  const itemIds = new Set(items.map((item) => item.id))
  const assignedIds = Object.keys(backgroundMusic.assignments)
  if (assignedIds.length !== items.length || items.some((item) => !backgroundMusic.assignments[item.id])) {
    return { ok: false, error: 'Phải chọn nhạc background cho mỗi video trong hàng đợi.' }
  }
  if (assignedIds.some((id) => !itemIds.has(id))) {
    return { ok: false, error: 'Danh sách nhạc có video không thuộc hàng đợi.' }
  }
}
```

- [ ] **Step 7: Run tests and typecheck**

Run:

```powershell
npm run test:local-runtime
npm run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 8: Commit the contract slice**

```powershell
git add docs/superpowers/specs/2026-08-30-autoshort-background-music-design.md docs/superpowers/plans/2026-08-30-autoshort-background-music.md src/shared/types.ts src/shared/autoShortContract.ts src/shared/autoShortBackgroundMusic.ts tests/local-runtime.test.ts
git commit -m "feat(autoshort): define background music contract"
```

---

### Task 2: Add a secure, non-recursive music-folder catalog

**Files:**
- Create: `src/main/autoShortMusicLibrary.ts`
- Modify: `src/main/index.ts:929-985`
- Modify: `src/preload/index.ts:1-66,374-396`
- Test: `tests/local-runtime.test.ts`

**Interfaces:**
- Consumes: an absolute folder path selected or restored by the renderer.
- Produces: `listAutoShortMusicTracks(folderPath): Promise<AutoShortMusicLibraryResult>` and `validateAutoShortMusicTrack(folderPath, trackPath): Promise<string>`.

- [ ] **Step 1: Write failing catalog and containment tests**

```ts
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { listAutoShortMusicTracks, validateAutoShortMusicTrack } from '../src/main/autoShortMusicLibrary'

test('AutoShort music library lists only supported direct-child audio files in stable order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-music-library-'))
  try {
    await mkdir(join(root, 'nested'))
    await writeFile(join(root, 'Bài Hai.WAV'), Buffer.from('wav'))
    await writeFile(join(root, 'a-track.mp3'), Buffer.from('mp3'))
    await writeFile(join(root, 'cover.jpg'), Buffer.from('jpg'))
    await writeFile(join(root, 'nested', 'hidden.m4a'), Buffer.from('m4a'))
    const result = await listAutoShortMusicTracks(root)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.tracks.map((track) => track.name), ['a-track.mp3', 'Bài Hai.WAV'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('AutoShort music library rejects a selected track outside the chosen folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-music-contained-'))
  const outside = await mkdtemp(join(tmpdir(), 'tedia-music-outside-'))
  try {
    const outsideTrack = join(outside, 'outside.mp3')
    await writeFile(outsideTrack, Buffer.from('mp3'))
    await assert.rejects(() => validateAutoShortMusicTrack(root, outsideTrack), /folder nhạc/iu)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run tests and confirm red**

```powershell
npm run test:local-runtime
```

Expected: esbuild fails because `src/main/autoShortMusicLibrary.ts` does not exist.

- [ ] **Step 3: Implement the library service**

Use `readdir({ withFileTypes: true })`, `realpath`, and a case-insensitive parent comparison on Windows:

```ts
const SUPPORTED_AUTO_SHORT_MUSIC_EXTENSIONS = new Set([
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus'
])

export async function validateAutoShortMusicTrack(folderPath: string, trackPath: string): Promise<string> {
  const [folder, track] = await Promise.all([realpath(folderPath), realpath(trackPath)])
  const sameParent = process.platform === 'win32'
    ? dirname(track).toLowerCase() === folder.toLowerCase()
    : dirname(track) === folder
  if (!sameParent) throw new Error('Bài nhạc không thuộc trực tiếp folder nhạc đã chọn.')
  if (!SUPPORTED_AUTO_SHORT_MUSIC_EXTENSIONS.has(extname(track).toLocaleLowerCase())) {
    throw new Error('Định dạng nhạc background không được hỗ trợ.')
  }
  const info = await stat(track)
  if (!info.isFile() || info.size <= 0) throw new Error('File nhạc background không hợp lệ.')
  return track
}
```

Return tracks sorted with `localeCompare(name, 'vi', { sensitivity: 'base', numeric: true })` and do not descend into directories.

- [ ] **Step 4: Run catalog tests and confirm green**

```powershell
npm run test:local-runtime
```

Expected: catalog and existing tests exit 0.

- [ ] **Step 5: Add failing IPC/preload wiring assertions**

```ts
test('AutoShort exposes dedicated music-folder selection and rescan IPC', async () => {
  const mainSource = await readFile(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
  const preloadSource = await readFile(join(process.cwd(), 'src', 'preload', 'index.ts'), 'utf8')
  assert.match(mainSource, /autoshort:selectMusicFolder/u)
  assert.match(mainSource, /autoshort:listMusicTracks/u)
  assert.match(preloadSource, /autoShortSelectMusicFolder/u)
  assert.match(preloadSource, /autoShortListMusicTracks/u)
})
```

- [ ] **Step 6: Run tests and confirm the IPC assertions fail**

```powershell
npm run test:local-runtime
```

Expected: the new source assertions fail because the handlers and bridge methods are absent.

- [ ] **Step 7: Implement narrow IPC handlers and typed preload methods**

Register these channels in `src/main/index.ts`:

```ts
ipcMain.handle('autoshort:selectMusicFolder', async () => {
  if (!mainWindow) return { ok: false, tracks: [], error: 'Cửa sổ ứng dụng chưa sẵn sàng.' }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn folder nhạc background',
    properties: ['openDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return { ok: false, tracks: [], error: 'Đã hủy chọn folder nhạc.' }
  return listAutoShortMusicTracks(result.filePaths[0])
})

ipcMain.handle('autoshort:listMusicTracks', async (_event, folderPath: unknown) => {
  if (typeof folderPath !== 'string' || folderPath.length === 0 || folderPath.length > 32768) {
    return { ok: false, tracks: [], error: 'Folder nhạc không hợp lệ.' }
  }
  return listAutoShortMusicTracks(folderPath)
})
```

Expose matching preload methods returning `Promise<AutoShortMusicLibraryResult>` and invoking only those channel names.

- [ ] **Step 8: Run tests and typecheck**

```powershell
npm run test:local-runtime
npm run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 9: Commit the library and IPC slice**

```powershell
git add src/main/autoShortMusicLibrary.ts src/main/index.ts src/preload/index.ts tests/local-runtime.test.ts
git commit -m "feat(autoshort): add background music folder catalog"
```

---

### Task 3: Compose looped, ducked background music with narration

**Files:**
- Create: `src/main/autoShortBackgroundAudio.ts`
- Modify: `src/main/autoshort.ts:1123-1425`
- Test: `tests/local-runtime.test.ts`

**Interfaces:**
- Consumes: `musicPath`, optional `narrationPath`, `outputPath`, `duration`, `volume`, and `AbortSignal`.
- Produces: `buildAutoShortBackgroundAudioArgs(input): string[]` and `composeAutoShortBackgroundAudio(input): Promise<void>`.

- [ ] **Step 1: Write failing FFmpeg argument tests**

```ts
import { buildAutoShortBackgroundAudioArgs } from '../src/main/autoShortBackgroundAudio'

test('AutoShort background compositor loops music, ducks it under narration, and trims to video duration', () => {
  const args = buildAutoShortBackgroundAudioArgs({
    musicPath: 'C:\\Nhạc nền\\bài 01.mp3',
    narrationPath: 'C:\\Temp\\tts-timeline.wav',
    outputPath: 'C:\\Temp\\tts-background-mix.wav',
    duration: 12.345,
    volume: 15
  })
  assert.deepEqual(args.slice(0, 6), ['-y', '-stream_loop', '-1', '-i', 'C:\\Nhạc nền\\bài 01.mp3', '-i'])
  const graph = args[args.indexOf('-filter_complex') + 1]
  assert.match(graph, /volume=0\.0225/u)
  assert.match(graph, /sidechaincompress=threshold=0\.06:ratio=4:attack=15:release=200/u)
  assert.match(graph, /amix=inputs=2:duration=longest:dropout_transition=2:normalize=0/u)
  assert.match(graph, /alimiter=limit=-1dB:attack=5:release=50/u)
  assert.match(graph, /atrim=duration=12\.345/u)
  assert.equal(args.at(-1), 'C:\\Temp\\tts-background-mix.wav')
})

test('AutoShort background compositor can render music when narration is absent', () => {
  const args = buildAutoShortBackgroundAudioArgs({
    musicPath: 'C:\\music\\one.mp3',
    narrationPath: null,
    outputPath: 'C:\\Temp\\music-only.wav',
    duration: 5,
    volume: 20
  })
  const graph = args[args.indexOf('-filter_complex') + 1]
  assert.doesNotMatch(graph, /sidechaincompress/u)
  assert.match(graph, /atrim=duration=5\.000/u)
})
```

- [ ] **Step 2: Run tests and confirm red**

```powershell
npm run test:local-runtime
```

Expected: esbuild fails because `src/main/autoShortBackgroundAudio.ts` does not exist.

- [ ] **Step 3: Implement argument construction and cancellable execution**

Construct a WAV output command without a shell:

```ts
const duration = Math.max(0.1, input.duration).toFixed(3)
const gain = originalAudioGain(input.volume)
const args = ['-y', '-stream_loop', '-1', '-i', input.musicPath]
if (input.narrationPath) args.push('-i', input.narrationPath)
const music = `[0:a]asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,volume=${gain}[music]`
const graph = input.narrationPath
  ? `${music};[1:a]asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,volume=1.0[narr];[music][narr]sidechaincompress=threshold=0.06:ratio=4:attack=15:release=200[ducked_music];[ducked_music][narr]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0[a_sum];[a_sum]alimiter=limit=-1dB:attack=5:release=50,apad=whole_dur=${duration},atrim=duration=${duration}[a_mix]`
  : `${music};[music]apad=whole_dur=${duration},atrim=duration=${duration},alimiter=limit=-1dB:attack=5:release=50[a_mix]`
args.push('-filter_complex', graph, '-map', '[a_mix]', '-c:a', 'pcm_s16le', '-ac', '2', '-ar', '44100', input.outputPath)
```

`composeAutoShortBackgroundAudio` resolves FFmpeg, calls `spawn(ffmpeg, args, { windowsHide: true })`, kills the child on abort, removes the listener on `error`/`close`, and rejects nonzero exit with `Không thể trộn nhạc background với giọng lồng tiếng.`

- [ ] **Step 4: Run compositor tests and confirm green**

```powershell
npm run test:local-runtime
```

Expected: FFmpeg argument tests and existing tests exit 0.

- [ ] **Step 5: Add a failing Auto Short pipeline wiring test**

```ts
test('AutoShort validates and composes assigned background music before replace-mode burn', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'autoshort.ts'), 'utf8')
  assert.match(source, /validateAutoShortMusicTrack\(backgroundMusic\.folderPath, assignedMusicPath\)/u)
  assert.match(source, /composeAutoShortBackgroundAudio\(/u)
  assert.match(source, /tts-background-mix\.wav/u)
  assert.match(source, /amThanhFile:\s*outputAudioPath/u)
  assert.match(source, /amLuongGoc:\s*config\.audioMode === 'mix' \? config\.originalAudioVolume : 0/u)
})
```

- [ ] **Step 6: Run tests and confirm the pipeline wiring test fails**

```powershell
npm run test:local-runtime
```

Expected: the new source assertions fail because `autoshort.ts` still burns `stitchedAudioPath` directly.

- [ ] **Step 7: Integrate the compositor before `BurnReq` construction**

Declare `let selectedBackgroundMusicPath: string | undefined` beside `outputName` before the function's `try` block so both success and failure audit manifests can use it. After TTS stitching and before rendering, derive an output path:

```ts
let outputAudioPath = stitchedAudioPath
const backgroundMusic = config.backgroundMusic
if (backgroundMusic) {
  const assignedMusicPath = backgroundMusic.assignments[item.id]
  selectedBackgroundMusicPath = await validateAutoShortMusicTrack(backgroundMusic.folderPath, assignedMusicPath)
  outputAudioPath = join(workDir, 'tts-background-mix.wav')
  emitProgress(job, item, 'stitching_audio', 83, 'Đang trộn nhạc background với giọng lồng tiếng…', index, total)
  await composeAutoShortBackgroundAudio({
    musicPath: selectedBackgroundMusicPath,
    narrationPath: stitchedAudioPath,
    outputPath: outputAudioPath,
    duration: meta.giay,
    volume: backgroundMusic.volume,
    signal: job.controller.signal
  })
  artifactEntries.push({ source: outputAudioPath, name: 'tts-background-mix.wav' })
}
```

Pass `outputAudioPath` to `batAmThanh`/`amThanhFile`. Add these fields to both success and failure audit manifests without logging an absolute user path:

```ts
backgroundMusicMode: config.backgroundMusic?.mode,
backgroundMusicFile: selectedBackgroundMusicPath ? basename(selectedBackgroundMusicPath) : undefined,
backgroundMusicVolume: config.backgroundMusic?.volume
```

- [ ] **Step 8: Run tests, typecheck, and build**

```powershell
npm run test:local-runtime
npm run typecheck
npm run build
```

Expected: all three commands exit 0.

- [ ] **Step 9: Commit the compositor slice**

```powershell
git add src/main/autoShortBackgroundAudio.ts src/main/autoshort.ts tests/local-runtime.test.ts
git commit -m "feat(autoshort): mix background music with narration"
```

---

### Task 4: Add the three assignment modes to the Auto Short UI

**Files:**
- Modify: `src/renderer/src/components/AutoShort.tsx:177-190,670-774,1576-1724`
- Modify: `src/renderer/src/styles/autoshort.css`
- Test: `tests/local-runtime.test.ts`

**Interfaces:**
- Consumes: `window.api.autoShortSelectMusicFolder()`, `window.api.autoShortListMusicTracks(folderPath)`, queue item IDs, and `createAutoShortMusicAssignments`.
- Produces: optional `config.backgroundMusic` with an explicit assignment for every queue item.

- [ ] **Step 1: Add failing renderer wiring and Vietnamese copy tests**

```ts
test('AutoShort renders all three background music assignment modes only for replace audio', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'renderer', 'src', 'components', 'AutoShort.tsx'), 'utf8')
  assert.match(source, /Nhạc background/u)
  assert.match(source, /Một bài cho tất cả/u)
  assert.match(source, /Ngẫu nhiên theo video/u)
  assert.match(source, /Chọn riêng từng video/u)
  assert.match(source, /audioMode === 'replace'/u)
  assert.match(source, /createAutoShortMusicAssignments/u)
  assert.match(source, /backgroundMusic:\s*backgroundMusicConfig/u)
})
```

- [ ] **Step 2: Run tests and confirm red**

```powershell
npm run test:local-runtime
```

Expected: the renderer source assertions fail because the controls and request wiring are absent.

- [ ] **Step 3: Add persisted and queue-scoped state**

Add typed imports and these states beside the existing audio state:

```ts
const [backgroundMusicEnabled, setBackgroundMusicEnabled] = usePersistedState('tblao.autoshort.bgMusic.enabled', false)
const [backgroundMusicFolder, setBackgroundMusicFolder] = usePersistedState('tblao.autoshort.bgMusic.folder', '')
const [backgroundMusicMode, setBackgroundMusicMode] = usePersistedState<AutoShortBackgroundMusicMode>('tblao.autoshort.bgMusic.mode', 'single')
const [backgroundMusicVolume, setBackgroundMusicVolume] = usePersistedState('tblao.autoshort.bgMusic.volume', 15)
const [backgroundMusicSingleTrack, setBackgroundMusicSingleTrack] = usePersistedState('tblao.autoshort.bgMusic.singleTrack', '')
const [backgroundMusicTracks, setBackgroundMusicTracks] = useState<AutoShortMusicTrack[]>([])
const [backgroundMusicAssignments, setBackgroundMusicAssignments] = useState<Record<string, string>>({})
const [backgroundMusicError, setBackgroundMusicError] = useState<string | null>(null)
```

On mount or persisted-folder change, call `autoShortListMusicTracks`; ignore an empty folder, update the catalog on success, and display the returned error on failure. When queue items are removed, filter `backgroundMusicAssignments` to the remaining item IDs.

- [ ] **Step 4: Implement folder selection and request preflight**

Use the dedicated chooser:

```ts
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
```

At the start of `startBatch`, before readiness and before setting `isRunning`, build the optional config:

```ts
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
```

Set `backgroundMusic: backgroundMusicConfig` in `AutoShortConfig`.

- [ ] **Step 5: Render the optional panel and per-video rows**

Under the audio-mode control, render the switch only inside `audioMode === 'replace'`. When enabled, render the folder row, three radio pills, the mode-specific select content, and the volume range. The per-video rows must use queue IDs as keys and preserve paths as select values:

```tsx
{backgroundMusicMode === 'per-video' && (
  <div className="autoshort-music-assignments">
    {tasks.map((task) => (
      <label className="autoshort-music-assignment" key={task.id}>
        <span title={task.fileName}>{task.fileName}</span>
        <select
          value={backgroundMusicAssignments[task.id] || ''}
          onChange={(event) => setBackgroundMusicAssignments((current) => ({
            ...current,
            [task.id]: event.target.value
          }))}
        >
          <option value="">Chọn bài nhạc…</option>
          {backgroundMusicTracks.map((track) => (
            <option key={track.path} value={track.path}>{track.name}</option>
          ))}
        </select>
      </label>
    ))}
  </div>
)}
```

Add focused CSS for `.autoshort-music-panel`, `.autoshort-music-folder-row`, `.autoshort-music-assignments`, and `.autoshort-music-assignment`; keep the right inspector vertically scrollable and truncate long file names without hiding the select control.

- [ ] **Step 6: Run tests, typecheck, and build**

```powershell
npm run test:local-runtime
npm run typecheck
npm run build
```

Expected: all commands exit 0 with no TypeScript or Vite errors.

- [ ] **Step 7: Commit the UI slice**

```powershell
git add src/renderer/src/components/AutoShort.tsx src/renderer/src/styles/autoshort.css tests/local-runtime.test.ts
git commit -m "feat(autoshort): add background music assignment controls"
```

---

### Task 5: Verify the user-visible flow and rendered media

**Files:**
- Verify: `src/**`, `tests/**`, built `out/**`

**Interfaces:**
- Consumes: the completed feature branch, a small local source video, and at least two supported music files.
- Produces: fresh automated evidence plus manual UI/render acceptance evidence.

- [ ] **Step 1: Run the complete automated gate from a clean process**

```powershell
npm run test:local-runtime
npm run typecheck
npm run build
```

Expected: every command exits 0; the Node test summary contains zero failures.

- [ ] **Step 2: Launch the current source build and inspect all three UI modes**

```powershell
npm run dev
```

In Auto Short > Lồng tiếng, choose **Thay thế toàn bộ âm thanh gốc**, enable **Nhạc background**, and verify:

- choosing a folder lists only supported direct-child audio files;
- single mode displays one selector;
- random mode states that each queued video receives a random track;
- per-video mode displays one selector for every queued video;
- switching to `mix` hides the background panel without deleting persisted replace-mode settings;
- the right inspector remains usable at the screenshot's window size.

- [ ] **Step 3: Render one replace-mode sample and probe the output**

Use one source video with identifiable original audio, enable TTS, select a short background track, set music volume to 15%, and run Auto Short. Confirm the output completes, then inspect it with the repository's resolved FFprobe or system FFprobe:

```powershell
ffprobe -v error -show_entries format=duration -show_entries stream=index,codec_type,duration,channels,sample_rate -of json "C:\absolute\path\to\rendered-output.mp4"
```

Expected: one video stream and one audio stream exist; output audio duration matches the format/video duration within 0.10 seconds; narration and looped background music are audible; the identifiable source audio is absent; music audibly ducks under narration.

- [ ] **Step 4: Check branch history and worktree state**

```powershell
git status --short
git log --oneline --decorate main..HEAD
git diff --check main...HEAD
```

Expected: `git status --short` is empty, four focused feature commits are present, and `git diff --check` exits 0 without whitespace errors.
