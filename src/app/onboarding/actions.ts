'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { nanoid } from 'nanoid';
import { generateStyleFingerprint } from '@/lib/claude';

// Keeps the fingerprint prompt within a sane token budget regardless of how
// much past work someone uploads.
const MAX_SAMPLE_CHARS = 24000;

export async function completeOnboarding(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const manifesto = String(formData.get('manifesto') || '').trim();
  const rawFiles = formData
    .getAll('samples')
    .filter((f): f is File => f instanceof File && f.size > 0);

  // Read + store each sample, but don't let one bad file abort onboarding.
  const samples: { title: string; text: string }[] = [];
  for (const file of rawFiles) {
    try {
      const text = await file.text();
      if (!text.trim()) continue;

      const path = `${user.id}/${nanoid(8)}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('past-work')
        .upload(path, file, { contentType: file.type || 'text/plain' });

      if (!uploadError) {
        await supabase
          .from('past_work_samples')
          .insert({ user_id: user.id, storage_path: path, title: file.name });
      }

      samples.push({ title: file.name, text });
    } catch {
      // Skip unreadable files rather than failing the whole flow.
    }
  }

  const profileUpdate: Record<string, unknown> = {
    writing_manifesto: manifesto,
    onboarded_at: new Date().toISOString(),
  };

  if (samples.length > 0) {
    await supabase
      .from('profiles')
      .update({ fingerprint_status: 'processing' })
      .eq('id', user.id);

    try {
      const combined = samples
        .map((s) => `### ${s.title}\n${s.text}`)
        .join('\n\n')
        .slice(0, MAX_SAMPLE_CHARS);

      const summary = await generateStyleFingerprint({ manifesto, sampleText: combined });

      profileUpdate.style_fingerprint = {
        summary,
        sample_count: samples.length,
        generated_at: new Date().toISOString(),
      };
      profileUpdate.fingerprint_status = 'ready';
    } catch {
      profileUpdate.fingerprint_status = 'error';
    }
  }

  await supabase.from('profiles').update(profileUpdate).eq('id', user.id);

  revalidatePath('/subjects');
  redirect('/subjects');
}
