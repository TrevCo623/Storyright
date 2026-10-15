import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateAlternatives } from '@/lib/claude';
import type { SuggestionCategory } from '@/lib/types';

export const runtime = 'nodejs';

interface AlternativesRequestBody {
  category: SuggestionCategory;
  heading: string;
  desc: string;
  phrase: string;
  sentence: string;
  paragraph: string;
  target?: 'passage' | 'paragraph';
  avoid?: string[];
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as AlternativesRequestBody;
  if (!body.phrase?.trim()) return NextResponse.json({ error: 'Phrase required' }, { status: 400 });

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
    const result = await generateAlternatives({
      category: body.category,
      heading: body.heading,
      desc: body.desc,
      phrase: body.phrase,
      sentence: body.sentence || body.phrase,
      paragraph: body.paragraph || body.sentence || body.phrase,
      target: body.target === 'paragraph' ? 'paragraph' : 'passage',
      avoid: body.avoid,
      manifesto: profile?.writing_manifesto || null,
      fingerprintSummary,
    });
    if (!result.options.length) return NextResponse.json({ error: 'No options' }, { status: 502 });
    return NextResponse.json(result);
  } catch (err) {
    console.error('Alternatives generation failed', err);
    return NextResponse.json({ error: 'Alternatives failed' }, { status: 500 });
  }
}
