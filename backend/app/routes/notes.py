from fastapi import APIRouter, HTTPException

from app.db import get_pool
from app.schemas import NoteCreate, NoteOut

router = APIRouter(prefix="/notes", tags=["notes"])


@router.post("", response_model=NoteOut, status_code=201)
async def create_note(payload: NoteCreate) -> NoteOut:
    pool = get_pool()
    async with pool.acquire() as conn:
        if payload.parent_id is not None:
            parent_exists = await conn.fetchval(
                "select 1 from notes where id = $1", payload.parent_id
            )
            if not parent_exists:
                raise HTTPException(status_code=404, detail="parent note not found")

        # status is always 'folded' on creation, whether this is a new
        # top-level loop or a sub-step appended to an already cracked-open
        # loop — see docs/DECISIONS.md ("Creation status, and crack-open
        # as its own endpoint"). Only the crack-open endpoint and the
        # sibling-promotion step are allowed to set status = 'active'.
        row = await conn.fetchrow(
            """
            insert into notes (parent_id, text, x, y, status)
            values ($1, $2, $3, $4, 'folded')
            returning id, parent_id, text, x, y, status, created_at
            """,
            payload.parent_id,
            payload.text,
            payload.x,
            payload.y,
        )

    return NoteOut(**dict(row))
