"""Following companies' public job boards (#19). Following is private to the user;
the worker then reads the board, so its jobs reach the feed within one polling cycle.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from clew.auth.deps import CurrentUser
from clew.catalog.boards import BOARD_TOKEN, Ats
from clew.catalog.companies import board_company
from clew.db.session import get_session
from clew.models import Company, CompanyFollow

router = APIRouter(tags=["companies"])

Session = Annotated[AsyncSession, Depends(get_session)]

MAX_FOLLOWS = 200
TOO_MANY = f"You can follow up to {MAX_FOLLOWS} companies."
NOT_FOLLOWING = "You're not following that company."

BoardToken = Annotated[str, StringConstraints(strip_whitespace=True, pattern=BOARD_TOKEN.pattern)]


class FollowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ats_type: Ats
    # The slug in the board's public URL, e.g. "examplecorp" in
    # boards.greenhouse.io/examplecorp.
    board_token: BoardToken


class FollowedCompany(BaseModel):
    company_id: str
    name: str
    ats_type: Ats
    board_token: str
    followed_at: datetime
    # None until the worker has read the board once.
    last_polled_at: datetime | None


async def _followed(session: AsyncSession, user_id: object) -> list[FollowedCompany]:
    rows = await session.execute(
        select(Company, CompanyFollow.created_at)
        .join(CompanyFollow, CompanyFollow.company_id == Company.id)
        .where(CompanyFollow.user_id == user_id)
        .order_by(Company.name)
    )
    return [
        FollowedCompany(
            company_id=str(company.id),
            name=company.name,
            ats_type=company.ats_type,
            board_token=company.board_token or "",
            followed_at=followed_at,
            last_polled_at=company.last_polled_at,
        )
        for company, followed_at in rows.all()
    ]


@router.get("/companies/follows", responses={401: {"description": "Not signed in"}})
async def list_follows(user: CurrentUser, session: Session) -> list[FollowedCompany]:
    """Companies the signed-in user follows, by name."""
    return await _followed(session, user.id)


@router.post(
    "/companies/follow",
    status_code=status.HTTP_201_CREATED,
    responses={
        401: {"description": "Not signed in"},
        409: {"description": "Already following the most companies allowed"},
        422: {"description": "Unknown ATS or a malformed board token"},
    },
)
async def follow(body: FollowRequest, user: CurrentUser, session: Session) -> FollowedCompany:
    """Follows a company's public board. Following one already followed changes nothing."""
    count = len(await _followed(session, user.id))
    company = await board_company(session, body.ats_type, body.board_token)
    already = await session.scalar(
        select(CompanyFollow).where(
            CompanyFollow.user_id == user.id, CompanyFollow.company_id == company.id
        )
    )
    if already is None and count >= MAX_FOLLOWS:
        raise HTTPException(status.HTTP_409_CONFLICT, TOO_MANY)
    await session.execute(
        insert(CompanyFollow)
        .values(user_id=user.id, company_id=company.id)
        .on_conflict_do_nothing()
    )
    await session.commit()
    followed = next(f for f in await _followed(session, user.id) if f.company_id == str(company.id))
    return followed


@router.delete(
    "/companies/follow/{ats_type}/{board_token}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        401: {"description": "Not signed in"},
        404: {"description": "Not following that board"},
    },
)
async def unfollow(
    ats_type: Ats, board_token: BoardToken, user: CurrentUser, session: Session
) -> Response:
    """Stops following a company's board. Jobs already in the feed stay until they close."""
    company_id = await session.scalar(
        select(Company.id).where(Company.ats_type == ats_type, Company.board_token == board_token)
    )
    result = await session.execute(
        delete(CompanyFollow)
        .where(CompanyFollow.user_id == user.id, CompanyFollow.company_id == company_id)
        .returning(CompanyFollow.company_id)
    )
    if result.first() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOLLOWING)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
