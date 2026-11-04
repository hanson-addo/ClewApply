"""Job preferences API (#16). Every person, company and place here is made up."""

import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clew.api.preferences import NOT_US
from clew.auth.deps import get_token_verifier
from clew.db.session import bind_user
from clew.main import create_app
from clew.models import JobPreferences, User
from tests.auth_helpers import SigningKey, make_token
from tests.test_auth import verifier

KEY = SigningKey("kid_preferences")

WANTS: dict[str, Any] = {
    "titles": ["Thread Engineer", "Maze Mapper"],
    "locations": [{"city": "Austin", "region": "TX"}, {"region": "Colorado"}],
    "remote_ok": False,
    "salary_floor": 95000,
    "seniority": ["mid", "senior"],
    "excluded_companies": ["Minotaur & Sons"],
    "excluded_keywords": ["night shift"],
}


@pytest.fixture
async def api() -> AsyncIterator[AsyncClient]:
    app = create_app()
    test_verifier = verifier(KEY)
    app.dependency_overrides[get_token_verifier] = lambda: test_verifier
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def as_user(name: str) -> dict[str, str]:
    sub = f"user_prefs_{name}_{uuid.uuid4().hex[:8]}"
    return {"Authorization": f"Bearer {make_token(KEY, sub=sub, email=f'{sub}@example.test')}"}


@pytest.fixture
def alice() -> dict[str, str]:
    return as_user("alice")


@pytest.fixture
def bob() -> dict[str, str]:
    return as_user("bob")


async def put(api: AsyncClient, who: dict[str, str], body: dict[str, Any]) -> dict[str, Any]:
    response = await api.put("/preferences", headers=who, json=body)
    assert response.status_code == 200, response.text
    saved: dict[str, Any] = response.json()
    return saved


async def test_defaults_before_the_first_save(api: AsyncClient, alice: dict[str, str]) -> None:
    response = await api.get("/preferences", headers=alice)
    assert response.status_code == 200
    assert response.json() == {
        "titles": [],
        "locations": [],
        "remote_ok": True,
        "salary_floor": None,
        "seniority": [],
        "excluded_companies": [],
        "excluded_keywords": [],
        "updated_at": None,
    }


async def test_save_and_read_back(api: AsyncClient, alice: dict[str, str]) -> None:
    saved = await put(api, alice, WANTS)
    assert saved["updated_at"] is not None
    # State names are stored as codes.
    assert saved["locations"] == [
        {"city": "Austin", "region": "TX"},
        {"city": None, "region": "CO"},
    ]
    read = (await api.get("/preferences", headers=alice)).json()
    assert read == saved


async def test_a_save_replaces_everything(api: AsyncClient, alice: dict[str, str]) -> None:
    await put(api, alice, WANTS)
    saved = await put(api, alice, {"titles": ["Labyrinth Guide"]})
    assert saved["titles"] == ["Labyrinth Guide"]
    assert saved["locations"] == []
    assert saved["remote_ok"] is True
    assert saved["salary_floor"] is None


async def test_lists_are_trimmed_and_deduplicated(api: AsyncClient, alice: dict[str, str]) -> None:
    saved = await put(
        api,
        alice,
        {
            "titles": ["  Thread Engineer ", "thread engineer", "Maze Mapper"],
            "seniority": ["senior", "senior"],
            "excluded_keywords": ["Night Shift", "night shift"],
        },
    )
    assert saved["titles"] == ["Thread Engineer", "Maze Mapper"]
    assert saved["seniority"] == ["senior"]
    assert saved["excluded_keywords"] == ["Night Shift"]


@pytest.mark.parametrize(
    ("body", "where"),
    [
        ({"locations": [{"city": "Toronto", "region": "ON"}]}, ["locations", 0, "region"]),
        ({"locations": [{"city": "Austin"}]}, ["locations", 0, "region"]),
        ({"salary_floor": -1}, ["salary_floor"]),
        ({"salary_floor": 2_000_001}, ["salary_floor"]),
        ({"seniority": ["wizard"]}, ["seniority", 0]),
        ({"titles": [""]}, ["titles", 0]),
        ({"titles": ["x" * 101]}, ["titles", 0]),
        ({"titles": ["Thread\u0000Engineer"]}, ["titles", 0]),
        ({"titles": [f"Title {n}" for n in range(21)]}, ["titles"]),
        ({"excluded_companies": [f"Company {n}" for n in range(51)]}, ["excluded_companies"]),
        ({"remote": True}, ["remote"]),
    ],
)
async def test_bad_values_are_refused(
    api: AsyncClient, alice: dict[str, str], body: dict[str, Any], where: list[Any]
) -> None:
    response = await api.put("/preferences", headers=alice, json=body)
    assert response.status_code == 422
    assert ["body", *where] in [
        error["loc"][: len(where) + 1] for error in response.json()["detail"]
    ]
    assert (await api.get("/preferences", headers=alice)).json()["updated_at"] is None


async def test_non_us_location_says_why(api: AsyncClient, alice: dict[str, str]) -> None:
    response = await api.put(
        "/preferences", headers=alice, json={"locations": [{"region": "Ontario"}]}
    )
    assert NOT_US in response.json()["detail"][0]["msg"]


async def test_each_user_sees_only_their_own(
    api: AsyncClient, alice: dict[str, str], bob: dict[str, str]
) -> None:
    await put(api, alice, WANTS)
    assert (await api.get("/preferences", headers=bob)).json()["titles"] == []
    await put(api, bob, {"titles": ["Maze Mapper"]})
    assert (await api.get("/preferences", headers=alice)).json()["titles"] == WANTS["titles"]


async def test_row_security_hides_other_users_rows(
    api: AsyncClient, alice: dict[str, str], bob: dict[str, str], app_db: AsyncSession
) -> None:
    await put(api, alice, WANTS)
    await api.get("/me", headers=bob)
    bob_id = (await api.get("/me", headers=bob)).json()["id"]
    await bind_user(app_db, uuid.UUID(bob_id))
    assert (await app_db.scalars(select(JobPreferences))).all() == []
    await app_db.rollback()


async def test_preferences_need_a_session(api: AsyncClient) -> None:
    assert (await api.get("/preferences")).status_code == 401
    assert (await api.put("/preferences", json={})).status_code == 401


async def test_deleting_the_account_deletes_preferences(
    api: AsyncClient, alice: dict[str, str], db: AsyncSession
) -> None:
    await put(api, alice, WANTS)
    user_id = uuid.UUID((await api.get("/me", headers=alice)).json()["id"])
    user = await db.get_one(User, user_id)
    await db.delete(user)
    await db.commit()
    left = await db.scalar(select(JobPreferences).where(JobPreferences.user_id == user_id))
    assert left is None
