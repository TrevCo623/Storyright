import Anthropic from '@anthropic-ai/sdk';
import type { SuggestionCategory } from '@/lib/types';

let client: Anthropic | null = null;
export function claude() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export const MODEL = 'claude-sonnet-4-5';

export interface RawSuggestion {
  category: SuggestionCategory;
  kind: 'phrase' | 'flag';
  phrase?: string;
  occurrence?: number;
  blockIndex?: number;
  heading: string;
  desc: string;
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
  existing: { category: SuggestionCategory; phrase?: string; blockIndex?: number }[];
  manifesto?: string | null;
  fingerprintSummary?: string | null;
}

export async function generateSuggestions(args: GenerateArgs): Promise<RawSuggestion[]> {
  const { title, paragraphs, existing, manifesto, fingerprintSummary } = args;
  if (paragraphs.join('').trim().length < 20) return [];

  const numberedParagraphs = paragraphs
    .map((p, i) => `[${i}] ${p}`)
    .join('\n\n');

  const existingList = existing.length
    ? existing
        .map((e) => (e.phrase ? `- ${e.category}: "${e.phrase}"` : `- ${e.category}: paragraph ${e.blockIndex}`))
        .join('\n')
    : 'none';

  const personalization = [
    manifesto ? `The writer's stated manifesto/preferences: ${manifesto}` : null,
    fingerprintSummary ? `Their style fingerprint (from past work): ${fingerprintSummary}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const system = `You are Storyright's editing assistant. You analyze a piece of writing on demand (never continuously) and surface a small, high-signal set of suggestions grouped into exactly five categories: "word" (word choice — repetition, vague verbs, stronger alternatives), "tone" (voice & tone — consistency with the writer's stated voice), "grammar" (clarity & grammar — genuine errors or confusing constructions, not style nitpicks), "pacing" (pacing & structure — a specific paragraph that runs long or drags relative to the rest of the piece; this is the only category anchored to a whole paragraph rather than a phrase), "style" (style & craft — can be a compliment on something that's working, not only criticism).

Rules:
- Return ONLY a JSON array, no prose, no markdown fences.
- Each item: {"category": "word"|"tone"|"grammar"|"pacing"|"style", "kind": "phrase"|"flag", "phrase": exact substring copied verbatim from the text (required, only for kind "phrase"), "occurrence": 1-based index of which occurrence of that phrase to flag if it appears more than once (default 1), "blockIndex": the paragraph number in brackets like [0] (required, only for kind "flag"), "heading": 2-4 word label, "desc": one or two sentence explanation written directly to the writer.
- "phrase" must be an exact, short (2-10 word) substring that appears verbatim in the numbered paragraphs — never paraphrase it.
- Do not repeat or restate any suggestion already listed as existing/open below.
- Favor a small number of genuinely useful suggestions over an exhaustive list — at most 5, often fewer. Suggestion fatigue is the #1 complaint about tools like this; only surface what's actually worth the writer's attention.
- If the writing is already clean and nothing else is worth flagging, return an empty array [].`;

  const user = `Title: ${title || 'Untitled'}

${personalization ? personalization + '\n\n' : ''}Already-open suggestions (do not repeat these):
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
      kind: (item.kind === 'flag' ? 'flag' : 'phrase') as 'flag' | 'phrase',
      phrase: typeof item.phrase === 'string' ? item.phrase : undefined,
      occurrence: typeof item.occurrence === 'number' ? item.occurrence : 1,
      blockIndex: typeof item.blockIndex === 'number' ? item.blockIndex : undefined,
      heading: typeof item.heading === 'string' ? item.heading : CATEGORY_HEADINGS[(item.category as SuggestionCategory) ?? 'style'],
      desc: typeof item.desc === 'string' ? item.desc : '',
    }))
    .filter((s) => (s.kind === 'phrase' ? !!s.phrase : typeof s.blockIndex === 'number'));
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
