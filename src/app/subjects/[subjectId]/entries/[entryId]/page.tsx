import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import EntryEditor from '@/components/Editor/EntryEditor';
import type { Entry } from '@/lib/types';
import { emptySuggestionState } from '@/lib/types';

export default async function EntryPage({
  params,
}: {
  params: { subjectId: string; entryId: string };
}) {
  const supabase = createClient();
  const { data: entry } = await supabase
    .from('entries')
    .select('*')
    .eq('id', params.entryId)
    .single();

  if (!entry) notFound();

  // Defensive default — older rows or a bad write could leave this null.
  const normalized: Entry = {
    ...entry,
    suggestion_state: entry.suggestion_state ?? emptySuggestionState(),
  };

  return <EntryEditor subjectId={params.subjectId} entry={normalized} />;
}
