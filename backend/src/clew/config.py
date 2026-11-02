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
    # The API connects as the app role (clew_app), which can't bypass row-level security.
    database_url: str
    # Migrations run as the role that owns the tables. Falls back to database_url.
    migrations_database_url: str | None = None
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
    # ClamAV daemon (clamd) that scans every upload. Without it, uploads answer 503.
    clamav_host: str | None = None
    clamav_port: int = 3310
    clamav_timeout_seconds: float = 30.0
    # Redis for background jobs (resume parsing). Without it, parsing reports "unavailable".
    redis_url: str | None = None
    # LLM that turns resume text into a profile. Without a key, parsing reports "unavailable".
    anthropic_api_key: SecretStr | None = None
    # The parser forces one tool call (tool_choice). A model set here must support forced tool
    # use, or every parse fails as parse_failed with a 400 from the API.
    parser_model: str = "claude-haiku-5-5"
    parser_timeout_seconds: float = 60.0

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

    @field_validator(
        "migrations_database_url",
        "s3_bucket",
        "s3_endpoint_url",
        "s3_access_key_id",
        "clamav_host",
        "redis_url",
    )
    @classmethod
    def blank_is_unset(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("anthropic_api_key", mode="before")
    @classmethod
    def blank_secret_is_unset(cls, value: object) -> object:
        return None if value == "" else value

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
