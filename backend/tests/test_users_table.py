import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clew.models import User


async def test_new_user_gets_free_plan_and_random_id(db: AsyncSession) -> None:
    user = User(email="riley@example.test", auth_provider_id="user_test_free_plan")
    db.add(user)
    await db.commit()
    await db.refresh(user)

    assert user.plan == "free"
    assert user.id.version == 4
    assert user.created_at is not None
    assert user.deleted_at is None


async def test_email_lookup_ignores_case(db: AsyncSession) -> None:
    db.add(User(email="Casey.Case@Example.test", auth_provider_id="user_test_citext"))
    await db.commit()

    found = await db.scalar(select(User).where(User.email == "casey.case@example.test"))
    assert found is not None


async def test_auth_provider_id_is_unique(db: AsyncSession) -> None:
    db.add(User(email="a@example.test", auth_provider_id="user_test_dupe"))
    await db.commit()
    db.add(User(email="b@example.test", auth_provider_id="user_test_dupe"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


def test_users_table_has_no_password_column() -> None:
    columns = {c.name for c in User.__table__.columns}
    assert not any("password" in name for name in columns)
