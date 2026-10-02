// Where a character or place shows up across the chapters.
//
// Exact matches (full name, a character's first name, and any "also known as"
// names) are computed live from the chapter text, so they update as you write.
// Indirect references the AI found on Review ("her father") come from the
// entity_mentions table and fill in chapters with no exact match.

import type { EntityMention } from '@/lib/types';

export interface ChapterLite {
  id: string;
  title: string;
  synopsis: string;
  content_text: string;
}

export interface Appearance {
  chapterId: string;
  index: number; // 0-based chapter position
  title: string;
  named: boolean; // true = exact name/alias match; false = AI reference
  term: string; // the matched name, or the AI's "via" phrase
  count: number;
  snippet: string;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function entityTerms(name: string, aliases: string[] | null | undefined, isCharacter: boolean): string[] {
  const terms: string[] = [];
  const clean = (name || '').trim();
  if (clean) terms.push(clean);
  // First names only for characters ("Mara"); places like "The Keeper's House" match whole.
  const first = clean.split(/\s+/)[0];
  if (isCharacter && first && first !== clean && first.length > 2) terms.push(first);
  (aliases ?? []).forEach((a) => {
    const t = (a || '').trim();
    if (t && !terms.some((x) => x.toLowerCase() === t.toLowerCase())) terms.push(t);
  });
  return terms;
}

export function findAppearances(
  entity: { id: string; name: string; aliases?: string[] | null },
  isCharacter: boolean,
  chapters: ChapterLite[],
  mentions: EntityMention[]
): Appearance[] {
  const terms = entityTerms(entity.name, entity.aliases, isCharacter);
  const out: Appearance[] = [];
  chapters.forEach((ch, index) => {
    const text = [ch.title, ch.synopsis, ch.content_text].filter(Boolean).join('\n');
    let count = 0;
    let hit: string | null = null;
    for (const term of terms) {
      const m = text.match(new RegExp(`\\b${escapeRe(term)}\\b`, 'gi'));
      if (m) {
        count += m.length;
        if (!hit) hit = term;
      }
    }
    if (hit) {
      const sentences = text.split(/(?<=[.!?])\s+|\n+/);
      const snippet = sentences.find((s) => s.toLowerCase().includes(hit!.toLowerCase())) ?? '';
      out.push({ chapterId: ch.id, index, title: ch.title, named: true, term: hit, count, snippet: snippet.trim() });
      return;
    }
    const m = mentions.find((x) => x.entity_id === entity.id && x.entry_id === ch.id);
    if (m) {
      out.push({
        chapterId: ch.id,
        index,
        title: ch.title,
        named: false,
        term: m.via,
        count: m.mention_count,
        snippet: m.snippet,
      });
    }
  });
  return out;
}

/** "Mark as main?" bar: shows up in at least half the chapters (and at least 2). */
export function shouldSuggestPromote(appearanceCount: number, chapterCount: number) {
  return appearanceCount >= Math.max(2, Math.ceil(chapterCount / 2));
}
