'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import TopNav, { PROJECT_TABS, isProjectTab, type ProjectTab } from '@/components/TopNav/TopNav';
import ProjectSearch from '@/components/ProjectSearch';
import ResumeWriting from '@/components/ResumeWriting';
import RecentEdits, { type RecentItem } from '@/components/Outline/RecentEdits';
import DashedOutline from '@/components/DashedOutline';
import ConfirmDialog from '@/components/ConfirmDialog';
import TrashIcon from '@/components/icons/TrashIcon';
import { SearchIcon, GripVerticalIcon, PlusIcon } from '@/components/icons';
import type { Character, Entry, EntityMention, OutlineReview, OutlineSuggestionCategory, Place, SearchResult } from '@/lib/types';
import { createEntry, deleteEntry, renameEntry } from '@/app/subjects/[subjectId]/actions';
import {
  saveStorySummary,
  saveChapterMeta,
  createChapter,
  reorderChapters,
  updateCharacter,
  deleteCharacter,
  updatePlace,
  deletePlace,
  createBlankEntity,
} from '@/app/subjects/[subjectId]/outline/actions';
import { findAppearances, shouldSuggestPromote } from '@/lib/appearances';

type OutlineTab = ProjectTab;

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
  /** AI-found indirect references (entity_mentions), for appearance counts. */
  mentions: EntityMention[];
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
  mentions,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [premise, setPremise] = useState(initialPremise);
  const [themes, setThemes] = useState(initialThemes);
  const [takeaway, setTakeaway] = useState(initialTakeaway);

  const [chapters, setChapters] = useState(initialChapters);
  const [characters, setCharacters] = useState(initialCharacters);
  const [places, setPlaces] = useState(initialPlaces);

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
  const [, startTransition] = useTransition();

  const initialTabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<OutlineTab>(
    isProjectTab(initialTabParam) ? initialTabParam : 'overview' // Summary is the landing page
  );
  const title = initialTitle;
  const [chaptersDirty, setChaptersDirty] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Summary tab — premise/themes/takeaway each get their own hover-reveal
  // Edit button and contentEditable field, mirroring the outline title's
  // edit interaction (startEditTitle/saveTitle/cancelEditTitle above).
  type SummaryField = 'premise' | 'themes' | 'takeaway';
  const [editingSummaryField, setEditingSummaryField] = useState<SummaryField | null>(null);
  const premiseRef = useRef<HTMLParagraphElement>(null);
  const themesRef = useRef<HTMLParagraphElement>(null);
  const takeawayRef = useRef<HTMLParagraphElement>(null);
  const summaryFieldRefs = { premise: premiseRef, themes: themesRef, takeaway: takeawayRef };

  // Fade the content out under the sticky title/tab bar once the panel has
  // scrolled past the top, instead of an abrupt hard clip.
  useEffect(() => {
    const scrollEl = document.querySelector('.editor-scroll');
    if (!scrollEl) return;
    const onScroll = () => setScrolled(scrollEl.scrollTop > 0);
    onScroll();
    scrollEl.addEventListener('scroll', onScroll);
    return () => scrollEl.removeEventListener('scroll', onScroll);
  }, []);

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
    else if (activeTab === 'characters') void openNewEntity('character');
    else if (activeTab === 'places') void openNewEntity('place');
    else if (activeTab === 'threads' && threadsSectionId) setAddingThread(true);
    router.replace(`/subjects/${subjectId}?tab=${activeTab}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveSummary(next: { premise: string; themes: string; takeaway: string }) {
    startTransition(() => {
      void saveStorySummary(subjectId, next);
    });
  }

  function summaryFieldValue(field: SummaryField) {
    if (field === 'premise') return premise;
    if (field === 'themes') return themes;
    return takeaway;
  }

  function startEditSummaryField(field: SummaryField) {
    setEditingSummaryField(field);
    requestAnimationFrame(() => {
      const node = summaryFieldRefs[field].current;
      if (!node) return;
      // Don't start the user off editing the placeholder prompt.
      if (!summaryFieldValue(field)) node.textContent = '';
      node.focus();
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  }

  // Summary → Recent edits: everything in the project, newest first.
  const recentItems: RecentItem[] = [
    ...chapters.map((c, i) => ({
      key: `chapter-${c.id}`,
      type: `Chapter ${i + 1}`,
      title: c.title || 'Untitled chapter',
      text: c.content_text || c.synopsis || '',
      updatedAt: c.updated_at,
      onOpen: () => router.push(`/subjects/${subjectId}/entries/${c.id}`),
    })),
    ...threads.map((t) => ({
      key: `thread-${t.id}`,
      type: 'Thread',
      title: t.title || 'Untitled thread',
      text: t.content_text || '',
      updatedAt: t.updated_at,
      onOpen: () => router.push(`/subjects/${subjectId}/entries/${t.id}`),
    })),
    ...characters.map((c) => ({
      key: `character-${c.id}`,
      type: 'Character',
      title: c.name || 'Unnamed character',
      text: c.summary || '',
      updatedAt: c.updated_at,
      onOpen: () => router.push(detailHref('character', c.id)),
    })),
    ...places.map((p) => ({
      key: `place-${p.id}`,
      type: 'Place',
      title: p.name || 'Unnamed place',
      text: p.summary || '',
      updatedAt: p.updated_at,
      onOpen: () => router.push(detailHref('place', p.id)),
    })),
  ];

  // Summary fields work like a hovered note / chapter tile: the hover highlight
  // covers the text plus a reserved button row, with Edit at the bottom-right
  // inside it. While editing, the highlight stays and Cancel + Save replace Edit.
  function renderSummaryField(
    field: SummaryField,
    label: string,
    value: string,
    placeholder: string,
    textClass: string,
    extraClass = ''
  ) {
    const editing = editingSummaryField === field;
    return (
      <div className={`summary-field-wrap${extraClass}${editing ? ' editing' : ''}`}>
        <label className="field-label">{label}</label>
        <div className="summary-box" onClick={() => !editing && startEditSummaryField(field)}>
          <p
            ref={summaryFieldRefs[field]}
            className={`${textClass}${!value && !editing ? ' placeholder' : ''}`}
            contentEditable={editing}
            suppressContentEditableWarning
            spellCheck={false}
            onKeyDown={(e) => e.key === 'Escape' && cancelEditSummaryField(field)}
          >
            {value || placeholder}
          </p>
          <div
            className="summary-box-actions"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.preventDefault()}
          >
            {editing ? (
              <>
                <button className="action-btn" onClick={() => cancelEditSummaryField(field)}>
                  Cancel
                </button>
                <button className="action-btn action-btn-primary" onClick={() => saveSummaryField(field)}>
                  Save
                </button>
              </>
            ) : (
              <button className="action-btn" onClick={() => startEditSummaryField(field)}>
                Edit
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function saveSummaryField(field: SummaryField) {
    const node = summaryFieldRefs[field].current;
    const next = node?.textContent?.trim() || '';
    const values = {
      premise: field === 'premise' ? next : premise,
      themes: field === 'themes' ? next : themes,
      takeaway: field === 'takeaway' ? next : takeaway,
    };
    if (field === 'premise') setPremise(next);
    else if (field === 'themes') setThemes(next);
    else setTakeaway(next);
    setEditingSummaryField(null);
    saveSummary(values);
  }

  function cancelEditSummaryField(field: SummaryField) {
    const node = summaryFieldRefs[field].current;
    if (node) node.textContent = summaryFieldValue(field);
    setEditingSummaryField(null);
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

  // Tabs live in the shared top bar; keep the URL in sync so reloads, the
  // editor's tab links (?tab=…) and the back button all land on the same tab.
  function selectTab(tab: OutlineTab) {
    setActiveTab(tab);
    router.replace(`/subjects/${subjectId}?tab=${tab}`, { scroll: false });
    const scrollEl = document.querySelector('.outline-area .editor-scroll');
    if (scrollEl) scrollEl.scrollTop = 0;
  }

  function goToSearchResult(result: SearchResult) {
    setSearchOpen(false);
    if (result.kind === 'chapter' || result.kind === 'thread') {
      router.push(`/subjects/${subjectId}/entries/${result.id}`);
    } else {
      router.push(detailHref(result.kind, result.id));
    }
  }

  // ---- Characters / Places → detail pages ----
  function detailHref(kind: 'character' | 'place', id: string) {
    return `/subjects/${subjectId}/${kind === 'character' ? 'characters' : 'places'}/${id}`;
  }
  // "Add a new character/place" opens a fresh detail page with the name in edit
  // mode (replaces the old pop-up).
  async function openNewEntity(kind: 'character' | 'place') {
    const id = await createBlankEntity(subjectId, kind);
    router.push(`${detailHref(kind, id)}?new=1`);
  }

  // Main / Supporting (Key / Other) groups. Main keeps your order; the rest
  // sorts by how many chapters they appear in, and anyone in at least half the
  // chapters gets a "Mark as main?" nudge you can accept or wave off.
  function renderEntityGroups(kind: 'character' | 'place') {
    const isCharacter = kind === 'character';
    const list: (Character | Place)[] = isCharacter ? characters : places;
    const isFlagged = (x: Character | Place) => (isCharacter ? (x as Character).is_main : (x as Place).is_key);
    const counted = list.map((x) => ({ x, n: findAppearances(x, isCharacter, chapters, mentions).length }));
    const main = counted.filter((o) => isFlagged(o.x));
    const rest = counted.filter((o) => !isFlagged(o.x)).sort((a, b) => b.n - a.n);
    const labels = isCharacter ? ['Main characters', 'Supporting characters'] : ['Key locations', 'Other places'];

    async function setFlag(x: Character | Place, patch: { is_main?: boolean; is_key?: boolean; promote_dismissed?: boolean }) {
      if (isCharacter) {
        setCharacters((prev) => prev.map((c) => (c.id === x.id ? { ...c, ...patch } : c)));
        await updateCharacter(subjectId, x.id, patch);
      } else {
        setPlaces((prev) => prev.map((p) => (p.id === x.id ? { ...p, ...patch } : p)));
        await updatePlace(subjectId, x.id, patch);
      }
    }

    const card = ({ x, n }: { x: Character | Place; n: number }) => (
      <EntityCard
        key={x.id}
        name={x.name || (isCharacter ? 'Unnamed character' : 'Unnamed place')}
        role={isCharacter ? (x as Character).role : undefined}
        summary={(x.summary || '').split(/\n+/)[0]}
        clampSummary
        source={x.source}
        typeLabel={kind}
        onEdit={() => router.push(detailHref(kind, x.id))}
        onRequestDelete={() =>
          setConfirmDialog({
            title: `Delete this ${kind}?`,
            message: `"${x.name || 'Untitled'}" will be removed from your outline. This can't be undone.`,
            confirmLabel: 'Delete',
            onConfirm: async () => {
              if (isCharacter) {
                await deleteCharacter(subjectId, x.id);
                setCharacters((prev) => prev.filter((c) => c.id !== x.id));
              } else {
                await deletePlace(subjectId, x.id);
                setPlaces((prev) => prev.filter((p) => p.id !== x.id));
              }
            },
          })
        }
      >
        {!isFlagged(x) && !x.promote_dismissed && shouldSuggestPromote(n, chapters.length) && (
          <div className="entity-suggest" onClick={(e) => e.stopPropagation()}>
            <span className="icon">✦</span>
            <span>
              Appears in {n} of {chapters.length} chapters
            </span>
            <button
              type="button"
              className="entity-suggest-btn"
              onClick={() => void setFlag(x, isCharacter ? { is_main: true } : { is_key: true })}
            >
              Mark as {isCharacter ? 'main' : 'key'}
            </button>
            <button type="button" className="entity-suggest-skip" onClick={() => void setFlag(x, { promote_dismissed: true })}>
              Not now
            </button>
          </div>
        )}
      </EntityCard>
    );

    return (
      <>
        <div className="section-label">{labels[0]}</div>
        {main.length === 0 ? (
          <p className="entity-group-empty">
            {isCharacter
              ? 'No main characters yet. Open someone and switch on “Main character.”'
              : 'No key locations yet. Open a place and switch on “Key location.”'}
          </p>
        ) : (
          main.map(card)
        )}
        <div className="section-label entity-group-gap">{labels[1]}</div>
        {rest.map(card)}
      </>
    );
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
        selectTab('insights');
        setChaptersDirty(false);
      }
    } finally {
      setReviewing(false);
    }
  }

  return (
    <div className="app">
      <main className="editor-area outline-area">
      <TopNav
        subjectTitle={title}
        mode="static"
        activeTab={activeTab}
        onSelectTab={selectTab}
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

      <div className="editor-scroll">
        <div className="outline-column">
          <div className={`outline-sticky-head${scrolled ? ' is-scrolled' : ''}`}>
            <h1 className="outline-page-title">
              {PROJECT_TABS.find((t) => t.id === activeTab)?.label}
            </h1>
          </div>

          {/* ---------- Insights (outline review results) ---------- */}
          <div className={`tab-panel${activeTab === 'insights' ? ' active' : ''}`}>
            <section className="outline-section" style={{ marginTop: 16 }}>
              {!review ? (
                <button className="empty-tile" onClick={runOutlineReview} disabled={reviewing}>
                  <DashedOutline />
                  <div className="empty-tile-title">See your outline through fresh eyes.</div>
                  <div className="empty-tile-desc">Run a review to get feedback on your outline.</div>
                  <div className="empty-tile-circle">✦</div>
                </button>
              ) : (
                <>
                  <p className="insights-summary">{review.summary}</p>
                  <div className="insights-table">
                    <div className="insights-header-row">
                      <span className="insights-header-cell category">Category</span>
                      <span className="insights-header-cell">Suggestion</span>
                    </div>
                    {review.suggestions.map((s) => (
                      <div key={s.id} className="insights-row">
                        <div className="insights-category-cell">
                          <span className="insights-dot" style={{ background: CATEGORY_COLOR_VAR[s.category] }} />
                          <span className="insights-cat-label">{CATEGORY_LABEL[s.category]}</span>
                        </div>
                        <div className="insights-content-cell">
                          <span className="insights-heading">{s.heading}</span>
                          <p className="insights-desc">{s.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>

          {/* ---------- Summary ---------- */}
          <div className={`tab-panel${activeTab === 'overview' ? ' active' : ''}`}>
            <section className="outline-section" style={{ marginTop: 16 }}>
              <div className="summary-fields">
                {renderSummaryField('premise', 'What is this story about?', premise, 'A quick premise — who, what, why now…', 'summary-premise-text')}
                <div className="field-row">
                  {renderSummaryField('themes', 'General themes', themes, 'What ideas or tensions run through it?', 'summary-field-text', ' field-group')}
                  {renderSummaryField('takeaway', 'Reader takeaway', takeaway, 'What should the reader feel or understand when they finish?', 'summary-field-text', ' field-group')}
                </div>
              </div>
            </section>
            <RecentEdits items={recentItems} />
          </div>

          {/* ---------- Chapters ---------- */}
          <div className={`tab-panel${activeTab === 'chapters' ? ' active' : ''}`}>
            <section className="outline-section" style={{ marginTop: 16 }}>
              <div className="chapter-list">
                {chapters.length === 0 ? (
                  <button className="empty-tile" onClick={() => setChapterDialogOpen(true)}>
                    <DashedOutline />
                    <div className="empty-tile-title">Add some good bones to your story.</div>
                    <div className="empty-tile-circle"><PlusIcon size={18} /></div>
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
                      <DashedOutline />
                      <span className="chapter-add-tile-circle"><PlusIcon /></span>
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
              <div className="entity-grid">
                {characters.length === 0 ? (
                  <button className="empty-tile" onClick={() => void openNewEntity('character')}>
                    <DashedOutline />
                    <div className="empty-tile-title">Tell us who brings your story to life.</div>
                    <div className="empty-tile-circle"><PlusIcon size={18} /></div>
                  </button>
                ) : (
                  <>
                    {renderEntityGroups('character')}
                    <button className="entity-add-tile" onClick={() => void openNewEntity('character')}>
                      <DashedOutline />
                      <span className="chapter-add-tile-circle"><PlusIcon /></span>
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
              <div className="entity-grid">
                {places.length === 0 ? (
                  <button className="empty-tile" onClick={() => void openNewEntity('place')}>
                    <DashedOutline />
                    <div className="empty-tile-title">Show us where your story unfolds.</div>
                    <div className="empty-tile-circle"><PlusIcon size={18} /></div>
                  </button>
                ) : (
                  <>
                    {renderEntityGroups('place')}
                    <button className="entity-add-tile" onClick={() => void openNewEntity('place')}>
                      <DashedOutline />
                      <span className="chapter-add-tile-circle"><PlusIcon /></span>
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
                    <DashedOutline />
                    <div className="empty-tile-title">Track the threads that tie it all together.</div>
                    <div className="empty-tile-desc">
                      A place for unfinished thoughts, ideas, and loose threads that you&rsquo;re not
                      ready to add yet.
                    </div>
                    <div className="empty-tile-circle"><PlusIcon size={18} /></div>
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
                      <DashedOutline />
                      <span className="chapter-add-tile-circle"><PlusIcon /></span>
                      <span>Add a new thread</span>
                    </button>
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      <span className="outline-saved">Saved</span>
      <ResumeWriting subjectId={subjectId} titleFor={(id) => chapters.find((c) => c.id === id)?.title} />
      <button
        className={`review-btn review-btn-top outline-review-float${chaptersDirty ? ' has-dirty' : ''}${reviewing ? ' loading' : ''}`}
        onClick={runOutlineReview}
        disabled={reviewing}
      >
        <span className="icon">✦</span>
        <span>{reviewing ? 'Reviewing…' : 'Review'}</span>
        <span className="review-dirty-dot" title="Chapter order changed — review to check continuity">
          !
        </span>
      </button>

      {searchOpen && (
        <ProjectSearch subjectId={subjectId} onClose={() => setSearchOpen(false)} onSelect={goToSearchResult} />
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
            <GripVerticalIcon />
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
  clampSummary,
  source,
  typeLabel,
  onEdit,
  onRequestDelete,
  children,
}: {
  name: string;
  role?: string;
  summary: string;
  clampSummary?: boolean;
  source: 'manual' | 'auto';
  typeLabel: string;
  onEdit: () => void;
  onRequestDelete: () => void;
  children?: React.ReactNode;
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
      {summary && <p className={`entity-summary${clampSummary ? ' clamped' : ''}`}>{summary}</p>}
      {children}
    </div>
  );
}
