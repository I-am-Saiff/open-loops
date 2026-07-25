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

## 2026-07-22 — Feature C backend: merge detection, linking, and the completion cascade

**Detection runs inside `decompose`, only for `steps` proposals**, as a
second, separate LLM call (`_find_merge_suggestion`) rather than one
combined call — keeping two independent structured-output shapes
(decompose's `type`-discriminated union, merge's `match`-discriminated
union) in a single prompt/response felt more likely to degrade JSON
reliability than the cost of a second round-trip. Skipped entirely (no
LLM call at all) if there are no other top-level loops with
`status == active` — no candidates, nothing to ask.

**Compares against folded steps too, not just each other loop's one
visible active step.** This is a deliberate trade against the fog-of-war
principle elsewhere in the app: the backend already has full visibility
into every row regardless of status, and restricting merge candidates to
only the currently-active step of each other loop would make the
feature nearly useless (at most one visible step per loop at any time).
The user-facing consequence is that accepting a merge can surface the
literal text of a step in another loop that hasn't been "opened" by that
loop's own fog-of-war progression yet. Treating this as acceptable
because Feature C is explicitly a cross-loop bridge the user opted into
(by confirming a decompose proposal), not a silent leak — fog-of-war
is about pacing avoidance within one loop, not about the backend
withholding data from itself.

**Not built to scale past a handful of loops**, per your instruction:
`_find_merge_suggestion` loads *all* pending steps from *all* other
active loops into one prompt every time `decompose` runs. Fine at demo
scale (a handful of loops, a few steps each); would need pagination/
embedding-based pre-filtering before comparing against hundreds of
loops so the prompt doesn't blow past context limits or become
unreliable for the LLM to scan.

**Validation against the real candidate set, not just JSON-shape
validation**: `_find_merge_suggestion` checks the LLM's `new_step` is
literally one of the proposed steps and `(existing_note_id,
existing_step)` is literally one of the real candidate pairs it was
given, before ever constructing a `MergeSuggestion`. Any mismatch (a
paraphrase, an invented id) silently means no suggestion rather than
surfacing a suggestion that doesn't correspond to real data — same "fail
safe, don't break the primary flow" posture as `LLMError` handling
throughout this feature.

**`PATCH /notes/{id}/link` is symmetric** (sets `linked_note_id` on both
notes) since the cascade needs to work from either side — whichever one
gets completed first. Guards: can't link a note to itself, can't link an
already-done note (nothing to cascade), can't link a note that's already
linked (no multi-way links in v1, keeps the cascade a simple pairwise
check).

**The completion cascade only fires if the linked note is currently
`active`** — i.e., genuinely that note's own turn in its own loop's
fog-of-war sequence — not merely "not done." This was a real bug caught
during live testing, not a hypothetical: my first pass cascaded whenever
the linked note was `!= done`, which meant linking an active step to a
*folded* one (very plausible — a merge match can land on any pending
step, and only one step per loop is ever active) would force-complete a
step out of turn, promoting a second sibling to `active` in that loop
and violating the one-active-child invariant that everything else in
this app depends on. Fixed by requiring `linked.status ==
NoteStatus.active`. **Known limitation** (explicitly not built out
further, matching "keep this to exact/small-scale... note the
limitation"): if you link a step before its own turn arrives, completing
its counterpart elsewhere does *not* retroactively auto-complete it once
its turn does come up naturally — it just sits `active`, still linked to
an already-`done` note, until someone completes it manually. Fixing this
properly would mean `_promote_next_sibling_or_complete_parent` checking,
every time it promotes a sibling to `active`, whether that sibling is
linked to an already-done note and immediately cascading — deferred as
added complexity not justified at demo scale.

Verified live against real SQLite and the real Groq API, using two
manually-seeded loops sharing a genuine real-world action (\"go grocery
shopping for rice and spices\") so the LLM's judgment could be checked
directly rather than mocked: two earlier attempts with more loosely
related tasks (lasagna/cake vs. a specific biryani grocery run)
correctly returned no match — confirming the model does discriminate
real overlap from superficial similarity, not just rubber-stamp
everything. A task text engineered to need the literal same shopping
trip did trigger a match, with `new_step`/`existing_note_id`/
`existing_step` all verified to be the exact real values. Cracked that
proposal open, linked the new step to the existing one, and:
- linking an **active** note to a **folded** one, then completing the
  active side, correctly left the folded (linked) side untouched — no
  invariant violation, confirmed via direct SQLite read of all of that
  loop's children;
- linking two notes that were **both** currently active, then completing
  one, correctly cascaded: the linked note in the other loop flipped to
  `done` *and* that loop's own next sibling was promoted to `active` in
  the same operation — confirmed via direct SQLite read that both loops
  ended up with exactly one `active` child each, "both parents get
  credit" holding exactly as specified;
- confirmed the documented limitation directly: the note linked while
  folded, once later promoted to `active` by its own loop's normal
  sequence, stayed `active` rather than auto-completing, despite its
  linked counterpart already being `done`;
- all four `link` guard rails (self-link, link-to-done, double-link,
  missing note) returned the expected 400/404;
- confirmed `decompose` with zero other active loops in the database
  skips the merge LLM call entirely and returns `merge_suggestion: null`.

## 2026-07-23 — Feature C frontend: the thread only ever connects two notes the frontend can actually see

`merge_suggestion` describes a match against a step's *text*, not a real
note — decompose is still a preview at that point. The thread/prompt
(`MergeThread`) can only render once both ends are real: the "new" side
needs `crack-open` to have actually run, and the "existing" side needs to
be a note this browser's `GET /notes` response actually returned.
Concretely, `handleConfirmProposal` only sets up a `mergeLink` if:

1. `result.active_child.text === mergeSuggestion.new_step` — the step
   that matched is the one that ended up promoted to `active` (i.e. it
   was first in the confirmed list *and* wasn't reworded/deleted while
   editing the proposal). If the user reordered steps or edited/removed
   the matched one, the suggestion is silently dropped — no error, it
   just doesn't apply anymore.
2. A fresh `listNotes()` call actually contains `existing_note_id`. The
   backend's merge detection deliberately compares against folded steps
   too (see the backend entry above, for recall), but the frontend never
   received folded children from `GET /notes` — fog-of-war is enforced
   server-side, and this feature doesn't get a side door around it. If
   the matched existing step is currently folded in its own loop, there
   is nothing to draw a line to, so nothing is shown.

**Consequence, stated plainly**: the merge UI only ever fires when the
match happens to land on the very first (front-facing) step of the newly
confirmed list. A match on step 2+ is detected by the backend (and would
still be linkable manually via `PATCH /notes/{id}/link` if some other UI
called it) but never surfaces in this UI. This is a real, narrow gap, not
a hypothetical — verified directly: an earlier test where the match text
appeared as the *second* proposed step correctly produced a
`merge_suggestion` from the backend, but no thread ever appeared, because
`active_child.text` was the first step, not the matched one. Accepted as
the same "small-scale for now, not built to scale further" trade the
backend already takes, rather than adding logic to re-derive/re-offer the
suggestion later as fog-of-war naturally reveals more of the new loop's
steps.

Declining ("no thanks") has no backend effect — nothing was ever created
or changed for a merge suggestion until "link them" is clicked, so
dismissal is just `setMergeLink(null)`.

No persistent visualization for already-linked notes: the thread only
appears during the accept/decline decision right after crack-open. A
linked pair shows no special connecting line on reload or afterward —
only `PATCH /notes/{id}/link`'s effect on completion behavior persists,
not any visual indicator of the link itself. Deferred as a further UI
investment not justified for v1.

Verified live end-to-end through the actual browser UI (not curl) for
the full accept + cascade path: seeded an existing loop with a pending
step ("call mom back"), created a new loop through the real double-click
→ decompose → confirm flow with wording engineered to bias the LLM
toward matching on the first proposed step (needed a few attempts — the
model's step ordering isn't fully deterministic, and it correctly
declines to match when the overlap isn't genuine, e.g. two different
specific grocery runs, seen directly in earlier attempts), got the
merge_suggestion, confirmed the proposal, and watched the dashed thread
and prompt render connecting the two real cards. Clicked "link them",
confirmed via the API that `linked_note_id` was set symmetrically on
both notes. Clicked "Done" on the original loop's step and watched, live
in the browser, the linked step in the other loop auto-complete and that
loop advance to its own next step in the same action — no console
errors throughout.

## 2026-07-23 — Major redesign: chat thread replaces the step-list UI (backend)

Replaced Feature A's "preview a step list, edit it, confirm" surface with
a persistent chat thread per loop — one loop, one conversation. This is
explicitly a presentation-layer change: `decompose`, the fog-of-war state
machine (`crack-open`, `complete`, sibling promotion, parent
auto-complete), stale detection, and merge detection are all reused
byte-for-byte in their logic; only how their results reach the user
changes.

**Schema**: a new `messages` table — `id, note_id (FK, the thread this
belongs to — always a top-level loop's id), sender (companion|user), kind,
text, related_note_id (nullable FK), created_at`. `kind` for this first
pass: `step` (announcing the current front-facing child — `text` is just
that child's own `text`, already conversational, see below;
`related_note_id` points at it), `skip_prompt` (a decompose "skip"
proposal surfaced as chat), `user_reply` (free text the user typed),
`summary` (the companion's reply to a `user_reply`), `done` (a loop just
finished). `stale_prompt`/`merge_prompt` are deferred to the next entry,
added only once something actually produces them — no unused enum
values sitting around before they're needed.

**Decompose's prompt changed, its contract didn't.** `DECOMPOSE_SYSTEM_PROMPT`
now asks for each step to read like a text message from a friend ("first,
prep your ingredients — chicken, onions, ginger, garlic, curry spices.
lmk when that's done") instead of a terse bullet ("Prep ingredients") —
same `{"type": "steps"/"skip", ...}` JSON shape as before, just different
prose inside the strings. This is why no extra per-step LLM call is
needed to "make messages conversational": decompose already generates
the eventual message text up front, for every step, before any of them
are ever shown — `_record_progress_message` (below) just copies
`promoted_sibling.text` straight into a `Message` row when a step
becomes active. One cost worth naming: decompose can no longer be
regenerated per-step with fresh context (e.g. "step 3, now that step 2
turned out differently than expected") — the whole plan is fixed at
thread-start time, same as the old preview-based flow was, just not
edited before commit anymore either.

**The preview/confirm step is gone entirely**, not just hidden. The old
flow was create → decompose (preview) → user edits/confirms → crack-open.
The new flow is create → `POST /notes/{id}/thread/start`, which runs
`_run_decompose` and *immediately* acts on the result — crack-open for a
`steps` proposal, no notes created yet for a `skip` proposal — with no
user decision point in between. Manual editing of individual step text
before it's ever shown is no longer possible; if the wording is off, the
user's only lever is the conversation itself (nothing built for that yet
— see the frontend entry's fallback-input note).

**`_run_decompose` and `_crack_open` extracted as plain functions**
(`app/routes/notes.py`) so `app/routes/threads.py`'s
`POST /notes/{id}/thread/start` can call the exact same code the
standalone `POST /notes/{id}/decompose` and `PATCH
/notes/{id}/crack-open` HTTP endpoints use — not a reimplementation, not
an HTTP-to-HTTP call. Both raw endpoints are kept (decompose remains a
useful side-effect-free preview if anything ever needs one again;
crack-open remains directly callable, e.g. from tests or a future manual
path) even though the chat flow no longer calls them over HTTP.

**`_complete_note`'s signature changed**: it now takes a `messages: List[Message]`
accumulator (mutated in place) instead of just returning
`(promoted_sibling, parent)`. Reason: a completion can cascade into a
*different* loop's thread entirely (a linked note in another loop
auto-completing — Feature C), and that other thread needs its own
`step`/`done` message the same way the primary one does. Threading a
mutable accumulator through the recursion was simpler than returning a
nested structure the caller would have to walk — every call site
(`PATCH /notes/{id}/complete`, `PATCH /notes/{id}/thread/advance`) just
passes a list and reads whatever ended up in it afterward.
`PATCH /notes/{id}/complete`'s own response shape is unchanged (still
`CompleteResponse`, no `messages` field) — it now has the side effect of
writing thread messages, but that's true of the state machine generally
now, not something that endpoint's contract needs to expose.

**`PATCH /notes/{id}/thread/advance` takes a loop id, not a step id** —
it finds that loop's current active child itself
(`Note.parent_id == id, status == active`) rather than requiring the
caller to track and pass a specific step's note id. The chat UI already
knows which loop it's looking at; making it also track "which child note
is currently live" would be redundant state to keep in sync with the
messages it's already rendering.

**The free-text summary is the one deliberate fog-of-war bypass in the
whole app, and it's opt-in only.** `POST /notes/{id}/messages` queries
*every* child regardless of status to build the summary context — the
same query GET /notes deliberately excludes folded children from. This
is intentional, not an oversight: fog-of-war exists to keep the *default*
view from revealing the whole plan, not to make it structurally
impossible to ask. The spec itself calls for exactly this escape hatch
("if the user wants to see everything... type something like 'what's the
full plan?'"). It only fires in response to the user explicitly typing
into the thread — nothing computes or shows this unprompted.

Verified live against real SQLite and the real Groq API, entirely via
curl (frontend not built yet at this point in the work): created a loop
and started its thread — got a genuinely conversational first message;
advanced through all remaining steps one at a time, each arriving as a
new message, ending in the `done` acknowledgment; confirmed the full
message history persists in order (the scroll-up requirement); a
different loop's thread, asked "what's the full plan?" after completing
one step, got a `summary` message correctly describing the one done step
in prose and the remaining ones without ever bulleting them; a trivial
task's thread started with a `skip_prompt` instead of steps, and
completing that loop directly (reusing the plain `/complete` endpoint
unchanged) worked exactly like the old "accept and dissolve"; confirmed
`thread/start` 400s on a second call, `thread/advance` 400s when there's
no active step (the skip case), and all four new endpoints 404 for a
missing note. Also re-verified the *existing* Feature C link+cascade
flow still works after the `_complete_note` signature change: linked two
active steps in different loops, advanced one loop's thread, and
confirmed via direct API calls that *both* loops' threads received their
own `done` message — the cascade's message-writing works even before any
UI surfaces it, which is the next commit's job.

## 2026-07-23 — Major redesign: chat thread replaces the step-list UI (frontend)

**Children no longer get their own canvas card at all.** The old design
rendered every note — top-level loop or child step — as its own
absolutely-positioned card, with the active child appearing as a separate
"front-facing" card elsewhere on the canvas from its parent. The chat
redesign only ever renders top-level notes (`notes.filter(n =>
n.parent_id === null)` in `App.tsx`); a step now only ever exists as a
`Message` bubble inside its loop's thread. This is why `NoteCard.tsx` and
`App.css` lost `.note-card--front` (the old front-facing-child style) and
the folded-card `.note-card--expanded` override entirely — there's no
child card left to be front-facing or expanded. Positions/dragging now
only apply to loop cards, not steps.

**`DecomposeProposalPanel.tsx`, `StaleNotePrompt.tsx`, and
`MergeThread.tsx` were deleted, not just unused.** All three were built
around the old per-child-card model (an editable list overlay on a
folded card; a sticky note attached to a specific card; a line drawn
between two specific cards) and can't function once children don't have
cards. This is a genuine, temporary regression in Feature B/C's UI
surface: as of this commit, stale loops and merge suggestions are fully
computed and available from the backend but **not shown anywhere in the
UI** — that's deliberately the next commit's job (re-presenting them as
in-thread proactive messages, which needs the chat surface built first).
Left `linkNotes`/`peekNote`/`keepNote`/`dissolveNote` in `api.ts` even
though nothing calls them for one commit — they're not dead code the way
an orphaned component file would be, they're infrastructure the very
next commit wires back up.

**One thread open at a time** (`openThreadId: string | null` in
`App.tsx`), matching "the one piece of paper in front of you" — opening
a different loop's thread implicitly closes whichever was open, rather
than letting the canvas fill with multiple expanded chat cards.

**Done loops stay reachable**: a "view thread" link on a completed
loop's muted card opens it read-only (no Done button, no input) —
otherwise all that persisted history would become permanently
unreachable the moment a loop finished, which felt wrong for a
conversation model that explicitly promises "scroll up to see
everything."

**Bug caught and fixed during live testing, not hypothetical**: the Done
button and the skip accept/decline buttons were originally gated on
`messages[messages.length - 1].kind` — "is the *last* message a step /
skip_prompt." Asking "what's the full plan?" appends a `user_reply` +
`summary` after the current step message, which silently pushed the Done
button off the bottom of the interactive surface with no way back to it
(confirmed by reproducing it in the browser, not just reasoning about
it). Fixed by checking the loop's actual current state instead of
message position: `showDoneButton` now looks for an `active` child of
this loop in `notes` directly, and `showSkipActions` checks `loop.status
=== "folded"` plus the presence of a `skip_prompt` message anywhere in
the thread — both survive an arbitrary number of summary round-trips
happening in between.

Verified live in the browser end-to-end (backend already verified via
curl in the entry above; this pass exercised the same flows through
real UI interaction): created a loop, watched the first conversational
message arrive, tapped "done" through multiple steps watching each new
bubble appear while all history stayed visible and scrollable; asked
"what's the full plan?" mid-thread and got a prose summary, then
confirmed via reproduction + fix that the Done button survived it;
completed the loop fully and watched it collapse to the muted
struck-through card with a working "view thread" link back into the
same persisted history; separately walked the skip path — a trivial
task's thread opened with a skip_prompt and reply buttons, declining
opened a manual step input, submitting it produced a real step message
with its own Done button, confirmed via direct API check that real
notes were created. No console errors at any point (double-checked
against a page log spanning the whole edit session — the only errors
present were transient HMR failures from mid-refactor file edits, not
from the final state, confirmed by clearing the log and reloading
clean).

## 2026-07-23 — Feature B/C return as in-thread proactive messages (backend + frontend)

**Stale nudges fire on the peek "rising edge," not "is currently
stale."** `peek_note` computes `_is_stale` before and after incrementing
`peek_count`; a message is only created when that crosses from false to
true. Checking "is currently stale" instead would spam a fresh nudge on
every single re-open while already stale. This means the note only
nudges again after "keep it" resets `peek_count` to 0 and it climbs back
up from a real, later re-neglect — not from repeatedly looking at an
already-flagged loop.

**`resolved` added to `Message`**, used only by `stale_prompt`/
`merge_prompt` (the two kinds with reply buttons) — the frontend checks
`!m.resolved` before showing a message's buttons, so an answered
question doesn't reoffer itself on reload. Three of the four actions
(keep, link-accept, and dissolve-via-delete) already touch other state
that a resolve step piggybacks onto for free (`keep_note` marks any
pending `stale_prompt` resolved as part of resetting `peek_count`;
`link_notes` searches both directions — it doesn't know a priori which
of the two notes passed in is the "new" side — to resolve the matching
`merge_prompt`). The fourth, declining a merge suggestion, has no other
state change to piggyback on, which is the whole reason the new
`PATCH /messages/{id}/dismiss` endpoint exists — a generic "resolve
this" that's currently only reachable from that one button.

**Nudge text is LLM-generated with a plain-template fallback**, same
"fail safe, never break the interaction" posture as everywhere else the
app calls the LLM. Chose to keep this as real (cheap, small) LLM calls
rather than hand-written templates specifically so the tone-hint
mechanism in the next commit has one consistent injection point across
every kind of companion-authored text (decompose steps/skip, stale
nudge, merge nudge, summary) instead of three LLM-backed kinds plus two
hardcoded ones that would need special-casing.

**Merge nudge only generated when the match is the newly-active step**
— same "frontend can't act on a step it doesn't have" constraint from
the chat-thread core-flow entry, now enforced at message-creation time
instead of display time: if `merge.new_step != active_child.text` (the
match landed on a later, still-folded step), no `merge_prompt` message
is created at all, since there would be nothing valid for "link them" to
act on. The underlying merge *detection* is unchanged and still checks
against all pending steps for recall — this is purely about what gets
surfaced.

**Accepting a merge finds the "new" note id by walking backward from
the `merge_prompt` message to the nearest preceding `step` message** —
not "whatever's currently active for this loop," which could have
drifted if the user completed steps in between seeing the nudge and
acting on it. `related_note_id` on the `merge_prompt` itself already
holds the "existing" side.

Verified live end-to-end, backend via curl then the same flows again
through real browser interaction: peeked a note twice (no message),
backdated and peeked a third time (rising-edge nudge appeared, warm and
specific to the task); "keep it" through the UI resolved it and reset
staleness (confirmed via API); re-triggered staleness and used "let it
go," watching the real crumple animation play before the note vanished,
then confirmed via direct SQLite read that both the note and its
messages were actually gone; separately walked the merge path fully
through the UI — created a loop whose first step matched an existing
pending step elsewhere, watched the merge nudge appear inline (not as a
separate connecting line — just a message with buttons) alongside the
still-present Done button, accepted it and confirmed `linked_note_id`
was set via the API, then tapped Done and watched the cascade complete
the other loop's step live, confirmed both loops got their own message;
ran the same setup again and clicked "no thanks," confirming via the API
that no link was created and the buttons didn't reappear. No console
errors throughout.

## 2026-07-23 — Ambient mood: backlog pressure as a tone-hint string, backend-only

**Signal**: `_backlog_pressure(db)` — ratio of stale top-level loops to
all *open* (not-done) top-level loops, bucketed into `"low"` (ratio 0),
`"medium"` (0 < ratio < 0.5), or `"high"` (ratio >= 0.5). Denominator is
"open," not "all loops ever" — a pile of *finished* work shouldn't make
the companion sound more stressed; the pressure this is meant to
capture is specifically "how much of what's currently on your plate is
sitting untouched."

**Implementation is one dict lookup, not a UI element** — literally
`TONE_HINTS[_backlog_pressure(db)]`, a string appended to whichever
system prompt is about to generate companion text, computed fresh on
every relevant LLM call (decompose, stale nudge, merge nudge, summary).
No new column, no new endpoint, nothing in `NoteOut` or any API
response — the spec was explicit that this should only ever be
perceptible through phrasing, and the implementation follows that
literally: there's no code path where a pressure *value* is ever
returned to the frontend to display, only text the LLM already produces
differently because of it.

**Bug fix, found while building this**: `_is_stale` never checked
`note.status`. A leaf note (no children) that was already stale-flagged
right before being completed would register as stale *forever*
afterward — `peek_count` doesn't decrease on completion, and "no
completed child" is vacuously true for a note with zero children
regardless of its own status. This wasn't caught by earlier testing
because no earlier test completed an already-stale leaf note. It matters
now specifically because the pressure signal counts stale loops, and a
phantom-stale completed loop would have inflated it forever. Fixed by
short-circuiting `_is_stale` to `False` whenever `note.status ==
NoteStatus.done`.

**Consequence worth naming, found while designing the test cases, not
guessed at**: a stale-nudge message can never be generated at "low"
pressure, structurally. The nudge only fires when a note crosses into
`stale`, which means `stale_count >= 1` at that moment, which means the
ratio is never exactly 0. So while decompose/summary messages can land
in any of the three tones, stale nudges only ever land in "medium" or
"high" — there's no scenario where the companion sounds extra-warm while
simultaneously telling you a loop's been neglected, which (after
noticing it) seems like the right emergent behavior rather than a gap to
fix.

Verified live against the real Groq API with three manually-forced
pressure levels, comparing the *same* underlying task/message type
across levels to isolate the tone difference from content differences:

- Decompose's first-step message for "plan a weekend hike" at low (1
  open loop, 0 stale): *"pick a trail that suits your vibe — do you want
  something chill and easy or a bit more challenging?"* — inviting,
  a little playful. At medium (1 stale / 3 open): similar warmth,
  slightly less elaborate. At high (1 stale / 2 open, ratio exactly at
  the 0.5 threshold): *"figure out where you want to go — look up some
  trails in your area and check the weather forecast"* — flatter, more
  purely instructional, no invitation to chat back.
- A stale nudge for the identical task ("write the novel," identical
  peek/backdate history) at medium (1 stale diluted across 5 open
  loops): *"Hey, just checking in on that novel you wanted to write —
  still feeling like you want to tackle it, or has your interest shifted
  elsewhere?"* — capitalized, fuller sentence, genuine question. At high
  (the same note as the *only* open loop, ratio 1.0): *"hey, still
  thinking about writing that novel or is it on the backburner for
  now"* — lowercase, shorter, trails off without a question mark,
  "backburner" reads as resigned rather than curious. The gradient is
  real and consistent with the spec's description (warmer/longer at low,
  shorter/quieter/no-exclamation-points at high) without being a jarring
  personality swing between calls — "subtly," as asked for.

## 2026-07-23 — Blank paper background

Removed `.canvas`'s ruled-horizontal-lines + red-margin-line
`background-image` entirely, leaving just `background-color:
var(--paper)`. The subtle grain texture didn't need re-adding —
`.app::before`'s SVG `feTurbulence` overlay already covers the whole
`.app` container, canvas included, so removing the canvas's own
background layer just lets that grain show through on its own instead
of underneath the ruled-lines pattern.

Kept `--paper-line` (still used for the header's dashed
perforation-style border, unrelated to the canvas) but removed
`--paper-margin` from `index.css` — it was only ever referenced by the
now-deleted margin-line gradient, so keeping it would just be an unused
CSS custom property.

Verified live: canvas renders as plain, uniform paper with no visible
lines; ran a full create-loop → decompose message → Done → thread flow
against the new background to confirm nothing else regressed. No
console errors.

## 2026-07-23 — Focus styling: no default browser outline, an intentional ring instead

The default dashed browser focus outline was showing up on note-card
buttons and chat-thread inputs — it read as generic web-app chrome
against the paper look. Removed it globally (`button`, `input`,
`[tabindex]{ outline: none; }` in `index.css`) and replaced it with a
soft accent-colored `box-shadow` ring (new `--focus-ring` custom
property, an rgba of `--accent`), scoped to `:focus-visible` rather than
plain `:focus` so the ring only appears for keyboard/assistive-tech
navigation, not on every mouse click.

Did this as one global rule in `index.css` rather than per-component
selectors in `App.css` — every focusable element in the app (note-card
action buttons, chat-thread buttons and inputs, the new-loop input) is
already a plain `<button>` or `<input>`, so one base-element rule covers
all of them without needing to enumerate `.note-card button`,
`.chat-thread__input input`, etc. separately. The `[tabindex]` selector
is defensive — nothing in the codebase sets an explicit `tabIndex`
today (confirmed via grep), but it's a one-line hedge against a future
custom focusable element being missed.

The focus-visible ring intentionally *replaces* each element's existing
`box-shadow` (e.g. `--shadow-soft`) rather than compositing with it —
simpler, and still reads clearly as "this is focused" without needing a
multi-layer shadow.

Verified live: tabbing through a card's "view thread" button and an
open thread's "done"/close controls shows the accent glow, not the
browser default; plain mouse clicks show no ring at all. No console
errors.

## 2026-07-25 — Version gallery: four pages of one notebook, tabs drawn as the thing you'd grab

Adding a 4-page gallery where each page renders the same loops data
through a different anti-avoidance mechanic (v1 companion / v2 ink /
v3 dice / v4 fade). Navigation decisions:

- **Tabs are notebook index tabs on the right edge, not a navbar.** The
  framing is "four pages of the same physical notebook," so the
  switcher is drawn as the thing you'd actually grab to flip pages:
  paper-colored tabs sticking out of the right edge, inactive ones
  tucked toward the edge (`translateX(7px)`, dim `--fold` paper),
  the current one pulled flush and accent-bordered like the page
  you're holding open. Hover pulls a tab halfway out (`translateX(3px)`,
  180ms ease) — the "about to flip" feel.
- **Page state is client-only `useState`, no router.** Four values, no
  deep-linking requirement, no URL semantics worth designing yet;
  adding react-router for this would be infrastructure before need.
- **All pages share one `notes` state in App; `refresh()` re-runs on
  every page flip.** Same backend, same data — a loop created on v1
  must appear on v2–v4 immediately, and a cheap refetch on flip is
  simpler and more correct than trying to keep four pages' caches
  coherent.
- **v1 is untouched behaviorally** — its canvas JSX just moved inside a
  `{page === "v1" && ...}` guard; every handler, state hook, and the
  ChatThread wiring is byte-identical.

Verified live: tabs render, v2 flip shows placeholder, flipping back to
v1 and opening a loop's thread works exactly as before (peek + messages
+ done button). No console errors.

## 2026-07-25 — v2 ink reveal: the mechanic is the easing curves

v2 replaces dread with curiosity: the next step exists on the page but
is illegible — ghost ink, developed by rubbing. Every implementation
choice below is a psychology decision first:

- **Reveal effort: ~600px of pointer travel, per-event delta capped at
  40px.** 600px is 2-3 deliberate swipes across a line of text — enough
  that reading the step is something you *did*, not something done to
  you (effort creates ownership of the reveal), but under a second of
  actual work. The 40px per-event cap means a single fast flick can't
  cash in the whole reveal: rubbing has to be sustained, like an actual
  scratch card. Progress never decays — ink doesn't un-develop, and a
  partial accidental reveal (mousing across the page) is a *feature*:
  a half-stirred smudge is more enticing than an untouched one.
- **Blur eases OUT, opacity eases IN — deliberately opposite curves.**
  Blur falls fast at the start (easeOutQuad from 7px): the very first
  rub visibly stirs the ink, which is the hook — instant feedback that
  rubbing works. But opacity blooms late (easeInQuad from 0.25): actual
  legibility only lands near the end, so the payoff (reading the words)
  stays at the finish line where it pulls you through. One linear curve
  for both would either spoil the text early or make early rubbing feel
  dead.
- **The reveal snap gets a 300ms ease transition** ("ink drying"), and
  the ✓ done affordance fades in over 400ms *after* legibility — the
  action appears as a consequence of reading, not alongside it.
- **CSS blur/opacity on the whole stroke, not canvas pixel-scratching.**
  Per the spec's implementation guidance — pointer-travel accumulation
  driving `filter: blur()` + `opacity` inline styles sells the develop
  effect fully; positional scratch-through (only the rubbed region
  clears) would need canvas compositing for marginal psychological
  gain, since the unit of curiosity is the sentence, not the pixel.
- **Only the current step exists visually, ever** — future steps aren't
  rendered blurred, they aren't rendered at all (the API never sends
  them; fog-of-war already guarantees this server-side). A folded loop
  shows only a "crack it open" affordance which reuses the same
  thread/start orchestration as v1, so a skip-proposal surfaces here
  too: the *suggestion* becomes the ghost stroke, and revealing it
  uncovers "you could just call this done" with the same folded→done
  completion path v1's accept-skip uses.
- **Fully developing a stroke fires one `peek`** — same avoidance-memory
  signal as v1's thread-open, at the moment that means the same thing
  ("I looked at what this needs"). Rubbing partway doesn't peek; you
  haven't seen it yet.
- **Advance is `thread/advance`, not raw complete** — so the v1 chat
  thread stays in sync: a step completed by rubbing-and-checking on v2
  shows up as the same done/step messages in the loop's thread.
  Verified live: completed a step on v2, flipped to v1, thread showed
  both the finished step and the new one.

Known nit found live: drag-rubbing text-selected the ✓ done button
(blue highlight mid-rub) — fixed with `user-select: none` on the whole
ghost row, not just the stroke.

## 2026-07-25 — v3 dice roll: surrender the choosing, and what the house rules protect

v3 removes the flinch by removing the decision: the page is nearly
empty, and the notebook picks. Mechanic-to-implementation mapping:

- **The roll takes 900ms and physically tumbles** (two full spins with
  two decreasing hops, easing `cubic-bezier(0.22, 0.85, 0.35, 1)` —
  fast launch, long settle). Selection is instant, but showing the
  answer instantly would read as a *lookup*, and the psychology needs a
  *ritual*: the anticipation gap is where "I chose" gets replaced by
  "the die chose." The keyframes end at 718deg ≡ the die's resting
  -2deg tilt, so the animation can fill-none and hand back to the base
  transform without a visual jump.
- **The dare slams in with overshoot** (`cubic-bezier(0.2, 1.4, 0.4, 1)`,
  380ms, from scale 1.5): thrown, not faded in — a dare should land
  with weight. It renders as one bold handwritten line with a small
  "from “loop”" attribution, and *no other loops anywhere on the page*:
  scope can't trigger dread if it isn't rendered.
- **One re-roll, then the die grays out with a handwritten "no
  take-backs" scribble** — enforced playfully (accent-ink margin note,
  not an error message) but enforced for real (the button disables).
  Endless re-rolling would turn the page back into browsing-with-extra
  -steps, which is exactly the choosing this page exists to remove.
  The re-roll also excludes the current dare when other candidates
  exist — re-rolling into the same step would feel rigged.
- **"Not today" resets the roll budget.** Folding the dare away
  (`scaleY` collapse, 400ms ease-in — a quiet put-away, deliberately
  nothing like v1's crumple, since nothing is being destroyed) writes
  *nothing* to the backend and returns the die. Declining by name is an
  honest exit, not a dodge, so it buys the dice back; the friction of
  having to say "not today" (rather than re-roll) is the point.
- **The die only chooses among loops that already have a face-up
  step.** Folded loops would need an LLM decompose mid-roll; more
  importantly, the page's contract is zero deciding, and "should this
  loop get cracked open?" is a decision. Randomness is plain frontend
  `Math.random` over active loops' current steps — existing endpoints
  only, per spec.
- **A landed dare fires one `peek`** (the notebook showed you the
  step), and "done" goes through `thread/advance` so the v1 chat
  thread records the completion — same cross-page consistency contract
  as v2. Verified live: rolled, re-rolled into "no take-backs",
  declined with "not today" (die returned, budget reset), rolled again
  and completed — backend showed the step done and the next sibling
  promoted.

## 2026-07-25 — v4 shrinking page: decay curve, demo compression, and what counts as a touch

v4 makes neglect visible instead of nagging about it: every active
loop's current step is written on the page, and its ink opacity is a
function of time since the loop was last touched. Mapping decisions:

- **DEMO-COMPRESSED TIMESCALE**: full fade takes **4 minutes**
  (`FADE_WINDOW_MS`), purely so the mechanic is demonstrable in one
  sitting. The real product would fade over days — the same scale
  Feature B's stale detection already uses (3 days). This constant is
  the single knob; nothing else in the page knows the timescale.
- **Decay eases IN (`t^1.7`), floor at 0.08, never zero.** Fresh ink
  barely fades for a while — a step you touched moments ago shouldn't
  look mortal, or the page reads as punishing. The acceleration comes
  late, creating a rescue window that feels quietly urgent with no
  badge, counter, or red (the spec's hard constraint — even the ✓
  complete affordance uses plain ink here, not the accent used
  everywhere else in the app). The floor exists because the page never
  erases anything by itself: it only ever *asks*, via the whisper.
- **Continuity: opacity recomputes every 5s, CSS bridges with a 1s
  linear transition** — the ink reads as continuously dying rather than
  stepping, without a 60fps JS loop.
- **"Last touch" = max(loop.created_at, loop.last_peeked_at,
  step.created_at).** Reuses Feature B's peek timestamp (newly exposed
  in `NoteOut` as `last_peeked_at` — the one backend change in this
  commit), so a touch on ANY page counts: v1 thread-open, v2 full
  reveal, v3 landed dare. The step's own created_at is in the max so a
  freshly promoted step starts at full ink even if the loop's peek is
  old. Backend timestamps are naive UTC, so the frontend parses them
  with an explicit `Z` suffix — parsing raw would skew every elapsed
  computation by the local UTC offset.
- **The whisper state** (elapsed past the window): the line sits at
  floor opacity and two choices appear in the page's smallest voice —
  "touch it to re-ink" (a `peek`: resets the clock, and by Feature B's
  own semantics recommits you) or "let it go." Letting go plays a slow
  even fade-to-blank with the faintest blur (`fade-reclaim`, 900ms
  ease-out) and then DELETEs — same animate-then-delete pattern as v1's
  crumple but deliberately opposite in feeling: v1 destroys a note, v4's
  page *absorbs* it.
- **Completing re-inks permanently**: done steps render as full-opacity
  bold strikethrough strokes that never fade — the record of what you
  did is the one thing the page never forgets. "Done" also fires a peek
  (completing is the strongest touch there is) before the shared
  `thread/advance`.

Verified live: mid-fade ink at partial opacity; ✓ completed a step
(done-stroke appeared, next step arrived at full ink); backdated
timestamps in SQLite to force the whisper (test-data shortcut for the
4-minute wait); "touch it to re-ink" restored full ink; "let it go"
played the reclaim fade and deleted the loop, landing on the blank-page
empty state. Clean console on a fresh load.

## 2026-07-25 — Input classification: the companion never errors, and non-tasks resolve to done

Typing "hey" or a person's name as a new loop used to get decomposed
into nonsense steps. The decompose LLM call now classifies first —
same single call, no new endpoint, no extra round-trip: the
classification instructions and two new response shapes ("chat" for
not-a-task, "clarify" for ambiguous) were added to
`DECOMPOSE_SYSTEM_PROMPT` alongside the existing steps/skip shapes.

- **Never a validation error.** Whatever the input, the companion
  responds conversationally: greetings/names/venting/questions get a
  warm in-character redirect ("chat" → a `chat` message, e.g. "hey!
  got anything on your mind you've been putting off?"); underspecified
  maybe-tasks ("gym", "mom") get exactly one conversational question
  ("clarify" → a `clarify_prompt` message). Two new `MessageKind`
  values; SQLite stores the enum as VARCHAR with no CHECK constraint,
  so no migration needed.
- **How non-task entries are stored: kept, and immediately resolved to
  `done`.** Deleting the note would cascade-delete the very exchange
  the user just had (messages FK to the loop), and the frontend holds
  the thread open at that moment. Marking it done instead exits it from
  every mechanic *by existing invariants, with zero new filtering
  anywhere*: v2 ghost strokes, v3 dice candidates, and v4 fade lines
  all select `active` loops only; stale detection short-circuits on
  done; backlog pressure counts only not-done loops. The status is
  assigned directly rather than via the complete path — nothing was
  accomplished, so no promotion/cascade/celebration logic should run.
  Accepted side effects, on purpose: the loop shows as a struck-through
  done card on v1 (the conversation stays revisitable via "view
  thread") and appears in v2's done ledger. Distinguishing "completed"
  from "was never a task" client-side would need per-loop message
  fetches; not worth it.
- **Clarify re-entry rides the existing free-text endpoint.** No new
  route: `POST /notes/{id}/messages` now checks — loop still folded, no
  children, an unresolved `clarify_prompt` exists — and if so treats
  the text as the answer: resolves the prompt and re-runs decompose
  with `'They originally wrote: "…" / When asked to clarify, they
  said: "…"'` as the user prompt (the prompt tells the model to
  strongly prefer steps/skip once a clarification is present). The
  result goes through `_act_on_proposal`, a helper extracted from
  thread/start, so a clarified "gym" gets exactly the same treatment
  (including Feature C merge detection) as a note that was unambiguous
  from the start — and a clarify answer that's still not a task
  resolves to chat+done like any other non-task. Once the loop has
  children the same endpoint falls through to the summary path
  unchanged.
- **Frontend: two rendering-only changes.** `handleSendMessage` now
  refreshes notes after sending (a clarify answer can crack the loop
  open — the Done button needs the new active child — or resolve it to
  done), and the thread input's placeholder switches to "reply…" while
  a clarify question is pending. `chat`/`clarify_prompt` bubbles render
  through the existing generic message rendering; no new action UI.

Verified live, all five spec inputs routed correctly: "hey" → chat +
loop done; "priya" → chat + done; "gym" → clarify (loop stayed
folded), then the reply "get back into a routine, 3 mornings a week"
re-entered decompose and cracked it open with a first step; "cook
biryani thursday" → steps; "what should i eat" → chat + done. Also
verified in the UI (v1 create-"hey" and full clarify conversation),
the summary path regression (a loop with children still gets a
summary), and that the "hey" loop appears in no v2 ghost stroke, v3
dice pool, or v4 fade line. No console errors.

## 2026-07-25 — Notebook first: plain ink by default, machinery only on consent

Identity correction: the app had drifted into feeling like an AI
chatbot — every keystroke summoned a companion. Reset: it is a
notebook (think Apple Notes). Writing and saving text is the primary
act; the loop machinery is a feature that activates only on consent,
only for task-like notes.

- **`Note.kind`: `plain` | `loop`, default `plain`.** A plain note is
  ink on paper — no status semantics, no fold dimming, no dog-ear, no
  strike-through, no thread, editable in place (new
  `PATCH /notes/{id}`, double-click to edit; editing resets
  `task_like` so re-classification reads the new text). The ONLY paths
  from plain to loop are the whisper tap and the note menu's "crack
  this" — both call thread/start, and the kind flip happens server-side
  there (plus inside `_crack_open`, covering the manual-step and raw
  HTTP paths; the skip path needs the thread/start flip since it never
  reaches `_crack_open`). Nothing ever flips a note back.
- **Exclusion is enforced at both layers.** Backend: `_is_stale`
  returns False for non-loops, `_backlog_pressure` counts only loops
  (a page full of journaling is not backlog), and merge detection
  already only scans active loops. Frontend: v2/v3/v4 all filter
  `kind === "loop"` explicitly, so plain notes never appear as ghost
  strokes, dice candidates, or fading lines even if a status ever
  leaked.
- **Classification became recognition, not conversation.** The
  chat/clarify response shapes from the previous commit are gone; the
  decompose prompt reverted to its two task shapes (steps/skip) and
  only runs on consent. A new, separate `POST /notes/{id}/classify`
  runs AFTER save (frontend fire-and-forget — the save itself never
  waits) with a single yes/no prompt: task-like or plain writing, with
  "when in doubt, plain — a wrong task nudge is worse than silence"
  and underspecified fragments ("gym", "mom") explicitly binned as
  plain. True's only effect is the whisper affordance; False and
  failure (task_like NULL) are indistinguishable by design — silence
  is correct behavior either way. The clarify path is deleted
  entirely: an ambiguous note just stays plain, crackable manually.
  Groq gotcha found live: JSON mode 400s unless the word "JSON"
  appears in the prompt — the first classify prompt draft didn't say
  it, and every classify silently no-opped.
- **The whisper doesn't nag.** "looks like a loop — crack it?" in
  faint handwritten accent ink; visible for 10 minutes
  (demo-compressed, like v4's fade window), with a CSS fade whose
  `animation-delay` is set inline to a negative value derived from
  note age — so a re-render or page flip resumes the countdown
  mid-fade instead of restarting it. After that the notebook has
  offered once and stops.
- **Manual crack respects consent over classification**: "crack this"
  lives in a tiny ⋯ menu on every plain note, whatever the classifier
  said. Cracking a name ("priya") gets decompose's honest answer — a
  skip proposal ("no task to break down here") — which is correct: the
  user asked, the machinery answered; it just never speaks first.
- **Legacy**: `MessageKind.chat`/`clarify_prompt` remain in the enum so
  old threads still load, but nothing creates them anymore. Migration
  was two manual `ALTER TABLE`s (no migration tooling, per the
  standing open item) plus a backfill — anything with children, moved
  status, or a started thread became `kind='loop'` — and the demo DB
  cleanup deleting the previous behavior's not-a-task "done chat
  loops" ("hey"), per spec.

Verified live: a journal entry and a name both save as plain ink and
stay silent (classified false, nothing rendered); "cook biryani
thursday" got the whisper, tapping it started the normal
decompose/thread flow; "priya" was manually cracked from its menu
(skip proposal); v2 and v4 render only cracked loops with the plain
notes absent (v3 shares the identical kind filter). No console errors.

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
- Feature C merge detection is O(all other active loops' pending steps)
  per `decompose` call — fine at demo scale, would need pre-filtering
  before it scales to hundreds of loops.
- Feature C's completion cascade only fires when the linked note is
  already `active`. Linking a step before its own turn comes up does not
  retroactively auto-complete it once that turn arrives naturally — see
  the dedicated entry above for why and what a full fix would need.
- Feature C's merge UI only ever appears when the matched step is the
  first (front-facing) one in the confirmed step list — a match on a
  later step is detected server-side but never surfaced client-side. See
  the dedicated frontend entry above.
- No persistent visual indicator for already-linked notes — the
  connecting thread only shows during the initial accept/decline moment,
  not on subsequent page loads.
- No persistent visual indicator that a note is currently stale on its
  collapsed canvas card — you only find out by opening the thread. This
  is deliberate (matches the spec's "the companion sends an unprompted
  message INTO that loop's thread" framing, not a separate badge), not
  an oversight, but noting it since a first-time user has no way to know
  a loop needs attention without opening every one.
