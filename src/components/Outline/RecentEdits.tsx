'use client';

import { useMemo, useState } from 'react';

// Summary page → "Recent edits": the latest things you worked on across the
// project, newest first, each with its type, title, the last line you wrote
// (≤ 25 words, to jog your memory) and a loose "when".

export interface RecentItem {
  key: string;
  type: string; // "Chapter 3", "Character", "Place", "Thread"
  title: string;
  text: string; // full text; the last line is extracted here
  updatedAt: string;
  onOpen: () => void;
}

const PAGE = 5;
const DAY = 24 * 3600e3;

function relativeWhen(iso: string): string {
  const t = new Date(iso).getTime();
  const ms = Date.now() - t;
  const days = Math.floor(ms / DAY);
  if (ms < 10 * 60e3) return 'Just now';
  if (new Date(t).toDateString() === new Date().toDateString()) return 'Today';
  if (days <= 1) return 'Yesterday';
  if (days < 7) return 'A few days ago';
  if (days < 14) return 'Last week';
  if (days < 30) return 'A few weeks ago';
  if (days < 60) return 'Last month';
  return 'A few months ago';
}

function lastLine(text: string, maxWords = 25): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const words = sentences[sentences.length - 1].split(' ');
  return words.length > maxWords ? '…' + words.slice(-maxWords).join(' ') : words.join(' ');
}

export default function RecentEdits({ items }: { items: RecentItem[] }) {
  const [shown, setShown] = useState(PAGE);
  const sorted = useMemo(
    () => [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [items]
  );
  if (!sorted.length) return null;

  return (
    <section className="outline-section recent-edits">
      <div className="section-label">Recent edits</div>
      <div className="entity-grid">
        {sorted.slice(0, shown).map((r) => {
          const line = lastLine(r.text);
          return (
            <button key={r.key} type="button" className="recent-card" onClick={r.onOpen}>
              <span className="recent-when">{relativeWhen(r.updatedAt)}</span>
              <span className="recent-type">{r.type}</span>
              <span className="recent-title">{r.title}</span>
              {line && <p className="recent-line">{line}</p>}
            </button>
          );
        })}
      </div>
      {shown < sorted.length && (
        <button type="button" className="recent-more" onClick={() => setShown((n) => n + PAGE)}>
          See more
        </button>
      )}
    </section>
  );
}
