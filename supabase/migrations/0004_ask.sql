-- Storyright: Ask — free-form questions to the AI about one piece of the story
-- (a chapter, thread, character, place, or the story as a whole).
-- Keeps each conversation so the writer can come back to it; the app still
-- works without this table (answers just aren't saved). Safe to run more than once.

create table if not exists public.ask_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  target_kind text not null check (target_kind in ('story', 'entry', 'character', 'place')),
  target_id uuid,
  messages jsonb not null default '[]'::jsonb, -- [{role, content, created_at, quote?}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ask_conversations enable row level security;
drop policy if exists "ask_owner" on public.ask_conversations;
create policy "ask_owner" on public.ask_conversations for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists ask_conversations_target_idx
  on public.ask_conversations(user_id, subject_id, target_kind, target_id, updated_at desc);
