# ADR 013: Ordered RGB texture composition for AutoShort

- Status: Accepted
- Date: 2026-10-13

## Context

The previous CapCut scanner selected one numbered image sequence. Nhiễu 2 contains a Screen pass (`a0`–`a27`) followed by a Multiply pass (`b0`), including PNG alpha. Exporting only the first texture changes the effect. The preview rendered only the first configured video overlay, and its Multiply approximation changed brightness/contrast independently of export.

## Decision

Add optional, ordered `layers: { assetPath, blendMode }[]` to a custom overlay, scanned item and vault item. Limit compositions to four validated Screen/Multiply passes and effects to four. The existing asset path remains the first layer; old configurations remain valid. A typed `effects:composition` endpoint recovers legacy selections through the preload bridge.

Read a supported two-pass texture graph from serialized scene/material/sequence/atlas references and shader mode literals. Do not execute Lua or shader code. This importer supports the inspected `pass1` Screen / `pass2` Multiply family with the expected source/intermediate texture bindings, not arbitrary CapCut shader graphs. Unsupported layouts retain the existing approximate scanner path.

For each supported sequence, flatten PNG alpha once over the blend's neutral color (black for Screen, white for Multiply). Encode the small reusable texture with lossless H.264 quantization, retaining one output frame per sequence entry. Cache names include a versioned content hash. Publish through unique temporary files and rename, validate containment, track native processes, enforce resource limits and honor cancellation. Stored vault layers use contained relative filenames and remain usable without CapCut or the converted cache.

Export composes the ordered layers in RGB planar format. Intensity mixes the fully processed group with the original once. No intermediate encode of the user's video is introduced. Matte alpha also honors intensity. Single Add uses `min(255, A + strength * B)`, matching preview plus-lighter.

Screen/Multiply transformations are affine per channel: `F(A) = A*K + C`. Preview compiles the stack and intensity into two ordinary blend canvases:

```
Kf = 1 - strength + strength*K
Cf = strength*C
Multiply texture = Kf / (1 - Cf)
Screen texture = Cf
```

This operates on the existing preview backdrop, including subtitles, instead of painting a replacement copy of the source video. Reuse canvases, decode only newly presented texture frames, and wait for each texture's first video-frame callback to prevent startup frames from becoming black placeholders. Each configured effect remains in its original order; listeners and frame callbacks are removed on unmount.

## Consequences and verification

The real Nhiễu 2 package now retains both textures and PNG alpha. Preview and export are checked against an independent RGB model. Cache reuse launches no native helper; source pixel changes invalidate the cache. Legacy vault metadata is upgraded before source-cache removal.

Internal texture timing remains a normalized 24 fps; binary CapCut time/keyframe curves and Lua speed adjustments are not imported. Procedural previews remain illustrative. No claim of pixel-exact native CapCut output, entitlement, installed-app acceptance or Facebook playback is made. See [task evidence](../../.ai/tasks/TASK-20261013-effect-layer-optimization.md).
