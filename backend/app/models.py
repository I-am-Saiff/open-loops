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


# The app is a notebook first. A note starts 'plain' — a raw brain-dump
# line, ink on paper, no machinery. It becomes a 'loop' only when it is
# designed (given steps) in the Loop design overlay. Only loops
# participate in the fog-of-war state machine (crack-open, step
# promotion, parent auto-complete) and appear on the Open/Closed
# surfaces. See docs/IA.md ("Brain dump" / "Loop design").
class NoteKind(str, enum.Enum):
    plain = "plain"
    loop = "loop"


# Recurrence is set in Loop design. When a recurring loop closes, a fresh
# instance is scheduled for the next interval and regenerates straight
# into Open loops then (see routes/notes.py). See docs/IA.md
# ("Recurrence").
class NoteRecurrence(str, enum.Enum):
    none = "none"
    daily = "daily"
    weekdays = "weekdays"
    weekly = "weekly"
    monthly = "monthly"


class Note(Base):
    __tablename__ = "notes"

    # SQLite has no native UUID type, so ids are UUIDs generated in
    # application code and stored as text — see docs/DECISIONS.md.
    id = sa.Column(sa.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    parent_id = sa.Column(
        sa.String, sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=True
    )
    text = sa.Column(sa.String, nullable=False)
    # Freeform canvas position. Retained on the model (default 0) so a
    # later phase can restore user-placed loop-marks without a schema
    # change; the current skeleton arranges Open loops itself and does
    # not read these. See docs/DECISIONS.md ("Phase 2 collapse").
    x = sa.Column(sa.Float, nullable=False, default=0)
    y = sa.Column(sa.Float, nullable=False, default=0)
    status = sa.Column(
        sa.Enum(NoteStatus), nullable=False, default=NoteStatus.folded
    )
    kind = sa.Column(sa.Enum(NoteKind), nullable=False, default=NoteKind.plain)
    # Recurrence rule for a loop (set at crack-open). 'none' for one-off
    # loops and all plain notes. See docs/IA.md ("Recurrence").
    recurrence = sa.Column(
        sa.Enum(NoteRecurrence), nullable=False, default=NoteRecurrence.none
    )
    # When a regenerated recurring instance becomes visible. NULL = visible
    # now (every normal loop and plain note). A future value hides the note
    # (and its children) from GET /notes until the interval arrives —
    # fog-of-war extended to time.
    scheduled_for = sa.Column(sa.DateTime, nullable=True)
    # datetime.utcnow(), not a DB-side default: sibling ordering relies on
    # created_at being distinct per row, and objects are constructed one
    # at a time in Python (even within a single crack-open transaction),
    # so this advances per row. See docs/DECISIONS.md.
    created_at = sa.Column(sa.DateTime, nullable=False, default=datetime.utcnow)


sa.Index("notes_parent_id_idx", Note.parent_id)
sa.Index("notes_parent_id_status_idx", Note.parent_id, Note.status)
