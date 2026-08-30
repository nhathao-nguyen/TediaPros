"""JSON metadata and download-manifest persistence."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger("MetadataHandler")


class MetadataHandler:
    async def save_metadata(self, data: Any, output_path: Path | str) -> bool:
        path = Path(output_path)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            return True
        except Exception as exc:
            logger.warning("Failed saving metadata to %s: %s", path, exc)
            return False

    async def append_download_manifest(
        self, base_path: Path | str, record: Dict[str, Any]
    ) -> bool:
        path = Path(base_path) / "download_manifest.jsonl"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as output:
                output.write(json.dumps(record, ensure_ascii=False) + "\n")
            return True
        except Exception as exc:
            logger.warning("Failed appending download manifest to %s: %s", path, exc)
            return False
