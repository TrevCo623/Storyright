'use client';

import { useState } from 'react';
import { createSubject } from '@/app/subjects/actions';

export default function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <button className="picker-new-btn" onClick={() => setOpen(true)}>
        <span>+</span> New Project
      </button>

      {open && (
        <div className="confirm-overlay" onClick={() => !creating && setOpen(false)}>
          <div className="entity-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="entity-dialog-title">New project</h3>
            <form
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
              <div className="entity-dialog-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setOpen(false)}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn" disabled={creating}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
