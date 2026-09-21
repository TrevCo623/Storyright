import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import OutlineView from '@/components/Outline/OutlineView';

export default async function SubjectOverviewPage({
  params,
}: {
  params: { subjectId: string };
}) {
  const subjectId = params.subjectId;
  const supabase = createClient();

  const { data: subject } = await supabase
    .from('subjects')
    .select('id, title, premise, themes, takeaway, outline_review')
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
        ? supabase.from('entries').select('*').eq('section_id', chaptersSectionId).order('position')
        : Promise.resolve({ data: [] as never[] }),
      threadsSectionId
        ? supabase.from('entries').select('*').eq('section_id', threadsSectionId).order('position')
        : Promise.resolve({ data: [] as never[] }),
      supabase.from('characters').select('*').eq('subject_id', subjectId).order('position'),
      supabase.from('places').select('*').eq('subject_id', subjectId).order('position'),
    ]);

  return (
    <OutlineView
      subjectId={subjectId}
      title={subject.title ?? ''}
      chaptersSectionId={chaptersSectionId}
      threadsSectionId={threadsSectionId}
      premise={subject.premise ?? ''}
      themes={subject.themes ?? ''}
      takeaway={subject.takeaway ?? ''}
      outlineReview={subject.outline_review ?? null}
      chapters={chapters ?? []}
      threads={threads ?? []}
      characters={characters ?? []}
      places={places ?? []}
    />
  );
}
