import type { createClient } from '@/lib/supabase/server';
import type { AskTarget } from '@/lib/types';

type Supabase = ReturnType<typeof createClient>;

// Rough cap on how much chapter prose goes into one Ask call. Keeps answers
// fast enough for the 30s function limit (and the cost sane) while still
// covering a long manuscript; chapters past the cap go in as synopses only.
const CHAPTER_TEXT_BUDGET = 100_000;

export interface StoryContext {
  /** Everything the model should know about the story, as one text block. */
  text: string;
  /** Human label for the piece being asked about, e.g. `Thread "The ferry ledger"`. */
  targetLabel: string;
  /** Short label for the UI chip, e.g. "The ferry ledger". */
  targetName: string;
}

const clean = (s: string | null | undefined) => (s ?? '').trim();
const field = (label: string, value: string | null | undefined) => (clean(value) ? `${label}: ${clean(value)}` : null);

// Assembles the story as the AI should see it for an Ask question: the story
// summary, chapters (full text up to a budget), characters and places — the
// "real" story. Threads are left out (they're ideas, not yet part of the
// story) unless includeThreads is set; a thread being asked about is always
// included as the focus piece.
export async function buildStoryContext(
  supabase: Supabase,
  subjectId: string,
  target: AskTarget,
  includeThreads: boolean
): Promise<StoryContext | null> {
  const [{ data: subject }, { data: sections }, { data: characters }, { data: places }] = await Promise.all([
    supabase.from('subjects').select('id, title, premise, themes, takeaway').eq('id', subjectId).single(),
    supabase.from('sections').select('id, type').eq('subject_id', subjectId),
    supabase
      .from('characters')
      .select('id, name, role, summary, is_main, aliases, themes, arc_start, arc_turn, arc_end')
      .eq('subject_id', subjectId)
      .order('position'),
    supabase
      .from('places')
      .select('id, name, summary, is_key, aliases, history, significance')
      .eq('subject_id', subjectId)
      .order('position'),
  ]);
  if (!subject) return null;

  const chaptersSectionId = sections?.find((s) => s.type === 'chapters')?.id;
  const threadsSectionId = sections?.find((s) => s.type === 'threads')?.id;

  type EntryLite = { id: string; title: string; synopsis: string; target_feeling: string; content_text: string; section_id: string };
  const entryCols = 'id, title, synopsis, target_feeling, content_text, section_id';
  const [{ data: chapters }, { data: threads }] = await Promise.all([
    chaptersSectionId
      ? supabase.from('entries').select(entryCols).eq('section_id', chaptersSectionId).is('parent_entry_id', null).order('position')
      : Promise.resolve({ data: [] as EntryLite[] }),
    threadsSectionId
      ? supabase.from('entries').select(entryCols).eq('section_id', threadsSectionId).is('parent_entry_id', null).order('position')
      : Promise.resolve({ data: [] as EntryLite[] }),
  ]);
  const chapterList = (chapters ?? []) as EntryLite[];
  const threadList = (threads ?? []) as EntryLite[];

  // ---------- the focus piece ----------
  let focus = '';
  let targetLabel = 'the story as a whole';
  let targetName = subject.title || 'Whole story';
  let focusChapterId: string | null = null;

  if (target.kind === 'entry' && target.id) {
    let entry: EntryLite | undefined =
      chapterList.find((c) => c.id === target.id) ?? threadList.find((t) => t.id === target.id);
    if (!entry) {
      // Research / custom entries, or anything not top-level.
      const { data } = await supabase.from('entries').select(entryCols).eq('id', target.id).single();
      entry = (data as EntryLite | null) ?? undefined;
    }
    if (entry) {
      const isChapter = chapterList.some((c) => c.id === entry!.id);
      const isThread = threadList.some((t) => t.id === entry!.id);
      const n = chapterList.findIndex((c) => c.id === entry!.id) + 1;
      const kind = isChapter ? `Chapter ${n}` : isThread ? 'Thread' : 'Note';
      targetName = entry.title || 'Untitled';
      targetLabel = `${kind} "${targetName}"`;
      if (isChapter) focusChapterId = entry.id;
      focus = [
        `${kind}: ${targetName}`,
        isThread ? '(A thread is an idea, scene or fragment the writer is developing — not yet part of the story.)' : null,
        field('Synopsis', entry.synopsis),
        field('Intended feeling', entry.target_feeling),
        `Text:\n"""\n${clean(entry.content_text) || '(empty so far)'}\n"""`,
      ]
        .filter(Boolean)
        .join('\n');
    }
  } else if (target.kind === 'character' && target.id) {
    const c = (characters ?? []).find((x) => x.id === target.id);
    if (c) {
      targetName = c.name || 'Unnamed character';
      targetLabel = `the character ${targetName}`;
      focus = `Character: ${targetName} (see their full profile under CHARACTERS below).`;
    }
  } else if (target.kind === 'place' && target.id) {
    const p = (places ?? []).find((x) => x.id === target.id);
    if (p) {
      targetName = p.name || 'Unnamed place';
      targetLabel = `the place ${targetName}`;
      focus = `Place: ${targetName} (see its full profile under PLACES below).`;
    }
  }

  // ---------- the story ----------
  const parts: string[] = [];
  parts.push(
    ['STORY', `Title: ${subject.title || 'Untitled'}`, field('Premise', subject.premise), field('Themes', subject.themes), field('Reader takeaway', subject.takeaway)]
      .filter(Boolean)
      .join('\n')
  );

  let budget = CHAPTER_TEXT_BUDGET;
  // The focus chapter always goes in full; reserve its share first.
  const focusChapter = chapterList.find((c) => c.id === focusChapterId);
  if (focusChapter) budget -= clean(focusChapter.content_text).length;
  const chapterBlocks = chapterList.map((c, i) => {
    const text = clean(c.content_text);
    const isFocus = c.id === focusChapterId;
    const fits = isFocus || (text.length > 0 && text.length <= budget);
    if (fits && !isFocus) budget -= text.length;
    return [
      `## Chapter ${i + 1}: ${c.title || 'Untitled'}${isFocus ? '  ← the piece being asked about' : ''}`,
      field('Synopsis', c.synopsis),
      field('Intended feeling', c.target_feeling),
      text ? (fits ? `"""\n${text}\n"""` : '(Full text omitted for length — use the synopsis.)') : '(No text yet.)',
    ]
      .filter(Boolean)
      .join('\n');
  });
  parts.push(chapterBlocks.length ? `CHAPTERS (in order)\n\n${chapterBlocks.join('\n\n')}` : 'CHAPTERS\n(none yet)');

  const charBlocks = (characters ?? []).map((c) =>
    [
      `## ${c.name}${c.role ? ` — ${c.role}` : ''}${c.is_main ? ' (main)' : ''}${c.id === target.id ? '  ← the piece being asked about' : ''}`,
      c.aliases?.length ? `Also called: ${c.aliases.join(', ')}` : null,
      field('Background', c.summary),
      field('Themes', c.themes),
      field('Arc — start', c.arc_start),
      field('Arc — turn', c.arc_turn),
      field('Arc — end', c.arc_end),
    ]
      .filter(Boolean)
      .join('\n')
  );
  parts.push(charBlocks.length ? `CHARACTERS\n\n${charBlocks.join('\n\n')}` : 'CHARACTERS\n(none yet)');

  const placeBlocks = (places ?? []).map((p) =>
    [
      `## ${p.name}${p.is_key ? ' (key place)' : ''}${p.id === target.id ? '  ← the piece being asked about' : ''}`,
      p.aliases?.length ? `Also called: ${p.aliases.join(', ')}` : null,
      field('Description', p.summary),
      field('History', p.history),
      field('Significance', p.significance),
    ]
      .filter(Boolean)
      .join('\n')
  );
  parts.push(placeBlocks.length ? `PLACES\n\n${placeBlocks.join('\n\n')}` : 'PLACES\n(none yet)');

  if (includeThreads) {
    const others = threadList.filter((t) => t.id !== target.id);
    if (others.length) {
      parts.push(
        `OTHER THREADS (ideas the writer is developing — not yet part of the story)\n\n${others
          .map((t) => `## ${t.title || 'Untitled'}\n${clean(t.content_text).slice(0, 4000) || '(empty)'}`)
          .join('\n\n')}`
      );
    }
  }

  if (focus) parts.unshift(`THE PIECE THE WRITER IS ASKING ABOUT\n\n${focus}`);

  return { text: parts.join('\n\n---\n\n'), targetLabel, targetName };
}
