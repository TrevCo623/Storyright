'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import ConfirmDialog from '@/components/ConfirmDialog';
import TrashIcon from '@/components/icons/TrashIcon';
import type { Character, Entry, OutlineReview, OutlineSuggestionCategory, Place } from '@/lib/types';
import { createEntry, deleteEntry, renameEntry } from '@/app/subjects/[subjectId]/actions';
import {
  updateSubjectTitle,
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

type OutlineTab = 'chapters' | 'characters' | 'places' | 'threads' | 'overview';

const TABS: { id: OutlineTab; label: string }[] = [
  { id: 'chapters', label: 'Chapters' },
  { id: 'characters', label: 'Characters' },
  { id: 'places', label: 'Places' },
  { id: 'threads', label: 'Threads' },
  { id: 'overview', label: 'Summary' },
];

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
  title: string;
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
  title: initialTitle,
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
  const searchParams = useSearchParams();

  const [premise, setPremise] = useState(initialPremise);
  const [themes, setThemes] = useState(initialThemes);
  const [takeaway, setTakeaway] = useState(initialTakeaway);

  const [chapters, setChapters] = useState(initialChapters);
  const [characters, setCharacters] = useState(initialCharacters);
  const [places, setPlaces] = useState(initialPlaces);

  const [addingCharacter, setAddingCharacter] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const [addingPlace, setAddingPlace] = useState(false);
  const [editingPlace, setEditingPlace] = useState<Place | null>(null);
  const [addingThread, setAddingThread] = useState(false);
  const [editingThread, setEditingThread] = useState<Entry | null>(null);
  const [chapterDialogOpen, setChapterDialogOpen] = useState(false);

  // Single shared delete-confirmation overlay — mirrors the prototype's one
  // showConfirmDialog() used for every delete flow (chapters/characters/
  // places/threads), instead of the browser's native window.confirm().
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  const [review, setReview] = useState(outlineReview);
  const [reviewing, setReviewing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [, startTransition] = useTransition();

  const initialTabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<OutlineTab>(
    TABS.some((t) => t.id === initialTabParam) ? (initialTabParam as OutlineTab) : 'chapters'
  );
  const [title, setTitle] = useState(initialTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [chaptersDirty, setChaptersDirty] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Chapter reordering — a custom mouse-driven drag (not native HTML5 DnD) so
  // the grab cursor and drop-slot placeholder stay under our control for the
  // whole press-and-hold gesture, matching the prototype's reorder feel.
  const chapterRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [chapterDrag, setChapterDrag] = useState<{ id: string; overIndex: number } | null>(null);
  // The drop-slot's open/close is a real height+opacity CSS transition, like the
  // prototype's — which means it needs to mount at height 0 first and only get
  // the `.active` class a frame later, or the browser has nothing to transition
  // from and the slot just pops in at full size instantly.
  const [dropSlotEntered, setDropSlotEntered] = useState(false);
  const chapterDragMeta = useRef<{ id: string; overIndex: number; lastY: number | null; rafId: number | null } | null>(
    null
  );
  const [justDroppedChapterId, setJustDroppedChapterId] = useState<string | null>(null);

  // Nav "+" buttons in the entry-editor sidebar deep-link here with
  // ?tab=<section>&new=1 to open the matching creation UI, since chapter/
  // character/place/thread creation all live on the Outline page.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    if (activeTab === 'chapters' && chaptersSectionId) setChapterDialogOpen(true);
    else if (activeTab === 'characters') setAddingCharacter(true);
    else if (activeTab === 'places') setAddingPlace(true);
    else if (activeTab === 'threads' && threadsSectionId) setAddingThread(true);
    router.replace(`/subjects/${subjectId}?tab=${activeTab}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveSummary(next: { premise: string; themes: string; takeaway: string }) {
    startTransition(() => {
      void saveStorySummary(subjectId, next);
    });
  }

  function startEditTitle() {
    setEditingTitle(true);
    requestAnimationFrame(() => {
      const node = titleRef.current;
      if (!node) return;
      node.focus();
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  }

  function saveTitle() {
    const next = titleRef.current?.textContent?.trim() || 'Untitled';
    setTitle(next);
    setEditingTitle(false);
    void updateSubjectTitle(subjectId, next);
  }

  function cancelEditTitle() {
    if (titleRef.current) titleRef.current.textContent = title;
    setEditingTitle(false);
  }

  function commitChapterReorder(chapterId: string, overIndex: number, others: Entry[]) {
    const fromIndex = chapters.findIndex((c) => c.id === chapterId);
    const dragged = chapters[fromIndex];
    if (!dragged) return;
    const next = others.slice();
    next.splice(overIndex, 0, dragged);
    const targetIndex = next.findIndex((c) => c.id === chapterId);
    setChapters(next);
    if (targetIndex !== fromIndex) {
      setChaptersDirty(true);
      void reorderChapters(subjectId, next.map((c) => c.id));
    }
    setJustDroppedChapterId(chapterId);
  }

  function startChapterDrag(chapter: Entry, index: number, e: React.MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.chapter-row.is-editing')) return;
    e.preventDefault();
    const row = chapterRowRefs.current.get(chapter.id);
    if (!row) return;

    const rect = row.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    row.style.width = `${rect.width}px`;
    row.style.left = `${rect.left}px`;
    row.style.top = `${rect.top}px`;
    row.classList.add('chapter-drag-ghost');
    document.body.classList.add('is-reordering');

    const others = chapters.filter((c) => c.id !== chapter.id);
    const scrollEl = document.querySelector('.editor-scroll') as HTMLElement | null;
    chapterDragMeta.current = { id: chapter.id, overIndex: index, lastY: e.clientY, rafId: null };
    setChapterDrag({ id: chapter.id, overIndex: index });
    setDropSlotEntered(false);
    requestAnimationFrame(() => setDropSlotEntered(true));

    function computeOverIndex(clientY: number) {
      for (let i = 0; i < others.length; i++) {
        const r = chapterRowRefs.current.get(others[i].id);
        if (!r) continue;
        const rr = r.getBoundingClientRect();
        if (clientY < rr.top + rr.height / 2) return i;
      }
      return others.length;
    }

    function applyOverIndex(idx: number) {
      if (chapterDragMeta.current && chapterDragMeta.current.overIndex !== idx) {
        chapterDragMeta.current.overIndex = idx;
        setChapterDrag({ id: chapter.id, overIndex: idx });
      }
    }

    function onMove(ev: MouseEvent) {
      row!.style.left = `${ev.clientX - offsetX}px`;
      row!.style.top = `${ev.clientY - offsetY}px`;
      if (chapterDragMeta.current) chapterDragMeta.current.lastY = ev.clientY;
      applyOverIndex(computeOverIndex(ev.clientY));
    }

    // While the cursor holds near the top/bottom edge of the scroll viewport,
    // mousemove alone won't keep firing — this rAF loop nudges the container's
    // scroll position each frame so the drag can reach chapters off-screen.
    function autoScrollTick() {
      if (!chapterDragMeta.current) return;
      const lastY = chapterDragMeta.current.lastY;
      if (lastY !== null && scrollEl) {
        const bounds = scrollEl.getBoundingClientRect();
        const edge = 80;
        const maxSpeed = 9;
        let delta = 0;
        const distFromTop = lastY - bounds.top;
        const distFromBottom = bounds.bottom - lastY;
        if (distFromTop < edge && distFromTop >= 0) delta = -maxSpeed * (1 - distFromTop / edge);
        else if (distFromBottom < edge && distFromBottom >= 0) delta = maxSpeed * (1 - distFromBottom / edge);
        if (delta !== 0) {
          scrollEl.scrollTop += delta;
          applyOverIndex(computeOverIndex(lastY));
        }
      }
      chapterDragMeta.current.rafId = requestAnimationFrame(autoScrollTick);
    }
    chapterDragMeta.current.rafId = requestAnimationFrame(autoScrollTick);

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('is-reordering');
      row!.classList.remove('chapter-drag-ghost');
      row!.style.width = '';
      row!.style.left = '';
      row!.style.top = '';
      const meta = chapterDragMeta.current;
      if (meta?.rafId != null) cancelAnimationFrame(meta.rafId);
      chapterDragMeta.current = null;
      setChapterDrag(null);
      setDropSlotEntered(false);
      commitChapterReorder(chapter.id, meta?.overIndex ?? index, others);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  useEffect(() => {
    if (!justDroppedChapterId) return;
    const t = setTimeout(() => setJustDroppedChapterId(null), 2000);
    return () => clearTimeout(t);
  }, [justDroppedChapterId]);

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
        setChaptersDirty(false);
      }
    } finally {
      setReviewing(false);
    }
  }

  return (
    <div className="app">
      <main className="editor-area outline-area">
      <header className="topbar">
        <Link href="/subjects" className="nav-back-link">
          ‹ See all projects
        </Link>
        <div className="topbar-right">
          <ThemeToggle />
        </div>
      </header>

      <div className="editor-scroll">
        <div className="outline-column">
          <div className="outline-sticky-head">
            <div className="outline-header-row">
              <div className={`outline-title-wrap${editingTitle ? ' editing' : ''}`}>
                <h1
                  ref={titleRef}
                  className="outline-title"
                  contentEditable={editingTitle}
                  suppressContentEditableWarning
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      saveTitle();
                    } else if (e.key === 'Escape') {
                      cancelEditTitle();
                    }
                  }}
                >
                  {title || 'Untitled'}
                </h1>
                <button className="title-edit-btn" onClick={startEditTitle}>
                  Edit
                </button>
                <button className="title-save-btn" onClick={saveTitle}>
                  Save title
                </button>
              </div>
              <button
                className={`review-btn review-btn-top${chaptersDirty ? ' has-dirty' : ''}${reviewing ? ' loading' : ''}`}
                onClick={runOutlineReview}
                disabled={reviewing}
              >
                <span className="icon">✦</span>
                <span>{reviewing ? 'Reviewing…' : 'Review'}</span>
                <span className="review-dirty-dot" title="Chapter order changed — review to check continuity">
                  !
                </span>
              </button>
            </div>

            <div className="outline-tabs">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  className={`outline-tab${activeTab === tab.id ? ' active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* ---------- Summary ---------- */}
          <div className={`tab-panel${activeTab === 'overview' ? ' active' : ''}`}>
            <section className="outline-section" style={{ marginTop: 16 }}>
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
          </div>

          {/* ---------- Chapters ---------- */}
          <div className={`tab-panel${activeTab === 'chapters' ? ' active' : ''}`}>
            <section className="outline-section" style={{ marginTop: 16 }}>
              <div className="chapter-list">
                {chapters.length === 0 ? (
                  <button className="empty-tile" onClick={() => setChapterDialogOpen(true)}>
                    <div className="empty-tile-title">Add some good bones to your story.</div>
                    <div className="empty-tile-circle">+</div>
                  </button>
                ) : (
                  <>
                    {(() => {
                      const draggingId = chapterDrag?.id ?? null;
                      const overIndex = chapterDrag?.overIndex ?? null;
                      const nodes: React.ReactNode[] = [];
                      let otherIdx = 0;
                      chapters.forEach((chapter, index) => {
                        const isDragging = chapter.id === draggingId;
                        if (draggingId !== null && overIndex === otherIdx && !isDragging) {
                          nodes.push(
                            <div
                              key="chapter-drop-slot"
                              className={`chapter-drop-slot${dropSlotEntered ? ' active' : ''}`}
                            />
                          );
                        }
                        nodes.push(
                          <ChapterRow
                            key={chapter.id}
                            subjectId={subjectId}
                            chapter={chapter}
                            index={index}
                            registerRef={(el) => {
                              if (el) chapterRowRefs.current.set(chapter.id, el);
                              else chapterRowRefs.current.delete(chapter.id);
                            }}
                            onGrabHandle={(e) => startChapterDrag(chapter, index, e)}
                            dimmed={draggingId !== null && !isDragging}
                            justDropped={justDroppedChapterId === chapter.id}
                            onSaved={(patch) =>
                              setChapters((prev) =>
                                prev.map((c) => (c.id === chapter.id ? { ...c, ...patch } : c))
                              )
                            }
                            onRequestDelete={() =>
                              setConfirmDialog({
                                title: 'Delete this chapter?',
                                message: `"${chapter.title || 'Untitled chapter'}" will be removed from your outline. This can't be undone.`,
                                confirmLabel: 'Delete',
                                onConfirm: () => {
                                  void deleteEntry(subjectId, chapter.id);
                                  setChapters((prev) => prev.filter((c) => c.id !== chapter.id));
                                },
                              })
                            }
                          />
                        );
                        if (!isDragging) otherIdx++;
                      });
                      if (draggingId !== null && overIndex === otherIdx) {
                        nodes.push(
                          <div
                            key="chapter-drop-slot"
                            className={`chapter-drop-slot${dropSlotEntered ? ' active' : ''}`}
                          />
                        );
                      }
                      return nodes;
                    })()}
                    <button className="chapter-add-tile" onClick={() => setChapterDialogOpen(true)}>
                      <span className="chapter-add-tile-circle">+</span>
                      <span>Add a new chapter</span>
                    </button>
                  </>
                )}
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
          </div>

          {/* ---------- Characters ---------- */}
          <div className={`tab-panel${activeTab === 'characters' ? ' active' : ''}`}>
            <section className="outline-section" style={{ marginTop: 16 }}>
              {addingCharacter && (
                <EntityDialog
                  title="New character"
                  fields={['name', 'role', 'summary']}
                  submitLabel="Add"
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
              {editingCharacter && (
                <EntityDialog
                  title="Edit character"
                  fields={['name', 'role', 'summary']}
                  submitLabel="Save"
                  initial={{
                    name: editingCharacter.name,
                    role: editingCharacter.role,
                    summary: editingCharacter.summary,
                  }}
                  onCancel={() => setEditingCharacter(null)}
                  onSubmit={async (values) => {
                    await updateCharacter(subjectId, editingCharacter.id, values);
                    setCharacters((prev) =>
                      prev.map((c) => (c.id === editingCharacter.id ? { ...c, ...values } : c))
                    );
                    setEditingCharacter(null);
                  }}
                />
              )}
              <div className="entity-grid">
                {characters.length === 0 ? (
                  <button className="empty-tile" onClick={() => setAddingCharacter(true)}>
                    <div className="empty-tile-title">Tell us who brings your story to life.</div>
                    <div className="empty-tile-circle">+</div>
                  </button>
                ) : (
                  <>
                    {characters.map((character) => (
                      <EntityCard
                        key={character.id}
                        name={character.name}
                        role={character.role}
                        summary={character.summary}
                        source={character.source}
                        typeLabel="character"
                        onEdit={() => setEditingCharacter(character)}
                        onRequestDelete={() =>
                          setConfirmDialog({
                            title: 'Delete this character?',
                            message: `"${character.name || 'Untitled'}" will be removed from your outline. This can't be undone.`,
                            confirmLabel: 'Delete',
                            onConfirm: async () => {
                              await deleteCharacter(subjectId, character.id);
                              setCharacters((prev) => prev.filter((c) => c.id !== character.id));
                            },
                          })
                        }
                      />
                    ))}
                    <button className="entity-add-tile" onClick={() => setAddingCharacter(true)}>
                      <span className="chapter-add-tile-circle">+</span>
                      <span>Add a new character</span>
                    </button>
                  </>
                )}
              </div>
            </section>
          </div>

          {/* ---------- Places ---------- */}
          <div className={`tab-panel${activeTab === 'places' ? ' active' : ''}`}>
            <section className="outline-section" style={{ marginTop: 16 }}>
              {addingPlace && (
                <EntityDialog
                  title="New place"
                  fields={['name', 'summary']}
                  submitLabel="Add"
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
              {editingPlace && (
                <EntityDialog
                  title="Edit place"
                  fields={['name', 'summary']}
                  submitLabel="Save"
                  initial={{ name: editingPlace.name, summary: editingPlace.summary }}
                  onCancel={() => setEditingPlace(null)}
                  onSubmit={async (values) => {
                    await updatePlace(subjectId, editingPlace.id, values);
                    setPlaces((prev) =>
                      prev.map((p) => (p.id === editingPlace.id ? { ...p, ...values } : p))
                    );
                    setEditingPlace(null);
                  }}
                />
              )}
              <div className="entity-grid">
                {places.length === 0 ? (
                  <button className="empty-tile" onClick={() => setAddingPlace(true)}>
                    <div className="empty-tile-title">Show us where your story unfolds.</div>
                    <div className="empty-tile-circle">+</div>
                  </button>
                ) : (
                  <>
                    {places.map((place) => (
                      <EntityCard
                        key={place.id}
                        name={place.name}
                        summary={place.summary}
                        source={place.source}
                        typeLabel="place"
                        onEdit={() => setEditingPlace(place)}
                        onRequestDelete={() =>
                          setConfirmDialog({
                            title: 'Delete this place?',
                            message: `"${place.name || 'Untitled'}" will be removed from your outline. This can't be undone.`,
                            confirmLabel: 'Delete',
                            onConfirm: async () => {
                              await deletePlace(subjectId, place.id);
                              setPlaces((prev) => prev.filter((p) => p.id !== place.id));
                            },
                          })
                        }
                      />
                    ))}
                    <button className="entity-add-tile" onClick={() => setAddingPlace(true)}>
                      <span className="chapter-add-tile-circle">+</span>
                      <span>Add a new place</span>
                    </button>
                  </>
                )}
              </div>
            </section>
          </div>

          {/* ---------- Threads ---------- */}
          <div className={`tab-panel${activeTab === 'threads' ? ' active' : ''}`}>
            <section className="outline-section" style={{ marginTop: 16 }}>
              {addingThread && (
                <EntityDialog
                  title="New thread"
                  fields={['name', 'summary']}
                  submitLabel="Add"
                  onCancel={() => setAddingThread(false)}
                  onSubmit={async (values) => {
                    if (!threadsSectionId) return;
                    // createEntry redirects server-side into the new thread's
                    // full editor once saved, matching how "Write" works for
                    // chapters — threads carry real long-form content, unlike
                    // the prototype's static demo objects.
                    await createEntry(subjectId, threadsSectionId, null, values.name);
                  }}
                />
              )}
              {editingThread && (
                <EntityDialog
                  title="Edit thread"
                  fields={['name', 'summary']}
                  submitLabel="Save"
                  initial={{ name: editingThread.title, summary: editingThread.synopsis }}
                  onCancel={() => setEditingThread(null)}
                  onSubmit={async (values) => {
                    await renameEntry(subjectId, editingThread.id, values.name);
                    await saveChapterMeta(subjectId, editingThread.id, {
                      synopsis: values.summary ?? '',
                      target_feeling: editingThread.target_feeling,
                    });
                    setEditingThread(null);
                    router.refresh();
                  }}
                />
              )}
              <div className="entity-grid">
                {threads.length === 0 ? (
                  <button className="empty-tile" onClick={() => setAddingThread(true)}>
                    <div className="empty-tile-title">Track the threads that tie it all together.</div>
                    <div className="empty-tile-desc">
                      A place for unfinished thoughts, ideas, and loose threads that you&rsquo;re not
                      ready to add yet.
                    </div>
                    <div className="empty-tile-circle">+</div>
                  </button>
                ) : (
                  <>
                    {threads.map((thread) => (
                      <EntityCard
                        key={thread.id}
                        name={thread.title}
                        summary={thread.synopsis}
                        source="manual"
                        typeLabel="thread"
                        onEdit={() => setEditingThread(thread)}
                        onRequestDelete={() =>
                          setConfirmDialog({
                            title: 'Delete this thread?',
                            message: `"${thread.title || 'Untitled'}" will be removed from your outline. This can't be undone.`,
                            confirmLabel: 'Delete',
                            onConfirm: () => void deleteEntry(subjectId, thread.id),
                          })
                        }
                      />
                    ))}
                    <button className="entity-add-tile" onClick={() => setAddingThread(true)}>
                      <span className="chapter-add-tile-circle">+</span>
                      <span>Add a new thread</span>
                    </button>
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

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

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onCancel={() => setConfirmDialog(null)}
          onConfirm={() => {
            confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
        />
      )}

      </main>
    </div>
  );
}

function ChapterRow({
  subjectId,
  chapter,
  index,
  registerRef,
  onGrabHandle,
  dimmed,
  justDropped,
  onSaved,
  onRequestDelete,
}: {
  subjectId: string;
  chapter: Entry;
  index: number;
  registerRef: (el: HTMLDivElement | null) => void;
  onGrabHandle: (e: React.MouseEvent) => void;
  dimmed: boolean;
  justDropped: boolean;
  onSaved: (patch: { title: string; synopsis: string; target_feeling: string }) => void;
  onRequestDelete: () => void;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(chapter.title);
  const [synopsis, setSynopsis] = useState(chapter.synopsis);
  const [feeling, setFeeling] = useState(chapter.target_feeling);

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
      ref={registerRef}
      data-chapter-id={chapter.id}
      className={`chapter-row${isEditing ? ' is-editing' : ''}${dimmed ? ' reorder-dim' : ''}${justDropped ? ' just-dropped' : ''}`}
      onClick={(e) => {
        if (isEditing) return;
        if ((e.target as HTMLElement).closest('button')) return;
        if ((e.target as HTMLElement).closest('.chapter-drag-handle')) return;
        openChapter();
      }}
    >
      <div className="chapter-row-controls">
        <button
          className="chapter-icon-btn chapter-trash-icon"
          title="Delete chapter"
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete();
          }}
        >
          <TrashIcon />
        </button>
        {!isEditing && (
          <span
            className="chapter-icon-btn chapter-drag-handle"
            title="Drag to reorder"
            onMouseDown={onGrabHandle}
          >
            ⠿
          </span>
        )}
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

// Shared add/edit popup for Characters, Places, and Threads — mirrors the
// prototype's single openEntityDialog(opts, item) function, which drives both
// creation and editing off the same field list rather than separate UIs.
function EntityDialog({
  title,
  fields,
  initial,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  title: string;
  fields: EntityFields[];
  initial?: { name?: string; role?: string; summary?: string };
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (values: { name: string; role?: string; summary?: string }) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState(initial?.role ?? '');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit({ name, role, summary });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="entity-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="entity-dialog-title">{title}</h3>
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
          />
        )}
        {fields.includes('summary') && (
          <textarea
            className="manifesto-textarea"
            style={{ minHeight: 70 }}
            placeholder="Short summary…"
            value={summary}
            disabled={saving}
            onChange={(e) => setSummary(e.target.value)}
          />
        )}
        <div className="entity-dialog-actions">
          <button className="secondary-btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="primary-btn" onClick={submit} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Character/Place/Thread card — mirrors the prototype's entityCard(): no
// inline editing, no visible Edit/Delete text buttons. Clicking the card body
// opens the edit dialog; a small hover-revealed delete icon (top-right) opens
// the shared confirm dialog.
function EntityCard({
  name,
  role,
  summary,
  source,
  typeLabel,
  onEdit,
  onRequestDelete,
}: {
  name: string;
  role?: string;
  summary: string;
  source: 'manual' | 'auto';
  typeLabel: string;
  onEdit: () => void;
  onRequestDelete: () => void;
}) {
  return (
    <div className="entity-card" onClick={onEdit}>
      <button
        className="entity-delete-btn"
        title={`Delete ${typeLabel}`}
        onClick={(e) => {
          e.stopPropagation();
          onRequestDelete();
        }}
      >
        <TrashIcon />
      </button>
      <div className="entity-card-head">
        <span className="entity-name">{name}</span>
        {source === 'auto' && (
          <span className="auto-badge">
            <span className="icon">✦</span>Auto
          </span>
        )}
      </div>
      {role && <div className="entity-role">{role}</div>}
      {summary && <p className="entity-summary">{summary}</p>}
    </div>
  );
}
