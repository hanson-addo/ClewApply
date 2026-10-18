"""Virus scanning for uploads through ClamAV's clamd daemon (threat model R7).

Talks clamd's INSTREAM protocol directly over TCP: the file is sent in length-prefixed
chunks and clamd answers "stream: OK" or "stream: <signature> FOUND".
"""

import asyncio
import logging
from enum import StrEnum
from functools import lru_cache
from typing import Protocol

from clew.config import get_settings

logger = logging.getLogger(__name__)

CHUNK_BYTES = 64 * 1024


class ScanVerdict(StrEnum):
    CLEAN = "clean"
    INFECTED = "infected"


class ScannerUnavailable(Exception):
    """The scanner couldn't be reached or didn't give a clear answer."""


class MalwareScanner(Protocol):
    async def scan(self, data: bytes) -> ScanVerdict: ...


class ClamdScanner:
    def __init__(self, host: str, port: int, timeout: float) -> None:
        self._host = host
        self._port = port
        self._timeout = timeout

    async def scan(self, data: bytes) -> ScanVerdict:
        try:
            reply = await asyncio.wait_for(self._instream(data), self._timeout)
        except (OSError, TimeoutError, asyncio.IncompleteReadError) as exc:
            logger.error("scan_unavailable", extra={"error": type(exc).__name__})
            raise ScannerUnavailable from exc
        if reply == "stream: OK":
            return ScanVerdict.CLEAN
        if reply.endswith(" FOUND"):
            # Only the signature name is logged, never anything from the file.
            logger.warning("scan_infected", extra={"signature": reply[len("stream: ") : -6]})
            return ScanVerdict.INFECTED
        # "INSTREAM size limit exceeded", "... ERROR" and anything unexpected fail closed.
        logger.error("scan_unclear_reply")
        raise ScannerUnavailable

    async def _instream(self, data: bytes) -> str:
        reader, writer = await asyncio.open_connection(self._host, self._port)
        try:
            writer.write(b"zINSTREAM\0")
            for start in range(0, len(data), CHUNK_BYTES):
                chunk = data[start : start + CHUNK_BYTES]
                writer.write(len(chunk).to_bytes(4, "big") + chunk)
                await writer.drain()
            writer.write((0).to_bytes(4, "big"))
            await writer.drain()
            reply = await reader.readuntil(b"\0")
        finally:
            writer.close()
            await writer.wait_closed()
        return reply.rstrip(b"\0").decode("utf-8", "replace").strip()


@lru_cache
def get_malware_scanner() -> MalwareScanner | None:
    settings = get_settings()
    if settings.clamav_host is None:
        return None
    return ClamdScanner(settings.clamav_host, settings.clamav_port, settings.clamav_timeout_seconds)
