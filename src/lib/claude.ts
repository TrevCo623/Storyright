import Anthropic from '@anthropic-ai/sdk';
import type { EntityInsight, EntityInsightCategory, OutlineSuggestionCategory, SuggestionCategory } from '@/lib/types';

let client: Anthropic | null = null;
export function claude() {
  if (!client) {
    // Keys that aren't scoped to a workspace must name one on every request.
    // Set ANTHROPIC_WORKSPACE_ID (Netlify env) to use such a key; a
    // workspace-scoped key needs nothing extra.
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}),
    });
  }
  return client;
}

export const MODEL = 'claude-sonnet-4-5';

export interface RawSuggestion {
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

// A note the writer closed on an earlier Review — used to tune future ones.
export interface FeedbackExample {
  category: SuggestionCategory;
  heading: string;
  desc: string;
  praise?: boolean;
}

// Pulls the first top-level JSON array out of a Claude response, tolerating
// stray prose/markdown fences around it.
export function extractJsonArray(text: string): unknown[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Same tolerant-parsing idea as extractJsonArray, but for a single top-level
// JSON object (used by the Outline Review, which returns {summary, suggestions}).
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const CATEGORY_HEADINGS: Record<SuggestionCategory, string> = {
  word: 'Word choice',
  tone: 'Voice & tone',
  grammar: 'Clarity & grammar',
  pacing: 'Pacing & structure',
  style: 'Style & craft',
};

interface GenerateArgs {
  title: string;
  paragraphs: string[];
  existing: { category: SuggestionCategory; phrase?: string; blockIndex?: number; instances?: string[] }[];
  manifesto?: string | null;
  fingerprintSummary?: string | null;
  // Notes the writer dismissed recently (newest first) — signals of what not to surface.
  dismissed?: FeedbackExample[];
  // How many kudos notes the writer acknowledged with "Thanks" recently.
  praiseThanked?: number;
}

export async function generateSuggestions(args: GenerateArgs): Promise<RawSuggestion[]> {
  const { title, paragraphs, existing, manifesto, fingerprintSummary, dismissed, praiseThanked } = args;
  if (paragraphs.join('').trim().length < 20) return [];

  const numberedParagraphs = paragraphs
    .map((p, i) => `[${i}] ${p}`)
    .join('\n\n');

  const existingList = existing.length
    ? existing
        .map((e) =>
          e.instances?.length
            ? `- ${e.category} (recurring pattern): ${e.instances.map((p) => `"${p}"`).join(', ')}`
            : e.phrase
              ? `- ${e.category}: "${e.phrase}"`
              : `- ${e.category}: paragraph ${e.blockIndex}`
        )
        .join('\n')
    : 'none';

  const personalization = [
    manifesto ? `The writer's stated manifesto/preferences: ${manifesto}` : null,
    fingerprintSummary ? `Their style fingerprint (from past work): ${fingerprintSummary}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  // What the writer has told us by dismissing notes (and by thanking kudos).
  const tuning = [
    dismissed?.length
      ? `Notes this writer DISMISSED on earlier reviews (newest first). Each dismissal means "less of this". Don't surface notes of the same type — the same kind of issue or the same advice — again; if several dismissals share a category or theme, surface fewer notes there overall. Only override this for a clear, objective error (e.g. a genuine grammar mistake).
${dismissed
  .map((d) => `- [${d.category}${d.praise ? ', kudos' : ''}] ${d.heading}: ${d.desc}`)
  .join('\n')}`
      : null,
    praiseThanked
      ? `The writer has thanked ${praiseThanked} kudos note${praiseThanked === 1 ? '' : 's'} recently — they value hearing what's working. When something genuinely lands, include one kudos note.`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const system = `You are Storyright's editing assistant. You analyze a piece of writing on demand (never continuously) and surface a small, high-signal set of suggestions grouped into exactly five categories: "word" (word choice — repetition, vague verbs, stronger alternatives), "tone" (voice & tone — consistency with the writer's stated voice), "grammar" (clarity & grammar — genuine errors or confusing constructions, not style nitpicks), "pacing" (pacing & structure — a specific paragraph that runs long or drags relative to the rest of the piece; this is the only category anchored to a whole paragraph rather than a phrase), "style" (style & craft — can be a compliment on something that's working, not only criticism).

Rules:
- Return ONLY a JSON array, no prose, no markdown fences.
- Each item: {"category": "word"|"tone"|"grammar"|"pacing"|"style", "kind": "phrase"|"flag"|"pattern", "phrase": exact substring copied verbatim from the text (required, only for kind "phrase"), "occurrence": 1-based index of which occurrence of that phrase to flag if it appears more than once (default 1), "blockIndex": the paragraph number in brackets like [0] (required, only for kind "flag"), "instances": [{"phrase": exact verbatim substring, "occurrence": 1-based index}] (required, only for kind "pattern"), "heading": 2-4 word label, "desc": one or two sentence explanation written directly to the writer.
- "phrase" must be an exact, short (2-10 word) substring that appears verbatim in the numbered paragraphs — never paraphrase it.
- Use kind "pattern" when the issue is a construction that recurs across the piece rather than one spot — e.g. several sentences built the same way (opening with a participle, an "X, and then Y" rhythm), a repeated word or tic, a run of same-length sentences. List every instance (2-8) in reading order. Each instance "phrase" is an exact verbatim substring identifying that occurrence: the whole sentence if it's 25 words or fewer, otherwise its distinctive opening (up to 15 words). A pattern counts as one suggestion; don't also flag its instances individually.
- Do not repeat or restate any suggestion already listed as existing/open below.
- Favor a small number of genuinely useful suggestions over an exhaustive list — at most 5, often fewer. Suggestion fatigue is the #1 complaint about tools like this; only surface what's actually worth the writer's attention.
- Set "praise": true on a note that compliments something working (kudos) rather than asking for a change. Kudos are kind "phrase", usually category "style".
- If the writing is already clean and nothing else is worth flagging, return an empty array [].`;

  const user = `Title: ${title || 'Untitled'}

${personalization ? personalization + '\n\n' : ''}${tuning ? tuning + '\n\n' : ''}Already-open suggestions (do not repeat these):
${existingList}

Numbered paragraphs:
${numberedParagraphs}`;

  const response = await claude().messages.create({
    model: MODEL,
    max_tokens: 1500,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  const raw = extractJsonArray(text);
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      category: (item.category as SuggestionCategory) ?? 'style',
      kind: (item.kind === 'flag' ? 'flag' : item.kind === 'pattern' ? 'pattern' : 'phrase') as RawSuggestion['kind'],
      praise: item.praise === true,
      instances: Array.isArray(item.instances)
        ? (item.instances as unknown[])
            .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).phrase === 'string')
            .map((x) => ({ phrase: String(x.phrase), occurrence: typeof x.occurrence === 'number' ? x.occurrence : 1 }))
        : undefined,
      phrase: typeof item.phrase === 'string' ? item.phrase : undefined,
      occurrence: typeof item.occurrence === 'number' ? item.occurrence : 1,
      blockIndex: typeof item.blockIndex === 'number' ? item.blockIndex : undefined,
      heading: typeof item.heading === 'string' ? item.heading : CATEGORY_HEADINGS[(item.category as SuggestionCategory) ?? 'style'],
      desc: typeof item.desc === 'string' ? item.desc : '',
    }))
    .filter((s) =>
      s.kind === 'phrase' ? !!s.phrase : s.kind === 'pattern' ? (s.instances?.length ?? 0) >= 2 : typeof s.blockIndex === 'number'
    );
}

// ---------- Alternatives (per-suggestion "show me options") ----------

export interface AlternativesArgs {
  category: SuggestionCategory;
  heading: string;
  desc: string;
  phrase: string; // the flagged passage
  sentence: string; // the full sentence containing it
  paragraph: string; // the surrounding paragraph, for voice/context
  target?: 'passage' | 'paragraph'; // paragraph: rewrite the whole thing (pacing flags)
  avoid?: string[]; // options already shown — used by "More options"
  manifesto?: string | null;
  fingerprintSummary?: string | null;
}

export interface AlternativesResult {
  // phrase: each option replaces just the flagged passage.
  // sentence: each option replaces the whole sentence around it.
  scope: 'phrase' | 'sentence' | 'paragraph';
  options: string[];
}

export async function generateAlternatives(args: AlternativesArgs): Promise<AlternativesResult> {
  const personalization = [
    args.manifesto ? `The writer's stated manifesto/preferences: ${args.manifesto}` : null,
    args.fingerprintSummary ? `Their style fingerprint (from past work): ${args.fingerprintSummary}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  if (args.target === 'paragraph') return generateParagraphRewrites(args, personalization);

  const system = `You are Storyright's editing assistant. The writer is looking at one of your editing notes and wants concrete alternatives they can drop straight into their draft.

Rules:
- Return ONLY a JSON object, no prose, no markdown fences: {"scope": "phrase"|"sentence", "options": [string, string, string]}.
- Pick scope "phrase" when swapping just the flagged passage fixes the issue (word choice, a single clunky phrase). Pick "sentence" when the fix needs the sentence rebuilt (tone of the whole sentence, structure, rhythm, grammar that spans it).
- With scope "phrase", each option must read naturally when substituted for the flagged passage inside the sentence as written. With scope "sentence", each option is a complete replacement sentence, including its ending punctuation.
- Give exactly 3 options that are genuinely different from each other (not synonyms of one idea), each fixing the issue the note describes.
- Stay in the writer's voice, tense, and point of view. Don't add new plot facts or change meaning.
- Never return the original text as an option.`;

  const avoid = args.avoid?.length
    ? `\nThe writer already saw these options; give different ones:\n${args.avoid.map((o) => `- ${o}`).join('\n')}\n`
    : '';
  const user = `Editing note (${args.category}): ${args.heading} — ${args.desc}

Flagged passage: "${args.phrase}"
Sentence: "${args.sentence}"
Paragraph for context:
"""
${args.paragraph}
"""
${avoid}${personalization ? '\n' + personalization : ''}`;

  const response = await claude().messages.create({
    model: MODEL,
    max_tokens: 700,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  const obj = extractJsonObject(text);
  const rawOptions: unknown[] = Array.isArray(obj?.options) ? (obj?.options as unknown[]) : [];
  const options = rawOptions
    .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
    .map((o) => o.trim())
    .filter((o) => o !== args.phrase && o !== args.sentence)
    .slice(0, 3);
  const scope = obj?.scope === 'sentence' ? 'sentence' : 'phrase';
  return { scope, options };
}


interface FingerprintArgs {
  manifesto?: string;
  sampleText: string;
}

// Produces a short prose "style fingerprint" from a writer's uploaded past
// work, generated once during onboarding and reused as personalization
// context (`fingerprintSummary`) on every later generateSuggestions() call.
export async function generateStyleFingerprint(args: FingerprintArgs): Promise<string> {
  const { manifesto, sampleText } = args;

  const system = `You analyze a writer's past work to build a concise "style fingerprint" — a short profile of their natural voice, used later to personalize editing feedback on new drafts. Write 3-5 sentences in third person ("This writer tends to..."), covering: sentence rhythm and length, vocabulary register (plain vs. ornate), tone/mood tendencies, and any recurring stylistic habits (repetition, favorite constructions, punctuation quirks) that are worth preserving rather than "fixing". Do not grade or critique the writing — this is a descriptive profile, not a review. Return plain prose only, no headings, no markdown, no preamble.`;

  const user = `${manifesto ? `The writer's stated manifesto: ${manifesto}\n\n` : ''}Writing samples:\n\n${sampleText}`;

  const response = await claude().messages.create({
    model: MODEL,
    max_tokens: 400,
    system,
    messages: [{ role: 'user', content: user }],
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

export interface ExtractedEntity {
  type: 'character' | 'place';
  name: string;
  summary: string;
}

interface ExtractEntitiesArgs {
  chapterTitle: string;
  chapterText: string;
  knownCharacters: string[];
  knownPlaces: string[];
}

// Runs alongside a chapter's explicit Review click (never ambiently — see
// the locked Review-workflow rule) to keep the Outline's Characters/Places
// lists in sync with what's actually been written. Only surfaces entities
// the chapter gives real, summarizable detail about — not every proper noun.
export async function extractEntities(args: ExtractEntitiesArgs): Promise<ExtractedEntity[]> {
  const { chapterTitle, chapterText, knownCharacters, knownPlaces } = args;
  if (chapterText.trim().length < 20) return [];

  const system = `You read one chapter of a work-in-progress and identify which named characters and named places it gives concrete, summarizable detail about — for a writer's outline/story-bible page, not a full NLP entity extraction.

Rules:
- Return ONLY a JSON array, no prose, no markdown fences.
- Each item: {"type": "character"|"place", "name": exact name as it appears in the text, "summary": one or two sentences describing what THIS chapter reveals about them (traits, role, relationships, appearance for characters; description or narrative significance for places)}.
- Skip anything mentioned only in passing with no real detail (a name dropped once with nothing said about them isn't worth an entry).
- Known characters already tracked: ${knownCharacters.length ? knownCharacters.join(', ') : 'none yet'}.
- Known places already tracked: ${knownPlaces.length ? knownPlaces.join(', ') : 'none yet'}.
- For a name that matches one of those known lists (case-insensitive), still include it if this chapter adds meaningful new detail worth folding in — write the summary as a fresh synthesis, not just what's new.
- Favor precision over recall — at most 5 entities, often fewer or zero.
- If nothing meets the bar, return an empty array [].`;

  const user = `Chapter: ${chapterTitle || 'Untitled'}

${chapterText}`;

  const response = await claude().messages.create({
    model: MODEL,
    max_tokens: 1200,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  const raw = extractJsonArray(text);
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      type: item.type === 'place' ? 'place' : 'character',
      name: typeof item.name === 'string' ? item.name.trim() : '',
      summary: typeof item.summary === 'string' ? item.summary.trim() : '',
    }))
    .filter((e): e is ExtractedEntity => Boolean(e.name && e.summary));
}

interface OutlineReviewArgs {
  title: string;
  premise: string;
  themes: string;
  takeaway: string;
  chapters: { title: string; synopsis: string; target_feeling: string }[];
  characters: { name: string; role: string; summary: string }[];
  places: { name: string; summary: string }[];
  threads: string[];
}

export interface RawOutlineSuggestion {
  category: OutlineSuggestionCategory;
  heading: string;
  desc: string;
}

export interface OutlineReviewResult {
  summary: string;
  suggestions: RawOutlineSuggestion[];
}

const OUTLINE_CATEGORY_HEADINGS: Record<OutlineSuggestionCategory, string> = {
  chapter: 'Story beat',
  character: 'Character',
  place: 'Place',
  theme: 'Theme',
};

// The Outline page's explicit Review: synthesizes the whole master plan
// (summary + chapters + characters + places + threads) back to the writer
// and suggests concrete additions/strengthening moves — never generated
// ambiently, only on click, mirroring the entry-level Review rule.
export async function generateOutlineReview(args: OutlineReviewArgs): Promise<OutlineReviewResult> {
  const { title, premise, themes, takeaway, chapters, characters, places, threads } = args;

  const chapterList = chapters.length
    ? chapters
        .map(
          (c, i) =>
            `${i + 1}. "${c.title}"${c.synopsis ? ` — ${c.synopsis}` : ' — (no summary yet)'}${
              c.target_feeling ? ` [intended feeling: ${c.target_feeling}]` : ''
            }`
        )
        .join('\n')
    : 'None outlined yet.';

  const characterList = characters.length
    ? characters.map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ''}: ${c.summary || '(no detail yet)'}`).join('\n')
    : 'None yet.';

  const placeList = places.length
    ? places.map((p) => `- ${p.name}: ${p.summary || '(no detail yet)'}`).join('\n')
    : 'None yet.';

  const threadList = threads.length ? threads.map((t) => `- ${t}`).join('\n') : 'None yet.';

  const system = `You are Storyright's outline consultant. A writer has filled in some or all of a project's master plan — a story summary, a chapter-by-chapter beat sheet, a character list, a place list, and a catch-all "Threads" notes list. Whatever is still empty is simply not written yet, not a flaw.

Give them two things, returned as ONLY a JSON object (no prose, no markdown fences) shaped exactly like:
{"summary": "...", "suggestions": [{"category": "chapter"|"character"|"place"|"theme", "heading": "...", "desc": "..."}]}

- "summary": 2-4 sentences reflecting the story back to them in your own words — what it's about, where it's strong, so they can check it matches what's in their head. Written directly to the writer, warm but substantive, not generic praise.
- "suggestions": concrete opportunities to strengthen the story — a missing chapter/beat that would close a gap ("chapter"), a character who needs more definition or a relationship that's unclear ("character"), a place that's named but underdescribed or a setting that could do more work ("place"), or a way to reinforce the stated themes more consistently across chapters ("theme"). Each "desc" should be one or two specific, actionable sentences, not vague encouragement. At most 6 suggestions, favor quality over quantity. If the outline is too sparse to say anything specific, keep suggestions short and focused on what to fill in first rather than inventing detail.`;

  const user = `Title: ${title || 'Untitled'}

Story summary:
- What it's about: ${premise || '(not written yet)'}
- Themes: ${themes || '(not written yet)'}
- Reader takeaway: ${takeaway || '(not written yet)'}

Chapters:
${chapterList}

Characters:
${characterList}

Places:
${placeList}

Threads (miscellaneous notes):
${threadList}`;

  const response = await claude().messages.create({
    model: MODEL,
    max_tokens: 1800,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  const parsed = extractJsonObject(text);
  const summary = typeof parsed?.summary === 'string' ? parsed.summary : '';
  const rawSuggestions = Array.isArray(parsed?.suggestions) ? (parsed.suggestions as unknown[]) : [];

  const suggestions = rawSuggestions
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => {
      const category = (['chapter', 'character', 'place', 'theme'].includes(item.category as string)
        ? item.category
        : 'theme') as OutlineSuggestionCategory;
      return {
        category,
        heading: typeof item.heading === 'string' ? item.heading : OUTLINE_CATEGORY_HEADINGS[category],
        desc: typeof item.desc === 'string' ? item.desc : '',
      };
    })
    .filter((s) => s.desc);

  return { summary, suggestions };
}

interface AdviceArgs {
  entryTitle: string;
  selectedText: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  manifesto?: string | null;
  fingerprintSummary?: string | null;
}

// Highlight-to-ask advice mode: the writer selects a passage from their own
// draft and asks a free-form question about it. Each call replays the full
// thread so far as Claude message history; the highlighted passage and
// personalization context live in the system prompt so they stay anchored
// even as the conversation continues.
export async function generateAdviceReply(args: AdviceArgs): Promise<string> {
  const { entryTitle, selectedText, history, manifesto, fingerprintSummary } = args;

  const personalization = [
    manifesto ? `The writer's stated manifesto/preferences: ${manifesto}` : null,
    fingerprintSummary ? `Their style fingerprint (from past work): ${fingerprintSummary}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const system = `You are Storyright's writing advisor. The writer has highlighted a passage from their own draft ("${entryTitle || 'Untitled'}") and is asking you about it directly, conversationally. Speak like a sharp, encouraging writing mentor — specific and opinionated, never generic or hedging. Stay anchored to the highlighted passage and the writer's actual question; don't just repeat the passage back to them. Keep answers focused, usually well under 200 words unless they explicitly ask for more depth.

Highlighted passage:
"""
${selectedText}
"""
${personalization ? '\n' + personalization : ''}`;

  const response = await claude().messages.create({
    model: MODEL,
    max_tokens: 700,
    system,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}


// ---------- Indirect references (chapter Review) ----------

export interface ExtractedReference {
  entityId: string;
  via: string; // the phrase used, e.g. "her father"
  count: number;
  snippet: string; // the sentence it appears in
}

interface ExtractReferencesArgs {
  chapterText: string;
  entities: { id: string; kind: 'character' | 'place'; name: string; aliases: string[] }[];
}

// Runs on a chapter's explicit Review click. Finds where the chapter refers to
// a known character or place WITHOUT using their name or aliases ("her father",
// "the old keeper", "the town") — exact name matches are counted separately,
// live, so they're excluded here.
export async function extractReferences(args: ExtractReferencesArgs): Promise<ExtractedReference[]> {
  const { chapterText, entities } = args;
  if (chapterText.trim().length < 40 || !entities.length) return [];

  const roster = entities
    .map((e) => `- id=${e.id} | ${e.kind} | ${e.name}${e.aliases.length ? ` (also: ${e.aliases.join(', ')})` : ''}`)
    .join('\n');

  const system = `You read one chapter of a work-in-progress and find where it refers to a known character or place WITHOUT using their name or any listed alias — e.g. "her father", "the keeper", "the town", "she" when it unambiguously means one specific known character.

Known characters and places:
${roster}

Rules:
- Return ONLY a JSON array, no prose, no markdown fences.
- Each item: {"id": the known id, "via": the exact referring phrase as written (e.g. "her father"), "count": how many times this chapter refers to them that way, "snippet": the full sentence containing the first such reference, copied exactly}.
- One item per known id at most. Skip ids the chapter only refers to by name/alias, or doesn't refer to at all.
- Only include references you're confident about. If none, return [].`;

  const response = await claude().messages.create({
    model: MODEL,
    max_tokens: 1200,
    system,
    messages: [{ role: 'user', content: chapterText.slice(0, 60000) }],
  });
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  const known = new Set(entities.map((e) => e.id));
  return extractJsonArray(text)
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      entityId: typeof item.id === 'string' ? item.id : '',
      via: typeof item.via === 'string' ? item.via.trim() : '',
      count: typeof item.count === 'number' && item.count > 0 ? Math.round(item.count) : 1,
      snippet: typeof item.snippet === 'string' ? item.snippet.trim() : '',
    }))
    .filter((r) => known.has(r.entityId) && r.via);
}

// ---------- Character / Place review (detail page Insights) ----------

interface EntityReviewArgs {
  kind: 'character' | 'place';
  storyTitle: string;
  premise: string;
  themes: string;
  name: string;
  role?: string;
  fields: { label: string; value: string }[];
  appearances: { chapter: string; how: string; snippet: string }[];
  chapterCount: number;
  threads: string[];
}

const ENTITY_CATEGORIES: EntityInsightCategory[] = ['arc', 'consistency', 'presence', 'theme', 'relationship', 'history'];

export async function generateEntityReview(args: EntityReviewArgs): Promise<{ summary: string; items: EntityInsight[] }> {
  const { kind, storyTitle, premise, themes, name, role, fields, appearances, chapterCount, threads } = args;
  const label = kind === 'character' ? 'character' : 'place';

  const system = `You are Storyright's story-bible consultant. A writer wants a focused review of one ${label} in their work-in-progress, checked against what they've actually written. Empty fields are simply not written yet, not flaws.

Return ONLY a JSON object (no prose, no markdown fences):
{"summary": "...", "items": [{"category": ${ENTITY_CATEGORIES.map((c) => `"${c}"`).join('|')}, "heading": "...", "desc": "..."}]}

- "summary": 1-3 sentences on how this ${label} is working so far, specific to them, addressed to the writer.
- "items": at most 5 concrete, actionable observations. Use "arc" for change over the story${kind === 'place' ? ' (rarely for places)' : ''}, "consistency" for contradictions or facts to double-check, "presence" for how often / how vividly they're on the page, "theme" for how they carry the story's themes, "relationship" for how they connect to others${kind === 'place' ? ' (people tied to the place)' : ''}, "history" for backstory gaps. Each "desc" is one or two specific sentences. Noting what's working is fine when it's specific.`;

  const user = `Story: ${storyTitle || 'Untitled'}
What it's about: ${premise || '(not written yet)'}
Story themes: ${themes || '(not written yet)'}

${kind === 'character' ? 'Character' : 'Place'}: ${name}${role ? ` (${role})` : ''}
${fields.map((f) => `${f.label}: ${f.value || '(not written yet)'}`).join('\n')}

Appears in ${appearances.length} of ${chapterCount} chapters:
${appearances.length ? appearances.map((a) => `- ${a.chapter} (${a.how}): "${a.snippet}"`).join('\n') : '(not in any chapter yet)'}

Related threads:
${threads.length ? threads.map((t) => `- ${t}`).join('\n') : '(none)'}`;

  const response = await claude().messages.create({
    model: MODEL,
    max_tokens: 1400,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  const parsed = extractJsonObject(text);
  const summary = typeof parsed?.summary === 'string' ? parsed.summary : '';
  const rawItems = Array.isArray(parsed?.items) ? (parsed.items as unknown[]) : [];
  const items = rawItems
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      category: (ENTITY_CATEGORIES.includes(item.category as EntityInsightCategory)
        ? item.category
        : 'consistency') as EntityInsightCategory,
      heading: typeof item.heading === 'string' ? item.heading : '',
      desc: typeof item.desc === 'string' ? item.desc : '',
    }))
    .filter((i) => i.heading && i.desc);
  return { summary, items };
}

// Iterate on a paragraph-level note (pacing): three full rewrites of the paragraph.
async function generateParagraphRewrites(args: AlternativesArgs, personalization: string): Promise<AlternativesResult> {
  const system = `You are Storyright's editing assistant. The writer is looking at a note about a whole paragraph and wants concrete rewrites they can drop straight into their draft.

Rules:
- Return ONLY a JSON object, no prose, no markdown fences: {"options": [string, string, string]}.
- Each option is a complete replacement for the paragraph that addresses the note (for pacing: tighter, or restructured so it moves), as plain prose with no line breaks.
- Make the three genuinely different approaches (e.g. trim hard, restructure, cut to the essential image), not light variations.
- Keep the writer's voice, tense, point of view, and every plot fact. Don't invent new events.`;

  const avoid = args.avoid?.length
    ? `\nThe writer already saw these; give different ones:\n${args.avoid.map((o) => `- ${o}`).join('\n')}\n`
    : '';
  const user = `Editing note (${args.category}): ${args.heading} — ${args.desc}

Paragraph:
"""
${args.paragraph}
"""
${avoid}${personalization ? '\n' + personalization : ''}`;

  const response = await claude().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  const obj = extractJsonObject(text);
  const rawOptions: unknown[] = Array.isArray(obj?.options) ? (obj?.options as unknown[]) : [];
  const options = rawOptions
    .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
    .map((o) => o.trim().replace(/\s*\n+\s*/g, ' '))
    .filter((o) => o !== args.paragraph)
    .slice(0, 3);
  return { scope: 'paragraph', options };
}

// ---------- Ask (free-form questions about one piece of the story) ----------

export interface AskArgs {
  storyContext: string; // from buildStoryContext
  targetLabel: string; // e.g. `Thread "The ferry ledger"`
  includeThreads: boolean;
  history: { role: 'user' | 'assistant'; content: string; quote?: string }[];
  manifesto?: string | null;
  fingerprintSummary?: string | null;
}

// Streams Claude's answer as plain text chunks. The caller collects the full
// reply to save it once the stream ends.
export async function* streamAskReply(args: AskArgs): AsyncGenerator<string> {
  const personalization = [
    args.manifesto ? `The writer's stated manifesto/preferences: ${args.manifesto}` : null,
    args.fingerprintSummary ? `Their style fingerprint (from past work): ${args.fingerprintSummary}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const system = `You are Storyright's story-development partner — a sharp, warm editor who knows this manuscript inside out. The writer is asking about ${args.targetLabel}. The full story as it stands is below: summary, chapters, characters and places.

How to answer:
- Give a few distinct, concrete thoughts on how to treat it — usually 2–4 options. Start each with a short **bold lead-in**, then 1–3 sentences.
- Ground every thought in specifics from the story: name the chapters, characters, places, images and themes it could connect to, and say how (e.g. which scene it could slot into, which arc it deepens, which motif it echoes).
- Prefer real connections already latent in the writing over generic craft advice. Respect what's established, and flag it plainly if an idea would contradict something.
- ${args.includeThreads ? 'Other threads are included below; they are ideas, not canon — you may draw on them, but say when you do.' : "Only the chapters, characters and places are canon. Don't assume any other threads exist."}
- Don't rewrite the writer's prose unless they ask; a short illustrative line is fine.
- Plain text only: **bold** and "- " bullet lines are fine, no headings. Keep it under about 300 words unless they ask for more.
- If the question is ambiguous, answer the most likely reading, then end with one short question.
${personalization ? '\n' + personalization + '\n' : ''}
=== THE STORY ===

${args.storyContext}`;

  const messages = args.history.map((m) => ({
    role: m.role,
    content: m.role === 'user' && m.quote ? `About this passage:\n"""\n${m.quote}\n"""\n\n${m.content}` : m.content,
  }));

  const stream = claude().messages.stream({
    model: MODEL,
    max_tokens: 1200,
    system,
    messages,
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }
}
