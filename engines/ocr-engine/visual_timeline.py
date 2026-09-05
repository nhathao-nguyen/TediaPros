# -*- coding: utf-8 -*-
"""visual_timeline — protocol-compatible visual cues timeline construction (ocr-visual-cues/1)"""
import json
import math
import os
import tempfile

NG_DOI = 0.45
OCR_VISUAL_MAX_BYTES = 64 * 1024 * 1024
OCR_VISUAL_MAX_SEGMENTS = 100_000
OCR_VISUAL_MAX_BOXES_PER_SEGMENT = 64
OCR_VISUAL_MAX_TEXT_CODE_POINTS = 4096
FEATURES = ["directml-fallback", "probe", "rapidocr", "visual-cues-v1"]


def mask_chu(vung, cv2=None, np=None):
    """Tao binary mask cac vung co chu."""
    if cv2 is None:
        import cv2 as _cv2
        cv2 = _cv2
    if np is None:
        import numpy as _np
        np = _np

    if vung is None or vung.size == 0:
        return np.zeros((1, 1), dtype=np.uint8)

    hsv = cv2.cvtColor(vung, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(vung, cv2.COLOR_BGR2GRAY)

    mask_white = cv2.inRange(hsv, (0, 0, 180), (180, 50, 255))
    mask_yellow = cv2.inRange(hsv, (15, 60, 150), (40, 255, 255))
    mask_cyan = cv2.inRange(hsv, (75, 60, 150), (105, 255, 255))
    mask_red1 = cv2.inRange(hsv, (0, 70, 150), (15, 255, 255))
    mask_red2 = cv2.inRange(hsv, (165, 70, 150), (180, 255, 255))
    mask_green = cv2.inRange(hsv, (35, 60, 150), (75, 255, 255))

    color_mask = mask_white | mask_yellow | mask_cyan | mask_red1 | mask_red2 | mask_green

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    grad = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, kernel)
    _, edge_mask = cv2.threshold(grad, 40, 255, cv2.THRESH_BINARY)

    return color_mask | edge_mask


def jaccard(a, b, np=None):
    """Do lech 2 mask chu = 1 - (giao / hop). Bang 0 khi ca 2 deu khong co chu."""
    if np is None:
        import numpy as _np
        np = _np
    A = a > 0
    B = b > 0
    hop = int(np.count_nonzero(A | B))
    if hop == 0:
        return 0.0
    return 1.0 - int(np.count_nonzero(A & B)) / hop


def phan_doan(num_frames_or_files, mask_getter=None, y0=0, y1=None, x0=0, x1=None, cv2=None, np=None):
    """Doc mask tung khung, cat doan khi chu doi (Jaccard > NG_DOI).
    Tra ve preliminary intervals [a, b) nua-mo va do rung tung khung."""
    if isinstance(num_frames_or_files, (list, tuple)):
        files = num_frames_or_files
        n = len(files)
        if mask_getter is None:
            if cv2 is None:
                import cv2 as _cv2
                cv2 = _cv2
            if np is None:
                import numpy as _np
                np = _np

            def _default_mask_getter(idx):
                im = cv2.imread(files[idx])
                if im is None:
                    return np.zeros((1, 1), dtype=np.uint8)
                sub = im[y0:y1, x0:x1] if (y1 is not None and x1 is not None) else im
                return mask_chu(sub, cv2, np)

            mask_getter = _default_mask_getter
    else:
        n = int(num_frames_or_files)

    doan = []
    rung = [0.0] * n
    prev = None
    bat_dau = 0

    for i in range(n):
        m = mask_getter(i)
        if prev is not None:
            d = jaccard(m, prev, np)
            rung[i] = d
            if d > NG_DOI and i > bat_dau:
                doan.append((bat_dau, i))
                bat_dau = i
        prev = m

    if n > 0:
        doan.append((bat_dau, n))

    return doan, rung


def khung_on_dinh(rung, a, b):
    """Khung it rung nhat trong khoang nua-mo [a, b)."""
    best, best_d = a, 1e18
    for i in range(a, b):
        d = rung[i]
        if i + 1 < len(rung):
            d += rung[i + 1]
        if d < best_d:
            best_d, best = d, i
    return best


def clip_polygon_to_rect(poly, x0, y0, x1, y1):
    """Sutherland-Hodgman polygon clipping against an axis-aligned rectangle."""
    if not poly or len(poly) < 3:
        return []

    def clip_edge(points, is_inside, compute_intersection):
        clipped = []
        if not points:
            return clipped
        prev = points[-1]
        prev_inside = is_inside(prev)
        for curr in points:
            curr_inside = is_inside(curr)
            if curr_inside:
                if not prev_inside:
                    clipped.append(compute_intersection(prev, curr))
                clipped.append(curr)
            elif prev_inside:
                clipped.append(compute_intersection(prev, curr))
            prev = curr
            prev_inside = curr_inside
        return clipped

    def is_left_in(p):
        return p[0] >= x0

    def left_inter(p, q):
        dx = q[0] - p[0]
        t = (x0 - p[0]) / dx if abs(dx) > 1e-9 else 0.0
        return (float(x0), p[1] + t * (q[1] - p[1]))

    def is_right_in(p):
        return p[0] <= x1

    def right_inter(p, q):
        dx = q[0] - p[0]
        t = (x1 - p[0]) / dx if abs(dx) > 1e-9 else 0.0
        return (float(x1), p[1] + t * (q[1] - p[1]))

    def is_top_in(p):
        return p[1] >= y0

    def top_inter(p, q):
        dy = q[1] - p[1]
        t = (y0 - p[1]) / dy if abs(dy) > 1e-9 else 0.0
        return (p[0] + t * (q[0] - p[0]), float(y0))

    def is_bot_in(p):
        return p[1] <= y1

    def bot_inter(p, q):
        dy = q[1] - p[1]
        t = (y1 - p[1]) / dy if abs(dy) > 1e-9 else 0.0
        return (p[0] + t * (q[0] - p[0]), float(y1))

    pts = list(poly)
    pts = clip_edge(pts, is_left_in, left_inter)
    pts = clip_edge(pts, is_right_in, right_inter)
    pts = clip_edge(pts, is_top_in, top_inter)
    pts = clip_edge(pts, is_bot_in, bot_inter)
    return pts


def polygon_shoelace_area(poly):
    """Tinh dien tich da giac bang cong thuc shoelace."""
    if not poly or len(poly) < 3:
        return 0.0
    n = len(poly)
    area = 0.0
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    return 0.5 * abs(area)


def polygon_to_aabb(poly, scan_region):
    """Chuyen da giac sau khi cat thanh integer AABB (floor minima, ceil maxima)."""
    if not poly or len(poly) < 3:
        return None
    min_x = math.floor(min(p[0] for p in poly))
    min_y = math.floor(min(p[1] for p in poly))
    max_x = math.ceil(max(p[0] for p in poly))
    max_y = math.ceil(max(p[1] for p in poly))

    x0 = max(scan_region["x0"], int(min_x))
    y0 = max(scan_region["y0"], int(min_y))
    x1 = min(scan_region["x1"], int(max_x))
    y1 = min(scan_region["y1"], int(max_y))

    if x1 <= x0 or y1 <= y0:
        return None
    return (x0, y0, x1, y1)


def normalize_rapidocr_item(item, scan_region):
    """Chuan hoa mot item tu detector: kiem tra polygon, confidence > 0.5,
    cat Sutherland-Hodgman, kiem tra shoelace area > 0 va tinh integer AABB."""
    if not item or len(item) < 3:
        return None
    poly, text, score = item[0], item[1], item[2]

    try:
        conf = float(score)
    except (ValueError, TypeError):
        return None
    if not math.isfinite(conf) or conf <= 0.5 or conf > 1.0:
        return None

    text_str = str(text or "").strip()
    if not text_str or len(text_str) > OCR_VISUAL_MAX_TEXT_CODE_POINTS:
        return None

    if not poly or len(poly) < 3:
        return None

    pts = []
    for pt in poly:
        if len(pt) < 2:
            return None
        px, py = float(pt[0]), float(pt[1])
        if not math.isfinite(px) or not math.isfinite(py):
            return None
        pts.append((px, py))

    clipped = clip_polygon_to_rect(pts, scan_region["x0"], scan_region["y0"], scan_region["x1"], scan_region["y1"])
    if len(clipped) < 3:
        return None

    area = polygon_shoelace_area(clipped)
    if area <= 0.0:
        return None

    aabb = polygon_to_aabb(clipped, scan_region)
    if aabb is None:
        return None

    x0, y0, x1, y1 = aabb
    return {
        "text": text_str,
        "confidence": conf,
        "x0": x0,
        "y0": y0,
        "x1": x1,
        "y1": y1,
        "cx": (x0 + x1) / 2.0,
        "cy": (y0 + y1) / 2.0,
        "h": y1 - y0,
    }


def sort_and_group_boxes(qualifying_boxes):
    """Sap xep reading order: tren xuong duoi theo line, trai sang phai trong tung line."""
    if not qualifying_boxes:
        return "", []

    boxes = list(qualifying_boxes)
    boxes.sort(key=lambda b: b["cy"])

    lines = []
    curr_line = [boxes[0]]
    for item in boxes[1:]:
        avg_h = sum(x["h"] for x in curr_line) / len(curr_line)
        line_cy = sum(x["cy"] for x in curr_line) / len(curr_line)
        if abs(item["cy"] - line_cy) < max(12.0, avg_h * 0.6):
            curr_line.append(item)
        else:
            lines.append(curr_line)
            curr_line = [item]
    lines.append(curr_line)

    ordered_boxes = []
    ordered_line_texts = []
    for line in lines:
        line.sort(key=lambda item: item["x0"])
        l_text = " ".join(item["text"] for item in line if item["text"])
        if l_text:
            ordered_line_texts.append(l_text)
        for b in line:
            ordered_boxes.append({
                "x0": b["x0"],
                "y0": b["y0"],
                "x1": b["x1"],
                "y1": b["y1"],
                "text": b["text"],
                "confidence": b["confidence"],
            })

    full_text = " ".join(ordered_line_texts).strip()
    return full_text, ordered_boxes


def build_accurate_timeline(frame_paths, detect, metadata, scan_region):
    """Xay dung timeline accurate (8 fps): chay detect moi khung hinh."""
    segments = []
    duration = metadata["duration_seconds"]

    for k, p in enumerate(frame_paths):
        raw_res = detect(p) or []
        qualifying = []
        for item in raw_res:
            nb = normalize_rapidocr_item(item, scan_region)
            if nb is not None:
                qualifying.append(nb)

        if not qualifying:
            continue

        full_text, ordered_boxes = sort_and_group_boxes(qualifying)
        if not full_text or not ordered_boxes:
            continue

        min_conf = min(b["confidence"] for b in ordered_boxes)
        segments.append({
            "id": f"accurate-{k}",
            "startFrame": k,
            "endFrameExclusive": k + 1,
            "start": k / 8.0,
            "end": min((k + 1) / 8.0, duration),
            "text": full_text,
            "confidence": min_conf,
            "boxes": ordered_boxes[:OCR_VISUAL_MAX_BOXES_PER_SEGMENT],
        })

    return {
        "schemaVersion": 1,
        "protocol": "ocr-visual-cues/1",
        "video": {
            "width": metadata["width"],
            "height": metadata["height"],
            "durationSeconds": metadata["duration_seconds"],
            "sampleFps": 8,
            "frameCount": metadata["frame_count"],
            "geometryFingerprint": metadata["geometry_fingerprint"],
        },
        "profile": "accurate",
        "scanRegion": {
            "x0": scan_region["x0"],
            "y0": scan_region["y0"],
            "x1": scan_region["x1"],
            "y1": scan_region["y1"],
        },
        "segments": segments,
    }


def build_fast_timeline(frame_paths, detect, metadata, scan_region, change_threshold=0.45, mask_getter=None):
    """Xay dung timeline fast: phan doan bang mask/Jaccard, detect tren stable frame."""
    intervals, rung = phan_doan(
        frame_paths,
        mask_getter=mask_getter,
        y0=scan_region["y0"],
        y1=scan_region["y1"],
        x0=scan_region["x0"],
        x1=scan_region["x1"],
    )

    segments = []
    duration = metadata["duration_seconds"]

    for a, b in intervals:
        stable_idx = khung_on_dinh(rung, a, b)
        raw_res = detect(frame_paths[stable_idx]) or []
        qualifying = []
        for item in raw_res:
            nb = normalize_rapidocr_item(item, scan_region)
            if nb is not None:
                qualifying.append(nb)

        if not qualifying:
            continue

        full_text, ordered_boxes = sort_and_group_boxes(qualifying)
        if not full_text or not ordered_boxes:
            continue

        min_conf = min(b["confidence"] for b in ordered_boxes)
        segments.append({
            "id": f"fast-{a}-{b}",
            "startFrame": a,
            "endFrameExclusive": b,
            "start": a / 8.0,
            "end": min(b / 8.0, duration),
            "text": full_text,
            "confidence": min_conf,
            "boxes": ordered_boxes[:OCR_VISUAL_MAX_BOXES_PER_SEGMENT],
        })

    return {
        "schemaVersion": 1,
        "protocol": "ocr-visual-cues/1",
        "video": {
            "width": metadata["width"],
            "height": metadata["height"],
            "durationSeconds": metadata["duration_seconds"],
            "sampleFps": 8,
            "frameCount": metadata["frame_count"],
            "geometryFingerprint": metadata["geometry_fingerprint"],
        },
        "profile": "fast",
        "scanRegion": {
            "x0": scan_region["x0"],
            "y0": scan_region["y0"],
            "x1": scan_region["x1"],
            "y1": scan_region["y1"],
        },
        "segments": segments,
    }


def hhmmss(giay):
    """Chuyen giay sang dinh dang SRT 00:00:00,000."""
    h = int(giay // 3600)
    m = int(giay % 3600 // 60)
    s = int(giay % 60)
    ms = int(round((giay - int(giay)) * 1000))
    if ms >= 1000:
        s += 1
        ms -= 1000
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


def timeline_to_srt(timeline):
    """Xuat .srt chuan tu visual timeline."""
    merged = []
    for s in timeline.get("segments", []):
        t = s.get("text", "").strip()
        if not t:
            continue
        start = s["start"]
        end = s["end"]
        if merged and merged[-1][2] == t and abs(merged[-1][1] - start) < 1e-6:
            merged[-1] = (merged[-1][0], end, t)
        else:
            merged.append((start, end, t))

    blocks = []
    for i, (a, b, t) in enumerate(merged, 1):
        blocks.append("%d\n%s --> %s\n%s\n" % (i, hhmmss(a), hhmmss(b), t))
    return "\n".join(blocks) + ("\n" if blocks else "")


def write_visual_timeline(path, timeline):
    """Ghi atomically visual timeline ra file JSON theo format UTF-8 compact."""
    segments = timeline.get("segments", [])
    if len(segments) > OCR_VISUAL_MAX_SEGMENTS:
        raise ValueError(f"So luong segments vuot qua gioi han {OCR_VISUAL_MAX_SEGMENTS}")

    for s in segments:
        if len(s.get("boxes", [])) > OCR_VISUAL_MAX_BOXES_PER_SEGMENT:
            raise ValueError(f"So luong boxes vuot qua gioi han {OCR_VISUAL_MAX_BOXES_PER_SEGMENT}")
        if len(s.get("text", "")) > OCR_VISUAL_MAX_TEXT_CODE_POINTS:
            raise ValueError(f"Do dai text vuot qua gioi han {OCR_VISUAL_MAX_TEXT_CODE_POINTS}")

    content = json.dumps(timeline, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(content) > OCR_VISUAL_MAX_BYTES:
        raise ValueError(f"Kich thuoc visual timeline vuot qua {OCR_VISUAL_MAX_BYTES} bytes")

    target_dir = os.path.dirname(os.path.abspath(path))
    os.makedirs(target_dir, exist_ok=True)

    with tempfile.NamedTemporaryFile(dir=target_dir, delete=False) as tmp:
        tmp.write(content)
        tmp.flush()
        os.fsync(tmp.fileno())
        temp_name = tmp.name

    os.replace(temp_name, path)
