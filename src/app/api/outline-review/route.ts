import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateOutlineReview } from '@/lib/claude';
import type { OutlineReview, OutlineSuggestion } from '@/lib/types';
import { nanoid } from 'nanoid';

export const runtime = 'nodejs';

interface OutlineReviewRequestBody {
  subjectId: string;
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as OutlineReviewRequestBody;
  if (!body.subjectId) return NextResponse.json({ error: 'subjectId required' }, { status: 400 });

  const { data: subject } = await supabase
    .from('subjects')
    .select('id, title, premise, themes, takeaway, user_id')
    .eq('id', body.subjectId)
    .single();
  if (!subject || subject.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [{ data: sections }, { data: characters }, { data: places }] = await Promise.all([
    supabase.from('sections').select('id, type').eq('subject_id', body.subjectId),
    supabase
      .from('characters')
      .select('name, role, summary')
      .eq('subject_id', body.subjectId)
      .order('position'),
    supabase.from('places').select('name, summary').eq('subject_id', body.subjectId).order('position'),
  ]);

  const chaptersSectionId = sections?.find((s) => s.type === 'chapters')?.id;
  const threadsSectionId = sections?.find((s) => s.type === 'threads')?.id;

  const [{ data: chapterEntries }, { data: threadEntries }] = await Promise.all([
    chaptersSectionId
      ? supabase
          .from('entries')
          .select('title, synopsis, target_feeling')
          .eq('section_id', chaptersSectionId)
          .order('position')
      : Promise.resolve({ data: [] as { title: string; synopsis: string; target_feeling: string }[] }),
    threadsSectionId
      ? supabase.from('entries').select('title').eq('section_id', threadsSectionId).order('position')
      : Promise.resolve({ data: [] as { title: string }[] }),
  ]);

  try {
    const result = await generateOutlineReview({
      title: subject.title,
      premise: subject.premise ?? '',
      themes: subject.themes ?? '',
      takeaway: subject.takeaway ?? '',
      chapters: (chapterEntries ?? []).map((c) => ({
        title: c.title,
        synopsis: c.synopsis ?? '',
        target_feeling: c.target_feeling ?? '',
      })),
      characters: characters ?? [],
      places: places ?? [],
      threads: (threadEntries ?? []).map((t) => t.title),
    });

    const suggestions: OutlineSuggestion[] = result.suggestions.map((s) => ({ id: nanoid(10), ...s }));
    const outlineReview: OutlineReview = {
      summary: result.summary,
      suggestions,
      generated_at: new Date().toISOString(),
    };

    await supabase.from('subjects').update({ outline_review: outlineReview }).eq('id', body.subjectId);

    return NextResponse.json({ review: outlineReview });
  } catch (err) {
    console.error('Outline review failed', err);
    return NextResponse.json({ error: 'Review failed' }, { status: 500 });
  }
}
