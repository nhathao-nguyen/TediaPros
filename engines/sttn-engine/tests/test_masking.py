import sys
import unittest
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    from masking import MaskTimeline, composite, iter_windows, context_crop
except ImportError:
    MaskTimeline = composite = iter_windows = context_crop = None


def timeline():
    return {
        'schemaVersion': 1, 'protocol': 'ocr-visual-cues/1',
        'video': {'width': 100, 'height': 80, 'durationSeconds': 2, 'sampleFps': 8},
        'scanRegion': {'x0': 10, 'y0': 20, 'x1': 90, 'y1': 70},
        'segments': [{'start': .5, 'end': 1., 'boxes': [
            {'x0': 12, 'y0': 30, 'x1': 45, 'y1': 45}]}],
    }


class MaskingTests(unittest.TestCase):
    def test_mask_stays_in_scan_and_deactivates_after_text(self):
        self.assertIsNotNone(MaskTimeline, 'STTN masking is not implemented')
        plan = MaskTimeline(timeline())
        self.assertFalse(plan.at(.1).any())
        mask = plan.at(.6)
        self.assertTrue(mask[30:45, 12:45].all())
        self.assertFalse(mask[:, :10].any())
        self.assertFalse(mask[70:].any())
        self.assertFalse(plan.at(1.2).any())

    def test_invalid_and_out_of_order_timestamps_fail(self):
        self.assertIsNotNone(MaskTimeline)
        bad = timeline()
        bad['segments'][0]['end'] = float('nan')
        with self.assertRaises(ValueError):
            MaskTimeline(bad)
        plan = MaskTimeline(timeline())
        plan.at(.8)
        with self.assertRaises(ValueError):
            plan.at(.1)

    def test_restore_never_changes_pixels_outside_mask(self):
        self.assertIsNotNone(composite)
        source = np.full((20, 30, 3), 47, dtype=np.uint8)
        predicted = np.full_like(source, 230)
        mask = np.zeros((20, 30), dtype=np.uint8)
        mask[5:10, 3:12] = 255
        result = composite(source, predicted, mask)
        self.assertTrue(np.array_equal(result[mask == 0], source[mask == 0]))
        self.assertTrue((result[mask != 0] == 230).all())
        self.assertTrue((source == 47).all())

    def test_windows_emit_every_frame_once_and_bound_memory(self):
        self.assertIsNotNone(iter_windows)
        emitted = []
        for frames, first, last in iter_windows(iter(range(103)), 12, 2):
            self.assertLessEqual(len(frames), 12)
            emitted.extend(frames[first:last])
        self.assertEqual(emitted, list(range(103)))

    def test_scene_cut_never_shares_context(self):
        self.assertIsNotNone(iter_windows)
        emitted = []
        for frames, first, last in iter_windows(iter(range(31)), 12, 2, lambda a, b: b == 17):
            self.assertFalse(min(frames) < 17 <= max(frames))
            emitted.extend(frames[first:last])
        self.assertEqual(emitted, list(range(31)))

    def test_crop_contains_text_and_is_clipped(self):
        self.assertIsNotNone(context_crop)
        mask = np.zeros((80, 100), dtype=np.uint8)
        mask[60:79, 88:100] = 255
        x0, y0, x1, y1 = context_crop([mask])
        self.assertTrue(0 <= x0 <= 88 < 100 <= x1 <= 100)
        self.assertTrue(0 <= y0 <= 60 < 79 <= y1 <= 80)
        self.assertIsNone(context_crop([np.zeros_like(mask)]))


if __name__ == '__main__':
    unittest.main()
