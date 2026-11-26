"""SQLAlchemy engine and session helpers.

SQLite is the MVP store: one file, no server to install, and the schema can be
moved to PostgreSQL later without changing the routers.
"""

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

settings.ensure_dirs()

_is_sqlite = settings.resolved_database_url.startswith("sqlite")
engine = create_engine(
    settings.resolved_database_url,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401  (register the tables)

    Base.metadata.create_all(bind=engine)
    _migrate_sqlite()


def _migrate_sqlite() -> None:
    """Add columns that create_all cannot add to an existing SQLite table."""
    if not _is_sqlite:
        return
    with engine.begin() as connection:
        columns = [
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info(versions)")
        ]
        if "delete_source_after" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE versions ADD COLUMN delete_source_after "
                "BOOLEAN NOT NULL DEFAULT 0"
            )
