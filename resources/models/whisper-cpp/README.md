# Optional packaged Whisper.cpp models

Release bundles may place native GGML models here. Each model must be under
`base`, `small` or `medium` with its native filename and a valid `manifest.json`.
The application accepts a model only after verifying its size and SHA-256.
