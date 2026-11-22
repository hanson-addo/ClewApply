import pytest
from pydantic import ValidationError

from clew.config import LOCAL_FINGERPRINT_KEY, Settings

DB_URL = "postgresql+asyncpg://user:pass@localhost:5432/db"
ISSUER = "https://clew-test.clerk.accounts.dev"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "CLEW_ENV",
        "CLEW_DATABASE_URL",
        "CLEW_CORS_ORIGINS",
        "CLEW_CLERK_ISSUER",
        "CLEW_CLERK_SECRET_KEY",
        "CLEW_FILL_FINGERPRINT_KEY",
    ):
        monkeypatch.delenv(name, raising=False)


def production_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_DATABASE_URL", DB_URL)
    monkeypatch.setenv("CLEW_CLERK_ISSUER", ISSUER)
    monkeypatch.setenv("CLEW_CORS_ORIGINS", '["https://clewapply.com"]')
    monkeypatch.setenv("CLEW_CLERK_SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("CLEW_FILL_FINGERPRINT_KEY", "test-fingerprint-key")


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


@pytest.mark.parametrize("value", [None, ""], ids=["unset", "blank"])
def test_production_requires_clerk_secret_key(
    monkeypatch: pytest.MonkeyPatch, value: str | None
) -> None:
    production_env(monkeypatch)
    if value is None:
        monkeypatch.delenv("CLEW_CLERK_SECRET_KEY")
    else:
        monkeypatch.setenv("CLEW_CLERK_SECRET_KEY", value)
    with pytest.raises(ValidationError, match="CLEW_CLERK_SECRET_KEY is required"):
        Settings(_env_file=None)


def test_blank_clerk_secret_key_is_unset_locally(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_ENV", "local")
    monkeypatch.setenv("CLEW_DATABASE_URL", DB_URL)
    monkeypatch.setenv("CLEW_CLERK_SECRET_KEY", "")
    assert Settings(_env_file=None).clerk_secret_key is None


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


def test_production_requires_a_fill_fingerprint_key(monkeypatch: pytest.MonkeyPatch) -> None:
    production_env(monkeypatch)
    monkeypatch.setenv("CLEW_FILL_FINGERPRINT_KEY", "")
    with pytest.raises(ValidationError, match="CLEW_FILL_FINGERPRINT_KEY is required"):
        Settings(_env_file=None)


def test_local_runs_get_a_fixed_fingerprint_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_ENV", "local")
    monkeypatch.setenv("CLEW_DATABASE_URL", DB_URL)
    monkeypatch.setenv("CLEW_FILL_FINGERPRINT_KEY", "")
    settings = Settings(_env_file=None)
    assert settings.fill_fingerprint_key is not None
    assert settings.fill_fingerprint_key.get_secret_value() == LOCAL_FINGERPRINT_KEY
    # Your own key wins.
    monkeypatch.setenv("CLEW_FILL_FINGERPRINT_KEY", "my-own-key")
    own = Settings(_env_file=None)
    assert own.fill_fingerprint_key is not None
    assert own.fill_fingerprint_key.get_secret_value() == "my-own-key"
