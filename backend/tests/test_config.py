import pytest
from pydantic import ValidationError

from clew.config import Settings

DB_URL = "postgresql+asyncpg://user:pass@localhost:5432/db"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("CLEW_ENV", "CLEW_DATABASE_URL", "CLEW_CORS_ORIGINS"):
        monkeypatch.delenv(name, raising=False)


def test_env_defaults_to_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_DATABASE_URL", DB_URL)
    assert Settings(_env_file=None).env == "production"


def test_missing_database_url_fails_startup() -> None:
    with pytest.raises(ValidationError, match="database_url"):
        Settings(_env_file=None)


def test_wildcard_cors_origin_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_DATABASE_URL", DB_URL)
    monkeypatch.setenv("CLEW_CORS_ORIGINS", '["https://clewapply.com", "*"]')
    with pytest.raises(ValidationError, match="not allowed"):
        Settings(_env_file=None)


def test_listed_cors_origins_are_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_DATABASE_URL", DB_URL)
    monkeypatch.setenv("CLEW_CORS_ORIGINS", '["https://clewapply.com"]')
    settings = Settings(_env_file=None)
    assert settings.cors_origins == ["https://clewapply.com"]
