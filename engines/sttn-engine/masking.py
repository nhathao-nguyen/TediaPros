"""Bounded timeline lookup and full-resolution compositing; no model dependency."""
import math
import numpy as np


class MaskTimeline:
    def __init__(self, data):
        if data.get('schemaVersion') != 1 or data.get('protocol') != 'ocr-visual-cues/1':
            raise ValueError('Unsupported OCR timeline')
        video = data['video']
        self.width, self.height = int(video['width']), int(video['height'])
        self.duration = float(video['durationSeconds'])
        if not (2 <= self.width <= 8192 and 2 <= self.height <= 8192
                and math.isfinite(self.duration) and self.duration > 0):
            raise ValueError('Invalid video dimensions/duration')
        self.region = self._box(data['scanRegion'])
        self.segments = []
        if len(data['segments']) > 100000:
            raise ValueError('Too many OCR segments')
        for seg in data['segments']:
            start, end = float(seg['start']), float(seg['end'])
            if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= self.duration + .2):
                raise ValueError('Invalid OCR segment time')
            if len(seg['boxes']) > 64:
                raise ValueError('Too many OCR boxes')
            boxes = []
            for box in seg['boxes']:
                x0, y0, x1, y1 = self._box(box)
                # Smaller than the blur profile: cover outline/shadow without
                # asking inpainting to regenerate an unnecessarily large area.
                pad = max(4, min(12, round((y1 - y0) * .18)))
                rx0, ry0, rx1, ry1 = self.region
                clipped = (max(rx0, x0-pad), max(ry0, y0-pad),
                           min(rx1, x1+pad), min(ry1, y1+pad))
                if clipped[0] < clipped[2] and clipped[1] < clipped[3]:
                    boxes.append(clipped)
            # Half a sample on both sides accounts for 8 fps sampling.
            self.segments.append((max(0., start-.0625), min(self.duration, end+.0625), boxes))
        self.segments.sort(key=lambda seg: seg[0])
        self.cursor = 0
        self.active = []
        self.last_time = -1.

    def _box(self, box):
        values = [float(box[k]) for k in ('x0', 'y0', 'x1', 'y1')]
        if not all(math.isfinite(v) for v in values):
            raise ValueError('Non-finite OCR box')
        x0, y0, x1, y1 = [round(v) for v in values]
        if not (0 <= x0 < x1 <= self.width and 0 <= y0 < y1 <= self.height):
            raise ValueError('OCR box outside video')
        return x0, y0, x1, y1

    def at(self, seconds):
        if not math.isfinite(seconds) or seconds < self.last_time:
            raise ValueError('Frame timestamps must be finite and monotonic')
        self.last_time = seconds
        while self.cursor < len(self.segments) and self.segments[self.cursor][0] <= seconds:
            self.active.append(self.segments[self.cursor])
            self.cursor += 1
        self.active = [seg for seg in self.active if seg[1] > seconds]
        mask = np.zeros((self.height, self.width), dtype=np.uint8)
        for _, _, boxes in self.active:
            for x0, y0, x1, y1 in boxes:
                mask[y0:y1, x0:x1] = 255
        return mask


def composite(source, predicted, mask):
    if source.shape != predicted.shape or source.shape[:2] != mask.shape:
        raise ValueError('Composite dimensions differ')
    result = source.copy()
    selected = mask != 0
    result[selected] = predicted[selected]
    return result


def context_crop(masks):
    bounds = []
    for mask in masks:
        ys, xs = np.nonzero(mask)
        if len(xs):
            bounds.append((int(xs.min()), int(ys.min()), int(xs.max())+1, int(ys.max())+1))
    if not bounds:
        return None
    height, width = masks[0].shape
    x0, y0 = min(b[0] for b in bounds), min(b[1] for b in bounds)
    x1, y1 = max(b[2] for b in bounds), max(b[3] for b in bounds)
    margin = max(24, round((y1-y0)*.75))
    cx, cy = (x0+x1)/2, (y0+y1)/2
    cw, ch = x1-x0+2*margin, y1-y0+2*margin
    cw, ch = max(cw, ch*1.8), max(ch, cw/1.8)
    return max(0, math.floor(cx-cw/2)), max(0, math.floor(cy-ch/2)), \
        min(width, math.ceil(cx+cw/2)), min(height, math.ceil(cy+ch/2))


def iter_windows(items, max_frames=12, overlap=2, scene_cut=None):
    """Yield (bounded context, first output index, exclusive output index).

    Lookbehind and lookahead frames are reference-only; each input is emitted
    once. A scene boundary flushes lookahead and discards lookbehind.
    """
    if max_frames < 3 or overlap < 1 or 2*overlap >= max_frames:
        raise ValueError('Invalid window/overlap')
    frames, emitted = [], 0
    for item in items:
        if frames and scene_cut and scene_cut(frames[-1], item):
            if emitted < len(frames):
                yield frames, emitted, len(frames)
            frames, emitted = [], 0
        frames.append(item)
        if len(frames) == max_frames:
            end = len(frames)-overlap
            yield frames, emitted, end
            frames = frames[end-overlap:]
            emitted = overlap
    if emitted < len(frames):
        yield frames, emitted, len(frames)
