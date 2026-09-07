import gc
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import weakref
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import torch
    from inference import SttnModel
except ImportError:
    torch = None


@unittest.skipUnless(torch is not None, 'Requires PyTorch')
class InferenceTests(unittest.TestCase):
    def test_oom_releases_failed_prediction_before_retry(self):
        model = SttnModel.__new__(SttnModel)
        model.provider = 'cuda'
        failed = []

        class Allocation:
            pass

        def predict(images, masks):
            if len(images) > 2:
                allocation = Allocation()
                failed.append(weakref.ref(allocation))
                raise torch.cuda.OutOfMemoryError('fixture')
            gc.collect()
            self.assertTrue(all(ref() is None for ref in failed))
            return images

        model._predict = predict
        images = [np.zeros((80, 100, 3), np.uint8) for _ in range(4)]
        masks = [np.full((80, 100), 255, np.uint8) for _ in images]
        with patch.object(torch.cuda, 'empty_cache'):
            self.assertEqual(len(model.restore(images, masks)), 4)
