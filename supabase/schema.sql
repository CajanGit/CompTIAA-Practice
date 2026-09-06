-- Run this in your Supabase project's SQL Editor (Supabase Dashboard > SQL Editor > New query)
-- This creates the tables the app needs and opens them up for a single-user,
-- no-login app using the public anon key.

-- 1. Question bank -------------------------------------------------
create table if not exists questions (
  id text primary key,
  exam text not null check (exam in ('core1', 'core2')),
  domain text not null,
  question text not null,
  options jsonb not null,       -- array of 4 strings
  correct_index int not null,   -- 0-based index into options
  explanation text not null
);

-- 2. Quiz history (one row per completed quiz) ----------------------
create table if not exists quiz_history (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  exam text not null,
  score int not null,
  total int not null,
  domain_stats jsonb not null,  -- { "Domain Name": { "correct": n, "total": n }, ... }
  created_at timestamptz not null default now()
);

-- 3. Bookmarks --------------------------------------------------------
create table if not exists bookmarks (
  device_id text not null,
  question_id text not null references questions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (device_id, question_id)
);

-- Row Level Security ---------------------------------------------------
-- This app has no login. Every device gets a random UUID stored in
-- localStorage, and that value scopes their history/bookmarks. RLS is
-- enabled but the policies below allow the anon key to read/write freely,
-- since there's no real auth layer to check against. This is fine for a
-- personal study tool but is NOT a substitute for real per-user security —
-- anyone with your anon key could read/write any device_id's rows.

alter table questions enable row level security;
alter table quiz_history enable row level security;
alter table bookmarks enable row level security;

create policy "questions are readable by anyone" on questions
  for select using (true);

create policy "history is readable and writable by anyone" on quiz_history
  for all using (true) with check (true);

create policy "bookmarks are readable and writable by anyone" on bookmarks
  for all using (true) with check (true);
