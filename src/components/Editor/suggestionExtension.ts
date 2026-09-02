import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import type { SuggestionCategory } from '@/lib/types';

export const suggestionPluginKey = new PluginKey<DecorationSet>('storyrightSuggestions');

// The subset of a SuggestionDef the extension needs to render/locate a
// suggestion. Kept separate from SuggestionDef so this file doesn't need to
// know about done/dismissed bookkeeping — the caller filters that first.
export interface VisibleSuggestion {
  id: string;
  category: SuggestionCategory;
  kind: 'phrase' | 'flag';
  heading: string;
  phrase?: string;
  occurrence?: number;
  blockIndex?: number;
}

export interface BlockInfo {
  node: PMNode;
  pos: number; // position immediately before the block node
  index: number; // 0-based top-level block index (matches blockIndex)
}

// Top-level children of the doc are the addressable "paragraphs" — the same
// units sent to Claude as the numbered paragraphs list and referenced by
// pacing suggestions' blockIndex.
export function getTopLevelBlocks(doc: PMNode): BlockInfo[] {
  const blocks: BlockInfo[] = [];
  doc.forEach((node, offset) => {
    blocks.push({ node, pos: offset, index: blocks.length });
  });
  return blocks;
}

export function getParagraphTexts(doc: PMNode): string[] {
  return getTopLevelBlocks(doc).map((b) => b.node.textContent);
}

interface TextMap {
  text: string;
  // map[i] = absolute ProseMirror position of character i in `text`,
  // or -1 for the synthetic separator inserted between blocks.
  map: number[];
}

// Concatenates every block's plain text (marks don't affect position math —
// only text length does) into one search string, with a position map back
// to ProseMirror coordinates so a phrase match can be turned into a range.
export function buildFullText(blocks: BlockInfo[]): TextMap {
  let text = '';
  const map: number[] = [];
  blocks.forEach((b, i) => {
    if (i > 0) {
      text += '\n\n';
      map.push(-1, -1);
    }
    const t = b.node.textContent;
    for (let c = 0; c < t.length; c++) map.push(b.pos + 1 + c);
    text += t;
  });
  return { text, map };
}

export interface PhraseRange {
  from: number;
  to: number;
}

// Finds the nth occurrence of `phrase` in `text`, skipping any match that
// straddles a block boundary (invalid — a suggestion phrase never spans
// paragraphs). Mirrors the design prototype's occurrence-based lookup.
export function locatePhrase(
  text: string,
  map: number[],
  phrase: string,
  occurrence = 1
): PhraseRange | null {
  if (!phrase) return null;
  let count = 0;
  let searchFrom = 0;
  while (true) {
    const idx = text.indexOf(phrase, searchFrom);
    if (idx === -1) return null;
    searchFrom = idx + 1;

    let crosses = false;
    for (let i = idx; i < idx + phrase.length; i++) {
      if (map[i] === -1) {
        crosses = true;
        break;
      }
    }
    if (crosses) continue;

    count++;
    if (count === occurrence) {
      const from = map[idx];
      const to = map[idx + phrase.length - 1] + 1;
      return { from, to };
    }
  }
}

export function locatePhraseInDoc(doc: PMNode, phrase: string, occurrence = 1): PhraseRange | null {
  const { text, map } = buildFullText(getTopLevelBlocks(doc));
  return locatePhrase(text, map, phrase, occurrence);
}

function buildDecorations(doc: PMNode, suggestions: VisibleSuggestion[], activeId: string | null): DecorationSet {
  const blocks = getTopLevelBlocks(doc);
  const { text, map } = buildFullText(blocks);
  const decorations: Decoration[] = [];

  for (const s of suggestions) {
    const isActive = s.id === activeId;
    if (s.kind === 'phrase' && s.phrase) {
      const range = locatePhrase(text, map, s.phrase, s.occurrence ?? 1);
      if (!range) continue;
      decorations.push(
        Decoration.inline(range.from, range.to, {
          class: `sug-chip${isActive ? ' active' : ''}`,
          'data-sug': s.id,
          'data-tag': s.category,
        })
      );
    } else if (s.kind === 'flag' && typeof s.blockIndex === 'number') {
      const block = blocks[s.blockIndex];
      if (!block) continue;
      decorations.push(
        Decoration.widget(
          block.pos + 1,
          () => {
            const el = document.createElement('span');
            el.className = `para-flag${isActive ? ' active' : ''}`;
            el.setAttribute('data-sug', s.id);
            el.setAttribute('data-tag', s.category);
            el.textContent = s.heading || 'Pacing';
            return el;
          },
          { side: -1, key: `flag-${s.id}-${isActive}` }
        )
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

export function setSuggestionDecorations(
  editor: Editor,
  suggestions: VisibleSuggestion[],
  activeId: string | null
) {
  const decorations = buildDecorations(editor.state.doc, suggestions, activeId);
  const tr = editor.state.tr.setMeta(suggestionPluginKey, decorations);
  editor.view.dispatch(tr);
}

export interface SuggestionHighlightOptions {
  // A ref-like box so the click handler always calls the latest callback,
  // even though the ProseMirror plugin is only constructed once.
  onSuggestionClickRef: { current: (id: string) => void };
}

export const SuggestionHighlight = Extension.create<SuggestionHighlightOptions>({
  name: 'suggestionHighlight',

  addOptions() {
    return {
      onSuggestionClickRef: { current: () => {} },
    };
  },

  addProseMirrorPlugins() {
    const { onSuggestionClickRef } = this.options;
    return [
      new Plugin({
        key: suggestionPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(suggestionPluginKey);
            if (meta) return meta as DecorationSet;
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return suggestionPluginKey.getState(state);
          },
          handleDOMEvents: {
            click(_view, event) {
              const target = (event.target as HTMLElement)?.closest?.('[data-sug]');
              if (target) {
                const id = target.getAttribute('data-sug');
                if (id) {
                  onSuggestionClickRef.current(id);
                  return true;
                }
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
