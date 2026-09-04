"""Filesystem and atomic HTTP download helpers for the Douyin engine."""

from __future__ import annotations

import logging
import mimetypes
from pathlib import Path
from typing import Optional

from utils.validators import sanitize_filename

logger = logging.getLogger("FileManager")


class FileManager:
    def __init__(self, base_path: Optional[str] = None):
        self.base_path = Path(base_path or "./Downloaded/").expanduser()
        self.base_path.mkdir(parents=True, exist_ok=True)

    def file_exists(self, path: Path | str) -> bool:
        candidate = Path(path)
        try:
            return candidate.is_file() and candidate.stat().st_size > 0
        except OSError:
            return False

    def get_file_size(self, path: Path | str) -> int:
        try:
            candidate = Path(path)
            return candidate.stat().st_size if candidate.is_file() else 0
        except OSError:
            return 0

    def get_save_path(
        self,
        author_name: str,
        mode: Optional[str] = None,
        aweme_title: Optional[str] = None,
        aweme_id: Optional[str] = None,
        folderstyle: bool = True,
        download_date: Optional[str] = None,
    ) -> Path:
        if not folderstyle:
            self.base_path.mkdir(parents=True, exist_ok=True)
            return self.base_path

        author = sanitize_filename(str(author_name or "unknown"))
        mode_name = sanitize_filename(str(mode or "post"))
        parts = [str(download_date or ""), str(aweme_title or ""), str(aweme_id or "")]
        folder_name = sanitize_filename("_".join(part for part in parts if part))
        path = self.base_path / author / mode_name / folder_name
        path.mkdir(parents=True, exist_ok=True)
        return path

    async def download_file(
        self,
        url: str,
        save_path: Path | str,
        session,
        headers: Optional[dict[str, str]] = None,
        proxy: Optional[str] = None,
        prefer_response_content_type: bool = False,
        return_saved_path: bool = False,
    ) -> bool | Path:
        target = Path(save_path)
        temporary = target.with_suffix(target.suffix + ".tmp")
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary.unlink(missing_ok=True)

        request_kwargs = {}
        if headers:
            request_kwargs["headers"] = headers
        if proxy:
            request_kwargs["proxy"] = proxy

        try:
            async with session.get(url, **request_kwargs) as response:
                if response.status < 200 or response.status >= 300:
                    return False

                actual_target = target
                if prefer_response_content_type:
                    content_type = (response.headers.get("Content-Type", "") or "").split(";", 1)[0].lower()
                    extension = mimetypes.guess_extension(content_type) if content_type else None
                    if extension in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".m4a", ".mp3"}:
                        actual_target = target.with_suffix(extension)
                        temporary = actual_target.with_suffix(actual_target.suffix + ".tmp")
                        temporary.unlink(missing_ok=True)

                written = 0
                async with await _open_async_file(temporary, "wb") as output:
                    async for chunk in response.content.iter_chunked(1024 * 1024):
                        if not chunk:
                            continue
                        await output.write(chunk)
                        written += len(chunk)

                expected = getattr(response, "content_length", None)
                if expected is not None and int(expected) != written:
                    return False
                if written <= 0:
                    return False
                temporary.replace(actual_target)
                if actual_target != target:
                    target.unlink(missing_ok=True)
                return actual_target if return_saved_path else True
        except Exception as exc:
            logger.warning("Download failed for %s: %s", url, exc)
            return False
        finally:
            temporary.unlink(missing_ok=True)


class _AsyncFile:
    def __init__(self, handle):
        self.handle = handle

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        self.handle.close()

    async def write(self, data: bytes):
        self.handle.write(data)


async def _open_async_file(path: Path, mode: str) -> _AsyncFile:
    return _AsyncFile(path.open(mode))
