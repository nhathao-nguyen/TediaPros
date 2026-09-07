"""Inference only: fixed geometry, bounded temporal context, exact mask composite."""
import gc
import cv2
import numpy as np
import torch
from network import InpaintGenerator
from masking import context_crop, composite


class SttnModel:
    def __init__(self, model_path, provider='auto'):
        if provider == 'cuda' and not torch.cuda.is_available():
            raise RuntimeError('CUDA is not available')
        self.provider = 'cuda' if provider != 'cpu' and torch.cuda.is_available() else 'cpu'
        self.device = torch.device('cuda:0' if self.provider == 'cuda' else 'cpu')
        torch.set_num_threads(4)
        self.model = InpaintGenerator(init_weights=False)
        state = torch.load(model_path, map_location='cpu', weights_only=True)
        self.model.load_state_dict(state['netG'] if 'netG' in state else state, strict=True)
        self.model.to(self.device).eval()

    def probe(self):
        with torch.inference_mode():
            image = torch.zeros((1, 2, 3, 240, 432), device=self.device)
            mask = torch.zeros((1, 2, 1, 240, 432), device=self.device)
            mask[:, :, :, 100:125, 120:280] = 1
            output = self.model(image, mask)
            if output.shape != (2, 3, 240, 432) or not torch.isfinite(output).all():
                raise RuntimeError('STTN probe returned invalid pixels')

    def restore(self, images, masks):
        crop = context_crop(masks)
        if crop is None:
            return images
        x0, y0, x1, y1 = crop
        small_images = np.stack([cv2.resize(image[y0:y1, x0:x1], (432, 240), interpolation=cv2.INTER_AREA) for image in images])
        small_masks = np.stack([cv2.resize(mask[y0:y1, x0:x1], (432, 240), interpolation=cv2.INTER_NEAREST) for mask in masks])
        retry = False
        try:
            predictions = self._predict(small_images, small_masks)
        except torch.cuda.OutOfMemoryError:
            # Retry within the same provider, reducing temporal scope. Never
            # silently report Gaussian blur or an unchanged image as erasure.
            if self.provider != 'cuda' or len(images) <= 2:
                raise
            retry = True
        # Leave the exception handler before retrying: its traceback otherwise
        # keeps failed inference tensors alive while allocating the next batch.
        if retry:
            gc.collect()
            torch.cuda.empty_cache()
            split = len(images)//2
            return self.restore(images[:split], masks[:split]) + self.restore(images[split:], masks[split:])
        output = []
        for image, mask, prediction in zip(images, masks, predictions):
            if not mask.any():
                output.append(image)
                continue
            patch = cv2.resize(prediction, (x1-x0, y1-y0), interpolation=cv2.INTER_LINEAR)
            result = image.copy()
            result[y0:y1, x0:x1] = composite(image[y0:y1, x0:x1], patch, mask[y0:y1, x0:x1])
            output.append(result)
        return output

    def _predict(self, images, masks):
        with torch.inference_mode():
            image = torch.from_numpy(images.transpose(0, 3, 1, 2).copy()).to(self.device, dtype=torch.float32) / 127.5 - 1
            mask = torch.from_numpy((masks[:, None] > 0).astype(np.float32)).to(self.device)
            predicted = self.model((image*(1-mask))[None], mask[None])
            if not torch.isfinite(predicted).all():
                raise RuntimeError('STTN produced non-finite pixels')
            return ((predicted.clamp(-1, 1)+1)*127.5).permute(0, 2, 3, 1).byte().cpu().numpy()
