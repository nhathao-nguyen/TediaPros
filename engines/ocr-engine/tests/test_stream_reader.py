# -*- coding: utf-8 -*-
import os
import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from engine import stream_video_frames


class StreamVideoFramesTests(unittest.TestCase):
    def test_normal_frame_stream_reads_all_frames_and_stops(self):
        w, h = 10, 10
        frame_bytes = w * h * 3
        code = (
            'import sys\n'
            'for i in range(3):\n'
            f'    sys.stdout.buffer.write(bytes([i * 30] * {frame_bytes}))\n'
            '    sys.stdout.buffer.flush()\n'
        )
        frames = []
        orig_popen = subprocess.Popen
        try:
            def mock_popen(cmd, *args, **kwargs):
                if isinstance(cmd, (list, tuple)) and cmd and cmd[0] == 'ffmpeg':
                    return orig_popen([sys.executable, '-c', code], *args, **kwargs)
                return orig_popen(cmd, *args, **kwargs)

            subprocess.Popen = mock_popen
            for idx, frame in stream_video_frames('ffmpeg', 'video.mp4', w, h, no_progress_timeout_seconds=2.0):
                frames.append((idx, frame.shape, int(frame[0, 0, 0])))
        finally:
            subprocess.Popen = orig_popen

        self.assertEqual(len(frames), 3)
        self.assertEqual(frames[0], (0, (10, 10, 3), 0))
        self.assertEqual(frames[1], (1, (10, 10, 3), 30))
        self.assertEqual(frames[2], (2, (10, 10, 3), 60))

    def test_timeout_when_producer_hangs_without_sending_bytes(self):
        w, h = 10, 10
        code = 'import time, sys\ntime.sleep(10)\n'
        orig_popen = subprocess.Popen
        try:
            def mock_popen(cmd, *args, **kwargs):
                if isinstance(cmd, (list, tuple)) and cmd and cmd[0] == 'ffmpeg':
                    return orig_popen([sys.executable, '-c', code], *args, **kwargs)
                return orig_popen(cmd, *args, **kwargs)

            subprocess.Popen = mock_popen
            t0 = time.time()
            with self.assertRaises(TimeoutError) as ctx:
                for _ in stream_video_frames('ffmpeg', 'video.mp4', w, h, no_progress_timeout_seconds=0.2):
                    pass
            elapsed = time.time() - t0
            self.assertTrue(0.15 <= elapsed <= 1.5, f'Timeout took {elapsed}s')
            self.assertIn('không có frame mới', str(ctx.exception))
        finally:
            subprocess.Popen = orig_popen

    def test_timeout_when_producer_sends_half_frame_then_hangs(self):
        w, h = 10, 10
        half_bytes = (w * h * 3) // 2
        code = f'import time, sys\nsys.stdout.buffer.write(bytes([1] * {half_bytes}))\nsys.stdout.buffer.flush()\ntime.sleep(10)\n'
        orig_popen = subprocess.Popen
        try:
            def mock_popen(cmd, *args, **kwargs):
                if isinstance(cmd, (list, tuple)) and cmd and cmd[0] == 'ffmpeg':
                    return orig_popen([sys.executable, '-c', code], *args, **kwargs)
                return orig_popen(cmd, *args, **kwargs)

            subprocess.Popen = mock_popen
            t0 = time.time()
            with self.assertRaises(TimeoutError) as ctx:
                for _ in stream_video_frames('ffmpeg', 'video.mp4', w, h, no_progress_timeout_seconds=0.2):
                    pass
            elapsed = time.time() - t0
            self.assertTrue(0.15 <= elapsed <= 1.5, f'Timeout took {elapsed}s')
        finally:
            subprocess.Popen = orig_popen

    def test_unexpected_eof_mid_frame(self):
        w, h = 10, 10
        half_bytes = (w * h * 3) // 2
        code = f'import sys\nsys.stdout.buffer.write(bytes([1] * {half_bytes}))\nsys.stdout.buffer.flush()\nsys.exit(0)\n'
        orig_popen = subprocess.Popen
        try:
            def mock_popen(cmd, *args, **kwargs):
                if isinstance(cmd, (list, tuple)) and cmd and cmd[0] == 'ffmpeg':
                    return orig_popen([sys.executable, '-c', code], *args, **kwargs)
                return orig_popen(cmd, *args, **kwargs)

            subprocess.Popen = mock_popen
            with self.assertRaises(RuntimeError) as ctx:
                for _ in stream_video_frames('ffmpeg', 'video.mp4', w, h, no_progress_timeout_seconds=1.0):
                    pass
            self.assertIn('kết thúc đột ngột', str(ctx.exception))
        finally:
            subprocess.Popen = orig_popen

    def test_producer_exits_nonzero(self):
        w, h = 10, 10
        code = 'import sys\nsys.stderr.write(\'Fatal codec decoder error\\n\')\nsys.exit(1)\n'
        orig_popen = subprocess.Popen
        try:
            def mock_popen(cmd, *args, **kwargs):
                if isinstance(cmd, (list, tuple)) and cmd and cmd[0] == 'ffmpeg':
                    return orig_popen([sys.executable, '-c', code], *args, **kwargs)
                return orig_popen(cmd, *args, **kwargs)

            subprocess.Popen = mock_popen
            with self.assertRaises(RuntimeError) as ctx:
                for _ in stream_video_frames('ffmpeg', 'video.mp4', w, h, no_progress_timeout_seconds=1.0):
                    pass
            self.assertIn('Fatal codec decoder error', str(ctx.exception))
        finally:
            subprocess.Popen = orig_popen

    def test_backpressure_slow_consumer_does_not_timeout_falsely(self):
        w, h = 10, 10
        frame_bytes = w * h * 3
        code = (
            'import sys\n'
            'for i in range(4):\n'
            f'    sys.stdout.buffer.write(bytes([i] * {frame_bytes}))\n'
            '    sys.stdout.buffer.flush()\n'
        )
        orig_popen = subprocess.Popen
        try:
            def mock_popen(cmd, *args, **kwargs):
                if isinstance(cmd, (list, tuple)) and cmd and cmd[0] == 'ffmpeg':
                    return orig_popen([sys.executable, '-c', code], *args, **kwargs)
                return orig_popen(cmd, *args, **kwargs)

            subprocess.Popen = mock_popen
            count = 0
            for idx, frame in stream_video_frames('ffmpeg', 'video.mp4', w, h, no_progress_timeout_seconds=0.5):
                count += 1
                time.sleep(0.15)
            self.assertEqual(count, 4)
        finally:
            subprocess.Popen = orig_popen

    def test_stderr_flood_bounded_to_ring_buffer(self):
        w, h = 10, 10
        frame_bytes = w * h * 3
        code = (
            'import sys\n'
            'for _ in range(500):\n'
            '    sys.stderr.write(\'A\' * 500 + \'\\n\')\n'
            '    sys.stderr.flush()\n'
            f'sys.stdout.buffer.write(bytes([0] * {frame_bytes}))\n'
            'sys.stdout.buffer.flush()\n'
        )
        orig_popen = subprocess.Popen
        try:
            def mock_popen(cmd, *args, **kwargs):
                if isinstance(cmd, (list, tuple)) and cmd and cmd[0] == 'ffmpeg':
                    return orig_popen([sys.executable, '-c', code], *args, **kwargs)
                return orig_popen(cmd, *args, **kwargs)

            subprocess.Popen = mock_popen
            frames = list(stream_video_frames('ffmpeg', 'video.mp4', w, h, no_progress_timeout_seconds=2.0))
            self.assertEqual(len(frames), 1)
        finally:
            subprocess.Popen = orig_popen


if __name__ == '__main__':
    unittest.main()
