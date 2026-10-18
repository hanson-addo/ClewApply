import pytest
from pydantic import ValidationError

from clew.config import Settings

DB_URL = "postgresql+asyncpg://user:pass@localhost:5432/db"
ISSUER = "https://clew-test.clerk.accounts.dev"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("CLEW_ENV", "CLEW_DATABASE_URL", "CLEW_CORS_ORIGINS", "CLEW_CLERK_ISSUER"):
        monkeypatch.delenv(name, raising=False)


def production_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_DATABASE_URL", DB_URL)
    monkeypatch.setenv("CLEW_CLERK_ISSUER", ISSUER)
    monkeypatch.setenv("CLEW_CORS_ORIGINS", '["https://clewapply.com"]')


def test_env_defaults_to_production(monkeypatch: pytest.MonkeyPatch) -> None:
    production_env(monkeypatch)
    assert Settings(_env_file=None).env == "production"


def test_missing_database_url_fails_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_ENV", "test")
    with pytest.raises(ValidationError, match="database_url"):
        Settings(_env_file=None)


def test_production_requires_clerk_issuer(monkeypatch: pytest.MonkeyPatch) -> None:
    production_env(monkeypatch)
    monkeypatch.delenv("CLEW_CLERK_ISSUER")
    with pytest.raises(ValidationError, match="CLEW_CLERK_ISSUER is required"):
        Settings(_env_file=None)


def test_production_requires_cors_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    production_env(monkeypatch)
    monkeypatch.delenv("CLEW_CORS_ORIGINS")
    with pytest.raises(ValidationError, match="CLEW_CORS_ORIGINS is required"):
        Settings(_env_file=None)


def test_clerk_issuer_must_be_https(monkeypatch: pytest.MonkeyPatch) -> None:
    production_env(monkeypatch)
    monkeypatch.setenv("CLEW_CLERK_ISSUER", "http://clew-test.clerk.accounts.dev")
    with pytest.raises(ValidationError, match="https"):
        Settings(_env_file=None)


def test_clerk_issuer_trailing_slash_is_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    production_env(monkeypatch)
    monkeypatch.setenv("CLEW_CLERK_ISSUER", ISSUER + "/")
    assert Settings(_env_file=None).clerk_issuer == ISSUER


def test_local_runs_without_clerk(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_ENV", "local")
    monkeypatch.setenv("CLEW_DATABASE_URL", DB_URL)
    assert Settings(_env_file=None).clerk_issuer is None


def test_wildcard_cors_origin_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    production_env(monkeypatch)
    monkeypatch.setenv("CLEW_CORS_ORIGINS", '["https://clewapply.com", "*"]')
    with pytest.raises(ValidationError, match="not allowed"):
        Settings(_env_file=None)


def test_listed_cors_origins_are_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    production_env(monkeypatch)
    settings = Settings(_env_file=None)
    assert settings.cors_origins == ["https://clewapply.com"]


def test_blank_anthropic_key_is_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_ANTHROPIC_API_KEY", "")
    assert Settings(env="test", database_url="postgresql+asyncpg://x/y").anthropic_api_key is None
