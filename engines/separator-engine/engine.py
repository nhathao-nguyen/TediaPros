#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
import numpy as np

from protocol import PROTOCOL, ENGINE, VERSION, EngineError, emit_event
from audio_io import read_pcm_wav, write_pcm_wav
from mdx import create_session, run_mdx_inference, complementary_stem

def handle_version():
    emit_event({
        "type": "version",
        "protocol": PROTOCOL,
        "engine": ENGINE,
        "version": VERSION,
        "features": ["directml", "cpu", "mdx-two-stem"],
    })
    sys.exit(0)

def handle_probe(model_path: str, manifest_path: str, provider: str):
    try:
        if not os.path.exists(model_path):
            raise EngineError("model_not_found", f"Model file not found: {model_path}", False)

        model_id = "unknown"
        if manifest_path and os.path.exists(manifest_path):
            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    mdata = json.load(f)
                    model_id = mdata.get("id", "unknown")
            except Exception:
                pass

        session, canonical_provider = create_session(model_path, provider)
        # Small probe inference with dummy input matching model shape
        input_meta = session.get_inputs()[0]
        input_shape = [dim if isinstance(dim, int) and dim > 0 else 1 for dim in input_meta.shape]
        dummy_tensor = np.zeros(input_shape, dtype=np.float32)
        session.run(None, {input_meta.name: dummy_tensor})

        emit_event({
            "type": "probe",
            "protocol": PROTOCOL,
            "ready": True,
            "provider": canonical_provider,
            "modelId": model_id,
        })
        sys.exit(0)
    except EngineError as e:
        emit_event({
            "type": "probe",
            "protocol": PROTOCOL,
            "ready": False,
            "provider": "cpu",
            "modelId": model_id if 'model_id' in locals() else "unknown",
            "message": e.message,
        })
        sys.exit(1)
    except Exception as e:
        emit_event({
            "type": "probe",
            "protocol": PROTOCOL,
            "ready": False,
            "provider": "cpu",
            "modelId": model_id if 'model_id' in locals() else "unknown",
            "message": str(e),
        })
        sys.exit(1)

def handle_separate(
    input_wav: str,
    output_dir: str,
    model_path: str,
    manifest_path: str,
    model_id: str,
    preset: str,
    overlap: float,
    provider: str,
):
    start_time = time.perf_counter()
    try:
        emit_event({"type": "progress", "percent": 0, "phase": "loading"})

        if not os.path.exists(input_wav):
            raise EngineError("input_not_found", f"Input WAV not found: {input_wav}", False)
        if not os.path.exists(model_path):
            raise EngineError("model_not_found", f"Model not found: {model_path}", False)

        mdx_meta = {}
        primary_stem = "instrumental"
        if manifest_path and os.path.exists(manifest_path):
            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    manifest_data = json.load(f)
                    mdx_meta = manifest_data.get("mdx", {})
                    primary_stem = mdx_meta.get("primaryStem", "instrumental")
            except Exception as e:
                raise EngineError("model_metadata_mismatch", f"Cannot parse manifest: {e}", False)

        mixture_audio = read_pcm_wav(input_wav)

        session, canonical_provider = create_session(model_path, provider)

        emit_event({"type": "progress", "percent": 5, "phase": "separating"})

        def progress_cb(pct: int):
            scaled_pct = int(5 + (pct * 0.85))
            emit_event({"type": "progress", "percent": scaled_pct, "phase": "separating"})

        primary_audio = run_mdx_inference(
            session=session,
            audio=mixture_audio,
            mdx_meta=mdx_meta,
            overlap=overlap,
            on_progress=progress_cb
        )

        secondary_audio = complementary_stem(mixture_audio, primary_audio)

        emit_event({"type": "progress", "percent": 95, "phase": "writing"})

        os.makedirs(output_dir, exist_ok=True)
        vocals_path = os.path.join(output_dir, "vocals.wav")
        instrumental_path = os.path.join(output_dir, "instrumental.wav")

        if primary_stem == "instrumental":
            write_pcm_wav(instrumental_path, primary_audio)
            write_pcm_wav(vocals_path, secondary_audio)
        else:
            write_pcm_wav(vocals_path, primary_audio)
            write_pcm_wav(instrumental_path, secondary_audio)

        elapsed_ms = int((time.perf_counter() - start_time) * 1000)

        emit_event({
            "type": "result",
            "vocalsPath": os.path.abspath(vocals_path),
            "instrumentalPath": os.path.abspath(instrumental_path),
            "provider": canonical_provider,
            "elapsedMs": elapsed_ms,
        })
        sys.exit(0)

    except EngineError as e:
        emit_event({
            "type": "error",
            "code": e.code,
            "message": e.message,
            "retryable": e.retryable,
        })
        sys.exit(1)
    except Exception as e:
        is_retryable = "dml" in str(e).lower() or "directml" in str(e).lower() or "device" in str(e).lower()
        code = "provider_execution_failed" if is_retryable else "engine_internal_error"
        emit_event({
            "type": "error",
            "code": code,
            "message": str(e),
            "retryable": is_retryable,
        })
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="Separator MDX ONNX Engine", add_help=False)
    parser.add_argument("--version", action="store_true")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--separate", action="store_true")
    parser.add_argument("--provider", default="auto", choices=["auto", "directml", "cpu"])
    parser.add_argument("--model", default=None)
    parser.add_argument("--model-manifest", default=None)
    parser.add_argument("--input", default=None)
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--model-id", default=None)
    parser.add_argument("--preset", default="balanced", choices=["fast", "balanced", "quality"])
    parser.add_argument("--overlap", type=float, default=0.25)
    parser.add_argument("--batch", type=int, default=1)

    try:
        args, unknown = parser.parse_known_args()
        if unknown:
            emit_event({
                "type": "error",
                "code": "invalid_arguments",
                "message": f"Unknown arguments: {unknown}",
                "retryable": False,
            })
            sys.exit(2)

        if args.version:
            handle_version()
        elif args.probe:
            if not args.model:
                emit_event({
                    "type": "error",
                    "code": "missing_arguments",
                    "message": "--model is required for --probe",
                    "retryable": False,
                })
                sys.exit(2)
            handle_probe(args.model, args.model_manifest, args.provider)
        elif args.separate:
            if not args.input or not args.output_dir or not args.model:
                emit_event({
                    "type": "error",
                    "code": "missing_arguments",
                    "message": "--input, --output-dir, and --model are required for --separate",
                    "retryable": False,
                })
                sys.exit(2)
            handle_separate(
                input_wav=args.input,
                output_dir=args.output_dir,
                model_path=args.model,
                manifest_path=args.model_manifest,
                model_id=args.model_id or "unknown",
                preset=args.preset,
                overlap=args.overlap,
                provider=args.provider,
            )
        else:
            emit_event({
                "type": "error",
                "code": "missing_command",
                "message": "Specify --version, --probe, or --separate",
                "retryable": False,
            })
            sys.exit(2)
    except Exception as e:
        emit_event({
            "type": "error",
            "code": "unhandled_cli_error",
            "message": str(e),
            "retryable": False,
        })
        sys.exit(2)

if __name__ == "__main__":
    main()
