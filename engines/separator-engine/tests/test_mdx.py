import glob
import os
import unittest
import numpy as np

import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from protocol import EngineError
from mdx import provider_chain, overlap_starts, complementary_stem, stft_window_hann

class MdxTests(unittest.TestCase):
    def test_provider_chain_selection(self):
        self.assertEqual(
            provider_chain("auto", ["DmlExecutionProvider", "CPUExecutionProvider"]),
            ["DmlExecutionProvider"]
        )
        self.assertEqual(
            provider_chain("auto", ["CPUExecutionProvider"]),
            ["CPUExecutionProvider"]
        )
        self.assertEqual(
            provider_chain("cpu", ["DmlExecutionProvider", "CPUExecutionProvider"]),
            ["CPUExecutionProvider"]
        )
        with self.assertRaises(EngineError):
            provider_chain("directml", ["CPUExecutionProvider"])

    def test_overlap_starts(self):
        starts = overlap_starts(total=1000, segment=400, overlap=0.25)
        self.assertEqual(starts, [0, 300, 600])

    def test_complementary_stem(self):
        mixture = np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float32)
        primary = np.array([[0.8, 1.5], [2.0, 3.5]], dtype=np.float32)
        secondary = complementary_stem(mixture, primary)
        expected = np.array([[0.2, 0.5], [1.0, 0.5]], dtype=np.float32)
        np.testing.assert_allclose(secondary, expected, atol=1e-5)

    def test_complementary_stem_rejects_nan(self):
        mixture = np.array([[np.nan, 2.0]], dtype=np.float32)
        primary = np.array([[0.8, 1.5]], dtype=np.float32)
        with self.assertRaises(EngineError):
            complementary_stem(mixture, primary)

    def test_no_forbidden_dependencies_in_engine_dir(self):
        engine_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        forbidden = ["torch", "torchaudio", "requests", "urllib", "httpx", "demucs"]
        py_files = glob.glob(os.path.join(engine_dir, "*.py"))
        for fpath in py_files:
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read().lower()
                for forb in forbidden:
                    self.assertNotIn(
                        f"import {forb}",
                        content,
                        f"Forbidden dependency '{forb}' imported in {os.path.basename(fpath)}"
                    )

if __name__ == "__main__":
    unittest.main()
