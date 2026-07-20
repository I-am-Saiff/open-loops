from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Note, NoteStatus
from app.schemas import CrackOpenRequest, CrackOpenResponse, NoteCreate, NoteOut

router = APIRouter(prefix="/notes", tags=["notes"])


def _to_out(note: Note) -> NoteOut:
    return NoteOut(
        id=note.id,
        parent_id=note.parent_id,
        text=note.text,
        x=note.x,
        y=note.y,
        status=note.status.value,
        created_at=note.created_at,
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

    return _to_out(note)


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
    return [_to_out(n) for n in notes]


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

    return CrackOpenResponse(parent=_to_out(note), active_child=_to_out(children[0]))
