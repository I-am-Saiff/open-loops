from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class NoteCreate(BaseModel):
    parent_id: Optional[UUID] = None
    text: str
    x: float = 0
    y: float = 0


class NoteOut(BaseModel):
    id: UUID
    parent_id: Optional[UUID]
    text: str
    x: float
    y: float
    status: str
    created_at: datetime


class CrackOpenRequest(BaseModel):
    # Ordered sub-step texts — list order decides which one becomes the
    # front-facing 'active' step first. See docs/DECISIONS.md.
    steps: List[str] = Field(min_length=1)


class CrackOpenResponse(BaseModel):
    parent: NoteOut
    active_child: NoteOut
