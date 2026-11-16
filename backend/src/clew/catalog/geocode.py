"""Puts a job's city on the map (#119), from a committed table of US places.

No network calls: the table (data/us_places.csv) is built offline by
scripts/build_us_places.py, so ingest never reaches a geocoding service (R19). Only a job's
city and state are looked up, never anything about a user.
"""

import csv
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clew.models import Job

_TABLE = Path(__file__).with_name("data") / "us_places.csv"


class GeocodeStatus:
    FOUND = "found"
    REMOTE = "remote"  # fully remote with no city: no pin, on purpose
    NO_PLACE = "no_place"  # no city and state to look up
    NOT_FOUND = "not_found"  # a city the table doesn't know


@dataclass(frozen=True)
class Geocode:
    lat: float | None
    lng: float | None
    status: str


# Spellings sources use for the same place as the table.
_ALIASES = {
    ("NY", "new york"): "new york city",
    ("NY", "nyc"): "new york city",
    ("DC", "washington dc"): "washington",
    ("DC", "district of columbia"): "washington",
}


def _key(city: str) -> str:
    """Lowercase, no dots, and "St"/"Saint" made the same. A trailing "city" is handled by
    geocode(), which tries the name with and without it."""
    text = city.lower().replace(".", " ")
    text = re.sub(r"\b(saint|st|ste)\b", "st", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


@cache
def _places() -> dict[tuple[str, str], tuple[float, float]]:
    places: dict[tuple[str, str], tuple[float, float]] = {}
    with _TABLE.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            point = (float(row["lat"]), float(row["lng"]))
            places.setdefault((row["region"], _key(row["city"])), point)
    return places


def geocode(city: str | None, region: str | None, remote_type: str | None) -> Geocode:
    """Where to pin a job, or why it has no pin."""
    if city is None and remote_type == "remote":
        return Geocode(None, None, GeocodeStatus.REMOTE)
    if city is None or region is None:
        return Geocode(None, None, GeocodeStatus.NO_PLACE)
    key = _key(city)
    key = _ALIASES.get((region, key), key)
    places = _places()
    point = places.get((region, key))
    if point is None and key.endswith(" city"):
        point = places.get((region, key.removesuffix(" city")))
    if point is None:
        point = places.get((region, f"{key} city"))
    if point is None:
        return Geocode(None, None, GeocodeStatus.NOT_FOUND)
    return Geocode(point[0], point[1], GeocodeStatus.FOUND)


async def geocode_missing(session: AsyncSession, batch: int = 500) -> int:
    """Looks up jobs added before geocoding existed (status still null); returns how many.
    The caller commits. Runs after each hourly poll, so old jobs catch up on their own."""
    jobs = list(
        await session.scalars(
            select(Job)
            .where(Job.geocode_status.is_(None))
            .limit(batch)
            .with_for_update(skip_locked=True)
        )
    )
    for job in jobs:
        point = geocode(job.city, job.region, job.remote_type)
        job.lat, job.lng, job.geocode_status = point.lat, point.lng, point.status
    await session.flush()
    return len(jobs)
