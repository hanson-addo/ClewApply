"""Company boards Clew reads: the ones users follow, plus a starter list (#19)."""

from sqlalchemy import exists, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from clew.catalog.boards import BOARD_TOKEN, Ats
from clew.catalog.normalize import normalize_company
from clew.models import Company

# A few well-known boards so the feed isn't empty on day one. Tokens are the slug in each
# company's public board URL. A wrong or retired token only logs "not_found" when polled.
STARTER_BOARDS: tuple[tuple[Ats, str, str], ...] = (
    ("greenhouse", "airbnb", "Airbnb"),
    ("greenhouse", "stripe", "Stripe"),
    ("greenhouse", "discord", "Discord"),
    ("greenhouse", "gitlab", "GitLab"),
    ("greenhouse", "cloudflare", "Cloudflare"),
    ("greenhouse", "robinhood", "Robinhood"),
    ("lever", "palantir", "Palantir"),
    ("ashby", "openai", "OpenAI"),
    ("ashby", "ramp", "Ramp"),
    ("ashby", "linear", "Linear"),
)


def display_name(token: str) -> str:
    """A readable name from a board token until a source tells us better ("acme-co" ->
    "Acme Co")."""
    return " ".join(part.capitalize() for part in token.replace("_", "-").split("-") if part)


_ATS_NAMES = {"greenhouse": "Greenhouse", "lever": "Lever", "ashby": "Ashby"}


async def board_company(
    session: AsyncSession, ats: Ats, token: str, name: str | None = None, *, verified: bool = False
) -> Company:
    """The company for a board, created if needed, and marked for polling.

    `verified` is for boards Clew checked (the starter list). Anyone can make a Lever or
    Ashby board with any name, so a board a user follows is unverified: it never joins a
    company known by name, never takes a name another company uses, and its jobs stay its
    own. A verified board takes over a company known by name that has no board yet."""
    if not BOARD_TOKEN.fullmatch(token):
        raise ValueError("bad_board_token")
    company = await _by_board(session, ats, token)
    if company is None:
        if verified:
            company = await _new_verified(session, ats, token, name or display_name(token))
        else:
            company = await _new_unverified(session, ats, token)
    elif verified and not company.verified:
        await _verify(session, company, name or display_name(token))
    if not company.poll:
        company.poll = True
        await session.flush()
    return company


async def _by_board(session: AsyncSession, ats: Ats, token: str) -> Company | None:
    return await session.scalar(
        select(Company).where(Company.ats_type == ats, Company.board_token == token)
    )


async def _insert(session: AsyncSession, ats: Ats, token: str, **values: object) -> None:
    await session.execute(
        insert(Company)
        .values(ats_type=ats, board_token=token, poll=True, **values)
        .on_conflict_do_nothing()
    )


def _board_norm(name_norm: str, ats: Ats, token: str) -> str:
    # The parentheses keep it apart from every plain normalized name, which has none.
    return f"{name_norm} ({ats} {token.lower()})"


async def _new_verified(session: AsyncSession, ats: Ats, token: str, name: str) -> Company:
    name_norm = normalize_company(name)
    await _insert(session, ats, token, name=name, name_norm=name_norm, verified=True)
    company = await _by_board(session, ats, token)
    if company is None:
        # The name is taken by a company with no board yet: attach this board to it.
        await session.execute(
            update(Company)
            .where(Company.name_norm == name_norm, Company.ats_type.is_(None))
            .values(ats_type=ats, board_token=token, verified=True)
        )
        company = await _by_board(session, ats, token)
    if company is None:
        # The name belongs to a company on another board: keep them apart by board.
        await _insert(
            session,
            ats,
            token,
            name=name,
            name_norm=_board_norm(name_norm, ats, token),
            verified=True,
        )
        company = await _by_board(session, ats, token)
    if company is None:  # pragma: no cover - one of the inserts above created it
        raise RuntimeError("company vanished after insert")
    return company


async def _new_unverified(session: AsyncSession, ats: Ats, token: str) -> Company:
    name = display_name(token)
    name_norm = normalize_company(name)
    taken = await session.scalar(
        select(
            exists().where(
                (Company.name_norm == name_norm) | (func.lower(Company.name) == name.lower())
            )
        )
    )
    if taken:
        # Never show a name another company already uses.
        name = f"{name} ({_ATS_NAMES[ats]} board, unverified)"
    await _insert(
        session, ats, token, name=name, name_norm=_board_norm(name_norm, ats, token), verified=False
    )
    company = await _by_board(session, ats, token)
    if company is None:  # pragma: no cover - the insert above created it
        raise RuntimeError("company vanished after insert")
    return company


async def _verify(session: AsyncSession, company: Company, name: str) -> None:
    """A followed board that turns out to be on the starter list: trust it from now on."""
    company.verified = True
    company.name = name
    name_norm = normalize_company(name)
    if not await session.scalar(select(exists().where(Company.name_norm == name_norm))):
        company.name_norm = name_norm
    await session.flush()


async def ensure_starter_boards(session: AsyncSession) -> None:
    for ats, token, name in STARTER_BOARDS:
        await board_company(session, ats, token, name, verified=True)
