from datetime import datetime
from typing import List, Literal, Optional, Union
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
    # 'plain' (a raw brain-dump line) or 'loop' (designed, has steps).
    kind: str
    # 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'.
    recurrence: str
    created_at: datetime


# Notebook first: raw brain-dump lines stay editable.
class NoteUpdate(BaseModel):
    text: str = Field(min_length=1)


class CrackOpenRequest(BaseModel):
    # Ordered step texts — list order decides which one becomes the
    # front-facing 'active' step first. See docs/DECISIONS.md.
    steps: List[str] = Field(min_length=1)
    # Recurrence rule set in Loop design; defaults to a one-off loop.
    recurrence: Literal["none", "daily", "weekdays", "weekly", "monthly"] = "none"


class CrackOpenResponse(BaseModel):
    parent: NoteOut
    active_child: NoteOut


class CompleteResponse(BaseModel):
    note: NoteOut
    # The sibling promoted to 'active' as a result, if any.
    promoted_sibling: Optional[NoteOut] = None
    # The immediate parent's current state, if this note had one — may
    # still be 'active' (a sibling was promoted) or now 'done' (this was
    # the last child). See docs/DECISIONS.md for the transition rule.
    parent: Optional[NoteOut] = None


# Loop design's strict step-proposer. A preview only — decompose never
# creates notes itself; the Loop design overlay commits the (edited)
# list via crack-open. See docs/IA.md ("Loop design").
class DecomposeStepsProposal(BaseModel):
    type: Literal["steps"] = "steps"
    steps: List[str] = Field(min_length=1)


class DecomposeSkipProposal(BaseModel):
    type: Literal["skip"] = "skip"
    suggestion: str


DecomposeProposal = Union[DecomposeStepsProposal, DecomposeSkipProposal]
