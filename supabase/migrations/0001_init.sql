-- Storyright initial schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.

-- ---------- profiles ----------
-- One row per authenticated user, auto-created on signup. Holds the
-- personalization layer: writing manifesto + style fingerprint.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  writing_manifesto text default '',
  style_preferences jsonb not null default '{}'::jsonb,
  style_fingerprint jsonb,
  fingerprint_status text not null default 'not_started'
    check (fingerprint_status in ('not_started', 'processing', 'ready', 'error')),
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up (Google OAuth).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- subjects ----------
-- Top-level container ("project-first" nav). One row per book/essay
-- collection/notebook/etc.
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subjects enable row level security;
create policy "subjects_owner" on public.subjects for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- sections ----------
-- Chapters / Scribbles / Research (defaults, type != 'custom') plus any
-- number of user-created custom folders, per subject.
create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  type text not null default 'custom' check (type in ('chapters', 'scribbles', 'research', 'custom')),
  title text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.sections enable row level security;
create policy "sections_owner" on public.sections for all
  using (exists (select 1 from public.subjects s where s.id = sections.subject_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.subjects s where s.id = sections.subject_id and s.user_id = auth.uid()));

-- ---------- entries ----------
-- A single document. parent_entry_id enables arbitrary nesting within a
-- section (e.g. "Personal Essays > On Leaving").
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections(id) on delete cascade,
  parent_entry_id uuid references public.entries(id) on delete cascade,
  title text not null default 'Untitled',
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  content_text text not null default '',
  word_count integer not null default 0,
  position integer not null default 0,
  suggestion_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.entries enable row level security;
create policy "entries_owner" on public.entries for all
  using (
    exists (
      select 1 from public.sections sec
      join public.subjects s on s.id = sec.subject_id
      where sec.id = entries.section_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sections sec
      join public.subjects s on s.id = sec.subject_id
      where sec.id = entries.section_id and s.user_id = auth.uid()
    )
  );

create index if not exists entries_section_idx on public.entries(section_id);
create index if not exists entries_parent_idx on public.entries(parent_entry_id);

-- ---------- suggestion_feedback ----------
-- Accept/reject training signal (Done vs Dismissed), one row per terminal
-- action on a suggestion instance. Feeds the personalization engine.
create table if not exists public.suggestion_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null references public.entries(id) on delete cascade,
  suggestion_id text not null,
  category text not null,
  outcome text not null check (outcome in ('done', 'dismissed')),
  created_at timestamptz not null default now()
);

alter table public.suggestion_feedback enable row level security;
create policy "feedback_owner" on public.suggestion_feedback for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- past_work_samples ----------
-- Metadata for uploaded past-work files (the files themselves live in the
-- "past-work" Storage bucket, created below).
create table if not exists public.past_work_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  title text,
  created_at timestamptz not null default now()
);

alter table public.past_work_samples enable row level security;
create policy "samples_owner" on public.past_work_samples for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- advice_threads ----------
-- Highlight-to-ask conversations, scoped to an entry + the highlighted range.
create table if not exists public.advice_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null references public.entries(id) on delete cascade,
  selected_text text not null,
  messages jsonb not null default '[]'::jsonb, -- [{role, content, created_at}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.advice_threads enable row level security;
create policy "advice_owner" on public.advice_threads for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Storage: past-work bucket ----------
-- Private bucket; objects are stored under `${user_id}/filename`, enforced by
-- the policies below via the first path segment.
insert into storage.buckets (id, name, public)
values ('past-work', 'past-work', false)
on conflict (id) do nothing;

create policy "past_work_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'past-work' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "past_work_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'past-work' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "past_work_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'past-work' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- updated_at helper ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subjects_set_updated_at on public.subjects;
create trigger subjects_set_updated_at before update on public.subjects
  for each row execute procedure public.set_updated_at();

drop trigger if exists entries_set_updated_at on public.entries;
create trigger entries_set_updated_at before update on public.entries
  for each row execute procedure public.set_updated_at();

drop trigger if exists advice_set_updated_at on public.advice_threads;
create trigger advice_set_updated_at before update on public.advice_threads
  for each row execute procedure public.set_updated_at();
