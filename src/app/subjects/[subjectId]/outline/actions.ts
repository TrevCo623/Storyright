'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { ExtractedEntity } from '@/lib/claude';
import { emptySuggestionState } from '@/lib/types';

// ---------- Story summary ----------

export async function saveStorySummary(
  subjectId: string,
  data: { premise: string; themes: string; takeaway: string }
) {
  const supabase = createClient();
  await supabase
    .from('subjects')
    .update({ premise: data.premise, themes: data.themes, takeaway: data.takeaway })
    .eq('id', subjectId);
  revalidatePath(`/subjects/${subjectId}`);
}

// ---------- Chapters (backed by 'chapters' section entries) ----------

export async function saveChapterMeta(
  subjectId: string,
  entryId: string,
  data: { title?: string; synopsis: string; target_feeling: string }
) {
  const supabase = createClient();
  const update: { title?: string; synopsis: string; target_feeling: string } = {
    synopsis: data.synopsis,
    target_feeling: data.target_feeling,
  };
  if (data.title !== undefined) update.title = data.title.trim() || 'Untitled chapter';
  await supabase.from('entries').update(update).eq('id', entryId);
  revalidatePath(`/subjects/${subjectId}`);
}

// One-shot creation from the New Chapter dialog — inserts with title,
// synopsis, and target_feeling already filled in, and (unlike createEntry)
// does NOT redirect, so the writer stays on the Outline page and sees the
// new chapter land in the list.
export async function createChapter(
  subjectId: string,
  sectionId: string,
  data: { title: string; synopsis: string; target_feeling: string }
) {
  const supabase = createClient();
  const { count } = await supabase
    .from('entries')
    .select('*', { count: 'exact', head: true })
    .eq('section_id', sectionId);

  const { data: created, error } = await supabase
    .from('entries')
    .insert({
      section_id: sectionId,
      parent_entry_id: null,
      title: data.title.trim() || 'Untitled chapter',
      synopsis: data.synopsis.trim(),
      target_feeling: data.target_feeling.trim(),
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      content_text: '',
      word_count: 0,
      position: count ?? 0,
      suggestion_state: emptySuggestionState(),
    })
    .select()
    .single();

  if (error || !created) throw new Error(error?.message || 'Failed to create chapter');
  revalidatePath(`/subjects/${subjectId}`);
  return created;
}

// Persists a full drag-and-drop reorder in one round trip. `orderedEntryIds`
// is the complete new top-level order for the chapters section.
export async function reorderChapters(subjectId: string, orderedEntryIds: string[]) {
  const supabase = createClient();
  await Promise.all(
    orderedEntryIds.map((id, position) =>
      supabase.from('entries').update({ position }).eq('id', id)
    )
  );
  revalidatePath(`/subjects/${subjectId}`);
}

// ---------- Characters ----------

export async function createCharacter(
  subjectId: string,
  data: { name: string; role?: string; summary?: string }
) {
  const supabase = createClient();
  const { count } = await supabase
    .from('characters')
    .select('*', { count: 'exact', head: true })
    .eq('subject_id', subjectId);

  const { data: created, error } = await supabase
    .from('characters')
    .insert({
      subject_id: subjectId,
      name: data.name.trim() || 'Unnamed',
      role: data.role?.trim() ?? '',
      summary: data.summary?.trim() ?? '',
      position: count ?? 0,
      source: 'manual',
    })
    .select()
    .single();
  if (error || !created) throw new Error(error?.message || 'Failed to create character');
  revalidatePath(`/subjects/${subjectId}`);
  return created;
}

export async function updateCharacter(
  subjectId: string,
  characterId: string,
  data: { name?: string; role?: string; summary?: string }
) {
  const supabase = createClient();
  await supabase.from('characters').update(data).eq('id', characterId);
  revalidatePath(`/subjects/${subjectId}`);
}

export async function deleteCharacter(subjectId: string, characterId: string) {
  const supabase = createClient();
  await supabase.from('characters').delete().eq('id', characterId);
  revalidatePath(`/subjects/${subjectId}`);
}

// ---------- Places ----------

export async function createPlace(subjectId: string, data: { name: string; summary?: string }) {
  const supabase = createClient();
  const { count } = await supabase
    .from('places')
    .select('*', { count: 'exact', head: true })
    .eq('subject_id', subjectId);

  const { data: created, error } = await supabase
    .from('places')
    .insert({
      subject_id: subjectId,
      name: data.name.trim() || 'Unnamed',
      summary: data.summary?.trim() ?? '',
      position: count ?? 0,
      source: 'manual',
    })
    .select()
    .single();
  if (error || !created) throw new Error(error?.message || 'Failed to create place');
  revalidatePath(`/subjects/${subjectId}`);
  return created;
}

export async function updatePlace(
  subjectId: string,
  placeId: string,
  data: { name?: string; summary?: string }
) {
  const supabase = createClient();
  await supabase.from('places').update(data).eq('id', placeId);
  revalidatePath(`/subjects/${subjectId}`);
}

export async function deletePlace(subjectId: string, placeId: string) {
  const supabase = createClient();
  await supabase.from('places').delete().eq('id', placeId);
  revalidatePath(`/subjects/${subjectId}`);
}

// ---------- Auto-extraction sync ----------
// Called after a chapter Review click surfaces character/place mentions.
// New names become auto-sourced rows the writer can refine; a name that
// already matches a manual entry is left untouched (never overwrite the
// writer's own words), and a name that already matches an *auto* entry gets
// its summary refreshed with the latest synthesis.
export async function syncExtractedEntities(subjectId: string, entities: ExtractedEntity[]) {
  if (!entities.length) return;
  const supabase = createClient();

  const [{ data: existingChars }, { data: existingPlaces }] = await Promise.all([
    supabase.from('characters').select('id, name, source').eq('subject_id', subjectId),
    supabase.from('places').select('id, name, source').eq('subject_id', subjectId),
  ]);

  const charByName = new Map((existingChars ?? []).map((c) => [c.name.toLowerCase().trim(), c]));
  const placeByName = new Map((existingPlaces ?? []).map((p) => [p.name.toLowerCase().trim(), p]));

  let charCount = existingChars?.length ?? 0;
  let placeCount = existingPlaces?.length ?? 0;

  for (const entity of entities) {
    const key = entity.name.toLowerCase().trim();
    if (!key) continue;

    if (entity.type === 'character') {
      const existing = charByName.get(key);
      if (!existing) {
        await supabase.from('characters').insert({
          subject_id: subjectId,
          name: entity.name.trim(),
          role: '',
          summary: entity.summary,
          position: charCount++,
          source: 'auto',
        });
      } else if (existing.source === 'auto') {
        await supabase.from('characters').update({ summary: entity.summary }).eq('id', existing.id);
      }
      // source === 'manual' → leave the writer's own entry alone.
    } else {
      const existing = placeByName.get(key);
      if (!existing) {
        await supabase.from('places').insert({
          subject_id: subjectId,
          name: entity.name.trim(),
          summary: entity.summary,
          position: placeCount++,
          source: 'auto',
        });
      } else if (existing.source === 'auto') {
        await supabase.from('places').update({ summary: entity.summary }).eq('id', existing.id);
      }
    }
  }

  revalidatePath(`/subjects/${subjectId}`);
}
