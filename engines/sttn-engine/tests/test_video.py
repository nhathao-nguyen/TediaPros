import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import av
except ImportError:
    av = None
try:
    from video import process_video
except ImportError:
    process_video = None

FF = os.environ.get('STTN_TEST_FFMPEG')


class WhiteModel:
    provider = 'cpu'

    def restore(self, images, masks):
        from masking import composite
        return [composite(image, np.full_like(image, 255), mask) for image, mask in zip(images, masks)]


@unittest.skipUnless(process_video is not None, 'Requires media dependencies')
class DurationTests(unittest.TestCase):
    def probe(self):
        # Measured metadata from the failing 71.130127 s HE-AACv2 source.
        return {'format': {'duration': '71.284000'}, 'streams': [
            {'codec_type': 'video', 'tags': {'DURATION': '00:01:11.130000000'}},
            {'codec_type': 'audio', 'initial_padding': 7106, 'sample_rate': '44100',
             'tags': {'DURATION': '00:01:11.284000000'}}]}

    def test_actual_he_aac_metadata_validates_playback_duration(self):
        from video import _intermediate_duration
        self.assertAlmostEqual(_intermediate_duration(self.probe(), 71.130127, 29.917), 71.130, places=3)

    def test_excess_audio_without_priming_is_rejected(self):
        from video import _intermediate_duration
        info = self.probe()
        info['streams'][1]['initial_padding'] = 0
        with self.assertRaisesRegex(RuntimeError, 'audio duration mismatch'):
            _intermediate_duration(info, 71.130127, 29.917)

    def test_nonfinite_missing_or_corrupt_duration_is_rejected(self):
        from video import _intermediate_duration
        for bad in ['NaN', 'Infinity', 'bad', None]:
            with self.subTest(value=bad):
                info = self.probe()
                info['streams'][0]['tags']['DURATION'] = bad
                with self.assertRaisesRegex(RuntimeError, 'duration metadata invalid'):
                    _intermediate_duration(info, 71.130127, 29.917)
        info = self.probe()
        info['format']['duration'] = 'NaN'
        with self.assertRaisesRegex(RuntimeError, 'container duration mismatch'):
            _intermediate_duration(info, 71.130127, 29.917)


@unittest.skipUnless(av is not None and FF, 'Requires PyAV and STTN_TEST_FFMPEG for real media test')
class VideoTests(unittest.TestCase):
    def test_aac_codec_delay_does_not_reject_correct_video_or_change_audio(self):
        # AAC at 8 kHz has 128 ms priming. Matroska's container/track
        # duration includes this even though decoded playback skips it.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request = self.small_fixture(root)
            source = root/'primed.mp4'
            subprocess.run([FF, '-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=30:d=2',
                '-f', 'lavfi', '-i', 'sine=sample_rate=8000:duration=2',
                '-c:v', 'libx264', '-c:a', 'aac', str(source)], capture_output=True, check=True)
            request['inputPath'] = str(source)
            result = process_video(request, WhiteModel(), lambda _: None)
            self.assertEqual(result['frames'], 60)
            self.assertAlmostEqual(result['durationSeconds'], 2, delta=.1)
            digests = [subprocess.check_output([FF, '-v', 'error', '-i', str(path),
                '-map', '0:a', '-c:a', 'pcm_f32le', '-f', 'hash', '-hash', 'sha256', '-'])
                for path in [source, Path(request['outputPath'])]]
            self.assertEqual(*digests)

    def test_real_video_duration_error_is_not_hidden_by_long_audio(self):
        import video
        with tempfile.TemporaryDirectory() as tmp:
            request = self.small_fixture(Path(tmp))
            run = video._run
            def shortened_video(args, **kwargs):
                result = run(args, **kwargs)
                if '.sttn-' in args[-1] and '-show_format' in args:
                    probe = json.loads(result)
                    stream = next(s for s in probe['streams'] if s['codec_type'] == 'video')
                    stream['tags']['DURATION'] = '00:00:01.000000000'
                    return json.dumps(probe).encode()
                return result
            with patch('video._run', side_effect=shortened_video):
                with self.assertRaisesRegex(RuntimeError, 'Intermediate video duration mismatch'):
                    process_video(request, WhiteModel(), lambda _: None)
            self.assertFalse(Path(request['outputPath']).exists())

    def test_multiple_audio_tracks_keep_delayed_timestamps_and_samples(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request = self.small_fixture(root)
            source = root/'delayed.mkv'
            subprocess.run([FF, '-v', 'error', '-i', request['inputPath'],
                '-itsoffset', '0.2', '-f', 'lavfi', '-i', 'sine=frequency=600:duration=1.8',
                '-itsoffset', '0.4', '-f', 'lavfi', '-i', 'sine=frequency=800:duration=1.6',
                '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'copy', '-c:a', 'pcm_s16le',
                str(source)], capture_output=True, check=True)
            request['inputPath'] = str(source)
            process_video(request, WhiteModel(), lambda _: None)
            for track in [0, 1]:
                evidence = []
                for path in [source, Path(request['outputPath'])]:
                    with av.open(str(path)) as media:
                        frames = list(media.decode(audio=track))
                        evidence.append(([float(f.pts*f.time_base) for f in frames],
                                         b''.join(f.to_ndarray().tobytes() for f in frames)))
                self.assertEqual(*evidence)

    def test_muxer_failure_stops_children_and_removes_partial_video(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request = self.small_fixture(root)
            popen = subprocess.Popen
            children = []
            def launch(args, **kwargs):
                if '-copyts' in args:
                    args = [sys.executable, '-c', 'import sys; sys.exit(12)']
                child = popen(args, **kwargs)
                children.append(child)
                return child
            with patch('video.subprocess.Popen', side_effect=launch):
                with self.assertRaises((RuntimeError, OSError)):
                    process_video(request, WhiteModel(), lambda _: None)
            self.assertTrue(all(child.poll() is not None for child in children))
            self.assertEqual(list(root.glob('.sttn-*')), [])
            self.assertFalse(Path(request['outputPath']).exists())

    def small_fixture(self, root):
        source = root/'source.mkv'
        subprocess.run([FF, '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=10:d=2',
                        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'ffv1',
                        '-c:a', 'pcm_s16le', str(source)], check=True, capture_output=True)
        timeline = {'schemaVersion': 1, 'protocol': 'ocr-visual-cues/1',
                    'video': {'width': 320, 'height': 180, 'durationSeconds': 2, 'sampleFps': 8},
                    'scanRegion': {'x0': 0, 'y0': 0, 'x1': 320, 'y1': 180}, 'segments': []}
        (root/'timeline.json').write_text(json.dumps(timeline))
        return {'inputPath': str(source), 'outputPath': str(root/'clean.mkv'),
                'timelinePath': str(root/'timeline.json'), 'ffmpegPath': FF,
                'ffprobePath': str(Path(FF).with_name('ffprobe.exe' if os.name == 'nt' else 'ffprobe'))}

    def test_only_one_video_file_is_written_and_audio_is_bit_exact(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request = self.small_fixture(root)
            seen = []
            def progress(event):
                seen.append(len(list(root.glob('.sttn-*.mkv'))))
            import video
            run = video._run
            def inspect_run(args, **kwargs):
                seen.append(len(list(root.glob('.sttn-*.mkv'))))
                return run(args, **kwargs)
            with patch('video._run', side_effect=inspect_run):
                process_video(request, WhiteModel(), progress)
            self.assertEqual(max(seen), 1, 'Do not write a silent video plus a full remux copy')
            for stream in ['v:0', 'a:0']:
                digests = [subprocess.check_output([FF, '-v', 'error', '-i', str(root/name),
                           '-map', stream, *(['-pix_fmt', 'rgb24'] if stream == 'v:0' else []),
                           '-f', 'hash', '-hash', 'sha256', '-'])
                           for name in ['source.mkv', 'clean.mkv']]
                self.assertEqual(*digests)
            self.assertEqual(list(root.glob('.sttn-*')), [])

    def test_disk_space_is_checked_during_processing_and_failure_cleans_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request = self.small_fixture(root)
            free = 10 * 1024**3
            def progress(event):
                nonlocal free
                if event.get('phase') == 'inpainting':
                    free = 0
            with patch('video.shutil.disk_usage', side_effect=lambda _: SimpleNamespace(free=free)):
                with self.assertRaisesRegex(RuntimeError, 'disk space'):
                    process_video(request, WhiteModel(), progress)
            self.assertFalse((root/'clean.mkv').exists())
            self.assertEqual(list(root.glob('.sttn-*')), [])

    def test_compressible_video_can_start_below_two_raw_copies_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request = self.small_fixture(root)
            # 520 MiB fits one window plus headroom and the actual small FFV1,
            # but the previous two-full-raw-videos estimate rejected this input.
            with patch('video.shutil.disk_usage', return_value=SimpleNamespace(free=520*1024**2)):
                result = process_video(request, WhiteModel(), lambda _: None)
            self.assertEqual(result['frames'], 20)
            self.assertLess(Path(request['outputPath']).stat().st_size, 1024**2)

    def test_variable_final_frame_hold_is_preserved(self):
        from fractions import Fraction
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root/'hold.mkv'
            with av.open(str(source), mode='w') as media:
                stream = media.add_stream('ffv1', rate=10)
                stream.width, stream.height, stream.pix_fmt = 100, 80, 'bgr0'
                stream.time_base = stream.codec_context.time_base = Fraction(1, 1000)
                for pts, length in [(0, 100), (100, 300), (400, 600)]:
                    frame = av.VideoFrame.from_ndarray(np.zeros((80, 100, 3), np.uint8), format='rgb24')
                    frame.pts, frame.time_base = pts, Fraction(1, 1000)
                    for packet in stream.encode(frame):
                        packet.duration = length
                        media.mux(packet)
                for packet in stream.encode():
                    media.mux(packet)
            timeline = {'schemaVersion': 1, 'protocol': 'ocr-visual-cues/1',
                        'video': {'width': 100, 'height': 80, 'durationSeconds': 1, 'sampleFps': 8},
                        'scanRegion': {'x0': 0, 'y0': 0, 'x1': 100, 'y1': 80}, 'segments': []}
            (root/'timeline.json').write_text(json.dumps(timeline))
            process_video({'inputPath': str(source), 'outputPath': str(root/'clean.mkv'),
                           'timelinePath':str(root/'timeline.json'), 'ffmpegPath':FF,
                           'ffprobePath':str(Path(FF).with_name('ffprobe.exe' if os.name=='nt' else 'ffprobe')),
                           'maxFrames':5}, WhiteModel(), lambda _: None)
            with av.open(str(root/'clean.mkv')) as media:
                self.assertAlmostEqual(media.duration/av.time_base, 1, places=2)
                self.assertEqual([round(float(f.pts*f.time_base), 3) for f in media.decode(video=0)], [0, .1, .4])

    def test_variable_frame_spacing_is_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root/'vfr.mkv'
            subprocess.run([FF, '-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=100x80:r=10:d=1',
                            '-vf', "select='eq(n,0)+eq(n,1)+eq(n,4)+eq(n,8)+eq(n,9)'",
                            '-fps_mode', 'vfr', '-c:v', 'ffv1', str(source)], check=True, capture_output=True)
            timeline = {'schemaVersion': 1, 'protocol': 'ocr-visual-cues/1',
                        'video': {'width': 100, 'height': 80, 'durationSeconds': 1, 'sampleFps': 8},
                        'scanRegion': {'x0': 0, 'y0': 0, 'x1': 100, 'y1': 80}, 'segments': []}
            (root/'timeline.json').write_text(json.dumps(timeline))
            process_video({'inputPath': str(source), 'outputPath': str(root/'clean.mkv'),
                           'timelinePath':str(root/'timeline.json'), 'ffmpegPath':FF,
                           'ffprobePath':str(Path(FF).with_name('ffprobe.exe' if os.name=='nt' else 'ffprobe')),
                           'maxFrames':5}, WhiteModel(), lambda _: None)
            with av.open(str(root/'clean.mkv')) as media:
                times = [round(float(f.pts*f.time_base), 3) for f in media.decode(video=0)]
            self.assertEqual(times, [0., .1, .4, .8, .9])

    def test_real_lossless_pipeline_preserves_audio_time_and_unmasked_pixels(self):
        self.assertIsNotNone(process_video, 'STTN media path is not implemented')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root/'source.mkv'
            subprocess.run([FF, '-v', 'error', '-f', 'lavfi', '-i', 'color=0x806040:s=100x80:r=10:d=1',
                            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'ffv1', '-c:a', 'pcm_s16le',
                            str(source)], check=True, capture_output=True)
            timeline = {'schemaVersion': 1, 'protocol': 'ocr-visual-cues/1',
                        'video': {'width': 100, 'height': 80, 'durationSeconds': 1, 'sampleFps': 8},
                        'scanRegion': {'x0': 10, 'y0': 10, 'x1': 90, 'y1': 70},
                        'segments': [{'start': .3, 'end': .6, 'boxes': [{'x0': 30,'y0':30,'x1':60,'y1':45}]}]}
            (root/'timeline.json').write_text(json.dumps(timeline))
            result = process_video({'inputPath': str(source), 'outputPath': str(root/'clean.mkv'),
                           'timelinePath':str(root/'timeline.json'), 'ffmpegPath':FF,
                           'ffprobePath':str(Path(FF).with_name('ffprobe.exe' if os.name=='nt' else 'ffprobe')),
                           'maxFrames':5}, WhiteModel(), lambda _: None)
            self.assertEqual(result['provider'], 'cpu')
            with av.open(str(root/'clean.mkv')) as media:
                self.assertEqual(len(media.streams.audio), 1)
                frames = list(media.decode(video=0))
            self.assertEqual(len(frames), 10)
            self.assertAlmostEqual(float(frames[-1].pts*frames[-1].time_base), .9, places=3)
            rgb = [f.to_ndarray(format='rgb24') for f in frames]
            self.assertTrue((rgb[0][32:40,35:50] < 250).all())
            self.assertTrue((rgb[4][32:40,35:50] == 255).all())
            self.assertTrue(np.array_equal(rgb[0][0:10], rgb[4][0:10]))
            self.assertTrue(np.array_equal(rgb[0], rgb[8]))


if __name__ == '__main__':
    unittest.main()
