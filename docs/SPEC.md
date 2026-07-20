# Open Loops — v1 Spec

## Concept

Open Loops is a freeform notebook for tasks ("loops") that fights task
avoidance by never revealing full scope at once. Instead of a linear to-do
list, loops live anywhere on an infinite canvas — like handwriting scattered
across a page, not a stack ranked by priority.

The premise: a big task feels avoidable because the mind sees the whole
mountain before taking a single step. Open Loops hides the mountain. You only
ever see the next foothold.

## Core mechanic: progressive disclosure ("fog of war")

1. **Folded.** A loop starts as a dim, collapsed card — just a title. No
   sub-steps are visible, not even a count. This is the "avoidance-proof"
   state: looking at it costs nothing, so there's no reason to look away.
2. **Cracking open.** The user manually types out sub-steps, one per line,
   for that loop. This is the only moment the full scope exists anywhere —
   in the user's own head, as they write it down. No AI breakdown in v1 (see
   Phase 2 below). Each sub-step becomes a child note (`parent_id` = the
   loop's id) with status `folded`.
3. **Fog of war.** After cracking open, exactly one child — the first —
   flips to `active` and renders large/prominent. Every other child stays
   `folded` and is not shown at all (not even as a dimmed placeholder or a
   count), so the user can't eyeball "6 more to go" and bail.
4. **Advancing.** Marking the active sub-step `done` automatically promotes
   the next `folded` child to `active`. When the last child is marked done,
   the parent loop itself flips to `done`.
5. **Freeform placement.** Every note (loop or sub-step) has an `x, y` and
   can be dragged anywhere on the canvas. Sub-steps are not forced into a
   list under the parent — they can be dropped wherever, though the active
   one is visually emphasized regardless of position.

## Note lifecycle (status field)

```
folded --(cracked open / promoted to front)--> active --(marked done)--> done
```

- A leaf loop with no children can go straight from `folded` to `done`
  (not every task needs sub-steps).
- A parent loop's own status becomes `done` once all of its children are
  `done`.

## V1 scope

- Single demo user, no auth, no multi-tenancy.
- One canvas page.
- Manual sub-step entry only — see Phase 2 for AI-assisted breakdown.
- Core loop end-to-end: create note → crack open → add sub-steps → complete
  one at a time (fog of war reveals next) → parent auto-completes.
- No sharing, no tags, no search, no due dates, no reminders in v1.

## Data model

Single `notes` table (see `docs/DECISIONS.md` for why one table instead of
separate `loops`/`steps` tables):

| column     | type                          | notes                                   |
|------------|-------------------------------|------------------------------------------|
| id         | uuid, pk                      |                                          |
| parent_id  | uuid, nullable, fk -> notes.id | null = top-level loop                   |
| text       | text                          | the note/step content                   |
| x          | float                         | canvas position                         |
| y          | float                         | canvas position                         |
| status     | enum: folded, active, done    | see lifecycle above                     |
| created_at | timestamptz                   | default now()                           |

## Stack

- **Backend:** FastAPI + Supabase (Postgres). FastAPI holds the lifecycle
  rules (auto-promote next child, auto-complete parent) so the frontend
  stays a dumb renderer of state, not a place where the "fog of war" logic
  could be bypassed by direct DB writes.
- **Frontend:** Vite + React. See `README.md` for the Next.js-vs-Vite call.
- **Canvas:** custom lightweight drag layer (absolutely-positioned cards +
  pointer events), not tldraw. See `docs/DECISIONS.md` for the justification.

## Phase 2 ideas (explicitly out of scope for v1)

- AI-assisted sub-step generation when cracking open a loop (user describes
  the task, model proposes a step breakdown the user can edit before
  accepting).
- AI-assisted "what's the very next step" nudge for loops that have sat
  folded too long.
- Multi-user / auth.
- Zoom levels or canvas "regions" (e.g. a done graveyard, a today zone).
- Undo/redo for drags.
