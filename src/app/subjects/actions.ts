'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function createSubject(formData: FormData) {
  const title = String(formData.get('title') || '').trim();
  if (!title) return;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: subject, error } = await supabase
    .from('subjects')
    .insert({ user_id: user.id, title })
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
