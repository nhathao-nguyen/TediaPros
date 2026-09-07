from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    from video import _run, WritePipe
except ImportError:
    _run = None


@unittest.skipUnless(_run, 'Requires media runtime dependencies')
class MediaProcessTests(unittest.TestCase):
    def test_stream_writer_handles_partial_os_pipe_writes(self):
        class ShortPipe:
            def __init__(self):
                self.data = bytearray()
            def write(self, data):
                self.data.extend(data[:3])
                return min(3, len(data))
            def close(self):
                pass
        class Process:
            stdin = ShortPipe()
        writer = WritePipe(Process())
        try:
            self.assertEqual(writer.write(b'abcdefghijk'), 11)
            self.assertEqual(writer.process.stdin.data, b'abcdefghijk')
        finally:
            writer.close()

    def test_large_stdout_is_rejected_and_large_stderr_is_bounded(self):
        with self.assertRaisesRegex(RuntimeError, 'exceeds'):
            _run([sys.executable, '-c', "import sys; sys.stdout.write('x'*5000000)"])
        with self.assertRaises(RuntimeError) as caught:
            _run([sys.executable, '-c', "import sys; sys.stderr.write('x'*5000000); sys.exit(1)"])
        self.assertLessEqual(len(str(caught.exception)), 4000)

    def test_timeout_does_not_leave_reader_threads_waiting(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            _run([sys.executable, '-c', 'import time; time.sleep(30)'], timeout=.1)
