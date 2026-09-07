"""Local before/after STTN qualification; writes only to a new evidence folder."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'engines/sttn-engine'))
import av
import numpy as np
from inference import SttnModel


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(path):
    result = hashlib.sha256()
    timestamps = []
    with av.open(str(path)) as container:
        for frame in container.decode(video=0):
            result.update(frame.to_ndarray(format='rgb24').tobytes())
            timestamps.append(round(float(frame.pts*frame.time_base), 6))
    return {'rgbSha256': result.hexdigest(), 'timestamps': timestamps}


def main():
    parser = argparse.ArgumentParser()
    for key in ['source', 'model', 'ffmpeg', 'baseline', 'output']:
        parser.add_argument('--'+key, required=True)
    parser.add_argument('--reverse', action='store_true')
    args = parser.parse_args()
    root = Path(args.output).resolve()
    root.mkdir(parents=True, exist_ok=False)
    clip = root/'source.mkv'
    subprocess.run([args.ffmpeg, '-v', 'error', '-ss', '30', '-i', args.source,
                    '-t', '5', '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', str(clip)],
                   check=True, capture_output=True)
    probe = str(Path(args.ffmpeg).with_name('ffprobe.exe' if os.name == 'nt' else 'ffprobe'))
    info = json.loads(subprocess.check_output([probe, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(clip)]))
    video = next(s for s in info['streams'] if s['codec_type'] == 'video')
    w, h = video['width'], video['height']
    duration = float(video.get('duration', info['format']['duration']))
    timeline = {'schemaVersion': 1, 'protocol': 'ocr-visual-cues/1',
        'video': {'width': w, 'height': h, 'durationSeconds': duration, 'sampleFps': 8},
        'scanRegion': {'x0': 0, 'y0': int(h*.7), 'x1': w, 'y1': h},
        'segments': [{'start': 0, 'end': duration, 'boxes': [
            {'x0': int(w*.15), 'y0': int(h*.8), 'x1': int(w*.85), 'y1': int(h*.87)}]}]}
    timeline_path = root/'timeline.json'
    timeline_path.write_text(json.dumps(timeline))
    model = SttnModel(args.model)
    model.probe()
    results = []
    variants = [('baseline', load(args.baseline, 'baseline')),
                ('optimized', load(ROOT/'engines/sttn-engine/video.py', 'optimized'))]
    for label, module in reversed(variants) if args.reverse else variants:
        work = root/label
        work.mkdir()
        peak = [0]
        stopped = threading.Event()
        def watch():
            while not stopped.wait(.01):
                sizes = []
                for p in work.glob('*.mkv'):
                    try:
                        sizes.append(p.stat().st_size)
                    except FileNotFoundError:
                        pass
                peak[0] = max(peak[0], sum(sizes))
        thread = threading.Thread(target=watch)
        thread.start()
        start = time.perf_counter()
        output = work/'clean.mkv'
        try:
            data = module.process_video({'inputPath': str(clip), 'outputPath': str(output),
                'timelinePath': str(timeline_path), 'ffmpegPath': args.ffmpeg,
                'ffprobePath': probe}, model, lambda _: None)
        finally:
            stopped.set()
            thread.join()
        data.update(label=label, wallSeconds=time.perf_counter()-start,
                    fileBytes=output.stat().st_size, peakVideoBytes=max(peak[0], output.stat().st_size))
        data.update(digest(output))
        data['audioHash'] = subprocess.check_output([args.ffmpeg, '-v', 'error', '-i', str(output),
                          '-map', '0:a?', '-vn', '-f', 'hash', '-hash', 'sha256', '-']).decode().strip()
        results.append(data)
        print(json.dumps({k: v for k, v in data.items() if k != 'timestamps'}), flush=True)
    assert results[0]['rgbSha256'] == results[1]['rgbSha256'], 'RGB pixels changed'
    assert results[0]['timestamps'] == results[1]['timestamps'], 'Frame timing changed'
    assert results[0]['audioHash'] == results[1]['audioHash'], 'Audio changed'
    (root/'results.json').write_text(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
