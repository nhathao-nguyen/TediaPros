# -*- coding: utf-8 -*-
"""ocr-engine — doc chu chay tren video, xuat .srt va visual cues timeline (1.1.0)

Giao thuc: JSON-lines ra stdout:
  {"type":"info","frames":183,"fps":8}
  {"type":"progress","percent":42}
  {"type":"done","output":"...","visual_cues":"...","count":48,...}
  {"type":"error","message":"..."}
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

from visual_timeline import (
    FEATURES,
    NG_DOI,
    build_accurate_timeline,
    build_fast_timeline,
    clip_polygon_to_rect,
    hhmmss,
    khung_on_dinh,
    mask_chu,
    jaccard,
    phan_doan,
    polygon_shoelace_area,
    polygon_to_aabb,
    timeline_to_srt,
    write_visual_timeline,
)

VERSION = "1.1.0"
PROTOCOL = "ocr-local/1"
ENGINE_NAME = "rapidocr"

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def rut_khung_legacy(ffmpeg, video, thu_muc, fps):
    p = subprocess.run(
        [ffmpeg, "-y", "-i", video, "-vf", "fps=%d" % fps, "-q:v", "2",
         os.path.join(thu_muc, "f%06d.jpg")],
        capture_output=True,
    )
    if p.returncode != 0:
        raise RuntimeError("ffmpeg: %s" % p.stderr.decode("utf-8", "replace")[-300:])
    return sorted(os.path.join(thu_muc, f) for f in os.listdir(thu_muc) if f.endswith(".jpg"))


def resolve_ffprobe(ffmpeg_path):
    ffmpeg_dir = os.path.dirname(os.path.abspath(ffmpeg_path))
    base_name = os.path.basename(ffmpeg_path)
    _, ext = os.path.splitext(base_name)
    probe_name = "ffprobe" + ext
    candidate = os.path.join(ffmpeg_dir, probe_name)
    if os.path.isfile(candidate):
        return candidate
    if os.path.isfile(os.path.join(ffmpeg_dir, "ffprobe.exe")):
        return os.path.join(ffmpeg_dir, "ffprobe.exe")
    if os.path.isfile(os.path.join(ffmpeg_dir, "ffprobe")):
        return os.path.join(ffmpeg_dir, "ffprobe")
    raise RuntimeError(f"Không tìm thấy ffprobe cùng thư mục với ffmpeg: {ffmpeg_path}")


def probe_duration(ffprobe, video):
    p = subprocess.run(
        [
            ffprobe,
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=duration:format=duration",
            "-of", "json",
            video,
        ],
        capture_output=True,
        text=True,
    )
    if p.returncode != 0:
        raise RuntimeError("ffprobe: " + p.stderr.strip()[-300:])
    data = json.loads(p.stdout)
    streams = data.get("streams", [])
    if streams:
        dur_str = streams[0].get("duration")
        if dur_str:
            try:
                d = float(dur_str)
                if d > 0:
                    return d
            except ValueError:
                pass
    fmt = data.get("format", {})
    dur_str = fmt.get("duration")
    if dur_str:
        try:
            d = float(dur_str)
            if d > 0:
                return d
        except ValueError:
            pass
    raise RuntimeError(f"Không thể xác định thời lượng video cho {video}")


def gpu_that_su_chay():
    """Thu THAT xem DirectML co an khong."""
    try:
        import onnxruntime as ort
        if "DmlExecutionProvider" not in ort.get_available_providers():
            return False
        import rapidocr_onnxruntime, os as _os, glob as _glob
        md = _glob.glob(_os.path.join(_os.path.dirname(rapidocr_onnxruntime.__file__), "models", "*det*.onnx"))
        if not md:
            return False
        s = ort.InferenceSession(md[0], providers=["DmlExecutionProvider", "CPUExecutionProvider"])
        return "DmlExecutionProvider" in s.get_providers()
    except Exception:
        return False


def tao_ocr():
    """Tao RapidOCR uu tien DirectML (GPU), tu tut CPU neu khong duoc."""
    from rapidocr_onnxruntime import RapidOCR
    if gpu_that_su_chay():
        try:
            o = RapidOCR(det_use_dml=True, cls_use_dml=True, rec_use_dml=True)
            emit({"type": "status", "message": "Dùng tăng tốc GPU…"})
            return o
        except Exception:
            pass
    return RapidOCR()


def run_visual(args):
    import cv2

    ffprobe = resolve_ffprobe(args.ffmpeg)
    duration = probe_duration(ffprobe, args.input)

    ocr = tao_ocr()
    with tempfile.TemporaryDirectory() as td:
        emit({"type": "status", "message": "Đang tách khung hình display-space…"})
        filter_value = (
            "setpts=PTS-STARTPTS,"
            f"scale={args.display_width}:{args.display_height}:flags=lanczos,"
            "setsar=1,fps=8"
        )
        p = subprocess.run(
            [
                args.ffmpeg,
                "-y",
                "-hide_banner",
                "-nostdin",
                "-loglevel", "error",
                "-i", args.input,
                "-vf", filter_value,
                "-start_number", "0",
                os.path.join(td, "f%06d.png"),
            ],
            capture_output=True,
        )
        if p.returncode != 0:
            raise RuntimeError("ffmpeg: %s" % p.stderr.decode("utf-8", "replace")[-300:])

        pattern = re.compile(r"^f([0-9]{6})\.png$")
        matched_files = []
        for fn in os.listdir(td):
            m = pattern.match(fn)
            if m:
                matched_files.append((int(m.group(1)), os.path.join(td, fn)))

        if not matched_files:
            raise RuntimeError("Không tách được khung hình nào từ video")

        matched_files.sort(key=lambda x: x[0])
        for idx, (seq, _) in enumerate(matched_files):
            if seq != idx:
                raise RuntimeError(f"Chỉ số khung hình không liên tục: mong đợi {idx}, nhận được {seq}")

        frame_paths = [path for _, path in matched_files]

        # Verify decoded frame dimensions
        for fp in frame_paths:
            im = cv2.imread(fp)
            if im is None:
                raise RuntimeError(f"Không thể đọc khung hình {fp}")
            if im.shape != (args.display_height, args.display_width, 3):
                raise RuntimeError(
                    f"Kích thước khung hình không khớp: mong đợi ({args.display_height}, {args.display_width}, 3), "
                    f"nhận được {im.shape}"
                )

        emit({"type": "info", "frames": len(frame_paths), "fps": 8, "width": args.display_width, "height": args.display_height})

        # Progress tracking wrapper around OCR detector
        total_frames = len(frame_paths)
        processed = [0]

        def detect(path):
            res, _ = ocr(path)
            processed[0] += 1
            emit({
                "type": "progress",
                "percent": int(processed[0] / total_frames * 100),
                "processed": processed[0],
                "total": total_frames,
            })
            return res or []

        meta = {
            "width": args.display_width,
            "height": args.display_height,
            "duration_seconds": duration,
            "frame_count": len(frame_paths),
            "geometry_fingerprint": args.geometry_fingerprint,
        }
        scan_region = {
            "x0": args.x0,
            "y0": args.y0,
            "x1": args.x1,
            "y1": args.y1,
        }

        emit({"type": "status", "message": f"Đang quét chữ profile {args.scan_profile}…"})
        if args.scan_profile == "accurate":
            timeline = build_accurate_timeline(frame_paths, detect, meta, scan_region)
        else:
            timeline = build_fast_timeline(frame_paths, detect, meta, scan_region)

        band_top, band_bot = None, None
        for s in timeline["segments"]:
            for b in s["boxes"]:
                band_top = b["y0"] if band_top is None else min(band_top, b["y0"])
                band_bot = b["y1"] if band_bot is None else max(band_bot, b["y1"])

        # Atomic write visual timeline
        write_visual_timeline(args.visual_cues_output, timeline)

        # Atomic write derived SRT
        srt_content = timeline_to_srt(timeline)
        out_dir = os.path.dirname(os.path.abspath(args.output))
        os.makedirs(out_dir, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=out_dir, delete=False, mode="w", encoding="utf-8") as tmp_srt:
            tmp_srt.write(srt_content)
            tmp_srt.flush()
            os.fsync(tmp_srt.fileno())
            temp_srt_name = tmp_srt.name
        os.replace(temp_srt_name, args.output)

        subs_count = len([line for line in srt_content.splitlines() if "-->" in line])
        emit({
            "type": "done",
            "output": args.output,
            "visual_cues": args.visual_cues_output,
            "count": subs_count,
            "segment_count": len(timeline["segments"]),
            "box_count": sum(len(s["boxes"]) for s in timeline["segments"]),
            "profile": args.scan_profile,
            "band_top": int(band_top) if band_top is not None else None,
            "band_bot": int(band_bot) if band_bot is not None else None,
        })
        return 0


def run_legacy(args):
    import cv2
    import numpy as np

    ocr = tao_ocr()
    with tempfile.TemporaryDirectory() as td:
        emit({"type": "status", "message": "Đang tách khung hình…"})
        files = rut_khung_legacy(args.ffmpeg, args.input, td, args.fps)
        if not files:
            raise RuntimeError("Không tách được khung hình nào")

        im0 = cv2.imread(files[0])
        H, W = im0.shape[0], im0.shape[1]
        y0 = args.y0 if args.y0 >= 0 else int(H * 0.75)
        y1 = args.y1 if args.y1 > 0 else H
        x0 = args.x0 if args.x0 >= 0 else 0
        x1 = args.x1 if args.x1 > 0 else W
        emit({"type": "info", "frames": len(files), "fps": args.fps, "height": H})

        emit({"type": "status", "message": "Đang tìm chỗ chữ đổi…"})
        doan, rung = phan_doan(files, y0=y0, y1=y1, x0=x0, x1=x1, cv2=cv2, np=np)

        subs = []
        band_top, band_bot = None, None
        scan_rect = {"x0": x0, "y0": y0, "x1": x1, "y1": y1}

        for k, (a, b) in enumerate(doan):
            stable_idx = khung_on_dinh(rung, a, b)
            res, _ = ocr(files[stable_idx])
            qualifying = []
            for item in (res or []):
                nb = normalize_rapidocr_item(item, scan_rect)
                if nb is not None:
                    qualifying.append(nb)
                    band_top = nb["y0"] if band_top is None else min(band_top, nb["y0"])
                    band_bot = nb["y1"] if band_bot is None else max(band_bot, nb["y1"])

            full_text, _ = sort_and_group_boxes(qualifying)
            ordered_line_texts = full_text
            emit({
                "type": "progress",
                "percent": int((k + 1) / len(doan) * 100),
                "text": full_text,
            })
            if not full_text:
                continue
            if subs and subs[-1][2] == full_text and abs(subs[-1][1] - a / args.fps) < 1e-6:
                subs[-1] = (subs[-1][0], b / args.fps, full_text)
            else:
                subs.append((a / args.fps, b / args.fps, full_text))

        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            for i, (a, b, t) in enumerate(subs, 1):
                f.write("%d\n%s --> %s\n%s\n\n" % (i, hhmmss(a), hhmmss(b), t))
        emit({
            "type": "done",
            "output": args.output,
            "count": len(subs),
            "band_top": int(band_top) if band_top is not None else None,
            "band_bot": int(band_bot) if band_bot is not None else None,
        })
        return 0


def main():
    p = argparse.ArgumentParser(description="ocr-engine")
    p.add_argument("--version", action="store_true", help="in phien ban va protocol")
    p.add_argument("--probe", action="store_true", help="kiem tra kha nang chay thuc te")
    p.add_argument("--input", help="file video")
    p.add_argument("--output", help="file .srt xuat ra")
    p.add_argument("--visual-cues-output", help="file .json chua visual cues timeline")
    p.add_argument("--scan-profile", choices=["accurate", "fast"], default="fast", help="profile scan visual")
    p.add_argument("--display-width", type=int, default=-1, help="chieu rong video display-space")
    p.add_argument("--display-height", type=int, default=-1, help="chieu cao video display-space")
    p.add_argument("--geometry-fingerprint", default="", help="fingerprint hinh hoc canonical")
    p.add_argument("--y0", type=int, default=-1, help="mep TREN vung chu (px)")
    p.add_argument("--y1", type=int, default=-1, help="mep DUOI vung chu (px)")
    p.add_argument("--x0", type=int, default=-1, help="mep TRAI vung chu (px)")
    p.add_argument("--x1", type=int, default=-1, help="mep PHAI vung chu (px)")
    p.add_argument("--fps", type=int, default=2, help="so khung/giay lay ra")
    p.add_argument("--ffmpeg", default="ffmpeg", help="duong dan ffmpeg")
    args = p.parse_args()

    if args.version:
        emit({
            "type": "version",
            "protocol": PROTOCOL,
            "engine": ENGINE_NAME,
            "version": VERSION,
            "features": FEATURES,
        })
        return 0

    if args.probe:
        try:
            tao_ocr()
            emit({
                "type": "probe",
                "protocol": PROTOCOL,
                "ready": True,
                "engine": ENGINE_NAME,
                "version": VERSION,
                "features": FEATURES,
                "gpu": gpu_that_su_chay(),
            })
            return 0
        except Exception as e:
            emit({
                "type": "probe",
                "protocol": PROTOCOL,
                "ready": False,
                "engine": ENGINE_NAME,
                "version": VERSION,
                "features": FEATURES,
                "error": str(e),
            })
            return 1

    if not args.input or not args.output:
        p.print_help()
        return 1

    if args.visual_cues_output:
        if args.fps != 8:
            emit({"type": "error", "message": "Visual cues mode requires --fps 8"})
            return 1
        if args.display_width <= 0 or args.display_height <= 0:
            emit({"type": "error", "message": "Invalid display dimensions"})
            return 1
        if not re.match(r"^[0-9a-fA-F]{64}$", args.geometry_fingerprint or ""):
            emit({"type": "error", "message": "Invalid geometry fingerprint"})
            return 1
        if (
            args.x0 < 0
            or args.y0 < 0
            or args.x1 > args.display_width
            or args.y1 > args.display_height
            or args.x0 >= args.x1
            or args.y0 >= args.y1
        ):
            emit({"type": "error", "message": "Invalid scan rectangle"})
            return 1

    try:
        if args.visual_cues_output:
            return run_visual(args)
        return run_legacy(args)
    except Exception as e:
        emit({"type": "error", "message": str(e)[:300]})
        return 1


if __name__ == "__main__":
    sys.exit(main())
