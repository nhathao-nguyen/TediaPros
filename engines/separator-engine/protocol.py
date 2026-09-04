import json
import sys

PROTOCOL = "separator-engine/1"
ENGINE = "mdx-onnx"
VERSION = "1.0.0"

class EngineError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable

def emit_event(payload: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()
