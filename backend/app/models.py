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

    # Feature C: cross-loop merge. Symmetric — set on both notes when a
    # merge suggestion is accepted via PATCH /notes/{id}/link, so either
    # side completing cascades to the other. See docs/DECISIONS.md
    # ("Feature C").
    linked_note_id = sa.Column(
        sa.String, sa.ForeignKey("notes.id", ondelete="SET NULL"), nullable=True
    )


sa.Index("notes_parent_id_idx", Note.parent_id)
sa.Index("notes_parent_id_status_idx", Note.parent_id, Note.status)


class MessageSender(str, enum.Enum):
    companion = "companion"
    user = "user"


class MessageKind(str, enum.Enum):
    # A companion message announcing the current front-facing step —
    # text is just that step note's own text (already conversational,
    # from decompose). related_note_id points at the step note.
    step = "step"
    # A companion message offering to close out a trivial task instead
    # of proposing steps (decompose's "skip" proposal, surfaced as chat).
    skip_prompt = "skip_prompt"
    # Free-text the user typed into the thread.
    user_reply = "user_reply"
    # Companion's plain-sentence reply to a user_reply, covering
    # everything done + everything ahead — the one deliberate fog-of-war
    # bypass, only on explicit request. See docs/DECISIONS.md.
    summary = "summary"
    # Companion's acknowledgment that a loop just fully completed.
    done = "done"
    # Proactive: "you've looked at this a few times and nothing's
    # moved" — see PATCH /notes/{id}/peek. See docs/DECISIONS.md
    # ("Feature B, in-thread").
    stale_prompt = "stale_prompt"
    # Proactive: a new loop's first step overlaps a pending step in
    # another loop — see POST /notes/{id}/thread/start's merge
    # detection. related_note_id is the *other* loop's matching step.
    # See docs/DECISIONS.md ("Feature C, in-thread").
    merge_prompt = "merge_prompt"


class Message(Base):
    __tablename__ = "messages"

    id = sa.Column(sa.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    # The THREAD this message belongs to — always a top-level loop's id,
    # one thread per loop, regardless of which step the message concerns.
    note_id = sa.Column(sa.String, sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=False)
    sender = sa.Column(sa.Enum(MessageSender), nullable=False)
    kind = sa.Column(sa.Enum(MessageKind), nullable=False)
    text = sa.Column(sa.String, nullable=False)
    # For kind='step': the step note this message announces. Nullable —
    # not every kind references a note.
    related_note_id = sa.Column(
        sa.String, sa.ForeignKey("notes.id", ondelete="SET NULL"), nullable=True
    )
    # Only meaningful for stale_prompt/merge_prompt (the two kinds with
    # reply buttons) — set True once the user acts on it (or its
    # counterpart action makes it moot), so the buttons don't keep
    # offering an already-decided choice on reload. Other kinds just
    # leave this False forever. See docs/DECISIONS.md.
    resolved = sa.Column(sa.Boolean, nullable=False, default=False)
    created_at = sa.Column(sa.DateTime, nullable=False, default=datetime.utcnow)


sa.Index("messages_note_id_idx", Message.note_id)
