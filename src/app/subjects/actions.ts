'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function createSubject(formData: FormData) {
  const title = String(formData.get('title') || '').trim();
  if (!title) return;

  const premise = String(formData.get('premise') || '').trim();
  const themes = String(formData.get('themes') || '').trim();
  const takeaway = String(formData.get('takeaway') || '').trim();

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: subject, error } = await supabase
    .from('subjects')
    .insert({
      user_id: user.id,
      title,
      ...(premise ? { premise } : {}),
      ...(themes ? { themes } : {}),
      ...(takeaway ? { takeaway } : {}),
    })
    .select()
    .single();

  if (error || !subject) {
    throw new Error(error?.message || 'Failed to create subject');
  }

  // Default sections every Subject ships with, per the locked IA.
  await supabase.from('sections').insert([
    { subject_id: subject.id, type: 'chapters', title: 'Chapters', position: 0 },
    { subject_id: subject.id, type: 'threads', title: 'Threads', position: 1 },
    { subject_id: subject.id, type: 'research', title: 'Research & Notes', position: 2 },
  ]);

  revalidatePath('/subjects');
  redirect(`/subjects/${subject.id}`);
}

export async function deleteSubject(subjectId: string) {
  const supabase = createClient();
  // Cascades to sections/entries/characters/places via FK constraints.
  await supabase.from('subjects').delete().eq('id', subjectId);
  revalidatePath('/subjects');
}
