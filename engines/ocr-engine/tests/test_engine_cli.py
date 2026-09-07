# -*- coding: utf-8 -*-
import json
import os
import subprocess
import sys
import unittest

ENGINE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "engine.py"))


class EngineCliTests(unittest.TestCase):
    def test_version_output_matches_contract(self):
        completed = subprocess.run(
            [sys.executable, ENGINE, "--version"],
            capture_output=True,
            text=True,
            check=True,
        )
        lines = completed.stdout.strip().splitlines()
        self.assertEqual(len(lines), 1)
        data = json.loads(lines[0])
        self.assertEqual(data, {
            "type": "version",
            "protocol": "ocr-local/1",
            "engine": "rapidocr",
            "version": "1.2.0",
            "features": [
                "directml-fallback",
                "probe",
                "rapidocr",
                "visual-cues-v1",
                "visual-stream-full-v1",
                "visual-stream-roi-v1",
            ],
            "implementation_fingerprint": "1e0c8bd778d9d97cf129c891e053b0421f5b43b4c3d0914e29e38c63b614c6a4",
        })

    def test_probe_output_matches_contract_when_mocked(self):
        # Run probe with mock so model weights are not loaded during unit test
        code = (
            "import unittest.mock as mock\n"
            "import engine\n"
            "with mock.patch('engine.tao_ocr'):\n"
            "    with mock.patch('engine.gpu_that_su_chay', return_value=False):\n"
            "        import sys\n"
            "        sys.argv = ['engine.py', '--probe']\n"
            "        engine.main()\n"
        )
        completed = subprocess.run(
            [sys.executable, "-c", code],
            cwd=os.path.dirname(ENGINE),
            capture_output=True,
            text=True,
            check=True,
        )
        lines = completed.stdout.strip().splitlines()
        self.assertEqual(len(lines), 1)
        data = json.loads(lines[0])
        self.assertEqual(data["type"], "probe")
        self.assertEqual(data["protocol"], "ocr-local/1")
        self.assertEqual(data["engine"], "rapidocr")
        self.assertEqual(data["version"], "1.2.0")
        self.assertEqual(data["ready"], True)
        self.assertEqual(data["features"], [
            "directml-fallback",
            "probe",
            "rapidocr",
            "visual-cues-v1",
            "visual-stream-full-v1",
            "visual-stream-roi-v1",
        ])
        self.assertRegex(data["implementation_fingerprint"], r"^[0-9a-f]{64}$")

    def test_missing_visual_arguments_emit_error_and_exit_nonzero(self):
        # Missing display width/height/fingerprint when --visual-cues-output is provided
        completed = subprocess.run(
            [
                sys.executable,
                ENGINE,
                "--input", "dummy.mp4",
                "--output", "dummy.srt",
                "--visual-cues-output", "dummy.json",
            ],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        lines = completed.stdout.strip().splitlines()
        self.assertTrue(len(lines) >= 1)
        data = json.loads(lines[-1])
        self.assertEqual(data["type"], "error")

    def test_non_8_fps_in_visual_mode_rejected(self):
        completed = subprocess.run(
            [
                sys.executable,
                ENGINE,
                "--input", "dummy.mp4",
                "--output", "dummy.srt",
                "--visual-cues-output", "dummy.json",
                "--display-width", "576",
                "--display-height", "768",
                "--geometry-fingerprint", "a" * 64,
                "--x0", "0", "--y0", "0", "--x1", "576", "--y1", "768",
                "--fps", "4",  # Not 8
            ],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        lines = completed.stdout.strip().splitlines()
        self.assertTrue(len(lines) >= 1)
        data = json.loads(lines[-1])
        self.assertEqual(data["type"], "error")

    def test_invalid_display_size_rejected(self):
        completed = subprocess.run(
            [
                sys.executable,
                ENGINE,
                "--input", "dummy.mp4",
                "--output", "dummy.srt",
                "--visual-cues-output", "dummy.json",
                "--display-width", "-10",
                "--display-height", "768",
                "--geometry-fingerprint", "a" * 64,
                "--x0", "0", "--y0", "0", "--x1", "576", "--y1", "768",
                "--fps", "8",
            ],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        lines = completed.stdout.strip().splitlines()
        self.assertTrue(len(lines) >= 1)
        data = json.loads(lines[-1])
        self.assertEqual(data["type"], "error")

    def test_invalid_scan_rectangle_rejected(self):
        completed = subprocess.run(
            [
                sys.executable,
                ENGINE,
                "--input", "dummy.mp4",
                "--output", "dummy.srt",
                "--visual-cues-output", "dummy.json",
                "--display-width", "576",
                "--display-height", "768",
                "--geometry-fingerprint", "a" * 64,
                "--x0", "100", "--y0", "0", "--x1", "50", "--y1", "768",  # x0 > x1
                "--fps", "8",
            ],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        lines = completed.stdout.strip().splitlines()
        self.assertTrue(len(lines) >= 1)
        data = json.loads(lines[-1])
        self.assertEqual(data["type"], "error")

    def test_non_64_hex_fingerprint_rejected(self):
        completed = subprocess.run(
            [
                sys.executable,
                ENGINE,
                "--input", "dummy.mp4",
                "--output", "dummy.srt",
                "--visual-cues-output", "dummy.json",
                "--display-width", "576",
                "--display-height", "768",
                "--geometry-fingerprint", "not-a-valid-hex-fingerprint",
                "--x0", "0", "--y0", "0", "--x1", "576", "--y1", "768",
                "--fps", "8",
            ],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        lines = completed.stdout.strip().splitlines()
        self.assertTrue(len(lines) >= 1)
        data = json.loads(lines[-1])
        self.assertEqual(data["type"], "error")


    def test_legacy_disk_extract_flag_accepted(self):
        # Verify --legacy-disk-extract is an accepted CLI argument
        completed = subprocess.run(
            [
                sys.executable,
                ENGINE,
                "--input", "nonexistent.mp4",
                "--output", "dummy.srt",
                "--visual-cues-output", "dummy.json",
                "--display-width", "576",
                "--display-height", "768",
                "--geometry-fingerprint", "a" * 64,
                "--x0", "0", "--y0", "0", "--x1", "576", "--y1", "768",
                "--fps", "8",
                "--legacy-disk-extract",
            ],
            capture_output=True,
            text=True,
        )
        lines = completed.stdout.strip().splitlines()
        self.assertTrue(len(lines) >= 1)
        data = json.loads(lines[-1])
        # It fails because nonexistent.mp4 cannot be probed, but NOT with argparse unrecognized arguments error
        self.assertEqual(data["type"], "error")
        self.assertNotIn("unrecognized arguments", completed.stderr)

    def test_visual_transport_flags_are_accepted(self):
        for transport in ("legacy-disk", "stream-full", "stream-roi"):
            completed = subprocess.run(
                [
                    sys.executable,
                    ENGINE,
                    "--input", "nonexistent.mp4",
                    "--output", "dummy.srt",
                    "--visual-cues-output", "dummy.json",
                    "--display-width", "576",
                    "--display-height", "768",
                    "--geometry-fingerprint", "a" * 64,
                    "--x0", "0", "--y0", "0", "--x1", "576", "--y1", "768",
                    "--fps", "8",
                    "--visual-transport", transport,
                ],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(completed.returncode, 0)
            lines = completed.stdout.strip().splitlines()
            self.assertTrue(lines)
            self.assertEqual(json.loads(lines[-1])["type"], "error")
            self.assertNotIn("unrecognized arguments", completed.stderr)

    def test_legacy_alias_rejects_conflicting_visual_transport(self):
        completed = subprocess.run(
            [
                sys.executable,
                ENGINE,
                "--input", "nonexistent.mp4",
                "--output", "dummy.srt",
                "--visual-cues-output", "dummy.json",
                "--display-width", "576",
                "--display-height", "768",
                "--geometry-fingerprint", "a" * 64,
                "--x0", "0", "--y0", "0", "--x1", "576", "--y1", "768",
                "--fps", "8",
                "--legacy-disk-extract",
                "--visual-transport", "stream-full",
            ],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        lines = completed.stdout.strip().splitlines()
        self.assertTrue(lines)
        data = json.loads(lines[-1])
        self.assertEqual(data["type"], "error")
        self.assertIn("visual-transport", data["message"])


if __name__ == "__main__":
    unittest.main()
