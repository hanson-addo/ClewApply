"""All tables, imported here so Alembic sees every model."""

from clew.models.catalog import Company, Job, JobSource, JobStatus, RawPosting, RemoteType
from clew.models.profile import Profile, ProfileVersion
from clew.models.resume import Resume
from clew.models.resume_parse import ParseStatus, ResumeParse
from clew.models.usage import UsageEvent, UsageKind
from clew.models.user import User

__all__ = [
    "Company",
    "Job",
    "JobSource",
    "JobStatus",
    "ParseStatus",
    "Profile",
    "ProfileVersion",
    "RawPosting",
    "RemoteType",
    "Resume",
    "ResumeParse",
    "UsageEvent",
    "UsageKind",
    "User",
]
