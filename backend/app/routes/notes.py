from datetime import datetime, timedelta
from typing import List, Union
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.llm_client import LLMError, complete_json
from app.models import Note, NoteStatus
from app.schemas import (
    CompleteResponse,
    CrackOpenRequest,
    CrackOpenResponse,
    DecomposeSkipProposal,
    DecomposeStepsProposal,
    NoteCreate,
    NoteOut,
)

router = APIRouter(prefix="/notes", tags=["notes"])

# Feature B thresholds — see docs/DECISIONS.md ("Feature B").
STALE_MIN_PEEK_COUNT = 3
STALE_MIN_AGE = timedelta(days=3)


def _is_stale(db: Session, note: Note) -> bool:
    if note.peek_count < STALE_MIN_PEEK_COUNT:
        return False
    if datetime.utcnow() - note.created_at < STALE_MIN_AGE:
        return False
    completed_child = (
        db.query(Note.id)
        .filter(Note.parent_id == note.id, Note.status == NoteStatus.done)
        .first()
    )
    return completed_child is None


def _to_out(db: Session, note: Note) -> NoteOut:
    return NoteOut(
        id=note.id,
        parent_id=note.parent_id,
        text=note.text,
        x=note.x,
        y=note.y,
        status=note.status.value,
        created_at=note.created_at,
        stale=_is_stale(db, note),
    )


@router.post("", response_model=NoteOut, status_code=201)
def create_note(payload: NoteCreate, db: Session = Depends(get_db)) -> NoteOut:
    parent_id = str(payload.parent_id) if payload.parent_id is not None else None

    if parent_id is not None and db.get(Note, parent_id) is None:
        raise HTTPException(status_code=404, detail="parent note not found")

    # status is always 'folded' on creation, whether this is a new
    # top-level loop or a sub-step appended to an already cracked-open
    # loop — see docs/DECISIONS.md ("Creation status, and crack-open
    # as its own endpoint"). Only the crack-open endpoint and the
    # sibling-promotion step are allowed to set status = 'active'.
    note = Note(
        parent_id=parent_id,
        text=payload.text,
        x=payload.x,
        y=payload.y,
        status=NoteStatus.folded,
    )
    db.add(note)
    db.commit()
    db.refresh(note)

    return _to_out(db, note)


@router.get("", response_model=List[NoteOut])
def list_notes(db: Session = Depends(get_db)) -> List[NoteOut]:
    # Fog-of-war enforced at the query level, not by the frontend choosing
    # not to render: 'folded' children never leave the database. See
    # docs/DECISIONS.md ("Fog of war is enforced server-side").
    notes = (
        db.query(Note)
        .filter(
            or_(
                Note.parent_id.is_(None),
                Note.status.in_([NoteStatus.active, NoteStatus.done]),
            )
        )
        .order_by(Note.created_at.asc())
        .all()
    )
    return [_to_out(db, n) for n in notes]


@router.patch("/{note_id}/crack-open", response_model=CrackOpenResponse)
def crack_open(
    note_id: UUID, payload: CrackOpenRequest, db: Session = Depends(get_db)
) -> CrackOpenResponse:
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")

    existing_child = (
        db.query(Note.id).filter(Note.parent_id == note.id).first()
    )
    if existing_child is not None:
        raise HTTPException(status_code=400, detail="note already cracked open")

    # Children start at the parent's position — the user drags them out
    # from there. Constructed one at a time so created_at (Python-side,
    # see app/models.py) preserves the submitted step order.
    children = [
        Note(
            parent_id=note.id,
            text=step_text,
            x=note.x,
            y=note.y,
            status=NoteStatus.folded,
        )
        for step_text in payload.steps
    ]
    for child in children:
        db.add(child)

    # Exactly one child is ever 'active' at a time — the first step in
    # submission order. See docs/DECISIONS.md ("Creation status, and
    # crack-open as its own endpoint").
    children[0].status = NoteStatus.active
    note.status = NoteStatus.active

    db.commit()
    db.refresh(note)
    db.refresh(children[0])

    return CrackOpenResponse(parent=_to_out(db, note), active_child=_to_out(db, children[0]))


DECOMPOSE_SYSTEM_PROMPT = """\
You help someone break down a vague task into a concrete plan, or tell \
them when the task isn't worth doing as stated.

Given the task text, respond with a JSON object in exactly one of these \
two shapes:

1. If the task benefits from being broken into steps, propose 3 to 6 \
concrete, sequential, actionable sub-steps:
{"type": "steps", "steps": ["first step", "second step", ...]}

2. If the task is trivial, easily avoidable, or better handled by \
outsourcing/delegating than doing it yourself, say so instead of \
proposing steps:
{"type": "skip", "suggestion": "a short, concrete alternative"}

Respond with ONLY the JSON object and nothing else.
"""


@router.post("/{note_id}/decompose")
def decompose_note(
    note_id: UUID, db: Session = Depends(get_db)
) -> Union[DecomposeStepsProposal, DecomposeSkipProposal]:
    """Preview only — proposes a step breakdown (or a skip suggestion) for
    a note without creating anything. The user confirms or edits the
    proposal client-side; only then does POST /notes/{id}/crack-open (the
    existing endpoint, unchanged) actually create the children. See
    docs/DECISIONS.md ("Feature A: LLM-proposed decomposition").
    """
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")

    existing_child = db.query(Note.id).filter(Note.parent_id == note.id).first()
    if existing_child is not None:
        raise HTTPException(status_code=400, detail="note already cracked open")

    try:
        raw_proposal = complete_json(DECOMPOSE_SYSTEM_PROMPT, note.text)
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    proposal_type = raw_proposal.get("type")
    try:
        if proposal_type == "steps":
            return DecomposeStepsProposal(**raw_proposal)
        if proposal_type == "skip":
            return DecomposeSkipProposal(**raw_proposal)
        raise ValueError(f"unknown proposal type: {proposal_type!r}")
    except (ValidationError, ValueError) as exc:
        raise HTTPException(
            status_code=502, detail=f"LLM returned a malformed proposal: {exc}"
        )


def _promote_next_sibling_or_complete_parent(db: Session, parent: Note):
    """Called right after one of `parent`'s children was just flushed to
    'done'. Promotes the next 'folded' sibling (created_at order) to
    'active', or — if none remain — marks `parent` itself 'done' and
    recurses one level up. Returns the promoted sibling Note, or None if
    the parent completed instead. See docs/DECISIONS.md ("State machine:
    exact transition rules").
    """
    next_sibling = (
        db.query(Note)
        .filter(Note.parent_id == parent.id, Note.status == NoteStatus.folded)
        .order_by(Note.created_at.asc())
        .first()
    )
    if next_sibling is not None:
        next_sibling.status = NoteStatus.active
        db.flush()
        return next_sibling

    remaining = (
        db.query(Note.id)
        .filter(Note.parent_id == parent.id, Note.status != NoteStatus.done)
        .first()
    )
    if remaining is None:
        parent.status = NoteStatus.done
        db.flush()
        if parent.parent_id is not None:
            grandparent = db.get(Note, parent.parent_id)
            _promote_next_sibling_or_complete_parent(db, grandparent)
    return None


@router.patch("/{note_id}/complete", response_model=CompleteResponse)
def complete_note(note_id: UUID, db: Session = Depends(get_db)) -> CompleteResponse:
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")
    if note.status == NoteStatus.done:
        raise HTTPException(status_code=400, detail="note already done")

    # A note can't be completed directly while it still has pending
    # (non-done) sub-steps — otherwise completing a parent would bypass
    # its children's fog-of-war progression entirely. This also covers
    # the "folded parent with children" case, which shouldn't occur under
    # the current invariants (crack-open flips the parent to 'active'
    # immediately) but is guarded defensively.
    pending_children = (
        db.query(Note.id)
        .filter(Note.parent_id == note.id, Note.status != NoteStatus.done)
        .first()
    )
    if pending_children is not None:
        raise HTTPException(
            status_code=400,
            detail="note has pending sub-steps and cannot be completed directly",
        )

    note.status = NoteStatus.done
    db.flush()  # so the sibling/parent queries below see this note as done

    promoted_sibling = None
    parent = None
    if note.parent_id is not None:
        parent = db.get(Note, note.parent_id)
        promoted_sibling = _promote_next_sibling_or_complete_parent(db, parent)

    db.commit()
    db.refresh(note)
    if promoted_sibling is not None:
        db.refresh(promoted_sibling)
    if parent is not None:
        db.refresh(parent)

    return CompleteResponse(
        note=_to_out(db, note),
        promoted_sibling=_to_out(db, promoted_sibling) if promoted_sibling else None,
        parent=_to_out(db, parent) if parent is not None else None,
    )


@router.patch("/{note_id}/peek", response_model=NoteOut)
def peek_note(note_id: UUID, db: Session = Depends(get_db)) -> NoteOut:
    """Call whenever a folded loop is opened/viewed without progress being
    made — never on completion. Purely a counter; doesn't touch status.
    See docs/DECISIONS.md ("Feature B").
    """
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")

    note.peek_count += 1
    note.last_peeked_at = datetime.utcnow()
    db.commit()
    db.refresh(note)

    return _to_out(db, note)


@router.patch("/{note_id}/keep", response_model=NoteOut)
def keep_note(note_id: UUID, db: Session = Depends(get_db)) -> NoteOut:
    """"Keep it" on a stale-flagged note: resets peek_count to 0 so the
    note stops being flagged stale, without touching anything else."""
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")

    note.peek_count = 0
    db.commit()
    db.refresh(note)

    return _to_out(db, note)


@router.delete("/{note_id}", status_code=204)
def dissolve_note(note_id: UUID, db: Session = Depends(get_db)) -> None:
    """"Let it go" on a stale-flagged note: permanently deletes it (and,
    via the SQLite ON DELETE CASCADE foreign key, any children) — this is
    an actual delete, not a status change, matching the "tearing out a
    page" framing. Not restricted to stale notes at the API level; the
    frontend only offers this action from the stale-note prompt."""
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")

    db.delete(note)
    db.commit()
