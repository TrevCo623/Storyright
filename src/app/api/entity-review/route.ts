import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateEntityReview } from '@/lib/claude';
import { entityTerms, findAppearances } from '@/lib/appearances';
import type { Character, EntityMention, EntityReview, Place } from '@/lib/types';

export const runtime = 'nodejs';

// Review button on a Character / Place detail page → Insights tab.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as { subjectId?: string; kind?: 'character' | 'place'; id?: string };
  if (!body.subjectId || !body.id || (body.kind !== 'character' && body.kind !== 'place')) {
    return NextResponse.json({ error: 'subjectId, kind and id required' }, { status: 400 });
  }
  const isCharacter = body.kind === 'character';

  const { data: subject } = await supabase
    .from('subjects')
    .select('id, title, premise, themes, user_id')
    .eq('id', body.subjectId)
    .single();
  if (!subject || subject.user_id !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: entity } = await supabase
    .from(isCharacter ? 'characters' : 'places')
    .select('*')
    .eq('id', body.id)
    .single<Character & Place>();
  if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: sections } = await supabase.from('sections').select('id, type').eq('subject_id', body.subjectId);
  const chaptersSectionId = sections?.find((s) => s.type === 'chapters')?.id;
  const threadsSectionId = sections?.find((s) => s.type === 'threads')?.id;

  const [{ data: chapters }, { data: threads }, { data: mentions }] = await Promise.all([
    chaptersSectionId
      ? supabase
          .from('entries')
          .select('id, title, synopsis, content_text')
          .eq('section_id', chaptersSectionId)
          .is('parent_entry_id', null)
          .order('position')
      : Promise.resolve({ data: [] as { id: string; title: string; synopsis: string; content_text: string }[] }),
    threadsSectionId
      ? supabase.from('entries').select('title, synopsis, linked_entity_ids').eq('section_id', threadsSectionId)
      : Promise.resolve({ data: [] as { title: string; synopsis: string; linked_entity_ids: string[] }[] }),
    supabase.from('entity_mentions').select('*').eq('entity_id', body.id),
  ]);

  const apps = findAppearances(entity, isCharacter, chapters ?? [], (mentions ?? []) as EntityMention[]);
  const name = entity.name || (isCharacter ? 'Unnamed character' : 'Unnamed place');
  const terms = entityTerms(entity.name, entity.aliases, isCharacter).map((t) => t.toLowerCase());
  const relatedThreads = (threads ?? [])
    .filter(
      (t) =>
        (t.linked_entity_ids ?? []).includes(entity.id) ||
        terms.some((term) => `${t.title} ${t.synopsis}`.toLowerCase().includes(term))
    )
    .map((t) => `${t.title}${t.synopsis ? ` — ${t.synopsis}` : ''}`);

  const fields = isCharacter
    ? [
        { label: 'Background', value: entity.summary },
        { label: 'Themes', value: entity.themes },
        { label: 'Where they begin', value: entity.arc_start },
        { label: 'What changes them', value: entity.arc_turn },
        { label: 'Where they end up', value: entity.arc_end },
      ]
    : [
        { label: 'Description', value: entity.summary },
        { label: 'History', value: entity.history },
        { label: 'Significance', value: entity.significance },
      ];

  try {
    const result = await generateEntityReview({
      kind: body.kind,
      storyTitle: subject.title,
      premise: subject.premise ?? '',
      themes: subject.themes ?? '',
      name,
      role: isCharacter ? entity.role : undefined,
      fields: fields.map((f) => ({ label: f.label, value: f.value ?? '' })),
      appearances: apps.map((a) => ({
        chapter: `Chapter ${a.index + 1} "${a.title}"`,
        how: a.named ? 'named' : `referred to as "${a.term}"`,
        snippet: a.snippet,
      })),
      chapterCount: chapters?.length ?? 0,
      threads: relatedThreads,
    });
    const review: EntityReview = { ...result, generated_at: new Date().toISOString() };
    await supabase
      .from(isCharacter ? 'characters' : 'places')
      .update({ review })
      .eq('id', entity.id);
    return NextResponse.json({ review });
  } catch (err) {
    console.error('Entity review failed', err);
    return NextResponse.json({ error: 'Review failed' }, { status: 500 });
  }
}
