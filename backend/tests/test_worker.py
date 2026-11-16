from typing import Any, cast

from arq.worker import get_kwargs

from clew.jobs import PARSE_RESUME
from clew.worker import MAX_TRIES, EndToEndWorkerSettings, WorkerSettings, parse_resume


def test_worker_runs_the_job_the_queue_sends() -> None:
    assert parse_resume.__name__ == PARSE_RESUME
    assert parse_resume in WorkerSettings.functions
    assert WorkerSettings.max_tries == MAX_TRIES


def test_the_end_to_end_worker_runs_queued_jobs_but_nothing_on_a_schedule() -> None:
    # Read the settings the way arq does: it sees only the class's own attributes.
    e2e: dict[str, Any] = dict(get_kwargs(cast(Any, EndToEndWorkerSettings)))
    full: dict[str, Any] = dict(get_kwargs(cast(Any, WorkerSettings)))
    assert e2e["cron_jobs"] == []
    assert full["cron_jobs"]
    assert {k: v for k, v in e2e.items() if k != "cron_jobs"} == {
        k: v for k, v in full.items() if k != "cron_jobs"
    }
    assert e2e["functions"] == [parse_resume]
    assert e2e["max_tries"] == MAX_TRIES
