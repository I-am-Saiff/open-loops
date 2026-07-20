# Open Loops

A freeform to-do notebook that fights task avoidance. Loops (tasks) live
anywhere on an infinite canvas, start folded, and only ever reveal one
sub-step at a time — fog of war for your to-do list.

See `docs/SPEC.md` for the full concept and v1 scope, and
`docs/DECISIONS.md` for the technical choices behind it.

## Stack

- **Backend:** FastAPI + SQLite via SQLAlchemy for now — a local prototype
  db with zero external setup, not yet Postgres/Supabase (see
  `docs/DECISIONS.md`, "Swap backend DB to local SQLite")
- **Frontend:** Vite + React + TypeScript (chosen over Next.js — no
  SSR/auth need for a single-page canvas app; see `docs/DECISIONS.md`)
- **Canvas:** custom lightweight drag layer (chosen over tldraw; see
  `docs/DECISIONS.md`)

## Structure

```
open-loops/
  backend/       FastAPI app
  frontend/      Vite + React app
  docs/          spec, decisions, notes
  .env.example
```

## Status

v1 in progress. Backend (create/list/crack-open/complete) and a working
canvas frontend are both up — core loop (create → crack open → complete
sub-steps one at a time → parent auto-completes) works end-to-end.
Dragging notes is visual/session-only for now (not yet persisted to the
backend — see `docs/DECISIONS.md`). Single demo user, no auth, one canvas
page, manual sub-step entry only (see `docs/SPEC.md` Phase 2 for
AI-assisted breakdown).

## Setup

### Backend

```
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

No `.env` or database setup needed — it runs on a local SQLite file
(`backend/openloops.db`, created automatically, gitignored). See
`.env.example` if you want to point `DATABASE_URL` elsewhere.

### Frontend

```
cd frontend
npm install
npm run dev
```

Talks to the backend at `http://localhost:8000` by default (override via
`VITE_API_BASE_URL` in a root `.env`, see `.env.example`).
