import os
import struct
import tempfile
import unittest
import wave
import numpy as np

import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from audio_io import read_pcm_wav, write_pcm_wav
from protocol import EngineError

class AudioIoTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.temp_dir.cleanup()

    def _write_wav_helper(self, filename, channels=2, sample_rate=44100, num_samples=1000):
        path = os.path.join(self.temp_dir.name, filename)
        with wave.open(path, "wb") as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            data = bytearray()
            for _ in range(num_samples):
                for _ in range(channels):
                    data.extend(struct.pack("<h", 1000))
            wf.writeframes(data)
        return path

    def test_reads_valid_stereo_44100_wav(self):
        path = self._write_wav_helper("valid.wav", channels=2, sample_rate=44100, num_samples=500)
        samples = read_pcm_wav(path)
        self.assertEqual(samples.shape, (500, 2))
        self.assertTrue(np.isfinite(samples).all())

    def test_rejects_mono_audio(self):
        path = self._write_wav_helper("mono.wav", channels=1, sample_rate=44100)
        with self.assertRaises(EngineError):
            read_pcm_wav(path)

    def test_rejects_wrong_sample_rate(self):
        path = self._write_wav_helper("sr48000.wav", channels=2, sample_rate=48000)
        with self.assertRaises(EngineError):
            read_pcm_wav(path)

    def test_rejects_empty_audio(self):
        path = self._write_wav_helper("empty.wav", channels=2, sample_rate=44100, num_samples=0)
        with self.assertRaises(EngineError):
            read_pcm_wav(path)

    def test_write_and_read_roundtrip(self):
        out_path = os.path.join(self.temp_dir.name, "out.wav")
        samples = np.zeros((1000, 2), dtype=np.float32)
        samples[:, 0] = 0.5
        samples[:, 1] = -0.5
        write_pcm_wav(out_path, samples)
        read_back = read_pcm_wav(out_path)
        self.assertEqual(read_back.shape, (1000, 2))
        np.testing.assert_allclose(read_back, samples, atol=1e-4)

    def test_write_rejects_nan_and_inf(self):
        out_path = os.path.join(self.temp_dir.name, "bad.wav")
        bad_nan = np.full((100, 2), np.nan, dtype=np.float32)
        with self.assertRaises(EngineError):
            write_pcm_wav(out_path, bad_nan)

        bad_inf = np.full((100, 2), np.inf, dtype=np.float32)
        with self.assertRaises(EngineError):
            write_pcm_wav(out_path, bad_inf)

if __name__ == "__main__":
    unittest.main()
