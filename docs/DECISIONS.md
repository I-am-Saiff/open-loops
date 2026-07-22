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

## 2026-07-22 — Feature A: LLM-proposed decomposition is a preview, commit is still crack-open

`POST /notes/{id}/decompose` calls the LLM and returns its proposal
(`{"type": "steps", "steps": [...]}` or `{"type": "skip", "suggestion":
"..."}`) — it does not touch the database at all beyond the read to fetch
the note and check for existing children. No notes are created. The
existing `PATCH /notes/{id}/crack-open` endpoint (unchanged) is still the
only thing that ever creates children and flips a parent to `active` —
decompose is purely upstream of it, proposing what the frontend will
*eventually* pass to crack-open once the user confirms/edits the list.
This means the fog-of-war invariants logged earlier (exactly one
`active` child, backend owns every status transition) don't need any new
cases: as far as the state machine is concerned, an LLM-proposed list
confirmed by the user and a hand-typed list are the same crack-open call.

Same guard as crack-open: 400 if the note already has children (can't
decompose something already committed to a step list). This also means
decompose can be retried freely on a still-folded note — it's a pure
preview, so calling it twice just asks the LLM twice, no state to
reconcile.

Response validation: the raw LLM JSON is parsed into
`DecomposeStepsProposal`/`DecomposeSkipProposal` (Pydantic) based on its
`type` field, and any mismatch (wrong shape, unknown `type`, empty
`steps`) becomes a `502` rather than passing malformed data to the
frontend — this is the same "validate at the boundary" reasoning as
`LLMError` in `llm_client.py`, just one layer up (schema-shape validation
here vs. transport/parsing there).

Verified live against the real Groq API and real SQLite: a concrete
multi-step task ("cook biryani Thursday") correctly returned a 4-step
`steps` proposal; a trivial one ("reply k to moms text") correctly
returned a `skip` proposal ("just send 'k' to mom"); calling decompose on
an already-cracked-open note (from the earlier "Make pizza" test data)
correctly 400'd; a nonexistent note correctly 404'd; and `GET /notes`
before/after confirmed decompose created zero rows in either case.

## 2026-07-22 — Feature A frontend: decompose auto-triggers, manual entry is one click away always

`App.tsx` calls `decompose()` automatically right after a new top-level
note is created (`handleCreateNote` → `requestDecompose`), storing the
in-flight/resolved proposal in a `proposals` map keyed by note id — never
persisted or refetched, purely a client-side preview step. `NoteCard`
only shows the `DecomposeProposalPanel` when a proposal exists for that
note; every other folded note (anything not just created in this
session, or once a proposal is dismissed) renders the original manual
"open" → textarea flow unchanged. Concretely, "manual entry stays as a
fallback" means three separate escape hatches, all landing on the exact
same unchanged manual panel:
1. `requestDecompose` catches any failure (network error, `LLMError`,
   malformed-proposal 502) and just clears the proposal — no error UI,
   it silently drops back to the manual "open" link.
2. Both panel states (`loading` and resolved) have an explicit "enter/
   crack it open myself instead" link.
3. `DecomposeProposalPanel` never talks to the backend itself — it only
   collects an edited `string[]` and calls back up; `onConfirmSteps`
   wraps the existing `handleCrackOpen`, and "Accept & dissolve" (skip
   proposals) wraps the existing `handleComplete`. Both are the same
   functions the manual panel already called — no new backend interaction
   paths were added for Feature A, only a new way to arrive at the
   existing ones.

CSS note: a freshly created note is still `status: folded` while its
decompose proposal is showing (decompose doesn't touch status), so the
proposal panel renders inside `.note-card--folded`'s narrow 170px
max-width by default — nowhere near enough room for an editable step
list. Added `.note-card--folded.note-card--expanded` (an `isExpanded`
flag covering both the manual panel and the decompose panel) to widen
the card to 300px whenever either panel is open, using a combined
selector so it reliably beats `.note-card--folded` on specificity
regardless of source order.

Verified live in the browser end-to-end: a concrete task auto-showed 5
editable proposed steps; deleted one, edited another's text, confirmed
with "Crack it open" — `GET /notes` and a direct SQLite read confirmed
the edit and deletion persisted correctly and fog-of-war held (only the
parent + first active child returned, the 3 folded siblings not). A
trivial task auto-showed a skip suggestion; "Accept & dissolve" flipped
it straight to `done` with zero children, confirmed via the API. "Start
over manually" correctly dismissed an active proposal and opened the
original manual textarea panel in its place.

## 2026-07-22 — Feature B backend: peek/keep/dissolve, stale is computed not stored

Added `peek_count` (int, default 0) and `last_peeked_at` (nullable
datetime) to `notes`. Schema change on an already-existing SQLite file
required recreating `backend/openloops.db` — same limitation already
logged under "no migration tooling for the SQLite prototype."

`stale` is *not* a column — it's computed in `_to_out()` on every
response (`_is_stale(db, note)`), so it can never drift from the
underlying `peek_count`/`created_at`/children state the way a
cache-on-write column could. Cost: one extra query per note in the
response (checking for a completed child) — an N+1 pattern, acceptable
at demo scale (same reasoning as Feature C's "not built to scale to
hundreds yet" below), revisit with a single join if the note count ever
gets large. Rule, exactly as specified: `peek_count >= 3` AND `now -
created_at >= 3 days` AND no child of this note has status `done`. That
last condition is genuinely "no child ever completed," not "no child
currently pending" — a leaf note with zero children satisfies it
vacuously (no children, so none of them completed), which is correct:
a plain folded loop peeked at repeatedly for days with nothing done
about it is exactly the "still worth keeping?" case this feature targets.

Three new endpoints:
- `PATCH /notes/{id}/peek` — incrementing counter + timestamp, no status
  change. Nothing prevents calling it on an active/done note at the API
  level (no guard), but the frontend only ever calls it when viewing a
  *folded* loop, per the spec ("not when steps are completed").
- `PATCH /notes/{id}/keep` — resets `peek_count` to 0 only;
  `last_peeked_at` is left as-is since the spec only asked to reset the
  count, and there's no behavior that depends on `last_peeked_at` being
  cleared.
- `DELETE /notes/{id}` — an actual deletion, not a status change, per
  "tearing out a page" being irreversible. Cascades to children via the
  existing SQLite `ON DELETE CASCADE` foreign key + `PRAGMA
  foreign_keys=ON` (set up back when the DB was swapped to SQLite, not
  previously exercised by any endpoint — this is the first delete this
  codebase has ever done). Not restricted to stale notes at the API
  level — the frontend only offers "let it go" from the stale prompt,
  but the endpoint itself is a general delete-by-id.

Verified live against real SQLite: peeked a fresh note 3x — correctly
not stale (too new); backdated `created_at` 5 days via direct SQL —
flipped to `stale: true`; called `keep` — `peek_count` reset and `stale`
flipped back to `false`; cracked another note open, completed one child,
peeked the parent 3x, backdated it — correctly stayed `stale: false`
because a child had been completed; `DELETE`d a note with two children
(one done, one active) and confirmed via a direct SQLite read that the
parent *and both children* were gone, not just hidden; confirmed 404 on
all three new endpoints for a nonexistent note.

## 2026-07-22 — Feature B frontend: stale prompt is a second sticky note, dissolve delays the real delete until the animation finishes

`StaleNotePrompt` renders as its own absolutely-positioned element inside
the folded card's box (`.note-card` is already `position: absolute`, so
it's a valid containing block for this without extra markup), offset
down-and-right (`top: calc(100% - 10px); left: 14px;`) rather than
centered on top of the card. First attempt centered it over the card and
it completely hid the note's own text — moving it to overlap just the
bottom-left corner keeps both legible at once, closer to "a sticky note
attached to it" than "a sticky note replacing it."

Priority for what a folded top-level card shows is now: decompose
proposal (Feature A) > stale prompt > manual crack-open panel > plain
"open" link — a card only ever shows one of these at a time. In
practice the first two never actually contend (a note can't be stale
seconds after being created, which is the only time a decompose
proposal exists), but the ordering is there for correctness regardless.

Peek is fired from exactly one place: the "open" link's click handler
(`openManually` in `NoteCard.tsx`), which calls `onPeek` alongside
toggling the panel — matching the spec's "opened/viewed... not when
steps are completed." Nothing else in the UI calls peek.

Dissolve: `NoteCard` owns a local `dissolving` boolean and a
`setTimeout` — clicking "let it go" immediately adds the
`.note-card--dissolving` class (CSS keyframes: rotate further + scale
to 0.15 + fade over 450ms) but only calls the parent's `onDissolve` (the
actual `DELETE` request) once that timer fires. The note stays in
`notes` state, animating, for the full 450ms; only after does the
parent's `refresh()` actually remove it. Getting this order backwards
(deleting first, animating second) would either animate a card that's
already gone from state (nothing to animate) or need the deleted note
kept around client-side in a separate "removing" list — the setTimeout
approach avoids that bookkeeping entirely at the cost of one hardcoded
duration constant that has to stay in sync between the `.tsx` and the
`@keyframes` (`DISSOLVE_ANIMATION_MS` in `NoteCard.tsx`, `450ms` in
`App.css` — both commented to point at each other).

Verified live in the browser: peeked a note 3x via real UI clicks on
"open," backdated it via SQL, reloaded — the stale sticky note appeared
attached to the (still-legible) folded card underneath; "keep it"
dismissed it and reset `peek_count` to 0 (confirmed via the API); re-peeked
and re-backdated to bring it back; "let it go" removed the note from the
canvas and a direct SQLite read confirmed 0 rows remained (an actual
delete, not a status flip); separately confirmed a plain "open" click on
a fresh note incremented `peek_count` to 1 with `last_peeked_at` set, via
a direct SQLite read after the UI interaction. No console errors at any
point.

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
