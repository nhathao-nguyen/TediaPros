# Local asset bundle

This directory is the only packaged source for reviewed local native assets.
Only assets with a matching entry in `manifest.json` are considered ready at
runtime. Runtime code never downloads an engine from a repository or remote
manifest.

Use `npm run assets:import -- --source <path>` to import a reviewed local
bundle. The importer writes `manifest.json` with byte counts and SHA-256
checksums. An asset without a matching manifest entry is not considered ready.

Current checked-in bundle:

- `whisper-cpp/`: Whisper.cpp 1.9.3 runtime, CUDA backend, and the
  `whisper-local/1` worker.

Optional OCR, Video2X, FFmpeg, or Douyin directories must be imported with a
reviewed manifest entry before they are treated as packaged assets.
