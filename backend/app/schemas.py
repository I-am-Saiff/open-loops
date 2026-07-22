from datetime import datetime
from typing import List, Literal, Optional
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
    # Feature B: computed, not stored — see docs/DECISIONS.md.
    stale: bool
    # Feature C: set by PATCH /notes/{id}/link — see docs/DECISIONS.md.
    linked_note_id: Optional[UUID]


class CrackOpenRequest(BaseModel):
    # Ordered sub-step texts — list order decides which one becomes the
    # front-facing 'active' step first. See docs/DECISIONS.md.
    steps: List[str] = Field(min_length=1)


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


# Feature C: cross-loop merge. Detected as part of decompose (below), only
# ever describing a NEW proposed step (not yet a real note) matched
# against a real pending step of some other loop. See docs/DECISIONS.md.
class MergeSuggestion(BaseModel):
    new_step: str
    existing_note_id: UUID
    existing_step: str


# Feature A: LLM-proposed decomposition. A preview only — decompose never
# creates notes itself, see docs/DECISIONS.md.
class DecomposeStepsProposal(BaseModel):
    type: Literal["steps"] = "steps"
    steps: List[str] = Field(min_length=1)
    merge_suggestion: Optional[MergeSuggestion] = None


class DecomposeSkipProposal(BaseModel):
    type: Literal["skip"] = "skip"
    suggestion: str


class LinkRequest(BaseModel):
    other_note_id: UUID
