import json
import os
import subprocess
import sys
import unittest

ENGINE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "engine.py"))

class ProtocolTests(unittest.TestCase):
    def test_version_is_one_json_line(self):
        completed = subprocess.run(
            [sys.executable, ENGINE, "--version"],
            check=True,
            capture_output=True,
            text=True,
        )
        lines = completed.stdout.strip().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0]), {
            "type": "version",
            "protocol": "separator-engine/1",
            "engine": "mdx-onnx",
            "version": "1.0.0",
            "features": ["directml", "cpu", "mdx-two-stem"],
        })

    def test_invalid_cli_arguments_emit_error_and_exit_nonzero(self):
        completed = subprocess.run(
            [sys.executable, ENGINE, "--unknown-flag"],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        lines = completed.stdout.strip().splitlines()
        self.assertTrue(len(lines) >= 1)
        data = json.loads(lines[-1])
        self.assertEqual(data["type"], "error")
        self.assertEqual(data["retryable"], False)

if __name__ == "__main__":
    unittest.main()
