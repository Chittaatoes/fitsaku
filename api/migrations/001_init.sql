-- FitSaku / openGym durable storage on PostgreSQL (Supabase).
-- Applied by api/pg-store.js (runMigrations) and recorded in schema_migrations. Never edit an
-- applied migration: add 002_*.sql instead.
--
-- Model: the API keeps its document-based design (one JSON document per profile, one for the
-- user database) and the revision / write-id / merge semantics live in the application
-- (api/server.js PUT /api/data, api/sync-stamps.js). The database guarantees what the files used to:
-- durable writes, and a conditional write on `user_state.rev` (compare-and-swap).

-- The user database: users, passkey credentials (public keys + counters), push subscriptions,
-- invites, device links. One row; `version` is the optimistic lock between API instances.
create table if not exists app_documents (
  name        text primary key,
  body        jsonb not null,
  version     bigint not null default 1,
  updated_at  timestamptz not null default now()
);

-- Profile state: settings, routines, workouts, completed sets, weigh-ins ... exactly the JSON the
-- client syncs. `rev` and `wid` mirror the document's own `_rev` / `_wid`, so the conditional
-- update can compare and swap without parsing the body.
create table if not exists user_state (
  user_id     text primary key,
  rev         bigint not null,
  wid         text,
  body        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Secrets that must outlive a redeploy when they are not supplied by environment variables
-- (session signing secret, Web Push VAPID keys). Backend-only.
create table if not exists app_secrets (
  name        text primary key,
  value       text not null,
  created_at  timestamptz not null default now()
);

-- Sign-in and admin events (the JSONL audit log). `id` is the API's own sequence, never reused.
create table if not exists audit_events (
  id          bigint primary key,
  ts          bigint not null,
  body        jsonb not null
);
create index if not exists audit_events_ts_idx on audit_events (ts);

-- Small named documents of the optional AI Coach: instance config (coach.json, secrets encrypted
-- by the API) and per-profile records (caps, pending proposals, history).
create table if not exists kv_documents (
  name        text primary key,
  body        text not null,
  updated_at  timestamptz not null default now()
);

-- Defence in depth: nothing here is meant to be reached through Supabase's Data API (PostgREST).
-- RLS on with no policy denies the `anon` and `authenticated` roles everything. The API connects
-- with the database owner role, which bypasses RLS, and enforces per-user authorisation itself.
alter table app_documents enable row level security;
alter table user_state    enable row level security;
alter table app_secrets   enable row level security;
alter table audit_events  enable row level security;
alter table kv_documents  enable row level security;
