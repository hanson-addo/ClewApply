"""The shared job catalog: one row per real job, however many sites list it (design doc,
"Job catalog"). These tables hold public job postings, not user data, so they have no
user_id and no row-level security.
"""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from clew.db.base import Base

# Raw postings are kept this long, then the worker's daily cleanup deletes them.
RAW_POSTING_DAYS = 30


class JobStatus(StrEnum):
    OPEN = "open"
    # Every source stopped listing it (#20 marks this after 7 days).
    CLOSED = "closed"


class RemoteType(StrEnum):
    ONSITE = "onsite"
    HYBRID = "hybrid"
    REMOTE = "remote"


class RawPosting(Base):
    """Exactly what a source sent, kept for 30 days for debugging and re-processing."""

    __tablename__ = "raw_postings"
    __table_args__ = (
        Index("ix_raw_postings_source_job", "source", "source_job_id"),
        Index("ix_raw_postings_fetched_at", "fetched_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    # Where it came from: "usajobs", "greenhouse", "lever", "ashby", "email".
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    source_job_id: Mapped[str] = mapped_column(String(255), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Company(Base):
    __tablename__ = "companies"
    __table_args__ = (
        # One row per public job board (e.g. Greenhouse board "examplecorp").
        UniqueConstraint("ats_type", "board_token", name="uq_companies_ats_board"),
        Index("ix_companies_poll", "last_polled_at", postgresql_where=text("poll")),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Lowercased, suffixes like Inc and LLC removed: the company part of a job's dedup key.
    name_norm: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    domain: Mapped[str | None] = mapped_column(String(255))
    # "greenhouse", "lever", "ashby", or None when the company has no known public board.
    ats_type: Mapped[str | None] = mapped_column(String(16))
    board_token: Mapped[str | None] = mapped_column(String(100))
    # True once someone follows the board or it is on the starter list; the worker polls
    # these boards. Never turned off by an unfollow, since others may still follow it.
    poll: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # False for a board a user followed that Clew hasn't checked: anyone can make a board
    # with any name, so its jobs stay apart from verified jobs and, in the feed, show only
    # to its followers. Starter boards and companies named by other sources are verified.
    verified: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class CompanyFollow(Base):
    """A user following a company's job board (#19). Private to the user (row-level
    security), unlike the companies themselves."""

    __tablename__ = "company_follows"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        Index("ix_jobs_posted_at", "posted_at"),
        # Jobs still waiting for a map point (clew.catalog.geocode.geocode_missing).
        Index("ix_jobs_geocode_pending", "id", postgresql_where=text("geocode_status IS NULL")),
        CheckConstraint("status IN ('open', 'closed')", name="status"),
        CheckConstraint(
            "remote_type IS NULL OR remote_type IN ('onsite', 'hybrid', 'remote')",
            name="remote_type",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    title_norm: Mapped[str] = mapped_column(String(300), nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # As the source shows it ("Springfield, IL (Hybrid)"), plus the parsed parts.
    location: Mapped[str | None] = mapped_column(String(300))
    city: Mapped[str | None] = mapped_column(String(100))
    region: Mapped[str | None] = mapped_column(String(100))
    remote_type: Mapped[str | None] = mapped_column(String(16))
    # The city's map point (clew.catalog.geocode), and why there is none when it's null.
    # A null status means not looked up yet.
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    geocode_status: Mapped[str | None] = mapped_column(String(16))
    # Yearly US dollars.
    salary_min: Mapped[int | None] = mapped_column(Integer)
    salary_max: Mapped[int | None] = mapped_column(Integer)
    description: Mapped[str | None] = mapped_column(Text)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # `embedding vector` exists in the table but isn't mapped yet: it gets a fixed dimension
    # and an index once the embedding model is chosen (ranking work).
    # Hash of normalized company + title + location; equal keys are the same job (#20).
    dedup_key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="open")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class JobSource(Base):
    """One place a job is listed. The primary one is the link the feed opens."""

    __tablename__ = "job_sources"
    __table_args__ = (
        UniqueConstraint("source", "source_job_id", name="uq_job_sources_source_job"),
        # At most one primary link per job.
        Index(
            "uq_job_sources_one_primary",
            "job_id",
            unique=True,
            postgresql_where=text("is_primary"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    source_job_id: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(2000), nullable=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Updated each time the source still lists it; #20 closes jobs unseen for 7 days.
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
