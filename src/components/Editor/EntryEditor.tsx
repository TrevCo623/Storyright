'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import ThemeToggle from '@/components/ThemeToggle';
import TextSizeControl from '@/components/TextSizeControl';
import TopNav, { type ProjectTab } from '@/components/TopNav/TopNav';
import ProjectSearch from '@/components/ProjectSearch';
import { markWritingIn, clearWritingInIf } from '@/components/ResumeWriting';
import { SearchIcon, MessageSquareIcon } from '@/components/icons';
import AskPanel, { type AskKindLabel } from '@/components/Ask/AskPanel';
import {
  SuggestionHighlight,
  setSuggestionDecorations,
  getTopLevelBlocks,
  buildFullText,
  locatePhrase,
  getPassageContext,
  getBlockContext,
  type PassageContext,
  type VisibleSuggestion,
} from './suggestionExtension';
import { saveEntry, saveSuggestionState, recordSuggestionFeedback } from '@/app/subjects/[subjectId]/entries/[entryId]/actions';
import { syncExtractedEntities } from '@/app/subjects/[subjectId]/outline/actions';
import type { ExtractedEntity } from '@/lib/claude';
import type { Entry, SearchResult, SectionType, SuggestionCategory, SuggestionDef, SuggestionState } from '@/lib/types';

interface Props {
  subjectId: string;
  subjectTitle: string;
  entry: Entry;
  /** e.g. "Chapter 3" — shown before the title in the top bar's crumb. */
  crumbPrefix: string;
  /** Which Outline list this entry lives in — the back link returns there. */
  sectionType: SectionType;
}

interface RawSuggestionWithId {
  id: string;
  category: SuggestionCategory;
  kind: 'phrase' | 'flag' | 'pattern';
  phrase?: string;
  occurrence?: number;
  blockIndex?: number;
  instances?: { phrase: string; occurrence: number }[];
  praise?: boolean;
  heading: string;
  desc: string;
}

// The Iterate panel open on one suggestion (or one pattern instance).
interface AltPanel {
  key: string; // suggestion id, or `${parentId}.${n}` for a pattern instance
  loading: boolean;
  error: string | null;
  scope: 'phrase' | 'sentence' | 'paragraph';
  phrase: string; // the flagged passage the options were written for
  options: string[]; // as generated
  drafts: string[]; // as the writer has edited them
  shown: string[]; // every option shown so far (so "More options" doesn't repeat)
}

// Textarea that grows with its content — options read like plain text
// until the writer clicks in to tweak one.
function AutoTextarea(props: { value: string; onChange: (v: string) => void; className?: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={props.className}
      value={props.value}
      spellCheck
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

const parentIdOf = (key: string) => key.split('.')[0];

const CATEGORY_COLOR_VAR: Record<SuggestionCategory, string> = {
  word: 'var(--accent)',
  tone: 'var(--sug-tone)',
  grammar: 'var(--sug-grammar)',
  pacing: 'var(--sug-pacing)',
  style: 'var(--sug-style)',
};

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export default function EntryEditor({ subjectId, subjectTitle, entry, crumbPrefix, sectionType }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(entry.title);
  const titleRef = useRef(entry.title);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  const [suggestionState, setSuggestionState] = useState<SuggestionState>(entry.suggestion_state);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Pattern suggestions: which one is "clicked into", and which instance is selected.
  const [drillId, setDrillId] = useState<string | null>(null);
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [alt, setAlt] = useState<AltPanel | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');
  const [liveWordCount, setLiveWordCount] = useState(entry.word_count);

  // Highlight-to-ask advice mode.
  const [selectionBubble, setSelectionBubble] = useState<{ text: string; top: number; left: number } | null>(
    null
  );
  // Ask mode: the Notes rail turns into a conversation about this piece.
  const [askOpen, setAskOpen] = useState(false);
  const [askQuote, setAskQuote] = useState<string | null>(null);

  // Back in this chapter → drop any "Continue writing in …" link pointing at it.
  useEffect(() => {
    clearWritingInIf(subjectId, entry.id);
  }, [subjectId, entry.id]);

  // Full-screen project search (shared ProjectSearch overlay).
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  function goToProjectTab(tab: ProjectTab) {
    router.push(`/subjects/${subjectId}?tab=${tab}`);
  }

  function goToSearchResult(result: SearchResult) {
    closeSearch();
    if (result.kind === 'chapter' || result.kind === 'thread') {
      router.push(`/subjects/${subjectId}/entries/${result.id}`);
    } else {
      router.push(`/subjects/${subjectId}/${result.kind === 'character' ? 'characters' : 'places'}/${result.id}`);
    }
  }

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const onSuggestionClickRef = useRef<(id: string, instanceId: string | null) => void>(() => {});

  const scrollToSuggestion = useCallback((id: string, instanceId?: string | null) => {
    const sel = instanceId ? `[data-inst="${instanceId}"]` : `[data-sug="${id}"]`;
    const el = editorContainerRef.current?.querySelector(sel);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // Leaves focus mode (and any open drill-in / alternatives).
  const clearFocus = useCallback(() => {
    setActiveId(null);
    setActiveInstanceId(null);
    setDrillId(null);
    setAlt(null);
  }, []);

  useEffect(() => {
    onSuggestionClickRef.current = (id: string, instanceId: string | null) => {
      setActiveId(id);
      setAlt((a) => (a && parentIdOf(a.key) === id && (!instanceId || a.key === instanceId) ? a : null));
      if (instanceId) {
        setDrillId(id);
        setActiveInstanceId(instanceId);
        requestAnimationFrame(() => {
          railRef.current?.querySelector(`[data-inst-row="${instanceId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      } else {
        setDrillId(null);
        setActiveInstanceId(null);
        const railEl = railRef.current?.querySelector(`[data-rail-id="${id}"]`);
        railEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
  }, []);

  // Esc steps back out: alternatives → drill-in → focus mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || searchOpen) return;
      if (askOpen) setAskOpen(false);
      else if (alt) setAlt(null);
      else if (drillId) {
        setDrillId(null);
        setActiveInstanceId(null);
      } else if (activeId) setActiveId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [alt, drillId, activeId, askOpen, searchOpen]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      CharacterCount,
      SuggestionHighlight.configure({ onSuggestionClickRef }),
    ],
    content: entry.content,
    immediatelyRender: false,
    editorProps: {
      attributes: { spellcheck: 'true' },
    },
    onUpdate: ({ editor }) => {
      setLiveWordCount(editor.storage.characterCount?.words() ?? 0);
      scheduleSave();
      // Lets the Outline / detail pages offer "Continue writing in …".
      markWritingIn(subjectId, entry.id, titleRef.current || crumbPrefix);
    },
  });

  const doSave = useCallback(
    async (currentEditor: NonNullable<typeof editor>) => {
      const content = currentEditor.getJSON();
      const content_text = currentEditor.getText();
      const word_count = currentEditor.storage.characterCount?.words() ?? wordCount(content_text);
      await saveEntry(subjectId, entry.id, { title: titleRef.current, content, content_text, word_count });
      setSaveStatus('saved');
    },
    [subjectId, entry.id]
  );

  const scheduleSave = useCallback(() => {
    setSaveStatus('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (editor) void doSave(editor);
    }, 1000);
  }, [editor, doSave]);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    scheduleSave();
  };

  // Highlight-to-ask: show a small floating "Ask" button near any non-empty
  // text selection, positioned via ProseMirror's own coordinate mapping
  // (independent of the suggestion decoration system above).
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || to - from < 3) {
        setSelectionBubble(null);
        return;
      }
      const text = editor.state.doc.textBetween(from, to, ' ').trim();
      const containerRect = editorContainerRef.current?.getBoundingClientRect();
      if (!text || !containerRect) {
        setSelectionBubble(null);
        return;
      }
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      setSelectionBubble({
        text,
        top: start.top - containerRect.top + editorContainerRef.current!.scrollTop - 40,
        left: Math.min(start.left, end.left) - containerRect.left,
      });
    };
    editor.on('selectionUpdate', handler);
    editor.on('blur', () => setSelectionBubble(null));
    return () => {
      editor.off('selectionUpdate', handler);
    };
  }, [editor]);

  // "Ask about this" on a highlighted passage → Ask in the Notes rail, with the passage attached.
  const askAboutSelection = (text: string) => {
    setSelectionBubble(null);
    setAskQuote(text);
    setRailOpen(true);
    setAskOpen(true);
  };

  // Suggestion decorations follow the plugin's own position-mapping across
  // edits; we only need to push a fresh decoration set when the suggestion
  // list itself (or the active/highlighted one) changes.
  const isClosed = useCallback(
    (id: string) => suggestionState.doneIds.includes(id) || suggestionState.dismissedIds.includes(id),
    [suggestionState]
  );

  const openIds = useMemo(
    () => suggestionState.revealedIds.filter((id) => !isClosed(id)),
    [suggestionState, isClosed]
  );

  // Open suggestions, newest first; a pattern carries only its open instances.
  const orderedSuggestions: SuggestionDef[] = useMemo(
    () =>
      [...openIds]
        .reverse()
        .map((id) => suggestionState.allSuggestions[id])
        .filter((s): s is SuggestionDef => Boolean(s))
        .map((s) => (s.kind === 'pattern' ? { ...s, instances: (s.instances ?? []).filter((i) => !isClosed(i.id)) } : s)),
    [openIds, suggestionState.allSuggestions, isClosed]
  );

  const visibleSuggestions: VisibleSuggestion[] = orderedSuggestions;
  const drillDef = drillId ? orderedSuggestions.find((s) => s.id === drillId) ?? null : null;

  useEffect(() => {
    if (!editor) return;
    setSuggestionDecorations(editor, visibleSuggestions, { id: activeId, instanceId: activeInstanceId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, visibleSuggestions, activeId, activeInstanceId]);

  // A drill-in whose pattern was resolved (or vanished) closes itself.
  useEffect(() => {
    if (drillId && !drillDef) {
      setDrillId(null);
      setActiveInstanceId(null);
    }
  }, [drillId, drillDef]);

  useEffect(() => {
    if (!toast) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [toast]);

  // Closes a suggestion — or one instance of a pattern — as done/dismissed.
  // Terminal either way. When a pattern's last open instance closes, the
  // pattern itself closes as done.
  const resolve = async (key: string, outcome: 'done' | 'dismissed') => {
    const parentId = parentIdOf(key);
    const def = suggestionState.allSuggestions[parentId];
    const doneIds = [...suggestionState.doneIds];
    const dismissedIds = [...suggestionState.dismissedIds];
    (outcome === 'done' ? doneIds : dismissedIds).push(key);

    let parentClosed = key === parentId;
    if (key !== parentId && def?.kind === 'pattern') {
      const closed = new Set([...doneIds, ...dismissedIds]);
      if ((def.instances ?? []).every((i) => closed.has(i.id))) {
        doneIds.push(parentId);
        parentClosed = true;
      }
    }

    const nextState: SuggestionState = { ...suggestionState, doneIds, dismissedIds };
    setSuggestionState(nextState);
    if (alt?.key === key) setAlt(null);

    if (parentClosed) {
      if (activeId === parentId) clearFocus();
    } else if (activeInstanceId === key && def?.instances) {
      // Move straight on to the next open instance of the pattern.
      const closed = new Set([...doneIds, ...dismissedIds]);
      const idx = def.instances.findIndex((i) => i.id === key);
      const next =
        def.instances.slice(idx + 1).find((i) => !closed.has(i.id)) ?? def.instances.find((i) => !closed.has(i.id));
      setActiveInstanceId(next?.id ?? null);
      if (next) scrollToSuggestion(parentId, next.id);
    }

    await saveSuggestionState(entry.id, nextState);
    if (def) void recordSuggestionFeedback(entry.id, key, def.category, outcome);
  };

  const markDone = (key: string) => resolve(key, 'done');
  const dismiss = (key: string) => resolve(key, 'dismissed');

  // The passage a suggestion (or pattern instance) points at.
  const targetOf = (key: string): { def: SuggestionDef; phrase?: string; occurrence: number } | null => {
    const def = suggestionState.allSuggestions[parentIdOf(key)];
    if (!def) return null;
    if (key !== def.id) {
      const inst = def.instances?.find((i) => i.id === key);
      return inst ? { def, phrase: inst.phrase, occurrence: inst.occurrence } : null;
    }
    return { def, phrase: def.phrase, occurrence: def.occurrence ?? 1 };
  };

  // Where Iterate's options go: the flagged passage (and its sentence), or the
  // whole paragraph for a pacing flag.
  const contextOf = (key: string): PassageContext | null => {
    if (!editor) return null;
    const t = targetOf(key);
    if (!t) return null;
    if (t.phrase) return getPassageContext(editor.state.doc, t.phrase, t.occurrence);
    if (t.def.kind === 'flag' && typeof t.def.blockIndex === 'number') {
      return getBlockContext(editor.state.doc, t.def.blockIndex);
    }
    return null;
  };

  // ---------- Iterate (alternatives) ----------
  const loadAlternatives = async (key: string, more = false) => {
    if (!editor) return;
    const t = targetOf(key);
    if (!t) return;
    const isParagraph = !t.phrase;
    const prev = alt?.key === key ? alt : null;
    const ctx = contextOf(key);
    const base: AltPanel = {
      key,
      loading: true,
      error: null,
      scope: prev?.scope ?? (isParagraph ? 'paragraph' : 'phrase'),
      phrase: ctx?.phrase ?? t.phrase ?? '',
      options: more && prev ? prev.options : [],
      drafts: more && prev ? prev.drafts : [],
      shown: more && prev ? prev.shown : [],
    };
    setAlt(base);
    if (!ctx) {
      setAlt({ ...base, loading: false, error: 'This passage has changed — run Review again.' });
      return;
    }
    try {
      const res = await fetch('/api/alternatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: t.def.category,
          heading: t.def.heading,
          desc: t.def.desc,
          phrase: ctx.phrase,
          sentence: ctx.sentence,
          paragraph: ctx.paragraph,
          target: isParagraph ? 'paragraph' : 'passage',
          avoid: more ? base.shown : [],
        }),
      });
      if (!res.ok) throw new Error('Iterate request failed');
      const data = (await res.json()) as { scope: AltPanel['scope']; options: string[] };
      setAlt((a) =>
        a && a.key === key
          ? {
              ...a,
              loading: false,
              scope: data.scope,
              options: data.options,
              drafts: [...data.options],
              shown: [...a.shown, ...data.options],
            }
          : a
      );
    } catch (err) {
      console.error('Alternatives failed', err);
      setAlt((a) => (a && a.key === key ? { ...a, loading: false, error: "Couldn't load options — try again." } : a));
    }
  };

  const toggleAlternatives = (key: string) => {
    const parentId = parentIdOf(key);
    setActiveId(parentId);
    if (key !== parentId) setActiveInstanceId(key);
    scrollToSuggestion(parentId, key !== parentId ? key : null);
    if (alt?.key === key) setAlt(null);
    else void loadAlternatives(key);
  };

  // Drops the chosen (possibly edited) option into the draft in place of the
  // flagged passage or its sentence, then closes the suggestion as done.
  const applyAlternative = (key: string, text: string) => {
    if (!editor || !alt || !text.trim()) return;
    const ctx = contextOf(key);
    if (!ctx) {
      setAlt({ ...alt, error: 'This passage has changed — run Review again.' });
      return;
    }
    const range = alt.scope === 'phrase' ? ctx.phraseRange : ctx.sentenceRange;
    const value = text.trim();
    const tr = editor.state.tr.insertText(value, range.from, range.to);
    editor.view.dispatch(tr);
    editor.chain().focus().setTextSelection(range.from + value.length).run();
    void markDone(key);
  };

  const renderAltPanel = (key: string) => {
    if (!alt || alt.key !== key) return null;
    return (
      <div className="alt-panel" onClick={(e) => e.stopPropagation()}>
        <div className="alt-label">
          {alt.loading && !alt.options.length
            ? 'Finding options…'
            : alt.scope === 'paragraph'
              ? 'Rewrites the paragraph'
              : alt.scope === 'sentence'
                ? 'Rewrites the sentence'
                : <>Replaces &ldquo;{alt.phrase}&rdquo;</>}
        </div>
        {alt.loading && !alt.options.length && (
          <div className="alt-skeleton">
            <span />
            <span />
            <span />
          </div>
        )}
        {alt.drafts.map((d, i) => {
          const edited = d !== alt.options[i];
          return (
            <div key={`${alt.shown.length}-${i}`} className={`alt-option${edited ? ' edited' : ''}`}>
              <AutoTextarea
                className="alt-text"
                value={d}
                onChange={(v) => setAlt((a) => (a ? { ...a, drafts: a.drafts.map((x, j) => (j === i ? v : x)) } : a))}
              />
              <div className="alt-option-actions">
                {edited && (
                  <button
                    className="alt-link"
                    onClick={() => setAlt((a) => (a ? { ...a, drafts: a.drafts.map((x, j) => (j === i ? a.options[i] : x)) } : a))}
                  >
                    Reset
                  </button>
                )}
                <button
                  className={`action-btn${edited ? ' action-btn-primary' : ''}`}
                  disabled={!d.trim()}
                  onClick={() => applyAlternative(key, d)}
                >
                  {edited ? 'Use edited' : 'Use this'}
                </button>
              </div>
            </div>
          );
        })}
        {alt.error && <p className="alt-error">{alt.error}</p>}
        <div className="alt-footer">
          {alt.options.length > 0 && (
            <button className="alt-link" disabled={alt.loading} onClick={() => void loadAlternatives(key, true)}>
              {alt.loading ? 'Loading…' : 'More options'}
            </button>
          )}
          {alt.error && !alt.options.length && (
            <button className="alt-link" onClick={() => void loadAlternatives(key)}>
              Try again
            </button>
          )}
          <button className="alt-link" onClick={() => setAlt(null)}>
            Close
          </button>
        </div>
      </div>
    );
  };

  // ---------- Patterns: drill-in ----------
  const openDrill = (def: SuggestionDef, instanceId?: string) => {
    const first = instanceId ?? def.instances?.[0]?.id ?? null;
    setDrillId(def.id);
    setActiveId(def.id);
    setActiveInstanceId(first);
    setAlt(null);
    if (first) scrollToSuggestion(def.id, first);
  };

  const selectInstance = (parentId: string, instanceId: string) => {
    setActiveId(parentId);
    setActiveInstanceId(instanceId);
    if (alt && alt.key !== instanceId) setAlt(null);
    scrollToSuggestion(parentId, instanceId);
  };

  const runReview = async () => {
    if (!editor) return;
    setReviewing(true);
    setToast(null);

    const doc = editor.state.doc;
    const blocks = getTopLevelBlocks(doc);
    const { text: fullText, map } = buildFullText(blocks);

    // 1. Locally re-validate every currently-open suggestion against the
    // live doc — a phrase that's gone, or a pacing paragraph that's been
    // trimmed, auto-resolves as "done" without another Claude call.
    const nextDoneIds = [...suggestionState.doneIds];
    const stillOpenIds: string[] = [];
    const autoResolved: { id: string; category: SuggestionCategory }[] = [];

    for (const id of openIds) {
      const def = suggestionState.allSuggestions[id];
      if (!def) continue;
      let resolved = false;

      if (def.kind === 'phrase' && def.phrase) {
        const found = locatePhrase(fullText, map, def.phrase, def.occurrence ?? 1);
        resolved = !found;
      } else if (def.kind === 'pattern') {
        // Each instance that's no longer in the text resolves on its own;
        // the pattern resolves once none are left open.
        let anyOpen = false;
        for (const inst of def.instances ?? []) {
          if (nextDoneIds.includes(inst.id) || suggestionState.dismissedIds.includes(inst.id)) continue;
          if (locatePhrase(fullText, map, inst.phrase, inst.occurrence)) anyOpen = true;
          else nextDoneIds.push(inst.id);
        }
        resolved = !anyOpen;
      } else if (def.kind === 'flag' && typeof def.blockIndex === 'number') {
        const block = blocks[def.blockIndex];
        const baseline = suggestionState.originalWordCount[id];
        if (!block) {
          resolved = true;
        } else if (baseline) {
          resolved = wordCount(block.node.textContent) < baseline * 0.85;
        }
      }

      if (resolved) {
        nextDoneIds.push(id);
        autoResolved.push({ id, category: def.category });
      } else {
        stillOpenIds.push(id);
      }
    }

    const existing = stillOpenIds
      .map((id) => suggestionState.allSuggestions[id])
      .filter((s): s is SuggestionDef => Boolean(s))
      .map((s) => ({
        category: s.category,
        phrase: s.phrase,
        blockIndex: s.blockIndex,
        instances: s.kind === 'pattern' ? (s.instances ?? []).filter((i) => !nextDoneIds.includes(i.id)).map((i) => i.phrase) : undefined,
      }));

    const paragraphs = blocks.map((b) => b.node.textContent);

    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: entry.id, title: titleRef.current, paragraphs, existing }),
      });
      if (!res.ok) throw new Error('Review request failed');
      const { suggestions, entities } = (await res.json()) as {
        suggestions: RawSuggestionWithId[];
        entities?: ExtractedEntity[];
      };

      const allSuggestions = { ...suggestionState.allSuggestions };
      const originalText = { ...suggestionState.originalText };
      const originalWordCount = { ...suggestionState.originalWordCount };
      const revealed = [...suggestionState.revealedIds];
      const addedIds: string[] = [];

      for (const raw of suggestions) {
        let instances: SuggestionDef['instances'];
        if (raw.kind === 'pattern') {
          instances = (raw.instances ?? [])
            .filter((inst) => locatePhrase(fullText, map, inst.phrase, inst.occurrence ?? 1))
            .map((inst, n) => ({ id: `${raw.id}.${n}`, phrase: inst.phrase, occurrence: inst.occurrence ?? 1 }));
          if (!instances.length) continue;
        } else if (raw.kind === 'phrase') {
          if (!raw.phrase) continue;
          const found = locatePhrase(fullText, map, raw.phrase, raw.occurrence ?? 1);
          if (!found) continue;
          originalText[raw.id] = raw.phrase;
        } else {
          if (typeof raw.blockIndex !== 'number' || !blocks[raw.blockIndex]) continue;
          originalWordCount[raw.id] = wordCount(blocks[raw.blockIndex].node.textContent);
        }
        allSuggestions[raw.id] = {
          id: raw.id,
          category: raw.category,
          kind: raw.kind,
          heading: raw.heading,
          desc: raw.desc,
          phrase: raw.phrase,
          occurrence: raw.occurrence,
          blockIndex: raw.blockIndex,
          instances,
          praise: raw.praise || undefined,
        };
        revealed.push(raw.id);
        addedIds.push(raw.id);
      }

      const nextState: SuggestionState = {
        revealedIds: revealed,
        doneIds: nextDoneIds,
        dismissedIds: suggestionState.dismissedIds,
        roundIndex: suggestionState.roundIndex + 1,
        originalText,
        originalWordCount,
        allSuggestions,
      };

      setSuggestionState(nextState);
      setNewIds(new Set(addedIds));

      const suggestionMsg = addedIds.length
        ? `${addedIds.length} new suggestion${addedIds.length === 1 ? '' : 's'}`
        : 'All clear — nothing new to flag';
      const entityMsg = entities?.length
        ? ` · ${entities.length} outline detail${entities.length === 1 ? '' : 's'} synced`
        : '';
      setToast(suggestionMsg + entityMsg);

      await saveSuggestionState(entry.id, nextState);
      for (const f of autoResolved) {
        void recordSuggestionFeedback(entry.id, f.id, f.category, 'done');
      }
      if (entities?.length) {
        void syncExtractedEntities(subjectId, entities);
      }
    } catch (err) {
      console.error('Review failed', err);
      setToast('Review failed — try again');
    } finally {
      setReviewing(false);
    }
  };

  const readingTime = Math.max(1, Math.round(liveWordCount / 200));

  // Ask mode widens the rail so answers have room to breathe.
  const askRailStyle = askOpen && railOpen ? ({ '--rail-width': '380px' } as React.CSSProperties) : undefined;
  const askKindLabel: AskKindLabel = sectionType === 'threads' ? 'Thread' : sectionType === 'chapters' ? 'Chapter' : 'Note';

  // Back link → this entry's list on the Outline, saving any pending edit first.
  const backHref = `/subjects/${subjectId}?tab=${sectionType === 'threads' ? 'threads' : 'chapters'}`;
  const goBack = async () => {
    if (saveTimer.current && editor) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await doSave(editor).catch(() => {});
    }
    router.push(backHref);
  };

  return (
    <>
      <TopNav
        subjectTitle={subjectTitle}
        backHref={backHref}
        onBack={() => void goBack()}
        mode="hover"
        crumb={`${crumbPrefix} – ${title || 'Untitled'}`}
        onSelectTab={goToProjectTab}
        right={
          <>
            <TextSizeControl />
            <button className="icon-btn" title="Search this project" onClick={() => setSearchOpen(true)}>
              <SearchIcon />
            </button>
            <ThemeToggle />
            <button
              className={`icon-btn notes-toggle${railOpen ? ' active' : ''}`}
              title={railOpen ? 'Hide notes' : 'Show notes'}
              aria-pressed={railOpen}
              onClick={() => setRailOpen((v) => !v)}
            >
              <MessageSquareIcon />
            </button>
          </>
        }
      />
      <main className={`editor-area${railOpen ? ' notes-open' : ''}`} style={askRailStyle}>
        <div className="editor-scroll" ref={editorContainerRef}>
          <div
            className={`editor-column${activeId ? ' is-focusing' : ''}`}
            onMouseDown={(e) => {
              // Clicking anywhere in the draft except a flagged passage leaves focus mode.
              if (activeId && !(e.target as HTMLElement).closest('[data-sug], .focus-block')) clearFocus();
            }}
          >
            <input
              className="doc-title"
              value={title}
              placeholder="Untitled"
              onChange={(e) => handleTitleChange(e.target.value)}
            />
            <EditorContent editor={editor} />
          </div>
          {selectionBubble && (
            <button
              className="ask-bubble-btn"
              style={{ position: 'absolute', top: selectionBubble.top, left: selectionBubble.left }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => askAboutSelection(selectionBubble.text)}
            >
              Ask about this
            </button>
          )}
        </div>
        <button className={`review-btn review-btn-float${reviewing ? ' loading' : ''}`} onClick={runReview} disabled={reviewing}>
          <span className="icon">✦</span>
          {reviewing ? 'Reviewing…' : 'Review'}
        </button>
        {toast && <div className="review-toast">{toast}</div>}
        <div className="statusbar">
          <span>
            {liveWordCount} words · {readingTime} min read
          </span>
          <span className="status-sep">·</span>
          <span>{saveStatus === 'saving' ? 'Saving…' : 'Saved'}</span>
        </div>
      </main>

      {railOpen && (
        <aside className={`rail${askOpen ? ' ask-mode' : ''}`} style={askRailStyle}>
          {!askOpen && (
          <div className="rail-inner" ref={railRef}>
            {drillDef ? (
              (() => {
                const all = suggestionState.allSuggestions[drillDef.id]?.instances ?? [];
                const open = drillDef.instances ?? [];
                const idx = open.findIndex((i) => i.id === activeInstanceId);
                const step = (dir: 1 | -1) => {
                  if (!open.length) return;
                  const next = open[(Math.max(idx, 0) + dir + open.length) % open.length];
                  selectInstance(drillDef.id, next.id);
                };
                return (
                  <div className="rail-drill">
                    <button className="drill-back" onClick={() => { setDrillId(null); setActiveInstanceId(null); setAlt(null); }}>
                      <span aria-hidden>‹</span> All notes
                    </button>
                    <div className="drill-head">
                      <div className="head">
                        <span className="dot" style={{ background: CATEGORY_COLOR_VAR[drillDef.category] }} />
                        <span className="heading">{drillDef.heading}</span>
                      </div>
                      <p className="desc">{drillDef.desc}</p>
                    </div>
                    <div className="drill-stepper">
                      <span>
                        {idx >= 0 ? `${idx + 1} of ${open.length}` : `${open.length} open`}
                        {all.length > open.length ? ` · ${all.length - open.length} handled` : ''}
                      </span>
                      <span className="drill-stepper-btns">
                        <button className="icon-btn" aria-label="Previous instance" onClick={() => step(-1)}>‹</button>
                        <button className="icon-btn" aria-label="Next instance" onClick={() => step(1)}>›</button>
                      </span>
                    </div>
                    <div className="instance-list">
                      {open.map((inst) => {
                        const n = all.findIndex((a) => a.id === inst.id) + 1;
                        const isActive = inst.id === activeInstanceId;
                        return (
                          <div
                            key={inst.id}
                            data-inst-row={inst.id}
                            className={`instance-item${isActive ? ' active-item' : ''}`}
                            onClick={() => selectInstance(drillDef.id, inst.id)}
                          >
                            <span className="instance-num">{n}</span>
                            <div className="instance-body">
                              <p className="instance-text">{inst.phrase}</p>
                              {isActive && (
                                <>
                                  <div className="actions">
                                    <button
                                      className={`action-btn${alt?.key === inst.id ? ' is-on' : ''}`}
                                      onClick={(e) => { e.stopPropagation(); toggleAlternatives(inst.id); }}
                                    >
                                      Iterate
                                    </button>
                                    <button className="action-btn" onClick={(e) => { e.stopPropagation(); void markDone(inst.id); }}>
                                      Done
                                    </button>
                                    <button className="action-btn" onClick={(e) => { e.stopPropagation(); void dismiss(inst.id); }}>
                                      Leave as is
                                    </button>
                                  </div>
                                  {renderAltPanel(inst.id)}
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="drill-footer">
                      <button className="action-btn" onClick={() => void markDone(drillDef.id)}>Done with all</button>
                      <button
                        className="action-btn"
                        title="You'll see fewer notes like this"
                        onClick={() => void dismiss(drillDef.id)}
                      >
                        Dismiss pattern
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : orderedSuggestions.length === 0 ? (
              <p className="rail-empty">Click Review to get feedback on this piece.</p>
            ) : (
              orderedSuggestions.map((s, i) => {
                const isPattern = s.kind === 'pattern';
                const count = s.instances?.length ?? 0;
                const altOpen = alt?.key === s.id;
                return (
                  <div
                    key={s.id}
                    data-rail-id={s.id}
                    style={{ animationDelay: `${i * 70}ms` }}
                    className={`suggestion-item${activeId === s.id ? ' active-item' : ''}${altOpen ? ' expanded' : ''}${
                      isPattern ? ' is-pattern' : ''
                    }${s.praise ? ' is-praise' : ''}`}
                    onClick={() => {
                      if (isPattern) {
                        openDrill(s);
                        return;
                      }
                      if (activeId === s.id && !altOpen) {
                        clearFocus();
                        return;
                      }
                      setActiveId(s.id);
                      setActiveInstanceId(null);
                      scrollToSuggestion(s.id);
                    }}
                  >
                    <div className="head">
                      <span className="dot" style={{ background: CATEGORY_COLOR_VAR[s.category] }} />
                      <span className="heading">{s.heading}</span>
                      {newIds.has(s.id) && <span className="new-badge">New</span>}
                    </div>
                    <p className="desc">{s.desc}</p>
                    {isPattern ? (
                      <div className="pattern-row">
                        <span className="pattern-count">
                          {count} {count === 1 ? 'instance' : 'instances'}
                        </span>
                        <span className="pattern-open">
                          Review each <span aria-hidden>›</span>
                        </span>
                      </div>
                    ) : (
                      <div className="actions">
                        {s.praise ? (
                          <button
                            className="action-btn"
                            title="Glad it landed — keep these coming"
                            onClick={(e) => {
                              e.stopPropagation();
                              void markDone(s.id);
                            }}
                          >
                            Thanks
                          </button>
                        ) : (
                          <>
                            <button
                              className={`action-btn${altOpen ? ' is-on' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleAlternatives(s.id);
                              }}
                            >
                              Iterate
                            </button>
                            <button
                              className="action-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                void markDone(s.id);
                              }}
                            >
                              Done
                            </button>
                          </>
                        )}
                        <button
                          className="action-btn"
                          title="You'll see fewer notes like this"
                          onClick={(e) => {
                            e.stopPropagation();
                            void dismiss(s.id);
                          }}
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                    {renderAltPanel(s.id)}
                  </div>
                );
              })
            )}
          </div>
          )}
          <AskPanel
            subjectId={subjectId}
            target={{ kind: 'entry', id: entry.id }}
            targetName={title || 'Untitled'}
            kindLabel={askKindLabel}
            variant="rail"
            expanded={askOpen}
            onExpandedChange={(open) => {
              setAskOpen(open);
              if (open) clearFocus();
            }}
            quote={askQuote}
            onQuoteChange={setAskQuote}
          />
        </aside>
      )}

      {searchOpen && (
        <ProjectSearch subjectId={subjectId} onClose={closeSearch} onSelect={goToSearchResult} />
      )}
    </>
  );
}
