"""Keyed fingerprints of filled values, so a fill record never holds profile content."""

import hashlib
import hmac
import unicodedata


def normalize(value: str) -> str:
    """Same text, same fingerprint: Unicode NFC, whitespace runs collapsed, ends trimmed."""
    return " ".join(unicodedata.normalize("NFC", value).split())


def fingerprint(key: bytes, value: str) -> str:
    return hmac.new(key, normalize(value).encode(), hashlib.sha256).hexdigest()
