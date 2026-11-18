"""Sync Center (#130 step 2).

- `POST /sync/fills` (extension token): after the user fills fields on a site, the extension
  says which site, which profile version and which field keys. Nothing from the site's page is
  sent. Clew stores a keyed fingerprint of each value it filled, never the value.
- `GET /sync/status` (web app): per site, the fields whose current value differs from what was
  last filled there, by name only.
"""

from datetime import datetime
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from clew.auth.deps import CurrentUser
from clew.auth.extension import ExtensionUser
from clew.config import get_settings
from clew.db.session import get_session
from clew.models import Profile, ProfileVersion, SyncFill
from clew.profile.schema import ProfileData
from clew.sync.fingerprint import fingerprint
from clew.sync.sites import SITES

router = APIRouter(prefix="/sync", tags=["sync"])

Session = Annotated[AsyncSession, Depends(get_session)]
SiteId = Literal["linkedin", "indeed", "usajobs"]

UNAVAILABLE = "The Sync Center isn't set up yet."
UNKNOWN_VERSION = "That profile version doesn't exist."
UNKNOWN_FIELDS = "Some of those fields aren't filled on this site."


def _key() -> bytes:
    key = get_settings().fill_fingerprint_key
    if key is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, UNAVAILABLE)
    return key.get_secret_value().encode()


class FillRecord(BaseModel):
    site: SiteId
    profile_version: int = Field(ge=1)
    # The fields the user ticked and the extension filled.
    field_keys: list[Annotated[str, Field(max_length=64)]] = Field(min_length=1, max_length=200)


class BehindField(BaseModel):
    key: str
    label: str


class SiteStatus(BaseModel):
    site: SiteId
    name: str
    profile_url: str
    # not_set_up: never filled from Clew. behind: some fields differ. up_to_date: none do.
    state: Literal["not_set_up", "behind", "up_to_date"]
    behind: list[BehindField]
    last_filled_at: datetime | None


class SyncStatus(BaseModel):
    sites: list[SiteStatus]


async def _current_profile(session: AsyncSession, user_id: object) -> ProfileData | None:
    data = await session.scalar(
        select(ProfileVersion.data)
        .join(Profile, Profile.current_version_id == ProfileVersion.id)
        .where(Profile.user_id == user_id, ProfileVersion.user_id == user_id)
    )
    return None if data is None else ProfileData.model_validate(data)


@router.post(
    "/fills",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        401: {"description": "The extension token is unknown, revoked or expired"},
        404: {"description": UNKNOWN_VERSION},
        422: {"description": UNKNOWN_FIELDS},
        503: {"description": UNAVAILABLE},
    },
)
async def record_fill(body: FillRecord, auth: ExtensionUser, session: Session) -> Response:
    """Records what the extension filled on a site, as fingerprints of the profile's values."""
    key = _key()
    user_id = auth.user.id
    data = await session.scalar(
        select(ProfileVersion.data).where(
            ProfileVersion.user_id == user_id, ProfileVersion.number == body.profile_version
        )
    )
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, UNKNOWN_VERSION)
    fields = {f.key: f for f in SITES[body.site].fields(ProfileData.model_validate(data))}
    if any(k not in fields for k in body.field_keys):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, UNKNOWN_FIELDS)
    rows = [
        {
            "user_id": user_id,
            "site": body.site,
            "field_key": k,
            "fingerprint": fingerprint(key, value),
            "profile_version": body.profile_version,
        }
        for k in dict.fromkeys(body.field_keys)
        if (value := fields[k].value)
    ]
    if rows:
        stmt = insert(SyncFill).values(rows)
        await session.execute(
            stmt.on_conflict_do_update(
                constraint="uq_sync_fills_user_site_field",
                set_={
                    "fingerprint": stmt.excluded.fingerprint,
                    "profile_version": stmt.excluded.profile_version,
                    "filled_at": stmt.excluded.filled_at,
                },
            )
        )
        await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/status", responses={401: {"description": "Not signed in"}, 503: {"description": UNAVAILABLE}}
)
async def sync_status(user: CurrentUser, session: Session) -> SyncStatus:
    """Each site's state and the fields it's behind on, by name. Values are never returned."""
    key = _key()
    profile = await _current_profile(session, user.id) or ProfileData()
    fills: dict[str, dict[str, SyncFill]] = {}
    for fill in await session.scalars(select(SyncFill).where(SyncFill.user_id == user.id)):
        fills.setdefault(fill.site, {})[fill.field_key] = fill
    sites = []
    for site in SITES.values():
        filled = fills.get(site.id, {})
        if not filled:
            sites.append(
                SiteStatus(
                    site=cast(SiteId, site.id),
                    name=site.name,
                    profile_url=site.profile_url,
                    state="not_set_up",
                    behind=[],
                    last_filled_at=None,
                )
            )
            continue
        behind = [
            BehindField(key=f.key, label=f.label)
            for f in site.fields(profile)
            if f.value
            and (f.key not in filled or filled[f.key].fingerprint != fingerprint(key, f.value))
        ]
        sites.append(
            SiteStatus(
                site=cast(SiteId, site.id),
                name=site.name,
                profile_url=site.profile_url,
                state="behind" if behind else "up_to_date",
                behind=behind,
                last_filled_at=max(f.filled_at for f in filled.values()),
            )
        )
    return SyncStatus(sites=sites)
