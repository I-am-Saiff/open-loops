-- NOT applied by the current prototype. The prototype runs on local
-- SQLite via SQLAlchemy (backend/app/models.py), created automatically
-- on startup — no manual migration step. This file is kept as the target
-- schema for the eventual Postgres swap once the concept is validated.
-- See docs/DECISIONS.md ("Swap backend DB to local SQLite").
--
-- Open Loops v1 schema: a single self-referencing notes table.
-- See docs/DECISIONS.md for why one table, why clock_timestamp(), and the
-- exact state-machine rules this schema is built to support.

create extension if not exists pgcrypto;

create type note_status as enum ('folded', 'active', 'done');

create table notes (
    id uuid primary key default gen_random_uuid(),
    parent_id uuid references notes (id) on delete cascade,
    text text not null,
    x double precision not null default 0,
    y double precision not null default 0,
    status note_status not null default 'folded',
    -- clock_timestamp(), not now(): a crack-open request inserts several
    -- sibling rows in one transaction, and now() is frozen for the whole
    -- transaction. clock_timestamp() advances per row so ORDER BY
    -- created_at gives a real, stable sibling sequence.
    created_at timestamptz not null default clock_timestamp()
);

create index notes_parent_id_idx on notes (parent_id);
create index notes_parent_id_status_idx on notes (parent_id, status);
