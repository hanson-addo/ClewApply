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
            "id": "job1",
            "name": "Labyrinth Logistics",
            "position": "Thread Analyst",
            "startDate": "2021-03",
        }
    ],
    "education": [
        {"id": "sch1", "institution": "Knossos College", "studyType": "BA", "area": "Geometry"}
    ],
    "skills": [{"name": "Wayfinding"}, {"name": "Knots"}],
}
LINKEDIN_KEYS = [
    "headline",
    "about",
    "location",
    "work.job1.title",
    "work.job1.company",
    "work.job1.dates",
    "education.sch1.school",
    "education.sch1.degree",
    "education.sch1.field",
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
    assert keys == [*LINKEDIN_KEYS, "education.sch1.dates"]
    # Indeed: job descriptions, the degree split from the field of study, and no skills.
    indeed = [f.key for f in SITES["indeed"].fields(profile)]
    assert indeed == [
        "headline",
        "summary",
        "location",
        "work.job1.title",
        "work.job1.company",
        "work.job1.dates",
        "work.job1.duties",
        "education.sch1.school",
        "education.sch1.degree",
        "education.sch1.field",
        "education.sch1.dates",
    ]


def test_a_version_saved_before_entry_ids_falls_back_to_positions() -> None:
    from clew.profile.schema import ProfileData

    old = json.loads(json.dumps(PROFILE))
    del old["work"][0]["id"]
    keys = [f.key for f in SITES["linkedin"].fields(ProfileData.model_validate(old))]
    assert "work.0.title" in keys
    assert "education.sch1.school" in keys


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
    edited["work"][0]["position"] = "Lead Thread Analyst"
    await save(api, sub, edited)
    linkedin = await status_of(api, sub, "linkedin")
    assert linkedin["state"] == "behind"
    assert linkedin["behind"] == [
        {"key": "headline", "label": "Headline"},
        {"key": "work.job1.title", "label": "Job 1: title"},
    ]


async def test_adding_a_job_at_the_top_marks_only_the_new_job_behind(api: AsyncClient) -> None:
    sub = new_sub()
    version = await save(api, sub, PROFILE)
    token = await connect(api, sub)
    await fill(api, token, version, LINKEDIN_KEYS)
    edited = json.loads(json.dumps(PROFILE))
    edited["work"].insert(0, {"name": "Ariadne Yarns", "position": "Spinner"})
    await save(api, sub, edited)
    behind = (await status_of(api, sub, "linkedin"))["behind"]
    assert [f["label"] for f in behind] == ["Job 1: title", "Job 1: company"]
    assert not any(f["key"].startswith("work.job1.") for f in behind)


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
    assert (await fill(api, token, version, ["work.job7.title"])).status_code == 422
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
    token = await connect(api, new_sub())
    assert (await api.get("/sync/fields/linkedin", headers=bearer(token))).status_code == 503


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


async def test_saving_gives_jobs_and_schools_their_own_ids(api: AsyncClient) -> None:
    sub = new_sub()
    data = {
        "work": [{"name": "Ariadne Yarns"}, {"id": "keepme", "name": "Labyrinth Logistics"}],
        # A copied entry brings its id along; the copy gets a new one.
        "education": [{"id": "keepme", "institution": "Knossos College"}],
    }
    response = await api.put("/profile", headers=as_user(sub), json={"data": data})
    saved = response.json()["data"]
    ids = [e["id"] for e in [*saved["work"], *saved["education"]]]
    assert ids[1] == "keepme"
    assert len(set(ids)) == 3
    assert all(len(i) == 8 for i in (ids[0], ids[2]))
    # Saving what came back changes nothing, so no new version.
    again = await api.put("/profile", headers=as_user(sub), json={"data": saved})
    assert again.json()["number"] == response.json()["number"]


@pytest.mark.parametrize("bad", ["", "UPPER", "has space", "x" * 17])
async def test_an_entry_id_must_be_short_lowercase_letters_and_digits(
    api: AsyncClient, bad: str
) -> None:
    data = {"work": [{"id": bad, "name": "Ariadne Yarns"}]}
    response = await api.put("/profile", headers=as_user(new_sub()), json={"data": data})
    assert response.status_code == 422


async def site_fields(api: AsyncClient, token: str, site: str = "linkedin") -> dict[str, Any]:
    response = await api.get(f"/sync/fields/{site}", headers=bearer(token))
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


async def test_the_extension_reads_a_sites_values_and_what_is_behind(api: AsyncClient) -> None:
    sub = new_sub()
    version = await save(api, sub, PROFILE)
    token = await connect(api, sub)
    await fill(api, token, version, ["headline"])

    fields = await site_fields(api, token)
    assert fields["site"] == "linkedin"
    assert fields["profile_version"] == version
    by_key = {f["key"]: f for f in fields["fields"]}
    # Empty fields (the school's dates) are left out.
    assert list(by_key) == LINKEDIN_KEYS
    assert by_key["headline"] == {
        "key": "headline",
        "label": "Headline",
        "value": "Thread Analyst",
        "behind": False,
    }
    assert by_key["location"]["value"] == "Austin, TX"
    assert by_key["work.job1.dates"]["value"] == "2021-03 to present"
    assert by_key["education.sch1.degree"]["value"] == "BA"
    assert by_key["education.sch1.field"]["value"] == "Geometry"
    assert all(f["behind"] for k, f in by_key.items() if k != "headline")


async def test_reading_fields_before_any_profile_is_saved(api: AsyncClient) -> None:
    token = await connect(api, new_sub())
    assert await site_fields(api, token, "usajobs") == {
        "site": "usajobs",
        "profile_version": None,
        "fields": [],
    }


async def test_reading_fields_is_checked(api: AsyncClient) -> None:
    sub = new_sub()
    await save(api, sub, PROFILE)
    token = await connect(api, sub)
    assert (await api.get("/sync/fields/monster", headers=bearer(token))).status_code == 422
    assert (await api.get("/sync/fields/linkedin")).status_code == 401
    # A Clerk session can't read them; only the extension can.
    assert (await api.get("/sync/fields/linkedin", headers=as_user(sub))).status_code == 401


async def test_an_entry_sent_without_its_id_keeps_the_id_of_the_same_entry(
    api: AsyncClient,
) -> None:
    sub = new_sub()
    jobs = [{"name": "Ariadne Yarns"}, {"name": "Labyrinth Logistics"}]
    first = (await api.put("/profile", headers=as_user(sub), json={"data": {"work": jobs}})).json()
    ids = {job["name"]: job["id"] for job in first["data"]["work"]}
    # The same jobs, reordered and without ids: each keeps its own id.
    swapped = {"work": [jobs[1], jobs[0]]}
    second = (await api.put("/profile", headers=as_user(sub), json={"data": swapped})).json()
    assert {job["name"]: job["id"] for job in second["data"]["work"]} == ids
