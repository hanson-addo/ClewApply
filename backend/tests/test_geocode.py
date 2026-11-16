"""Map points for jobs (#119): the place table, ingest and the catch-up for older jobs."""

import csv
import uuid

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from clew.catalog.geocode import _TABLE, GeocodeStatus, geocode, geocode_missing
from clew.catalog.merge import Posting, add_posting
from clew.models import Job


@pytest.mark.parametrize(
    ("city", "region", "near"),
    [
        ("Austin", "TX", (30.27, -97.74)),
        ("New York", "NY", (40.71, -74.01)),
        ("New York City", "NY", (40.71, -74.01)),
        ("St. Paul", "MN", (44.94, -93.09)),
        ("Saint Petersburg", "FL", (27.77, -82.68)),
        ("Washington", "DC", (38.9, -77.04)),
        ("san francisco", "CA", (37.78, -122.42)),
    ],
)
def test_known_cities_get_a_point(city: str, region: str, near: tuple[float, float]) -> None:
    point = geocode(city, region, "onsite")
    assert point.status == GeocodeStatus.FOUND
    assert point.lat == pytest.approx(near[0], abs=0.05)
    assert point.lng == pytest.approx(near[1], abs=0.05)


def test_jobs_without_a_place_get_no_pin_and_say_why() -> None:
    assert geocode(None, None, "remote").status == GeocodeStatus.REMOTE
    assert geocode(None, "TX", "onsite").status == GeocodeStatus.NO_PLACE
    assert geocode("Austin", None, "onsite").status == GeocodeStatus.NO_PLACE
    # The same name in the wrong state isn't guessed.
    missing = geocode("Austin", "VT", "onsite")
    assert (missing.lat, missing.lng, missing.status) == (None, None, GeocodeStatus.NOT_FOUND)


def test_a_remote_job_that_names_a_city_is_pinned_there() -> None:
    assert geocode("Seattle", "WA", "remote").status == GeocodeStatus.FOUND


def test_the_place_table_is_us_only_and_rounded() -> None:
    with _TABLE.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) > 3000
    for row in rows:
        assert len(row["region"]) == 2
        lat, lng = float(row["lat"]), float(row["lng"])
        # Inside the US and its territories, west of the prime meridian (or across it in
        # Alaska's Aleutians, which wrap past 180).
        assert 13 <= lat <= 72, row
        assert lng < 0 or lng > 170, row
        assert len(row["lat"].split(".")[-1]) <= 3


def _posting(location: str | None) -> Posting:
    tag = uuid.uuid4().hex[:8]
    return Posting(
        source="greenhouse",
        source_job_id=tag,
        url=f"https://boards.example.com/jobs/{tag}",
        company=f"Labyrinth Logistics {tag} Inc.",
        title="Thread Analyst",
        location=location,
    )


async def test_new_jobs_are_placed_as_they_come_in(app_db: AsyncSession) -> None:
    placed = await add_posting(app_db, _posting("Austin, TX (Hybrid)"))
    remote = await add_posting(app_db, _posting("Remote - US"))
    assert placed.geocode_status == GeocodeStatus.FOUND
    assert placed.lat == pytest.approx(30.267)
    assert remote.geocode_status == GeocodeStatus.REMOTE
    assert remote.lat is None
    await app_db.rollback()


async def test_older_jobs_catch_up(app_db: AsyncSession) -> None:
    job = await add_posting(app_db, _posting("Seattle, WA"))
    # As if it was added before this change.
    await app_db.execute(
        update(Job).where(Job.id == job.id).values(lat=None, lng=None, geocode_status=None)
    )
    await app_db.refresh(job)
    assert await geocode_missing(app_db) >= 1
    await app_db.refresh(job)
    assert job.geocode_status == GeocodeStatus.FOUND
    assert job.lat == pytest.approx(47.606)
    await app_db.rollback()
