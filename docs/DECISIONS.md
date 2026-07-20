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

## Open items / known incomplete for v1

- No auth: all requests operate against a single hardcoded demo user
  concept. Do not add a `users` table or auth middleware for v1 — explicitly
  deferred, not an oversight.
- No optimistic-locking / conflict handling on drag position updates
  (single user, so last-write-wins is fine for v1).
- No automated tests scaffolded yet — to be added alongside the first
  backend endpoints, not as a follow-up phase.
