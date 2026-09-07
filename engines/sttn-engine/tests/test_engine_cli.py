import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ENGINE = Path(__file__).resolve().parents[1] / 'engine.py'


class CliTests(unittest.TestCase):
    def test_version_does_not_need_torch_or_model(self):
        result = subprocess.run([sys.executable, str(ENGINE), '--version'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        event = json.loads(result.stdout)
        self.assertEqual(event['protocol'], 'sttn-engine/1')
        self.assertEqual(event['engine'], 'sttn')

    def test_missing_model_is_structured_failure(self):
        result = subprocess.run([sys.executable, str(ENGINE), '--probe', '--model', 'missing-model.pth'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(result.stdout.strip(), 'Expected structured failure event')
        event = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(event['type'], 'error')
        self.assertEqual(event['code'], 'model_missing')

    def test_output_cannot_overwrite_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'original.mp4'
            source.write_bytes(b'original')
            request = Path(tmp) / 'request.json'
            request.write_text(json.dumps({'inputPath': str(source), 'outputPath': str(source)}))
            result = subprocess.run([sys.executable, str(ENGINE), '--run', '--request', str(request)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(source.read_bytes(), b'original')
            self.assertTrue(result.stdout.strip(), 'Expected structured failure event')
            self.assertEqual(json.loads(result.stdout.strip().splitlines()[-1])['code'], 'invalid_request')


if __name__ == '__main__':
    unittest.main()
