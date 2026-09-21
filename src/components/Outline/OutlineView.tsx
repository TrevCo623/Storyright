'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import type { Character, Entry, OutlineReview, OutlineSuggestionCategory, Place } from '@/lib/types';
import { createEntry, deleteEntry } from '@/app/subjects/[subjectId]/actions';
import {
  saveStorySummary,
  saveChapterMeta,
  createChapter,
  reorderChapters,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  createPlace,
  updatePlace,
  deletePlace,
} from '@/app/subjects/[subjectId]/outline/actions';

const CATEGORY_COLOR_VAR: Record<OutlineSuggestionCategory, string> = {
  chapter: 'var(--accent)',
  character: 'var(--sug-tone)',
  place: 'var(--sug-pacing)',
  theme: 'var(--sug-style)',
};

const CATEGORY_LABEL: Record<OutlineSuggestionCategory, string> = {
  chapter: 'Chapter',
  character: 'Character',
  place: 'Place',
  theme: 'Theme',
};

interface Props {
  subjectId: string;
  chaptersSectionId: string | null;
  threadsSectionId: string | null;
  premise: string;
  themes: string;
  takeaway: string;
  outlineReview: OutlineReview | null;
  chapters: Entry[];
  threads: Entry[];
  characters: Character[];
  places: Place[];
}

export default function OutlineView({
  subjectId,
  chaptersSectionId,
  threadsSectionId,
  premise: initialPremise,
  themes: initialThemes,
  takeaway: initialTakeaway,
  outlineReview,
  chapters: initialChapters,
  threads,
  characters: initialCharacters,
  places: initialPlaces,
}: Props) {
  const router = useRouter();

  const [premise, setPremise] = useState(initialPremise);
  const [themes, setThemes] = useState(initialThemes);
  const [takeaway, setTakeaway] = useState(initialTakeaway);

  const [chapters, setChapters] = useState(initialChapters);
  const [characters, setCharacters] = useState(initialCharacters);
  const [places, setPlaces] = useState(initialPlaces);

  const [addingCharacter, setAddingCharacter] = useState(false);
  const [addingPlace, setAddingPlace] = useState(false);
  const [chapterDialogOpen, setChapterDialogOpen] = useState(false);

  const [review, setReview] = useState(outlineReview);
  const [reviewing, setReviewing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [, startTransition] = useTransition();

  const dragIndex = useRef<number | null>(null);

  function saveSummary(next: { premise: string; themes: string; takeaway: string }) {
    startTransition(() => {
      void saveStorySummary(subjectId, next);
    });
  }

  function handleChapterDrop(targetIndex: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === targetIndex) return;
    const next = chapters.slice();
    const [moved] = next.splice(from, 1);
    next.splice(targetIndex, 0, moved);
    setChapters(next);
    void reorderChapters(subjectId, next.map((c) => c.id));
  }

  async function runOutlineReview() {
    setReviewing(true);
    try {
      const res = await fetch('/api/outline-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId }),
      });
      const data = (await res.json()) as { review?: OutlineReview; error?: string };
      if (data.review) {
        setReview(data.review);
        setReviewOpen(true);
      }
    } finally {
      setReviewing(false);
    }
  }

  return (
    <main className="editor-area outline-area">
      <header className="topbar">
        <div className="breadcrumb">Outline</div>
        <div className="topbar-right">
          <ThemeToggle />
        </div>
      </header>

      <div className="editor-scroll">
        <div className="outline-column">
          <h1 className="outline-title">Story outline</h1>
          <p className="outline-subtitle">
            The master plan for your story — fill in as much as you like now, and it'll fill in
            more on its own as you write.
          </p>

          {/* ---------- Story summary ---------- */}
          <section className="outline-section">
            <div className="outline-section-header">
              <h2 className="outline-section-title">Story summary</h2>
            </div>
            <div className="summary-fields">
              <label className="field-label">What is this story about?</label>
              <textarea
                className="manifesto-textarea"
                value={premise}
                placeholder="A quick premise — who, what, why now…"
                onChange={(e) => setPremise(e.target.value)}
                onBlur={() => saveSummary({ premise, themes, takeaway })}
              />
              <label className="field-label" style={{ marginTop: 18 }}>
                General themes
              </label>
              <textarea
                className="manifesto-textarea"
                value={themes}
                placeholder="What ideas or tensions run through it?"
                onChange={(e) => setThemes(e.target.value)}
                onBlur={() => saveSummary({ premise, themes, takeaway })}
                style={{ minHeight: 80 }}
              />
              <label className="field-label" style={{ marginTop: 18 }}>
                Reader takeaway
              </label>
              <textarea
                className="manifesto-textarea"
                value={takeaway}
                placeholder="What should the reader feel or understand when they finish?"
                onChange={(e) => setTakeaway(e.target.value)}
                onBlur={() => saveSummary({ premise, themes, takeaway })}
                style={{ minHeight: 80 }}
              />
            </div>
          </section>

          {/* ---------- Chapters ---------- */}
          <section className="outline-section">
            <div className="outline-section-header">
              <h2 className="outline-section-title">Chapters</h2>
              {chaptersSectionId && (
                <button className="add-btn" title="New chapter" onClick={() => setChapterDialogOpen(true)}>
                  +
                </button>
              )}
            </div>
            {chapters.length === 0 && (
              <p className="outline-empty">No chapters yet — add your first one above.</p>
            )}
            <div className="chapter-list">
              {chapters.map((chapter, index) => (
                <ChapterRow
                  key={chapter.id}
                  subjectId={subjectId}
                  chapter={chapter}
                  index={index}
                  onDragStart={() => (dragIndex.current = index)}
                  onDrop={() => handleChapterDrop(index)}
                  onSaved={(patch) =>
                    setChapters((prev) =>
                      prev.map((c) => (c.id === chapter.id ? { ...c, ...patch } : c))
                    )
                  }
                  onDelete={async () => {
                    await deleteEntry(subjectId, chapter.id);
                    setChapters((prev) => prev.filter((c) => c.id !== chapter.id));
                  }}
                />
              ))}
            </div>
            {chapterDialogOpen && chaptersSectionId && (
              <NewChapterDialog
                onCancel={() => setChapterDialogOpen(false)}
                onAdd={async (values) => {
                  const created = await createChapter(subjectId, chaptersSectionId, values);
                  setChapters((prev) => [...prev, created]);
                  setChapterDialogOpen(false);
                }}
              />
            )}
          </section>

          {/* ---------- Characters ---------- */}
          <section className="outline-section">
            <div className="outline-section-header">
              <h2 className="outline-section-title">Characters</h2>
              <button className="add-btn" title="New character" onClick={() => setAddingCharacter(true)}>
                +
              </button>
            </div>
            {addingCharacter && (
              <EntityForm
                fields={['name', 'role', 'summary']}
                onCancel={() => setAddingCharacter(false)}
                onSubmit={async (values) => {
                  const created = await createCharacter(subjectId, {
                    name: values.name,
                    role: values.role,
                    summary: values.summary,
                  });
                  setCharacters((prev) => [...prev, created]);
                  setAddingCharacter(false);
                }}
              />
            )}
            {characters.length === 0 && !addingCharacter && (
              <p className="outline-empty">
                No characters yet — add one, or write a chapter and Review will pull them out for you.
              </p>
            )}
            <div className="entity-grid">
              {characters.map((character) => (
                <EntityCard
                  key={character.id}
                  name={character.name}
                  role={character.role}
                  summary={character.summary}
                  source={character.source}
                  fields={['name', 'role', 'summary']}
                  onSave={async (values) => {
                    await updateCharacter(subjectId, character.id, values);
                    setCharacters((prev) =>
                      prev.map((c) => (c.id === character.id ? { ...c, ...values } : c))
                    );
                  }}
                  onDelete={async () => {
                    await deleteCharacter(subjectId, character.id);
                    setCharacters((prev) => prev.filter((c) => c.id !== character.id));
                  }}
                />
              ))}
            </div>
          </section>

          {/* ---------- Places ---------- */}
          <section className="outline-section">
            <div className="outline-section-header">
              <h2 className="outline-section-title">Places</h2>
              <button className="add-btn" title="New place" onClick={() => setAddingPlace(true)}>
                +
              </button>
            </div>
            {addingPlace && (
              <EntityForm
                fields={['name', 'summary']}
                onCancel={() => setAddingPlace(false)}
                onSubmit={async (values) => {
                  const created = await createPlace(subjectId, {
                    name: values.name,
                    summary: values.summary,
                  });
                  setPlaces((prev) => [...prev, created]);
                  setAddingPlace(false);
                }}
              />
            )}
            {places.length === 0 && !addingPlace && (
              <p className="outline-empty">
                No places yet — add one, or write a chapter and Review will pull them out for you.
              </p>
            )}
            <div className="entity-grid">
              {places.map((place) => (
                <EntityCard
                  key={place.id}
                  name={place.name}
                  summary={place.summary}
                  source={place.source}
                  fields={['name', 'summary']}
                  onSave={async (values) => {
                    await updatePlace(subjectId, place.id, values);
                    setPlaces((prev) => prev.map((p) => (p.id === place.id ? { ...p, ...values } : p)));
                  }}
                  onDelete={async () => {
                    await deletePlace(subjectId, place.id);
                    setPlaces((prev) => prev.filter((p) => p.id !== place.id));
                  }}
                />
              ))}
            </div>
          </section>

          {/* ---------- Threads ---------- */}
          <section className="outline-section">
            <div className="outline-section-header">
              <h2 className="outline-section-title">Threads</h2>
              {threadsSectionId && (
                <button
                  className="add-btn"
                  title="New thread"
                  onClick={() => void createEntry(subjectId, threadsSectionId, null, 'Untitled thread')}
                >
                  +
                </button>
              )}
            </div>
            {threads.length === 0 && (
              <p className="outline-empty">
                A catch-all for anything else — loose ideas, questions, research notes.
              </p>
            )}
            <div className="thread-list">
              {threads.map((thread) => (
                <div key={thread.id} className="thread-row">
                  <button
                    className="thread-title"
                    onClick={() => router.push(`/subjects/${subjectId}/entries/${thread.id}`)}
                  >
                    {thread.title}
                  </button>
                  <button
                    className="action-btn"
                    onClick={() => void deleteEntry(subjectId, thread.id)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <button className={`review-btn${reviewing ? ' loading' : ''}`} onClick={runOutlineReview} disabled={reviewing}>
        <span className="icon">✦</span>
        {reviewing ? 'Reviewing…' : 'Review'}
      </button>

      {reviewOpen && review && (
        <div className="advice-overlay" onClick={() => setReviewOpen(false)}>
          <div className="advice-panel" onClick={(e) => e.stopPropagation()}>
            <div className="advice-header">
              <span>Outline review</span>
              <button className="icon-btn" onClick={() => setReviewOpen(false)}>
                ✕
              </button>
            </div>
            <div className="advice-thread">
              <p className="review-summary">{review.summary}</p>
              {review.suggestions.map((s) => (
                <div key={s.id} className="suggestion-item">
                  <div className="head">
                    <span className="dot" style={{ background: CATEGORY_COLOR_VAR[s.category] }} />
                    <span className="heading">{s.heading}</span>
                    <span className="new-badge" style={{ color: CATEGORY_COLOR_VAR[s.category] }}>
                      {CATEGORY_LABEL[s.category]}
                    </span>
                  </div>
                  <p className="desc">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ChapterRow({
  subjectId,
  chapter,
  index,
  onDragStart,
  onDrop,
  onSaved,
  onDelete,
}: {
  subjectId: string;
  chapter: Entry;
  index: number;
  onDragStart: () => void;
  onDrop: () => void;
  onSaved: (patch: { title: string; synopsis: string; target_feeling: string }) => void;
  onDelete: () => Promise<void>;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(chapter.title);
  const [synopsis, setSynopsis] = useState(chapter.synopsis);
  const [feeling, setFeeling] = useState(chapter.target_feeling);
  const [dragOver, setDragOver] = useState(false);

  function openChapter() {
    router.push(`/subjects/${subjectId}/entries/${chapter.id}`);
  }

  function save() {
    onSaved({ title, synopsis, target_feeling: feeling });
    void saveChapterMeta(subjectId, chapter.id, { title, synopsis, target_feeling: feeling });
    setIsEditing(false);
  }

  return (
    <div
      className={`chapter-row${dragOver ? ' drag-over' : ''}${isEditing ? ' is-editing' : ''}`}
      draggable={!isEditing}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={() => {
        setDragOver(false);
        onDrop();
      }}
      onClick={(e) => {
        if (isEditing) return;
        if ((e.target as HTMLElement).closest('button')) return;
        openChapter();
      }}
    >
      <span className="chapter-drag-handle" title="Drag to reorder">
        ⠿
      </span>
      <div className="chapter-row-controls">
        <button
          className="chapter-trash-icon"
          title="Delete chapter"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete "${chapter.title || 'this chapter'}"? This can't be undone.`)) {
              void onDelete();
            }
          }}
        >
          ✕
        </button>
      </div>

      <div className="chapter-eyebrow">Chapter {index + 1}</div>

      {isEditing ? (
        <>
          <div className="chapter-edit-field">
            <label className="field-label">Chapter title</label>
            <input
              className="chapter-title-input-boxed"
              placeholder="Add a title"
              value={title}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="chapter-edit-field">
            <label className="field-label">Summary</label>
            <textarea
              className="manifesto-textarea chapter-synopsis"
              placeholder="What happens in this chapter, and how does it move the story forward?"
              value={synopsis}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setSynopsis(e.target.value)}
            />
          </div>
          <div className="chapter-edit-field">
            <label className="field-label">Themes</label>
            <input
              className="text-input chapter-feeling"
              placeholder="Feeling this chapter should evoke…"
              value={feeling}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setFeeling(e.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          <div className="chapter-row-head">
            <span className={`chapter-title-text${chapter.title ? '' : ' placeholder'}`}>
              {chapter.title || 'Untitled chapter'}
            </span>
          </div>
          <p className={`chapter-synopsis-text${chapter.synopsis ? '' : ' placeholder'}`}>
            {chapter.synopsis || 'What happens in this chapter, and how does it move the story forward?'}
          </p>
          {chapter.target_feeling ? (
            <p className="chapter-feeling-text">
              <span className="chapter-feeling-label">Themes: </span>
              {chapter.target_feeling}
            </p>
          ) : (
            <p className="chapter-feeling-text placeholder">Feeling this chapter should evoke…</p>
          )}
        </>
      )}

      <div className="chapter-row-actions">
        {!isEditing && (
          <button
            className="chapter-edit-link"
            title="Edit title, summary, and themes"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            Edit
          </button>
        )}
        <button
          className="chapter-write-btn"
          title={isEditing ? 'Save changes' : 'Write this chapter'}
          onClick={(e) => {
            e.stopPropagation();
            if (isEditing) save();
            else openChapter();
          }}
        >
          {isEditing ? 'Save' : 'Write'}
        </button>
      </div>
    </div>
  );
}

function NewChapterDialog({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (values: { title: string; synopsis: string; target_feeling: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [feeling, setFeeling] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="entity-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="entity-dialog-title">New chapter</h3>
        <input
          className="text-input"
          placeholder="Chapter title"
          value={title}
          autoFocus
          disabled={saving}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        />
        <textarea
          className="manifesto-textarea"
          style={{ minHeight: 70 }}
          placeholder="What happens in this chapter, and how does it move the story forward?"
          value={synopsis}
          disabled={saving}
          onChange={(e) => setSynopsis(e.target.value)}
        />
        <input
          className="text-input"
          placeholder="Feeling this chapter should evoke…"
          value={feeling}
          disabled={saving}
          onChange={(e) => setFeeling(e.target.value)}
        />
        <div className="entity-dialog-actions">
          <button className="secondary-btn" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary-btn"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onAdd({ title, synopsis, target_feeling: feeling });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Adding…' : 'Add chapter'}
          </button>
        </div>
      </div>
    </div>
  );
}

type EntityFields = 'name' | 'role' | 'summary';

function EntityForm({
  fields,
  onCancel,
  onSubmit,
}: {
  fields: EntityFields[];
  onCancel: () => void;
  onSubmit: (values: { name: string; role?: string; summary?: string }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <form
      className="entity-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setSaving(true);
        try {
          await onSubmit({ name, role, summary });
        } finally {
          setSaving(false);
        }
      }}
    >
      <input
        className="text-input"
        placeholder="Name"
        value={name}
        autoFocus
        disabled={saving}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      />
      {fields.includes('role') && (
        <input
          className="text-input"
          placeholder="Role in the story"
          value={role}
          disabled={saving}
          onChange={(e) => setRole(e.target.value)}
          style={{ marginTop: 8 }}
        />
      )}
      {fields.includes('summary') && (
        <textarea
          className="manifesto-textarea"
          placeholder="Short summary…"
          value={summary}
          disabled={saving}
          onChange={(e) => setSummary(e.target.value)}
          style={{ marginTop: 8, minHeight: 70 }}
        />
      )}
      <div className="form-actions" style={{ marginTop: 10 }}>
        <button type="submit" className="primary-btn" disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Add'}
        </button>
        <button type="button" className="secondary-btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EntityCard({
  name,
  role,
  summary,
  source,
  fields,
  onSave,
  onDelete,
}: {
  name: string;
  role?: string;
  summary: string;
  source: 'manual' | 'auto';
  fields: EntityFields[];
  onSave: (values: { name?: string; role?: string; summary?: string }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(name);
  const [roleVal, setRoleVal] = useState(role ?? '');
  const [summaryVal, setSummaryVal] = useState(summary);
  const [saving, setSaving] = useState(false);

  if (editing) {
    return (
      <div className="entity-card editing">
        <input
          className="text-input"
          value={nameVal}
          disabled={saving}
          onChange={(e) => setNameVal(e.target.value)}
        />
        {fields.includes('role') && (
          <input
            className="text-input"
            value={roleVal}
            disabled={saving}
            placeholder="Role in the story"
            onChange={(e) => setRoleVal(e.target.value)}
            style={{ marginTop: 8 }}
          />
        )}
        <textarea
          className="manifesto-textarea"
          value={summaryVal}
          disabled={saving}
          onChange={(e) => setSummaryVal(e.target.value)}
          style={{ marginTop: 8, minHeight: 70 }}
        />
        <div className="form-actions" style={{ marginTop: 10 }}>
          <button
            className="primary-btn"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(
                  fields.includes('role')
                    ? { name: nameVal, role: roleVal, summary: summaryVal }
                    : { name: nameVal, summary: summaryVal }
                );
                setEditing(false);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="secondary-btn" disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="entity-card">
      <div className="entity-card-head">
        <span className="entity-name">{name}</span>
        {source === 'auto' && <span className="auto-badge">Auto</span>}
      </div>
      {role && <div className="entity-role">{role}</div>}
      {summary && <p className="entity-summary">{summary}</p>}
      <div className="actions">
        <button className="action-btn" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button className="action-btn" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
