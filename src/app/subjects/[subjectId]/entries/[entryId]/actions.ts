'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { SuggestionCategory, SuggestionOutcome, SuggestionState } from '@/lib/types';

export async function saveEntry(
  subjectId: string,
  entryId: string,
  data: { title: string; content: Record<string, unknown>; content_text: string; word_count: number }
) {
  const supabase = createClient();
  await supabase
    .from('entries')
    .update({
      title: data.title.trim() || 'Untitled',
      content: data.content,
      content_text: data.content_text,
      word_count: data.word_count,
    })
    .eq('id', entryId);
  revalidatePath(`/subjects/${subjectId}`);
}

export async function saveSuggestionState(entryId: string, state: SuggestionState) {
  const supabase = createClient();
  await supabase.from('entries').update({ suggestion_state: state }).eq('id', entryId);
}

export async function recordSuggestionFeedback(
  entryId: string,
  suggestionId: string,
  category: SuggestionCategory,
  outcome: SuggestionOutcome
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('suggestion_feedback').insert({
    user_id: user.id,
    entry_id: entryId,
    suggestion_id: suggestionId,
    category,
    outcome,
  });
}
