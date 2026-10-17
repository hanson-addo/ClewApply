"""App settings, read from environment variables (see backend/.env.example).

Settings fail closed: a deploy that forgets CLEW_ENV runs as production, and a
missing CLEW_DATABASE_URL stops startup instead of falling back to defaults.
"""

from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CLEW_", env_file=".env", extra="ignore")

    env: Literal["local", "test", "production"] = "production"
    database_url: str
    cors_origins: list[str] = []

    @field_validator("cors_origins")
    @classmethod
    def reject_wildcard_origin(cls, origins: list[str]) -> list[str]:
        # With credentials allowed, "*" would let any website make signed-in requests.
        if "*" in origins:
            raise ValueError('"*" is not allowed in CLEW_CORS_ORIGINS; list each origin')
        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()
