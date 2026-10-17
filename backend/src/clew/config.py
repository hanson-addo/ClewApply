"""App settings, read from environment variables (see backend/.env.example).

Settings fail closed: a deploy that forgets CLEW_ENV runs as production, and a
missing CLEW_DATABASE_URL stops startup instead of falling back to defaults.
"""

from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CLEW_", env_file=".env", extra="ignore")

    env: Literal["local", "test", "production"] = "production"
    database_url: str
    cors_origins: list[str] = []
    # Clerk instance URL, e.g. https://example-name-12.clerk.accounts.dev. Session tokens must
    # carry it as "iss", and its public keys are fetched from <issuer>/.well-known/jwks.json.
    # Required in production; without it, local/test runs answer signed-in routes with 503.
    clerk_issuer: str | None = None
    # S3-compatible object storage for resume files (MinIO locally, see docker-compose.yml).
    # Without a bucket, the resume routes answer 503. Leave the endpoint unset for AWS S3.
    s3_bucket: str | None = None
    s3_endpoint_url: str | None = None
    s3_region: str = "us-east-1"
    s3_access_key_id: str | None = None
    s3_secret_access_key: SecretStr | None = None

    @field_validator("cors_origins")
    @classmethod
    def reject_wildcard_origin(cls, origins: list[str]) -> list[str]:
        # With credentials allowed, "*" would let any website make signed-in requests.
        if "*" in origins:
            raise ValueError('"*" is not allowed in CLEW_CORS_ORIGINS; list each origin')
        return origins

    @field_validator("clerk_issuer")
    @classmethod
    def issuer_must_be_https(cls, issuer: str | None) -> str | None:
        if issuer is None or issuer == "":
            return None
        if not issuer.startswith("https://"):
            raise ValueError("CLEW_CLERK_ISSUER must be an https:// URL")
        return issuer.rstrip("/")

    @field_validator("s3_bucket", "s3_endpoint_url", "s3_access_key_id")
    @classmethod
    def blank_is_unset(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def production_needs_sign_in(self) -> "Settings":
        if self.env == "production" and self.clerk_issuer is None:
            raise ValueError("CLEW_CLERK_ISSUER is required in production")
        if self.env == "production" and not self.cors_origins:
            raise ValueError("CLEW_CORS_ORIGINS is required in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
