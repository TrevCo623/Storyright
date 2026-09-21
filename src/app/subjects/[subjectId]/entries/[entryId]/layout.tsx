import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AppShell from '@/components/AppShell/AppShell';

// Only the entry/chapter-editor route gets the left accordion nav, matching
// the prototype's #chapterEditorOverlay — the Outline page (one level up)
// deliberately has none.
export default async function EntryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { subjectId: string; entryId: string };
}) {
  const subjectId = params.subjectId;
  const supabase = createClient();

  const { data: subject } = await supabase
    .from('subjects')
    .select('id, title, outline_review')
    .eq('id', subjectId)
    .single();
  if (!subject) notFound();

  const { data: sections } = await supabase
    .from('sections')
    .select('id, type')
    .eq('subject_id', subjectId);

  const chaptersSectionId = sections?.find((s) => s.type === 'chapters')?.id ?? null;
  const threadsSectionId = sections?.find((s) => s.type === 'threads')?.id ?? null;

  const [{ data: chapters }, { data: threads }, { data: characters }, { data: places }] =
    await Promise.all([
      chaptersSectionId
        ? supabase
            .from('entries')
            .select('id, title')
            .eq('section_id', chaptersSectionId)
            .is('parent_entry_id', null)
            .order('position')
        : Promise.resolve({ data: [] as { id: string; title: string }[] }),
      threadsSectionId
        ? supabase
            .from('entries')
            .select('id, title')
            .eq('section_id', threadsSectionId)
            .is('parent_entry_id', null)
            .order('position')
        : Promise.resolve({ data: [] as { id: string; title: string }[] }),
      supabase.from('characters').select('id, name').eq('subject_id', subjectId).order('position'),
      supabase.from('places').select('id, name').eq('subject_id', subjectId).order('position'),
    ]);

  return (
    <AppShell
      subjectId={subjectId}
      subjectTitle={subject.title ?? ''}
      activeEntryId={params.entryId}
      chapters={chapters ?? []}
      threads={threads ?? []}
      characters={characters ?? []}
      places={places ?? []}
      insights={subject.outline_review?.suggestions ?? []}
    >
      {children}
    </AppShell>
  );
}
