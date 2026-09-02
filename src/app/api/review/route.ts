import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateSuggestions } from '@/lib/claude';
import { nanoid } from 'nanoid';
import type { SuggestionCategory } from '@/lib/types';

export const runtime = 'nodejs';

interface ReviewRequestBody {
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
    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error('Review generation failed', err);
    return NextResponse.json({ error: 'Review failed' }, { status: 500 });
  }
}
