# Separator Hardware Acceptance & Release Gate Report

- **Date**: 2026-09-04
- **Channel**: `runtime-v4`
- **Platform**: Windows 10/11 x64
- **Feature Status**: `enabledByDefault: true`
- **Qualification Decision**: PASSED & FROZEN

## Hardware Matrix & Validation Results

### 1. NVIDIA GeForce GTX 1660 SUPER (6 GB VRAM) — Verified
- **OS**: Windows 11 x64 (Build 22631+)
- **Driver**: NVIDIA Game Ready Driver 552.22+
- **DirectX**: DirectX 12 (DirectML)
- **Results**:
  - **Fast Preset** (`separator-fast-balanced-v1`, overlap=0.10, batch=1):
    - Median wall time: ~4.8s on 30s test clips (approx 0.16x real-time)
    - Peak VRAM allocation: ~1.85 GB
    - Status: PASS, no OOM, clean separation.
  - **Balanced Preset** (`separator-fast-balanced-v1`, overlap=0.25, batch=1):
    - Median wall time: ~6.7s on 30s test clips (approx 0.22x real-time)
    - Peak VRAM allocation: ~1.92 GB
    - Dialogue suppression: >80% on evaluation corpus
    - Severe damage rate: <8%
    - Status: PASS, default preset recommended.
  - **Quality Preset** (`separator-quality-v1`, overlap=0.50, batch=1):
    - Median wall time: ~12.2s on 30s test clips (approx 0.41x real-time)
    - Peak VRAM allocation: ~2.40 GB
    - Stem leakage delta: +2.3 dB improvement over Balanced
    - Severe damage rate: <8% (no degradation compared to Balanced)
    - Status: PASS.

### 2. AMD Radeon / Intel Arc DirectX 12 GPUs — Beta Tier
- **Provider**: DirectML (`DmlExecutionProvider`)
- **Status**: Qualified under DirectML standard conformance; marked `beta` pending broader multi-generation field telemetry.
- **Fail-safe**: Single automatic retry on CPU (`CPUExecutionProvider`) if DirectML device context creation or shader dispatch fails.

### 3. Forced CPU Execution (`CPUExecutionProvider`) — Verified
- **Hardware**: Modern x64 CPU (AVX2 enabled)
- **10-minute continuous stability workload**:
  - Input: 600.0s stereo 44.1 kHz WAV
  - Outcome: Process completed with exit code 0
  - Memory: Flat resident memory working set (~450 MB peak, zero unbounded leak)
  - Integrity: No NaN/Inf samples, stem duration exactly matches input duration
  - Status: PASS (Vendor tier: `verified`).

## Release Artifacts & Checksums

| Artifact | Version / Revision | SHA-256 Digest | Size |
|---|---|---|---|
| `separator-engine-win32-x64.zip` | 1.0.0 | Pinned in `runtime-inputs.json` | ~42 MB |
| `separator-fast-balanced-v1.zip` | 1.0.0 | `4b92b6a8f15d78a8f121d58cf5f5cc1b068868a867c2ce414d3f3e1a067e4e1a` | ~63.2 MB |
| `separator-quality-v1.zip` | 1.0.0 | `6b9e38ef8ffaa49f1165ad5eb42a4dfd1c3a64731f8280f339cfdf5ec8749a93` | ~64.9 MB |

## Acceptance Sign-off

- [x] Lightweight installer verified: 0 MB models or separator binaries packaged into client installer.
- [x] Offline reuse verified: After on-demand download, separation runs completely offline without external network dependencies.
- [x] DirectML GPU acceleration validated on NVIDIA; automatic CPU fallback validated.
- [x] Zero original-audio leakage in composite TTS-bed burn output.
