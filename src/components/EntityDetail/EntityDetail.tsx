'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import TopNav, { type ProjectTab } from '@/components/TopNav/TopNav';
import ThemeToggle from '@/components/ThemeToggle';
import ProjectSearch from '@/components/ProjectSearch';
import ResumeWriting from '@/components/ResumeWriting';
import ConfirmDialog from '@/components/ConfirmDialog';
import DashedOutline from '@/components/DashedOutline';
import { PlusIcon, SearchIcon } from '@/components/icons';
import { entityTerms, findAppearances, type ChapterLite } from '@/lib/appearances';
import {
  updateCharacter,
  updatePlace,
  deleteCharacter,
  deletePlace,
  createLinkedThread,
} from '@/app/subjects/[subjectId]/outline/actions';
import type {
  Character,
  Entry,
  EntityInsightCategory,
  EntityMention,
  EntityReview,
  Place,
  SearchResult,
} from '@/lib/types';

// Character / Place detail page — replaces the old edit pop-up. Same frame as
// the chapter editor (hover top nav, centered column, floating footer).

type Kind = 'character' | 'place';
type TextField = 'summary' | 'themes' | 'arc_start' | 'arc_turn' | 'arc_end' | 'history' | 'significance';
type DetailTab = 'background' | 'themes' | 'arc' | 'description' | 'history' | 'significance' | 'appearances' | 'threads' | 'insights';

const CONFIG: Record<
  Kind,
  {
    listLabel: string;
    listTab: ProjectTab;
    singular: string;
    namePlaceholder: string;
    toggleLabel: string;
    tabs: { id: DetailTab; label: string }[];
  }
> = {
  character: {
    listLabel: 'Characters',
    listTab: 'characters',
    singular: 'character',
    namePlaceholder: 'Name this character',
    toggleLabel: 'Main character',
    tabs: [
      { id: 'background', label: 'Background' },
      { id: 'themes', label: 'Themes' },
      { id: 'arc', label: 'Arc' },
      { id: 'appearances', label: 'Appearances' },
      { id: 'threads', label: 'Threads' },
      { id: 'insights', label: 'Insights' },
    ],
  },
  place: {
    listLabel: 'Places',
    listTab: 'places',
    singular: 'place',
    namePlaceholder: 'Name this place',
    toggleLabel: 'Key location',
    tabs: [
      { id: 'description', label: 'Description' },
      { id: 'history', label: 'History' },
      { id: 'significance', label: 'Significance' },
      { id: 'appearances', label: 'Appearances' },
      { id: 'threads', label: 'Threads' },
      { id: 'insights', label: 'Insights' },
    ],
  },
};

const INSIGHT_CATS: Record<EntityInsightCategory, { label: string; color: string }> = {
  arc: { label: 'Arc', color: 'var(--accent)' },
  consistency: { label: 'Consistency', color: 'var(--sug-grammar)' },
  presence: { label: 'Presence', color: 'var(--sug-pacing)' },
  theme: { label: 'Theme', color: 'var(--sug-style)' },
  relationship: { label: 'Relationship', color: 'var(--sug-tone)' },
  history: { label: 'History', color: 'var(--sug-tone)' },
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Snippet with the matched term highlighted. */
function Highlighted({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRe(term)})`, 'i'));
  return (
    <>
      {parts.map((p, i) => (p.toLowerCase() === term.toLowerCase() ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}

/** Plain textarea styled as prose, growing with its content. */
function ProseField({
  value,
  placeholder,
  tall,
  onChange,
}: {
  value: string;
  placeholder: string;
  tall?: boolean;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(resize, [value]);
  return (
    <textarea
      ref={ref}
      className={`detail-prose${tall ? ' tall' : ''}`}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

interface Props {
  subjectId: string;
  subjectTitle: string;
  kind: Kind;
  entity: Character | Place;
  chapters: ChapterLite[];
  threads: Entry[];
  threadsSectionId: string | null;
  mentions: EntityMention[];
  isNew: boolean;
}

export default function EntityDetail({
  subjectId,
  subjectTitle,
  kind,
  entity,
  chapters,
  threads: initialThreads,
  threadsSectionId,
  mentions,
  isNew,
}: Props) {
  const router = useRouter();
  const cfg = CONFIG[kind];
  const isCharacter = kind === 'character';
  const character = entity as Character;
  const place = entity as Place;

  const [name, setName] = useState(entity.name ?? '');
  const [role, setRole] = useState(isCharacter ? character.role ?? '' : '');
  const [flag, setFlag] = useState(isCharacter ? !!character.is_main : !!place.is_key);
  const [aliases, setAliases] = useState<string[]>(entity.aliases ?? []);
  const [fields, setFields] = useState<Record<TextField, string>>({
    summary: entity.summary ?? '',
    themes: isCharacter ? character.themes ?? '' : '',
    arc_start: isCharacter ? character.arc_start ?? '' : '',
    arc_turn: isCharacter ? character.arc_turn ?? '' : '',
    arc_end: isCharacter ? character.arc_end ?? '' : '',
    history: isCharacter ? '' : place.history ?? '',
    significance: isCharacter ? '' : place.significance ?? '',
  });
  const [review, setReview] = useState<EntityReview | null>(entity.review ?? null);
  const [threads, setThreads] = useState(initialThreads);
  const [tab, setTab] = useState<DetailTab>(cfg.tabs[0].id);
  const [editing, setEditing] = useState<'name' | 'role' | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [addingThread, setAddingThread] = useState(false);
  const [aliasDraft, setAliasDraft] = useState('');

  const nameRef = useRef<HTMLHeadingElement | null>(null);
  const roleRef = useRef<HTMLSpanElement | null>(null);
  const editOriginal = useRef('');
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const nameNow = useRef(name);
  nameNow.current = name;

  // ---- saving ----
  const patch = useCallback(
    async (data: Record<string, unknown>) => {
      setSaveStatus('saving');
      try {
        if (isCharacter) await updateCharacter(subjectId, entity.id, data);
        else await updatePlace(subjectId, entity.id, data);
      } finally {
        setSaveStatus('saved');
      }
    },
    [isCharacter, subjectId, entity.id]
  );
  function patchSoon(field: string, data: Record<string, unknown>) {
    setSaveStatus('saving');
    clearTimeout(timers.current[field]);
    timers.current[field] = setTimeout(() => void patch(data), 600);
  }
  function setField(field: TextField, value: string) {
    setFields((f) => ({ ...f, [field]: value }));
    patchSoon(field, { [field]: value });
  }

  // ---- leaving: a brand-new, still-unnamed entry is removed again ----
  async function leaveTo(href: string) {
    if (isNew && !nameNow.current.trim()) {
      if (isCharacter) await deleteCharacter(subjectId, entity.id);
      else await deletePlace(subjectId, entity.id);
    }
    router.push(href);
  }

  // ---- name / role inline edit (same pattern as the Story title) ----
  function startEdit(field: 'name' | 'role') {
    if (editing === field) return;
    const el = field === 'name' ? nameRef.current : roleRef.current;
    if (!el) return;
    editOriginal.current = el.textContent ?? '';
    setEditing(field);
    requestAnimationFrame(() => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  }
  function finishEdit(save: boolean) {
    if (!editing) return;
    const field = editing;
    const el = field === 'name' ? nameRef.current : roleRef.current;
    setEditing(null);
    if (!el) return;
    if (!save) {
      el.textContent = editOriginal.current;
      return;
    }
    const value = (el.textContent ?? '').trim();
    el.textContent = value;
    if (value === editOriginal.current.trim()) return;
    if (field === 'name') {
      setName(value);
      void patch({ name: value });
    } else {
      setRole(value);
      void patch({ role: value });
    }
  }
  useEffect(() => {
    if (isNew && !entity.name) startEdit('name');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- derived ----
  const appearances = useMemo(
    () => findAppearances({ id: entity.id, name, aliases }, isCharacter, chapters, mentions),
    [entity.id, name, aliases, isCharacter, chapters, mentions]
  );
  const relatedThreads = useMemo(() => {
    const terms = entityTerms(name, aliases, isCharacter).map((t) => t.toLowerCase());
    return threads.filter(
      (t) =>
        (t.linked_entity_ids ?? []).includes(entity.id) ||
        terms.some((term) => `${t.title} ${t.synopsis} ${t.content_text}`.toLowerCase().includes(term))
    );
  }, [threads, name, aliases, entity.id, isCharacter]);
  const counts: Partial<Record<DetailTab, number>> = {
    appearances: appearances.length,
    threads: relatedThreads.length,
    ...(review ? { insights: review.items.length } : {}),
  };
  const displayName = name || (isCharacter ? 'Unnamed character' : 'Unnamed place');
  const firstName = (name || 'this').split(/\s+/)[0];

  // ---- review ----
  async function runReview() {
    if (reviewing) return;
    setReviewing(true);
    setReviewError(null);
    try {
      const res = await fetch('/api/entity-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId, kind, id: entity.id }),
      });
      const data = (await res.json()) as { review?: EntityReview; error?: string };
      if (data.review) {
        setReview(data.review);
        setTab('insights');
      } else {
        setReviewError('Review failed — try again.');
      }
    } catch {
      setReviewError('Review failed — try again.');
    } finally {
      setReviewing(false);
    }
  }

  function goToSearchResult(r: SearchResult) {
    setSearchOpen(false);
    if (r.kind === 'chapter' || r.kind === 'thread') void leaveTo(`/subjects/${subjectId}/entries/${r.id}`);
    else void leaveTo(`/subjects/${subjectId}/${r.kind === 'character' ? 'characters' : 'places'}/${r.id}`);
  }

  // ---- tab bodies ----
  function body() {
    if (tab === 'background' || tab === 'description') {
      return (
        <ProseField
          tall
          value={fields.summary}
          placeholder={
            isCharacter
              ? 'Where do they come from? What do they want, and what are they hiding?'
              : 'What does it look, sound, and smell like? What’s the mood when someone walks in?'
          }
          onChange={(v) => setField('summary', v)}
        />
      );
    }
    if (tab === 'themes') {
      return (
        <>
          <p className="detail-hint">
            The ideas {firstName} carries, tests, or resists — and how they connect to the themes on your Summary page.
          </p>
          <ProseField tall value={fields.themes} placeholder="What ideas does this character carry, test, or resist?" onChange={(v) => setField('themes', v)} />
        </>
      );
    }
    if (tab === 'arc') {
      return (
        <>
          {(
            [
              ['arc_start', 'Where they begin', 'Who are they when we meet them? What do they believe?'],
              ['arc_turn', 'What changes them', 'What happens that they can’t walk away from?'],
              ['arc_end', 'Where they end up', 'Who are they by the last page?'],
            ] as [TextField, string, string][]
          ).map(([f, label, ph]) => (
            <div className="detail-field" key={f}>
              <div className="section-label">{label}</div>
              <ProseField value={fields[f]} placeholder={ph} onChange={(v) => setField(f, v)} />
            </div>
          ))}
        </>
      );
    }
    if (tab === 'history') {
      return <ProseField tall value={fields.history} placeholder="What happened here before the story starts?" onChange={(v) => setField('history', v)} />;
    }
    if (tab === 'significance') {
      return (
        <ProseField
          tall
          value={fields.significance}
          placeholder="What does this place mean to the story, and to the people in it?"
          onChange={(v) => setField('significance', v)}
        />
      );
    }
    if (tab === 'appearances') {
      return (
        <>
          <p className="appear-summary">
            {appearances.length ? `Appears in ${appearances.length} of ${chapters.length} chapters` : 'Not in any chapter yet'}
          </p>
          <p className="detail-hint">Names update as you write. ✦ Indirect references (like “her father”) are found when you run Review on a chapter.</p>
          <div className="alias-row">
            <span className="alias-label">Also known as</span>
            {aliases.map((a, i) => (
              <span className="alias-chip" key={`${a}-${i}`}>
                {a}
                <button
                  type="button"
                  title="Remove"
                  onClick={() => {
                    const next = aliases.filter((_, j) => j !== i);
                    setAliases(next);
                    void patch({ aliases: next });
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              className="alias-input"
              placeholder="Add a name, then Enter"
              value={aliasDraft}
              onChange={(e) => setAliasDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const v = aliasDraft.trim();
                if (!v) return;
                const next = [...aliases, v];
                setAliases(next);
                setAliasDraft('');
                void patch({ aliases: next });
              }}
            />
          </div>
          <div className="appear-list">
            {appearances.length === 0 ? (
              <div className="appear-empty">Once you write {isCharacter ? 'them' : 'it'} into a chapter, it’ll show up here.</div>
            ) : (
              appearances.map((a) => (
                <Link key={a.chapterId} href={`/subjects/${subjectId}/entries/${a.chapterId}`} className="appear-row">
                  <span className="appear-num">Ch {a.index + 1}</span>
                  <span className="appear-main">
                    <span className="appear-title">{a.title || 'Untitled chapter'}</span>
                    {a.snippet && (
                      <span className="appear-snippet">
                        <Highlighted text={a.snippet} term={a.term} />
                      </span>
                    )}
                    <span className="appear-via">
                      {a.named
                        ? `Named · ${a.count} mention${a.count === 1 ? '' : 's'}`
                        : `✦ Referenced as “${a.term}” · found on Review`}
                    </span>
                  </span>
                </Link>
              ))
            )}
          </div>
        </>
      );
    }
    if (tab === 'threads') {
      return (
        <>
          <p className="detail-hint">Threads that mention {displayName}. They also live on the main Threads page.</p>
          <div className="entity-grid">
            {relatedThreads.map((t) => (
              <div key={t.id} className="entity-card" onClick={() => void leaveTo(`/subjects/${subjectId}/entries/${t.id}`)}>
                <div className="entity-card-head">
                  <span className="entity-name">{t.title}</span>
                </div>
                {t.synopsis && <p className="entity-summary">{t.synopsis}</p>}
              </div>
            ))}
            {threadsSectionId && (
              <button type="button" className="entity-add-tile" onClick={() => setAddingThread(true)}>
                <DashedOutline />
                <span className="chapter-add-tile-circle">
                  <PlusIcon />
                </span>
                <span>Add a thread about {firstName}</span>
              </button>
            )}
          </div>
        </>
      );
    }
    // insights
    if (!review) {
      return (
        <button type="button" className="empty-tile" onClick={() => void runReview()} disabled={reviewing}>
          <DashedOutline />
          <div className="empty-tile-title">See {displayName} through fresh eyes.</div>
          <div className="empty-tile-desc">
            Run a review to check {isCharacter ? 'them' : 'it'} against your chapters, {isCharacter ? 'arc' : 'history'}, and notes.
          </div>
          <div className="empty-tile-circle">✦</div>
        </button>
      );
    }
    return (
      <>
        {review.summary && <p className="insights-summary">{review.summary}</p>}
        <div className="insights-table">
          <div className="insights-header-row">
            <span className="insights-header-cell category">Category</span>
            <span className="insights-header-cell">Suggestion</span>
          </div>
          {review.items.map((it, i) => {
            const c = INSIGHT_CATS[it.category] ?? INSIGHT_CATS.consistency;
            return (
              <div className="insights-row" key={i}>
                <div className="insights-category-cell">
                  <span className="insights-dot" style={{ background: c.color }} />
                  <span className="insights-cat-label">{c.label}</span>
                </div>
                <div className="insights-content-cell">
                  <span className="insights-heading">{it.heading}</span>
                  <p className="insights-desc">{it.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <>
      <TopNav
        subjectTitle={subjectTitle}
        mode="hover"
        crumb={`${cfg.listLabel} – ${displayName}`}
        onSelectTab={(t) => void leaveTo(`/subjects/${subjectId}?tab=${t}`)}
        matchEditorBreakpoint
        right={
          <>
            <button className="icon-btn" title="Search this project" onClick={() => setSearchOpen(true)}>
              <SearchIcon />
            </button>
            <ThemeToggle />
          </>
        }
      />
      <main className={`detail-area${editing ? ' field-editing' : ''}`}>
        <div className="detail-scroll">
          <div className="detail-column">
            <div className="detail-head-row">
              <div className={`outline-title-wrap detail-edit-wrap${editing === 'name' ? ' editing' : ''}`}>
                <h1
                  ref={nameRef}
                  className="detail-title"
                  data-placeholder={cfg.namePlaceholder}
                  contentEditable={editing === 'name'}
                  suppressContentEditableWarning
                  spellCheck={false}
                  onClick={() => startEdit('name')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      finishEdit(true);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      finishEdit(false);
                    }
                  }}
                  onBlur={() => editing === 'name' && finishEdit(true)}
                >
                  {name}
                </h1>
                <button type="button" className="title-edit-btn" onClick={() => startEdit('name')}>
                  Edit
                </button>
                <button type="button" className="title-save-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => finishEdit(true)}>
                  Save name
                </button>
              </div>
              <button
                type="button"
                className={`detail-toggle${flag ? ' on' : ''}`}
                role="switch"
                aria-checked={flag}
                onClick={() => {
                  const next = !flag;
                  setFlag(next);
                  void patch(isCharacter ? { is_main: next } : { is_key: next });
                }}
              >
                <span className="detail-switch" />
                <span>{cfg.toggleLabel}</span>
              </button>
            </div>
            {isCharacter && (
              <div className="detail-meta">
                <div className={`outline-title-wrap detail-edit-wrap detail-role-wrap${editing === 'role' ? ' editing' : ''}`}>
                  <span
                    ref={roleRef}
                    className="detail-role"
                    data-placeholder="Add a role"
                    contentEditable={editing === 'role'}
                    suppressContentEditableWarning
                    spellCheck={false}
                    onClick={() => startEdit('role')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        finishEdit(true);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        finishEdit(false);
                      }
                    }}
                    onBlur={() => editing === 'role' && finishEdit(true)}
                  >
                    {role}
                  </span>
                  <button type="button" className="title-edit-btn" onClick={() => startEdit('role')}>
                    Edit
                  </button>
                  <button type="button" className="title-save-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => finishEdit(true)}>
                    Save role
                  </button>
                </div>
              </div>
            )}

            <nav className="detail-tabs">
              {cfg.tabs.map((t) => (
                <button key={t.id} type="button" className={`detail-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
                  {t.label}
                  {counts[t.id] !== undefined && <span className="detail-tab-count">{counts[t.id]}</span>}
                </button>
              ))}
            </nav>

            <div className="detail-body">{body()}</div>
            {reviewError && <p className="detail-hint" style={{ marginTop: 16 }}>{reviewError}</p>}
          </div>
        </div>

        <span className="outline-saved">{saveStatus === 'saving' ? 'Saving…' : 'Saved'}</span>
        <ResumeWriting subjectId={subjectId} titleFor={(id) => chapters.find((c) => c.id === id)?.title} />
        <div className="detail-footer">
          <button type="button" className="detail-delete" onClick={() => setConfirmingDelete(true)}>
            Delete {cfg.singular}
          </button>
          <button
            type="button"
            className={`review-btn${reviewing ? ' loading' : ''}`}
            onClick={() => void runReview()}
            disabled={reviewing}
          >
            <span className="icon">✦</span>
            {reviewing ? 'Reviewing…' : 'Review'}
          </button>
        </div>
      </main>

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete this ${cfg.singular}?`}
          message={`"${displayName}" will be removed from your outline. This can't be undone.`}
          confirmLabel="Delete"
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            setConfirmingDelete(false);
            if (isCharacter) await deleteCharacter(subjectId, entity.id);
            else await deletePlace(subjectId, entity.id);
            router.push(`/subjects/${subjectId}?tab=${cfg.listTab}`);
          }}
        />
      )}

      {addingThread && threadsSectionId && (
        <NewThreadDialog
          about={firstName}
          onCancel={() => setAddingThread(false)}
          onAdd={async (values) => {
            const created = await createLinkedThread(subjectId, threadsSectionId, entity.id, values);
            setThreads((prev) => [...prev, created as Entry]);
            setAddingThread(false);
          }}
        />
      )}

      {searchOpen && <ProjectSearch subjectId={subjectId} onClose={() => setSearchOpen(false)} onSelect={goToSearchResult} />}
    </>
  );
}

function NewThreadDialog({
  about,
  onCancel,
  onAdd,
}: {
  about: string;
  onCancel: () => void;
  onAdd: (values: { title: string; summary: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onAdd({ title, summary });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="entity-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="entity-dialog-title">New thread about {about}</h3>
        <input
          className="text-input"
          placeholder="Name"
          value={title}
          autoFocus
          disabled={saving}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter') void submit();
          }}
        />
        <textarea
          className="manifesto-textarea"
          style={{ minHeight: 70 }}
          placeholder="Short summary…"
          value={summary}
          disabled={saving}
          onChange={(e) => setSummary(e.target.value)}
        />
        <div className="entity-dialog-actions">
          <button className="secondary-btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="primary-btn" onClick={() => void submit()} disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
