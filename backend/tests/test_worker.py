from clew.jobs import PARSE_RESUME
from clew.worker import MAX_TRIES, EndToEndWorkerSettings, WorkerSettings, parse_resume


def test_worker_runs_the_job_the_queue_sends() -> None:
    assert parse_resume.__name__ == PARSE_RESUME
    assert parse_resume in WorkerSettings.functions
    assert WorkerSettings.max_tries == MAX_TRIES


def test_the_end_to_end_worker_runs_queued_jobs_but_nothing_on_a_schedule() -> None:
    assert EndToEndWorkerSettings.functions == WorkerSettings.functions
    assert EndToEndWorkerSettings.cron_jobs == []
    assert WorkerSettings.cron_jobs
