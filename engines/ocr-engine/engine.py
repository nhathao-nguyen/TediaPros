# -*- coding: utf-8 -*-
"""ocr-engine — doc chu chay tren video, xuat .srt va visual cues timeline (1.2.0)

Giao thuc: JSON-lines ra stdout:
  {"type":"info","frames":183,"fps":8}
  {"type":"progress","percent":42}
  {"type":"done","output":"...","visual_cues":"...","count":48,...}
  {"type":"error","message":"..."}
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import numpy as np

from visual_timeline import (
    FEATURES,
    NG_DOI,
    build_accurate_timeline,
    build_fast_timeline,
    build_fast_timeline_stream,
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
    normalize_rapidocr_item,
    sort_and_group_boxes,
    OCR_VISUAL_MAX_BOXES_PER_SEGMENT,
)

VERSION = "1.2.0"
PROTOCOL = "ocr-local/1"
ENGINE_NAME = "rapidocr"
IMPLEMENTATION_FINGERPRINT = hashlib.sha256(
    b"tediapros-ocr-engine|1.2.0|visual-stream-full-v1|visual-stream-roi-v1|halo=32|fps=8"
).hexdigest()
VISUAL_TRANSPORTS = ("legacy-disk", "stream-full", "stream-roi")


def resolve_visual_transport(transport, legacy_disk_extract=False):
    """Resolve the visual transport while keeping the legacy alias unambiguous."""
    requested = transport or "stream-full"
    if requested not in VISUAL_TRANSPORTS:
        raise ValueError("visual transport không được hỗ trợ")
    if legacy_disk_extract and requested != "legacy-disk":
        raise ValueError("--legacy-disk-extract và --visual-transport mâu thuẫn")
    return "legacy-disk" if legacy_disk_extract else requested


def _session_providers(candidate):
    """Return providers reported by an actual ONNX session, if discoverable."""
    seen = set()
    pending = [candidate]
    for _ in range(8):
        if not pending:
            break
        value = pending.pop(0)
        if value is None or id(value) in seen:
            continue
        seen.add(id(value))
        getter = getattr(value, "get_providers", None)
        if callable(getter):
            try:
                providers = getter()
                if providers:
                    return [str(provider) for provider in providers]
            except Exception:
                pass
        providers = getattr(value, "providers", None)
        if isinstance(providers, (list, tuple)) and providers:
            return [str(provider) for provider in providers]
        for attr in ("session", "ort_session", "_session", "model"):
            try:
                nested = getattr(value, attr, None)
            except Exception:
                nested = None
            if nested is not None:
                pending.append(nested)
    return None


def get_ocr_provider_report(ocr):
    """Report det/cls/rec providers from their live sessions, never a startup guess."""
    report = {}
    for component in ("det", "cls", "rec"):
        candidates = [
            getattr(ocr, f"{component}_model", None),
            getattr(ocr, f"_{component}_model", None),
            getattr(ocr, component, None),
        ]
        providers = None
        for candidate in candidates:
            providers = _session_providers(candidate)
            if providers:
                break
        report[component] = providers[0] if providers else None
    return report

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


def kill_process_tree(proc):
    """Terminate or kill a subprocess and any children safely on Windows and POSIX."""
    if proc is None or proc.poll() is not None:
        return
    pid = proc.pid
    if sys.platform == "win32":
        try:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
            )
        except Exception:
            pass
    try:
        proc.kill()
    except Exception:
        pass


def stream_video_frames(ffmpeg_path, video_path, display_width, display_height, no_progress_timeout_seconds=120.0):
    """Doc raw frames tu ffmpeg pipe qua queue toi da 2 frames, co read watchdog timeout."""
    import queue
    import time

    filter_value = (
        "setpts=PTS-STARTPTS,"
        f"scale={display_width}:{display_height}:flags=lanczos,"
        "setsar=1,fps=8"
    )
    cmd = [
        ffmpeg_path,
        "-y",
        "-hide_banner",
        "-nostdin",
        "-loglevel", "error",
        "-i", video_path,
        "-vf", filter_value,
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "pipe:1",
    ]

    frame_bytes = display_width * display_height * 3
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=4 * frame_bytes,
    )

    stderr_chunks = []
    stderr_total_bytes = 0
    max_stderr_bytes = 80 * 1024
    stop_event = threading.Event()

    def drain_stderr():
        nonlocal stderr_total_bytes
        try:
            while not stop_event.is_set():
                chunk = proc.stderr.read(4096)
                if not chunk:
                    break
                text = chunk.decode("utf-8", "replace")
                stderr_chunks.append(text)
                stderr_total_bytes += len(chunk)
                while stderr_total_bytes > max_stderr_bytes and len(stderr_chunks) > 1:
                    removed = stderr_chunks.pop(0)
                    stderr_total_bytes -= len(removed.encode("utf-8", "replace"))
        except Exception:
            pass

    stderr_thread = threading.Thread(target=drain_stderr, daemon=True)
    stderr_thread.start()

    q = queue.Queue(maxsize=2)
    producer_exc = []

    def frame_reader():
        frame_idx = 0
        try:
            while not stop_event.is_set():
                buf = bytearray()
                while len(buf) < frame_bytes and not stop_event.is_set():
                    chunk = proc.stdout.read(frame_bytes - len(buf))
                    if not chunk:
                        break
                    buf.extend(chunk)

                if stop_event.is_set():
                    break

                if len(buf) == 0:
                    # Normal EOF
                    break

                if len(buf) < frame_bytes:
                    raise RuntimeError(
                        f"FFmpeg stdout kết thúc đột ngột ở frame {frame_idx}: đọc {len(buf)}/{frame_bytes} bytes"
                    )

                frame = np.frombuffer(buf, dtype=np.uint8).reshape((display_height, display_width, 3))
                # Put with check on stop_event so we don't hang if consumer aborted
                while not stop_event.is_set():
                    try:
                        q.put((frame_idx, frame), timeout=0.1)
                        break
                    except queue.Full:
                        continue

                frame_idx += 1
        except Exception as e:
            producer_exc.append(e)
        finally:
            # Never block shutdown on a full bounded queue.  A cancelled
            # consumer has no reason to receive the EOF sentinel; a normal
            # consumer still gets it after it drains one of the queued frames.
            while True:
                try:
                    q.put_nowait(None)  # Sentinel indicating EOF or error
                    break
                except queue.Full:
                    if stop_event.is_set():
                        break
                    time.sleep(0.01)

    reader_thread = threading.Thread(target=frame_reader, daemon=True)
    reader_thread.start()

    actual_frames = 0
    original_error = None
    try:
        while True:
            # Consumer waits for next frame with no_progress_timeout_seconds watchdog
            try:
                item = q.get(timeout=no_progress_timeout_seconds)
            except queue.Empty:
                raise TimeoutError(
                    f"FFmpeg stream không có frame mới sau {no_progress_timeout_seconds}s (đã đọc {actual_frames} frames)"
                )

            if item is None:
                # Sentinel reached
                if producer_exc:
                    raise producer_exc[0]
                break

            frame_idx, frame = item
            yield frame_idx, frame
            actual_frames += 1
    except BaseException as err:
        original_error = err
        raise
    finally:
        stop_event.set()
        kill_process_tree(proc)
        try:
            proc.stdout.close()
        except Exception:
            pass
        try:
            proc.stderr.close()
        except Exception:
            pass

        try:
            ret = proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            kill_process_tree(proc)
            try:
                ret = proc.wait(timeout=2)
            except Exception:
                ret = -1

        reader_thread.join(timeout=2)
        stderr_thread.join(timeout=2)

        # Only raise returncode error if no previous error occurred:
        if original_error is None and ret is not None and ret != 0:
            err_msg = "".join(stderr_chunks)[-300:].strip()
            raise RuntimeError(f"ffmpeg ({ret}): {err_msg}")


def run_visual_stream(args):
    import cv2

    ffprobe = resolve_ffprobe(args.ffmpeg)
    duration = probe_duration(ffprobe, args.input)
    total_frames = max(1, int(round(duration * 8)))

    emit({"type": "info", "frames": total_frames, "fps": 8, "width": args.display_width, "height": args.display_height})

    ocr = tao_ocr()
    provider_report = get_ocr_provider_report(ocr)
    use_roi = args.visual_transport == "stream-roi"

    crop_halo = 32
    crop_x0 = max(0, args.x0 - crop_halo)
    crop_y0 = max(0, args.y0 - crop_halo)
    crop_x1 = min(args.display_width, args.x1 + crop_halo)
    crop_y1 = min(args.display_height, args.y1 + crop_halo)

    scan_region = {
        "x0": args.x0,
        "y0": args.y0,
        "x1": args.x1,
        "y1": args.y1,
    }

    meta = {
        "width": args.display_width,
        "height": args.display_height,
        "duration_seconds": duration,
        "frame_count": total_frames,
        "geometry_fingerprint": args.geometry_fingerprint,
    }

    processed = [0]

    def detect_frame(frame):
        res, _ = ocr(frame)
        display_items = []
        for item in (res or []):
            if not item or len(item) < 3:
                continue
            poly, text, score = item[0], item[1], item[2]
            poly_display = (
                [[pt[0] + crop_x0, pt[1] + crop_y0] for pt in poly]
                if use_roi else poly
            )
            display_items.append([poly_display, text, score])
        processed[0] += 1
        emit({
            "type": "progress",
            "percent": min(100, int(processed[0] / total_frames * 100)),
            "processed": processed[0],
            "total": total_frames,
        })
        return display_items

    emit({"type": "status", "message": f"Đang quét chữ profile {args.scan_profile}…"})

    if args.scan_profile == "accurate":
        def crop_generator():
            count = 0
            for idx, frame in stream_video_frames(args.ffmpeg, args.input, args.display_width, args.display_height):
                count += 1
                yield frame[crop_y0:crop_y1, crop_x0:crop_x1] if use_roi else frame
            if count == 0:
                raise RuntimeError("Không tách được khung hình nào từ video")

        timeline = build_accurate_timeline(crop_generator(), detect_frame, meta, scan_region)
    else:
        def frame_generator():
            count = 0
            for idx, frame in stream_video_frames(args.ffmpeg, args.input, args.display_width, args.display_height):
                count += 1
                yield idx, frame
            if count == 0:
                raise RuntimeError("Không tách được khung hình nào từ video")

        timeline = build_fast_timeline_stream(
            frame_generator(),
            detect_frame,
            meta,
            scan_region,
            halo=crop_halo,
            cv2=cv2,
            np=np,
            ocr_crop=(crop_x0, crop_y0, crop_x1, crop_y1) if use_roi else None,
        )

    timeline["transport"] = args.visual_transport
    timeline["implementationFingerprint"] = IMPLEMENTATION_FINGERPRINT
    timeline["ocrProvider"] = provider_report

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
        "transport": args.visual_transport,
        "implementation_fingerprint": IMPLEMENTATION_FINGERPRINT,
        "ocr_provider": provider_report,
        "band_top": int(band_top) if band_top is not None else None,
        "band_bot": int(band_bot) if band_bot is not None else None,
    })
    return 0


def run_visual_legacy_disk(args):
    import cv2

    ffprobe = resolve_ffprobe(args.ffmpeg)
    duration = probe_duration(ffprobe, args.input)

    ocr = tao_ocr()
    provider_report = get_ocr_provider_report(ocr)
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

        scan_region = {
            "x0": args.x0,
            "y0": args.y0,
            "x1": args.x1,
            "y1": args.y1,
        }

        # The legacy transport still has to materialize frames for an older
        # binary contract, but the detector does not need the whole display
        # frame.  Crop the requested OCR band (with the same 32px safety halo
        # as stream-roi), then translate polygons back to display coordinates
        # before the shared timeline normalizer clips them to scan_region.
        roi_halo = 32
        crop_x0 = max(0, args.x0 - roi_halo)
        crop_y0 = max(0, args.y0 - roi_halo)
        crop_x1 = min(args.display_width, args.x1 + roi_halo)
        crop_y1 = min(args.display_height, args.y1 + roi_halo)

        total_frames = len(frame_paths)
        processed = [0]

        def detect(path):
            frame = cv2.imread(path)
            if frame is None:
                raise RuntimeError(f"Không thể đọc khung hình {path} để OCR")
            crop = frame[crop_y0:crop_y1, crop_x0:crop_x1]
            res, _ = ocr(crop)
            display_res = []
            for item in (res or []):
                if not item or len(item) < 3:
                    continue
                poly, text, score = item[0], item[1], item[2]
                try:
                    shifted_poly = [[float(pt[0]) + crop_x0, float(pt[1]) + crop_y0] for pt in poly]
                except (TypeError, ValueError, IndexError):
                    continue
                display_res.append([shifted_poly, text, score])
            processed[0] += 1
            emit({
                "type": "progress",
                "percent": int(processed[0] / total_frames * 100),
                "processed": processed[0],
                "total": total_frames,
            })
            return display_res

        meta = {
            "width": args.display_width,
            "height": args.display_height,
            "duration_seconds": duration,
            "frame_count": len(frame_paths),
            "geometry_fingerprint": args.geometry_fingerprint,
        }

        emit({"type": "status", "message": f"Đang quét chữ profile {args.scan_profile} trong vùng OCR…"})
        if args.scan_profile == "accurate":
            timeline = build_accurate_timeline(frame_paths, detect, meta, scan_region)
        else:
            timeline = build_fast_timeline(frame_paths, detect, meta, scan_region)

        timeline["transport"] = "legacy-disk"
        timeline["implementationFingerprint"] = IMPLEMENTATION_FINGERPRINT
        timeline["ocrProvider"] = provider_report

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
            "transport": args.visual_transport,
            "implementation_fingerprint": IMPLEMENTATION_FINGERPRINT,
            "ocr_provider": provider_report,
            "band_top": int(band_top) if band_top is not None else None,
            "band_bot": int(band_bot) if band_bot is not None else None,
        })
        return 0


def run_visual(args):
    if args.visual_transport == "legacy-disk":
        return run_visual_legacy_disk(args)
    return run_visual_stream(args)


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
    p.add_argument("--legacy-disk-extract", action="store_true", help="dung rut khung PNG ra dia (legacy)")
    p.add_argument("--visual-transport", choices=VISUAL_TRANSPORTS, default=None,
                   help="transport visual: legacy-disk, stream-full hoac stream-roi")
    args = p.parse_args()

    try:
        args.visual_transport = resolve_visual_transport(
            args.visual_transport,
            getattr(args, "legacy_disk_extract", False),
        )
    except ValueError as error:
        emit({"type": "error", "message": str(error)})
        return 1

    if args.version:
        emit({
            "type": "version",
            "protocol": PROTOCOL,
            "engine": ENGINE_NAME,
            "version": VERSION,
            "features": FEATURES,
            "implementation_fingerprint": IMPLEMENTATION_FINGERPRINT,
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
                "implementation_fingerprint": IMPLEMENTATION_FINGERPRINT,
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
                "implementation_fingerprint": IMPLEMENTATION_FINGERPRINT,
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
