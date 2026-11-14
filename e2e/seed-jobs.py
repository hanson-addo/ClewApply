"""Adds made-up jobs to the catalog for the feed and Applications end-to-end specs.

Run from ../backend with `uv run python ../e2e/seed-jobs.py`, with CLEW_DATABASE_URL set to
the database owner's URL (the app role can't write the catalog). Every company, job and link
here is invented. Running it twice is safe: a listing seen before is only refreshed.
"""

import asyncio
from datetime import UTC, datetime, timedelta

from clew.catalog.merge import Posting, add_posting
from clew.db.session import get_sessionmaker

# Must stay in step with e2e/tests/seed.ts.
LONG_DESCRIPTION = (
    "Labyrinth Logistics plans routes through very twisty places. "
    "<script>alert(1)</script><img src=x onerror=alert(2)> "
    + "You will unwind thread, mark dead ends and keep the map honest. " * 12
    + "The last line of the description."
)


def postings(now: datetime) -> list[Posting]:
    return [
        Posting(
            source="greenhouse",
            source_job_id="e2e-thread-1",
            url="https://boards.greenhouse.io/labyrinthlogistics/jobs/1",
            company="Labyrinth Logistics",
            title="E2E Thread Engineer",
            location="Remote - US",
            description=LONG_DESCRIPTION,
            posted_at=now - timedelta(hours=2),
            salary_min=120_000,
            salary_max=150_000,
        ),
        # The same job from an alert email: it merges into the one above.
        Posting(
            source="email",
            source_job_id="e2e-thread-email-1",
            url="https://example.com/alerts/thread-engineer",
            company="Labyrinth Logistics",
            title="E2E Thread Engineer",
            location="Remote - US",
            posted_at=now - timedelta(hours=2),
        ),
        Posting(
            source="usajobs",
            source_job_id="e2e-route-1",
            url="https://www.usajobs.gov/job/900000001",
            company="Minos Maps",
            title="E2E Route Planner",
            location="Austin, TX",
            description="Plan routes for a made-up federal mapping office.",
            posted_at=now - timedelta(days=1),
            salary_min=80_000,
            salary_max=95_000,
        ),
        Posting(
            source="lever",
            source_job_id="e2e-maze-1",
            url="https://jobs.lever.co/daedalusdesigns/e2e-maze-1",
            company="Daedalus Designs",
            title="E2E Maze Analyst",
            location="New York, NY (Hybrid)",
            description="Study mazes that do not exist.",
            posted_at=now - timedelta(days=3),
        ),
    ]


async def main() -> None:
    now = datetime.now(UTC)
    async with get_sessionmaker()() as session:
        for posting in postings(now):
            await add_posting(session, posting, now=now)
        await session.commit()


if __name__ == "__main__":
    asyncio.run(main())
