import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateAdviceReply } from '@/lib/claude';
import type { AdviceMessage } from '@/lib/types';

export const runtime = 'nodejs';

interface AdviceRequestBody {
  entryId: string;
  entryTitle: string;
  selectedText: string;
  threadId?: string;
  message: string;
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as AdviceRequestBody;
  if (!body.message?.trim()) {
    return NextResponse.json({ error: 'Message required' }, { status: 400 });
  }

  let threadId = body.threadId;
  let messages: AdviceMessage[] = [];

  if (threadId) {
    const { data: thread } = await supabase
      .from('advice_threads')
      .select('*')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();
    if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    messages = (thread.messages as AdviceMessage[]) ?? [];
  }

  messages = [...messages, { role: 'user', content: body.message, created_at: new Date().toISOString() }];

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
    const reply = await generateAdviceReply({
      entryTitle: body.entryTitle,
      selectedText: body.selectedText,
      history: messages.map((m) => ({ role: m.role, content: m.content })),
      manifesto: profile?.writing_manifesto || null,
      fingerprintSummary,
    });

    messages = [...messages, { role: 'assistant', content: reply, created_at: new Date().toISOString() }];

    if (threadId) {
      await supabase.from('advice_threads').update({ messages }).eq('id', threadId);
    } else {
      const { data: created, error } = await supabase
        .from('advice_threads')
        .insert({
          user_id: user.id,
          entry_id: body.entryId,
          selected_text: body.selectedText,
          messages,
        })
        .select()
        .single();
      if (error || !created) throw new Error(error?.message || 'Failed to create thread');
      threadId = created.id;
    }

    return NextResponse.json({ threadId, messages });
  } catch (err) {
    console.error('Advice generation failed', err);
    return NextResponse.json({ error: 'Advice failed' }, { status: 500 });
  }
}
