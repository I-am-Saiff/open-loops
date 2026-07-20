# Decisions Log

Chronological log of technical choices and why. Append, don't rewrite
history — if a decision is later reversed, add a new entry rather than
editing the old one.

## 2026-07-20 — Frontend: Vite + React, not Next.js

Chose Vite over Next.js. V1 is a single canvas page, no auth, no SSR/SEO
need, no server-rendered routes — Next's App Router, routing conventions,
and server/client component split are overhead with no payoff here. Vite
gives a faster dev loop for a client-heavy, drag/pointer-event-driven UI
and keeps the frontend a plain SPA that talks to FastAPI over HTTP. If v2
adds multi-user auth, SSR, or SEO'd public pages, revisit.

## 2026-07-20 — Canvas: custom lightweight drag layer, not tldraw

Chose a custom layer (absolutely-positioned note cards + pointer-event
dragging on a pannable/zoomable container) over tldraw.

tldraw is a full whiteboard SDK built around its own shape/record model and
editor state. The core mechanic here — fog of war, where a note's
visibility and rendered size depend on `status` (folded/active/done) and
parent/child relationships in *our* data model — doesn't map cleanly onto
tldraw's shape system. Getting tldraw to hide sibling shapes based on
app-level status, or to swap a card between "dim collapsed" and "large
active" render modes, means fighting its shape/tool abstractions rather
than using them. A plain custom layer keeps note rendering a direct
function of our `notes` rows, which is what the fog-of-war logic depends
on. Cost: we don't get tldraw's pan/zoom/multi-select/persistence for free
and have to build minimal versions ourselves. Acceptable for v1 (one
canvas, one user, modest note counts).

## 2026-07-20 — Single `notes` table, not separate `loops` / `steps` tables

Loops and sub-steps are structurally the same thing (text, position,
status) and can nest arbitrarily via `parent_id` self-reference — a
sub-step could itself be cracked open later without a schema change. One
table avoids a parallel-model duplication (two tables with near-identical
columns) and keeps the "promote next child to active" query a single
self-join instead of a cross-table join.

## 2026-07-20 — Backend owns lifecycle transitions, not the frontend

The folded→active→done promotion logic (marking one child done
auto-activates the next `folded` sibling; all children done → parent done)
lives in FastAPI endpoints, not client-side state. Rationale: fog-of-war is
the entire point of the product — if the frontend computed "what's next"
from a full list of children it already fetched, it would have the full
scope in memory even if it chose not to render it, undermining the
mechanic's intent and making it trivial to inspect via devtools/network
tab. Backend only ever returns the note(s) the frontend is allowed to see.

## 2026-07-20 — State machine: exact transition rules

Sibling order within a parent is `created_at ASC` — see the `clock_timestamp()`
note below; there is no separate `position`/`order` column in v1.

**Child completion → promote next sibling:**
On `PATCH /notes/{id}` setting a child's `status` to `done`:
1. Look up its `parent_id`. Query siblings (`parent_id` = same, `status =
   'folded'`) ordered by `created_at ASC`, take the first row, set its
   `status` to `active`.
2. If step 1 found no folded sibling to promote, count the parent's
   children that are not `done`. If that count is zero, the just-completed
   child was the last one — set the parent's own `status` to `done`.

**This is "all children done," not a separate "last active child" rule —
and the two are the same event.** Activation is strictly sequential (crack-open
promotes exactly one child to `active`; completing it promotes exactly the
next `folded` one). Because at most one child is ever `active` at a time,
the moment there are zero `folded` and zero `active` children left is
necessarily the moment the last child was just marked `done`. So "check if
all children are done" after every child completion *is* "check if this was
the last active child" — same condition, phrased in terms of the query
that's actually cheap to run (`COUNT(*) WHERE status != 'done'`).

**Recursion:** the check is written generically in terms of "note X's
parent," not hardcoded to one level. If completing the parent itself
flips it to `done` and that parent has its own `parent_id` (a sub-step
that had been cracked open further), the same check runs one level up.
Not exercised by the v1 UI (crack-open is only offered on top-level loops),
but the rule doesn't need special-casing to support it later.

**Leaf note (never cracked open):** going straight from `folded` to `done`
via `PATCH /notes/{id}` skips the sibling-promotion step entirely (no
children to check) — it's just a direct status write.

## 2026-07-20 — Creation status, and crack-open as its own endpoint

- `POST /notes` with no `parent_id` (a new top-level loop) always creates
  with `status = 'folded'`. This is the dim, collapsed default — no loop is
  ever born already showing scope.
- `POST /notes` with a `parent_id` (appending a sub-step to an
  already-cracked-open loop) also always creates with `status = 'folded'`,
  never `active`. Exactly one codepath is allowed to *set* a note to
  `active`: the sibling-promotion step above, or the crack-open initial
  promotion below. `POST /notes` never does it directly — otherwise two
  places could both decide "this is the front-facing step" and disagree.
- **Crack-open is its own endpoint**, `PATCH /notes/{id}/crack-open`, not
  implicit in how children get POSTed. Payload: an ordered list of
  sub-step strings. In one transaction it: (a) inserts all of them as
  children with `status = 'folded'`, (b) promotes the first one (list
  order) to `active`, and (c) flips the *parent's own* status from
  `folded` to `active` (a cracked-open loop is now in progress, not just
  sitting folded). Reasoning: the alternative — inferring "this is the
  first child, so activate it" from plain `POST /notes` calls — is racy
  (what counts as "first" if two requests land close together?) and
  smears one atomic user action ("crack this open with these steps")
  across N separate HTTP calls with no shared transaction.
- Implementation note: the `notes.created_at` default must be
  `clock_timestamp()`, not `now()`. Postgres freezes `now()` for the
  whole transaction, so a multi-row insert of sub-steps inside one
  crack-open transaction would give every row an identical timestamp and
  break the `ORDER BY created_at` sibling sequencing above.
  `clock_timestamp()` advances per row and gives a real insertion order.

## 2026-07-20 — Fog of war is enforced server-side in `GET /notes`, not by convention

`GET /notes` never puts a `folded` child on the wire. The query is:

```sql
WHERE parent_id IS NULL          -- every top-level loop, any status
   OR status IN ('active', 'done')  -- only a child's front-facing or
                                     -- already-completed steps
```

`folded` children are excluded at the database query, not filtered out in
the frontend — the frontend physically cannot render what it never
received, so there's no devtools/network-tab way to peek at hidden scope.
`done` children are included (not just the active one): fog-of-war hides
*unrevealed future* scope, not history, and a scattering of completed-step
cards is consistent with the "handwriting on paper" trail-of-progress feel
in `docs/SPEC.md`. Top-level loops are always returned regardless of
status (folded/active/done) since the loop cards themselves are never
hidden — only their children's fog is.

## 2026-07-20 — Backend talks to Postgres directly, not through Supabase's PostgREST/client SDK

FastAPI connects straight to Supabase's underlying Postgres via
`DATABASE_URL` (asyncpg), rather than going through `supabase-py` /
PostgREST. The lifecycle logic above (sibling promotion + parent
auto-complete) needs multi-row transactional writes in a single request;
PostgREST's REST-per-row semantics aren't a good fit for that, and since
FastAPI is the only writer in v1 (no auth, no client-side Supabase calls),
there's no RLS/client-auth benefit being left on the table by skipping the
SDK. Supabase is being used here as "just Postgres," which is fine for v1.

## Open items / known incomplete for v1

- No auth: all requests operate against a single hardcoded demo user
  concept. Do not add a `users` table or auth middleware for v1 — explicitly
  deferred, not an oversight.
- No optimistic-locking / conflict handling on drag position updates
  (single user, so last-write-wins is fine for v1).
- No automated tests scaffolded yet — to be added alongside the first
  backend endpoints, not as a follow-up phase.
- No migration runner wired up (e.g. Alembic) — `backend/migrations/*.sql`
  are plain numbered SQL files, applied by hand via `psql "$DATABASE_URL"
  -f backend/migrations/0001_create_notes.sql` or pasted into the Supabase
  SQL editor. Fine at one migration; revisit if the schema starts
  changing often.
