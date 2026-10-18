"""Row-level security: the database itself keeps each user's rows to that user (#62)."""

import uuid
from collections.abc import AsyncIterator
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from clew.db.role_check import app_role_problems
from clew.db.session import bind_user, get_engine, get_sessionmaker
from clew.models import Resume, User


async def make_user(db: AsyncSession, name: str) -> uuid.UUID:
    user = User(
        auth_provider_id=f"user_rls_{name}_{uuid.uuid4().hex[:8]}", email=f"{name}@example.test"
    )
    db.add(user)
    await db.flush()
    db.add(
        Resume(
            user_id=user.id,
            file_key=f"resumes/{uuid.uuid4().hex}",
            filename=f"{name}.pdf",
            content_type="application/pdf",
            size_bytes=10,
            sha256="0" * 64,
        )
    )
    await db.commit()
    return user.id


@pytest.fixture
async def alice_and_bob(db: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    return await make_user(db, "alice"), await make_user(db, "bob")


@pytest.fixture
async def app_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session


async def visible_owners(session: AsyncSession) -> set[uuid.UUID]:
    # Deliberately no WHERE user_id = ...: this is the query a buggy route would run.
    return set((await session.scalars(select(Resume.user_id))).all())


async def test_bound_user_sees_only_own_rows(
    app_session: AsyncSession, alice_and_bob: tuple[uuid.UUID, uuid.UUID]
) -> None:
    alice, bob = alice_and_bob
    await bind_user(app_session, alice)
    owners = await visible_owners(app_session)
    assert alice in owners
    assert bob not in owners
    assert owners == {alice}


async def test_unbound_session_sees_nothing(
    app_session: AsyncSession, alice_and_bob: tuple[uuid.UUID, uuid.UUID]
) -> None:
    assert await app_session.scalar(select(func.count()).select_from(Resume)) == 0


async def test_binding_survives_commit(
    app_session: AsyncSession, alice_and_bob: tuple[uuid.UUID, uuid.UUID]
) -> None:
    alice, _ = alice_and_bob
    await bind_user(app_session, alice)
    await app_session.commit()  # the next query runs in a new transaction
    assert await visible_owners(app_session) == {alice}


async def test_binding_does_not_leak_to_next_session(
    alice_and_bob: tuple[uuid.UUID, uuid.UUID],
) -> None:
    alice, _ = alice_and_bob
    async with get_sessionmaker()() as first:
        await bind_user(first, alice)
        assert await visible_owners(first) == {alice}
    # Same pool, likely the same connection: the setting was local to the transaction.
    async with get_sessionmaker()() as second:
        assert await visible_owners(second) == set()


async def test_cannot_write_rows_for_another_user(
    app_session: AsyncSession, alice_and_bob: tuple[uuid.UUID, uuid.UUID]
) -> None:
    alice, bob = alice_and_bob
    await bind_user(app_session, alice)
    app_session.add(
        Resume(
            user_id=bob,
            file_key=f"resumes/{uuid.uuid4().hex}",
            filename="planted.pdf",
            content_type="application/pdf",
            size_bytes=1,
            sha256="0" * 64,
        )
    )
    with pytest.raises(DBAPIError, match="row-level security"):
        await app_session.flush()


async def test_cannot_change_another_users_rows(
    app_session: AsyncSession, db: AsyncSession, alice_and_bob: tuple[uuid.UUID, uuid.UUID]
) -> None:
    alice, bob = alice_and_bob
    await bind_user(app_session, alice)
    result = await app_session.execute(
        update(Resume).where(Resume.user_id == bob).values(filename="changed.pdf")
    )
    await app_session.commit()
    assert result.rowcount == 0  # type: ignore[attr-defined]
    assert await db.scalar(select(Resume.filename).where(Resume.user_id == bob)) == "bob.pdf"


async def test_every_per_user_table_has_row_security(db: AsyncSession) -> None:
    rows = await db.execute(
        text(
            """
            SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                   EXISTS (SELECT FROM pg_policies p
                            WHERE p.schemaname = 'public' AND p.tablename = c.relname)
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
             WHERE c.relkind = 'r'
               AND c.relname <> 'users'
               AND EXISTS (SELECT FROM information_schema.columns col
                            WHERE col.table_schema = 'public'
                              AND col.table_name = c.relname
                              AND col.column_name = 'user_id')
            """
        )
    )
    tables = {name: (enabled, forced, has_policy) for name, enabled, forced, has_policy in rows}
    assert "resumes" in tables
    missing = [name for name, flags in tables.items() if flags != (True, True, True)]
    assert missing == [], f"call enable_user_rls() in the migration for: {missing}"


async def test_app_role_cannot_bypass_row_security() -> None:
    assert await app_role_problems(get_engine()) == []


async def test_owner_role_is_flagged(test_database: str) -> None:
    owner = create_async_engine(test_database)
    try:
        assert await app_role_problems(owner) != []
    finally:
        await owner.dispose()


@pytest.fixture
async def throwaway_role(test_database: str, db: AsyncSession) -> AsyncIterator[str]:
    """A plain login role (no superuser, no BYPASSRLS, owns nothing), dropped afterwards."""
    name = f"clew_test_role_{uuid.uuid4().hex[:8]}"
    await db.execute(text(f"CREATE ROLE {name} LOGIN PASSWORD 'throwaway' NOSUPERUSER"))
    await db.commit()
    yield name
    await db.execute(text(f"DROP ROLE {name}"))
    await db.commit()


async def problems_for(test_database: str, role: str) -> list[str]:
    engine = create_async_engine(
        make_url(test_database)
        .set(username=role, password="throwaway")  # noqa: S106 - throwaway test role
        .render_as_string(hide_password=False)
    )
    try:
        return await app_role_problems(engine)
    finally:
        await engine.dispose()


async def test_plain_role_passes(test_database: str, throwaway_role: str) -> None:
    assert await problems_for(test_database, throwaway_role) == []


async def test_member_of_owner_role_is_flagged(
    test_database: str, db: AsyncSession, throwaway_role: str
) -> None:
    owner_role = await db.scalar(
        text(
            "SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'resumes'"
        )
    )
    await db.execute(text(f'GRANT "{owner_role}" TO {throwaway_role}'))
    await db.commit()
    problems = await problems_for(test_database, throwaway_role)
    assert "owns tables or is a member of their owner" in problems


async def test_member_of_bypassrls_role_is_flagged(
    test_database: str, db: AsyncSession, throwaway_role: str
) -> None:
    bypasser = f"clew_test_bypass_{uuid.uuid4().hex[:8]}"
    await db.execute(text(f"CREATE ROLE {bypasser} NOLOGIN BYPASSRLS"))
    await db.execute(text(f"GRANT {bypasser} TO {throwaway_role}"))
    await db.commit()
    try:
        problems = await problems_for(test_database, throwaway_role)
        assert "has or can assume BYPASSRLS" in problems
    finally:
        await db.execute(text(f"REVOKE {bypasser} FROM {throwaway_role}"))
        await db.execute(text(f"DROP ROLE {bypasser}"))
        await db.commit()


async def test_production_refuses_to_start_as_the_owner(
    test_database: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    import clew.main

    app = clew.main.create_app()
    owner = create_async_engine(test_database)
    monkeypatch.setattr(clew.main, "get_settings", lambda: SimpleNamespace(env="production"))
    monkeypatch.setattr(clew.main, "get_engine", lambda: owner)
    try:
        with pytest.raises(RuntimeError, match="app role"):
            async with clew.main.lifespan(app):
                pass
    finally:
        await owner.dispose()
