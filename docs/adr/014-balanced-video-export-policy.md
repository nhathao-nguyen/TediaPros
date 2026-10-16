# ADR 014: Balanced export policy and shared texture preparation

- Status: Accepted
- Date: 2026-10-13
- Amendment: per-export CQ/GOP variation restored on 2026-10-13 after the user clarified its original purpose.

## Context

The user selected a balance between quality, speed and file size. Export previously randomized NVENC quality between CQ 22–24 and GOP 60/120, used CPU CRF 21, and did not consider the source video bitrate. Repeated assets were opened and resized for each consumer. A one-frame Multiply texture was decoded and resized repeatedly. Hardware encoding alone does not accelerate the current RGB blend, subtitle and OCR filter graph.

## Decision

Separate deterministic encoder policy (`videoExportPolicy.ts`) from the ordered filter graph and process lifecycle. Probe video-stream bitrate and codec, without treating container/audio bitrate as video detail. Derive a peak guard from output dimensions, average FPS (nominal FPS fallback), source bitrate, codec efficiency, upscaling and effect detail. This is a VBV ceiling with quality targeting, not a forced average bitrate or a promise to match source size. Missing/unreliable bitrate uses geometry. The policy never adds output FPS, resolution or sharpening flags.

The planning function stays deterministic for reproducible budgeting/tests. Production export applies `randomizeVideoExportPlan` once after planning and before building encoder candidates: Node `crypto.randomInt` selects CQ22/23/24 and GOP60/120 for ordinary video. Grain/analog select CQ22/23, preserving the protected CQ23 ceiling. All attempts reuse the selected values; later exports draw again and may repeat a combination. Bitrate/VBV guards, source FPS, geometry, preference and CPU CRF remain unchanged. AMF/QSV use the chosen quality in their existing CQP/global-quality modes. x264 uses the chosen GOP while retaining CRF21/22; VideoToolbox keeps its existing q65 mode. This restores encoding variation without claiming that it makes rendering-machine attribution impossible.

The base plan uses NVENC P4, VBR CQ24, `b:v=0`, spatial AQ, three B frames and a two-second VBV buffer, with actual CQ/GOP chosen as above. CPU uses x264 `faster` CRF22 with the same peak/buffer guard. Temporal grain/analog use base CQ23 / CRF21 and receive substantially more peak headroom according to intensity. A low cap was rejected after an independent post-effect reference exposed lost grain detail. AMF, QSV and VideoToolbox retain their vendor rate-control modes until changed rate semantics can be accepted on actual hardware.

Favor x264 for very low source bitrate per pixel (<0.015 bits/pixel/frame), at most 1080p area and 30 FPS, when there is no procedural noise or unknown overlay stack. Known texture stacks containing a verified still pass are eligible. This is a bounded heuristic, not scene analysis or proof that the source is static. Other jobs keep the GPU preference and the existing encoder fallback sequence. Memoize successful encoders by FFmpeg path and preference, so a CPU success does not override a later GPU-oriented job. Preserve encoder attempts/selection through AutoShort publication for existing telemetry.

The input planner shares assets by normalized path and static/dynamic timing mode. For reusable RGB textures, prepare geometry/color once then split to consumers, preserving ordered operations and group intensity. An optional `isStatic` field is set only for a verified one-frame imported sequence. Decode/scale that frame once, then loop the prepared RGB frame at the existing texture timebase (24 FPS). The primary video's frames, PTS and EOF still control blend output. Unknown/legacy assets continue through the previous dynamic path. Version 3 composition metadata stores the flag; older generated metadata can recover it from unchanged validated source assets. Vault metadata preserves the flag offline.

Keep FFmpeg's automatic filter threading. Four fixed filter threads were measurably slower on the inspected graph. Also retain P4 instead of P5: on the encoder probe, P5 was slower and larger with little SSIM benefit. Use AAC 128 kbps when audio filtering requires encoding; untouched audio remains copied. Do not add a second encode or intermediate video for user footage. Continue using existing tracked processes, cancellation, scope cleanup and media validation.

## Evidence and limits

Three-run medians on GTX 1660 SUPER / driver 616.92 / FFmpeg 9.0.2, with generated 720×1280, 24 FPS, four-second clips and real Nhiễu 2 textures:

These measurements predate the CQ/GOP amendment and use fixed base settings. They remain evidence for the compositor/base policy, not a performance guarantee for every random combination. The restored six NVENC combinations and both CPU GOPs are separately encoded/full-decoded with frame/GOP/SSIM checks; see [variation task](../../.ai/tasks/TASK-20261013-encode-variation.md).

| Case and selected encoder | Baseline bytes | Balanced bytes | Baseline / balanced render | Post-effect SSIM, baseline / balanced |
| --- | ---: | ---: | --- | --- |
| Motion, NVENC → NVENC | 1,870,228 | 1,444,549 | 2.989 / 2.722 s | 0.994834 / 0.993578 |
| Low-rate scene, NVENC → x264 | 807,763 | 268,113 | 3.023 / 3.021 s | 0.996766 / 0.995766 |
| Grain 35%, NVENC → NVENC | 3,982,194 | 3,918,922 | 0.506 / 0.562 s | 0.753276 / 0.752100 |

Baseline fixes the previous random NVENC settings at CQ 23/GOP 60 and repeatedly processes the still texture. Reference is lossless quantization of the same final effect graph, not the clean source. SSIM is evidence about these samples, not a perceptual guarantee. Dense random grain is poorly compressed: the balanced CPU grain result was 4.1% larger and 13.8% slower, with SSIM increasing from 0.926261 to 0.930476. Do not lower grain quality merely to claim universal size savings. Grain GPU latency increased 11% on this short sample. There is no universal speed or size improvement, and added detail can still produce a file several times larger than its source.

Raw-pixel regression verifies shared preparation and still-frame caching preserve ordered output exactly. Real exports retain 96 frames, four seconds and audio and fully decode. A CPU → GPU → CPU sequence checks actual encoder selection and cache separation. See [task/evidence](../../.ai/tasks/TASK-20261013-balanced-export.md).

These changes affect the source/dev build. Native CapCut equivalence, user footage, long batches, AMD/Intel/Apple hardware, installed-release acceptance and Facebook transcoding are outside this local evidence. Official encoder references: [NVIDIA FFmpeg guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html), [FFmpeg codec/options reference](https://www.ffmpeg.org/ffmpeg-all.html).
