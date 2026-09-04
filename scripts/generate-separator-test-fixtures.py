#!/usr/bin/env python3
import argparse
import json
import math
import os
import struct
import wave

SAMPLE_RATE = 44100

def write_wav(file_path: str, samples_left: list[float], samples_right: list[float]) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
    with wave.open(file_path, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for l, r in zip(samples_left, samples_right):
            l_clamped = max(-1.0, min(1.0, l))
            r_clamped = max(-1.0, min(1.0, r))
            l_int = int(l_clamped * 32767.0)
            r_int = int(r_clamped * 32767.0)
            frames.extend(struct.pack("<hh", l_int, r_int))
        wf.writeframes(frames)

def generate_fixtures(output_dir: str) -> None:
    output_dir = os.path.abspath(output_dir)
    os.makedirs(output_dir, exist_ok=True)

    cases = [
        ("speech_music_synth", "known_stem", 2.0),
        ("transient_sfx_synth", "known_stem", 1.5),
        ("silence_synth", "known_stem", 1.0),
        ("tonal_music_synth", "known_stem", 2.5),
    ]

    manifest_cases = []

    for case_id, kind, duration in cases:
        total_samples = int(duration * SAMPLE_RATE)
        vocals_l = [0.0] * total_samples
        vocals_r = [0.0] * total_samples
        inst_l = [0.0] * total_samples
        inst_r = [0.0] * total_samples

        for i in range(total_samples):
            t = i / SAMPLE_RATE
            if case_id == "speech_music_synth":
                # Speech: formant-like pulsed chirps (300Hz-2500Hz) modulated at 4Hz
                speech_mod = 0.5 * (1.0 + math.sin(2 * math.pi * 4.0 * t))
                v = 0.4 * speech_mod * (math.sin(2 * math.pi * 440.0 * t) + 0.5 * math.sin(2 * math.pi * 1200.0 * t))
                vocals_l[i] = v
                vocals_r[i] = v

                # Music: chord (261.6Hz C4, 329.6Hz E4, 392.0Hz G4)
                m = 0.25 * (math.sin(2 * math.pi * 261.63 * t) + math.sin(2 * math.pi * 329.63 * t) + math.sin(2 * math.pi * 392.0 * t))
                inst_l[i] = m
                inst_r[i] = m
            elif case_id == "transient_sfx_synth":
                # Short clicks/bursts
                transient = math.sin(2 * math.pi * 1000.0 * t) * math.exp(-((t % 0.4) * 50.0))
                inst_l[i] = 0.6 * transient
                inst_r[i] = 0.6 * transient
            elif case_id == "silence_synth":
                pass
            elif case_id == "tonal_music_synth":
                m = 0.3 * math.sin(2 * math.pi * 440.0 * t) + 0.2 * math.sin(2 * math.pi * 880.0 * t)
                inst_l[i] = m
                inst_r[i] = m

        mixture_l = [max(-1.0, min(1.0, v + m)) for v, m in zip(vocals_l, inst_l)]
        mixture_r = [max(-1.0, min(1.0, v + m)) for v, m in zip(vocals_r, inst_r)]

        mix_path = os.path.join(output_dir, f"{case_id}_mixture.wav")
        voc_path = os.path.join(output_dir, f"{case_id}_vocals.wav")
        inst_path = os.path.join(output_dir, f"{case_id}_instrumental.wav")

        write_wav(mix_path, mixture_l, mixture_r)
        write_wav(voc_path, vocals_l, vocals_r)
        write_wav(inst_path, inst_l, inst_r)

        manifest_cases.append({
            "caseId": case_id,
            "kind": kind,
            "mixturePath": mix_path,
            "vocalsReferencePath": voc_path,
            "instrumentalReferencePath": inst_path,
            "durationSeconds": duration,
        })

    manifest_path = os.path.join(output_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({"schemaVersion": 1, "cases": manifest_cases}, f, indent=2)

    print(f"Generated {len(manifest_cases)} fixtures into {output_dir}")

def main():
    parser = argparse.ArgumentParser(description="Generate deterministic separator test fixtures")
    parser.add_argument("--output-dir", required=True, help="Output directory for generated WAV fixtures")
    args = parser.parse_args()
    generate_fixtures(args.output_dir)

if __name__ == "__main__":
    main()
