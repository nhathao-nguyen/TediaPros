"""Compare lossless encoder settings on identical decoded frames, without ML."""
import argparse
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import time
import av

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = Path(args.output)
root.mkdir(parents=True, exist_ok=False)
images = []
with av.open(args.source) as source:
    for frame in source.decode(video=0):
        images.append(frame.to_ndarray(format='rgb24'))
        if len(images) == 60:
            break
reference = hashlib.sha256(b''.join(im.tobytes() for im in images)).hexdigest()
results = []
for label, options, threads in [
    ('default', {}, 4), ('slice4', {'level': '3', 'slices': '4'}, 4),
    ('slice8', {'level': '3', 'slices': '9'}, 8),
    ('range4', {'level': '3', 'slices': '4', 'coder': '1'}, 4),
    ('range4context', {'level': '3', 'slices': '4', 'coder': '1', 'context': '1'}, 4)]:
    path = root/(label+'.mkv')
    start = time.perf_counter()
    with av.open(str(path), mode='w', format='matroska') as sink:
        stream = sink.add_stream('ffv1', rate=30, options=options)
        stream.width, stream.height = images[0].shape[1], images[0].shape[0]
        stream.pix_fmt = 'bgr0'
        stream.codec_context.thread_count = threads
        for i, image in enumerate(images):
            frame = av.VideoFrame.from_ndarray(image, format='rgb24')
            frame.pts, frame.time_base = i, Fraction(1, 30)
            sink.mux(stream.encode(frame))
        sink.mux(stream.encode())
    elapsed = time.perf_counter()-start
    actual = hashlib.sha256()
    with av.open(str(path)) as media:
        for frame in media.decode(video=0):
            actual.update(frame.to_ndarray(format='rgb24').tobytes())
    assert actual.hexdigest() == reference
    result = dict(label=label, seconds=elapsed, bytes=path.stat().st_size, rgbExact=True)
    results.append(result)
    print(json.dumps(result), flush=True)
(root/'results.json').write_text(json.dumps(results, indent=2))
