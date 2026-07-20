from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


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
