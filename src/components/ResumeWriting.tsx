'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { XIcon } from '@/components/icons';

// "Continue writing in …" — a footer-centered link back to the chapter you were
// typing in, shown on Outline / detail pages after you jump away to check notes.
// Set by the editor when you type (markWritingIn); cleared when you go back to
// that chapter or dismiss it. Per-tab (sessionStorage), per project.

const key = (subjectId: string) => `storyright-resume-${subjectId}`;

interface Stored {
  entryId: string;
  title: string;
}

function read(subjectId: string): Stored | null {
  try {
    const raw = sessionStorage.getItem(key(subjectId));
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

/** Editor: call while the user is typing in an entry. */
export function markWritingIn(subjectId: string, entryId: string, title: string) {
  try {
    sessionStorage.setItem(key(subjectId), JSON.stringify({ entryId, title }));
  } catch {
    /* storage unavailable — the link just won't show */
  }
}

/** Editor: call on open; clears the link if it points at this entry (you're back). */
export function clearWritingInIf(subjectId: string, entryId: string) {
  try {
    if (read(subjectId)?.entryId === entryId) sessionStorage.removeItem(key(subjectId));
  } catch {
    /* ignore */
  }
}

interface Props {
  subjectId: string;
  /** Fresh title lookup (e.g. from the Outline's chapter list), falls back to the stored one. */
  titleFor?: (entryId: string) => string | undefined;
}

export default function ResumeWriting({ subjectId, titleFor }: Props) {
  const [stored, setStored] = useState<Stored | null>(null);

  useEffect(() => {
    setStored(read(subjectId));
  }, [subjectId]);

  if (!stored) return null;
  const title = titleFor?.(stored.entryId) || stored.title || 'your chapter';

  return (
    <div className="resume-writing">
      <Link href={`/subjects/${subjectId}/entries/${stored.entryId}`} className="resume-writing-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        <span className="resume-writing-label">
          Continue writing in <span className="resume-writing-title">{title}</span>
        </span>
      </Link>
      <button
        type="button"
        className="resume-writing-x"
        title="Dismiss"
        aria-label="Dismiss"
        onClick={() => {
          try {
            sessionStorage.removeItem(key(subjectId));
          } catch {
            /* ignore */
          }
          setStored(null);
        }}
      >
        <XIcon size={12} />
      </button>
    </div>
  );
}
