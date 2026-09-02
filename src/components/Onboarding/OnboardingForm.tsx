'use client';

import { useRef, useState } from 'react';
import { completeOnboarding } from '@/app/onboarding/actions';

const PROMPTS = [
  'What tone do you naturally write in — wry, earnest, spare, ornate?',
  'Any words or crutch phrases you want flagged when they creep in?',
  'Writers or books whose voice you’d like echoed in feedback?',
  'Anything suggestions should never touch — dialect, slang, a deliberate quirk?',
];

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

export default function OnboardingForm({ initialManifesto }: { initialManifesto: string }) {
  const [manifesto, setManifesto] = useState(initialManifesto);
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!next.some((existing) => existing.name === f.name && existing.size === f.size)) {
        next.push(f);
      }
    }
    setFiles(next);
  }

  function removeFile(idx: number) {
    setFiles(files.filter((_, i) => i !== idx));
  }

  async function handleSubmit(formData: FormData) {
    setError(null);
    setPending(true);
    formData.delete('samples');
    files.forEach((f) => formData.append('samples', f));
    formData.set('manifesto', manifesto);
    try {
      await completeOnboarding(formData);
    } catch (err) {
      if (isRedirectError(err)) throw err;
      setPending(false);
      setError('Something went wrong saving that — try again.');
    }
  }

  return (
    <div className="onboarding-wrap">
      <h1 className="onboarding-title">Before you start writing</h1>
      <p className="onboarding-sub">
        A couple of quick things so feedback sounds like it&rsquo;s meant for you, not a generic
        style guide. Both are optional — skip either and come back later from Settings.
      </p>

      <form action={handleSubmit}>
        <div className="form-row">
          <label className="field-label" htmlFor="manifesto">
            Your writing manifesto
          </label>
          <textarea
            id="manifesto"
            name="manifesto"
            className="manifesto-textarea"
            placeholder="Tell Storyright how you want feedback to treat your writing…"
            value={manifesto}
            onChange={(e) => setManifesto(e.target.value)}
          />
          <ul
            style={{
              margin: '10px 0 0',
              paddingLeft: 18,
              color: 'var(--text-tertiary)',
              fontSize: 12.5,
              lineHeight: 1.7,
            }}
          >
            {PROMPTS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>

        <div className="form-row">
          <label className="field-label">Past work (optional)</label>
          <div className="upload-zone" onClick={() => fileInputRef.current?.click()}>
            Drop .txt or .md files here, or click to browse — a chapter, an essay, anything in
            your voice.
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,text/plain,text/markdown"
            style={{ display: 'none' }}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {files.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {files.map((f, i) => (
                <span key={f.name + f.size} className="file-chip">
                  {f.name}
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    style={{ color: 'var(--text-tertiary)' }}
                    aria-label={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p style={{ color: 'var(--sug-tone)', fontSize: 13, margin: '0 0 16px' }}>{error}</p>
        )}

        <div className="form-actions">
          <button type="submit" className="primary-btn" disabled={pending}>
            {pending ? 'Setting things up…' : 'Start writing'}
          </button>
        </div>
      </form>
    </div>
  );
}
