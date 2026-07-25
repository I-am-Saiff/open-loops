from datetime import datetime, timedelta
from typing import List, Optional, Tuple, Union
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.llm_client import LLMError, complete_json
from app.models import Message, MessageKind, MessageSender, Note, NoteStatus
from app.schemas import (
    CompleteResponse,
    CrackOpenRequest,
    CrackOpenResponse,
    DecomposeChatProposal,
    DecomposeClarifyProposal,
    DecomposeSkipProposal,
    DecomposeStepsProposal,
    LinkRequest,
    MergeSuggestion,
    NoteCreate,
    NoteOut,
)

router = APIRouter(prefix="/notes", tags=["notes"])

# Feature B thresholds — see docs/DECISIONS.md ("Feature B").
STALE_MIN_PEEK_COUNT = 3
STALE_MIN_AGE = timedelta(days=3)


def _generate_companion_message(system_prompt: str, context: str) -> Optional[str]:
    """Best-effort LLM-authored text for a proactive nudge (stale/merge).
    Returns None on any failure so callers fall back to a plain templated
    message — a failed nudge should never break the interaction it's
    attached to. See docs/DECISIONS.md ("Feature B/C, in-thread")."""
    try:
        raw = complete_json(system_prompt, context)
    except LLMError:
        return None
    text = raw.get("message")
    if isinstance(text, str) and text.strip():
        return text.strip()
    return None


STALE_NUDGE_SYSTEM_PROMPT = """\
You are a warm, casual companion checking in on someone about a task \
they've been avoiding — they've looked at it a few times without making \
any progress. Write ONE short, casual message (1-2 sentences) gently \
asking if they still want to do this, the way a friend would text it —
not preachy or guilt-tripping. Respond with JSON: {"message": "..."}
"""

MERGE_NUDGE_SYSTEM_PROMPT = """\
You are a warm, casual companion who just noticed someone's new task \
overlaps with something they're already doing elsewhere. Write ONE \
short, casual message (1-2 sentences) pointing out the overlap and \
asking if they want to combine the two, the way a friend would text it. \
You'll be given the overlapping step text and the name of the other \
task. Respond with JSON: {"message": "..."}
"""


def _is_stale(db: Session, note: Note) -> bool:
    # Bug fix, caught while building the backlog-pressure signal below: a
    # leaf note (no children) that was already stale-flagged at the
    # moment it got completed would register as stale *forever*
    # afterward — peek_count never decreases, and "no completed child"
    # is vacuously true for a childless note regardless of its own
    # status. Not exercised by earlier tests since none of them
    # completed an already-stale leaf note. See docs/DECISIONS.md
    # ("Ambient mood").
    if note.status == NoteStatus.done:
        return False
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


# Ambient mood — see docs/DECISIONS.md ("Ambient mood"). Deliberately
# never exposed as a number, badge, or icon anywhere in the API or UI;
# it only ever selects which TONE_HINTS snippet gets appended to a
# companion-message system prompt.
def _backlog_pressure(db: Session) -> str:
    open_loops = (
        db.query(Note).filter(Note.parent_id.is_(None), Note.status != NoteStatus.done).all()
    )
    if not open_loops:
        return "low"
    stale_count = sum(1 for n in open_loops if _is_stale(db, n))
    ratio = stale_count / len(open_loops)
    if ratio >= 0.5:
        return "high"
    if ratio > 0:
        return "medium"
    return "low"


TONE_HINTS = {
    "low": (
        " Right now this person is on top of things, so keep your tone warm, "
        "upbeat, and a little more chatty than usual."
    ),
    "medium": (
        " Keep your tone friendly and even — not overly cheerful, not "
        "somber, just steady."
    ),
    "high": (
        " This person has a lot piling up right now, so keep your tone quiet "
        "and a bit worn down, like a friend who's got a lot on their own "
        "plate too — shorter sentences, no exclamation points, still kind "
        "but not falsely cheerful."
    ),
}


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
        linked_note_id=note.linked_note_id,
        last_peeked_at=note.last_peeked_at,
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


def _crack_open(db: Session, note: Note, steps: List[str]) -> Tuple[Note, Note]:
    """Shared by the HTTP route below and the chat-thread orchestration in
    routes/threads.py — the actual note-creation logic never duplicates.
    Caller is responsible for the "already cracked open" guard (it needs
    to run before any LLM call in the thread-start flow, so it can't live
    here). See docs/DECISIONS.md ("Chat thread: schema and orchestration").
    """
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
        for step_text in steps
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
    return note, children[0]


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

    note, active_child = _crack_open(db, note, payload.steps)
    return CrackOpenResponse(parent=_to_out(db, note), active_child=_to_out(db, active_child))


DECOMPOSE_SYSTEM_PROMPT = """\
You are a warm, casual companion inside someone's to-do notebook — like \
a friend texting them through their tasks one step at a time, not a \
project manager handing over a checklist.

The user just wrote something on a new note. FIRST, silently classify \
what they wrote:

- a TASK: a real, actionable thing to do (e.g. "cook biryani thursday", \
"renew my passport")
- NOT a task: a greeting, a person's name on its own, random text, \
venting, or a question that isn't something for them to go do (e.g. \
"hey", "priya", "what should i eat", "ugh today sucked")
- AMBIGUOUS: could be a task but too underspecified to break down \
(e.g. "gym", "mom", "the email")

Then respond with a JSON object in exactly one of these four shapes:

1. A task that benefits from being broken into steps — write 3 to 6 \
concrete, sequential steps as short conversational messages, the way \
you'd actually text a friend the next thing to do (e.g. "first, prep \
your ingredients — chicken, onions, ginger, garlic, curry spices. lmk \
when that's done" rather than "Prep ingredients"). Each one should read \
like a message, not a bullet point:
{"type": "steps", "steps": ["first step as a casual message", "second step as a casual message", ...]}

2. A task that is trivial, easily avoidable, or better handled by \
outsourcing/delegating than doing it yourself — one casual message \
saying so and suggesting the alternative, the way a friend would:
{"type": "skip", "suggestion": "a short, casual message with the alternative"}

3. NOT a task — one short, warm, in-character reply: acknowledge what \
they said the way a friend would, then gently invite them to drop a \
task they've been putting off. Never scold, never explain that you're \
a task app, never treat it as an error:
{"type": "chat", "reply": "a short warm message"}

4. AMBIGUOUS — ask exactly ONE short, conversational question to pin \
down what they actually mean, nothing else:
{"type": "clarify", "question": "one short question"}

If the user's message includes a clarification they gave when asked, \
read the original note and the clarification together — with that added \
context, strongly prefer shape 1 or 2 over asking again.

Respond with ONLY the JSON object and nothing else.
"""


MERGE_SYSTEM_PROMPT = """\
You compare a new task's proposed steps against pending steps from a \
person's other in-progress tasks, looking for genuine real-world overlap \
— the same action, not just similar wording (e.g. both involve grocery \
shopping, or both involve the same phone call).

Respond with JSON in exactly one of these two shapes:

1. If exactly one step from the new task overlaps with exactly one \
pending step from another task:
{"match": true, "new_step": "<verbatim text of the new task's step>", \
"existing_note_id": "<the id given for that pending step>", \
"existing_step": "<verbatim text of that pending step>"}

2. If there is no genuine overlap:
{"match": false}

Only report the single clearest overlap, if any. Copy new_step, \
existing_step, and existing_note_id verbatim from what you were given —
do not paraphrase or invent values.
"""


def _find_merge_suggestion(
    db: Session, note: Note, steps: List[str]
) -> Optional[MergeSuggestion]:
    """Feature C: compares `steps` (a decompose proposal that hasn't been
    committed to real notes yet) against the pending — folded or active,
    i.e. not-done — children of every other top-level 'active' loop.
    Best-effort: any failure (LLM error, malformed/unverifiable response)
    just means no suggestion, never breaks decompose. See
    docs/DECISIONS.md ("Feature C").
    """
    other_loop_ids = [
        row[0]
        for row in db.query(Note.id)
        .filter(
            Note.parent_id.is_(None),
            Note.status == NoteStatus.active,
            Note.id != note.id,
        )
        .all()
    ]
    if not other_loop_ids:
        return None

    pending_steps: List[Tuple[str, str]] = (
        db.query(Note.id, Note.text)
        .filter(Note.parent_id.in_(other_loop_ids), Note.status != NoteStatus.done)
        .all()
    )
    if not pending_steps:
        return None

    candidates_text = "\n".join(f'- id: {pid}\n  step: "{text}"' for pid, text in pending_steps)
    new_steps_text = "\n".join(f"- {s}" for s in steps)
    user_prompt = (
        f"New task's proposed steps:\n{new_steps_text}\n\n"
        f"Other in-progress tasks' pending steps:\n{candidates_text}\n"
    )

    try:
        raw = complete_json(MERGE_SYSTEM_PROMPT, user_prompt)
    except LLMError:
        return None

    if not raw.get("match"):
        return None

    new_step = raw.get("new_step")
    existing_note_id = raw.get("existing_note_id")
    existing_step = raw.get("existing_step")

    # Verify against the real candidate set rather than trusting the LLM's
    # echo — fail safe (no suggestion) rather than surfacing a
    # hallucinated id or paraphrased text.
    valid_pending = {(pid, text) for pid, text in pending_steps}
    if new_step not in steps or (existing_note_id, existing_step) not in valid_pending:
        return None

    try:
        return MergeSuggestion(
            new_step=new_step, existing_note_id=existing_note_id, existing_step=existing_step
        )
    except ValidationError:
        return None


DecomposeProposal = Union[
    DecomposeStepsProposal,
    DecomposeSkipProposal,
    DecomposeChatProposal,
    DecomposeClarifyProposal,
]


def _run_decompose(
    db: Session, note: Note, clarification: Optional[str] = None
) -> DecomposeProposal:
    """The actual decompose logic — reusable by the standalone HTTP route
    below and by the chat-thread orchestration in routes/threads.py.
    Callers own the "already cracked open" guard, since it needs to run
    before any LLM call and threads.py has its own version of it (a
    thread can exist without children yet, in the skip case).

    Classification (task / not-a-task / ambiguous) happens inside the
    same single LLM call — no extra round-trip. `clarification` is the
    user's answer to an earlier clarify question; passing it re-enters
    the same call with the original note text as context. See
    docs/DECISIONS.md ("Input classification").
    """
    if clarification is None:
        user_prompt = note.text
    else:
        user_prompt = (
            f'They originally wrote: "{note.text}"\n'
            f'When asked to clarify, they said: "{clarification}"'
        )

    tone_hint = TONE_HINTS[_backlog_pressure(db)]
    try:
        raw_proposal = complete_json(DECOMPOSE_SYSTEM_PROMPT + tone_hint, user_prompt)
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    proposal_type = raw_proposal.get("type")
    try:
        if proposal_type == "steps":
            proposal = DecomposeStepsProposal(**raw_proposal)
            proposal.merge_suggestion = _find_merge_suggestion(db, note, proposal.steps)
            return proposal
        if proposal_type == "skip":
            return DecomposeSkipProposal(**raw_proposal)
        if proposal_type == "chat":
            return DecomposeChatProposal(**raw_proposal)
        if proposal_type == "clarify":
            return DecomposeClarifyProposal(**raw_proposal)
        raise ValueError(f"unknown proposal type: {proposal_type!r}")
    except (ValidationError, ValueError) as exc:
        raise HTTPException(
            status_code=502, detail=f"LLM returned a malformed proposal: {exc}"
        )


@router.post("/{note_id}/decompose")
def decompose_note(
    note_id: UUID, db: Session = Depends(get_db)
) -> DecomposeProposal:
    """Preview only — proposes a step breakdown (or a skip suggestion) for
    a note without creating anything. Kept as its own clean, side-effect-
    free endpoint; the chat-thread flow (routes/threads.py) calls
    _run_decompose directly rather than hitting this over HTTP, but the
    logic is identical either way. See docs/DECISIONS.md.
    """
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")

    existing_child = db.query(Note.id).filter(Note.parent_id == note.id).first()
    if existing_child is not None:
        raise HTTPException(status_code=400, detail="note already cracked open")

    return _run_decompose(db, note)


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


def _record_progress_message(
    db: Session, parent: Note, promoted_sibling: Optional[Note]
) -> Optional[Message]:
    """Appends the chat-thread message a completion produces: the next
    step (its text is already conversational — decompose wrote it that
    way, see DECOMPOSE_SYSTEM_PROMPT) or, if the whole loop just
    finished, a short acknowledgment. Always attached to `parent`'s own
    thread (note_id = parent.id), even when called for a cascaded linked
    note in a different loop — that loop's own thread is what should show
    its own progress. See docs/DECISIONS.md ("Chat thread").
    """
    if promoted_sibling is not None:
        msg = Message(
            note_id=parent.id,
            sender=MessageSender.companion,
            kind=MessageKind.step,
            text=promoted_sibling.text,
            related_note_id=promoted_sibling.id,
        )
    elif parent.status == NoteStatus.done:
        msg = Message(
            note_id=parent.id,
            sender=MessageSender.companion,
            kind=MessageKind.done,
            text="that's everything for this one — nice work.",
        )
    else:
        # Defensive: _promote_next_sibling_or_complete_parent always
        # either promotes a sibling or completes the parent under the
        # current invariants. Nothing to say if somehow neither happened.
        return None
    db.add(msg)
    db.flush()
    return msg


def _complete_note(
    db: Session, note: Note, messages: List[Message]
) -> Tuple[Optional[Note], Optional[Note]]:
    """Marks `note` done and runs its own promotion/parent-completion
    chain. If `note` is linked to another note (Feature C — see
    docs/DECISIONS.md) AND that note is currently its own loop's
    front-facing 'active' step, completing `note` also completes it —
    "completing one auto-completes the other and both parents get
    credit." Returns (promoted_sibling, parent) for `note` itself only;
    the linked note's own promotion is applied to the DB but not
    reflected in the return value — `messages` (mutated in place)
    collects every chat message this call produced, across both the
    primary note and any cascade, so callers can see what happened in
    every thread touched, not just the one they called about.

    Deliberately does NOT cascade if the linked note is still 'folded'
    (i.e. it isn't that note's turn yet in its own loop's sequence) —
    doing so would force-complete a step out of order and leave two
    children 'active' at once in that loop, breaking the core
    fog-of-war invariant. Known limitation, not built out further: if
    you link a step before its own turn comes up, completing its
    counterpart elsewhere does not retroactively complete it once its
    turn does arrive. See docs/DECISIONS.md ("Feature C").
    """
    note.status = NoteStatus.done
    db.flush()

    promoted_sibling = None
    parent = None
    if note.parent_id is not None:
        parent = db.get(Note, note.parent_id)
        promoted_sibling = _promote_next_sibling_or_complete_parent(db, parent)
        msg = _record_progress_message(db, parent, promoted_sibling)
        if msg is not None:
            messages.append(msg)

    if note.linked_note_id is not None:
        linked = db.get(Note, note.linked_note_id)
        if linked is not None and linked.status == NoteStatus.active:
            linked_pending_children = (
                db.query(Note.id)
                .filter(Note.parent_id == linked.id, Note.status != NoteStatus.done)
                .first()
            )
            if linked_pending_children is None:
                _complete_note(db, linked, messages)

    return promoted_sibling, parent


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

    promoted_sibling, parent = _complete_note(db, note, [])

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


@router.patch("/{note_id}/link", response_model=NoteOut)
def link_notes(
    note_id: UUID, payload: LinkRequest, db: Session = Depends(get_db)
) -> NoteOut:
    """Accepts a Feature C merge suggestion: links two step notes
    symmetrically so completing either cascades to the other (see
    _complete_note). See docs/DECISIONS.md ("Feature C")."""
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")
    other = db.get(Note, str(payload.other_note_id))
    if other is None:
        raise HTTPException(status_code=404, detail="other note not found")
    if note.id == other.id:
        raise HTTPException(status_code=400, detail="cannot link a note to itself")
    if note.status == NoteStatus.done or other.status == NoteStatus.done:
        raise HTTPException(status_code=400, detail="cannot link an already-done step")
    if note.linked_note_id is not None or other.linked_note_id is not None:
        raise HTTPException(status_code=400, detail="one of these notes is already linked")

    note.linked_note_id = other.id
    other.linked_note_id = note.id

    # Resolve whichever direction the merge_prompt was actually created
    # in (it lives in the *new* loop's thread, related_note_id pointing
    # at the *existing* step — but link_notes doesn't know which of
    # note/other was which, so check both). See docs/DECISIONS.md
    # ("Feature C, in-thread").
    merge_msg = (
        db.query(Message)
        .filter(
            Message.kind == MessageKind.merge_prompt,
            Message.resolved.is_(False),
            or_(
                and_(Message.note_id == note.parent_id, Message.related_note_id == other.id),
                and_(Message.note_id == other.parent_id, Message.related_note_id == note.id),
            ),
        )
        .first()
    )
    if merge_msg is not None:
        merge_msg.resolved = True

    db.commit()
    db.refresh(note)

    return _to_out(db, note)


@router.patch("/{note_id}/peek", response_model=NoteOut)
def peek_note(note_id: UUID, db: Session = Depends(get_db)) -> NoteOut:
    """Call whenever a folded loop is opened/viewed without progress being
    made — never on completion. Purely a counter; doesn't touch status.

    If this peek pushes the note from not-stale to stale (the "rising
    edge" — checked before vs. after incrementing), the companion sends
    an unprompted nudge into the note's own thread. Checking the edge
    rather than "is it currently stale" avoids re-nudging on every single
    peek while already stale; the note only nudges again after "keep it"
    resets the counter and it climbs back up. See docs/DECISIONS.md
    ("Feature B, in-thread").
    """
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")

    was_stale = _is_stale(db, note)
    note.peek_count += 1
    note.last_peeked_at = datetime.utcnow()
    db.flush()
    now_stale = _is_stale(db, note)

    if now_stale and not was_stale:
        tone_hint = TONE_HINTS[_backlog_pressure(db)]
        nudge_text = _generate_companion_message(
            STALE_NUDGE_SYSTEM_PROMPT + tone_hint, f'Task: "{note.text}"'
        )
        if nudge_text is None:
            nudge_text = "you've looked at this a few times and nothing's moved — still worth keeping?"
        db.add(
            Message(
                note_id=note.id,
                sender=MessageSender.companion,
                kind=MessageKind.stale_prompt,
                text=nudge_text,
            )
        )

    db.commit()
    db.refresh(note)

    return _to_out(db, note)


@router.patch("/{note_id}/keep", response_model=NoteOut)
def keep_note(note_id: UUID, db: Session = Depends(get_db)) -> NoteOut:
    """"Keep it" on a stale-flagged note: resets peek_count to 0, and
    resolves any pending stale_prompt(s) in its thread so the buttons
    stop offering an already-answered question on reload."""
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")

    note.peek_count = 0
    db.query(Message).filter(
        Message.note_id == note.id,
        Message.kind == MessageKind.stale_prompt,
        Message.resolved.is_(False),
    ).update({Message.resolved: True})
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
