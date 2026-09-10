"""Regressions for reporting the sessions RapidOCR actually uses."""
import importlib.util
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import engine


class Session:
    def __init__(self, provider):
        self.provider = provider

    def get_providers(self):
        return [self.provider, "CPUExecutionProvider"]


def ocr_sessions(det="DmlExecutionProvider", cls="DmlExecutionProvider", rec="DmlExecutionProvider"):
    return SimpleNamespace(
        text_det=SimpleNamespace(infer=SimpleNamespace(session=Session(det))),
        text_cls=SimpleNamespace(infer=SimpleNamespace(session=Session(cls))),
        text_rec=SimpleNamespace(session=SimpleNamespace(session=Session(rec))),
    )


class ProviderReportingTests(unittest.TestCase):
    def test_reads_actual_rapidocr_144_session_paths(self):
        self.assertEqual(engine.get_ocr_provider_report(ocr_sessions()), {
            "det": "DmlExecutionProvider", "cls": "DmlExecutionProvider",
            "rec": "DmlExecutionProvider",
        })

    def test_mixed_sessions_are_reported_without_guessing_all_gpu(self):
        self.assertEqual(engine.get_ocr_provider_report(ocr_sessions(rec="CPUExecutionProvider")), {
            "det": "DmlExecutionProvider", "cls": "DmlExecutionProvider",
            "rec": "CPUExecutionProvider",
        })

    @unittest.skipUnless(importlib.util.find_spec("rapidocr_onnxruntime"), "Requires the OCR build environment")
    def test_real_cpu_rapidocr_reports_all_three_sessions(self):
        from rapidocr_onnxruntime import RapidOCR
        ocr = RapidOCR(det_use_dml=False, cls_use_dml=False, rec_use_dml=False)
        self.assertEqual(engine.get_ocr_provider_report(ocr), {
            "det": "CPUExecutionProvider", "cls": "CPUExecutionProvider",
            "rec": "CPUExecutionProvider",
        })


@unittest.skipUnless(importlib.util.find_spec("rapidocr_onnxruntime"), "Requires the OCR build environment")
class ProviderSelectionTests(unittest.TestCase):
    def run_factory(self, device, available, fail_gpu=False):
        def construct(**options):
            if options.get("det_use_dml") and fail_gpu:
                raise RuntimeError("Forced GPU init failure")
            provider = "DmlExecutionProvider" if options.get("det_use_dml") else "CPUExecutionProvider"
            return ocr_sessions(provider, provider, provider)

        output = io.StringIO()
        with patch.dict(os.environ, {"TEDIAPROS_OCR_DEVICE": device}), \
                patch("onnxruntime.get_available_providers", return_value=available), \
                patch("rapidocr_onnxruntime.RapidOCR", side_effect=construct), \
                patch.object(engine, "resolve_ocr_models", return_value={}, create=True), \
                contextlib.redirect_stdout(output):
            ocr = engine.tao_ocr()
        events = [json.loads(line) for line in output.getvalue().splitlines() if line.startswith("{")]
        return engine.get_ocr_provider_report(ocr), events

    def test_cpu_override_never_uses_an_available_gpu(self):
        report, _ = self.run_factory("cpu", ["DmlExecutionProvider", "CPUExecutionProvider"])
        self.assertEqual(report, {key: "CPUExecutionProvider" for key in ("det", "cls", "rec")})

    def test_explicit_dml_fails_when_gpu_provider_is_missing(self):
        with self.assertRaisesRegex(RuntimeError, "DmlExecutionProvider"):
            self.run_factory("dml", ["CPUExecutionProvider"])

    def test_auto_fallback_reports_missing_provider_reason(self):
        report, events = self.run_factory("auto", ["CPUExecutionProvider"])
        self.assertEqual(report["det"], "CPUExecutionProvider")
        self.assertTrue(any("DmlExecutionProvider" in event.get("fallback_reason", "") for event in events))

    def test_auto_fallback_reports_gpu_initialization_failure(self):
        report, events = self.run_factory("auto", ["DmlExecutionProvider", "CPUExecutionProvider"], fail_gpu=True)
        self.assertEqual(report, {key: "CPUExecutionProvider" for key in ("det", "cls", "rec")})
        self.assertTrue(any("Forced GPU init failure" in event.get("fallback_reason", "") for event in events))

    def test_unknown_device_does_not_silently_choose_default(self):
        with self.assertRaisesRegex(ValueError, "auto.*cpu.*dml"):
            self.run_factory("bogus", ["CPUExecutionProvider"])

    def test_partial_gpu_initialization_is_rejected_and_adapter_restored(self):
        from rapidocr_onnxruntime.utils.infer_engine import OrtInferSession
        original = OrtInferSession._init_sess_opts
        gpu_flags = []

        def construct(**options):
            gpu_flags.append(options["det_use_dml"])
            if options["det_use_dml"]:
                return ocr_sessions(rec="CPUExecutionProvider")
            return ocr_sessions(*(["CPUExecutionProvider"] * 3))

        with patch.dict(os.environ, {"TEDIAPROS_OCR_DEVICE": "auto"}), \
                patch("onnxruntime.get_available_providers", return_value=["DmlExecutionProvider", "CPUExecutionProvider"]), \
                patch("rapidocr_onnxruntime.RapidOCR", side_effect=construct), \
                patch.object(engine, "resolve_ocr_models", return_value={}), \
                contextlib.redirect_stdout(io.StringIO()):
            ocr = engine.tao_ocr()
        self.assertEqual(gpu_flags, [True, False])
        self.assertFalse(engine.gpu_that_su_chay(ocr))
        self.assertIs(OrtInferSession._init_sess_opts, original)

    def test_corrupted_pinned_models_do_not_fall_back_to_other_models(self):
        with tempfile.TemporaryDirectory(prefix="ocr-invalid-models-") as folder:
            for name in ("ch_PP-OCRv3_det_infer.onnx", "ch_PP-OCRv3_rec_infer.onnx", "ch_ppocr_mobile_v2.0_cls_infer.onnx"):
                Path(folder, name).write_bytes(b"not a qualified model")
            with patch.dict(os.environ, {"TEDIAPROS_OCR_DEVICE": "cpu", "TEDIAPROS_OCR_MODELS_DIR": folder}):
                with self.assertRaisesRegex(ValueError, "SHA-256"):
                    engine.tao_ocr()


@unittest.skipUnless(importlib.util.find_spec("rapidocr_onnxruntime") and os.environ.get("TEDIAPROS_OCR_MODELS_DIR"),
                     "Requires the prepared OCR build environment")
class QualifiedRuntimeTests(unittest.TestCase):
    def test_gpu_init_failure_builds_real_cpu_sessions_with_safe_options(self):
        import onnxruntime as ort
        from rapidocr_onnxruntime import RapidOCR
        from rapidocr_onnxruntime.utils.infer_engine import OrtInferSession
        original_options = OrtInferSession._init_sess_opts
        output = io.StringIO()

        def construct(**options):
            if options["det_use_dml"]:
                raise RuntimeError("Injected DML initialization error")
            return RapidOCR(**options)

        with patch.dict(os.environ, {"TEDIAPROS_OCR_DEVICE": "auto"}), \
                patch("onnxruntime.get_available_providers", return_value=["DmlExecutionProvider", "CPUExecutionProvider"]), \
                patch("rapidocr_onnxruntime.RapidOCR", side_effect=construct), \
                contextlib.redirect_stdout(output):
            ocr = engine.tao_ocr()
        self.assertIs(OrtInferSession._init_sess_opts, original_options)
        self.assertEqual(engine.get_ocr_provider_report(ocr), {key: "CPUExecutionProvider" for key in ("det", "cls", "rec")})
        self.assertIn("Injected DML initialization error", output.getvalue())
        for session in (ocr.text_det.infer.session, ocr.text_cls.infer.session, ocr.text_rec.session.session):
            options = session.get_session_options()
            self.assertFalse(options.enable_mem_pattern)
            self.assertEqual(options.execution_mode, ort.ExecutionMode.ORT_SEQUENTIAL)
            self.assertFalse(session._enable_fallback)
        result, _timings = ocr(engine.np.zeros((64, 192, 3), dtype=engine.np.uint8))
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
