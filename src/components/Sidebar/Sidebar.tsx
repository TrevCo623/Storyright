'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Character, Entry, OutlineSuggestion, OutlineSuggestionCategory, Place } from '@/lib/types';

type NavSection = 'chapters' | 'characters' | 'places' | 'threads' | 'insights';

const CATEGORY_COLOR_VAR: Record<OutlineSuggestionCategory, string> = {
  chapter: 'var(--accent)',
  character: 'var(--sug-tone)',
  place: 'var(--sug-pacing)',
  theme: 'var(--sug-style)',
};

interface Props {
  subjectId: string;
  subjectTitle: string;
  activeEntryId?: string;
  chapters: Pick<Entry, 'id' | 'title'>[];
  threads: Pick<Entry, 'id' | 'title'>[];
  characters: Pick<Character, 'id' | 'name'>[];
  places: Pick<Place, 'id' | 'name'>[];
  insights: OutlineSuggestion[];
}

export default function Sidebar({
  subjectId,
  subjectTitle,
  activeEntryId,
  chapters,
  threads,
  characters,
  places,
  insights,
}: Props) {
  // Prototype's accordion only ever has one section open at a time
  // (`activeNavAccordion`), defaulting to Chapters.
  const [openSection, setOpenSection] = useState<NavSection | null>('chapters');

  function toggle(section: NavSection) {
    setOpenSection((prev) => (prev === section ? null : section));
  }

  return (
    <aside className="nav">
      <div className="nav-inner">
        <div className="nav-header">
          <Link href={`/subjects/${subjectId}`} className="nav-back-link">
            ‹ Back to Outline
          </Link>
        </div>
        <div className="nav-project-name">{subjectTitle}</div>
        <Link href={`/subjects/${subjectId}`} className="nav-item">
          ◈ Outline
        </Link>

        <div className="nav-accordion-group">
          <div className={`nav-accordion-section${openSection === 'chapters' ? ' open' : ''}`}>
            <div className="nav-section-row">
              <button className="nav-section-label nav-accordion-toggle" onClick={() => toggle('chapters')}>
                <span>Chapters</span>
                <span className="nav-accordion-chevron">›</span>
              </button>
              <Link
                href={`/subjects/${subjectId}?tab=chapters&new=1`}
                className="nav-add-btn"
                title="Add chapter"
              >
                +
              </Link>
            </div>
            <div className="nav-accordion-content">
              {chapters.length ? (
                chapters.map((c) => (
                  <Link
                    key={c.id}
                    href={`/subjects/${subjectId}/entries/${c.id}`}
                    className={`nav-entry-item${c.id === activeEntryId ? ' active' : ''}`}
                  >
                    <span className="nav-entry-name">{c.title || 'Untitled chapter'}</span>
                  </Link>
                ))
              ) : (
                <p className="nav-entry-empty">No chapters yet.</p>
              )}
            </div>
          </div>

          <div className={`nav-accordion-section${openSection === 'characters' ? ' open' : ''}`}>
            <div className="nav-section-row">
              <button className="nav-section-label nav-accordion-toggle" onClick={() => toggle('characters')}>
                <span>Characters</span>
                <span className="nav-accordion-chevron">›</span>
              </button>
              <Link
                href={`/subjects/${subjectId}?tab=characters&new=1`}
                className="nav-add-btn"
                title="Add character"
              >
                +
              </Link>
            </div>
            <div className="nav-accordion-content">
              {characters.length ? (
                characters.map((c) => (
                  <Link
                    key={c.id}
                    href={`/subjects/${subjectId}?tab=characters`}
                    className="nav-entry-item"
                  >
                    <span className="nav-entry-name">{c.name || 'Untitled'}</span>
                  </Link>
                ))
              ) : (
                <p className="nav-entry-empty">No characters yet.</p>
              )}
            </div>
          </div>

          <div className={`nav-accordion-section${openSection === 'places' ? ' open' : ''}`}>
            <div className="nav-section-row">
              <button className="nav-section-label nav-accordion-toggle" onClick={() => toggle('places')}>
                <span>Places</span>
                <span className="nav-accordion-chevron">›</span>
              </button>
              <Link href={`/subjects/${subjectId}?tab=places&new=1`} className="nav-add-btn" title="Add place">
                +
              </Link>
            </div>
            <div className="nav-accordion-content">
              {places.length ? (
                places.map((p) => (
                  <Link key={p.id} href={`/subjects/${subjectId}?tab=places`} className="nav-entry-item">
                    <span className="nav-entry-name">{p.name || 'Untitled'}</span>
                  </Link>
                ))
              ) : (
                <p className="nav-entry-empty">No places yet.</p>
              )}
            </div>
          </div>

          <div className={`nav-accordion-section${openSection === 'threads' ? ' open' : ''}`}>
            <div className="nav-section-row">
              <button className="nav-section-label nav-accordion-toggle" onClick={() => toggle('threads')}>
                <span>Threads</span>
                <span className="nav-accordion-chevron">›</span>
              </button>
              <Link href={`/subjects/${subjectId}?tab=threads&new=1`} className="nav-add-btn" title="Add thread">
                +
              </Link>
            </div>
            <div className="nav-accordion-content">
              {threads.length ? (
                threads.map((t) => (
                  <Link
                    key={t.id}
                    href={`/subjects/${subjectId}/entries/${t.id}`}
                    className={`nav-entry-item${t.id === activeEntryId ? ' active' : ''}`}
                  >
                    <span className="nav-entry-name">{t.title || 'Untitled'}</span>
                  </Link>
                ))
              ) : (
                <p className="nav-entry-empty">No threads yet.</p>
              )}
            </div>
          </div>

          <div className={`nav-accordion-section${openSection === 'insights' ? ' open' : ''}`}>
            <div className="nav-section-row">
              <button className="nav-section-label nav-accordion-toggle" onClick={() => toggle('insights')}>
                <span>Insights</span>
                <span className="nav-accordion-chevron">›</span>
              </button>
            </div>
            <div className="nav-accordion-content">
              {insights.length ? (
                insights.map((s) => (
                  <div key={s.id} className="nav-insight-item">
                    <div className="nav-insight-head">
                      <span className="nav-insight-dot" style={{ background: CATEGORY_COLOR_VAR[s.category] }} />
                      <span className="nav-insight-heading">{s.heading}</span>
                    </div>
                    <p className="nav-insight-desc">{s.desc}</p>
                  </div>
                ))
              ) : (
                <p className="nav-entry-empty">Click Review on the Outline page to get feedback.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
