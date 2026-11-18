"""Following company boards through the API (#19). People and companies are made up."""

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clew.api import companies
from clew.auth.deps import get_token_verifier
from clew.catalog.companies import STARTER_BOARDS, ensure_starter_boards
from clew.db.session import bind_user
from clew.main import create_app
from clew.models import Company, CompanyFollow
from tests.auth_helpers import SigningKey, make_token
from tests.test_auth import verifier

KEY = SigningKey("kid_follows")


@pytest.fixture
async def api() -> AsyncIterator[AsyncClient]:
    app = create_app()
    test_verifier = verifier(KEY)
    app.dependency_overrides[get_token_verifier] = lambda: test_verifier
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def as_user(name: str) -> dict[str, str]:
    sub = f"user_follows_{name}_{uuid.uuid4().hex[:8]}"
    return {"Authorization": f"Bearer {make_token(KEY, sub=sub, email=f'{sub}@example.test')}"}


@pytest.fixture
def alice() -> dict[str, str]:
    return as_user("alice")


@pytest.fixture
def bob() -> dict[str, str]:
    return as_user("bob")


def board() -> str:
    return f"labyrinth-{uuid.uuid4().hex[:8]}"


async def test_follow_list_and_unfollow(api: AsyncClient, alice: dict[str, str]) -> None:
    token = board()
    response = await api.post(
        "/companies/follow", headers=alice, json={"ats_type": "greenhouse", "board_token": token}
    )
    assert response.status_code == 201
    followed = response.json()
    assert followed["board_token"] == token
    assert followed["name"] == f"Labyrinth {token.split('-')[1].capitalize()}"
    assert followed["last_polled_at"] is None
    assert followed["verified"] is False

    listed = (await api.get("/companies/follows", headers=alice)).json()
    assert [f["board_token"] for f in listed] == [token]

    gone = await api.delete(f"/companies/follow/greenhouse/{token}", headers=alice)
    assert gone.status_code == 204
    assert (await api.get("/companies/follows", headers=alice)).json() == []
    again = await api.delete(f"/companies/follow/greenhouse/{token}", headers=alice)
    assert again.status_code == 404


async def test_following_marks_the_board_for_polling(
    api: AsyncClient, alice: dict[str, str], db: AsyncSession
) -> None:
    token = board()
    await api.post(
        "/companies/follow", headers=alice, json={"ats_type": "ashby", "board_token": token}
    )
    company = await db.scalar(select(Company).where(Company.board_token == token))
    assert company is not None and company.poll is True and company.ats_type == "ashby"


async def test_following_a_starter_board_follows_the_verified_company(
    api: AsyncClient, alice: dict[str, str], db: AsyncSession
) -> None:
    await ensure_starter_boards(db)
    await db.commit()
    ats, token, name = STARTER_BOARDS[0]
    followed = (
        await api.post(
            "/companies/follow", headers=alice, json={"ats_type": ats, "board_token": token}
        )
    ).json()
    assert (followed["name"], followed["verified"]) == (name, True)


async def test_following_twice_changes_nothing(api: AsyncClient, alice: dict[str, str]) -> None:
    body = {"ats_type": "lever", "board_token": board()}
    first = await api.post("/companies/follow", headers=alice, json=body)
    second = await api.post("/companies/follow", headers=alice, json=body)
    assert second.status_code == 201
    assert second.json() == first.json()
    assert len((await api.get("/companies/follows", headers=alice)).json()) == 1


async def test_two_users_share_the_company_but_not_the_follow(
    api: AsyncClient, alice: dict[str, str], bob: dict[str, str], app_db: AsyncSession
) -> None:
    body = {"ats_type": "greenhouse", "board_token": board()}
    mine = (await api.post("/companies/follow", headers=alice, json=body)).json()
    assert (await api.get("/companies/follows", headers=bob)).json() == []
    theirs = (await api.post("/companies/follow", headers=bob, json=body)).json()
    assert theirs["company_id"] == mine["company_id"]

    await api.delete(f"/companies/follow/greenhouse/{body['board_token']}", headers=bob)
    assert len((await api.get("/companies/follows", headers=alice)).json()) == 1

    # Row-level security: bob's session sees none of alice's follows.
    bob_id = uuid.UUID((await api.get("/me", headers=bob)).json()["id"])
    await bind_user(app_db, bob_id)
    assert (await app_db.scalars(select(CompanyFollow))).all() == []
    await app_db.rollback()


@pytest.mark.parametrize(
    "body",
    [
        {"ats_type": "workday", "board_token": "labyrinth"},
        {"ats_type": "greenhouse", "board_token": "../admin"},
        {"ats_type": "greenhouse", "board_token": "evil.example.com/x"},
        {"ats_type": "greenhouse", "board_token": ""},
        {"ats_type": "greenhouse", "board_token": "x" * 101},
        {"ats_type": "greenhouse", "board_token": "labyrinth", "url": "https://x"},
    ],
)
async def test_bad_follow_requests(
    api: AsyncClient, alice: dict[str, str], body: dict[str, str]
) -> None:
    response = await api.post("/companies/follow", headers=alice, json=body)
    assert response.status_code == 422


async def test_follow_limit(
    api: AsyncClient, alice: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(companies, "MAX_FOLLOWS", 2)
    tokens = [board() for _ in range(3)]
    for token in tokens[:2]:
        body = {"ats_type": "lever", "board_token": token}
        assert (await api.post("/companies/follow", headers=alice, json=body)).status_code == 201
    over = await api.post(
        "/companies/follow", headers=alice, json={"ats_type": "lever", "board_token": tokens[2]}
    )
    assert over.status_code == 409
    # Following one already followed still works at the limit.
    same = {"ats_type": "lever", "board_token": tokens[0]}
    assert (await api.post("/companies/follow", headers=alice, json=same)).status_code == 201


async def test_follows_need_a_session(api: AsyncClient) -> None:
    assert (await api.get("/companies/follows")).status_code == 401
    body = {"ats_type": "lever", "board_token": "labyrinth"}
    assert (await api.post("/companies/follow", json=body)).status_code == 401
    assert (await api.delete("/companies/follow/lever/labyrinth")).status_code == 401


def test_the_starter_list_has_valid_unique_boards_across_the_us() -> None:
    from clew.catalog.boards import BOARD_TOKEN

    boards = [(ats, token) for ats, token, _ in STARTER_BOARDS]
    assert len(boards) == len(set(boards))
    assert all(BOARD_TOKEN.fullmatch(token) for _, token in boards)
    # Employers with on-site jobs in many US metros, not only tech hubs and remote roles.
    assert {"doordashusa", "carvana", "sweetgreen", "toast"} <= {token for _, token in boards}
