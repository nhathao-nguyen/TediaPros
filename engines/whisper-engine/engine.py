#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
whisper-engine — CLI phien am audio/video -> .srt / .txt / .vtt / .alignment.json bang faster-whisper.

Giao tiep qua STDOUT dang JSON-lines:
  {"type":"status",  "message": "..."}                  # thong bao chung
  {"type":"info",    "language": "vi", "duration": 123} # sau khi nhan dien
  {"type":"progress","seconds": 12.3, "duration": 123, "text": "..."}  # tien do (theo giay audio)
  {"type":"done",    "outputs": ["a.srt", ...], "segments": 10}         # xong
  {"type":"error",   "message": "..."}                  # loi
"""
import argparse
import json
import os
import sys

for _name in ("stdout", "stderr"):
    try:
        getattr(sys, _name).reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def emit(obj):
    """In 1 dong JSON ra stdout roi flush ngay."""
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def fmt_ts(seconds, sep=","):
    """Doi giay -> HH:MM:SS,mmm (SRT dung ',', VTT dung '.')."""
    if seconds is None or seconds < 0:
        seconds = 0
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return "%02d:%02d:%02d%s%03d" % (h, m, s, sep, ms)


def line_of(seg):
    """Dong chu cua 1 doan — them nhan nguoi noi neu co diarization."""
    text = seg["text"].strip()
    spk = seg.get("speaker")
    return "[%s] %s" % (spk, text) if spk else text


def write_srt(segments, path):
    with open(path, "w", encoding="utf-8") as f:
        for i, seg in enumerate(segments, 1):
            f.write("%d\n%s --> %s\n%s\n\n" % (
                i, fmt_ts(seg["start"]), fmt_ts(seg["end"]), line_of(seg)))


def write_vtt(segments, path):
    with open(path, "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n")
        for seg in segments:
            f.write("%s --> %s\n%s\n\n" % (
                fmt_ts(seg["start"], "."), fmt_ts(seg["end"], "."), line_of(seg)))


def write_txt(segments, path):
    with open(path, "w", encoding="utf-8") as f:
        for seg in segments:
            f.write(line_of(seg) + "\n")


def write_alignment_json(segments, path, duration, language):
    data = {
        "duration": duration,
        "language": language,
        "segments": segments,
        "cues": segments
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def resource_dir():
    """Thu muc chua tai nguyen kem theo."""
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def configure_cuda(cuda_dir):
    """Make bundled CUDA libraries visible before importing CTranslate2."""
    if not cuda_dir or not os.path.isdir(cuda_dir):
        return
    cdir = os.path.abspath(cuda_dir)
    os.environ["PATH"] = cdir + os.pathsep + os.environ.get("PATH", "")
    if hasattr(os, "add_dll_directory"):
        try:
            os.add_dll_directory(cdir)
        except Exception:
            pass


DIA_THRESHOLD = 0.8
MIN_SEG_SEC = 0.5


def _fill_missing_speakers(segments):
    last = None
    for s in segments:
        if s.get("speaker"):
            last = s["speaker"]
        elif last:
            s["speaker"] = last
    first = next((s["speaker"] for s in segments if s.get("speaker")), None)
    if first:
        for s in segments:
            if not s.get("speaker"):
                s["speaker"] = first


def diarize_segments(segments, input_path, num_speakers=0):
    try:
        # pyrefly: ignore [missing-import]
        import sherpa_onnx
        from faster_whisper.audio import decode_audio
    except Exception as e:
        emit({"type": "status", "message": "Bo qua nhan dien nguoi noi (thieu thu vien: %s)" % str(e)[:100]})
        return 0

    emb_model = os.path.join(resource_dir(), "dia-models", "embedding.onnx")
    if not os.path.isfile(emb_model):
        emit({"type": "status", "message": "Thieu model nhan dien nguoi noi — bo qua."})
        return 0

    try:
        ext = sherpa_onnx.SpeakerEmbeddingExtractor(
            sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=emb_model)
        )
        sr = 16000
        samples = decode_audio(input_path, sampling_rate=sr)

        embs, idxs = [], []
        for i, seg in enumerate(segments):
            chunk = samples[int(seg["start"] * sr): int(seg["end"] * sr)]
            if len(chunk) < int(MIN_SEG_SEC * sr):
                continue
            st = ext.create_stream()
            st.accept_waveform(sample_rate=sr, waveform=chunk)
            st.input_finished()
            embs.append(ext.compute(st))
            idxs.append(i)

        if not embs:
            return 0

        cl = sherpa_onnx.FastClustering(
            sherpa_onnx.FastClusteringConfig(
                num_clusters=int(num_speakers) if num_speakers and num_speakers > 0 else -1,
                threshold=DIA_THRESHOLD,
            )
        )
        labels = cl(embs)
        for i, lab in zip(idxs, labels):
            segments[i]["speaker"] = "SPEAKER_%02d" % lab
        _fill_missing_speakers(segments)
        return len({segments[i]["speaker"] for i in idxs})
    except Exception as e:
        emit({"type": "status", "message": "Loi nhan dien nguoi noi: %s" % str(e)[:100]})
        return 0


def main():
    p = argparse.ArgumentParser(description="whisper-engine")
    p.add_argument("--version", action="store_true", help="in phien ban va protocol")
    p.add_argument("--probe", action="store_true", help="kiem tra engine va backend")
    p.add_argument("--input", help="file audio/video dau vao (che do file)")
    p.add_argument("--output-dir", help="thu muc luu ket qua (che do file)")
    p.add_argument("--basename", default=None, help="ten file xuat (khong duoi)")
    p.add_argument("--model-path", default=None, help="local Faster-Whisper CTranslate2 model directory")
    p.add_argument("--language", default="auto", help="auto | ma ngon ngu (vi, en...)")
    p.add_argument("--task", default="transcribe", choices=["transcribe", "translate"])
    p.add_argument("--formats", default="srt", help="danh sach: srt,txt,vtt,json")
    p.add_argument("--device", default="auto", help="auto|cpu|cuda")
    p.add_argument("--compute-type", default=None, help="int8|float16|auto|...")
    p.add_argument("--threads", type=int, default=0, help="so luong CPU thread (0=auto)")
    p.add_argument("--cuda-dir", default=None, help="thu muc chua cuBLAS/cuDNN (goi tang toc GPU)")
    p.add_argument("--diarize", action="store_true", help="nhan dien ai noi luc nao")
    p.add_argument("--speakers", type=int, default=0, help="so nguoi noi (0 = tu doan)")
    args = p.parse_args()

    if args.version:
        emit({"type": "version", "protocol": "whisper-engine/1", "version": "1.0.0", "engine": "faster-whisper"})
        return 0

    if args.probe:
        device = args.device if args.device != "auto" else "cpu"
        configure_cuda(args.cuda_dir)
        try:
            import ctranslate2
            from faster_whisper import WhisperModel
            has_cuda = ctranslate2.get_cuda_device_count() > 0
            if device == "cuda" and not has_cuda:
                emit({"type": "probe", "protocol": "whisper-engine/1", "ready": False,
                      "engine": "faster-whisper", "device": "cuda", "cuda": False,
                      "modelLoaded": False, "error": "CTranslate2 không nhìn thấy CUDA."})
                return 1
            model_loaded = False
            if args.model_path:
                if not os.path.isdir(args.model_path):
                    raise RuntimeError("--model-path không phải thư mục model local")
                WhisperModel(args.model_path, device=device, compute_type="auto" if device == "cuda" else "int8")
                model_loaded = True
            emit({
                "type": "probe",
                "protocol": "whisper-engine/1",
                "ready": True,
                "engine": "faster-whisper",
                "device": device,
                "cuda": has_cuda,
                "modelLoaded": model_loaded
            })
            return 0
        except Exception as e:
            emit({"type": "probe", "protocol": "whisper-engine/1", "ready": False, "error": str(e)})
            return 1

    if not args.input or not args.output_dir:
        emit({"type": "error", "message": "Thieu --input hoac --output-dir"})
        return 1

    device = args.device
    if device == "auto":
        device = "cpu"

    configure_cuda(args.cuda_dir)

    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        emit({"type": "error", "message": "Khong nap duoc faster_whisper: %s" % e})
        return 1

    if args.compute_type:
        compute_type = args.compute_type
    elif device == "cuda":
        compute_type = "auto"
    else:
        compute_type = "int8"

    if not args.model_path or not os.path.isdir(args.model_path):
        emit({"type": "error", "message": "Thiếu model Faster-Whisper local (--model-path)."})
        return 1

    try:
        emit({"type": "status", "message": "Dang nap model local (%s)..." % device})
        model = WhisperModel(
            args.model_path,
            device=device,
            compute_type=compute_type,
            cpu_threads=max(0, args.threads),
        )
    except Exception as e:
        emit({"type": "error", "message": "Loi nap model: %s" % e})
        return 1

    lang = None if args.language in ("auto", "") else args.language
    try:
        segments, info = model.transcribe(
            args.input,
            language=lang,
            task=args.task,
            vad_filter=True,
            word_timestamps=True,
        )
    except Exception as e:
        emit({"type": "error", "message": "Loi phien am: %s" % e})
        return 1

    duration = float(getattr(info, "duration", 0) or 0)
    emit({
        "type": "info",
        "language": getattr(info, "language", None),
        "language_probability": getattr(info, "language_probability", None),
        "duration": duration,
    })

    collected = []
    try:
        for seg in segments:
            words = []
            if getattr(seg, "words", None):
                for w in seg.words:
                    words.append({
                        "text": w.word.strip(),
                        "start": float(w.start),
                        "end": float(w.end),
                        "probability": float(getattr(w, "probability", 1.0) or 1.0)
                    })
            item = {
                "start": float(seg.start),
                "end": float(seg.end),
                "text": seg.text.strip(),
                "words": words
            }
            collected.append(item)
            emit({
                "type": "progress",
                "seconds": float(seg.end or 0),
                "duration": duration,
                "text": seg.text.strip()
            })
    except Exception as e:
        emit({"type": "error", "message": "Loi trong khi phien am: %s" % e})
        return 1

    speakers_found = 0
    if args.diarize and collected:
        try:
            emit({"type": "status", "message": "Dang nhan dien nguoi noi..."})
            speakers_found = diarize_segments(collected, args.input, args.speakers)
            if speakers_found:
                emit({"type": "status", "message": "Nhan dien xong: %d nguoi noi" % speakers_found})
        except Exception as e:
            emit({"type": "status", "message": "Bo qua nhan dien nguoi noi: %s" % str(e)[:120]})

    base = args.basename or os.path.splitext(os.path.basename(args.input))[0]
    os.makedirs(args.output_dir, exist_ok=True)
    fmts = [x.strip().lower() for x in args.formats.split(",") if x.strip()]
    outputs = []
    if "srt" in fmts:
        pth = os.path.join(args.output_dir, base + ".srt")
        write_srt(collected, pth)
        outputs.append(pth)
    if "vtt" in fmts:
        pth = os.path.join(args.output_dir, base + ".vtt")
        write_vtt(collected, pth)
        outputs.append(pth)
    if "txt" in fmts:
        pth = os.path.join(args.output_dir, base + ".txt")
        write_txt(collected, pth)
        outputs.append(pth)

    # Luon ghi alignment JSON neu co word timestamps de Auto Short va timeline doc duoc
    align_pth = os.path.join(args.output_dir, base + ".alignment.json")
    write_alignment_json(collected, align_pth, duration, getattr(info, "language", None))
    outputs.append(align_pth)

    emit({
        "type": "done",
        "outputs": outputs,
        "alignment": align_pth,
        "segments": len(collected),
        "speakers": speakers_found
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
