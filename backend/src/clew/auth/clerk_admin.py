"""Deleting a user's Clerk account (sign-in details, sessions) when they delete their Clew one.

Uses Clerk's Backend API with the secret key. Only Clerk's own API host is ever called, and
the only thing sent is the Clerk user id. Logs never include the id, the key or the response.
"""

import logging
from typing import Protocol
from urllib.parse import quote

import httpx
from pydantic import SecretStr

from clew.config import get_settings

logger = logging.getLogger(__name__)

CLERK_API = "https://api.clerk.com/v1"


class ClerkAdmin(Protocol):
    async def delete_user(self, clerk_user_id: str) -> bool: ...


class ClerkBackendApi:
    def __init__(
        self,
        secret_key: SecretStr,
        timeout: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._secret_key = secret_key
        self._timeout = timeout
        self._transport = transport

    async def delete_user(self, clerk_user_id: str) -> bool:
        """True once Clerk no longer has the user (deleted now, or already gone)."""
        url = f"{CLERK_API}/users/{quote(clerk_user_id, safe='')}"
        headers = {"Authorization": f"Bearer {self._secret_key.get_secret_value()}"}
        try:
            async with httpx.AsyncClient(
                timeout=self._timeout, transport=self._transport
            ) as client:
                response = await client.delete(url, headers=headers)
        except httpx.HTTPError as error:
            logger.error("clerk_user_delete_failed", extra={"error": type(error).__name__})
            return False
        if response.status_code in (200, 404):
            return True
        logger.error("clerk_user_delete_failed", extra={"status": response.status_code})
        return False


class NoClerkAdmin:
    """Local runs without a secret key: Clew's data is deleted, the Clerk user is kept."""

    async def delete_user(self, clerk_user_id: str) -> bool:
        logger.warning("clerk_user_kept", extra={"reason": "no CLEW_CLERK_SECRET_KEY"})
        return False


def get_clerk_admin() -> ClerkAdmin:
    key = get_settings().clerk_secret_key
    if key is None or not key.get_secret_value():
        return NoClerkAdmin()
    return ClerkBackendApi(key)
