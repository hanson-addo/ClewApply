"""Local signing keys and token factory for auth tests. No calls to Clerk."""

import json
import time
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

ISSUER = "https://clew-test.clerk.accounts.dev"
WEB_ORIGIN = "http://localhost:5173"


class SigningKey:
    def __init__(self, kid: str) -> None:
        self.kid = kid
        self.private = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def jwk(self) -> dict[str, Any]:
        jwk: dict[str, Any] = json.loads(RSAAlgorithm.to_jwk(self.private.public_key()))
        jwk.update(kid=self.kid, use="sig", alg="RS256")
        return jwk


def make_token(
    key: SigningKey,
    *,
    sub: str = "user_test_riley",
    email: str | None = "riley@example.test",
    iss: str = ISSUER,
    azp: str | None = WEB_ORIGIN,
    expires_in: int = 60,
    kid: str | None = None,
    **extra: Any,
) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": sub,
        "iss": iss,
        "iat": now,
        "nbf": now,
        "exp": now + expires_in,
        "sid": "sess_test",
        **extra,
    }
    if azp is not None:
        claims["azp"] = azp
    if email is not None:
        claims["email"] = email
    return jwt.encode(claims, key.private, algorithm="RS256", headers={"kid": kid or key.kid})
