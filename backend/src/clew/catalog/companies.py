"""Company boards Clew reads: the ones users follow, plus a starter list (#19)."""

from sqlalchemy import select, update
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


async def board_company(
    session: AsyncSession, ats: Ats, token: str, name: str | None = None
) -> Company:
    """The company for a board, created if needed, and marked for polling.

    A company already known by name (from another source) gets the board attached, so its
    jobs merge with the ones already in the catalog."""
    if not BOARD_TOKEN.match(token):
        raise ValueError("bad_board_token")
    company = await session.scalar(
        select(Company).where(Company.ats_type == ats, Company.board_token == token)
    )
    if company is None:
        name = name or display_name(token)
        name_norm = normalize_company(name)
        await session.execute(
            insert(Company)
            .values(name=name, name_norm=name_norm, ats_type=ats, board_token=token, poll=True)
            .on_conflict_do_nothing()
        )
        company = await session.scalar(
            select(Company).where(Company.ats_type == ats, Company.board_token == token)
        )
        if company is None:
            # The name is taken by a company with no board yet: attach this board to it.
            await session.execute(
                update(Company)
                .where(Company.name_norm == name_norm, Company.ats_type.is_(None))
                .values(ats_type=ats, board_token=token)
            )
            company = await session.scalar(
                select(Company).where(Company.ats_type == ats, Company.board_token == token)
            )
        if company is None:
            # The name belongs to a company on another board: keep them apart by token.
            await session.execute(
                insert(Company)
                .values(
                    name=name,
                    name_norm=f"{name_norm} ({ats} {token.lower()})",
                    ats_type=ats,
                    board_token=token,
                    poll=True,
                )
                .on_conflict_do_nothing()
            )
            company = (
                await session.scalars(
                    select(Company).where(Company.ats_type == ats, Company.board_token == token)
                )
            ).one()
    if not company.poll:
        company.poll = True
        await session.flush()
    return company


async def ensure_starter_boards(session: AsyncSession) -> None:
    for ats, token, name in STARTER_BOARDS:
        await board_company(session, ats, token, name)
