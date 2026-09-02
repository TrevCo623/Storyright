// Shared app-level types. `Database` mirrors supabase/migrations/0001_init.sql —
// keep the two in sync if the schema changes.

export type SectionType = 'chapters' | 'scribbles' | 'research' | 'custom';
export type FingerprintStatus = 'not_started' | 'processing' | 'ready' | 'error';
export type SuggestionCategory = 'word' | 'tone' | 'grammar' | 'pacing' | 'style';
export type SuggestionOutcome = 'done' | 'dismissed';

export interface SuggestionDef {
  id: string;
  category: SuggestionCategory;
  kind: 'phrase' | 'flag';
  heading: string;
  desc: string;
  // phrase suggestions locate text via search; flag suggestions (pacing)
  // anchor to a top-level block index in the doc.
  phrase?: string;
  occurrence?: number;
  blockIndex?: number;
}

export interface SuggestionState {
  revealedIds: string[];
  doneIds: string[];
  dismissedIds: string[];
  roundIndex: number;
  // baselines captured at reveal time, used to detect whether a flagged
  // passage has since changed enough to auto-resolve on the next Review.
  originalText: Record<string, string>;
  originalWordCount: Record<string, number>;
  allSuggestions: Record<string, SuggestionDef>;
}

export function emptySuggestionState(): SuggestionState {
  return {
    revealedIds: [],
    doneIds: [],
    dismissedIds: [],
    roundIndex: 0,
    originalText: {},
    originalWordCount: {},
    allSuggestions: {},
  };
}

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  writing_manifesto: string;
  style_preferences: Record<string, unknown>;
  style_fingerprint: Record<string, unknown> | null;
  fingerprint_status: FingerprintStatus;
  onboarded_at: string | null;
  created_at: string;
}

export interface Subject {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Section {
  id: string;
  subject_id: string;
  type: SectionType;
  title: string;
  position: number;
  created_at: string;
}

export interface Entry {
  id: string;
  section_id: string;
  parent_entry_id: string | null;
  title: string;
  content: Record<string, unknown>;
  content_text: string;
  word_count: number;
  position: number;
  suggestion_state: SuggestionState;
  created_at: string;
  updated_at: string;
}

export interface AdviceMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface AdviceThread {
  id: string;
  user_id: string;
  entry_id: string;
  selected_text: string;
  messages: AdviceMessage[];
  created_at: string;
  updated_at: string;
}

// Minimal Supabase Database type — typed loosely (Record) rather than fully
// generated, since this project isn't running `supabase gen types` yet.
// Swap for generated types once the schema stabilizes.
export type Database = {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      subjects: { Row: Subject; Insert: Partial<Subject>; Update: Partial<Subject> };
      sections: { Row: Section; Insert: Partial<Section>; Update: Partial<Section> };
      entries: { Row: Entry; Insert: Partial<Entry>; Update: Partial<Entry> };
      suggestion_feedback: {
        Row: { id: string; user_id: string; entry_id: string; suggestion_id: string; category: string; outcome: SuggestionOutcome; created_at: string };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      past_work_samples: {
        Row: { id: string; user_id: string; storage_path: string; title: string | null; created_at: string };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      advice_threads: { Row: AdviceThread; Insert: Partial<AdviceThread>; Update: Partial<AdviceThread> };
    };
  };
};
