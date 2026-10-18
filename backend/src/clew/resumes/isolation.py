"""Runs text extraction in a throwaway child process with memory and CPU limits.

A hostile PDF or Word file can make a parser loop or allocate without end, and a timeout in
the same process can't stop CPU-bound code. A child process can be killed outright.
"""

import asyncio
import logging
import multiprocessing
import resource
from collections.abc import Callable
from multiprocessing.connection import Connection
from typing import Any

from clew.resumes.text import ExtractError, ExtractionFailed

logger = logging.getLogger(__name__)

MEMORY_LIMIT_BYTES = 512 * 1024 * 1024
CPU_LIMIT_SECONDS = 20
WALL_LIMIT_SECONDS = 30

# "spawn" starts a fresh interpreter: no copy of the worker's event loop, threads or
# database connections ends up in the child.
_CONTEXT = multiprocessing.get_context("spawn")


def _child(conn: Connection, func: Callable[..., str], args: tuple[Any, ...]) -> None:
    resource.setrlimit(resource.RLIMIT_AS, (MEMORY_LIMIT_BYTES, MEMORY_LIMIT_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_LIMIT_SECONDS, CPU_LIMIT_SECONDS))
    try:
        conn.send(("ok", func(*args)))
    except ExtractionFailed as exc:
        conn.send(("failed", exc.code.value))
    except BaseException:  # MemoryError and anything else from a hostile file
        conn.send(("failed", ExtractError.EXTRACT_FAILED.value))
    finally:
        conn.close()


async def run_isolated(
    func: Callable[..., str], *args: Any, wall_seconds: float = WALL_LIMIT_SECONDS
) -> str:
    """`func(*args)` in a limited child process. Raises ExtractionFailed on any failure:
    the function's own code, or extract_failed for a crash, a limit or the wall-clock
    timeout (the child is then killed)."""
    receiver, sender = _CONTEXT.Pipe(duplex=False)
    process = _CONTEXT.Process(target=_child, args=(sender, func, args), daemon=True)
    process.start()
    sender.close()

    def wait() -> tuple[str, str] | None:
        if not receiver.poll(wall_seconds):
            return None
        try:
            message: tuple[str, str] = receiver.recv()
            return message
        except EOFError:
            # The child died without answering (killed by a CPU or memory limit).
            return None

    try:
        message = await asyncio.to_thread(wait)
    finally:
        if process.is_alive():
            process.kill()
        await asyncio.to_thread(process.join)
        receiver.close()

    if message is None:
        logger.warning("extract_killed", extra={"exitcode": process.exitcode})
        raise ExtractionFailed(ExtractError.EXTRACT_FAILED)
    kind, value = message
    if kind == "ok":
        return value
    raise ExtractionFailed(ExtractError(value))
