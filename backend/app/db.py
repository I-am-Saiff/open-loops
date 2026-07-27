from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.config import settings

# One codebase, two backends: local dev stays on zero-setup SQLite (the
# default database_url), production runs on Postgres via the DATABASE_URL
# env var. Everything below the engine is dialect-agnostic SQLAlchemy —
# only the connect args and the SQLite-only PRAGMA listener branch on the
# scheme. See docs/DECISIONS.md ("SQLite→Postgres swap").
database_url = settings.database_url

# Some hosts (Railway/Heroku-style) hand out a legacy "postgres://" URL,
# which SQLAlchemy 2.0 no longer recognizes — normalize it to the modern
# "postgresql://" scheme (defaults to the psycopg2 driver).
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql://", 1)

is_sqlite = database_url.startswith("sqlite")

# check_same_thread is a SQLite-only connect arg; passing it to psycopg2
# would error. pool_pre_ping keeps the Postgres pool healthy across the
# idle connection drops a hosted DB will do (harmless for SQLite too, but
# only meaningful for a real server).
if is_sqlite:
    engine = create_engine(database_url, connect_args={"check_same_thread": False})
else:
    engine = create_engine(database_url, pool_pre_ping=True)


# SQLite doesn't enforce foreign keys (and therefore ON DELETE CASCADE)
# unless asked to, per connection — the delete cascade the eraser and
# "let it go" rely on needs this. Postgres enforces the same FK
# constraints natively, so this listener must NOT attach there (it would
# run a SQLite-specific PRAGMA against psycopg2). See docs/DECISIONS.md.
if is_sqlite:

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
