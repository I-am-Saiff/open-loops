from datetime import datetime, timedelta
from typing import List, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import ValidationError
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.llm_client import LLMError, complete_json
from app.models import Note, NoteKind, NoteRecurrence, NoteStatus
from app.schemas import (
    CompleteResponse,
    CrackOpenRequest,
    CrackOpenResponse,
    DecomposeProposal,
    DecomposeSkipProposal,
    DecomposeStepsProposal,
    NoteCreate,
    NoteOut,
    NoteUpdate,
    PositionUpdate,
)

router = APIRouter(prefix="/notes", tags=["notes"])


def get_device_id(x_device_id: str = Header(...)) -> str:
    """The anonymous per-device owner id, sent on every request. Required —
    the frontend always generates and sends one; a missing header is a
    client bug, not a valid anonymous request. See docs/DECISIONS.md
    ("Per-device isolation")."""
    if not x_device_id.strip():
        raise HTTPException(status_code=400, detail="missing device id")
    return x_device_id


def _get_owned(db: Session, note_id: UUID, device_id: str) -> Note:
    """Fetch a note only if it belongs to this device. Returns 404 for both
    a missing note and one owned by another device — never reveal that a
    note exists under a different device, so ids can't be probed."""
    note = db.get(Note, str(note_id))
    if note is None or note.device_id != device_id:
        raise HTTPException(status_code=404, detail="note not found")
    return note


def _to_out(note: Note) -> NoteOut:
    return NoteOut(
        id=note.id,
        parent_id=note.parent_id,
        text=note.text,
        x=note.x,
        y=note.y,
        status=note.status.value,
        kind=note.kind.value,
        recurrence=note.recurrence.value,
        created_at=note.created_at,
    )


@router.post("", response_model=NoteOut, status_code=201)
def create_note(
    payload: NoteCreate,
    db: Session = Depends(get_db),
    device_id: str = Depends(get_device_id),
) -> NoteOut:
    parent_id = str(payload.parent_id) if payload.parent_id is not None else None

    # A child can only be attached to a parent this device owns.
    if parent_id is not None:
        _get_owned(db, payload.parent_id, device_id)

    # A new top-level note is a raw brain-dump line: 'plain' and 'folded'.
    # It only becomes a loop when designed (crack-open). See docs/IA.md.
    note = Note(
        device_id=device_id,
        parent_id=parent_id,
        text=payload.text,
        x=payload.x,
        y=payload.y,
        status=NoteStatus.folded,
    )
    db.add(note)
    db.commit()
    db.refresh(note)

    return _to_out(note)


@router.patch("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: UUID,
    payload: NoteUpdate,
    db: Session = Depends(get_db),
    device_id: str = Depends(get_device_id),
) -> NoteOut:
    """Notebook first: a raw brain-dump line stays editable in place."""
    note = _get_owned(db, note_id, device_id)

    note.text = payload.text
    db.commit()
    db.refresh(note)

    return _to_out(note)


@router.patch("/{note_id}/position", response_model=NoteOut)
def update_position(
    note_id: UUID,
    payload: PositionUpdate,
    db: Session = Depends(get_db),
    device_id: str = Depends(get_device_id),
) -> NoteOut:
    """Persist a Brain dump line's freeform position after a drag."""
    note = _get_owned(db, note_id, device_id)
    note.x = payload.x
    note.y = payload.y
    db.commit()
    db.refresh(note)

    return _to_out(note)


@router.get("", response_model=List[NoteOut])
def list_notes(
    db: Session = Depends(get_db), device_id: str = Depends(get_device_id)
) -> List[NoteOut]:
    # Fog-of-war enforced at the query level, not by the frontend choosing
    # not to render: 'folded' children never leave the database, so the
    # unrevealed scope of a loop is physically unavailable to the client.
    # Top-level notes (raw lines and loops, any status) always return;
    # only a child's front-facing 'active' or already-'done' steps do.
    # See docs/DECISIONS.md ("Fog of war is enforced server-side").
    notes = (
        db.query(Note)
        .filter(
            Note.device_id == device_id,
            or_(
                Note.parent_id.is_(None),
                Note.status.in_([NoteStatus.active, NoteStatus.done]),
            ),
        )
        .order_by(Note.created_at.asc())
        .all()
    )

    # Fog-of-war extended to time: a recurring loop's next instance is
    # scheduled for a future interval and stays hidden — along with its
    # steps — until then. The schedule is enforced here at query time (no
    # background worker); the instance simply appears once now catches up.
    now = datetime.utcnow()
    future_loop_ids = {
        n.id
        for n in notes
        if n.parent_id is None
        and n.scheduled_for is not None
        and n.scheduled_for > now
    }
    visible = [
        n for n in notes if n.id not in future_loop_ids and n.parent_id not in future_loop_ids
    ]
    return [_to_out(n) for n in visible]


DECOMPOSE_SYSTEM_PROMPT = """\
You break a task into a short, ordered list of concrete steps. You are a \
plain functional tool, not an assistant with a personality: no greetings, \
no commentary, no encouragement, no first person.

Given the task text, respond with a JSON object in exactly one of these \
two shapes:

1. If the task benefits from being broken down, write 3 to 6 concrete, \
sequential steps. Each step is a short plain imperative naming one action \
(e.g. "Reread the brief", "Draft the budget section", "Proofread and \
submit"):
{"type": "steps", "steps": ["first step", "second step", ...]}

2. If the task is a single action that needs no breakdown, return a skip \
with one plain line stating that:
{"type": "skip", "suggestion": "This is a single step: <the action>."}

Respond with ONLY the JSON object and nothing else.
"""


def _run_decompose(db: Session, note: Note) -> DecomposeProposal:
    """The strict step-proposer behind Loop design. A preview only — it
    never creates notes; the overlay commits the (possibly edited) list
    via crack-open. See docs/IA.md ("Loop design")."""
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


@router.post("/{note_id}/decompose", response_model=DecomposeProposal)
def decompose_note(
    note_id: UUID,
    db: Session = Depends(get_db),
    device_id: str = Depends(get_device_id),
) -> DecomposeProposal:
    """Propose a step breakdown (or a skip) for a note without creating
    anything — the AI touchpoint of the Loop design overlay. Side-effect
    free: retry it freely, ignore it and type your own. See docs/IA.md.
    """
    note = _get_owned(db, note_id, device_id)

    existing_child = db.query(Note.id).filter(Note.parent_id == note.id).first()
    if existing_child is not None:
        raise HTTPException(status_code=400, detail="note already cracked open")

    return _run_decompose(db, note)


def _crack_open(
    db: Session,
    note: Note,
    steps: List[str],
    recurrence: NoteRecurrence = NoteRecurrence.none,
) -> Tuple[Note, Note]:
    """Commit a designed step list: turn the note into a loop, insert its
    steps as folded children, and promote the first to 'active'. This is
    the sole path from plain line to loop. See docs/DECISIONS.md
    ("Creation status, and crack-open as its own endpoint")."""
    note.kind = NoteKind.loop
    note.recurrence = recurrence

    # Constructed one at a time so created_at (Python-side, see
    # app/models.py) preserves the submitted step order.
    children = [
        Note(
            device_id=note.device_id,
            kind=NoteKind.loop,
            parent_id=note.id,
            text=step_text,
            x=note.x,
            y=note.y,
            status=NoteStatus.folded,
        )
        for step_text in steps
    ]
    for child in children:
        db.add(child)

    # Exactly one child is ever 'active' at a time — the first step in
    # submission order.
    children[0].status = NoteStatus.active
    note.status = NoteStatus.active

    db.commit()
    db.refresh(note)
    db.refresh(children[0])
    return note, children[0]


@router.patch("/{note_id}/crack-open", response_model=CrackOpenResponse)
def crack_open(
    note_id: UUID,
    payload: CrackOpenRequest,
    db: Session = Depends(get_db),
    device_id: str = Depends(get_device_id),
) -> CrackOpenResponse:
    """Commit the Loop design overlay: the note becomes a loop and moves to
    Open loops with its first step live. Scope collapses here — only the
    active step is visible afterward. See docs/IA.md ("Loop design")."""
    note = _get_owned(db, note_id, device_id)

    existing_child = db.query(Note.id).filter(Note.parent_id == note.id).first()
    if existing_child is not None:
        raise HTTPException(status_code=400, detail="note already cracked open")

    note, active_child = _crack_open(
        db, note, payload.steps, NoteRecurrence(payload.recurrence)
    )
    return CrackOpenResponse(parent=_to_out(note), active_child=_to_out(active_child))


def _promote_next_sibling_or_complete_parent(
    db: Session, parent: Note
) -> Optional[Note]:
    """Called right after one of `parent`'s children was just flushed to
    'done'. Promotes the next 'folded' sibling (created_at order) to
    'active', or — if none remain — marks `parent` itself 'done' and
    recurses one level up. Returns the promoted sibling, or None if the
    parent completed instead. See docs/DECISIONS.md ("State machine")."""
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


def _next_occurrence(now: datetime, recurrence: NoteRecurrence) -> datetime:
    """When the next instance of a recurring loop should surface."""
    if recurrence == NoteRecurrence.daily:
        return now + timedelta(days=1)
    if recurrence == NoteRecurrence.weekly:
        return now + timedelta(weeks=1)
    if recurrence == NoteRecurrence.weekdays:
        # Next calendar day, skipping Sat/Sun (Mon=0 .. Sun=6).
        nxt = now + timedelta(days=1)
        while nxt.weekday() >= 5:
            nxt += timedelta(days=1)
        return nxt
    if recurrence == NoteRecurrence.monthly:
        month = now.month + 1
        year = now.year + (month - 1) // 12
        month = (month - 1) % 12 + 1
        days_in_month = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
        return now.replace(year=year, month=month, day=min(now.day, days_in_month))
    return now  # 'none' shouldn't reach here


def _regenerate_recurring(db: Session, loop: Note) -> None:
    """A recurring top-level loop just closed. Schedule its next instance:
    a fresh loop carrying the same title, recurrence, and step plan (copied
    from the just-completed instance — no AI re-run), hidden until the next
    interval. It skips Brain dump and Loop design entirely. See docs/IA.md.
    """
    step_texts = [
        child.text
        for child in (
            db.query(Note)
            .filter(Note.parent_id == loop.id)
            .order_by(Note.created_at.asc())
            .all()
        )
    ]
    if not step_texts:
        return

    now = datetime.utcnow()
    nxt = Note(
        device_id=loop.device_id,
        text=loop.text,
        x=loop.x,
        y=loop.y,
        kind=NoteKind.loop,
        recurrence=loop.recurrence,
        status=NoteStatus.active,
        scheduled_for=_next_occurrence(now, loop.recurrence),
    )
    db.add(nxt)
    db.flush()  # assign nxt.id for the children's parent_id

    children = [
        Note(
            device_id=loop.device_id,
            kind=NoteKind.loop,
            parent_id=nxt.id,
            text=text,
            x=loop.x,
            y=loop.y,
            status=NoteStatus.folded,
        )
        for text in step_texts
    ]
    for child in children:
        db.add(child)
    children[0].status = NoteStatus.active
    db.flush()


@router.patch("/{note_id}/complete", response_model=CompleteResponse)
def complete_note(
    note_id: UUID,
    db: Session = Depends(get_db),
    device_id: str = Depends(get_device_id),
) -> CompleteResponse:
    """Mark the active step done and advance the loop: promote the next
    step, or — if this was the last — close the loop (it moves to Closed
    loops). See docs/IA.md ("Open loops")."""
    note = _get_owned(db, note_id, device_id)
    if note.status == NoteStatus.done:
        raise HTTPException(status_code=400, detail="note already done")

    # A note can't be completed while it still has pending (non-done)
    # sub-steps — that would bypass its children's fog-of-war progression.
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
    db.flush()

    promoted_sibling = None
    parent = None
    if note.parent_id is not None:
        parent = db.get(Note, note.parent_id)
        promoted_sibling = _promote_next_sibling_or_complete_parent(db, parent)

    # If a recurring top-level loop just closed, schedule its next instance.
    if (
        parent is not None
        and parent.parent_id is None
        and parent.status == NoteStatus.done
        and parent.recurrence != NoteRecurrence.none
    ):
        _regenerate_recurring(db, parent)

    db.commit()
    db.refresh(note)
    if promoted_sibling is not None:
        db.refresh(promoted_sibling)
    if parent is not None:
        db.refresh(parent)

    return CompleteResponse(
        note=_to_out(note),
        promoted_sibling=_to_out(promoted_sibling) if promoted_sibling else None,
        parent=_to_out(parent) if parent is not None else None,
    )


@router.delete("/{note_id}", status_code=204)
def delete_note(
    note_id: UUID,
    db: Session = Depends(get_db),
    device_id: str = Depends(get_device_id),
) -> None:
    """Permanently delete a note and, via ON DELETE CASCADE, its children.
    Serves deleting a raw brain-dump line or discarding a loop."""
    note = _get_owned(db, note_id, device_id)

    db.delete(note)
    db.commit()
