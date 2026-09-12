import os
import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ocr_models

SCRIPT = Path(__file__).resolve().parents[1] / "prepare_models.py"


class ModelPreparationTests(unittest.TestCase):
    def test_model_resolution_survives_windows_virtualized_file_path(self):
        """The managed file stays valid when realpath rewrites only its child path."""
        with tempfile.TemporaryDirectory(prefix="ocr-model-path-") as folder:
            root = Path(folder)
            model = root / "model.onnx"
            model.write_bytes(b"qualified-model")
            digest = hashlib.sha256(model.read_bytes()).hexdigest()
            original_models = ocr_models.MODEL_FILES
            original_resolve = Path.resolve

            def virtualized_resolve(path, strict=False):
                if path.name == "model.onnx":
                    return Path("C:/AppContainer/LocalCache/models/model.onnx")
                return original_resolve(path, strict=strict)

            try:
                ocr_models.MODEL_FILES = {"det": ("model.onnx", digest)}
                with patch.object(Path, "resolve", virtualized_resolve):
                    options = ocr_models.resolve_ocr_models(str(root))
                self.assertEqual(options["det_model_path"], str(model.absolute()))
            finally:
                ocr_models.MODEL_FILES = original_models

    def test_corrupt_archive_is_rejected_before_any_output_is_created(self):
        with tempfile.TemporaryDirectory(prefix="ocr-wheel-reject-") as folder:
            wheel = Path(folder, "corrupt.whl")
            wheel.write_bytes(b"not a qualified wheel")
            output = Path(folder, "models")
            result = subprocess.run([sys.executable, str(SCRIPT), "--wheel", str(wheel), "--output", str(output)],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("SHA-256", result.stderr)
            self.assertFalse(output.exists())

    @unittest.skipUnless(os.environ.get("TEDIAPROS_TEST_OCR_WHEEL"), "Set qualified offline wheel fixture")
    def test_qualified_offline_wheel_extracts_only_pinned_models_and_license(self):
        with tempfile.TemporaryDirectory(prefix="ocr-wheel-accept-") as folder:
            output = Path(folder, "models")
            result = subprocess.run([sys.executable, str(SCRIPT), "--wheel", os.environ["TEDIAPROS_TEST_OCR_WHEEL"], "--output", str(output)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(sorted(path.name for path in output.iterdir()), [
                "MODEL-LICENSE.txt", "ch_PP-OCRv3_det_infer.onnx", "ch_PP-OCRv3_rec_infer.onnx",
                "ch_ppocr_mobile_v2.0_cls_infer.onnx",
            ])
            # Existing output must not be silently overwritten on the next run.
            sentinel = output / "keep.txt"
            sentinel.write_text("keep", encoding="utf-8")
            repeated = subprocess.run([sys.executable, str(SCRIPT), "--wheel", os.environ["TEDIAPROS_TEST_OCR_WHEEL"], "--output", str(output)],
                                      capture_output=True, text=True)
            self.assertNotEqual(repeated.returncode, 0)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
