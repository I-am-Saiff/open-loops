# Open Loops

A freeform to-do notebook that fights task avoidance. Loops (tasks) live
anywhere on an infinite canvas, start folded, and only ever reveal one
sub-step at a time — fog of war for your to-do list.

See `docs/SPEC.md` for the full concept and v1 scope, and
`docs/DECISIONS.md` for the technical choices behind it.

## Stack

- **Backend:** FastAPI + Supabase (Postgres)
- **Frontend:** Vite + React (chosen over Next.js — no SSR/auth need for a
  single-page canvas app; see `docs/DECISIONS.md`)
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

v1 in progress. Single demo user, no auth, one canvas page, manual
sub-step entry only (see `docs/SPEC.md` Phase 2 for AI-assisted breakdown).

## Setup

### Backend

```
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env   # fill in DATABASE_URL (Supabase Postgres)
psql "$DATABASE_URL" -f migrations/0001_create_notes.sql
uvicorn app.main:app --reload
```

### Frontend

Not yet scaffolded.
