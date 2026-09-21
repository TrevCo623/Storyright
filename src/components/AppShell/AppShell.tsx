'use client';

import { useState, type ReactNode } from 'react';
import Sidebar from '@/components/Sidebar/Sidebar';
import type { Entry, Section } from '@/lib/types';

interface Props {
  subjectId: string;
  subjectTitle: string;
  sections: Section[];
  entries: Entry[];
  children: ReactNode;
}

export default function AppShell({ subjectId, subjectTitle, sections, entries, children }: Props) {
  const [navOpen, setNavOpen] = useState(true);

  return (
    <div className={`app${navOpen ? '' : ' nav-collapsed'}`}>
      <button
        className="icon-btn open-nav-btn"
        title="Open project sidebar"
        onClick={() => setNavOpen(true)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <rect x="1.85" y="3.15" width="4.35" height="9.7" rx="0.5" fill="currentColor" />
        </svg>
      </button>
      <Sidebar
        subjectId={subjectId}
        subjectTitle={subjectTitle}
        sections={sections}
        entries={entries}
        onCollapse={() => setNavOpen(false)}
      />
      {children}
    </div>
  );
}
