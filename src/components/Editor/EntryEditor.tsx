'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import ThemeToggle from '@/components/ThemeToggle';
import {
  SuggestionHighlight,
  setSuggestionDecorations,
  getTopLevelBlocks,
  buildFullText,
  locatePhrase,
  type VisibleSuggestion,
} from './suggestionExtension';
import { saveEntry, saveSuggestionState, recordSuggestionFeedback } from '@/app/subjects/[subjectId]/entries/[entryId]/actions';
import { syncExtractedEntities } from '@/app/subjects/[subjectId]/outline/actions';
import type { ExtractedEntity } from '@/lib/claude';
import { docToMarkdown } from '@/lib/markdown';
import type { AdviceMessage, Entry, SuggestionCategory, SuggestionDef, SuggestionState } from '@/lib/types';

interface Props {
  subjectId: string;
  entry: Entry;
}

interface RawSuggestionWithId {
  id: string;
  category: SuggestionCategory;
  kind: 'phrase' | 'flag';
  phrase?: string;
  occurrence?: number;
  blockIndex?: number;
  heading: string;
  desc: string;
}

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

export default function EntryEditor({ subjectId, entry }: Props) {
  const [title, setTitle] = useState(entry.title);
  const titleRef = useRef(entry.title);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  const [suggestionState, setSuggestionState] = useState<SuggestionState>(entry.suggestion_state);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
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
  const [adviceOpen, setAdviceOpen] = useState(false);
  const [adviceSelectedText, setAdviceSelectedText] = useState('');
  const [adviceThreadId, setAdviceThreadId] = useState<string | null>(null);
  const [adviceMessages, setAdviceMessages] = useState<AdviceMessage[]>([]);
  const [adviceInput, setAdviceInput] = useState('');
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const adviceThreadRef = useRef<HTMLDivElement | null>(null);
  const onSuggestionClickRef = useRef<(id: string) => void>(() => {});

  const scrollToSuggestion = useCallback((id: string) => {
    const el = editorContainerRef.current?.querySelector(`[data-sug="${id}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  useEffect(() => {
    onSuggestionClickRef.current = (id: string) => {
      setActiveId(id);
      const railEl = railRef.current?.querySelector(`[data-rail-id="${id}"]`);
      railEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  }, []);

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

  const openAdvice = (text: string) => {
    setSelectionBubble(null);
    setAdviceSelectedText(text);
    setAdviceThreadId(null);
    setAdviceMessages([]);
    setAdviceInput('');
    setAdviceError(null);
    setAdviceOpen(true);
  };

  useEffect(() => {
    if (adviceOpen) adviceThreadRef.current?.scrollTo({ top: adviceThreadRef.current.scrollHeight });
  }, [adviceMessages, adviceOpen, adviceLoading]);

  const submitAdviceMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = adviceInput.trim();
    if (!message || adviceLoading) return;
    setAdviceInput('');
    setAdviceError(null);
    setAdviceMessages((prev) => [...prev, { role: 'user', content: message, created_at: new Date().toISOString() }]);
    setAdviceLoading(true);
    try {
      const res = await fetch('/api/advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryId: entry.id,
          entryTitle: titleRef.current,
          selectedText: adviceSelectedText,
          threadId: adviceThreadId,
          message,
        }),
      });
      if (!res.ok) throw new Error('Advice request failed');
      const data = (await res.json()) as { threadId: string; messages: AdviceMessage[] };
      setAdviceThreadId(data.threadId);
      setAdviceMessages(data.messages);
    } catch (err) {
      console.error('Advice failed', err);
      setAdviceError('Something went wrong — try again.');
    } finally {
      setAdviceLoading(false);
    }
  };

  // Suggestion decorations follow the plugin's own position-mapping across
  // edits; we only need to push a fresh decoration set when the suggestion
  // list itself (or the active/highlighted one) changes.
  const openIds = useMemo(
    () =>
      suggestionState.revealedIds.filter(
        (id) => !suggestionState.doneIds.includes(id) && !suggestionState.dismissedIds.includes(id)
      ),
    [suggestionState]
  );

  const orderedSuggestions: SuggestionDef[] = useMemo(
    () =>
      [...openIds]
        .reverse()
        .map((id) => suggestionState.allSuggestions[id])
        .filter((s): s is SuggestionDef => Boolean(s)),
    [openIds, suggestionState.allSuggestions]
  );

  const visibleSuggestions: VisibleSuggestion[] = orderedSuggestions;

  useEffect(() => {
    if (!editor) return;
    setSuggestionDecorations(editor, visibleSuggestions, activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, visibleSuggestions, activeId]);

  useEffect(() => {
    if (!toast) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [toast]);

  const markDone = async (id: string) => {
    const def = suggestionState.allSuggestions[id];
    const nextState: SuggestionState = { ...suggestionState, doneIds: [...suggestionState.doneIds, id] };
    setSuggestionState(nextState);
    setEditingIds((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    if (activeId === id) setActiveId(null);
    await saveSuggestionState(entry.id, nextState);
    if (def) void recordSuggestionFeedback(entry.id, id, def.category, 'done');
  };

  const dismiss = async (id: string) => {
    const def = suggestionState.allSuggestions[id];
    const nextState: SuggestionState = { ...suggestionState, dismissedIds: [...suggestionState.dismissedIds, id] };
    setSuggestionState(nextState);
    if (activeId === id) setActiveId(null);
    await saveSuggestionState(entry.id, nextState);
    if (def) void recordSuggestionFeedback(entry.id, id, def.category, 'dismissed');
  };

  const toggleEditing = (id: string) => {
    setActiveId(id);
    setEditingIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    scrollToSuggestion(id);
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
      .map((s) => ({ category: s.category, phrase: s.phrase, blockIndex: s.blockIndex }));

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
        if (raw.kind === 'phrase') {
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

  const exportMarkdown = () => {
    if (!editor) return;
    const heading = titleRef.current.trim() || 'Untitled';
    const markdown = `# ${heading}\n\n${docToMarkdown(editor.getJSON())}`;
    const filename =
      heading
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'untitled';

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const readingTime = Math.max(1, Math.round(liveWordCount / 200));

  return (
    <>
      <main className="editor-area">
        <header className="topbar">
          <div className="breadcrumb">Editing</div>
          <div className="topbar-right">
            <span className="meta">
              {liveWordCount} words · {readingTime} min read
            </span>
            <ThemeToggle />
            <button className="icon-btn" title="Export as Markdown" onClick={exportMarkdown}>
              ⬇
            </button>
            <button
              className={`icon-btn${railOpen ? ' active' : ''}`}
              title="Toggle suggestions"
              onClick={() => setRailOpen((v) => !v)}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <rect x="9.8" y="3.15" width="4.35" height="9.7" rx="0.5" fill="currentColor" />
              </svg>
            </button>
          </div>
        </header>
        <div className="editor-scroll" ref={editorContainerRef}>
          <div className="editor-column">
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
              onClick={() => openAdvice(selectionBubble.text)}
            >
              Ask about this
            </button>
          )}
        </div>
        <button className={`review-btn${reviewing ? ' loading' : ''}`} onClick={runReview} disabled={reviewing}>
          <span className="icon">✦</span>
          {reviewing ? 'Reviewing…' : 'Review'}
        </button>
        {toast && <div className="review-toast">{toast}</div>}
        <div className="statusbar">{saveStatus === 'saving' ? 'Saving…' : 'Saved'}</div>
      </main>

      {railOpen && (
        <aside className="rail">
          <div className="rail-header">NOTES</div>
          <div className="rail-inner" ref={railRef}>
            {orderedSuggestions.length === 0 ? (
              <p className="rail-empty">Click Review to get feedback on this piece.</p>
            ) : (
              orderedSuggestions.map((s) => (
                <div
                  key={s.id}
                  data-rail-id={s.id}
                  className={`suggestion-item${activeId === s.id ? ' active-item' : ''}${
                    editingIds.has(s.id) ? ' editing' : ''
                  }`}
                  onClick={() => {
                    setActiveId(s.id);
                    scrollToSuggestion(s.id);
                  }}
                >
                  <div className="head">
                    <span className="dot" style={{ background: CATEGORY_COLOR_VAR[s.category] }} />
                    <span className="heading">{s.heading}</span>
                    {newIds.has(s.id) && <span className="new-badge">New</span>}
                  </div>
                  <p className="desc">{s.desc}</p>
                  <div className="actions">
                    <button
                      className="action-btn edit-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleEditing(s.id);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="action-btn done-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void markDone(s.id);
                      }}
                    >
                      Done
                    </button>
                    <button
                      className="action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void dismiss(s.id);
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      {adviceOpen && (
        <div className="advice-overlay" onClick={() => setAdviceOpen(false)}>
          <div className="advice-panel" onClick={(e) => e.stopPropagation()}>
            <div className="advice-header">
              <span>Ask about this</span>
              <button className="icon-btn" onClick={() => setAdviceOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="advice-selected">&ldquo;{adviceSelectedText}&rdquo;</div>
            <div className="advice-thread" ref={adviceThreadRef}>
              {adviceMessages.length === 0 && !adviceLoading && (
                <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                  Ask anything about this passage — word choice, whether it lands, how to tighten it.
                </p>
              )}
              {adviceMessages.map((m, i) => (
                <div key={i} className={`advice-msg ${m.role}`}>
                  <div className="role-label">{m.role === 'user' ? 'You' : 'Storyright'}</div>
                  <div>{m.content}</div>
                </div>
              ))}
              {adviceLoading && (
                <div className="advice-msg assistant">
                  <div className="role-label">Storyright</div>
                  <div style={{ color: 'var(--text-tertiary)' }}>Thinking…</div>
                </div>
              )}
              {adviceError && (
                <p style={{ color: 'var(--sug-tone)', fontSize: 12.5 }}>{adviceError}</p>
              )}
            </div>
            <form className="advice-input-row" onSubmit={submitAdviceMessage}>
              <input
                value={adviceInput}
                onChange={(e) => setAdviceInput(e.target.value)}
                placeholder="Ask a question…"
                disabled={adviceLoading}
                autoFocus
              />
              <button
                type="submit"
                className="primary-btn"
                style={{ padding: '8px 14px', fontSize: 13 }}
                disabled={adviceLoading || !adviceInput.trim()}
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
