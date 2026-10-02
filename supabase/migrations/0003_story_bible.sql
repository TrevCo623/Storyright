-- Storyright: Character & Place detail pages ("story bible")
-- Adds the fields behind the new Character / Place detail pages, the
-- Main / Supporting (Key / Other) split on the Outline, thread links, and
-- the AI-found indirect references ("her father") shown under Appearances.
-- Safe to run more than once.

-- ---------- characters ----------
alter table public.characters
  add column if not exists is_main boolean not null default false,
  add column if not exists aliases text[] not null default '{}',
  add column if not exists themes text not null default '',
  add column if not exists arc_start text not null default '',
  add column if not exists arc_turn text not null default '',
  add column if not exists arc_end text not null default '',
  add column if not exists review jsonb,
  add column if not exists promote_dismissed boolean not null default false;

-- ---------- places ----------
alter table public.places
  add column if not exists is_key boolean not null default false,
  add column if not exists aliases text[] not null default '{}',
  add column if not exists history text not null default '',
  add column if not exists significance text not null default '',
  add column if not exists review jsonb,
  add column if not exists promote_dismissed boolean not null default false;

-- ---------- threads → characters / places ----------
-- A thread added from a character's or place's page is linked to it, so it
-- shows on that page even if the thread text never names them.
alter table public.entries
  add column if not exists linked_entity_ids uuid[] not null default '{}';

-- ---------- indirect references found on chapter Review ----------
-- Exact name / alias matches are computed live from chapter text; this only
-- stores what the AI finds on an explicit Review (e.g. "her father" → Elias).
-- Replaced per chapter each time that chapter is reviewed.
create table if not exists public.entity_mentions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  entry_id uuid not null references public.entries(id) on delete cascade,
  entity_kind text not null check (entity_kind in ('character', 'place')),
  entity_id uuid not null,
  via text not null default '',
  mention_count integer not null default 1,
  snippet text not null default '',
  created_at timestamptz not null default now(),
  unique (entry_id, entity_kind, entity_id)
);

alter table public.entity_mentions enable row level security;
drop policy if exists "entity_mentions_owner" on public.entity_mentions;
create policy "entity_mentions_owner" on public.entity_mentions for all
  using (exists (select 1 from public.subjects s where s.id = entity_mentions.subject_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.subjects s where s.id = entity_mentions.subject_id and s.user_id = auth.uid()));

create index if not exists entity_mentions_subject_idx on public.entity_mentions(subject_id);
create index if not exists entity_mentions_entity_idx on public.entity_mentions(entity_id);
