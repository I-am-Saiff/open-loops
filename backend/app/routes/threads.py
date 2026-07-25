from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.llm_client import LLMError, complete_json
from app.models import Message, MessageKind, MessageSender, Note, NoteKind, NoteStatus
from app.routes.notes import (
    MERGE_NUDGE_SYSTEM_PROMPT,
    TONE_HINTS,
    _backlog_pressure,
    _complete_note,
    _crack_open,
    _generate_companion_message,
    _run_decompose,
)
from app.schemas import MessageOut, SendMessageRequest

router = APIRouter(tags=["threads"])


def _step_message(note: Note, active_child: Note) -> Message:
    return Message(
        note_id=note.id,
        sender=MessageSender.companion,
        kind=MessageKind.step,
        text=active_child.text,
        related_note_id=active_child.id,
    )


def _message_to_out(msg: Message) -> MessageOut:
    return MessageOut(
        id=msg.id,
        note_id=msg.note_id,
        sender=msg.sender.value,
        kind=msg.kind.value,
        text=msg.text,
        related_note_id=msg.related_note_id,
        resolved=msg.resolved,
        created_at=msg.created_at,
    )


@router.get("/notes/{note_id}/messages", response_model=List[MessageOut])
def list_messages(note_id: UUID, db: Session = Depends(get_db)) -> List[MessageOut]:
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")

    messages = (
        db.query(Message)
        .filter(Message.note_id == note.id)
        .order_by(Message.created_at.asc())
        .all()
    )
    return [_message_to_out(m) for m in messages]


def _act_on_proposal(db: Session, note: Note, proposal) -> List[Message]:
    """Turns a decompose proposal into state changes + thread messages.
    Does not commit — callers do."""
    messages: List[Message] = []

    if proposal.type == "steps":
        note, active_child = _crack_open(db, note, proposal.steps)
        messages.append(_step_message(note, active_child))
        db.add(messages[0])

        # Feature C, in-thread: only actionable if the matched step is
        # the one that just became active — the frontend can't draw on
        # or link to a step that's still folded on either side. See
        # docs/DECISIONS.md ("Feature C, in-thread").
        merge = proposal.merge_suggestion
        if merge is not None and merge.new_step == active_child.text:
            existing = db.get(Note, str(merge.existing_note_id))
            if existing is not None:
                other_loop = db.get(Note, existing.parent_id) if existing.parent_id else None
                other_loop_title = other_loop.text if other_loop is not None else "another loop"
                tone_hint = TONE_HINTS[_backlog_pressure(db)]
                nudge_text = _generate_companion_message(
                    MERGE_NUDGE_SYSTEM_PROMPT + tone_hint,
                    f'Overlapping step: "{existing.text}"\nOther task: "{other_loop_title}"',
                )
                if nudge_text is None:
                    nudge_text = (
                        f'you’re already doing "{existing.text}" for '
                        f'"{other_loop_title}" — want me to fold this into that?'
                    )
                merge_msg = Message(
                    note_id=note.id,
                    sender=MessageSender.companion,
                    kind=MessageKind.merge_prompt,
                    text=nudge_text,
                    related_note_id=existing.id,
                )
                db.add(merge_msg)
                messages.append(merge_msg)
    else:  # skip
        skip_msg = Message(
            note_id=note.id,
            sender=MessageSender.companion,
            kind=MessageKind.skip_prompt,
            text=proposal.suggestion,
        )
        db.add(skip_msg)
        messages.append(skip_msg)

    return messages


@router.post("/notes/{note_id}/thread/start", response_model=List[MessageOut])
def start_thread(note_id: UUID, db: Session = Depends(get_db)) -> List[MessageOut]:
    """The chat-thread replacement for the old "decompose, preview, edit,
    confirm" flow: runs decompose and immediately acts on it — no preview
    step. A 'steps' proposal is cracked open right away (same _crack_open
    every manual/AI path already used) and its first step becomes a
    'step' message; a 'skip' proposal becomes a 'skip_prompt' message
    with no notes created yet. Only ever called on consent (whisper tap
    or the note menu's "crack this") — this call is what turns a plain
    note into a loop. See docs/DECISIONS.md ("Chat thread", "Notebook
    first").
    """
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")

    existing_message = db.query(Message.id).filter(Message.note_id == note.id).first()
    if existing_message is not None:
        raise HTTPException(status_code=400, detail="thread already started")

    # Consent point. The steps path also sets this inside _crack_open,
    # but the skip path never gets there — a skip-pending loop (thread
    # started, no children yet) is already in the machinery and must
    # not read as a plain note. Rolled back automatically if decompose
    # fails, since nothing commits until below.
    note.kind = NoteKind.loop

    proposal = _run_decompose(db, note)
    messages = _act_on_proposal(db, note, proposal)

    db.commit()
    for m in messages:
        db.refresh(m)

    return [_message_to_out(m) for m in messages]


@router.patch("/notes/{note_id}/thread/advance", response_model=List[MessageOut])
def advance_thread(note_id: UUID, db: Session = Depends(get_db)) -> List[MessageOut]:
    """The chat-thread replacement for tapping "Done" on the front-facing
    card: completes whichever child is currently this loop's active step
    and reports the resulting message(s) — the next step, or a
    completion acknowledgment. Reuses _complete_note exactly as the plain
    PATCH /notes/{id}/complete does; the only difference is this endpoint
    finds the active child itself (callers only ever need to know which
    *loop* they're advancing, not which step note id is currently live)
    and returns chat messages instead of NoteOut state.
    """
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")

    active_child = (
        db.query(Note)
        .filter(Note.parent_id == note.id, Note.status == NoteStatus.active)
        .first()
    )
    if active_child is None:
        raise HTTPException(status_code=400, detail="no active step to complete")

    messages: List[Message] = []
    _complete_note(db, active_child, messages)
    db.commit()
    for m in messages:
        db.refresh(m)

    # _complete_note can also produce messages for a different loop's own
    # thread (a cascaded linked-note completion) — those are persisted
    # and will show up next time that other thread is opened, but this
    # endpoint only reports what happened in the thread it was called on.
    return [_message_to_out(m) for m in messages if m.note_id == note.id]


SUMMARY_SYSTEM_PROMPT = """\
You are a warm, casual companion summarizing someone's progress on a \
task, because they asked to see the whole picture. You'll be given the \
task title, which steps are already done, and which steps are still \
ahead. Write a short summary (2-4 sentences) in plain flowing prose — \
NEVER as a bulleted or numbered list. Mention what's done first, then \
what's left, in your own words. Respond with JSON: {"message": "..."}
"""


@router.post("/notes/{note_id}/messages", response_model=List[MessageOut])
def send_message(
    note_id: UUID, payload: SendMessageRequest, db: Session = Depends(get_db)
) -> List[MessageOut]:
    """Free text typed into a thread. The only thing it does right now
    (matching the spec's "what's the full plan?" escape hatch) is ask
    the companion for a plain-sentence summary of everything done and
    everything ahead — this is the one deliberate, explicit-request-only
    bypass of fog-of-war in the whole app: the summary prompt below sees
    every child regardless of status, since the user asked to see it.
    See docs/DECISIONS.md ("Chat thread").
    """
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")

    user_msg = Message(
        note_id=note.id, sender=MessageSender.user, kind=MessageKind.user_reply, text=payload.text
    )
    db.add(user_msg)
    db.flush()

    children = (
        db.query(Note)
        .filter(Note.parent_id == note.id)
        .order_by(Note.created_at.asc())
        .all()
    )
    done_texts = [c.text for c in children if c.status == NoteStatus.done]
    remaining_texts = [c.text for c in children if c.status != NoteStatus.done]
    context = (
        f'Task: "{note.text}"\n'
        f"Done so far: {'; '.join(done_texts) if done_texts else 'nothing yet'}\n"
        f"Still ahead: {'; '.join(remaining_texts) if remaining_texts else 'nothing — all done'}"
    )

    summary_text = None
    try:
        tone_hint = TONE_HINTS[_backlog_pressure(db)]
        raw = complete_json(SUMMARY_SYSTEM_PROMPT + tone_hint, context)
        candidate = raw.get("message")
        if isinstance(candidate, str) and candidate.strip():
            summary_text = candidate.strip()
    except LLMError:
        pass

    if summary_text is None:
        # Fail-safe plain-English fallback if the LLM call fails or
        # returns something malformed — the user still gets an answer.
        done_part = ", ".join(done_texts) or "nothing yet"
        remaining_part = ", ".join(remaining_texts) or "nothing, that's everything"
        summary_text = f"Here's where things stand: done — {done_part}. Still ahead — {remaining_part}."

    summary_msg = Message(
        note_id=note.id, sender=MessageSender.companion, kind=MessageKind.summary, text=summary_text
    )
    db.add(summary_msg)

    db.commit()
    db.refresh(user_msg)
    db.refresh(summary_msg)

    return [_message_to_out(user_msg), _message_to_out(summary_msg)]


@router.post("/notes/{note_id}/thread/manual-step", response_model=List[MessageOut])
def manual_first_step(
    note_id: UUID, payload: SendMessageRequest, db: Session = Depends(get_db)
) -> List[MessageOut]:
    """Manual fallback, reachable two ways: declining a skip_prompt
    ("actually, let's break it down"), or after thread/start fails
    outright (an LLMError). Cracks open with exactly the one step the
    user typed — same _crack_open every other path uses — and reports it
    as a normal 'step' message, so everything downstream (the Done
    button, thread/advance) treats it identically to an AI-proposed
    step. Guard is the same "already cracked open" check as everywhere
    else; a note that's only ever had a skip_prompt (no children yet)
    passes it fine. See docs/DECISIONS.md ("Chat thread").
    """
    note = db.get(Note, str(note_id))
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")

    existing_child = db.query(Note.id).filter(Note.parent_id == note.id).first()
    if existing_child is not None:
        raise HTTPException(status_code=400, detail="note already cracked open")

    note, active_child = _crack_open(db, note, [payload.text])
    msg = _step_message(note, active_child)
    db.add(msg)
    db.commit()
    db.refresh(msg)

    return [_message_to_out(msg)]


@router.patch("/messages/{message_id}/dismiss", response_model=MessageOut)
def dismiss_message(message_id: UUID, db: Session = Depends(get_db)) -> MessageOut:
    """Marks a prompt message resolved without taking its "accept" action
    — currently only meaningful for declining a merge_prompt ("no
    thanks"): stale_prompt's two actions (keep/dissolve) both already
    resolve it via PATCH /notes/{id}/keep or the note being deleted
    outright, so this is only reachable from the merge decline button
    today, though nothing here is merge-specific. See docs/DECISIONS.md
    ("Feature C, in-thread").
    """
    msg = db.get(Message, str(message_id))
    if msg is None:
        raise HTTPException(status_code=404, detail="message not found")

    msg.resolved = True
    db.commit()
    db.refresh(msg)

    return _message_to_out(msg)
