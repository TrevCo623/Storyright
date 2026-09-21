'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { deleteSubject } from '@/app/subjects/actions';
import ConfirmDialog from '@/components/ConfirmDialog';
import TrashIcon from '@/components/icons/TrashIcon';

interface Props {
  id: string;
  title: string;
  meta: string;
  summary: string;
}

export default function ProjectCard({ id, title, meta, summary }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteSubject(id);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="project-card"
      style={deleting ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        router.push(`/subjects/${id}`);
      }}
    >
      <button
        className="project-card-delete-btn"
        title="Delete this story"
        onClick={(e) => {
          e.stopPropagation();
          setConfirmingDelete(true);
        }}
      >
        <TrashIcon />
      </button>
      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this story?"
          message={`"${title || 'This story'}" will be permanently removed. This can't be undone.`}
          confirmLabel="Delete"
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            void handleDelete();
          }}
        />
      )}
      <div className="project-card-top">
        <div className="project-card-title">{title}</div>
        <div className="project-card-meta">{meta}</div>
      </div>
      {summary ? (
        <p className="project-card-summary">{summary}</p>
      ) : (
        <p className="project-card-summary placeholder">
          No premise yet — add one from the Outline page.
        </p>
      )}
      <button className="project-card-write-btn" onClick={() => router.push(`/subjects/${id}`)}>
        Open
      </button>
    </div>
  );
}
