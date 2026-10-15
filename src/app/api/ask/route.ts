import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { streamAskReply } from '@/lib/claude';
import { buildStoryContext } from '@/lib/storyContext';
import type { AskMessage, AskTarget, AskTargetKind } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: AskTargetKind[] = ['story', 'entry', 'character', 'place'];

function parseTarget(kind: unknown, id: unknown): AskTarget | null {
  if (typeof kind !== 'string' || !KINDS.includes(kind as AskTargetKind)) return null;
  if (kind === 'story') return { kind: 'story', id: null };
  return typeof id === 'string' && id ? { kind: kind as AskTargetKind, id } : null;
}

// GET /api/ask?subjectId=…&kind=…&id=… → the latest saved conversation about
// that piece (or null). Returns null too if conversations aren't being saved
// yet (the 0004_ask.sql migration hasn't been run).
export async function GET(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const subjectId = url.searchParams.get('subjectId');
  const target = parseTarget(url.searchParams.get('kind'), url.searchParams.get('id'));
  if (!subjectId || !target) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  let query = supabase
    .from('ask_conversations')
    .select('id, messages')
    .eq('user_id', user.id)
    .eq('subject_id', subjectId)
    .eq('target_kind', target.kind);
  query = target.id ? query.eq('target_id', target.id) : query.is('target_id', null);
  const { data, error } = await query.order('updated_at', { ascending: false }).limit(1);
  if (error) return NextResponse.json({ conversation: null, saving: false });
  const row = data?.[0];
  return NextResponse.json({
    conversation: row ? { id: row.id, messages: (row.messages ?? []) as AskMessage[] } : null,
    saving: true,
  });
}

interface AskRequestBody {
  subjectId: string;
  target: AskTarget;
  includeThreads?: boolean;
  conversationId?: string | null;
  /** The conversation so far, ending with the new user message. */
  messages: AskMessage[];
}

// POST → streams the answer as plain text. The conversation id (when saved)
// comes back in the X-Ask-Conversation header.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as AskRequestBody;
  const target = parseTarget(body.target?.kind, body.target?.id);
  const history = (body.messages ?? []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content?.trim());
  if (!body.subjectId || !target || !history.length || history[history.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const [context, { data: profile }] = await Promise.all([
    buildStoryContext(supabase, body.subjectId, target, !!body.includeThreads),
    supabase.from('profiles').select('writing_manifesto, style_fingerprint, fingerprint_status').eq('id', user.id).single(),
  ]);
  if (!context) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const fingerprintSummary =
    profile?.fingerprint_status === 'ready' && profile.style_fingerprint
      ? String((profile.style_fingerprint as Record<string, unknown>).summary ?? '')
      : null;

  // Save the question up front (so the conversation has an id to return), then
  // the answer once it's finished. Best-effort: without the table, Ask still works.
  let conversationId = body.conversationId ?? null;
  try {
    if (conversationId) {
      await supabase
        .from('ask_conversations')
        .update({ messages: history, updated_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('user_id', user.id);
    } else {
      const { data, error } = await supabase
        .from('ask_conversations')
        .insert({
          user_id: user.id,
          subject_id: body.subjectId,
          target_kind: target.kind,
          target_id: target.id ?? null,
          messages: history,
        })
        .select('id')
        .single();
      if (!error && data) conversationId = data.id;
    }
  } catch {
    conversationId = null;
  }

  const gen = streamAskReply({
    storyContext: context.text,
    targetLabel: context.targetLabel,
    includeThreads: !!body.includeThreads,
    history: history.map((m) => ({ role: m.role, content: m.content, quote: m.quote })),
    manifesto: profile?.writing_manifesto || null,
    fingerprintSummary,
  });

  // Pull the first chunk before answering, so a failed call (bad key, overload)
  // returns a proper error instead of an empty stream.
  let first: IteratorResult<string>;
  try {
    first = await gen.next();
  } catch (err) {
    console.error('Ask failed', err);
    return NextResponse.json({ error: 'Ask failed' }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let reply = '';
      try {
        if (!first.done && first.value) {
          reply += first.value;
          controller.enqueue(encoder.encode(first.value));
        }
        for await (const chunk of gen) {
          reply += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        console.error('Ask stream failed', err);
        controller.enqueue(encoder.encode('\n\n[Something went wrong partway through — try asking again.]'));
      }
      if (conversationId && reply.trim()) {
        const messages: AskMessage[] = [...history, { role: 'assistant', content: reply.trim(), created_at: new Date().toISOString() }];
        await supabase
          .from('ask_conversations')
          .update({ messages, updated_at: new Date().toISOString() })
          .eq('id', conversationId)
          .eq('user_id', user.id);
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      ...(conversationId ? { 'X-Ask-Conversation': conversationId } : {}),
    },
  });
}
