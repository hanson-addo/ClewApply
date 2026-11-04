"""Job preferences: what the signed-in user wants from the feed (#16).

US locations only at launch. Row-level security scopes every read and write to the user,
and preferences are never logged.
"""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from clew.auth.deps import CurrentUser
from clew.catalog.normalize import state_code
from clew.db.session import get_session
from clew.models import JobPreferences
from clew.profile.schema import reject_control_characters

router = APIRouter(tags=["preferences"])

Session = Annotated[AsyncSession, Depends(get_session)]

Seniority = Literal["intern", "entry", "mid", "senior", "lead", "manager", "executive"]
NOT_US = "Pick a US state, DC or Puerto Rico. Clew lists US jobs only for now."
MAX_SALARY = 2_000_000


Title = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    AfterValidator(reject_control_characters),
]
CompanyName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
    AfterValidator(reject_control_characters),
]
City = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    AfterValidator(reject_control_characters),
]


def _us_region(value: str) -> str:
    code = state_code(value.strip())
    if code is None:
        raise ValueError(NOT_US)
    return code


def _unique(values: list[str]) -> list[str]:
    """Drops repeats, ignoring case, and keeps the first spelling."""
    seen: set[str] = set()
    kept: list[str] = []
    for value in values:
        if value.casefold() not in seen:
            seen.add(value.casefold())
            kept.append(value)
    return kept


class PreferenceLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Leave out for anywhere in the state.
    city: City | None = None
    # A two-letter code or a full name; stored as the code.
    region: Annotated[str, AfterValidator(_us_region)]


class Preferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    titles: Annotated[list[Title], Field(max_length=20), AfterValidator(_unique)] = []
    locations: Annotated[list[PreferenceLocation], Field(max_length=20)] = []
    remote_ok: bool = True
    # Lowest acceptable yearly pay in US dollars.
    salary_floor: Annotated[int, Field(ge=0, le=MAX_SALARY)] | None = None
    seniority: Annotated[list[Seniority], Field(max_length=7), AfterValidator(_unique)] = []
    excluded_companies: Annotated[
        list[CompanyName], Field(max_length=50), AfterValidator(_unique)
    ] = []
    excluded_keywords: Annotated[list[Title], Field(max_length=50), AfterValidator(_unique)] = []


class PreferencesOut(Preferences):
    # None until the first save; the defaults are returned until then.
    updated_at: datetime | None


def _out(row: JobPreferences | None) -> PreferencesOut:
    if row is None:
        return PreferencesOut(updated_at=None)
    return PreferencesOut(
        titles=row.titles,
        locations=[PreferenceLocation.model_validate(loc) for loc in row.locations],
        remote_ok=row.remote_ok,
        salary_floor=row.salary_floor,
        seniority=row.seniority,
        excluded_companies=row.excluded_companies,
        excluded_keywords=row.excluded_keywords,
        updated_at=row.updated_at,
    )


@router.get("/preferences", responses={401: {"description": "Not signed in"}})
async def get_preferences(user: CurrentUser, session: Session) -> PreferencesOut:
    """The signed-in user's job preferences, or the defaults before the first save."""
    row = await session.scalar(select(JobPreferences).where(JobPreferences.user_id == user.id))
    return _out(row)


@router.put(
    "/preferences",
    responses={
        401: {"description": "Not signed in"},
        422: {"description": "A value is out of range, or a location is outside the US"},
    },
)
async def save_preferences(
    body: Preferences, user: CurrentUser, session: Session
) -> PreferencesOut:
    """Replaces the signed-in user's job preferences."""
    values = body.model_dump(mode="json")
    row = await session.scalar(
        insert(JobPreferences)
        .values(user_id=user.id, **values)
        .on_conflict_do_update(
            index_elements=[JobPreferences.user_id],
            set_={**values, "updated_at": func.now()},
        )
        .returning(JobPreferences)
    )
    await session.commit()
    return _out(row)
