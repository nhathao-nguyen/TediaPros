"""Streaming canonical decode, bounded STTN windows and lossless intermediate."""
from collections import deque
from contextlib import suppress
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
import uuid
import av
import cv2
import numpy as np
from masking import MaskTimeline, iter_windows

HIDDEN = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}


class ReadPipe:
    """Windows Popen pipes expose seek() but cannot seek; advertise streaming."""
    def __init__(self, pipe):
        self.pipe = pipe

    def read(self, size):
        return self.pipe.read(size)

    def seekable(self):
        return False

    def readable(self):
        return True


class WritePipe:
    """Expose a non-seekable output and bound blocked writes if FFmpeg stalls."""
    def __init__(self, process):
        self.process = process
        self.pending_since = None
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._watch, daemon=True)
        self.thread.start()

    def _watch(self):
        while not self.stopped.wait(1):
            if self.pending_since is not None and time.monotonic()-self.pending_since > 120:
                with suppress(OSError):
                    self.process.kill()
                return

    def write(self, data):
        self.pending_since = time.monotonic()
        try:
            view = memoryview(data)
            offset = 0
            while offset < len(view):
                written = self.process.stdin.write(view[offset:])
                if not written:
                    raise BrokenPipeError('STTN muxer stopped accepting video')
                offset += written
                self.pending_since = time.monotonic()
            return offset
        finally:
            self.pending_since = None

    def writable(self):
        return True

    def seekable(self):
        return False

    def close(self):
        self.stopped.set()
        self.thread.join(timeout=2)
        self.process.stdin.close()


def _run(args, timeout=60):
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **HIDDEN)
    stdout, stderr = bytearray(), deque(maxlen=64)
    overflow = threading.Event()

    def drain_stdout():
        while chunk := process.stdout.read(4096):
            if len(stdout)+len(chunk) > 4*1024*1024:
                overflow.set()
            elif not overflow.is_set():
                stdout.extend(chunk)

    def drain_stderr():
        while chunk := process.stderr.read(1024):
            stderr.append(chunk)

    readers = [threading.Thread(target=fn, daemon=True) for fn in (drain_stdout, drain_stderr)]
    for thread in readers:
        thread.start()
    try:
        code = process.wait(timeout=timeout)
        for thread in readers:
            thread.join()
        if overflow.is_set():
            raise RuntimeError('Media command output exceeds 4 MiB')
        if code:
            raise RuntimeError(b''.join(stderr).decode('utf-8', errors='replace')[-4000:])
        return bytes(stdout)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        for thread in readers:
            thread.join(timeout=2)
        process.stdout.close()
        process.stderr.close()


def remove_subtitles(request, emit):
    from inference import SttnModel
    emit({'type': 'progress', 'percent': 0, 'message': 'Dang nap STTN...', 'phase': 'loading'})
    model = SttnModel(request['modelPath'], request.get('provider', 'auto'))
    return process_video(request, model, emit)


def _intermediate_duration(info, expected, rate):
    """Validate playback endpoints, not Matroska's encoded AAC priming extent.

    FFmpeg writes DURATION tags in the muxer's timestamp domain, including
    CodecDelay. Decoders subtract initial_padding from audio timestamps.
    Keep stream copy intact and validate video independently of longer audio.
    """
    tolerance = max(.15, 3/float(rate))
    ends, playback_ends = [], []
    for stream in info['streams']:
        kind = stream['codec_type']
        if kind not in ('video', 'audio'):
            continue
        try:
            tag = stream.get('tags', {}).get('DURATION')
            if tag is not None:
                hours, minutes, seconds = tag.split(':')
                end = int(hours)*3600 + int(minutes)*60 + float(seconds)
            else:
                end = float(stream['duration']) + float(stream.get('start_time', 0))
            delay = 0.
            padding = int(stream.get('initial_padding', 0))
            if kind == 'audio' and padding:
                delay = padding / int(stream['sample_rate'])
            if not math.isfinite(end) or end <= 0 or not math.isfinite(delay) or delay < 0 or delay >= end:
                raise ValueError('Invalid endpoint or codec delay')
        except (KeyError, TypeError, ValueError, ZeroDivisionError) as error:
            raise RuntimeError(f'Intermediate {kind} duration metadata invalid') from error
        playback_end = end-delay
        ends.append(end)
        playback_ends.append(playback_end)
        mismatch = abs(playback_end-expected) > tolerance if kind == 'video' else playback_end > expected+tolerance
        if mismatch:
            raise RuntimeError(f'Intermediate {kind} duration mismatch: expected {expected:.6f}s, '
                               f'actual {playback_end:.6f}s, codec delay {delay:.6f}s')
    container = float(info['format']['duration'])
    if not ends or not math.isfinite(container) or abs(container-max(ends)) > tolerance:
        raise RuntimeError(f'Intermediate container duration mismatch: actual {container:.6f}s')
    return max(playback_ends)


def process_video(request, model, emit):
    timeline_path = Path(request['timelinePath'])
    if timeline_path.stat().st_size > 64*1024*1024:
        raise ValueError('OCR timeline exceeds size limit')
    plan = MaskTimeline(json.loads(timeline_path.read_text(encoding='utf-8-sig')))
    duration = min(plan.duration, float(request.get('previewSeconds', plan.duration)))
    source, output = Path(request['inputPath']), Path(request['outputPath'])
    if source.resolve() == output.resolve() or output.exists():
        raise ValueError('Output must be a new path')
    output.parent.mkdir(parents=True, exist_ok=True)
    info = json.loads(_run([request['ffprobePath'], '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(source)]))
    video = next(s for s in info['streams'] if s['codec_type'] == 'video')
    rate = Fraction(video.get('avg_frame_rate', '0/1'))
    if rate <= 0:
        rate = Fraction(video.get('r_frame_rate', '25/1'))
    if not 0 < rate <= 240:
        raise ValueError('Unsupported frame rate')
    start_time = float(video.get('start_time', info.get('format', {}).get('start_time', 0)))
    if not math.isfinite(start_time):
        raise ValueError('Invalid source start time')
    source_duration = float(video.get('duration', info.get('format', {}).get('duration', 0)))
    if not math.isfinite(source_duration) or abs(source_duration-plan.duration) > max(.15, 3/float(rate)):
        raise ValueError('Source duration does not match OCR timeline')
    window_size = int(request.get('maxFrames', 12))
    # Disk holds one compressed file. Reserve a raw window with encoder overhead
    # plus headroom, and recheck before every window instead of assuming that
    # two full raw videos must fit. The bound also covers in-flight pipe data.
    reserve = int(plan.width*plan.height*4*window_size*2 + 512*1024*1024)
    def check_space():
        free = shutil.disk_usage(output.parent).free
        if free < reserve:
            raise RuntimeError(f'Not enough temporary disk space on {output.anchor}; '
                               f'free {free/1024**3:.2f} GiB, keep {reserve/1024**3:.2f} GiB available')
    check_space()
    token = uuid.uuid4().hex
    partial = output.parent / f'.sttn-{token}.mux.mkv'
    width, height = plan.width, plan.height
    command = [request['ffmpegPath'], '-v', 'error', '-nostdin', '-i', str(source),
               '-map', '0:v:0', '-an', '-sn', '-dn', '-t', str(duration),
               '-vf', f'setpts=PTS-STARTPTS,scale={width}:{height}:flags=lanczos,setsar=1',
               '-fps_mode', 'passthrough', '-c:v', 'rawvideo', '-pix_fmt', 'rgb24', '-f', 'nut', 'pipe:1']
    decoder = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **HIDDEN)
    stderr = deque(maxlen=64)

    def drain():
        while chunk := decoder.stderr.read(1024):
            stderr.append(chunk)

    drainer = threading.Thread(target=drain, daemon=True)
    drainer.start()
    frames_written = 0
    last_output_time = -1.
    sink = None
    reader = None
    muxer = None
    writer = None
    mux_drainer = None
    mux_stderr = deque(maxlen=64)
    encoder = ThreadPoolExecutor(max_workers=1, thread_name_prefix='sttn-encode')
    encoding = None
    started = time.perf_counter()
    try:
        reader = av.open(ReadPipe(decoder.stdout), format='nut')
        # Stream lossless packets into the audio remuxer: no silent full-video
        # file and no second read/write pass. Keep the previous audio mapping.
        muxer = subprocess.Popen([request['ffmpegPath'], '-v', 'error', '-nostdin',
            '-copyts', '-f', 'matroska', '-i', 'pipe:0', '-itsoffset', str(-start_time),
            '-i', str(source), '-map', '0:v:0', '-map', '1:a?', '-c', 'copy',
            '-map_metadata', '-1', '-t', str(duration), '-avoid_negative_ts', 'disabled',
            str(partial)], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE, bufsize=0, **HIDDEN)
        def drain_mux():
            while chunk := muxer.stderr.read(1024):
                mux_stderr.append(chunk)
        mux_drainer = threading.Thread(target=drain_mux, daemon=True)
        mux_drainer.start()
        writer = WritePipe(muxer)
        sink = av.open(writer, mode='w', format='matroska')
        stream = sink.add_stream('ffv1', rate=rate,
                                 options={'level': '3', 'slices': '4', 'coder': '1', 'context': '1'})
        stream.width, stream.height = width, height
        stream.pix_fmt = 'bgr0'
        stream.time_base = Fraction(1, 1000000)
        stream.codec_context.time_base = Fraction(1, 1000000)
        stream.codec_context.thread_count = 4
        pending_packet = None

        def mux_packet(packet=None):
            nonlocal pending_packet
            if pending_packet is not None:
                packet_time = Fraction(pending_packet.pts)*pending_packet.time_base
                end_time = Fraction(packet.pts)*packet.time_base if packet is not None else Fraction(str(duration))
                pending_packet.duration = max(1, round((end_time-packet_time)/pending_packet.time_base))
                sink.mux(pending_packet)
            pending_packet = packet

        def frames():
            first_pts = None
            previous = -1.
            for frame in reader.decode(video=0):
                if frame.pts is None:
                    raise RuntimeError('Decoded frame has no timestamp')
                timestamp = Fraction(frame.pts)*frame.time_base
                if first_pts is None:
                    first_pts = timestamp
                timestamp -= first_pts
                seconds = float(timestamp)
                if seconds <= previous:
                    raise RuntimeError('Non-increasing frame timestamps')
                previous = seconds
                if seconds >= duration:
                    break
                rgb = frame.to_ndarray(format='rgb24')
                mask = plan.at(seconds)
                thumb = cv2.resize(rgb, (32, 18), interpolation=cv2.INTER_AREA).astype(np.float32)
                yield rgb, mask, timestamp, thumb

        def scene_cut(a, b):
            return float(np.abs(a[3]-b[3]).mean()/255.) > .32

        def encode_frames(batch):
            for image, timestamp in batch:
                frame = av.VideoFrame.from_ndarray(image, format='rgb24')
                frame.pts = round(timestamp*1000000)
                frame.time_base = Fraction(1, 1000000)
                for packet in stream.encode(frame):
                    mux_packet(packet)

        for window, first, last in iter_windows(frames(), window_size, 2, scene_cut):
            check_space()
            images, masks = [f[0] for f in window], [f[1] for f in window]
            cleaned = model.restore(images, masks) if any(m.any() for m in masks) else images
            if len(cleaned) != len(window):
                raise RuntimeError('Model changed frame count')
            batch = []
            for index in range(first, last):
                image = cleaned[index]
                if image.shape != (height, width, 3) or image.dtype != np.uint8:
                    raise RuntimeError('Model returned invalid image')
                timestamp = window[index][2]
                batch.append((image, timestamp))
                frames_written += 1
                last_output_time = float(timestamp)
            # One encoding window overlaps the next decode/inference window.
            # Wait before submitting again: no unbounded executor queue or RAM.
            if encoding is not None:
                encoding.result()
            encoding = encoder.submit(encode_frames, batch)
            emit({'type': 'progress', 'percent': min(94, round(last_output_time/duration*94)),
                  'message': 'Dang xoa phu de STTN...', 'phase': 'inpainting', 'provider': model.provider})
        if encoding is not None:
            encoding.result()
        for packet in stream.encode():
            mux_packet(packet)
        mux_packet()
        sink.close()
        sink = None
        writer.close()
        writer = None
        reader.close()
        reader = None
        decoder.stdout.close()
        if decoder.wait(timeout=60) != 0:
            raise RuntimeError(b''.join(stderr).decode('utf-8', errors='replace')[-4000:])
        if not frames_written or last_output_time >= duration:
            raise RuntimeError('Decoded video duration does not match OCR timeline')
        emit({'type': 'progress', 'percent': 96, 'message': 'Dang giu audio va kiem tra video...', 'phase': 'writing'})
        if muxer.wait(timeout=120) != 0:
            mux_drainer.join(timeout=2)
            raise RuntimeError(b''.join(mux_stderr).decode('utf-8', errors='replace')[-4000:])
        verified = json.loads(_run([request['ffprobePath'], '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(partial)]))
        out_video = next(s for s in verified['streams'] if s['codec_type'] == 'video')
        if out_video['width'] != width or out_video['height'] != height or out_video['codec_name'] != 'ffv1':
            raise RuntimeError('Intermediate geometry or codec mismatch')
        if len([s for s in verified['streams'] if s['codec_type'] == 'audio']) != len([s for s in info['streams'] if s['codec_type'] == 'audio']):
            raise RuntimeError('Intermediate lost source audio')
        actual_duration = _intermediate_duration(verified, duration, rate)
        partial.rename(output)
        return {'provider': model.provider, 'frames': frames_written,
                'durationSeconds': actual_duration, 'width': width, 'height': height,
                'elapsedMs': round((time.perf_counter()-started)*1000)}
    finally:
        # Kill the consumer first on failure so closing PyAV cannot block on a
        # full pipe. The parent also terminates this entire tree on cancellation.
        if muxer is not None and muxer.poll() is None:
            muxer.kill()
            muxer.wait()
        encoder.shutdown(wait=True, cancel_futures=True)
        if sink is not None:
            with suppress(Exception):
                sink.close()
        if writer is not None:
            with suppress(Exception):
                writer.close()
        if mux_drainer is not None:
            mux_drainer.join(timeout=2)
        if muxer is not None:
            muxer.stderr.close()
        if reader is not None:
            with suppress(Exception):
                reader.close()
        if decoder.poll() is None:
            decoder.terminate()
            try:
                decoder.wait(timeout=5)
            except subprocess.TimeoutExpired:
                decoder.kill()
                decoder.wait()
        drainer.join(timeout=2)
        for resource in (decoder.stdout, decoder.stderr):
            with suppress(Exception):
                resource.close()
        for path in (partial,):
            with suppress(OSError):
                path.unlink(missing_ok=True)
