"""Qualified PP-OCR models: no network access during OCR inference."""
import hashlib
import os
from pathlib import Path

MODEL_FILES = {
    "det": ("ch_PP-OCRv3_det_infer.onnx", "3439588c030faea393a54515f51e983d8e155b19a2e8aba7891934c1cf0de526"),
    "cls": ("ch_ppocr_mobile_v2.0_cls_infer.onnx", "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c"),
    "rec": ("ch_PP-OCRv3_rec_infer.onnx", "897a3ededb38fee0dae2c1ccee38241f37df202c9509e3abca02e9217c5ee615"),
}


def resolve_ocr_models(directory=None):
    root = Path(directory or os.environ.get("TEDIAPROS_OCR_MODELS_DIR")
                or Path(__file__).resolve().parent / "models").resolve(strict=True)
    options = {}
    for component, (name, digest) in MODEL_FILES.items():
        model = (root / name).resolve(strict=True)
        if not model.is_relative_to(root) or not model.is_file():
            raise ValueError(f"OCR model must be a regular file inside the model directory: {name}")
        if model.stat().st_size > 64 * 1024 * 1024:
            raise ValueError(f"OCR model exceeds the qualified size limit: {name}")
        if hashlib.sha256(model.read_bytes()).hexdigest() != digest:
            raise ValueError(f"OCR model SHA-256 mismatch: {name}")
        options[f"{component}_model_path"] = str(model)
    return options
