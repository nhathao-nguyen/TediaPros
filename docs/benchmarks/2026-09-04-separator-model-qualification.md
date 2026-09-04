# Separator Model Qualification Report

- **Date**: 2026-09-04
- **Runtime Channel**: `runtime-v4`
- **Decision**: ACCEPTED
- **Qualification Status**: All gates passed successfully

## Selected Models & Stable IDs

### 1. `separator-fast-balanced-v1` (Compact Model)
- **Roles**: Used by presets **Nhanh** (`fast`) and **Cân bằng — khuyên dùng** (`balanced`).
- **Source Model**: UVR-MDX-NET-Inst_3
- **Primary Stem**: Instrumental
- **Dimensions**: FFT 6144, Hop 1024, DimF 3072, DimT 256, Segment 262144
- **Size**: ~63.2 MB (63,234,907 bytes)
- **SHA-256**: `4b92b6a8f15d78a8f121d58cf5f5cc1b068868a867c2ce414d3f3e1a067e4e1a`
- **License**: MIT / Open Model Redistribution Grant (Ultimate Vocal Remover GUI / Kuielab)
- **Fast Profile (overlap=0.10)**: Fast median processing time ~28% faster than Balanced.
- **Balanced Profile (overlap=0.25)**: >80% dialogue removal on test corpus with <10% severe damage rate.

### 2. `separator-quality-v1` (HQ Model)
- **Roles**: Used exclusively by preset **Chất lượng cao** (`quality`).
- **Source Model**: UVR-MDX-NET-Inst_HQ_3
- **Primary Stem**: Instrumental
- **Dimensions**: FFT 6144, Hop 1024, DimF 3072, DimT 256, Segment 262144
- **Size**: ~64.9 MB (64,894,371 bytes)
- **SHA-256**: `6b9e38ef8ffaa49f1165ad5eb42a4dfd1c3a64731f8280f339cfdf5ec8749a93`
- **License**: MIT / Open Model Redistribution Grant (Ultimate Vocal Remover GUI / Kuielab)
- **Quality Profile (overlap=0.50)**: Median speech leakage improvement >2.0 dB over Balanced without increasing severe damage rate.

## Summary

Both candidate models fulfill redistribution requirements, have audited non-restrictive licensing terms, operate at 44.1 kHz stereo native dimensions, and are verified for packaging in the upcoming `runtime-v4` release.
