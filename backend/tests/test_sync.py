"""Sync Center (#130 step 2): fill records as fingerprints, and "N changes behind"."""

import io
import json
import zipfile
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clew.config import get_settings
from clew.models import SyncFill, User
from clew.sync.fingerprint import fingerprint, normalize
from clew.sync.sites import SITES
from tests.test_extension import as_user, bearer, connect, make_app, new_sub


@pytest.fixture
async def api() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=make_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


PROFILE: dict[str, Any] = {
    "basics": {
        "name": "Jordan Testperson",
        "label": "Thread Analyst",
        "summary": "I find the way out of mazes.",
        "location": {"city": "Austin", "region": "TX"},
    },
    "work": [
        {
            "name": "Labyrinth Logistics",
            "position": "Thread Analyst",
            "startDate": "2021-03",
        }
    ],
    "education": [{"institution": "Knossos College", "studyType": "BA", "area": "Geometry"}],
    "skills": [{"name": "Wayfinding"}, {"name": "Knots"}],
}
LINKEDIN_KEYS = [
    "headline",
    "about",
    "location",
    "work.0.title",
    "work.0.company",
    "work.0.dates",
    "education.0.school",
    "education.0.degree",
    "skills",
]


@pytest.fixture(autouse=True)
def fingerprint_key(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("CLEW_FILL_FINGERPRINT_KEY", "test-fingerprint-key")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def save(api: AsyncClient, sub: str, data: dict[str, Any]) -> int:
    response = await api.put("/profile", headers=as_user(sub), json={"data": data})
    assert response.status_code == 200, response.text
    number: int = response.json()["number"]
    return number


async def status_of(api: AsyncClient, sub: str, site: str) -> dict[str, Any]:
    response = await api.get("/sync/status", headers=as_user(sub))
    assert response.status_code == 200, response.text
    sites = {s["site"]: s for s in response.json()["sites"]}
    assert list(sites) == ["linkedin", "indeed", "usajobs"]
    result: dict[str, Any] = sites[site]
    return result


async def fill(
    api: AsyncClient, token: str, version: int, keys: list[str], site: str = "linkedin"
) -> Response:
    return await api.post(
        "/sync/fills",
        headers=bearer(token),
        json={"site": site, "profile_version": version, "field_keys": keys},
    )


def test_fingerprints_ignore_spacing_but_not_words() -> None:
    key = b"k"
    assert normalize("  Thread\u00a0 Analyst \n") == "Thread Analyst"
    assert fingerprint(key, "Thread  Analyst") == fingerprint(key, " Thread Analyst")
    assert fingerprint(key, "Thread Analyst") != fingerprint(key, "Thread Analyst II")
    assert fingerprint(b"other", "Thread Analyst") != fingerprint(key, "Thread Analyst")


def test_every_site_lists_fields_with_unique_keys() -> None:
    from clew.profile.schema import ProfileData

    profile = ProfileData.model_validate(PROFILE)
    for site in SITES.values():
        keys = [f.key for f in site.fields(profile)]
        assert len(keys) == len(set(keys)), site.id
        assert all(len(k) <= 64 for k in keys)
    # The school in PROFILE has no dates, so it has no value; the key is still listed.
    keys = [f.key for f in SITES["linkedin"].fields(profile)]
    assert keys == [*LINKEDIN_KEYS[:8], "education.0.dates", "skills"]


async def test_a_site_never_filled_is_not_set_up(api: AsyncClient) -> None:
    sub = new_sub()
    await save(api, sub, PROFILE)
    linkedin = await status_of(api, sub, "linkedin")
    assert linkedin["state"] == "not_set_up"
    assert linkedin["behind"] == []
    assert linkedin["last_filled_at"] is None
    assert linkedin["profile_url"] == "https://www.linkedin.com/in/me/"


async def test_filling_everything_is_up_to_date_then_an_edit_is_behind(api: AsyncClient) -> None:
    sub = new_sub()
    version = await save(api, sub, PROFILE)
    token = await connect(api, sub)
    assert (await fill(api, token, version, LINKEDIN_KEYS)).status_code == 204

    linkedin = await status_of(api, sub, "linkedin")
    assert linkedin["state"] == "up_to_date"
    assert linkedin["behind"] == []
    assert linkedin["last_filled_at"]
    # Other sites are untouched.
    assert (await status_of(api, sub, "indeed"))["state"] == "not_set_up"

    edited = json.loads(json.dumps(PROFILE))
    edited["basics"]["label"] = "Senior Thread Analyst"
    edited["skills"].append({"name": "Minotaur avoidance"})
    await save(api, sub, edited)
    linkedin = await status_of(api, sub, "linkedin")
    assert linkedin["state"] == "behind"
    assert linkedin["behind"] == [
        {"key": "headline", "label": "Headline"},
        {"key": "skills", "label": "Skills"},
    ]


async def test_a_spacing_only_edit_is_not_a_change(api: AsyncClient) -> None:
    sub = new_sub()
    version = await save(api, sub, PROFILE)
    token = await connect(api, sub)
    await fill(api, token, version, LINKEDIN_KEYS)
    edited = json.loads(json.dumps(PROFILE))
    edited["basics"]["label"] = "Thread  Analyst "
    await save(api, sub, edited)
    assert (await status_of(api, sub, "linkedin"))["state"] == "up_to_date"


async def test_unticked_and_new_fields_count_as_behind(api: AsyncClient) -> None:
    sub = new_sub()
    version = await save(api, sub, PROFILE)
    token = await connect(api, sub)
    await fill(api, token, version, ["headline"])
    behind = [f["key"] for f in (await status_of(api, sub, "linkedin"))["behind"]]
    assert behind == LINKEDIN_KEYS[1:]


async def test_empty_profile_fields_dont_count(api: AsyncClient) -> None:
    sub = new_sub()
    sparse = {"basics": {"label": "Thread Analyst"}}
    version = await save(api, sub, sparse)
    token = await connect(api, sub)
    await fill(api, token, version, ["headline"])
    assert (await status_of(api, sub, "linkedin"))["state"] == "up_to_date"


async def test_fill_records_hold_fingerprints_not_values(
    api: AsyncClient, db: AsyncSession
) -> None:
    sub = new_sub()
    version = await save(api, sub, PROFILE)
    token = await connect(api, sub)
    await fill(api, token, version, LINKEDIN_KEYS)
    user_id = await db.scalar(select(User.id).where(User.auth_provider_id == sub))
    rows = list(await db.scalars(select(SyncFill).where(SyncFill.user_id == user_id)))
    assert {r.field_key for r in rows} == set(LINKEDIN_KEYS)
    stored = json.dumps([[r.site, r.field_key, r.fingerprint] for r in rows])
    for value in ("Thread Analyst", "Labyrinth Logistics", "Austin", "Wayfinding"):
        assert value not in stored
    assert all(len(r.fingerprint) == 64 and r.profile_version == version for r in rows)


async def test_a_fill_record_is_checked(api: AsyncClient) -> None:
    sub = new_sub()
    version = await save(api, sub, PROFILE)
    token = await connect(api, sub)
    assert (await fill(api, token, version + 5, ["headline"])).status_code == 404
    assert (await fill(api, token, version, ["work.7.title"])).status_code == 422
    assert (await fill(api, token, version, ["headline"], site="monster")).status_code == 422
    assert (await fill(api, token, version, [])).status_code == 422
    # USAJobs has no headline field.
    assert (await fill(api, token, version, ["headline"], site="usajobs")).status_code == 422


async def test_only_the_extension_records_fills(api: AsyncClient) -> None:
    sub = new_sub()
    version = await save(api, sub, PROFILE)
    body = {"site": "linkedin", "profile_version": version, "field_keys": ["headline"]}
    assert (await api.post("/sync/fills", headers=as_user(sub), json=body)).status_code == 401
    assert (await api.post("/sync/fills", json=body)).status_code == 401


async def test_one_users_fills_dont_affect_another(api: AsyncClient) -> None:
    alice, bob = new_sub(), new_sub()
    alice_version = await save(api, alice, PROFILE)
    await save(api, bob, PROFILE)
    token = await connect(api, alice)
    await fill(api, token, alice_version, LINKEDIN_KEYS)
    assert (await status_of(api, bob, "linkedin"))["state"] == "not_set_up"


async def test_status_needs_the_key(api: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_FILL_FINGERPRINT_KEY", "")
    get_settings.cache_clear()
    assert (await api.get("/sync/status", headers=as_user(new_sub()))).status_code == 503


async def test_export_lists_fills_without_fingerprints(api: AsyncClient) -> None:
    sub = new_sub()
    version = await save(api, sub, PROFILE)
    token = await connect(api, sub)
    await fill(api, token, version, ["headline"])
    response = await api.post("/me/export", headers=as_user(sub))
    data = json.loads(zipfile.ZipFile(io.BytesIO(response.content)).read("data.json"))
    [record] = data["sync_fills"]
    assert record["site"] == "linkedin" and record["field_key"] == "headline"
    assert "fingerprint" not in record
