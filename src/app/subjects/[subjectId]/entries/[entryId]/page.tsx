import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import EntryEditor from '@/components/Editor/EntryEditor';
import type { Entry, SectionType } from '@/lib/types';
import { emptySuggestionState } from '@/lib/types';

// Prototype's chapter-editor breadcrumb reads "Chapters / {title}" — we
// generalize it per the entry's actual section type since our app also
// opens threads (and, in future, research/custom entries) in this editor.
const SECTION_LABELS: Record<SectionType, string> = {
  chapters: 'Chapters',
  threads: 'Threads',
  research: 'Research',
  custom: 'Notes',
};

export default async function EntryPage({
  params,
}: {
  params: { subjectId: string; entryId: string };
}) {
  const supabase = createClient();
  const { data: entry } = await supabase
    .from('entries')
    .select('*, sections!inner(type)')
    .eq('id', params.entryId)
    .single<Entry & { sections: { type: SectionType } }>();

  if (!entry) notFound();

  const { sections, ...entryFields } = entry;

  // Defensive default — older rows or a bad write could leave this null.
  const normalized: Entry = {
    ...entryFields,
    suggestion_state: entryFields.suggestion_state ?? emptySuggestionState(),
  };

  return (
    <EntryEditor
      subjectId={params.subjectId}
      entry={normalized}
      sectionLabel={SECTION_LABELS[sections.type] ?? 'Chapters'}
    />
  );
}
