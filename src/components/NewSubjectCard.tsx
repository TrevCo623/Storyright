'use client';

import { useState } from 'react';
import { createSubject } from '@/app/subjects/actions';

export default function NewSubjectCard() {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  if (!open) {
    return (
      <button className="project-card new-project-card" onClick={() => setOpen(true)}>
        <div className="new-project-title">New project</div>
        <div className="new-project-circle">+</div>
      </button>
    );
  }

  return (
    <form
      className="project-card new-project-form"
      action={async (formData) => {
        setCreating(true);
        try {
          await createSubject(formData);
          setOpen(false);
        } finally {
          setCreating(false);
        }
      }}
    >
      <input
        name="title"
        className="text-input"
        placeholder="Project title…"
        autoFocus
        disabled={creating}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          type="submit"
          className="primary-btn"
          style={{ padding: '6px 14px', fontSize: 13 }}
          disabled={creating}
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
        <button type="button" className="secondary-btn" onClick={() => setOpen(false)} disabled={creating}>
          Cancel
        </button>
      </div>
    </form>
  );
}
