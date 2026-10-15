import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  generateSuggestions,
  extractEntities,
  extractReferences,
  type ExtractedEntity,
  type FeedbackExample,
} from '@/lib/claude';
import { nanoid } from 'nanoid';
import type { SuggestionCategory, SuggestionState } from '@/lib/types';

export const runtime = 'nodejs';

interface ReviewRequestBody {
  entryId?: string;
  title: string;
  paragraphs: string[];
  existing: { category: SuggestionCategory; phrase?: string; blockIndex?: number; instances?: string[] }[];
}

// Turns the writer's recent Done/Dismiss history into Review tuning: the notes
// they dismissed (so Review stops repeating that kind of advice) and how often
// they thanked a kudos note. suggestion_feedback only stores ids, so the note
// text comes from each entry's saved suggestion_state. Pattern instances
// ("Leave as is" on one spot) aren't counted — only whole-note decisions.
async function loadFeedbackTuning(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<{ dismissed: FeedbackExample[]; praiseThanked: number }> {
  const { data: rows } = await supabase
    .from('suggestion_feedback')
    .select('entry_id, suggestion_id, outcome, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(150);
  const feedback = (rows ?? []).filter((r) => !String(r.suggestion_id).includes('.'));
  if (!feedback.length) return { dismissed: [], praiseThanked: 0 };

  const entryIds = Array.from(new Set(feedback.map((r) => r.entry_id)));
  const { data: entries } = await supabase.from('entries').select('id, suggestion_state').in('id', entryIds);
  const stateById = new Map((entries ?? []).map((e) => [e.id as string, e.suggestion_state as SuggestionState | null]));

  const dismissed: FeedbackExample[] = [];
  const seen = new Set<string>();
  let praiseThanked = 0;
  for (const r of feedback) {
    const def = stateById.get(r.entry_id)?.allSuggestions?.[r.suggestion_id];
    if (!def) continue;
    if (r.outcome === 'done') {
      if (def.praise) praiseThanked++;
      continue;
    }
    const key = `${def.category}|${def.heading}|${def.desc}`;
    if (seen.has(key) || dismissed.length >= 25) continue;
    seen.add(key);
    dismissed.push({ category: def.category, heading: def.heading, desc: def.desc, praise: def.praise });
  }
  return { dismissed, praiseThanked };
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

  // Best-effort: Review still runs if the history can't be read.
  const tuning = await loadFeedbackTuning(supabase, user.id).catch((err) => {
    console.error('Feedback tuning failed', err);
    return { dismissed: [], praiseThanked: 0 };
  });

  const fingerprintSummary =
    profile?.fingerprint_status === 'ready' && profile.style_fingerprint
      ? String((profile.style_fingerprint as Record<string, unknown>).summary ?? '')
      : null;

  try {
    // Start the suggestions call right away and run the outline sync (entity
    // extraction + indirect references) alongside it, so the whole Review
    // takes about as long as its slowest AI call instead of the sum of them.
    const suggestionsTask = generateSuggestions({
      title: body.title,
      paragraphs: body.paragraphs ?? [],
      existing: body.existing ?? [],
      manifesto: profile?.writing_manifesto || null,
      fingerprintSummary,
      dismissed: tuning.dismissed,
      praiseThanked: tuning.praiseThanked,
    });
    suggestionsTask.catch(() => {}); // awaited below; avoids an unhandled-rejection crash meanwhile

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

        // Appearances: record indirect references ("her father") for this
        // chapter, in parallel with entity extraction. Best-effort — never
        // blocks the Review itself.
        const refsTask = (async () => {
        try {
          const [{ data: charRows }, { data: placeRows }] = await Promise.all([
            supabase.from('characters').select('id, name, aliases').eq('subject_id', subjectId),
            supabase.from('places').select('id, name, aliases').eq('subject_id', subjectId),
          ]);
          const roster = [
            ...(charRows ?? []).map((c) => ({ id: c.id, kind: 'character' as const, name: c.name, aliases: c.aliases ?? [] })),
            ...(placeRows ?? []).map((p) => ({ id: p.id, kind: 'place' as const, name: p.name, aliases: p.aliases ?? [] })),
          ].filter((e) => e.name);
          const refs = await extractReferences({
            chapterText: (body.paragraphs ?? []).join('\n\n'),
            entities: roster,
          });
          await supabase.from('entity_mentions').delete().eq('entry_id', body.entryId);
          if (refs.length) {
            const kindOf = new Map(roster.map((e) => [e.id, e.kind]));
            await supabase.from('entity_mentions').insert(
              refs.map((r) => ({
                subject_id: subjectId,
                entry_id: body.entryId,
                entity_kind: kindOf.get(r.entityId),
                entity_id: r.entityId,
                via: r.via,
                mention_count: r.count,
                snippet: r.snippet,
              }))
            );
          }
        } catch (err) {
          console.error('Reference extraction failed', err);
        }
        })();

        try {
          entities = await extractEntities({
            chapterTitle: body.title,
            chapterText: (body.paragraphs ?? []).join('\n\n'),
            knownCharacters: (knownChars ?? []).map((c) => c.name),
            knownPlaces: (knownPlaces ?? []).map((p) => p.name),
          });
        } catch (err) {
          // Outline sync is a bonus — never fail the writer's Review over it.
          console.error('Entity extraction failed', err);
        }
        await refsTask;
      }
    }

    const raw = await suggestionsTask;
    const suggestions = raw.map((s) => ({ id: nanoid(10), ...s }));

    return NextResponse.json({ suggestions, entities });
  } catch (err) {
    console.error('Review generation failed', err);
    return NextResponse.json({ error: 'Review failed' }, { status: 500 });
  }
}
