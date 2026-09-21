-- Storyright: Outline page schema
-- Adds the project-level "master plan" model: story summary fields on
-- subjects, per-chapter synopsis/feeling on entries, first-class
-- Characters/Places tables, a cached Outline Review result, and renames
-- the 'scribbles' section type to 'threads' (Trev: Threads replaces
-- Scribbles as the catch-all bucket; Characters/Places are separate,
-- structured source-of-truth lists rather than freeform entries).

-- ---------- subjects: story summary + cached outline review ----------
alter table public.subjects
  add column if not exists premise text not null default '',
  add column if not exists themes text not null default '',
  add column if not exists takeaway text not null default '',
  add column if not exists outline_review jsonb;

-- ---------- entries: per-chapter planning metadata ----------
-- Meaningful for entries in the 'chapters' section; harmless elsewhere.
alter table public.entries
  add column if not exists synopsis text not null default '',
  add column if not exists target_feeling text not null default '';

-- ---------- sections: rename 'scribbles' -> 'threads' ----------
-- Drop the old constraint, migrate existing rows, THEN add the new
-- constraint — adding it before the data migration rejects any row still
-- tagged 'scribbles' since that value is no longer in the allowed list.
alter table public.sections drop constraint if exists sections_type_check;

update public.sections set type = 'threads', title = 'Threads'
  where type = 'scribbles';

alter table public.sections
  add constraint sections_type_check check (type in ('chapters', 'threads', 'research', 'custom'));

-- ---------- characters ----------
-- Project-level source of truth. Manually authored from the Outline page,
-- or auto-populated (source='auto') the first time a character is
-- mentioned in a chapter, then refined by the writer over time.
create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  name text not null,
  role text not null default '',
  summary text not null default '',
  position integer not null default 0,
  source text not null default 'manual' check (source in ('manual', 'auto')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.characters enable row level security;
create policy "characters_owner" on public.characters for all
  using (exists (select 1 from public.subjects s where s.id = characters.subject_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.subjects s where s.id = characters.subject_id and s.user_id = auth.uid()));

create index if not exists characters_subject_idx on public.characters(subject_id);

drop trigger if exists characters_set_updated_at on public.characters;
create trigger characters_set_updated_at before update on public.characters
  for each row execute procedure public.set_updated_at();

-- ---------- places ----------
create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  name text not null,
  summary text not null default '',
  position integer not null default 0,
  source text not null default 'manual' check (source in ('manual', 'auto')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.places enable row level security;
create policy "places_owner" on public.places for all
  using (exists (select 1 from public.subjects s where s.id = places.subject_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.subjects s where s.id = places.subject_id and s.user_id = auth.uid()));

create index if not exists places_subject_idx on public.places(subject_id);

drop trigger if exists places_set_updated_at on public.places;
create trigger places_set_updated_at before update on public.places
  for each row execute procedure public.set_updated_at();
