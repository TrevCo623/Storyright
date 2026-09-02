'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { emptySuggestionState } from '@/lib/types';

export async function createSection(subjectId: string, formData: FormData) {
  const title = String(formData.get('title') || '').trim();
  if (!title) return;
  const supabase = createClient();
  const { count } = await supabase
    .from('sections')
    .select('*', { count: 'exact', head: true })
    .eq('subject_id', subjectId);
  await supabase.from('sections').insert({
    subject_id: subjectId,
    type: 'custom',
    title,
    position: count ?? 0,
  });
  revalidatePath(`/subjects/${subjectId}`);
}

export async function createEntry(
  subjectId: string,
  sectionId: string,
  parentEntryId: string | null,
  title: string
) {
  const cleanTitle = title.trim() || 'Untitled';
  const supabase = createClient();
  const { count } = await supabase
    .from('entries')
    .select('*', { count: 'exact', head: true })
    .eq('section_id', sectionId);

  const { data: entry, error } = await supabase
    .from('entries')
    .insert({
      section_id: sectionId,
      parent_entry_id: parentEntryId,
      title: cleanTitle,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      content_text: '',
      word_count: 0,
      position: count ?? 0,
      suggestion_state: emptySuggestionState(),
    })
    .select()
    .single();

  if (error || !entry) throw new Error(error?.message || 'Failed to create entry');

  revalidatePath(`/subjects/${subjectId}`);
  redirect(`/subjects/${subjectId}/entries/${entry.id}`);
}

export async function deleteEntry(subjectId: string, entryId: string) {
  const supabase = createClient();
  await supabase.from('entries').delete().eq('id', entryId);
  revalidatePath(`/subjects/${subjectId}`);
  redirect(`/subjects/${subjectId}`);
}

export async function renameEntry(subjectId: string, entryId: string, title: string) {
  const cleanTitle = title.trim() || 'Untitled';
  const supabase = createClient();
  await supabase.from('entries').update({ title: cleanTitle }).eq('id', entryId);
  revalidatePath(`/subjects/${subjectId}`);
}
