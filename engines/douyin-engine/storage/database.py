"""Small async SQLite store used by the Douyin CLI and downloader."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Dict, Optional

import aiosqlite


class Database:
    def __init__(self, db_path: str = "dy_downloader.db"):
        self.db_path = str(db_path)
        self._conn: Optional[aiosqlite.Connection] = None
        self._conn_lock = asyncio.Lock()

    async def _get_conn(self) -> aiosqlite.Connection:
        async with self._conn_lock:
            if self._conn is None:
                Path(self.db_path).expanduser().parent.mkdir(parents=True, exist_ok=True)
                self._conn = await aiosqlite.connect(self.db_path)
                self._conn.row_factory = aiosqlite.Row
            return self._conn

    async def initialize(self) -> None:
        conn = await self._get_conn()
        await conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS awemes (
                aweme_id TEXT PRIMARY KEY,
                aweme_type TEXT,
                title TEXT,
                author_id TEXT,
                author_name TEXT,
                create_time INTEGER,
                file_path TEXT,
                metadata TEXT,
                downloaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_awemes_author_time
                ON awemes(author_id, create_time);

            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL,
                url_type TEXT,
                total_count INTEGER NOT NULL DEFAULT 0,
                success_count INTEGER NOT NULL DEFAULT 0,
                config TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS transcript_jobs (
                aweme_id TEXT PRIMARY KEY,
                video_path TEXT NOT NULL,
                transcript_dir TEXT NOT NULL,
                text_path TEXT NOT NULL,
                json_path TEXT NOT NULL,
                model TEXT NOT NULL,
                status TEXT NOT NULL,
                skip_reason TEXT,
                error_message TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        await conn.commit()

    async def add_aweme(self, data: Dict[str, Any]) -> None:
        conn = await self._get_conn()
        await conn.execute(
            """
            INSERT INTO awemes
              (aweme_id, aweme_type, title, author_id, author_name,
               create_time, file_path, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(aweme_id) DO UPDATE SET
              aweme_type=excluded.aweme_type,
              title=excluded.title,
              author_id=excluded.author_id,
              author_name=excluded.author_name,
              create_time=excluded.create_time,
              file_path=excluded.file_path,
              metadata=excluded.metadata,
              downloaded_at=CURRENT_TIMESTAMP
            """,
            (
                str(data.get("aweme_id", "")),
                data.get("aweme_type"),
                data.get("title"),
                data.get("author_id"),
                data.get("author_name"),
                data.get("create_time"),
                data.get("file_path"),
                data.get("metadata"),
            ),
        )
        await conn.commit()

    async def is_downloaded(self, aweme_id: str) -> bool:
        conn = await self._get_conn()
        async with conn.execute(
            "SELECT 1 FROM awemes WHERE aweme_id = ? LIMIT 1", (str(aweme_id),)
        ) as cursor:
            return await cursor.fetchone() is not None

    async def get_aweme_count_by_author(self, author_id: str) -> int:
        conn = await self._get_conn()
        async with conn.execute(
            "SELECT COUNT(*) AS count FROM awemes WHERE author_id = ?", (author_id,)
        ) as cursor:
            row = await cursor.fetchone()
        return int(row["count"] if row else 0)

    async def get_latest_aweme_time(self, author_id: str) -> Optional[int]:
        conn = await self._get_conn()
        async with conn.execute(
            "SELECT MAX(create_time) AS latest FROM awemes WHERE author_id = ?",
            (author_id,),
        ) as cursor:
            row = await cursor.fetchone()
        if not row or row["latest"] is None:
            return None
        return int(row["latest"])

    async def add_history(self, data: Dict[str, Any]) -> None:
        conn = await self._get_conn()
        await conn.execute(
            """
            INSERT INTO history (url, url_type, total_count, success_count, config)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                data.get("url", ""),
                data.get("url_type"),
                int(data.get("total_count", 0) or 0),
                int(data.get("success_count", 0) or 0),
                data.get("config"),
            ),
        )
        await conn.commit()

    async def upsert_transcript_job(self, data: Dict[str, Any]) -> None:
        conn = await self._get_conn()
        await conn.execute(
            """
            INSERT INTO transcript_jobs
              (aweme_id, video_path, transcript_dir, text_path, json_path,
               model, status, skip_reason, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(aweme_id) DO UPDATE SET
              video_path=excluded.video_path,
              transcript_dir=excluded.transcript_dir,
              text_path=excluded.text_path,
              json_path=excluded.json_path,
              model=excluded.model,
              status=excluded.status,
              skip_reason=excluded.skip_reason,
              error_message=excluded.error_message,
              updated_at=CURRENT_TIMESTAMP
            """,
            (
                str(data.get("aweme_id", "")),
                data.get("video_path", ""),
                data.get("transcript_dir", ""),
                data.get("text_path", ""),
                data.get("json_path", ""),
                data.get("model", ""),
                data.get("status", ""),
                data.get("skip_reason"),
                data.get("error_message"),
            ),
        )
        await conn.commit()

    async def get_transcript_job(self, aweme_id: str) -> Optional[Dict[str, Any]]:
        conn = await self._get_conn()
        async with conn.execute(
            "SELECT * FROM transcript_jobs WHERE aweme_id = ?", (str(aweme_id),)
        ) as cursor:
            row = await cursor.fetchone()
        return dict(row) if row is not None else None

    async def close(self) -> None:
        async with self._conn_lock:
            if self._conn is not None:
                await self._conn.close()
                self._conn = None
