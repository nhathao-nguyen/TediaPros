# Optional STTN engine

This directory contains inference only. No GUI, training dataset, separate OCR,
model weights, or Python runtime belongs in the Electron application bundle.
Build with Python 3.12 using `build-windows.ps1 -Python312 <absolute-python-path>`.
The generated `dist/sttn-engine` directory is a separate optional runtime asset.

Package a built runtime into a **new** local output directory with
`python package_runtime.py --input-dir dist/sttn-engine --output-dir <new-absolute-directory>`.
This writes a real SHA-256/size manifest and ZIP; it never publishes files.
Use that directory as `TEDIAPROS_LOCAL_RUNTIME_DIR` in a development build to
exercise the existing managed installer. Full runtime releases can also include
the optional `sttn-engine` key in their explicit runtime input specification.
Never add STTN to the required baseline runtime list.

Protocol: `sttn-engine/1`; `--version`, `--probe --model <file> --provider auto`,
`--run --request <json-file>`. Requests and JSONL events are documented in the
approved STTN design. Runtime output must be a new MKV path. Inference is offline.

Version 1.1.0 streams FFV1 into the audio remuxer and writes only one lossless
intermediate. A single encoding worker overlaps the next STTN window; at most
one encoding batch is outstanding. FFV1 range coding with large contexts reduces
storage while preserving decoded RGB pixels. The model and temporal scope are
unchanged. Free disk is checked before each window with a raw-window allowance
plus 512 MiB headroom; this is a rolling safety margin, not the total output size.
Auto Short places these files in a private directory on the selected output
volume and cleans it on success, failure or cancellation.

Version 1.1.1 validates video and audio playback endpoints separately. Matroska
audio DURATION metadata includes CodecDelay; the validator subtracts the
reported initial padding/sample rate for audio only. The tolerance is unchanged,
video truncation remains an error, and the FFV1/audio stream-copy pipeline is
unchanged. Errors report the expected, measured and codec-delay durations.

Architecture is derived from researchmm/STTN at commit
`f39f62c5bbbe3e3eba084c487353a2c651bfdcde` (MIT; see LICENSE-STTN).
Modified subset removes training/discriminator code and unused torchvision
dependencies while preserving parameter names. Cite: Yanhong Zeng, Jianlong Fu,
Hongyang Chao, Learning Joint Spatial-Temporal Transformations for Video
Inpainting, ECCV 2020. Source: https://github.com/researchmm/STTN

Checkpoint under qualification: YaoFANGUK/video-subtitle-remover commit
`f78e985e1ce75c0739bee13ab12226d5e71a958a`,
`backend/models/sttn-det/sttn.pth`, 66,252,587 bytes,
SHA256 `25b0c2c30042d82efd1893bd42ec726764262d94115393a1718f8d65d2a7817b`.
Model distribution terms/provenance must be retained separately from this
source license; do not infer terms of unrelated models in that repository.

Run tests with the isolated interpreter:

```powershell
$env:STTN_TEST_FFMPEG = '<managed-ffmpeg.exe>'
.\.venv-build\Scripts\python.exe -m unittest discover -s tests -v
```

The media test requires PyAV and explicitly skips when the FFmpeg fixture is
unavailable. Passing this test is transport/compositing evidence; real-model
acceptance and packaging probes are separate requirements. CUDA is selected only
when torch reports availability. CUDA OOM retries smaller temporal windows;
exhaustion fails the job. DirectML is not a qualified provider in this build.
