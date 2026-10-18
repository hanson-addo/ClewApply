"""Master profile with version history (#13). All people and details here are made up."""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clew.api.profile import MAX_PROFILE_BYTES, TOO_LARGE
from clew.auth.deps import get_token_verifier
from clew.db.session import bind_user
from clew.main import create_app
from clew.models import Profile, ProfileVersion, User
from tests.auth_helpers import SigningKey, make_token
from tests.test_auth import verifier

KEY = SigningKey("kid_profile")


@pytest.fixture
async def api() -> AsyncIterator[AsyncClient]:
    app = create_app()
    test_verifier = verifier(KEY)
    app.dependency_overrides[get_token_verifier] = lambda: test_verifier
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def alice() -> dict[str, str]:
    return as_user(f"user_profile_alice_{uuid.uuid4().hex[:8]}")


@pytest.fixture
def bob() -> dict[str, str]:
    return as_user(f"user_profile_bob_{uuid.uuid4().hex[:8]}")


def as_user(sub: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(KEY, sub=sub, email=f'{sub}@example.test')}"}


def profile(name: str = "Jordan Testperson", **sections: Any) -> dict[str, Any]:
    return {
        "basics": {
            "name": name,
            "label": "Data analyst",
            "email": "jordan@example.test",
            "url": "https://example.test/jordan",
            "location": {"city": "Springfield", "region": "IL", "countryCode": "US"},
        },
        "work": [
            {
                "name": "Example Corp",
                "position": "Analyst",
                "startDate": "2021-03",
                "highlights": ["Built a made-up dashboard"],
            }
        ],
        "skills": [{"name": "SQL", "keywords": ["Postgres"]}],
        **sections,
    }


async def save(
    api: AsyncClient, who: dict[str, str], data: dict[str, Any], **extra: Any
) -> dict[str, Any]:
    response = await api.put("/profile", headers=who, json={"data": data, **extra})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def user_id(who: dict[str, str], api: AsyncClient) -> uuid.UUID:
    me = await api.get("/me", headers=who)
    return uuid.UUID(me.json()["id"])


async def test_no_profile_yet(api: AsyncClient, alice: dict[str, str]) -> None:
    response = await api.get("/profile", headers=alice)
    assert response.status_code == 404
    assert (await api.get("/profile/versions", headers=alice)).json() == []


async def test_save_creates_a_version(api: AsyncClient, alice: dict[str, str]) -> None:
    saved = await save(api, alice, profile(), change_summary="First draft")
    assert saved["is_current"] is True
    assert saved["change_summary"] == "First draft"
    assert saved["data"]["basics"]["name"] == "Jordan Testperson"

    current = (await api.get("/profile", headers=alice)).json()
    assert current["id"] == saved["id"]
    assert current["data"] == saved["data"]


async def test_each_save_adds_a_version_and_old_ones_stay_unchanged(
    api: AsyncClient, alice: dict[str, str]
) -> None:
    first = await save(api, alice, profile(), change_summary="First draft")
    second = await save(api, alice, profile(name="Jordan Q. Testperson"), change_summary="Name")
    assert second["id"] != first["id"]

    old = (await api.get(f"/profile/versions/{first['id']}", headers=alice)).json()
    assert old["data"] == first["data"]
    assert old["data"]["basics"]["name"] == "Jordan Testperson"
    assert old["is_current"] is False

    listed = (await api.get("/profile/versions", headers=alice)).json()
    assert [v["id"] for v in listed] == [second["id"], first["id"]]
    assert [v["is_current"] for v in listed] == [True, False]
    assert "data" not in listed[0]

    current = (await api.get("/profile", headers=alice)).json()
    assert current["data"]["basics"]["name"] == "Jordan Q. Testperson"


async def test_saving_the_same_data_adds_no_version(
    api: AsyncClient, alice: dict[str, str]
) -> None:
    first = await save(api, alice, profile())
    again = await save(api, alice, profile())
    assert again["id"] == first["id"]
    assert len((await api.get("/profile/versions", headers=alice)).json()) == 1


async def test_list_limit(api: AsyncClient, alice: dict[str, str]) -> None:
    for n in range(3):
        await save(api, alice, profile(name=f"Jordan {n}"))
    listed = (await api.get("/profile/versions?limit=2", headers=alice)).json()
    assert len(listed) == 2
    assert (await api.get("/profile/versions?limit=101", headers=alice)).status_code == 422


async def test_stale_base_version_is_refused(api: AsyncClient, alice: dict[str, str]) -> None:
    first = await save(api, alice, profile())
    second = await save(api, alice, profile(name="Edited in tab one"), base_version_id=first["id"])

    response = await api.put(
        "/profile",
        headers=alice,
        json={"data": profile(name="Edited in tab two"), "base_version_id": first["id"]},
    )
    assert response.status_code == 409
    current = (await api.get("/profile", headers=alice)).json()
    assert current["id"] == second["id"]


async def test_racing_saves_from_the_same_base_keep_one(
    api: AsyncClient, alice: dict[str, str]
) -> None:
    base = await save(api, alice, profile())
    responses = await asyncio.gather(
        *(
            api.put(
                "/profile",
                headers=alice,
                json={"data": profile(name=f"Racer {n}"), "base_version_id": base["id"]},
            )
            for n in range(2)
        )
    )
    assert sorted(r.status_code for r in responses) == [200, 409]
    assert len((await api.get("/profile/versions", headers=alice)).json()) == 2


async def test_first_saves_racing_make_one_profile(
    api: AsyncClient, alice: dict[str, str], db: AsyncSession
) -> None:
    responses = await asyncio.gather(
        *(
            api.put("/profile", headers=alice, json={"data": profile(name=f"First {n}")})
            for n in range(3)
        )
    )
    assert [r.status_code for r in responses] == [200, 200, 200]
    uid = await user_id(alice, api)
    assert await db.scalar(select(func.count()).where(Profile.user_id == uid)) == 1
    assert len((await api.get("/profile/versions", headers=alice)).json()) == 3


async def test_another_user_cannot_read_your_profile(
    api: AsyncClient, alice: dict[str, str], bob: dict[str, str]
) -> None:
    saved = await save(api, alice, profile())
    assert (await api.get("/profile", headers=bob)).status_code == 404
    assert (await api.get(f"/profile/versions/{saved['id']}", headers=bob)).status_code == 404
    assert (await api.get("/profile/versions", headers=bob)).json() == []

    # Bob saving his own profile doesn't touch Alice's.
    await save(api, bob, profile(name="Robin Example"))
    mine = (await api.get("/profile", headers=alice)).json()
    assert mine["id"] == saved["id"]


async def test_another_users_version_cannot_be_used_as_base(
    api: AsyncClient, alice: dict[str, str], bob: dict[str, str]
) -> None:
    alices = await save(api, alice, profile())
    response = await api.put(
        "/profile", headers=bob, json={"data": profile(), "base_version_id": alices["id"]}
    )
    assert response.status_code == 409


async def test_unknown_version_is_404(api: AsyncClient, alice: dict[str, str]) -> None:
    response = await api.get(f"/profile/versions/{uuid.uuid4()}", headers=alice)
    assert response.status_code == 404


async def test_signed_out_is_401(api: AsyncClient) -> None:
    assert (await api.get("/profile")).status_code == 401
    assert (await api.put("/profile", json={"data": profile()})).status_code == 401
    assert (await api.get("/profile/versions")).status_code == 401


@pytest.mark.parametrize(
    "data",
    [
        # Sensitive answers never go in the profile (product rules).
        {"basics": {"workAuthorization": "yes"}},
        {"veteranStatus": "no"},
        # References hold other people's contact details.
        {"references": [{"name": "Someone Else", "reference": "Great"}]},
        {"basics": {"url": "javascript:alert(1)"}},
        {"basics": {"profiles": [{"url": "data:text/html,hi"}]}},
        {"work": [{"startDate": "March 2021"}]},
        {"work": [{"startDate": "2021-13"}]},
        {"basics": {"name": "x" * 201}},
        {"basics": {"email": "not-an-email"}},
        {"basics": {"location": {"countryCode": "usa"}}},
        {"skills": [{"name": "s"} for _ in range(101)]},
        {"work": "not a list"},
    ],
)
async def test_invalid_profiles_are_rejected(
    api: AsyncClient, alice: dict[str, str], data: dict[str, Any]
) -> None:
    response = await api.put("/profile", headers=alice, json={"data": data})
    assert response.status_code == 422
    assert (await api.get("/profile", headers=alice)).status_code == 404


async def test_empty_profile_can_be_saved(api: AsyncClient, alice: dict[str, str]) -> None:
    saved = await save(api, alice, {})
    assert saved["data"]["basics"]["name"] is None
    assert saved["data"]["work"] == []


async def test_change_summary_is_capped(api: AsyncClient, alice: dict[str, str]) -> None:
    response = await api.put(
        "/profile", headers=alice, json={"data": profile(), "change_summary": "x" * 201}
    )
    assert response.status_code == 422


async def test_oversized_profile_is_413(api: AsyncClient, alice: dict[str, str]) -> None:
    entry = {"summary": "x" * 5000}
    big = profile(work=[entry] * 50, volunteer=[entry] * 50)
    response = await api.put("/profile", headers=alice, json={"data": big})
    assert response.status_code == 413
    assert response.json() == {"detail": TOO_LARGE}
    assert len(response.request.content) > MAX_PROFILE_BYTES


async def test_profile_content_is_not_logged(
    api: AsyncClient, alice: dict[str, str], caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    await save(api, alice, profile(name="Unloggable Testname"))
    await api.get("/profile", headers=alice)
    assert "Unloggable" not in caplog.text


# Database-level guarantees, independent of the API code.


async def test_app_role_cannot_change_or_delete_versions(
    api: AsyncClient, alice: dict[str, str], db: AsyncSession, app_db: AsyncSession
) -> None:
    saved = await save(api, alice, profile())
    uid = await user_id(alice, api)
    version_id = uuid.UUID(saved["id"])

    for statement in (
        update(ProfileVersion).where(ProfileVersion.id == version_id).values(data={}),
        delete(ProfileVersion).where(ProfileVersion.id == version_id),
        delete(Profile).where(Profile.user_id == uid),
    ):
        await bind_user(app_db, uid)
        with pytest.raises(DBAPIError, match="permission denied"):
            await app_db.execute(statement)
        await app_db.rollback()

    stored = await db.scalar(select(ProfileVersion.data).where(ProfileVersion.id == version_id))
    assert stored is not None
    assert stored["basics"]["name"] == "Jordan Testperson"


async def test_rows_are_hidden_from_other_users_in_the_database(
    api: AsyncClient,
    alice: dict[str, str],
    bob: dict[str, str],
    db: AsyncSession,
    app_db: AsyncSession,
) -> None:
    await save(api, alice, profile())
    alice_id = await user_id(alice, api)
    bob_id = await user_id(bob, api)

    await bind_user(app_db, bob_id)
    # No WHERE user_id: the query a buggy route would run.
    assert alice_id not in set((await app_db.scalars(select(ProfileVersion.user_id))).all())
    assert alice_id not in set((await app_db.scalars(select(Profile.user_id))).all())
    await app_db.rollback()


async def test_version_cannot_be_filed_under_another_users_profile(
    api: AsyncClient, alice: dict[str, str], bob: dict[str, str], db: AsyncSession
) -> None:
    await save(api, alice, profile())
    await save(api, bob, profile())
    alice_id = await user_id(alice, api)
    bob_id = await user_id(bob, api)
    alice_profile = await db.scalar(select(Profile.id).where(Profile.user_id == alice_id))
    bob_version = await db.scalar(select(ProfileVersion.id).where(ProfileVersion.user_id == bob_id))

    # As the table owner, so only the constraints stand in the way.
    with pytest.raises(IntegrityError):
        db.add(ProfileVersion(profile_id=alice_profile, user_id=bob_id, data={}))
        await db.flush()
    await db.rollback()
    with pytest.raises(IntegrityError):
        await db.execute(
            update(Profile)
            .where(Profile.id == alice_profile)
            .values(current_version_id=bob_version)
        )
    await db.rollback()


async def test_deleting_the_account_removes_profile_and_versions(
    api: AsyncClient, alice: dict[str, str], db: AsyncSession
) -> None:
    await save(api, alice, profile())
    await save(api, alice, profile(name="Second"))
    uid = await user_id(alice, api)

    await db.execute(delete(User).where(User.id == uid))
    await db.commit()
    assert await db.scalar(select(func.count()).where(Profile.user_id == uid)) == 0
    assert await db.scalar(select(func.count()).where(ProfileVersion.user_id == uid)) == 0
    assert await db.scalar(text("SELECT 1"))
