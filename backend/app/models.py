import enum
import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class NoteStatus(str, enum.Enum):
    folded = "folded"
    active = "active"
    done = "done"


class Note(Base):
    __tablename__ = "notes"

    # SQLite has no native UUID type, so ids are UUIDs generated in
    # application code and stored as text — see docs/DECISIONS.md.
    id = sa.Column(sa.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    parent_id = sa.Column(
        sa.String, sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=True
    )
    text = sa.Column(sa.String, nullable=False)
    x = sa.Column(sa.Float, nullable=False, default=0)
    y = sa.Column(sa.Float, nullable=False, default=0)
    status = sa.Column(
        sa.Enum(NoteStatus), nullable=False, default=NoteStatus.folded
    )
    # datetime.utcnow(), not a DB-side default: sibling ordering relies on
    # created_at being distinct per row, and objects are constructed one
    # at a time in Python (even within a single crack-open transaction),
    # so this advances per row the same way clock_timestamp() did for
    # Postgres. See docs/DECISIONS.md.
    created_at = sa.Column(sa.DateTime, nullable=False, default=datetime.utcnow)

    # Feature B: avoidance memory. Incremented by PATCH /notes/{id}/peek
    # whenever a folded loop is opened/viewed without progress being made
    # (never on completion). See docs/DECISIONS.md ("Feature B").
    peek_count = sa.Column(sa.Integer, nullable=False, default=0)
    last_peeked_at = sa.Column(sa.DateTime, nullable=True)


sa.Index("notes_parent_id_idx", Note.parent_id)
sa.Index("notes_parent_id_status_idx", Note.parent_id, Note.status)
