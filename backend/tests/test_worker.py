from clew.jobs import PARSE_RESUME
from clew.worker import MAX_TRIES, WorkerSettings, parse_resume


def test_worker_runs_the_job_the_queue_sends() -> None:
    assert parse_resume.__name__ == PARSE_RESUME
    assert parse_resume in WorkerSettings.functions
    assert WorkerSettings.max_tries == MAX_TRIES
