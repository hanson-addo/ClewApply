"""All tables, imported here so Alembic sees every model."""

from clew.models.profile import Profile, ProfileVersion
from clew.models.resume import Resume
from clew.models.user import User

__all__ = ["Profile", "ProfileVersion", "Resume", "User"]
