"""Build-time extraction of checksum-pinned PP-OCRv3/v2 models (never inference)."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
from urllib.request import urlopen
from zipfile import ZipFile

from ocr_models import MODEL_FILES, resolve_ocr_models

WHEEL_URL = "https://files.pythonhosted.org/packages/b7/ef/0df9a58310895ab357f85df67935af6a8fb98f0965c7476cee6fcb966a7e/rapidocr_onnxruntime-1.2.3-py3-none-any.whl"
WHEEL_SHA256 = "c707d3a6eb72d13119afe9602d3cc36d8b2a4a4d74e9575cf1b0e67ed6a27819"
WHEEL_BYTES = 12326259


def prepare_models(output, wheel=None):
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise FileExistsError(f"Refusing to overwrite existing output: {output}")
    if wheel:
        with Path(wheel).open("rb") as source:
            payload = source.read(WHEEL_BYTES + 1)
    else:
        with urlopen(WHEEL_URL, timeout=60) as source:
            payload = source.read(WHEEL_BYTES + 1)
    if len(payload) != WHEEL_BYTES or hashlib.sha256(payload).hexdigest() != WHEEL_SHA256:
        raise ValueError("OCR source wheel SHA-256/size mismatch")
    license_text = Path(__file__).with_name("RapidOCR-LICENSE.txt").read_bytes()
    output.parent.mkdir(parents=True, exist_ok=True)
    parent = output.parent.resolve(strict=True)
    output = parent / output.name
    # Only our newly created sibling staging directory is ever cleaned up.
    with tempfile.TemporaryDirectory(prefix=".ocr-models-", dir=parent) as temporary:
        stage = Path(temporary)
        with ZipFile(io.BytesIO(payload)) as archive:
            for name, _digest in MODEL_FILES.values():
                entry = archive.getinfo(f"rapidocr_onnxruntime/models/{name}")
                if entry.file_size > 64 * 1024 * 1024:
                    raise ValueError(f"OCR model exceeds size limit: {name}")
                # Exact allowlisted member names: never extract arbitrary zip paths.
                (stage / name).write_bytes(archive.read(entry))
        resolve_ocr_models(stage)
        (stage / "MODEL-LICENSE.txt").write_bytes(license_text)
        # No overwrite even when another preparation process won the race.
        output.mkdir(exist_ok=False)
        try:
            for item in stage.iterdir():
                shutil.copyfile(item, output / item.name)
            resolve_ocr_models(output)
        except Exception:
            # output was created by this invocation, never a pre-existing directory.
            if output.parent == parent and output.name not in ("", ".", ".."):
                shutil.rmtree(output)
            raise
    return {"output": str(output), "wheel_sha256": WHEEL_SHA256,
            "models": {name: digest for name, digest in MODEL_FILES.values()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--wheel", help="Optional offline copy of the exact pinned wheel")
    args = parser.parse_args()
    try:
        print(json.dumps(prepare_models(args.output, args.wheel)))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
