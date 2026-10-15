'use client';

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AskMessage, AskTarget } from '@/lib/types';

export type AskKindLabel = 'Story' | 'Chapter' | 'Thread' | 'Character' | 'Place' | 'Note';

export interface AskTargetOption {
  target: AskTarget;
  name: string;
  kindLabel: AskKindLabel;
}

interface Props {
  subjectId: string;
  target: AskTarget;
  targetName: string;
  kindLabel: AskKindLabel;
  /** rail: lives at the bottom of the editor's Notes; page: an Insights tab section. */
  variant: 'rail' | 'page';
  /** Rail only: false shows just the "Ask about this…" box under the notes. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Outline only: lets the writer pick what the question is about. */
  options?: AskTargetOption[];
  onTargetChange?: (option: AskTargetOption) => void;
  /** A highlighted passage to attach to the next question. */
  quote?: string | null;
  onQuoteChange?: (quote: string | null) => void;
}

const STARTERS: Record<AskKindLabel, string[]> = {
  Thread: ['How could I weave this into the story?', 'Which theme does this connect to?', 'Where would this fit best?'],
  Chapter: ['What is this chapter doing for the story?', 'How could this echo the themes more?', "What's missing here?"],
  Character: ['Where could their arc go deeper?', 'How do they tie into the themes?', 'Which scenes need them more?'],
  Place: ['How could this place carry more meaning?', 'Where should it come back?', 'What does it say about the people here?'],
  Story: ["What's the strongest thread running through this?", 'Where does the story sag?', 'Which themes are emerging?'],
  Note: ['How could I use this in the story?', 'What does this connect to?', 'What should I do with this?'],
};

// Light formatting for answers: paragraphs, "- " bullet lists, **bold**.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>
  );
}
function Formatted({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-•*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l.replace(/^\s*[-•*]\s+/, '• '))}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

const targetKey = (t: AskTarget) => `${t.kind}:${t.id ?? ''}`;

export default function AskPanel({
  subjectId,
  target,
  targetName,
  kindLabel,
  variant,
  expanded = true,
  onExpandedChange,
  options,
  onTargetChange,
  quote = null,
  onQuoteChange,
}: Props) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [includeThreads, setIncludeThreads] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const busy = streaming !== null;
  const key = targetKey(target);

  // Load the latest saved conversation about this piece.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setConversationId(null);
    setMessages([]);
    setError(null);
    const params = new URLSearchParams({ subjectId, kind: target.kind, ...(target.id ? { id: target.id } : {}) });
    fetch(`/api/ask?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { conversation: { id: string; messages: AskMessage[] } | null } | null) => {
        if (cancelled || !data?.conversation) return;
        setConversationId(data.conversation.id);
        setMessages(data.conversation.messages ?? []);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, key]);

  // Keep the newest text in view while an answer streams in.
  useEffect(() => {
    const el = threadRef.current;
    if (el && variant === 'rail') el.scrollTop = el.scrollHeight;
  }, [messages, streaming, variant, expanded]);

  // A new highlighted passage → bring the box into focus.
  useEffect(() => {
    if (quote) requestAnimationFrame(() => inputRef.current?.focus());
  }, [quote]);

  const autosize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);
  useEffect(autosize, [input, autosize]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    onExpandedChange?.(true);
    setError(null);
    setInput('');
    const userMsg: AskMessage = {
      role: 'user',
      content: question,
      created_at: new Date().toISOString(),
      ...(quote ? { quote } : {}),
    };
    const history = [...messages, userMsg];
    setMessages(history);
    onQuoteChange?.(null);
    setStreaming('');
    let reply = '';
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId, target, includeThreads, conversationId, messages: history }),
      });
      if (!res.ok || !res.body) throw new Error('Ask failed');
      const id = res.headers.get('X-Ask-Conversation');
      if (id) setConversationId(id);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        setStreaming(reply);
      }
      reply += decoder.decode();
      setMessages([...history, { role: 'assistant', content: reply.trim(), created_at: new Date().toISOString() }]);
    } catch (err) {
      console.error('Ask failed', err);
      setError("Couldn't get an answer — try again.");
      // Put the question back so it isn't lost.
      setMessages(messages);
      setInput(question);
      if (userMsg.quote) onQuoteChange?.(userMsg.quote);
    } finally {
      setStreaming(null);
    }
  }

  function startOver() {
    setConversationId(null);
    setMessages([]);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const placeholder =
    kindLabel === 'Story' ? 'Ask anything about your story…' : `Ask about this ${kindLabel.toLowerCase()}…`;

  const composer = (
    <form
      className="ask-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send(input);
      }}
    >
      {quote && (
        <div className="ask-quote-chip">
          <span className="ask-quote-text">&ldquo;{quote}&rdquo;</span>
          <button type="button" className="ask-quote-x" aria-label="Remove passage" onClick={() => onQuoteChange?.(null)}>
            ×
          </button>
        </div>
      )}
      <div className="ask-input-row">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder={quote ? 'What do you want to know about this passage?' : placeholder}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => variant === 'rail' && messages.length > 0 && onExpandedChange?.(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button type="submit" className="ask-send" disabled={busy || !input.trim()} aria-label="Ask">
          ↑
        </button>
      </div>
    </form>
  );

  // ---- Rail, collapsed: just the box (plus a way back into a saved conversation) ----
  if (variant === 'rail' && !expanded) {
    return (
      <div className="ask-rail-collapsed">
        {messages.length > 0 && (
          <button type="button" className="ask-resume" onClick={() => onExpandedChange?.(true)}>
            <span className="ask-resume-q">{messages.filter((m) => m.role === 'user').slice(-1)[0]?.content}</span>
            <span aria-hidden>›</span>
          </button>
        )}
        {composer}
      </div>
    );
  }

  const scope = (
    <div className="ask-scope">
      {options && onTargetChange ? (
        <label className="ask-about">
          <span className="ask-about-label">About</span>
          <select
            value={key}
            onChange={(e) => {
              const opt = options.find((o) => targetKey(o.target) === e.target.value);
              if (opt) onTargetChange(opt);
            }}
            disabled={busy}
          >
            {(['Story', 'Chapter', 'Character', 'Place', 'Thread'] as AskKindLabel[]).map((group) => {
              const items = options.filter((o) => o.kindLabel === group);
              if (!items.length) return null;
              if (group === 'Story')
                return items.map((o) => (
                  <option key={targetKey(o.target)} value={targetKey(o.target)}>
                    {o.name}
                  </option>
                ));
              return (
                <optgroup key={group} label={`${group}s`}>
                  {items.map((o) => (
                    <option key={targetKey(o.target)} value={targetKey(o.target)}>
                      {o.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
      ) : (
        <span className="ask-about">
          <span className="ask-about-label">About</span>
          <span className="ask-about-name">{targetName || 'Untitled'}</span>
        </span>
      )}
      <label className="ask-threads-toggle" title="Threads are ideas, not yet part of the story — leave them out unless you want them considered">
        <input type="checkbox" checked={includeThreads} onChange={(e) => setIncludeThreads(e.target.checked)} />
        Include other threads
      </label>
    </div>
  );

  const thread = (
    <div className="ask-thread" ref={threadRef}>
      {messages.length === 0 && !busy && loaded && (
        <div className="ask-starters">
          {STARTERS[kindLabel].map((s) => (
            <button key={s} type="button" className="ask-starter" onClick={() => void send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {messages.map((m, i) =>
        m.role === 'user' ? (
          <div key={i} className="ask-msg user">
            {m.quote && <div className="ask-msg-quote">&ldquo;{m.quote}&rdquo;</div>}
            <div>{m.content}</div>
          </div>
        ) : (
          <div key={i} className="ask-msg assistant">
            <Formatted text={m.content} />
          </div>
        )
      )}
      {busy && (
        <div className="ask-msg assistant">
          {streaming ? <Formatted text={streaming} /> : <span className="ask-thinking">Reading your story…</span>}
        </div>
      )}
      {error && <p className="ask-error">{error}</p>}
    </div>
  );

  return (
    <div className={`ask-panel ask-${variant}`}>
      {variant === 'rail' ? (
        <div className="ask-rail-head">
          <button type="button" className="drill-back" onClick={() => onExpandedChange?.(false)}>
            <span aria-hidden>‹</span> Notes
          </button>
          {messages.length > 0 && !busy && (
            <button type="button" className="alt-link" onClick={startOver}>
              New question
            </button>
          )}
        </div>
      ) : null}
      {scope}
      {thread}
      {composer}
      {variant === 'page' && messages.length > 0 && !busy && (
        <button type="button" className="alt-link ask-start-over" onClick={startOver}>
          Start a new conversation
        </button>
      )}
    </div>
  );
}
