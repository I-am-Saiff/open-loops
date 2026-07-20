from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Note, NoteStatus
from app.schemas import NoteCreate, NoteOut

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
