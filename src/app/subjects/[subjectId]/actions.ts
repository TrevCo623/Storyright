'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { emptySuggestionState } from '@/lib/types';
import type { SearchResult } from '@/lib/types';

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

// Powers the chapter editor's full-screen search (⌘/Ctrl+? style takeover —
// see SearchIcon in EntryEditor.tsx). Mirrors the search behavior already
// built in editoir-outline-prototype.html's toggleChapterSearch/
// renderChapterSearchResults: search across every chapter/thread entry plus
// characters and places in this subject, title + body/summary, and return a
// short snippet around the first match for each hit.
function snippetFor(text: string, query: string): string {
  if (!text) return '';
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, 120) + (text.length > 120 ? '…' : '');
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 60);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet += '…';
  return snippet;
}

export async function searchSubject(subjectId: string, query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const supabase = createClient();
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`;

  const { data: sections } = await supabase.from('sections').select('id, type').eq('subject_id', subjectId);
  const sectionIds = (sections ?? []).map((s) => s.id);
  const sectionTypeById = new Map((sections ?? []).map((s) => [s.id, s.type]));

  const [{ data: entries }, { data: characters }, { data: places }] = await Promise.all([
    sectionIds.length
      ? supabase
          .from('entries')
          .select('id, title, content_text, section_id')
          .in('section_id', sectionIds)
          .or(`title.ilike.${like},content_text.ilike.${like}`)
          .limit(40)
      : Promise.resolve({ data: [] as { id: string; title: string; content_text: string; section_id: string }[] }),
    supabase
      .from('characters')
      .select('id, name, summary')
      .eq('subject_id', subjectId)
      .or(`name.ilike.${like},summary.ilike.${like}`)
      .limit(20),
    supabase
      .from('places')
      .select('id, name, summary')
      .eq('subject_id', subjectId)
      .or(`name.ilike.${like},summary.ilike.${like}`)
      .limit(20),
  ]);

  const results: SearchResult[] = [];

  (entries ?? []).forEach((e) => {
    const isThread = sectionTypeById.get(e.section_id) === 'threads';
    results.push({
      kind: isThread ? 'thread' : 'chapter',
      id: e.id,
      breadcrumb: isThread ? 'Threads' : 'Chapters',
      title: e.title || 'Untitled',
      snippet: snippetFor(e.content_text || '', q),
    });
  });
  (characters ?? []).forEach((c) => {
    results.push({
      kind: 'character',
      id: c.id,
      breadcrumb: 'Characters',
      title: c.name || 'Untitled',
      snippet: snippetFor(c.summary || '', q),
    });
  });
  (places ?? []).forEach((p) => {
    results.push({
      kind: 'place',
      id: p.id,
      breadcrumb: 'Places',
      title: p.name || 'Untitled',
      snippet: snippetFor(p.summary || '', q),
    });
  });

  return results;
}
