"""The master profile. Each save adds a version; old versions are kept as they were.

Every query filters by the signed-in user, and row-level security enforces the same in the
database (threat model R1). Profile content is never logged.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import AfterValidator, BaseModel, StringConstraints
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from clew.auth.deps import CurrentUser
from clew.db.session import get_session
from clew.models import Profile, ProfileVersion
from clew.profile.schema import ProfileData, reject_control_characters

router = APIRouter(tags=["profile"])

MAX_PROFILE_BYTES = 256 * 1024
TOO_LARGE = "Profiles must be 256 KB or smaller."
NO_PROFILE = "You haven't saved a profile yet."
VERSION_NOT_FOUND = "Version not found."
STALE = "Your profile changed somewhere else. Reload it and try again."

Session = Annotated[AsyncSession, Depends(get_session)]


class ProfileSave(BaseModel):
    data: ProfileData
    change_summary: (
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, max_length=200),
            AfterValidator(reject_control_characters),
        ]
        | None
    ) = None
    # The version the edit started from. When given and it is no longer the current one,
    # the save is refused, so an edit in one tab can't silently undo another.
    base_version_id: uuid.UUID | None = None


class ProfileVersionOut(BaseModel):
    id: uuid.UUID
    data: ProfileData
    change_summary: str | None
    created_at: datetime
    is_current: bool


class ProfileVersionSummary(BaseModel):
    id: uuid.UUID
    change_summary: str | None
    created_at: datetime
    is_current: bool


def _out(version: ProfileVersion, current_id: uuid.UUID | None) -> ProfileVersionOut:
    # Stored versions are re-validated against today's ProfileData. A change that tightens
    # the schema must come with a data migration for old versions, or reads will fail.
    return ProfileVersionOut(
        id=version.id,
        data=ProfileData.model_validate(version.data),
        change_summary=version.change_summary,
        created_at=version.created_at,
        is_current=version.id == current_id,
    )


async def _current_version_id(session: AsyncSession, user_id: uuid.UUID) -> uuid.UUID | None:
    return await session.scalar(
        select(Profile.current_version_id).where(Profile.user_id == user_id)
    )


@router.get(
    "/profile",
    responses={401: {"description": "Not signed in"}, 404: {"description": "No profile yet"}},
)
async def get_profile(user: CurrentUser, session: Session) -> ProfileVersionOut:
    """The current version of the signed-in user's profile."""
    version = await session.scalar(
        select(ProfileVersion)
        .join(Profile, Profile.current_version_id == ProfileVersion.id)
        .where(Profile.user_id == user.id, ProfileVersion.user_id == user.id)
    )
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NO_PROFILE)
    return _out(version, version.id)


@router.put(
    "/profile",
    responses={
        401: {"description": "Not signed in"},
        409: {"description": "base_version_id is no longer the current version"},
        413: {"description": "The profile is over 256 KB"},
        422: {"description": "The profile doesn't match the schema"},
    },
)
async def save_profile(body: ProfileSave, user: CurrentUser, session: Session) -> ProfileVersionOut:
    """Save the whole profile as a new version. Saving data identical to the current version
    adds nothing and returns the current version."""
    # Creates the profile on first save; ON CONFLICT covers two first saves racing.
    await session.execute(
        insert(Profile)
        .values(user_id=user.id)
        .on_conflict_do_nothing(index_elements=[Profile.user_id])
    )
    # Row lock: saves for one user run one at a time, so none is lost.
    profile = await session.scalar(
        select(Profile).where(Profile.user_id == user.id).with_for_update()
    )
    if profile is None:  # pragma: no cover - the insert above created it
        raise HTTPException(status.HTTP_404_NOT_FOUND, NO_PROFILE)
    if body.base_version_id is not None and body.base_version_id != profile.current_version_id:
        raise HTTPException(status.HTTP_409_CONFLICT, STALE)

    data: dict[str, Any] = body.data.model_dump(mode="json", exclude_none=True)
    if profile.current_version_id is not None:
        current = await session.scalar(
            select(ProfileVersion).where(
                ProfileVersion.id == profile.current_version_id,
                ProfileVersion.user_id == user.id,
            )
        )
        if current is not None and current.data == data:
            await session.commit()
            return _out(current, current.id)

    version = ProfileVersion(
        profile_id=profile.id, user_id=user.id, data=data, change_summary=body.change_summary
    )
    session.add(version)
    await session.flush()
    await session.execute(
        update(Profile)
        .where(Profile.id == profile.id, Profile.user_id == user.id)
        .values(current_version_id=version.id, updated_at=func.now())
    )
    await session.commit()
    await session.refresh(version)
    return _out(version, version.id)


@router.get("/profile/versions", responses={401: {"description": "Not signed in"}})
async def list_versions(
    user: CurrentUser,
    session: Session,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[ProfileVersionSummary]:
    """Saved versions, newest first. Empty before the first save."""
    current_id = await _current_version_id(session, user.id)
    versions = await session.scalars(
        select(ProfileVersion)
        .where(ProfileVersion.user_id == user.id)
        .order_by(ProfileVersion.created_at.desc(), ProfileVersion.id.desc())
        .limit(limit)
    )
    return [
        ProfileVersionSummary(
            id=v.id,
            change_summary=v.change_summary,
            created_at=v.created_at,
            is_current=v.id == current_id,
        )
        for v in versions
    ]


@router.get(
    "/profile/versions/{version_id}",
    responses={
        401: {"description": "Not signed in"},
        404: {"description": "No such version for this user"},
    },
)
async def get_version(
    version_id: uuid.UUID, user: CurrentUser, session: Session
) -> ProfileVersionOut:
    """One saved version, exactly as it was saved."""
    version = await session.scalar(
        select(ProfileVersion).where(
            ProfileVersion.id == version_id, ProfileVersion.user_id == user.id
        )
    )
    if version is None:
        # Same answer whether the version doesn't exist or belongs to someone else.
        raise HTTPException(status.HTTP_404_NOT_FOUND, VERSION_NOT_FOUND)
    return _out(version, await _current_version_id(session, user.id))
