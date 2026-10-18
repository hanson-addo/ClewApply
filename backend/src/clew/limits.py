"""Caps request bodies before they are parsed, so an oversized upload is never spooled to disk."""

import json

from fastapi import HTTPException, status
from starlette.types import ASGIApp, Message, Receive, Scope, Send

TOO_LARGE = "Files must be 10 MB or smaller."


class BodySizeLimit:
    """Rejects bodies over `max_bytes` on paths under `path_prefix` with 413.

    A declared Content-Length over the limit is refused before reading anything. A body
    sent without one (chunked) is counted as it arrives and cut off at the limit.
    """

    def __init__(
        self, app: ASGIApp, *, path_prefix: str, max_bytes: int, message: str = TOO_LARGE
    ) -> None:
        self.app = app
        self.path_prefix = path_prefix
        self.max_bytes = max_bytes
        self.message = message

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(self.path_prefix):
            await self.app(scope, receive, send)
            return

        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > self.max_bytes):
            await _reject(send, self.message)
            return

        received = 0

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # Raised inside body parsing, FastAPI passes HTTPExceptions through as-is.
                    raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, self.message)
            return message

        await self.app(scope, counting_receive, send)


async def _reject(send: Send, message: str) -> None:
    body = json.dumps({"detail": message}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status.HTTP_413_CONTENT_TOO_LARGE,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"connection", b"close"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
