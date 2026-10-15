import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import EntryEditor from '@/components/Editor/EntryEditor';
import type { Entry, SectionType } from '@/lib/types';
import { emptySuggestionState } from '@/lib/types';

// Singular label for the top bar's crumb ("Chapter 3 – The Crossing"). We
// generalize per the entry's section type since this editor also opens
// threads (and, in future, research/custom entries).
const SECTION_SINGULAR: Record<SectionType, string> = {
  chapters: 'Chapter',
  threads: 'Thread',
  research: 'Research',
  custom: 'Note',
};

export default async function EntryPage({
  params,
  searchParams,
}: {
  params: { subjectId: string; entryId: string };
  searchParams: { from?: string };
}) {
  const supabase = createClient();
  const [{ data: entry }, { data: subject }] = await Promise.all([
    supabase
      .from('entries')
      .select('*, sections!inner(type)')
      .eq('id', params.entryId)
      .single<Entry & { sections: { type: SectionType } }>(),
    supabase.from('subjects').select('id, title').eq('id', params.subjectId).single(),
  ]);

  if (!entry || !subject) notFound();

  const { sections, ...entryFields } = entry;

  // Position among its top-level siblings, for "Chapter N".
  const { data: siblings } = await supabase
    .from('entries')
    .select('id')
    .eq('section_id', entryFields.section_id)
    .is('parent_entry_id', null)
    .order('position');
  const index = siblings?.findIndex((s) => s.id === entryFields.id) ?? -1;
  const singular = SECTION_SINGULAR[sections.type] ?? 'Chapter';
  const crumbPrefix = index >= 0 ? `${singular} ${index + 1}` : singular;

  // Defensive default — older rows or a bad write could leave this null.
  const normalized: Entry = {
    ...entryFields,
    suggestion_state: entryFields.suggestion_state ?? emptySuggestionState(),
  };

  // Opened from a character/place page (?from=character:<id>:<tab>) → the
  // back link becomes a breadcrumb that can return there.
  let from: { kind: 'character' | 'place'; id: string; name: string; tab: string } | undefined;
  const [fromKind, fromId, fromTab] = (searchParams.from ?? '').split(':');
  if ((fromKind === 'character' || fromKind === 'place') && fromId) {
    const { data: ent } = await supabase
      .from(fromKind === 'character' ? 'characters' : 'places')
      .select('id, name')
      .eq('id', fromId)
      .eq('subject_id', params.subjectId)
      .maybeSingle();
    if (ent) from = { kind: fromKind, id: ent.id, name: ent.name || 'Untitled', tab: fromTab || 'appearances' };
  }

  return (
    <EntryEditor
      from={from}
      subjectId={params.subjectId}
      subjectTitle={subject.title ?? ''}
      entry={normalized}
      crumbPrefix={crumbPrefix}
      sectionType={sections.type}
    />
  );
}
