import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { ChapterLite } from '@/lib/appearances';
import type { Character, Entry, EntityMention, Place } from '@/lib/types';

// Server-side data for a Character / Place detail page.
export async function loadEntityDetail(subjectId: string, kind: 'character' | 'place', entityId: string) {
  const supabase = createClient();

  const [{ data: subject }, { data: entity }, { data: sections }] = await Promise.all([
    supabase.from('subjects').select('id, title').eq('id', subjectId).single(),
    supabase
      .from(kind === 'character' ? 'characters' : 'places')
      .select('*')
      .eq('id', entityId)
      .eq('subject_id', subjectId)
      .single(),
    supabase.from('sections').select('id, type').eq('subject_id', subjectId),
  ]);
  if (!subject || !entity) notFound();

  const chaptersSectionId = sections?.find((s) => s.type === 'chapters')?.id ?? null;
  const threadsSectionId = sections?.find((s) => s.type === 'threads')?.id ?? null;

  const [{ data: chapters }, { data: threads }, { data: mentions }] = await Promise.all([
    chaptersSectionId
      ? supabase
          .from('entries')
          .select('id, title, synopsis, content_text')
          .eq('section_id', chaptersSectionId)
          .is('parent_entry_id', null)
          .order('position')
      : Promise.resolve({ data: [] as ChapterLite[] }),
    threadsSectionId
      ? supabase
          .from('entries')
          .select('*')
          .eq('section_id', threadsSectionId)
          .is('parent_entry_id', null)
          .order('position')
      : Promise.resolve({ data: [] as Entry[] }),
    supabase.from('entity_mentions').select('*').eq('entity_id', entityId),
  ]);

  return {
    subjectTitle: subject.title ?? '',
    entity: entity as Character | Place,
    chapters: (chapters ?? []) as ChapterLite[],
    threads: (threads ?? []) as Entry[],
    threadsSectionId,
    mentions: (mentions ?? []) as EntityMention[],
  };
}
