# ADR 015: Decode packed video alpha before overlay geometry

- Status: Accepted
- Date: 2026-10-13

## Context

The user's screenshot shows a center seam with the CapCut resource named Overlay selected. The inspected asset is a 1024×512 H.264 video: its left half stores an alpha mask, and its right half stores 512×512 RGB effect frames. The old scanner assigned Screen to the whole opaque video. Cover/crop and blending therefore exposed the mask as a white overlay on one side of the source.

The package's Lumi metadata enables `enableVideoAlphaBlend_1_1` on its active video node. The corresponding crop shader reads left-half red as alpha and right-half RGB as color. `LumiLayer_489-blend` uses mode 2 (Multiply), which also differs from the scanner's Screen fallback.

## Decision

Add optional `packedAlpha: 'left'` to the existing typed effect/scanner/vault/composition contracts. It means alpha on the left and RGB on the right. Reject unknown layouts and combinations with separate matte, chroma key or texture layers. Legacy inputs without the field remain valid.

Read metadata literals and bounded shader text through containment checks; never execute Lua/shaders. Recognize the inspected Lumi family only when one video node's active aspect variants enable packed video alpha, its corresponding blend node has no separate matte, the scene binds one unique MP4 matching the chosen video, and the shader's sampling pattern confirms this layout. Supported blend modes are Normal (existing `alphamerge` mode), Add, Multiply and Screen. Do not infer a packing layout from filenames, 2:1 dimensions or grayscale appearance.

FFmpeg decodes the asset once, splits the decoded frame, crops right RGB/left alpha, extracts the red plane, and alpha-merges before scaling/cropping to the output geometry. Normal uses the RGBA foreground with strength multiplied into alpha. Screen/Multiply flatten it over the blend's neutral color before RGB blending; Add flattens over black then applies the existing clipped addition. The source controls PTS/frame count/EOF. No intermediate texture or user-video encode is introduced.

Preview draws the right region and left mask using identical cover geometry, inserts mask red into canvas alpha, and uses the corresponding blend/strength. The opaque raw video remains hidden. It paints only delivered frames/events and cleans listeners/frame callbacks on unmount. Both main preview and effect-picker cards carry the field.

Existing selected CapCut resources recover layout and native blend through `effects:composition`; existing saved items persist recovered layout/blend to atomic vault metadata. New saved items remain usable after CapCut removes its cache. Stored layout metadata is validated before use.

## Verification and limits

Independent mathematical pixel checks cover alpha 0/128/255 (with different mask green/blue to prove red-plane extraction), strength 25/100%, all four modes, full-frame output, EOF and portrait geometry. Metadata tests reject ambiguous scene bindings, inactive alpha, mixed active variants and unsupported modes. Vault migration/offline export keeps audio and frame count.

The actual inspected Overlay package is checked in hidden Electron with the real preview/control components and in production `burnAutoShort`. RGB samples across left/center/right agree with FFmpeg within 3 levels per channel; the output retains 24 frames/two seconds/audio and fully decodes. See [task](../../.ai/tasks/TASK-20261013-packed-overlay.md) and [before/after](../../.ai/tasks/2026-10-13-packed-overlay/comparison.png).

This fixes the inspected video layout and blend. It does not import the package's additional sharpening/vignette, keyframes, custom transforms or arbitrary shader graphs. Packages with different packing or ambiguous bindings require additional evidence and importer support. Source/dev is verified; the installed release and the user's original full clip are not part of this fixture.
