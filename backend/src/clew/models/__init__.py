"""All tables, imported here so Alembic sees every model."""

from clew.models.application import Application, ApplicationStatus
from clew.models.catalog import (
    Company,
    CompanyFollow,
    Job,
    JobSource,
    JobStatus,
    RawPosting,
    RemoteType,
)
from clew.models.consent import AiConsentEvent
from clew.models.extension import ExtensionLinkCode, ExtensionToken
from clew.models.feedback import FeedbackAction, JobFeedback
from clew.models.preferences import JobPreferences
from clew.models.profile import Profile, ProfileVersion
from clew.models.resume import Resume
from clew.models.resume_parse import ParseStatus, ResumeParse
from clew.models.sync import SyncFill
from clew.models.usage import UsageEvent, UsageKind
from clew.models.user import User

__all__ = [
    "AiConsentEvent",
    "Application",
    "ApplicationStatus",
    "Company",
    "CompanyFollow",
    "ExtensionLinkCode",
    "ExtensionToken",
    "FeedbackAction",
    "Job",
    "JobFeedback",
    "JobPreferences",
    "JobSource",
    "JobStatus",
    "ParseStatus",
    "Profile",
    "ProfileVersion",
    "RawPosting",
    "RemoteType",
    "Resume",
    "ResumeParse",
    "SyncFill",
    "UsageEvent",
    "UsageKind",
    "User",
]
