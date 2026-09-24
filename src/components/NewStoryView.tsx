'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import { createSubject } from '@/app/subjects/actions';

function joinWithAnd(list: string[]) {
  if (list.length <= 1) return list.join('');
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

export default function NewStoryView() {
  const [title, setTitle] = useState('');
  const [premise, setPremise] = useState('');
  const [themes, setThemes] = useState('');
  const [takeaway, setTakeaway] = useState('');
  const [warning, setWarning] = useState('');
  const [creating, setCreating] = useState(false);

  function missingFields() {
    const missing: string[] = [];
    if (!title.trim()) missing.push('a title');
    if (!premise.trim()) missing.push('what the story is about');
    if (!themes.trim()) missing.push('the general themes');
    if (!takeaway.trim()) missing.push('a reader takeaway');
    return missing;
  }

  const complete = missingFields().length === 0;

  useEffect(() => {
    if (complete && warning) setWarning('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete]);

  return (
    <div className="app">
      <main className="editor-area outline-area">
        <header className="topbar">
          <Link href="/subjects" className="nav-back-link">
            ‹ See all projects
          </Link>
          <div className="topbar-right">
            <ThemeToggle />
          </div>
        </header>

        <div className="editor-scroll">
          <div className="outline-column">
            <form
              action={async (formData) => {
                const missing = missingFields();
                if (missing.length > 0) {
                  setWarning(`Add ${joinWithAnd(missing)} to continue.`);
                  return;
                }
                setCreating(true);
                try {
                  await createSubject(formData);
                } finally {
                  setCreating(false);
                }
              }}
            >
              <h2 className="new-story-heading">Your New Story</h2>

              <div className="new-story-title-block">
                <div className="new-story-eyebrow">Give your story a name</div>
                <input
                  name="title"
                  className="new-story-title-input"
                  placeholder="Give your story a name"
                  autoFocus
                  autoComplete="off"
                  disabled={creating}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <label className="field-label">What is this story about?</label>
              <textarea
                name="premise"
                className="manifesto-textarea"
                placeholder="A quick premise — who, what, why now…"
                style={{ minHeight: 220 }}
                disabled={creating}
                value={premise}
                onChange={(e) => setPremise(e.target.value)}
              />

              <div className="field-row">
                <div className="field-group">
                  <label className="field-label">General themes</label>
                  <textarea
                    name="themes"
                    className="manifesto-textarea"
                    placeholder="What ideas or tensions run through it?"
                    style={{ minHeight: 150 }}
                    disabled={creating}
                    value={themes}
                    onChange={(e) => setThemes(e.target.value)}
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">Reader takeaway</label>
                  <textarea
                    name="takeaway"
                    className="manifesto-textarea"
                    placeholder="What should the reader feel or understand when they finish?"
                    style={{ minHeight: 150 }}
                    disabled={creating}
                    value={takeaway}
                    onChange={(e) => setTakeaway(e.target.value)}
                  />
                </div>
              </div>

              <div className="new-story-footer">
                <div className="new-story-warning">{warning}</div>
                <div className="new-story-actions">
                  <Link href="/subjects" className="new-story-cancel-btn">
                    Cancel
                  </Link>
                  <button
                    type="submit"
                    className={`new-story-start-btn${complete ? ' enabled' : ''}`}
                    disabled={creating}
                  >
                    {creating ? 'Starting…' : 'Start writing'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
