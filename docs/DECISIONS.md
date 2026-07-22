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

## 2026-07-20 — Swap backend DB from Postgres/Supabase to local SQLite (SQLAlchemy) for prototype validation

Superseded by this entry (kept, not edited, per the log convention above):
"Backend talks to Postgres directly, not through Supabase's PostgREST/
client SDK."

We're not committing to hosting infrastructure before the concept itself is
validated with a collaborator. Provisioning Supabase (or any cloud DB) now
would be infrastructure work spent before there's any confirmation the
product idea is worth building further. SQLite via SQLAlchemy needs zero
external accounts, is a single file (`backend/openloops.db`, gitignored),
runs fully offline, and the FastAPI app now creates the schema itself on
startup (`Base.metadata.create_all()`), so running the prototype is
`pip install -r requirements.txt && uvicorn app.main:app --reload` — no
migration step, no `.env` required.

**Plan:** swap `DATABASE_URL` to a `postgresql://` connection string once
the concept is approved and multi-user/hosting needs are real. Host
undecided (Supabase / Neon / Railway) — that choice is deferred along with
the swap itself. `backend/migrations/0001_create_notes.sql` is kept as the
target schema for that swap; it is not applied by the current prototype.

What changed concretely:
- ORM: `asyncpg` (raw SQL over a connection pool) → SQLAlchemy (sync
  engine + `Session`). The earlier reasoning for avoiding Supabase's
  PostgREST client — needing real multi-row transactional writes for the
  lifecycle logic — still holds and still applies: SQLAlchemy gives the
  same direct transactional control PostgREST wouldn't. This decision is
  only about which database engine is behind it, not about going back
  through a REST layer.
- IDs: Postgres `gen_random_uuid()` → `uuid.uuid4()` generated in
  application code (SQLite has no native UUID type; ids are stored as
  text columns that still round-trip through Pydantic's `UUID` type
  fine).
- Sibling ordering: Postgres `clock_timestamp()` default →
  `datetime.utcnow()` evaluated in Python when each `Note` object is
  constructed. SQLAlchemy ORM objects for a crack-open's sub-steps are
  still constructed one at a time in a Python loop even inside one
  transaction, so `created_at` still advances per row the same way. Same
  caveat as before: relies on the system clock's resolution being fine
  enough not to collide for manually-typed sub-steps at v1 scale — true
  in practice, not formally guaranteed.
- Foreign keys: SQLite does not enforce `ON DELETE CASCADE` (or any FK
  constraint) unless `PRAGMA foreign_keys=ON` is set per connection —
  added as a `connect` event listener on the engine in `app/db.py`. This
  listener is SQLite-specific and will need to be removed when swapping
  to Postgres.
- Endpoints changed from `async def` (asyncpg) to plain `def` (SQLAlchemy
  sync `Session`) — FastAPI runs sync route functions in a threadpool
  automatically, so this doesn't block the event loop and needed no
  other changes.

## 2026-07-20 — Frontend implementation notes: TypeScript, CORS, and client-only drag

- **TypeScript**, not plain JS, for the Vite + React app (`npm create
  vite@latest -- --template react-ts`). Not separately justified when the
  Vite-vs-Next.js choice was logged earlier — noting it now because the
  frontend's `src/types.ts` (`Note`, `CrackOpenResponse`,
  `CompleteResponse`) is a hand-kept mirror of the FastAPI Pydantic
  schemas, and TypeScript is what makes that mirror catch drift (e.g. a
  renamed field) at compile time instead of silently at runtime.
- **CORS is wide open** (`allow_origins=["*"]` in `app/main.py`) since
  this is a single-user local prototype with no auth and nothing to
  protect cross-origin. Revisit before this ever leaves localhost.
- **Drag positions are session-local only, not persisted.** There is no
  endpoint yet to write an updated `x`/`y` back to a note (see the
  existing open item below on optimistic locking, which anticipated
  this). The canvas keeps a `positions` map in React state that overrides
  a note's fetched `x`/`y` once dragged, so dragging feels persistent
  within a session, but a page reload resets every note to its
  last-saved (crack-open-time) position. This was a deliberate scope cut
  to build the fog-of-war interaction loop first, per your instruction —
  a `PATCH /notes/{id}/position` (or folding position into a general
  `PATCH /notes/{id}`) is the natural next backend endpoint.
- Verified live in a real browser (not just curl): created a loop,
  cracked it into 4 steps, completed all 4 one at a time and watched the
  fog-of-war reveal match the API exactly (only ever one large
  front-facing card, parent auto-completed on the last step with no
  active card left), dragged a completed card to a new position, and
  confirmed a leaf note going straight from folded to done via "no
  sub-steps, mark done."

## 2026-07-20 — Visual identity: paper notebook, not an admin panel; ignores OS dark mode on purpose

The first pass of styling (dark canvas, dot grid, flat UI-blue accents)
read as a generic dark-mode admin dashboard, which undercuts the actual
pitch — the point of Open Loops is that it *feels* like a physical
notebook page, not software. Redesigned `index.css`/`App.css` around
that:

- **Always paper-toned, never dark mode.** Removed the
  `prefers-color-scheme: dark` variant entirely and set
  `color-scheme: light` explicitly. A physical notebook doesn't flip to
  black plastic at night because the OS asked it to — respecting dark
  mode here would work against the concept, not just be a missed nicety.
- **Canvas background** is a warm cream (`--paper`) with three layered
  cues instead of a dot grid: faint horizontal ruled lines
  (`repeating-linear-gradient`, 34px apart), a soft red/pink vertical
  margin line ~52px from the left (the classic legal-pad/notebook rule
  line), and a low-opacity SVG `feTurbulence` noise texture blended over
  everything (`mix-blend-mode: multiply`) for paper grain — all inline
  data URIs, no image assets or network fetches, keeping the "zero setup"
  property intact.
- **Cards read as index cards/sticky notes, not `<div>`s:** cream
  background a shade lighter than the page, soft multi-layer drop
  shadows (`--shadow-soft` / `--shadow-lifted`) instead of a flat UI
  shadow, asymmetric border-radius per corner (`2px 10px 4px 9px`) so
  edges don't look machine-cut, and a deterministic small rotation per
  note id (unchanged mechanism from before, `tiltForId` in
  `NoteCard.tsx`) so cards don't line up in a grid.
- **Status now reads visually, not just structurally:**
  - *Folded* — dim, smaller, and gets a literal CSS dog-ear (a
    triangular corner fold via `::after` with a diagonal gradient) so
    "not yet opened" is legible at a glance, not just lower contrast.
  - *Active/front-facing* — bright white-ish paper, larger padding,
    the strongest shadow (looks lifted off the page), and — this is the
    one behavior change beyond CSS — `tiltForId` now takes a spread
    parameter and the front card gets a much narrower spread (±0.3°)
    than folded/done cards (±2.4°), so it reads as "the one piece of
    paper you just set down carefully," not just another scattered note.
  - *Done* — reduced opacity, desaturated (`filter: saturate(0.6)`),
    strikethrough in the accent color, i.e. pushed-aside-and-crossed-off
    rather than merely disabled-looking.
- **Typography:** Georgia/Palatino-family serif for UI chrome, and
  `"Bradley Hand", "Segoe Print", "Noteworthy", cursive` for note text
  and the page title — these are bundled with macOS (this runs on the
  user's Mac), so no font files or web font requests, keeping the
  offline/zero-setup property. Falls back to a generic `cursive` font on
  platforms without them; acceptable for a local prototype, revisit if
  this is ever deployed somewhere the OS/font environment isn't known.
- Verified live in a real browser at each stage: folded cards (dog-ear
  visible, dim), the crack-open panel, the bright front-facing active
  card, dragging a completed card aside to reveal a done card underneath
  (faded, struck through) sitting next to the ghost "in progress" tab of
  its parent, and the final all-done state after the last step — a
  screenshot of any of these reads as notebook paper, not a web app.

## 2026-07-22 — LLM provider: Groq, abstracted behind a single `complete_json()` function

Chose Groq for Features A (decompose) and C (cross-loop merge detection)
over OpenAI/Anthropic: free tier at prototype scale, fast inference (low
latency matters here since decompose runs synchronously in the create-loop
flow, blocking the UI on a response), and Groq's API is OpenAI-compatible
(`/openai/v1/chat/completions`) so `response_format: {"type":
"json_object"}` JSON mode works exactly like it does elsewhere — no
custom prompt-and-hope parsing.

All provider-specific detail (endpoint URL, auth header shape, model
name, request/response shape) lives in `backend/app/llm_client.py`'s one
function, `complete_json(system_prompt, user_prompt) -> dict`. Every
caller (decompose, merge detection) only ever sees "give it a system
prompt and a user prompt, get a dict back, or an `LLMError`." Swapping to
a different provider later means rewriting this one file; nothing in
`routes/notes.py` would need to change.

Model: `llama-3.3-70b-versatile` — good balance of JSON-following
reliability and speed on Groq's free tier for this use case (short
structured outputs, not long-form generation). Hardcoded as a module
constant rather than an env var for now since there's only one call site
shape (system+user prompt in, JSON dict out); revisit if different
features end up needing different models/temperatures.

Error handling: `complete_json()` catches `requests` network/HTTP errors,
missing-key `KeyError`/`IndexError` (malformed Groq response shape), and
`json.JSONDecodeError` (model didn't return valid JSON despite JSON mode)
and re-raises all of them as one `LLMError`. This is a genuine system
boundary — the LLM is an external, occasionally-unreliable dependency —
so unlike most of this codebase's "don't validate what can't happen"
posture, catching failures here is deliberate, not defensive
overengineering.

`GROQ_API_KEY` defaults to `""` in `Settings` so the app still starts
without one; the failure only surfaces when a decompose/merge call
actually runs, which is the right place for it to surface.

Verified live: `complete_json()` called directly against the real Groq
API (not mocked) with a trivial prompt, confirmed it returns a parsed
dict from the model's JSON response.

## Open items / known incomplete for v1

- No auth: all requests operate against a single hardcoded demo user
  concept. Do not add a `users` table or auth middleware for v1 — explicitly
  deferred, not an oversight.
- No endpoint to persist a note's position after a drag — see the
  frontend notes entry above. Positions are session-local in the browser
  only. When this is built: no optimistic-locking / conflict handling
  needed (single user, so last-write-wins is fine for v1).
- No automated tests scaffolded yet — to be added alongside the first
  backend endpoints, not as a follow-up phase.
- No migration tooling for the SQLite prototype — the schema is created
  automatically by SQLAlchemy on startup. `backend/migrations/0001_create_notes.sql`
  is kept only as the target Postgres schema for the later swap and is not
  run today.
- SQLite's `PRAGMA foreign_keys=ON` listener in `app/db.py` is
  SQLite-specific and must be removed (not just left dormant) when
  swapping to Postgres, since it would error against a non-SQLite
  connection.
- Dev machine only has Python 3.9 (no 3.10+ available), so backend code
  uses `typing.Optional`/`Union` instead of PEP 604 `X | None` syntax for
  compatibility. Revisit if the deploy target is confirmed to run 3.10+.
