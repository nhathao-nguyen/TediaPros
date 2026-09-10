"""Isolated CPU/DirectML detector microbenchmark; does not modify the app runtime.

Run from the repository root with Python's existing onnxruntime-directml,
numpy and OpenCV. This is NOT full OCR or an AutoShort throughput benchmark.
"""

import argparse
from collections import Counter
import gc
import hashlib
import json
from pathlib import Path
import statistics
import tempfile
import time

import cv2
import numpy as np
import onnxruntime as ort


def options(profile_prefix=None):
    opts = ort.SessionOptions()
    opts.enable_mem_pattern = False
    opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    opts.enable_cpu_mem_arena = False
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    if profile_prefix:
        opts.enable_profiling = True
        opts.profile_file_prefix = str(profile_prefix)
    return opts


def prepare(video):
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise RuntimeError("Cannot open the explicitly selected source video")
    samples = []
    try:
        for seconds in (5, 35, 90):
            cap.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000)
            ok, frame = cap.read()
            if not ok or frame.shape[:2] != (1920, 1080):
                raise RuntimeError("Probe requires the selected 1080x1920 video")
            # Existing audit ROI y=1382..1766, x=0..1080, plus engine halo=32.
            crop = frame[1350:1798, :1080]
            h, w = crop.shape[:2]
            scale = max(1.0, 736 / min(h, w))
            rh = round(int(h * scale) / 32) * 32
            rw = round(int(w * scale) / 32) * 32
            resized = cv2.resize(crop, (rw, rh)).astype(np.float32) / 255.0
            # Matches the installed RapidOCR 1.2.3 detector normalization.
            normalized = (resized - np.array([0.485, 0.456, 0.406], np.float32))
            normalized /= np.array([0.229, 0.224, 0.225], np.float32)
            samples.append(np.ascontiguousarray(normalized.transpose(2, 0, 1)[None]))
    finally:
        cap.release()
    return samples


def measure(model, samples, provider):
    providers = [provider] if provider == "CPUExecutionProvider" else [provider, "CPUExecutionProvider"]
    started = time.perf_counter()
    session = ort.InferenceSession(str(model), sess_options=options(), providers=providers)
    init_ms = (time.perf_counter() - started) * 1000
    if session.get_providers()[0] != provider:
        raise RuntimeError(f"Requested {provider}, received {session.get_providers()}")
    name = session.get_inputs()[0].name
    started = time.perf_counter()
    session.run(None, {name: samples[0]})
    first_run_ms = (time.perf_counter() - started) * 1000
    for sample in samples:
        session.run(None, {name: sample})
    latencies = []
    outputs = []
    for repeat in range(3):
        for sample in samples:
            started = time.perf_counter()
            output = session.run(None, {name: sample})[0]
            latencies.append((time.perf_counter() - started) * 1000)
            if repeat == 0:
                outputs.append(output)
    result = {
        "provider": provider,
        "session_providers": session.get_providers(),
        "init_ms": round(init_ms, 3),
        "first_run_ms": round(first_run_ms, 3),
        "warm_runs": len(latencies),
        "mean_ms": round(statistics.mean(latencies), 3),
        "median_ms": round(statistics.median(latencies), 3),
        "latencies_ms": [round(x, 3) for x in latencies],
    }
    del session
    gc.collect()
    return result, outputs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    args = parser.parse_args()
    samples = prepare(args.video)
    print(json.dumps({"phase": "inputs_ready", "shapes": [x.shape for x in samples]}, default=list), flush=True)
    cpu, cpu_outputs = measure(args.model, samples, "CPUExecutionProvider")
    print(json.dumps({"phase": "cpu_done", **cpu}), flush=True)
    dml, dml_outputs = measure(args.model, samples, "DmlExecutionProvider")
    print(json.dumps({"phase": "dml_done", **dml}), flush=True)
    # Separate untimed profiling run verifies actual execution, not just EP availability.
    profile_dir = Path(tempfile.mkdtemp(prefix="tedia-ocr-gpu-probe-"))
    session = ort.InferenceSession(str(args.model), sess_options=options(profile_dir / "dml"),
                                 providers=["DmlExecutionProvider", "CPUExecutionProvider"])
    session.run(None, {session.get_inputs()[0].name: samples[0]})
    profile_path = Path(session.end_profiling())
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    counts = Counter(e.get("args", {}).get("provider") for e in profile
                     if e.get("cat") == "Node" and e.get("args", {}).get("provider"))
    if counts["DmlExecutionProvider"] == 0:
        raise RuntimeError("Profile did not confirm any DirectML-executed node")
    comparisons = []
    for cpu_out, dml_out in zip(cpu_outputs, dml_outputs):
        c, d = cpu_out > 0.3, dml_out > 0.3
        union = np.count_nonzero(c | d)
        comparisons.append({
            "max_abs_diff": float(np.max(np.abs(cpu_out - dml_out))),
            "mean_abs_diff": float(np.mean(np.abs(cpu_out - dml_out))),
            "threshold_0_3_iou": float(np.count_nonzero(c & d) / union) if union else 1.0,
        })
    print(json.dumps({
        "scope": "detector ONNX inference only; excludes decode/preprocess/postprocess/cls/rec/AutoShort",
        "ort_version": ort.__version__,
        "ort_path": ort.__file__,
        "model_sha256": hashlib.sha256(args.model.read_bytes()).hexdigest(),
        "sample_sha256": [hashlib.sha256(x.tobytes()).hexdigest() for x in samples],
        "sample_seconds": [5, 35, 90],
        "cpu": cpu, "dml": dml,
        "warm_mean_speedup": round(cpu["mean_ms"] / dml["mean_ms"], 3),
        "comparisons": comparisons,
        "profile_node_counts": dict(counts),
        "profile_path": str(profile_path),
    }), flush=True)


if __name__ == "__main__":
    main()
