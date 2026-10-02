'use client';

import { useEffect, useRef, useState } from 'react';
import { SearchIcon, XIcon } from '@/components/icons';
import { searchSubject } from '@/app/subjects/[subjectId]/actions';
import type { SearchResult } from '@/lib/types';

// Full-screen project search — takeover panel matching the behavior proven in
// editoir-outline-prototype.html's toggleChapterSearch. Shared by the chapter
// editor and the Outline pages (both open it from the top bar's search icon).

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function highlightText(text: string, query: string): string {
  const escaped = escapeHtml(text);
  if (!query) return escaped;
  const re = new RegExp(`(${escapeRegExp(escapeHtml(query))})`, 'ig');
  return escaped.replace(re, '<mark>$1</mark>');
}

interface Props {
  subjectId: string;
  onClose: () => void;
  onSelect: (result: SearchResult) => void;
}

/** Render only while open — mounting resets the query and focuses the input. */
export default function ProjectSearch({ subjectId, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      searchSubject(subjectId, q).then((r) => {
        if (requestId.current === id) {
          setResults(r);
          setLoading(false);
        }
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, subjectId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-panel" onClick={(e) => e.stopPropagation()}>
        <div className="search-panel-header">
          <SearchIcon size={16} />
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search this project…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="search-close-btn" onClick={onClose} aria-label="Close search">
            <XIcon />
          </button>
        </div>
        <div className="search-results">
          {!query.trim() ? (
            <div className="search-empty">
              Type to search across every chapter, character, place, and thread in this project.
            </div>
          ) : loading ? (
            <div className="search-empty">Searching…</div>
          ) : results.length === 0 ? (
            <div className="search-empty">No matches for &ldquo;{query.trim()}&rdquo;.</div>
          ) : (
            results.map((r) => (
              <button key={`${r.kind}-${r.id}`} className="search-result" onClick={() => onSelect(r)}>
                <div className="search-result-breadcrumb">{r.breadcrumb}</div>
                <div
                  className="search-result-title"
                  dangerouslySetInnerHTML={{ __html: highlightText(r.title, query) }}
                />
                {r.snippet && (
                  <div
                    className="search-result-snippet"
                    dangerouslySetInnerHTML={{ __html: highlightText(r.snippet, query) }}
                  />
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
