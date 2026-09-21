import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateSuggestions, extractEntities, type ExtractedEntity } from '@/lib/claude';
import { nanoid } from 'nanoid';
import type { SuggestionCategory } from '@/lib/types';

export const runtime = 'nodejs';

interface ReviewRequestBody {
  entryId?: string;
  title: string;
  paragraphs: string[];
  existing: { category: SuggestionCategory; phrase?: string; blockIndex?: number }[];
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as ReviewRequestBody;

  const { data: profile } = await supabase
    .from('profiles')
    .select('writing_manifesto, style_fingerprint, fingerprint_status')
    .eq('id', user.id)
    .single();

  const fingerprintSummary =
    profile?.fingerprint_status === 'ready' && profile.style_fingerprint
      ? String((profile.style_fingerprint as Record<string, unknown>).summary ?? '')
      : null;

  try {
    const raw = await generateSuggestions({
      title: body.title,
      paragraphs: body.paragraphs ?? [],
      existing: body.existing ?? [],
      manifesto: profile?.writing_manifesto || null,
      fingerprintSummary,
    });

    const suggestions = raw.map((s) => ({ id: nanoid(10), ...s }));

    // Outline sync: if this entry lives in the 'chapters' section, also pull
    // any character/place detail out of it — piggybacking on the same
    // explicit Review click rather than running ambiently.
    let entities: ExtractedEntity[] = [];
    if (body.entryId) {
      const { data: entry } = await supabase
        .from('entries')
        .select('section_id, sections!inner(type, subject_id)')
        .eq('id', body.entryId)
        .single<{ section_id: string; sections: { type: string; subject_id: string } }>();

      if (entry?.sections?.type === 'chapters') {
        const subjectId = entry.sections.subject_id;
        const [{ data: knownChars }, { data: knownPlaces }] = await Promise.all([
          supabase.from('characters').select('name').eq('subject_id', subjectId),
          supabase.from('places').select('name').eq('subject_id', subjectId),
        ]);

        entities = await extractEntities({
          chapterTitle: body.title,
          chapterText: (body.paragraphs ?? []).join('\n\n'),
          knownCharacters: (knownChars ?? []).map((c) => c.name),
          knownPlaces: (knownPlaces ?? []).map((p) => p.name),
        });
      }
    }

    return NextResponse.json({ suggestions, entities });
  } catch (err) {
    console.error('Review generation failed', err);
    return NextResponse.json({ error: 'Review failed' }, { status: 500 });
  }
}
